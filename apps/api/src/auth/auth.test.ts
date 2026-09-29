import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generate } from "otplib";
import { like } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { db, sql } from "../db/client.ts";
import { loginEvents, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const tag = `t${Date.now()}`;
const mail = `${tag}@test.oneknight.local`;
const ORIGIN = "http://localhost:3000";

after(async () => {
  // Clean up only this file's data: test files run in parallel.
  await db.delete(loginEvents).where(like(loginEvents.emailAttempted, `${tag}%`));
  await db.delete(users).where(like(users.email, `${tag}%`));
  await app.close();
  await sql.end();
});

type Res = Awaited<ReturnType<typeof app.inject>>;
let cookie = "";
const keep = (r: Res) => {
  const c = r.cookies.find((x) => x.name === "ok_session");
  if (c) cookie = `ok_session=${c.value}`;
  return r;
};
const post = async (url: string, body: unknown, withCookie = true) =>
  keep(await app.inject({ method: "POST", url, payload: body as object, headers: { origin: ORIGIN, ...(withCookie && cookie ? { cookie } : {}) } }));
const get = (url: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });

test("register creates user, owner organization and an HttpOnly session", async () => {
  const r = await post("/api/auth/register", { name: "Тест", phone: "+380 67 000 00 00", email: mail.toUpperCase(), password: "correct horse" }, false);
  assert.equal(r.statusCode, 201);
  const body = r.json();
  assert.equal(body.email, mail);
  assert.equal(body.organizations[0].role, "owner");
  const sc = r.cookies.find((c) => c.name === "ok_session")!;
  assert.equal(sc.httpOnly, true);
  assert.equal(sc.sameSite, "Lax");
  assert.equal((await get("/api/auth/me")).statusCode, 200);
});

test("duplicate email is rejected", async () => {
  const r = await post("/api/auth/register", { name: "Тест", phone: "+380670000000", email: mail, password: "correct horse" }, false);
  assert.equal(r.statusCode, 409);
});

test("CSRF guard rejects foreign origins and non-JSON bodies", async () => {
  const bad = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { origin: "https://evil.example" } });
  assert.equal(bad.statusCode, 403);
  const form = await app.inject({ method: "POST", url: "/api/auth/login", payload: "email=a", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(form.statusCode, 415);
});

test("logout revokes the session", async () => {
  const old = cookie;
  await post("/api/auth/logout", {});
  cookie = old;
  assert.equal((await get("/api/auth/me")).statusCode, 401);
});

test("login works; 5 wrong passwords lock the email", async () => {
  const ok = await post("/api/auth/login", { email: mail, password: "correct horse" }, false);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().mfaRequired, false);
  const good = cookie;
  for (let i = 0; i < 5; i++) assert.equal((await post("/api/auth/login", { email: mail, password: "wrong pass" }, false)).statusCode, 401);
  const locked = await post("/api/auth/login", { email: mail, password: "correct horse" }, false);
  assert.equal(locked.statusCode, 429);
  cookie = good;
  // unlock for the next test
  await db.delete(loginEvents).where(like(loginEvents.emailAttempted, mail));
});

test("2FA: setup, enable, then login needs a fresh TOTP code (no reuse)", async () => {
  const setup = await post("/api/auth/2fa/setup", {});
  assert.equal(setup.statusCode, 200);
  const { secret, qrSvg } = setup.json();
  assert.match(qrSvg, /^<svg/);
  const now = Math.floor(Date.now() / 1000);
  const code = await generate({ secret, epoch: now });
  assert.equal((await post("/api/auth/2fa/enable", { code })).statusCode, 200);

  const login = await post("/api/auth/login", { email: mail, password: "correct horse" }, false);
  assert.equal(login.json().mfaRequired, true);
  assert.equal((await get("/api/auth/me")).json().error, "mfa_required");
  assert.equal((await post("/api/auth/login/totp", { code })).statusCode, 401, "same code must not be accepted twice");
  const next = await generate({ secret, epoch: now + 30 });
  const r = await post("/api/auth/login/totp", { code: next });
  assert.equal(r.statusCode, 200);
  assert.equal((await get("/api/auth/me")).statusCode, 200);
});

test("sessions and login history are listed for the user only", async () => {
  const s = (await get("/api/auth/sessions")).json();
  assert.ok(Array.isArray(s) && s.some((x: { current: boolean }) => x.current));
  assert.ok(!("idHash" in s[0]));
  const h = (await get("/api/auth/login-history")).json();
  assert.ok(h.length >= 3);
});
