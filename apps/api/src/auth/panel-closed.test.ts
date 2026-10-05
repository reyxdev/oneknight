import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { leads, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `closed${Date.now()}`;

after(async () => {
  delete process.env.OK_TEST_PANEL_CLOSED;
  await db.delete(leads).where(eq(leads.name, "Closed Lead"));
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("closed panel: no sign-ups, only admins sign in, other sessions stop working; the public site keeps taking requests", async () => {
  const reg = (n: string) => app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Closed ${n}`, phone: "+380500000091", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const u = await reg("u");
  const a = await reg("a");
  const cookie = (r: Awaited<ReturnType<typeof reg>>) => `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
  await db.update(users).set({ isAdmin: true }).where(eq(users.email, `${tag}a@test.oneknight.local`));

  process.env.OK_TEST_PANEL_CLOSED = "1";
  assert.deepEqual((await app.inject({ url: "/api/auth/config" })).json(), { registration: false, closed: true });
  assert.equal((await reg("x")).json().error, "registration_closed");
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: cookie(u) } })).statusCode, 401, "a client's session no longer opens the panel");
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: cookie(a) } })).statusCode, 200, "the admin keeps working");
  const login = (who: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${tag}${who}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  assert.equal((await login("u")).json().error, "panel_closed");
  assert.equal((await login("a")).statusCode, 200);
  const lead = await app.inject({ method: "POST", url: "/api/leads", payload: { service: "website", siteType: "card", name: "Closed Lead", phone: "+380671119999" }, remoteAddress: "203.0.113.77", headers: { origin: ORIGIN } });
  assert.equal(lead.statusCode, 201, "requests from the site still arrive");

  delete process.env.OK_TEST_PANEL_CLOSED;
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: cookie(u) } })).statusCode, 200, "opened again, nothing was lost");
});
