import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { ledgerEntries, notifications, subscriptions, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `ref${Date.now()}`;
const DAY = 86_400_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string, ref?: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Реф ${n} Прізвище`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough", ...(ref ? { ref } : {}) }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string, id: r.json().id as string };
}

test("referrals: a link, a month for both after the invited business pays for the first time, once", async () => {
  const a = await register("a", "+380500000019");
  const mine = (await app.inject({ url: "/api/referrals", headers: { cookie: a.cookie } })).json();
  assert.match(mine.code, /^[A-Z0-9]{8}$/);
  assert.equal((await app.inject({ url: "/api/referrals", headers: { cookie: a.cookie } })).json().code, mine.code, "the same code every time");

  const b = await register("b", "+380500000020", mine.code.toLowerCase());
  const [bu] = await db.select().from(users).where(eq(users.id, b.id));
  assert.equal(bu!.referredBy, a.id);
  let list = (await app.inject({ url: "/api/referrals", headers: { cookie: a.cookie } })).json();
  assert.deepEqual(list.invited.map((x: { name: string; rewarded: boolean }) => [x.name, x.rewarded]), [["Реф", false]], "only the first name");

  // A trial is not a payment: nothing yet.
  await app.inject({ method: "POST", url: "/api/billing/trial", headers: { cookie: b.cookie, origin: ORIGIN } });
  assert.equal((await app.inject({ url: "/api/referrals", headers: { cookie: a.cookie } })).json().months, 0);
  // The invited business pays for a year.
  await db.insert(ledgerEntries).values({ organizationId: b.org, kind: "topup", amountKop: 149000, reason: "test" });
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/year", headers: { cookie: b.cookie, origin: ORIGIN } })).statusCode, 200);
  list = (await app.inject({ url: "/api/referrals", headers: { cookie: a.cookie } })).json();
  assert.equal(list.months, 1);
  const [subA] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, a.org));
  const days = (subA!.coveredUntil!.getTime() - Date.now()) / DAY;
  assert.ok(days > 27 && days < 32, "the inviter got a month");
  const [subB] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, b.org));
  assert.ok(subB!.coveredUntil!.getTime() - subB!.trialEndsAt!.getTime() > 390 * DAY, "the invited one: the year plus a month");
  const rewards = await db.select().from(notifications).where(and(eq(notifications.key, "referralReward"), eq(notifications.organizationId, b.org)));
  assert.equal(rewards.length, 1);
  // Paying again gives nothing more.
  await db.insert(ledgerEntries).values({ organizationId: b.org, kind: "topup", amountKop: 149000, reason: "test" });
  await app.inject({ method: "POST", url: "/api/billing/year", headers: { cookie: b.cookie, origin: ORIGIN } });
  assert.equal((await app.inject({ url: "/api/referrals", headers: { cookie: a.cookie } })).json().months, 1);
});

test("one free trial per phone number", async () => {
  const x = await register("x", "+380500000021");
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/trial", headers: { cookie: x.cookie, origin: ORIGIN } })).statusCode, 200);
  const y = await register("y", "050 000 00 21");
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/trial", headers: { cookie: y.cookie, origin: ORIGIN } })).json().error, "trial_used", "the same phone written differently");
});
