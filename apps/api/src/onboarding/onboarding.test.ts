import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { notifications, orders, products, sites, subscriptions } from "../db/schema.ts";
import { runBilling } from "../billing/service.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `onb${Date.now()}`;
const DAY = 86_400_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Onb ${n}`, phone: `+3805000001${{ a: 1, b: 2, c: 3 }[n] ?? 9}1`, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string };
}
const H = (cookie: string) => ({ cookie, origin: ORIGIN });
const answers = { hasSite: false, sells: ["handmade"], delivery: ["novaposhta"], channels: ["instagram", "prom"] };

test("first login: questions once, examples that count nowhere and go with the first real order", async () => {
  const u = await register("a");
  const me = async () => (await app.inject({ url: "/api/auth/me", headers: { cookie: u.cookie } })).json();
  assert.equal((await me()).onboarded, false);
  const post = (body: object) => app.inject({ method: "POST", url: "/api/onboarding", payload: body, headers: H(u.cookie) });
  assert.equal((await post({ ...answers, sells: ["other"] })).statusCode, 400, "«Інше» needs the text");
  assert.equal((await post(answers)).statusCode, 200);
  assert.equal((await me()).onboarded, true);
  assert.equal((await post(answers)).statusCode, 409, "answered once");

  const list = (await app.inject({ url: "/api/shop/orders", headers: { cookie: u.cookie } })).json();
  assert.equal(list.length, 3);
  assert.ok(list.every((o: { isExample: boolean }) => o.isExample));
  const dash = (await app.inject({ url: "/api/dashboard", headers: { cookie: u.cookie } })).json();
  assert.equal(dash.sales.cur.orders, 0, "examples are not sales");
  assert.deepEqual(dash.todo, [], "nothing to do because of examples");
  assert.equal(dash.ship.list.length, 0);
  assert.deepEqual((await app.inject({ url: "/api/shop/search?q=Приклад", headers: { cookie: u.cookie } })).json().orders, []);

  // A real order from the website: the examples are gone.
  const [site] = await db.insert(sites).values({ organizationId: u.org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const [p] = await db.insert(products).values({ organizationId: u.org, siteId: site!.id, name: "Мед", priceKop: 100 }).returning();
  const placed = await app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Справжня", phone: "+380671112233" }, items: [{ productId: p!.id, qty: 1 }], delivery: { method: "pickup" }, payment: "cod" }, headers: { "x-site-key": site!.publicKey } });
  assert.equal(placed.statusCode, 201);
  const after = (await app.inject({ url: "/api/shop/orders", headers: { cookie: u.cookie } })).json();
  assert.deepEqual(after.map((o: { customerName: string }) => o.customerName), ["Справжня"]);
  await db.delete(sites).where(eq(sites.id, site!.id));
});

test("«Прибрати приклад»", async () => {
  const u = await register("b");
  await app.inject({ method: "POST", url: "/api/onboarding", payload: answers, headers: H(u.cookie) });
  assert.equal((await app.inject({ method: "DELETE", url: "/api/onboarding/examples", headers: H(u.cookie) })).statusCode, 200);
  const [n] = await db.select().from(orders).where(eq(orders.organizationId, u.org));
  assert.equal(n, undefined);
});

test("«Почати пробний період»: 30 days once, free modules, reminders 3 and 1 day before, once each", async () => {
  const u = await register("c");
  const start = () => app.inject({ method: "POST", url: "/api/billing/trial", headers: H(u.cookie) });
  assert.equal((await start()).statusCode, 200, "without the questions the trial is started by the button");
  assert.equal((await start()).statusCode, 409, "only once");
  const me = (await app.inject({ url: "/api/auth/me", headers: { cookie: u.cookie } })).json();
  assert.equal(me.subscription.status, "trial");
  const days = (new Date(me.subscription.periodEnd).getTime() - Date.now()) / DAY;
  assert.ok(days > 29.9 && days <= 30);
  const mod = await app.inject({ method: "POST", url: "/api/billing/modules/analytics", headers: H(u.cookie) });
  assert.equal(mod.json().free, true, "a paid module is free during the trial");

  const reminders = async () => (await db.select().from(notifications).where(and(eq(notifications.organizationId, u.org), eq(notifications.key, "trialEnding")))).map((n) => (n.params as { days: number }).days);
  await db.update(subscriptions).set({ periodEnd: new Date(Date.now() + 2.5 * DAY) }).where(eq(subscriptions.organizationId, u.org));
  await runBilling();
  await runBilling();
  assert.deepEqual(await reminders(), [3]);
  await db.update(subscriptions).set({ periodEnd: new Date(Date.now() + 0.5 * DAY) }).where(eq(subscriptions.organizationId, u.org));
  await runBilling();
  await runBilling();
  assert.deepEqual((await reminders()).sort(), [1, 3]);
});
