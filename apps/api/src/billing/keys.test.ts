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
const tag = `keys${Date.now()}`;
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

test("key codes: readable alphabet, compared ignoring case and dashes", () => {
  const c = newKeyCode();
  assert.match(c, /^OK-[A-HJ-KMNP-Z2-9]{4}-[A-HJ-KMNP-Z2-9]{4}-[A-HJ-KMNP-Z2-9]{4}$/);
  assert.equal(keyHash(c), keyHash(` ${c.toLowerCase().replaceAll("-", " ")} `));
  assert.equal(normalizeCode("ok-ab12"), "OKAB12");
});

test("access keys: admin generates, client activates once, renewals skip what the key covers", async () => {
  const admin = await account("admin", true);
  const client = await account("client");
  const other = await account("other");

  assert.equal((await app.inject({ method: "POST", url: "/api/admin/keys", payload: { kind: "oneknight", months: 3, count: 2 }, headers: client.H })).statusCode, 403);
  const gen = await app.inject({ method: "POST", url: "/api/admin/keys", payload: { kind: "oneknight", months: 3, count: 2, note: "test" }, headers: admin.H });
  assert.equal(gen.statusCode, 201);
  const { batch, codes } = gen.json();
  batches.push(batch);
  assert.equal(codes.length, 2);
  const stored = await db.select().from(accessKeys).where(eq(accessKeys.batch, batch));
  assert.ok(stored.every((k) => !JSON.stringify(k).includes(codes[0]) && !JSON.stringify(k).includes(codes[1])), "codes not stored in clear");

  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: "OK-AAAA-BBBB-CCCC" }, headers: client.H })).json().error, "invalid_code");
  const r = (await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: codes[0].toLowerCase() }, headers: client.H })).json();
  assert.equal(r.type, "key");
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: codes[0] }, headers: other.H })).json().error, "already_used");

  // No subscription before: the key starts one; three monthly renewals cost nothing, the fourth charges ONEKNIGHT.
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, client.org));
  assert.equal(sub!.status, "active");
  let at = sub!.periodEnd;
  for (let i = 0; i < 2; i++) {
    assert.equal(await settle(client.org, at), "renewed");
    at = addMonths(at, 1);
  }
  assert.equal(await balanceKop(client.org), 0);
  assert.equal(await settle(client.org, at), "grace", "after the key, ONEKNIGHT is charged again");

  // Disabled and expired keys are refused.
  await app.inject({ method: "PATCH", url: `/api/admin/keys/${stored.find((k) => k.hint === codes[1].slice(-4))!.id}`, payload: { disabled: true }, headers: admin.H });
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: codes[1] }, headers: other.H })).json().error, "invalid_code");
  const exp = (await app.inject({ method: "POST", url: "/api/admin/keys", payload: { kind: "module", moduleId: "reviews", months: 1, count: 1, activateBefore: "2020-01-01" }, headers: admin.H })).json();
  batches.push(exp.batch);
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: exp.codes[0] }, headers: other.H })).json().error, "expired");

  // Module key: needs a subscription, installs the module as covered.
  const mod = (await app.inject({ method: "POST", url: "/api/admin/keys", payload: { kind: "module", moduleId: "reviews", months: 2, count: 1 }, headers: admin.H })).json();
  batches.push(mod.batch);
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: mod.codes[0] }, headers: other.H })).json().error, "subscription_required");
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/redeem", payload: { code: mod.codes[0] }, headers: client.H })).json().moduleId, "reviews");
  const ov = (await app.inject({ url: "/api/billing", headers: { cookie: client.H.cookie } })).json();
  assert.ok(ov.modules.find((m: { id: string; paidUntil: string }) => m.id === "reviews" && m.paidUntil));

  const list = (await app.inject({ url: "/api/admin/keys", headers: { cookie: admin.H.cookie } })).json();
  const b = list.find((x: { batch: string }) => x.batch === batch);
  assert.deepEqual([b.total, b.redeemed, b.disabled], [2, 1, 1]);
  const del = (await app.inject({ method: "DELETE", url: `/api/admin/keys/batch/${batch}`, headers: admin.H })).json();
  assert.deepEqual(del, { ok: true, deleted: 1, kept: 1 }, "activated keys are kept");
});

