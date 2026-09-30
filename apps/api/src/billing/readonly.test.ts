import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { notifications, products, sites, subscriptions, users } from "../db/schema.ts";
import { runBilling } from "./service.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `ro${Date.now()}`;
const DAY = 86_400_000;
const answers = { hasSite: false, sells: ["handmade"], delivery: ["novaposhta"], channels: ["none"] };

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `RO ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
  return { cookie, H: { cookie, origin: ORIGIN }, org: r.json().organizations[0].id as string };
}
const manual = (H: Record<string, string>) => app.inject({ method: "POST", url: "/api/shop/orders", payload: { customer: { name: "Покупець", phone: "+380931110020" }, items: [{ name: "Листівка", price: 20, qty: 1 }], delivery: { method: "pickup" }, payment: "cod", source: "call" }, headers: H });

test("the trial starts by itself after the questions; suspended = read only, the website keeps selling; warnings before deletion", async () => {
  const a = await register("a", "+380500000023");
  const o = await app.inject({ method: "POST", url: "/api/onboarding", payload: answers, headers: a.H });
  assert.ok(o.json().trialUntil, "the trial started by itself");
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, a.org));
  assert.equal(sub!.status, "trial");
  assert.equal((await manual(a.H)).statusCode, 201, "works during the trial");

  await db.update(subscriptions).set({ status: "suspended", suspendedAt: new Date() }).where(eq(subscriptions.organizationId, a.org));
  const blocked = await manual(a.H);
  assert.deepEqual([blocked.statusCode, blocked.json().error], [402, "read_only"]);
  assert.equal((await app.inject({ url: "/api/shop/orders", headers: { cookie: a.cookie } })).statusCode, 200, "reading still works");
  assert.notEqual((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: "NOPE-NOPE" }, headers: a.H })).statusCode, 402, "billing stays open to pay");
  // The website keeps taking orders.
  const [site] = await db.insert(sites).values({ organizationId: a.org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const [p] = await db.insert(products).values({ organizationId: a.org, siteId: site!.id, name: "Мед", priceKop: 100 }).returning();
  const pub = await app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Сайт", phone: "+380671112233" }, items: [{ productId: p!.id, qty: 1 }], delivery: { method: "pickup" }, payment: "cod" }, headers: { "x-site-key": site!.publicKey } });
  assert.equal(pub.statusCode, 201);

  // Deletion warnings: 30, 7 and 1 day before the 90 days, each once.
  const warnings = async () => (await db.select().from(notifications).where(and(eq(notifications.organizationId, a.org), eq(notifications.key, "dataDeletionSoon")))).map((n) => (n.params as { days: number }).days).sort((x, y) => x - y);
  await db.update(subscriptions).set({ suspendedAt: new Date(Date.now() - 61 * DAY) }).where(eq(subscriptions.organizationId, a.org));
  await runBilling();
  await runBilling();
  assert.deepEqual(await warnings(), [29]);
  await db.update(subscriptions).set({ suspendedAt: new Date(Date.now() - 84 * DAY) }).where(eq(subscriptions.organizationId, a.org));
  await runBilling();
  assert.deepEqual(await warnings(), [6, 29]);
  await db.delete(sites).where(eq(sites.id, site!.id));

  // The same phone in another business: no second trial, so read only until it subscribes.
  const b = await register("b", "050 000 00 23");
  const ob = await app.inject({ method: "POST", url: "/api/onboarding", payload: answers, headers: b.H });
  assert.equal(ob.json().trialUntil, null);
  assert.equal((await manual(b.H)).statusCode, 402);
});

test("«Видалити дані»: the admin deletes a business suspended for 90+ days; the account stays", async () => {
  const admin = await register("adm", "+380500000024");
  const me = (await app.inject({ url: "/api/auth/me", headers: { cookie: admin.cookie } })).json();
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, me.id));
  const c = await register("c", "+380500000025");
  await app.inject({ method: "POST", url: "/api/onboarding", payload: answers, headers: c.H });
  await manual(c.H);
  const purge = () => app.inject({ method: "POST", url: `/api/admin/organizations/${c.org}/purge`, headers: admin.H });
  assert.equal((await purge()).json().error, "not_deletable", "not while it is paid or on trial");
  await db.update(subscriptions).set({ status: "suspended", suspendedAt: new Date(Date.now() - 91 * DAY) }).where(eq(subscriptions.organizationId, c.org));
  const list = (await app.inject({ url: "/api/admin/organizations", headers: { cookie: admin.cookie } })).json();
  assert.equal(list.find((o: { id: string }) => o.id === c.org).deletable, true);
  assert.equal((await purge()).statusCode, 200);
  assert.deepEqual((await app.inject({ url: "/api/shop/orders", headers: { cookie: c.cookie } })).json(), [], "orders are gone");
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: c.cookie } })).statusCode, 200, "the person can still sign in");
  assert.equal((await manual(c.H)).statusCode, 402, "nothing new until they subscribe");
});
