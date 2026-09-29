import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { accessKeys, ledgerEntries, promoCodes, subscriptions, users } from "../db/schema.ts";
import { addMonths, balanceKop, settle } from "./service.ts";
import { keyHash, newKeyCode, normalizeCode } from "./keys.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `promo${Date.now()}`;
const batches: string[] = [];
const promos: string[] = [];
after(async () => {
  if (batches.length) await db.delete(accessKeys).where(inArray(accessKeys.batch, batches));
  if (promos.length) await db.delete(promoCodes).where(inArray(promoCodes.id, promos));
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function account(n: string, admin = false) {
  const email = `${tag}-${n}@test.oneknight.local`;
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: n, phone: "+380500000011", email, password: "long enough" }, headers: { origin: ORIGIN } });
  if (admin) await db.update(users).set({ isAdmin: true }).where(eq(users.email, email));
  return { H: { cookie: `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`, origin: ORIGIN }, org: reg.json().organizations[0].id as string };
}

test("promo codes: percent discount on renewals, bonus to balance, one use per business, limits", async () => {
  const admin = await account("padmin", true);
  const a = await account("pa");
  const b = await account("pb");
  const code = `T${Date.now().toString(36).toUpperCase()}`;
  const pc = (await app.inject({ method: "POST", url: "/api/admin/promos", payload: { code: code.toLowerCase(), kind: "percent", value: 50, months: 1, maxUses: 1 }, headers: admin.H })).json();
  promos.push(pc.id);
  assert.equal(pc.code, code);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/promos", payload: { code, kind: "bonus", value: 10 }, headers: admin.H })).json().error, "code_taken");
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/promos", payload: { code: "X" + code, kind: "percent", value: 150 }, headers: admin.H })).statusCode, 400);

  // a: active subscription due now, balance 100 UAH: 149 would not renew, 74.50 with the discount does.
  await db.insert(subscriptions).values({ organizationId: a.org, status: "active", periodEnd: new Date(Date.now() + 86_400_000) });
  await db.insert(ledgerEntries).values({ organizationId: a.org, kind: "adjustment", amountKop: 10_000, reason: "test" });
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code }, headers: a.H })).json().value, 50);
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code }, headers: a.H })).json().error, "already_used");
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code }, headers: b.H })).json().error, "expired", "max uses reached");
  const ov = (await app.inject({ url: "/api/billing", headers: { cookie: a.H.cookie } })).json();
  assert.deepEqual([ov.monthlyKop, ov.monthlyFullKop, ov.discount.percent], [7450, 14900, 50]);
  assert.equal(await settle(a.org, new Date(Date.now() + 2 * 86_400_000)), "renewed");
  assert.equal(await balanceKop(a.org), 10_000 - 7450);
  assert.equal((await app.inject({ url: "/api/billing", headers: { cookie: a.H.cookie } })).json().discount, null, "discount used up");

  const bonus = (await app.inject({ method: "POST", url: "/api/admin/promos", payload: { code: "B" + code, kind: "bonus", value: 200 }, headers: admin.H })).json();
  promos.push(bonus.id);
  await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: "b" + code }, headers: b.H });
  assert.equal(await balanceKop(b.org), 20_000);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/admin/promos/${bonus.id}`, headers: admin.H })).json().error, "promo_used");
  await app.inject({ method: "PATCH", url: `/api/admin/promos/${bonus.id}`, payload: { active: false }, headers: admin.H });
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: "B" + code }, headers: a.H })).json().error, "invalid_code");
});
