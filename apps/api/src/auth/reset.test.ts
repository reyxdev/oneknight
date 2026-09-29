import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { generate } from "otplib";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { passwordResets, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `reset${Date.now()}`;
after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function account(n: string, admin = false) {
  const email = `${tag}-${n}@test.oneknight.local`;
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: n, phone: "+380500000012", email, password: "old password" }, headers: { origin: ORIGIN } });
  if (admin) await db.update(users).set({ isAdmin: true }).where(eq(users.email, email));
  return { email, H: { cookie: `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`, origin: ORIGIN } };
}
const login = (email: string, password: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password }, headers: { origin: ORIGIN } });

test("password reset link: admin only, one use, signs everyone out, 2FA still asked", async () => {
  const admin = await account("admin", true);
  const u = await account("user");

  assert.equal((await app.inject({ method: "POST", url: "/api/admin/password-reset", payload: { email: u.email }, headers: u.H })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/password-reset", payload: { email: `nobody-${tag}@test.oneknight.local` }, headers: admin.H })).json().error, "user_not_found");

  // 2FA on for the user
  const { secret } = (await app.inject({ method: "POST", url: "/api/auth/2fa/setup", payload: {}, headers: u.H })).json();
  const t0 = Math.floor(Date.now() / 1000);
  await app.inject({ method: "POST", url: "/api/auth/2fa/enable", payload: { code: await generate({ secret, epoch: t0 }) }, headers: u.H });

  const first = (await app.inject({ method: "POST", url: "/api/admin/password-reset", payload: { email: u.email.toUpperCase() }, headers: admin.H })).json();
  const { token } = (await app.inject({ method: "POST", url: "/api/admin/password-reset", payload: { email: u.email }, headers: admin.H })).json();
  assert.equal((await app.inject({ url: `/api/auth/reset/${first.token}` })).statusCode, 404, "a new link replaces the old one");
  const [row] = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, (await import("../security/crypto.ts")).sha256(token)));
  assert.ok(row && !JSON.stringify(row).includes(token), "token stored only as a hash");

  assert.deepEqual((await app.inject({ url: `/api/auth/reset/${token}` })).json(), { name: "user", totpRequired: true });
  const post = (body: object) => app.inject({ method: "POST", url: "/api/auth/reset", payload: body, headers: { origin: ORIGIN } });
  assert.equal((await post({ token, password: "new password 1" })).json().error, "code_required");
  assert.equal((await post({ token, password: "new password 1", code: "000000" })).json().error, "invalid_code");
  assert.equal((await post({ token, password: "short", code: "1" })).json().error, "invalid_input");
  assert.equal((await post({ token, password: "new password 1", code: await generate({ secret, epoch: t0 + 30 }) })).json().ok, true);
  assert.equal((await post({ token, password: "another one 2", code: await generate({ secret, epoch: t0 + 60 }) })).json().error, "invalid_link", "one use");

  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: u.H.cookie } })).statusCode, 401, "old session signed out");
  assert.equal((await login(u.email, "old password")).statusCode, 401);
  assert.equal((await login(u.email, "new password 1")).json().mfaRequired, true, "2FA stays on");

  // Lost phone: the admin resets 2FA too.
  const lost = (await app.inject({ method: "POST", url: "/api/admin/password-reset", payload: { email: u.email, resetTotp: true }, headers: admin.H })).json();
  assert.equal((await app.inject({ url: `/api/auth/reset/${lost.token}` })).json().totpRequired, false);
  assert.equal((await post({ token: lost.token, password: "fresh password 3" })).json().ok, true);
  const l = await login(u.email, "fresh password 3");
  assert.equal(l.json().mfaRequired, false, "2FA switched off, can be set up again");
});

test("profile and password change: own data, business name only for the owner, other devices signed out", async () => {
  const u = await account("profile");
  const second = await login(u.email, "old password");
  const other = `ok_session=${second.cookies.find((c) => c.name === "ok_session")!.value}`;
  const patch = (body: object, H = u.H) => app.inject({ method: "PATCH", url: "/api/auth/profile", payload: body, headers: H });
  const r = (await patch({ name: "Нове Ім'я", phone: "+380 67 000 00 01", businessName: "Карпатська майстерня" })).json();
  assert.equal(r.name, "Нове Ім'я");
  assert.equal(r.organizations[0].name, "Карпатська майстерня");
  assert.equal((await patch({ phone: "abc" })).statusCode, 400);

  const pw = (body: object) => app.inject({ method: "POST", url: "/api/auth/password", payload: body, headers: u.H });
  assert.equal((await pw({ current: "wrong", next: "changed pass 1" })).statusCode, 401);
  assert.equal((await pw({ current: "old password", next: "short" })).statusCode, 400);
  assert.equal((await pw({ current: "old password", next: "changed pass 1" })).json().ok, true);
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: u.H.cookie } })).statusCode, 200, "this device stays signed in");
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: other } })).statusCode, 401, "other devices signed out");
  assert.equal((await login(u.email, "changed pass 1")).statusCode, 200);
});
