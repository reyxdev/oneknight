import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { notifications, orders, sites } from "../db/schema.ts";
import { notificationText } from "../notify/bot.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `roles${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Roles ${n}`, phone: "+380500000009", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string, id: r.json().id as string };
}
const H = (cookie: string) => ({ cookie, origin: ORIGIN });

async function join(owner: { cookie: string }, role: string, permissions: string[], n: string) {
  const who = await register(n);
  const inv = await app.inject({ method: "POST", url: "/api/team/invites", payload: { role, permissions }, headers: H(owner.cookie) });
  assert.equal(inv.statusCode, 201);
  await app.inject({ method: "POST", url: "/api/team/accept", payload: { token: inv.json().token }, headers: H(who.cookie) });
  return who;
}

test("«Комплектувальник»: only orders waiting to be sent, only «Відправлено», never sums", async () => {
  const owner = await register("owner");
  const [site] = await db.insert(sites).values({ organizationId: owner.org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const base = { organizationId: owner.org, siteId: site!.id, customerName: "A", customerPhone: "+380", items: [{ productId: "x", name: "Мед", qty: 2, priceKop: 25000 }], totalKop: 50000, payment: "cod", delivery: { method: "novaposhta" } };
  const [fresh, confirmed, shipped] = await db
    .insert(orders)
    .values([{ ...base }, { ...base, status: "confirmed" as const }, { ...base, status: "shipped" as const }])
    .returning();
  await db.insert(notifications).values([
    { organizationId: owner.org, kind: "order", key: "newOrder", params: { n: fresh!.number, total: 500 } },
    { organizationId: owner.org, kind: "billing", key: "renewed", params: { amount: 149 } },
  ]);
  const packer = await join(owner, "packer", ["shipping"], "packer");
  const get = (url: string) => app.inject({ url, headers: { cookie: packer.cookie } });

  const list = (await get("/api/shop/orders")).json();
  assert.deepEqual(list.map((o: { id: string }) => o.id).sort(), [confirmed!.id, shipped!.id].sort(), "new orders are not his");
  assert.ok(list.every((o: { totalKop: unknown }) => o.totalKop === null), "no sums in the list");
  assert.equal((await get(`/api/shop/orders/${fresh!.id}`)).statusCode, 404);
  const detail = (await get(`/api/shop/orders/${confirmed!.id}`)).json();
  assert.equal(detail.totalKop, null);
  assert.equal(detail.items[0].priceKop, null);

  const patch = (id: string, payload: object) => app.inject({ method: "PATCH", url: `/api/shop/orders/${id}`, payload, headers: H(packer.cookie) });
  assert.equal((await patch(fresh!.id, { status: "shipped" })).statusCode, 404, "cannot touch a new order");
  assert.equal((await patch(confirmed!.id, { status: "cancelled" })).statusCode, 403, "cannot cancel");
  assert.equal((await patch(confirmed!.id, { status: "paid" })).statusCode, 403, "cannot mark as paid");
  assert.equal((await patch(confirmed!.id, { warranty: { enabled: true } })).statusCode, 403);
  assert.equal((await patch(confirmed!.id, { status: "shipped", waybill: "20450000000009" })).statusCode, 200);
  const [after] = await db.select().from(orders).where(eq(orders.id, confirmed!.id));
  assert.equal(after!.status, "shipped");
  assert.equal(after!.waybill, "20450000000009");
  assert.equal((await patch(confirmed!.id, { status: "confirmed" })).statusCode, 200, "«Скасувати» takes «Відправлено» back");
  assert.equal((await patch(confirmed!.id, { status: "shipped" })).statusCode, 200);

  const dash = (await get("/api/dashboard")).json();
  assert.equal(dash.sales, null, "no sales block");
  assert.equal(dash.goal, null);
  assert.ok(dash.ship, "«Відправити сьогодні» is there");
  assert.equal(dash.steps, null);

  const bell = (await get("/api/notifications")).json();
  assert.deepEqual(bell.map((n: { key: string }) => n.key), [], "order notifications need `orders`, billing needs `billing`");
});

test("without «Бачить фінанси» a manager sees orders but no money anywhere", async () => {
  const owner = await register("o2");
  const [site] = await db.insert(sites).values({ organizationId: owner.org, domain: `${tag}2.shop.com.ua`, name: "S" }).returning();
  const [o] = await db.insert(orders).values({ organizationId: owner.org, siteId: site!.id, customerName: "A", customerPhone: "+380", items: [{ productId: "x", name: "Мед", qty: 1, priceKop: 30000 }], totalKop: 30000, payment: "cod", delivery: { method: "pickup" } }).returning();
  await db.insert(notifications).values({ organizationId: owner.org, kind: "order", key: "newOrder", params: { n: o!.number, total: 300 } });
  const mgr = await join(owner, "manager", ["orders"], "mgr");
  const get = async (url: string, cookie = mgr.cookie) => (await app.inject({ url, headers: { cookie } })).json();

  assert.equal((await get("/api/shop/orders"))[0].totalKop, null);
  assert.equal((await get(`/api/shop/orders/${o!.id}`)).totalKop, null);
  const dash = await get("/api/dashboard");
  assert.equal(dash.sales.cur.orders, 1, "counts stay");
  assert.equal(dash.sales.cur.revenueKop, null);
  assert.ok(dash.sales.series.every((x: { revenueKop: unknown }) => x.revenueKop === null));
  assert.equal(dash.goal, null, "no goal without finance");
  const bell = await get("/api/notifications");
  assert.equal(bell[0].key, "newOrder");
  assert.equal(bell[0].params.total, undefined, "the bell has no sum");
  assert.equal(notificationText("newOrder", { n: 1041, total: 300 }, false), "🛒 Нове замовлення №1041");

  // The owner grants it: sums come back.
  await app.inject({ method: "PATCH", url: `/api/team/members/${mgr.id}`, payload: { permissions: ["orders", "finance"] }, headers: H(owner.cookie) });
  assert.equal((await get("/api/shop/orders"))[0].totalKop, 30000);
  assert.equal((await get("/api/dashboard")).sales.cur.revenueKop, 30000);
  assert.equal((await get("/api/notifications"))[0].params.total, 300);
});
