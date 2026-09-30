import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { memberships, sites, webhookDeliveries, webhookEndpoints, webhookEvents } from "../db/schema.ts";
import { deliverDue, dispatchEvents, type Sender } from "../webhooks/service.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `v1api${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Api ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string, user: r.json().id as string };
}

test("secret server key: owner only, shown once, never from a browser, the old one works 24 hours, revocable", async () => {
  const o = await register("o", "+380500000081");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const [site] = await db.insert(sites).values({ organizationId: o.org, domain: `${tag}.shop.com.ua`, name: "S", verifiedAt: new Date() }).returning();
  await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Ліжник «Черемош»", price: 4200, stock: 3 }, headers: H });
  const v1 = (url: string, key?: string, extra: Record<string, string> = {}) => app.inject({ url: `/api/v1${url}`, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra } });

  assert.equal((await v1("/site")).json().error, "invalid_secret_key");
  const created = await app.inject({ method: "POST", url: `/api/sites/${site!.id}/secret-key`, headers: H });
  const key = created.json().key as string;
  assert.match(key, /^ok_sec_[A-Za-z0-9_-]{43}$/);
  const info = (await app.inject({ url: `/api/sites/${site!.id}/api`, headers: { cookie: o.cookie } })).json();
  assert.equal(info.secretKey.hint, `${key.slice(0, 11)}…${key.slice(-4)}`, "only a hint is shown later");
  assert.ok(!JSON.stringify(info).includes(key));

  const me = (await v1("/site", key)).json();
  assert.deepEqual([me.id, me.domain, me.business, me.verified], [site!.id, `${tag}.shop.com.ua`, "Api o", true]);
  assert.equal((await v1("/site", key, { origin: "https://evil.example.com" })).json().error, "secret_key_in_browser", "a browser never uses the secret key");
  assert.equal((await v1("/site", key, { "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" })).json().error, "secret_key_in_browser", "not even from a same-origin page");
  assert.equal((await v1("/site", key, { "sec-fetch-mode": "cors" })).statusCode, 200, "Node's own fetch (Sec-Fetch-Mode only) is a server");
  const products = (await v1("/products", key)).json();
  assert.deepEqual([products.length, products[0].name, products[0].price], [1, "Ліжник «Черемош»", 4200]);
  assert.equal((await v1(`/products/${products[0].id}`, key)).json().name, "Ліжник «Черемош»");
  assert.deepEqual((await v1("/categories", key)).json(), []);

  // An order from the site's server, then its page data by number.
  const ord = await app.inject({ method: "POST", url: "/api/v1/orders", headers: { authorization: `Bearer ${key}` }, payload: { customer: { name: "Олена Коваль", phone: "+380671112233" }, items: [{ productId: products[0].id, qty: 1 }], delivery: { method: "novaposhta", city: "Львів", branch: "5" }, payment: "cod", customerIp: "203.0.113.50" } });
  assert.equal(ord.statusCode, 201);
  const page = (await v1(`/orders/${ord.json().number}`, key)).json();
  assert.deepEqual([page.status, page.total, page.items[0].name, page.history[0].status], ["new", 4200, "Ліжник «Черемош»", "new"]);

  // A member with the «Сайт» right cannot make keys.
  const m = await register("m", "+380500000082");
  await db.insert(memberships).values({ userId: m.user, organizationId: o.org, role: "manager", permissions: ["site"] });
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/org", headers: { cookie: m.cookie, origin: ORIGIN }, payload: { orgId: o.org } })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/sites/${site!.id}/api`, headers: { cookie: m.cookie } })).statusCode, 200, "the member sees the page");
  const other = await app.inject({ method: "POST", url: `/api/sites/${site!.id}/secret-key`, headers: { cookie: m.cookie, origin: ORIGIN } });
  assert.equal(other.json().error, "owner_only");

  // Replace: the old key works 24 hours, then not.
  const key2 = (await app.inject({ method: "POST", url: `/api/sites/${site!.id}/secret-key`, headers: H })).json().key as string;
  assert.equal((await v1("/site", key)).statusCode, 200, "the previous key still works");
  assert.equal((await v1("/site", key2)).statusCode, 200);
  await db.update(sites).set({ prevSecretExpiresAt: new Date(Date.now() - 1000) }).where(eq(sites.id, site!.id));
  assert.equal((await v1("/site", key)).statusCode, 401, "24 hours later the old key is gone");
  await app.inject({ method: "DELETE", url: `/api/sites/${site!.id}/secret-key`, headers: H });
  assert.equal((await v1("/site", key2)).statusCode, 401, "revoked at once");
});

