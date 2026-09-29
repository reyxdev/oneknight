import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { leads, loginEvents, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const mail = `lead${Date.now()}@test.oneknight.local`;
const ip = "203.0.113.7";
const brief = { service: "website", siteType: "shop", business: "Сувеніри з дерева", features: ["catalog"], locale: "uk" };

after(async () => {
  await db.delete(leads).where(like(leads.name, "LeadTest%"));
  await cleanupTestUsers(mail);
  await app.close();
  await sql.end();
});

const post = (url: string, payload: object, cookie?: string) =>
  app.inject({ method: "POST", url, payload, remoteAddress: ip, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });

test("anonymous lead needs a contact, then is stored", async () => {
  assert.equal((await post("/api/leads", brief)).json().error, "contact_required");
  const r = await post("/api/leads", { ...brief, name: "LeadTest Anon", phone: "+380671112233" });
  assert.equal(r.statusCode, 201);
  assert.ok(r.json().number >= 1001);
  const [row] = await db.select().from(leads).where(eq(leads.id, r.json().id));
  assert.equal(row!.source, "site");
  assert.equal(row!.siteType, "shop");
});

test("honeypot filled -> rejected", async () => {
  const r = await post("/api/leads", { ...brief, name: "LeadTest Bot", phone: "+380671112233", website: "spam" });
  assert.equal(r.statusCode, 400);
});

test("signed-in lead uses the account contact and is listed in /mine; admin routes are closed", async () => {
  const reg = await post("/api/auth/register", { name: "LeadTest User", phone: "+380500000000", email: mail, password: "long enough" });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const r = await post("/api/leads", { ...brief, service: "seo", siteType: undefined }, cookie);
  assert.equal(r.statusCode, 201);
  const mine = (await app.inject({ method: "GET", url: "/api/leads/mine", headers: { cookie } })).json();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].service, "seo");
  assert.equal(mine[0].business, "Сувеніри з дерева");
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/leads", headers: { cookie } })).statusCode, 403);
  await db.update(users).set({ isAdmin: true }).where(eq(users.email, mail));
  const all = await app.inject({ method: "GET", url: "/api/admin/leads", headers: { cookie } });
  assert.equal(all.statusCode, 200);
  const upd = await app.inject({ method: "PATCH", url: `/api/admin/leads/${mine[0].id}`, payload: { status: "in_progress" }, headers: { cookie, origin: ORIGIN } });
  assert.equal(upd.json().status, "in_progress");
});
