import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { ledgerEntries, notifications, orders, sites, subscriptions } from "../db/schema.ts";
import { runBilling } from "./service.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `sub${Date.now()}`;
const DAY = 86_400_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("«Почати підписку» from the balance, «Оплатити рік» with 2 months as a gift, extra websites, reminders", async () => {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Sub", phone: "+380500000018", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = r.json().organizations[0].id as string;
  const H = { cookie, origin: ORIGIN };
  const topUp = (uah: number) => db.insert(ledgerEntries).values({ organizationId: org, kind: "topup", amountKop: uah * 100, reason: "test" });
  const overview = async () => (await app.inject({ url: "/api/billing", headers: { cookie } })).json();
  const post = (path: string) => app.inject({ method: "POST", url: `/api/billing/${path}`, headers: H });

  assert.deepEqual((await post("subscribe")).json(), { ok: false, error: "insufficient_funds", needKop: 14900 });
  await topUp(500);
  const s = await post("subscribe");
  assert.equal(s.statusCode, 200);
  const o1 = await overview();
  assert.equal(o1.subscription.status, "active");
  assert.equal(o1.balanceKop, 35100, "the first month is charged at once (no free period without a website from us)");
  assert.equal((await post("subscribe")).json().error, "already_active");

  // A year ahead: 10 × 149.
  assert.equal(o1.yearKop, 149000);
  assert.deepEqual((await post("year")).json(), { ok: false, error: "insufficient_funds", needKop: 113900 });
  await topUp(1200);
  assert.equal((await post("year")).statusCode, 200);
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org));
  const months = (sub!.coveredUntil!.getTime() - sub!.periodEnd.getTime()) / DAY;
  assert.ok(months > 360 && months < 370, "the year starts after the month already paid");
  const o2 = await overview();
  assert.equal(o2.parts.baseKop, 0, "renewals within the year do not charge ONEKNIGHT");

  // Each website after the first: +149.
  await db.insert(sites).values([{ organizationId: org, domain: `${tag}a.shop.com.ua`, name: "A" }, { organizationId: org, domain: `${tag}b.shop.com.ua`, name: "B" }]);
  const o3 = await overview();
  assert.deepEqual([o3.parts.extraSites, o3.parts.sitesKop, o3.monthlyKop], [1, 14900, 14900]);

  // Reminder: renewal in 2 days, the balance (500 − 149 + 1200 − 1490 = 61 grn) does not cover 149.
  await db.update(subscriptions).set({ periodEnd: new Date(Date.now() + 2 * DAY) }).where(eq(subscriptions.organizationId, org));
  await runBilling();
  await runBilling();
  const reminders = await db.select().from(notifications).where(and(eq(notifications.organizationId, org), eq(notifications.key, "renewSoon")));
  assert.equal(reminders.length, 1);
  assert.equal((reminders[0]!.params as { amount: number }).amount, 88);

  // What ONEKNIGHT did for the business.
  await db.insert(orders).values([
    { organizationId: org, customerName: "A", customerPhone: "+380931110010", items: [], totalKop: 50000, payment: "cod", delivery: { method: "pickup" }, status: "done" },
    { organizationId: org, customerName: "B", customerPhone: "+380931110011", items: [], totalKop: 9900, payment: "cod", delivery: { method: "pickup" }, status: "cancelled" },
  ]);
  assert.deepEqual((await overview()).value, { orders: 1, kop: 50000 });
  await db.delete(sites).where(eq(sites.organizationId, org));
});
