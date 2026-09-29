import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { analyticsEvents, orders, products, sites } from "../db/schema.ts";
import { installModule, startTrial } from "../billing/service.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `dash${Date.now()}`;
const DAY = 86_400_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("dashboard: KPIs from real orders, insights only with enough data, dismiss", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Dash", phone: "+380500000006", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const empty = (await app.inject({ url: "/api/dashboard", headers: { cookie } })).json();
  assert.equal(empty.orders.today, 0);
  assert.deepEqual(empty.insights, [], "no data -> no invented insights");

  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S", lastUp: false }).returning();
  await db.insert(products).values({ organizationId: org, siteId: site!.id, name: "Мед", priceKop: 25000, stock: 1 });
  await db.insert(orders).values([
    { organizationId: org, siteId: site!.id, customerName: "A", customerPhone: "+380", items: [], totalKop: 50000, delivery: { method: "pickup" }, payment: "cod" },
    { organizationId: org, siteId: site!.id, customerName: "B", customerPhone: "+380", items: [], totalKop: 30000, delivery: { method: "pickup" }, payment: "cod", createdAt: new Date(Date.now() - 2 * DAY) },
  ]);

  // Analytics: previous week 100 visits / 10 orders, this week 100 visits / 4 orders; Instagram 10 -> 40.
  await startTrial(org);
  await installModule(org, "analytics");
  const ev = (days: number, i: number, type: string, channel: string) => ({ organizationId: org, siteId: site!.id, type, session: `s${days > 7 ? "p" : "c"}${i}`.padEnd(20, "x"), channel, createdAt: new Date(Date.now() - days * DAY) });
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(ev(10, i, "pageview", i < 10 ? "instagram" : "google"));
  for (let i = 0; i < 10; i++) rows.push(ev(10, i, "order", "google"));
  for (let i = 0; i < 100; i++) rows.push(ev(3, i, "pageview", i < 40 ? "instagram" : "google"));
  for (let i = 0; i < 4; i++) rows.push(ev(3, i, "order", "google"));
  await db.insert(analyticsEvents).values(rows);

  const d = (await app.inject({ url: "/api/dashboard", headers: { cookie } })).json();
  assert.equal(d.orders.today, 1);
  assert.equal(d.orders.revenue30, 80000);
  assert.equal(d.traffic.visitors30, 200);
  const keys = d.insights.map((i: { key: string }) => i.key).sort();
  assert.deepEqual(keys, ["channelUp", "conversionDrop", "lowStock", "ordersWaiting", "siteDown"], "the 2-day-old new order is waiting");
  const drop = d.insights.find((i: { key: string }) => i.key === "conversionDrop");
  assert.equal(drop.params.v, 60);

  await app.inject({ method: "POST", url: "/api/dashboard/insights/dismiss", payload: { id: drop.id }, headers: { cookie, origin: ORIGIN } });
  const d2 = (await app.inject({ url: "/api/dashboard", headers: { cookie } })).json();
  assert.ok(!d2.insights.some((i: { key: string }) => i.key === "conversionDrop"), "dismissed for a week");
  await db.delete(sites).where(eq(sites.id, site!.id));
});
