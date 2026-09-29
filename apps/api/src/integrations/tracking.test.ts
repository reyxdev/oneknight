import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { integrations, notifications, orderEvents, orders, products, sites } from "../db/schema.ts";
import { encrypt } from "../security/crypto.ts";
import { trackParcels } from "./tracking.ts";
import type { NpCall } from "./novaposhta.ts";
import type { UpFetch } from "./ukrposhta.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `trk${Date.now()}`;
const DAY = 86_400_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("parcel tracking: statuses follow Nova Poshta and Ukrposhta, returns restock, waiting 3+ days reported once", async () => {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Track", phone: "+380500000015", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const org = r.json().organizations[0].id as string;
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const [p] = await db.insert(products).values({ organizationId: org, siteId: site!.id, name: "Мед", priceKop: 100, stock: 5 }).returning();
  await db.insert(integrations).values([
    { organizationId: org, provider: "novaposhta", status: "connected", credentialsEnc: encrypt(JSON.stringify({ apiKey: "k".repeat(32), sender: {} })), settings: {} },
    { organizationId: org, provider: "ukrposhta", status: "connected", credentialsEnc: encrypt(JSON.stringify({ bearer: "ecom-bearer", token: "t", trackingBearer: "track-bearer", sender: {} })), settings: {} },
  ]);
  const base = { organizationId: org, siteId: site!.id, customerName: "A", customerPhone: "+380", totalKop: 100, payment: "cod" };
  const np = { delivery: { method: "novaposhta" } };
  const up = { delivery: { method: "ukrposhta" } };
  const item = [{ productId: p!.id, name: "Мед", qty: 1, priceKop: 100 }];
  const made = await db
    .insert(orders)
    .values([
      { ...base, ...np, items: [], status: "confirmed" as const, waybill: "20450000000001" },
      { ...base, ...np, items: [], status: "shipped" as const, waybill: "20450000000002" },
      { ...base, ...np, items: [], status: "shipped" as const, waybill: "20450000000003" },
      { ...base, ...np, items: item, status: "shipped" as const, waybill: "20450000000004" },
      { ...base, ...up, items: [], status: "shipped" as const, waybill: "0500100031143" },
      { ...base, ...up, items: [], status: "confirmed" as const, waybill: "0500100031135" },
      { ...base, ...np, items: [], status: "done" as const, waybill: "20450000000009" },
    ])
    .returning();
  const npCodes: Record<string, number> = { "20450000000001": 5, "20450000000002": 7, "20450000000003": 9, "20450000000004": 103, "20450000000009": 5 };
  const npAsked: string[] = [];
  const fakeNp: NpCall = async (_k, model, method, props) => {
    assert.deepEqual([model, method], ["TrackingDocument", "getStatusDocuments"]);
    const docs = (props.Documents as { DocumentNumber: string }[]).map((d) => d.DocumentNumber);
    npAsked.push(...docs);
    return { success: true, errors: [], data: docs.map((n) => ({ Number: n, StatusCode: String(npCodes[n]), Status: `Статус ${npCodes[n]}` })) };
  };
  const upBearers: string[] = [];
  const fakeUp: UpFetch = async (url, init) => {
    assert.ok(url.endsWith("/status-tracking/0.0.1/statuses/last"));
    upBearers.push(init.bearer);
    const events: Record<string, { event: number; eventReason_id: number | null; eventName: string }> = {
      "0500100031143": { event: 41000, eventReason_id: 10, eventName: "Shipment delivered to: sender" },
      "0500100031135": { event: 21700, eventReason_id: null, eventName: "Arrival to delivery office" },
    };
    return { status: 200, body: (init.body as string[]).map((b) => ({ barcode: b, ...events[b] })) };
  };
  const run = () => trackParcels({ np: fakeNp, up: fakeUp, orgId: org });
  await run();
  const get = async (i: number) => (await db.select().from(orders).where(eq(orders.id, made[i]!.id)))[0]!;
  assert.ok(!npAsked.includes("20450000000009"), "finished orders are not checked");
  assert.deepEqual(upBearers, ["track-bearer"], "the tracking bearer of Ukrposhta");
  assert.equal((await get(0)).status, "shipped", "accepted by the carrier → Відправлено");
  assert.ok((await get(1)).arrivedAt, "at the branch");
  assert.equal((await get(2)).status, "done", "received → Завершено");
  assert.equal((await get(3)).status, "returned", "refused → Повернення");
  assert.equal((await db.select().from(products).where(eq(products.id, p!.id)))[0]!.stock, 6, "the returned item is back in stock");
  assert.equal((await get(4)).status, "returned", "Ukrposhta: delivered back to the sender");
  assert.equal((await get(5)).status, "shipped");
  assert.equal((await get(0)).trackText, "Статус 5");
  const events = await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, made[0]!.id), eq(orderEvents.kind, "tracking")));
  assert.equal(events.length, 1);
  await run();
  assert.equal((await db.select().from(orderEvents).where(and(eq(orderEvents.orderId, made[0]!.id), eq(orderEvents.kind, "tracking")))).length, 1, "no new event without a change");

  // Waiting at the branch for 4 days: Home and one Telegram notification.
  await db.update(orders).set({ arrivedAt: new Date(Date.now() - 4 * DAY) }).where(eq(orders.id, made[1]!.id));
  await run();
  await run();
  const waiting = await db.select().from(notifications).where(and(eq(notifications.organizationId, org), eq(notifications.key, "parcelWaiting")));
  assert.equal(waiting.length, 1);
  const refused = await db.select().from(notifications).where(and(eq(notifications.organizationId, org), eq(notifications.key, "parcelRefused")));
  assert.equal(refused.length, 2);
  const cookie = `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
  const todo = (await app.inject({ url: "/api/dashboard", headers: { cookie } })).json().todo;
  assert.equal(todo.find((t: { key: string }) => t.key === "parcelWaiting")?.params.n, 1);
  assert.equal((await app.inject({ url: "/api/shop/orders?status=waiting", headers: { cookie } })).json().length, 1);
  await db.delete(sites).where(eq(sites.id, site!.id));
});
