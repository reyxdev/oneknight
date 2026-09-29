import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { sites } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `shop${Date.now()}`;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Shop ${n}`, phone: "+380500000003", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string };
}

test("products, public catalogue, orders with server prices and stock, statuses", async () => {
  const a = await register("a");
  const b = await register("b");
  const [site] = await db.insert(sites).values({ organizationId: a.org, domain: `${tag}.shop.com.ua`, name: "Shop" }).returning();
  const key = site!.publicKey;
  const H = (cookie: string) => ({ cookie, origin: ORIGIN });

  const p1 = await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Хлібниця", price: 1100, stock: 2, photo: { data: PNG } }, headers: H(a.cookie) });
  assert.equal(p1.statusCode, 201);
  const prod = p1.json();
  assert.equal(prod.price, 1100);
  assert.equal((await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "x", price: 1 }, headers: H(b.cookie) })).statusCode, 404, "other org cannot add");
  const photo = await app.inject({ url: prod.photo });
  assert.equal(photo.statusCode, 200, "product photos are public");

  // Public catalogue
  assert.equal((await app.inject({ url: "/api/public/products", headers: { "x-site-key": "sk_" + "0".repeat(32) } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/public/products", headers: { "x-site-key": key, origin: "https://evil.example.com" } })).statusCode, 403);
  const cat = await app.inject({ url: "/api/public/products", headers: { "x-site-key": key, origin: `https://www.${tag}.shop.com.ua` } });
  assert.equal(cat.statusCode, 200);
  assert.equal(cat.headers["access-control-allow-origin"], `https://www.${tag}.shop.com.ua`);
  assert.equal(cat.json()[0].price, 1100);

  // Orders: the price in the request is ignored; stock is enforced
  const order = { customer: { name: "Олена", phone: "+380671234567" }, items: [{ productId: prod.id, qty: 2, price: 1 }], delivery: { method: "novaposhta", city: "Київ", branch: "12" }, payment: "cod" };
  const o1 = await app.inject({ method: "POST", url: "/api/public/orders", payload: order, headers: { "x-site-key": key, origin: `https://${tag}.shop.com.ua` } });
  assert.equal(o1.statusCode, 201);
  assert.equal(o1.json().total, 2200);
  const o2 = await app.inject({ method: "POST", url: "/api/public/orders", payload: { ...order, items: [{ productId: prod.id, qty: 1 }] }, headers: { "x-site-key": key } });
  assert.equal(o2.json().error, "out_of_stock");

  const list = (await app.inject({ url: "/api/shop/orders", headers: { cookie: a.cookie } })).json();
  assert.equal(list.length, 1);
  assert.equal((await app.inject({ url: "/api/shop/orders", headers: { cookie: b.cookie } })).json().length, 0);
  const id = list[0].id;
  assert.equal((await app.inject({ method: "PATCH", url: `/api/shop/orders/${id}`, payload: { status: "cancelled" }, headers: H(a.cookie) })).json().error, "reason_required", "cancelling needs a reason");
  assert.equal((await app.inject({ method: "PATCH", url: `/api/shop/orders/${id}`, payload: { status: "cancelled", reason: "out_of_stock" }, headers: H(a.cookie) })).statusCode, 200);
  const stockBack = (await app.inject({ url: `/api/shop/sites/${site!.id}/products`, headers: { cookie: a.cookie } })).json()[0].stock;
  assert.equal(stockBack, 2, "cancel returns items to stock");
  await app.inject({ method: "PATCH", url: `/api/shop/orders/${id}`, payload: { status: "confirmed", waybill: "20450000000000", warranty: { enabled: true, until: "2027-09-29", note: "12 місяців" } }, headers: H(a.cookie) });
  const detail = (await app.inject({ url: `/api/shop/orders/${id}`, headers: { cookie: a.cookie } })).json();
  assert.equal(detail.status, "confirmed");
  assert.equal(detail.waybill, "20450000000000");
  assert.equal(detail.warranty.enabled, true);
  assert.deepEqual(detail.events.map((e: { status: string }) => e.status), ["new", "cancelled", "confirmed"]);
  assert.ok(!("ip" in detail));
  const n = (await app.inject({ url: "/api/notifications", headers: { cookie: a.cookie } })).json();
  assert.equal(n[0].key, "newOrder");
  await db.delete(sites).where(eq(sites.id, site!.id));
});
