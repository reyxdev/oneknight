import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { loginEvents, monitorChecks, notifications, sites, users } from "../db/schema.ts";
import { normalizeDomain } from "../monitor/probe.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `site${Date.now()}`;
const emails = [`${tag}a@test.oneknight.local`, `${tag}b@test.oneknight.local`];

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(email: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Site Test", phone: "+380500000001", email, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
  return { cookie, orgId: r.json().organizations[0].id as string };
}

test("normalizeDomain accepts public hosts and refuses local ones", () => {
  assert.equal(normalizeDomain("https://Karpatu.shop/uk?x=1"), "karpatu.shop");
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain("127.0.0.1"), null);
  assert.equal(normalizeDomain("printer.local"), null);
});

test("a user sees only their organization's sites, checks and notifications", async () => {
  const a = await register(emails[0]!);
  const b = await register(emails[1]!);
  const [site] = await db.insert(sites).values({ organizationId: a.orgId, domain: `${tag}.example-shop.com.ua`, name: "A" }).returning();
  await db.insert(monitorChecks).values([{ siteId: site!.id, up: true, statusCode: 200, responseMs: 300 }, { siteId: site!.id, up: false, statusCode: 503, error: "http_503" }]);
  await db.insert(notifications).values({ organizationId: a.orgId, kind: "site", key: "siteDown", params: { domain: "x" } });

  const listA = (await app.inject({ url: "/api/sites", headers: { cookie: a.cookie } })).json();
  assert.equal(listA.length, 1);
  assert.equal(listA[0].uptime30d, 0.5);
  assert.equal(listA[0].avgMs24h, 300);
  assert.equal((await app.inject({ url: "/api/sites", headers: { cookie: b.cookie } })).json().length, 0);
  assert.equal((await app.inject({ url: `/api/sites/${site!.id}/checks`, headers: { cookie: b.cookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/sites/${site!.id}/checks`, headers: { cookie: a.cookie } })).json().length, 2);

  const n = (await app.inject({ url: "/api/notifications", headers: { cookie: a.cookie } })).json();
  assert.equal(n.length, 1);
  assert.equal(n[0].read, false);
  await app.inject({ method: "POST", url: "/api/notifications/read", payload: {}, headers: { cookie: a.cookie, origin: ORIGIN } });
  assert.equal((await app.inject({ url: "/api/notifications", headers: { cookie: a.cookie } })).json()[0].read, true);
  assert.equal((await app.inject({ url: "/api/notifications", headers: { cookie: b.cookie } })).json().length, 0);

  // Only admins can add sites; bad domains are refused.
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/sites", payload: { organizationId: a.orgId, domain: "x.com", name: "x" }, headers: { cookie: a.cookie, origin: ORIGIN } })).statusCode, 403);
  await db.update(users).set({ isAdmin: true }).where(eq(users.email, emails[0]!));
  const bad = await app.inject({ method: "POST", url: "/api/admin/sites", payload: { organizationId: a.orgId, domain: "localhost", name: "x" }, headers: { cookie: a.cookie, origin: ORIGIN } });
  assert.equal(bad.json().error, "invalid_domain");
  const orgs = (await app.inject({ url: "/api/admin/organizations", headers: { cookie: a.cookie } })).json();
  assert.ok(orgs.some((o: { id: string; siteCount: number }) => o.id === a.orgId && o.siteCount === 1));
  await db.delete(sites).where(eq(sites.id, site!.id));
});