test("webhooks: triggers catch every change, signed deliveries, retries, switching off after failures", async () => {
  const o = await register("w", "+380500000083");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const [site] = await db.insert(sites).values({ organizationId: o.org, domain: `${tag}w.shop.com.ua`, name: "S" }).returning();
  const add = await app.inject({ method: "POST", url: `/api/sites/${site!.id}/webhooks`, headers: H, payload: { url: "http://localhost:9/hooks/oneknight", events: ["order.created", "order.status_changed", "stock.changed"] } });
  assert.equal(add.statusCode, 201);
  const secret = add.json().secret as string;
  assert.match(secret, /^whsec_/);
  assert.equal((await app.inject({ method: "POST", url: `/api/sites/${site!.id}/webhooks`, headers: H, payload: { url: "ftp://x", events: ["order.created"] } })).statusCode, 400);
  for (let i = 0; i < 2; i++) await app.inject({ method: "POST", url: `/api/sites/${site!.id}/webhooks`, headers: H, payload: { url: `https://example.com/h${i}`, events: ["product.changed"] } });
  assert.equal((await app.inject({ method: "POST", url: `/api/sites/${site!.id}/webhooks`, headers: H, payload: { url: "https://example.com/h9", events: ["product.changed"] } })).json().error, "too_many_webhooks");
  const all = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.siteId, site!.id));
  for (const e of all.filter((x) => x.url.startsWith("https://example.com"))) await app.inject({ method: "DELETE", url: `/api/sites/${site!.id}/webhooks/${e.id}`, headers: H });
  const ep = all.find((x) => x.url.startsWith("http://localhost"))!;

  // Changes from the panel and from the site: a product (stock tracked), an order, a status change.
  const pid = (await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Подушка", price: 900, stock: 5 }, headers: H })).json().id as string;
  await app.inject({ method: "PATCH", url: `/api/shop/products/${pid}`, payload: { name: "Подушка 50×70" }, headers: H });
  const ord = await app.inject({ method: "POST", url: "/api/public/orders", headers: { "x-site-key": site!.publicKey, "user-agent": "Mozilla/5.0" }, payload: { customer: { name: "Ігор Бойко", phone: "+380931112233" }, items: [{ productId: pid, qty: 2 }], delivery: { method: "pickup" }, payment: "cod" } });
  assert.equal(ord.statusCode, 201);
  const [o1] = await db.select().from(webhookEvents).where(and(eq(webhookEvents.siteId, site!.id), eq(webhookEvents.type, "order.created")));
  assert.ok(o1, "the database trigger wrote the event");
  const orderId = (o1!.data as { orderId: string }).orderId;
  assert.equal((await app.inject({ method: "PATCH", url: `/api/shop/orders/${orderId}`, payload: { status: "confirmed" }, headers: H })).statusCode, 200);
  await dispatchEvents({ orgIds: [o.org] });
  const pending = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.id));
  assert.deepEqual(pending.map((d) => d.type).sort(), ["order.created", "order.status_changed", "stock.changed"], "only the subscribed events; the name change (product.changed) is not");

  // Delivery: signed with the secret, the site checks the HMAC over "t.body".
  const got: { body: string; headers: Record<string, string> }[] = [];
  const okSender: Sender = async (_url, body, headers) => {
    got.push({ body, headers });
    return { status: 200, body: "ok" };
  };
  assert.equal(await deliverDue(okSender, new Date(), { orgIds: [o.org] }), 3);
  for (const g of got) {
    const [, t, v1] = g.headers["x-oneknight-signature"]!.match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
    assert.equal(createHmac("sha256", secret).update(`${t}.${g.body}`).digest("hex"), v1);
    assert.equal(JSON.parse(g.body).type, g.headers["x-oneknight-event"]);
  }
  const created = JSON.parse(got.find((g) => g.headers["x-oneknight-event"] === "order.created")!.body);
  assert.equal(created.data.number, ord.json().number);
  assert.ok((await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, ep.id))).every((d) => d.status === "ok"));

  // A failing site: retries at 1, 5, 30 min, 2 h, 12 h, then «не доставлено».
  await app.inject({ method: "PATCH", url: `/api/shop/products/${pid}`, payload: { stock: 9 }, headers: H });
  await dispatchEvents({ orgIds: [o.org] });
  const down: Sender = async () => ({ status: 500, body: "boom" });
  let now = new Date();
  await deliverDue(down, now, { orgIds: [o.org] });
  let [d] = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.endpointId, ep.id), eq(webhookDeliveries.status, "pending")));
  assert.deepEqual([d!.attempts, d!.lastStatus, Math.round((d!.nextAttemptAt.getTime() - now.getTime()) / 60_000)], [1, 500, 1]);
  for (const min of [1, 5, 30, 120, 720]) {
    now = new Date(now.getTime() + (min + 1) * 60_000);
    await deliverDue(down, now, { orgIds: [o.org] });
  }
  [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d!.id));
  assert.deepEqual([d!.status, d!.attempts], ["failed", 6]);
  const [epNow] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));
  assert.equal(epNow!.failures, 1);

  // «Надіслати ще раз» and the delivery log in the panel.
  assert.equal((await app.inject({ method: "POST", url: `/api/sites/${site!.id}/webhooks/${ep.id}/deliveries/${d!.id}/retry`, headers: H })).statusCode, 200);
  await deliverDue(okSender, new Date(), { orgIds: [o.org] });
  const log = (await app.inject({ url: `/api/sites/${site!.id}/webhooks/${ep.id}/deliveries`, headers: { cookie: o.cookie } })).json();
  assert.equal(log.find((x: { id: string }) => x.id === d!.id).status, "ok");
  assert.equal((await app.inject({ method: "POST", url: `/api/sites/${site!.id}/webhooks/${ep.id}/test`, headers: H })).json().ok, false, "nothing listens on localhost:9");

  // 20 deliveries failed for good in a row switch the endpoint off and tell the owner.
  await db.update(webhookEndpoints).set({ failures: 19 }).where(eq(webhookEndpoints.id, ep.id));
  await app.inject({ method: "PATCH", url: `/api/shop/products/${pid}`, payload: { stock: 8 }, headers: H });
  await dispatchEvents({ orgIds: [o.org] });
  now = new Date();
  for (const min of [0, 2, 6, 31, 121, 721]) await deliverDue(down, new Date(now.getTime() + min * 60_000 * 1.01 + min * 60_000), { orgIds: [o.org] });
  const [off] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));
  assert.deepEqual([off!.active, !!off!.disabledAt], [false, true]);
  const info = (await app.inject({ url: `/api/sites/${site!.id}/api`, headers: { cookie: o.cookie } })).json();
  assert.equal(info.webhooks[0].active, false);
  await app.inject({ method: "PATCH", url: `/api/sites/${site!.id}/webhooks/${ep.id}`, headers: H, payload: { active: true } });
  const [on] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, ep.id));
  assert.deepEqual([on!.active, on!.failures], [true, 0], "switching back on starts the count again");
});
