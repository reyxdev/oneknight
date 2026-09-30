import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { leads, loginEvents, platformState, users } from "../db/schema.ts";
import { refCodeOf } from "../billing/referrals.ts";

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
  const upd = await app.inject({ method: "PATCH", url: `/api/admin/leads/${mine[0].id}`, payload: { status: "contacted" }, headers: { cookie, origin: ORIGIN } });
  assert.equal(upd.json().status, "contacted");
});

test("two steps: contact and type first, the brief later with the key; «Створіть кабінет» takes the lead; invite name", async () => {
  const other = { origin: ORIGIN };
  const send = (url: string, payload: object, method: "POST" | "PATCH" = "POST") => app.inject({ method, url, payload, remoteAddress: "203.0.113.9", headers: other });
  const r = await send("/api/leads", { service: "website", siteType: "service", name: "LeadTest Two", phone: "+380671112299", estimate: { siteType: "service", products: "50", design: "custom", languages: 2, content: 10, from: 20000, to: 26000 } });
  assert.equal(r.statusCode, 201);
  const { token, id } = r.json();
  assert.ok(typeof token === "string" && token.length > 20, "a key for the brief and the account");
  const [row] = await db.select().from(leads).where(eq(leads.id, id));
  // The range is computed again on the server (the visitor sent 20 000 — 26 000): 12 000 + 30% design + 20% for the
  // second language + 1 500 for 10 pages of content = 19 500, and +30% = 25 350 → 25 400.
  assert.deepEqual([(row!.brief as { estimate: { from: number; to: number } }).estimate.from, (row!.brief as { estimate: { to: number } }).estimate.to], [19500, 25400]);
  assert.equal((await app.inject({ url: "/api/site/calculator" })).json().base.card, 7000);

  assert.equal((await send("/api/leads/brief", { token: "x".repeat(30), business: "Ні" }, "PATCH")).statusCode, 404);
  const b = await send("/api/leads/brief", { token, business: "Студія манікюру", about: "Запис онлайн", features: ["booking"] }, "PATCH");
  assert.deepEqual(b.json(), { ok: true, number: r.json().number });
  const [after2] = await db.select().from(leads).where(eq(leads.id, id));
  assert.equal((after2!.brief as { business: string }).business, "Студія манікюру");
  assert.ok((after2!.brief as { estimate?: object }).estimate, "the brief adds, never drops what was sent");

  // The account made with the key takes the lead; the key then stops working.
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "LeadTest Two", phone: "+380671112299", email: `two.${mail}`, password: "long enough", lead: token }, headers: other });
  assert.equal(reg.statusCode, 201);
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const mine = (await app.inject({ url: "/api/leads/mine", headers: { cookie } })).json();
  assert.deepEqual(mine.map((l: { id: string; business: string }) => [l.id, l.business]), [[id, "Студія манікюру"]]);
  assert.equal((await send("/api/leads/brief", { token, about: "ще" }, "PATCH")).statusCode, 404);

  // Invite strip: the business name by a referral code.
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, `two.${mail}`));
  const code = await refCodeOf(u!.id);
  assert.equal((await app.inject({ url: `/api/site/invite/${code}` })).json().business, "LeadTest Two");
  assert.equal((await app.inject({ url: "/api/site/invite/ZZZZZZZZ" })).statusCode, 404);

  // The owner changes the calculator in the admin; the site and new leads use the new numbers.
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, u!.id));
  const [saved] = await db.select().from(platformState).where(eq(platformState.key, "calculator"));
  const cfg = (await app.inject({ url: "/api/admin/site/calculator", headers: { cookie } })).json();
  const put = await app.inject({ method: "PUT", url: "/api/admin/site/calculator", headers: { cookie, origin: ORIGIN }, payload: { ...cfg, base: { ...cfg.base, card: 8000 } } });
  assert.equal(put.statusCode, 200);
  assert.equal((await app.inject({ url: "/api/site/calculator" })).json().base.card, 8000);
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/site/calculator", headers: { cookie, origin: ORIGIN }, payload: { ...cfg, spreadPct: -1 } })).statusCode, 400);
  // The shared database keeps the owner's own numbers.
  if (saved) await db.update(platformState).set({ value: saved.value }).where(eq(platformState.key, "calculator"));
  else await db.delete(platformState).where(eq(platformState.key, "calculator"));
});
