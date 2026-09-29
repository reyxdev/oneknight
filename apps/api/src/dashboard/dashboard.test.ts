import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { analyticsEvents, integrations, orders, organizations, products, sites, subscriptions, telegramLinks, users } from "../db/schema.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { encrypt } from "../security/crypto.ts";

const onePage = async () => {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  return Buffer.from(await d.save());
};
const printed: string[] = [];
const app = await buildApp({ logger: false }, { printPdf: async (url) => (printed.push(url), url.includes("BROKEN") ? null : onePage()) });
const ORIGIN = "http://localhost:3000";
const tag = `dash${Date.now()}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Dash", phone: "+380500000006", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`, org: reg.json().organizations[0].id as string, user: reg.json().id as string };
}

test("dashboard: period numbers from real orders, «Що треба зробити», snooze, goal, tips only with data", async () => {
  const { cookie, org } = await register("a");
  const get = async (q = "") => (await app.inject({ url: `/api/dashboard${q}`, headers: { cookie } })).json();
  const empty = await get();
  assert.equal(empty.period, "7");
  assert.deepEqual(empty.sales.cur, { revenueKop: 0, orders: 0, cancelled: 0 });
  assert.equal(empty.sales.series.length, 7);
  assert.deepEqual(empty.todo, [], "no data -> nothing to do");
  assert.deepEqual(empty.tips, []);
  assert.equal(empty.traffic, null, "no analytics module -> no visits");

  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S", lastUp: false }).returning();
  await db.insert(products).values({ organizationId: org, siteId: site!.id, name: "Мед", priceKop: 25000, stock: 1 });
  const base = { organizationId: org, siteId: site!.id, customerName: "A", customerPhone: "+380", items: [], payment: "cod" };
  await db.insert(orders).values([
    { ...base, totalKop: 50000, delivery: { method: "pickup" } },
    { ...base, totalKop: 10000, delivery: { method: "pickup" }, createdAt: new Date(Date.now() - 3 * HOUR) },
    { ...base, totalKop: 20000, delivery: { method: "novaposhta" }, status: "confirmed" },
    { ...base, totalKop: 99900, delivery: { method: "pickup" }, status: "cancelled" },
    { ...base, totalKop: 30000, delivery: { method: "pickup" }, status: "done", createdAt: new Date(Date.now() - 10 * DAY) },
  ]);

  const d = await get("?period=7");
  assert.equal(d.sales.cur.orders, 3, "cancelled orders are not sales");
  assert.equal(d.sales.cur.cancelled, 1);
  assert.equal(d.sales.prev.revenueKop, 30000, "the order 10 days ago is in the previous 7 days");
  assert.equal(d.sales.series.reduce((s: number, x: { orders: number }) => s + x.orders, 0), 3);
  const keys = d.todo.map((i: { key: string }) => i.key);
  assert.deepEqual(keys, ["newOrdersUrgent", "noWaybill", "siteDown", "lowStock"], "money first");
  assert.deepEqual(d.todo[0].params, { n: 2, urgent: 1 });
  assert.equal(d.todo[1].tab, "nowaybill");
  assert.equal(d.ship.list.length, 1);
  assert.equal(d.ship.printable, 0);

  const noWb = (await app.inject({ url: "/api/shop/orders?status=nowaybill", headers: { cookie } })).json();
  assert.equal(noWb.length, 1, "the filtered list the item leads to");

  await app.inject({ method: "POST", url: "/api/dashboard/insights/dismiss", payload: { id: d.todo[0].id, days: 1 }, headers: { cookie, origin: ORIGIN } });
  assert.ok(!(await get()).todo.some((i: { key: string }) => i.key === "newOrdersUrgent"), "«Нагадати завтра»");
  await db.insert(orders).values({ ...base, totalKop: 1000, delivery: { method: "pickup" } });
  assert.ok((await get()).todo.some((i: { key: string }) => i.key === "newOrdersUrgent"), "a new order brings it back");

  // "Today" is the Kyiv calendar day: shortly after midnight the order from 3 hours ago is yesterday's.
  const kyivDay = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const today = await get("?period=today");
  assert.equal(today.sales.cur.orders, kyivDay(Date.now() - 3 * HOUR) === kyivDay(Date.now()) ? 4 : 3);

  assert.equal(d.goal.goalKop, null);
  const g = await app.inject({ method: "PATCH", url: "/api/dashboard/goal", payload: { goalUah: 50000 }, headers: { cookie, origin: ORIGIN } });
  assert.equal(g.statusCode, 200);
  assert.equal((await get()).goal.goalKop, 5_000_000);

  // Analytics tips: previous week 100 visits / 10 orders, this week 100 visits / 4 orders.
  await startTrial(org);
  await installModule(org, "analytics");
  const ev = (days: number, i: number, type: string) => ({ organizationId: org, siteId: site!.id, type, session: `s${days > 7 ? "p" : "c"}${i}`.padEnd(20, "x"), channel: "google", createdAt: new Date(Date.now() - days * DAY) });
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(ev(10, i, "pageview"), ev(3, i, "pageview"));
  for (let i = 0; i < 10; i++) rows.push(ev(10, i, "order"));
  for (let i = 0; i < 4; i++) rows.push(ev(3, i, "order"));
  await db.insert(analyticsEvents).values(rows);
  const a = await get();
  assert.equal(a.traffic.cur.sessions, 100);
  assert.equal(a.traffic.prev.sessions, 100);
  assert.equal(a.tips[0].key, "conversionDrop");
  await db.delete(sites).where(eq(sites.id, site!.id));
});

