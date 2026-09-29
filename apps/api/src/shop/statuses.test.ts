import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { orders, products, sites } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `stat${Date.now()}`;
const HOUR = 3_600_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Stat ${n}`, phone: "+380500000012", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string };
}
const H = (cookie: string) => ({ cookie, origin: ORIGIN });

test("own statuses inside groups, numbering per business, payment apart, returns restock, urgency from settings", async () => {
  const a = await register("a");
  const b = await register("b");
  const [site] = await db.insert(sites).values({ organizationId: a.org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const [p] = await db.insert(products).values({ organizationId: a.org, siteId: site!.id, name: "Мед", priceKop: 10000, stock: 5 }).returning();
  const place = () => app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Покупець", phone: "+380671112233" }, items: [{ productId: p!.id, qty: 1 }], delivery: { method: "pickup" }, payment: "cod" }, headers: { "x-site-key": site!.publicKey } });
  assert.equal((await place()).json().number, 1001, "the website sees the business's own number");
  await place();
  await db.insert(orders).values({ organizationId: b.org, customerName: "B", customerPhone: "+380", items: [], totalKop: 1, payment: "cod", delivery: { method: "pickup" } });
  const [first, second] = await db.select().from(orders).where(eq(orders.organizationId, a.org)).orderBy(orders.number);
  const [other] = await db.select().from(orders).where(eq(orders.organizationId, b.org));
  assert.deepEqual([first!.number, second!.number, other!.number], [1001, 1002, 1001], "each business counts from 1001");

  // Own status «Чекає оплати» inside «В роботі».
  const created = await app.inject({ method: "POST", url: "/api/shop/settings/statuses", payload: { name: "Чекає оплати", group: "confirmed" }, headers: H(a.cookie) });
  assert.equal(created.statusCode, 201);
  const sid = created.json().id;
  const patch = (id: string, body: object) => app.inject({ method: "PATCH", url: `/api/shop/orders/${id}`, payload: body, headers: H(a.cookie) });
  assert.equal((await patch(first!.id, { statusId: sid })).statusCode, 200);
  const d1 = (await app.inject({ url: `/api/shop/orders/${first!.id}`, headers: { cookie: a.cookie } })).json();
  assert.equal(d1.status, "confirmed", "the group follows the own status");
  assert.equal(d1.statusId, sid);
  assert.equal(d1.events.at(-1).data.name, "Чекає оплати");
  const bStatus = await app.inject({ method: "PATCH", url: `/api/shop/orders/${first!.id}`, payload: { statusId: sid }, headers: H(b.cookie) });
  assert.equal(bStatus.statusCode, 404, "another business cannot touch the order");
  await app.inject({ method: "DELETE", url: `/api/shop/settings/statuses/${sid}`, headers: H(a.cookie) });
  const [afterDelete] = await db.select().from(orders).where(eq(orders.id, first!.id));
  assert.equal(afterDelete!.statusId, null);
  assert.equal(afterDelete!.status, "confirmed", "the group stays");

  // Payment apart from the status.
  assert.equal((await patch(first!.id, { payment: { status: "prepaid", prepaidKop: 10000 } })).json().error, "invalid_prepaid", "a prepayment is less than the sum");
  assert.equal((await patch(first!.id, { payment: { status: "paid" } })).statusCode, 200);
  const [paid] = await db.select().from(orders).where(eq(orders.id, first!.id));
  assert.deepEqual([paid!.status, paid!.paymentStatus], ["confirmed", "paid"]);

  // A return puts the item back in stock.
  const stock = async () => (await db.select().from(products).where(eq(products.id, p!.id)))[0]!.stock;
  assert.equal(await stock(), 3);
  await patch(first!.id, { status: "shipped" });
  await patch(first!.id, { status: "returned" });
  assert.equal(await stock(), 4);

  // Urgency: 1 hour instead of 2.
  await db.update(orders).set({ createdAt: new Date(Date.now() - 1.5 * HOUR) }).where(eq(orders.id, second!.id));
  const urgent = async () => (await app.inject({ url: "/api/dashboard", headers: { cookie: a.cookie } })).json().todo.find((t: { key: string }) => t.key.startsWith("newOrders")).key;
  assert.equal(await urgent(), "newOrders");
  assert.equal((await app.inject({ method: "PUT", url: "/api/shop/settings", payload: { reasons: ["Не підійшов розмір"], sources: ["Ярмарок"], urgentHours: 1 }, headers: H(a.cookie) })).statusCode, 200);
  assert.equal(await urgent(), "newOrdersUrgent");
  const s = (await app.inject({ url: "/api/shop/settings", headers: { cookie: a.cookie } })).json();
  assert.deepEqual([s.reasons, s.sources, s.urgentHours, s.canEdit], [["Не підійшов розмір"], ["Ярмарок"], 1, true]);
  await db.delete(sites).where(eq(sites.id, site!.id));
});
