import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { sites } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `team${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Team ${n}`, phone: "+380500000008", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string, id: r.json().id as string };
}
const H = (cookie: string) => ({ cookie, origin: ORIGIN });

test("invite a manager with limited permissions; scope follows permissions; removal", async () => {
  const owner = await register("owner");
  const mgr = await register("mgr");
  const [site] = await db.insert(sites).values({ organizationId: owner.org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();

  assert.equal((await app.inject({ url: "/api/team", headers: { cookie: mgr.cookie } })).json().members.length, 1, "own org before joining");
  const inv = await app.inject({ method: "POST", url: "/api/team/invites", payload: { role: "manager", permissions: ["orders"] }, headers: H(owner.cookie) });
  assert.equal(inv.statusCode, 201);
  const token = inv.json().token;
  const acc = await app.inject({ method: "POST", url: "/api/team/accept", payload: { token }, headers: H(mgr.cookie) });
  assert.equal(acc.json().orgId, owner.org);
  assert.equal((await app.inject({ method: "POST", url: "/api/team/accept", payload: { token }, headers: H(mgr.cookie) })).statusCode, 410, "one-time link");

  const me = (await app.inject({ url: "/api/auth/me", headers: { cookie: mgr.cookie } })).json();
  assert.equal(me.activeOrgId, owner.org);
  assert.deepEqual(me.permissions, ["orders"]);
  assert.equal(me.organizations.length, 2);

  assert.equal((await app.inject({ url: "/api/shop/orders", headers: { cookie: mgr.cookie } })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/shop/sites/${site!.id}/products`, headers: { cookie: mgr.cookie } })).statusCode, 404, "no products permission");
  assert.equal((await app.inject({ url: "/api/team", headers: { cookie: mgr.cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/billing", headers: { cookie: mgr.cookie } })).statusCode, 404);

  assert.equal((await app.inject({ method: "PATCH", url: `/api/team/members/${mgr.id}`, payload: { permissions: ["orders", "products"] }, headers: H(owner.cookie) })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/shop/sites/${site!.id}/products`, headers: { cookie: mgr.cookie } })).statusCode, 200, "permission granted");
  assert.equal((await app.inject({ method: "PATCH", url: `/api/team/members/${owner.id}`, payload: { role: "manager" }, headers: H(owner.cookie) })).json().error, "owner_fixed");

  // Switch back to the own org and in again
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/org", payload: { orgId: mgr.org }, headers: H(mgr.cookie) })).json().role, "owner");
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/org", payload: { orgId: owner.org }, headers: H(mgr.cookie) })).json().role, "manager");

  assert.equal((await app.inject({ method: "DELETE", url: `/api/team/members/${mgr.id}`, headers: H(owner.cookie) })).statusCode, 200);
  const after2 = (await app.inject({ url: "/api/auth/me", headers: { cookie: mgr.cookie } })).json();
  assert.equal(after2.activeOrgId, mgr.org, "falls back to own organization");
  await db.delete(sites).where(eq(sites.id, site!.id));
});