test("dashboard: «Перші кроки» from real data, +7 days once", async () => {
  const { cookie, org, user } = await register("b");
  const get = async () => (await app.inject({ url: "/api/dashboard", headers: { cookie } })).json();
  assert.deepEqual((await get()).steps, { site: false, okjs: false, products: false, subscription: false, twofa: false, telegram: false });
  const claim = () => app.inject({ method: "POST", url: "/api/dashboard/first-steps/claim", headers: { cookie, origin: ORIGIN } });
  assert.equal((await claim()).json().error, "not_done");

  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}b.shop.com.ua`, name: "S" }).returning();
  // ok.js calls the public API with the site key.
  await app.inject({ url: `/api/public/products?key=${site!.publicKey}` });
  await db.insert(products).values({ organizationId: org, siteId: site!.id, name: "Мед", priceKop: 100 });
  await startTrial(org);
  assert.equal((await get()).steps.subscription, false, "the free trial is not a started subscription");
  await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.organizationId, org));
  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, user));
  await db.insert(telegramLinks).values({ userId: user, chatId: `${Date.now()}` });
  assert.deepEqual((await get()).steps, { site: true, okjs: true, products: true, subscription: true, twofa: true, telegram: true });

  const [before] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org));
  const r = await claim();
  assert.equal(r.statusCode, 200);
  const [afterSub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org));
  assert.equal(afterSub!.periodEnd.getTime() - before!.periodEnd.getTime(), 7 * DAY, "the renewal moves 7 days later");
  assert.equal((await claim()).json().error, "already");
  assert.equal((await get()).steps, null, "the block is gone after the reward");
  const [o] = await db.select().from(organizations).where(eq(organizations.id, org));
  assert.ok(o!.firstStepsRewardAt);
  await db.delete(sites).where(eq(sites.id, site!.id));
});

test("«Надрукувати всі ТТН»: one merged PDF, failed orders reported", async () => {
  const { cookie, org } = await register("c");
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}c.shop.com.ua`, name: "S" }).returning();
  const none = await app.inject({ url: "/api/integrations/print-ready", headers: { cookie } });
  assert.equal(none.statusCode, 404);
  await db.insert(integrations).values({ organizationId: org, provider: "novaposhta", status: "connected", credentialsEnc: encrypt(JSON.stringify({ apiKey: "k".repeat(32), sender: {} })), settings: {} });
  const base = { organizationId: org, siteId: site!.id, customerName: "A", customerPhone: "+380", items: [], totalKop: 100, payment: "cod", delivery: { method: "novaposhta" } };
  const [, broken] = await db
    .insert(orders)
    .values([
      { ...base, status: "confirmed" as const, waybill: "20450000000001", waybillRef: "REF1" },
      { ...base, status: "paid" as const, waybill: "20450000000002", waybillRef: "BROKEN" },
      { ...base, status: "paid" as const, waybill: "20450000000003", waybillRef: "REF3" },
      { ...base, status: "shipped" as const, waybill: "20450000000004", waybillRef: "REF4" },
    ])
    .returning();
  printed.length = 0;
  const r = await app.inject({ url: "/api/integrations/print-ready?kind=marking", headers: { cookie } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "application/pdf");
  assert.equal((await PDFDocument.load(r.rawPayload)).getPageCount(), 2, "two documents merged, the shipped one skipped");
  assert.equal(r.headers["x-failed-orders"], String(broken!.number));
  assert.ok(printed.every((u) => u.includes("printMarking100x100")));
  await db.delete(sites).where(eq(sites.id, site!.id));
});
