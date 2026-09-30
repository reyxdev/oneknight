import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNotNull } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { sessions, telegramLinks, userDevices, users } from "../db/schema.ts";
import { handleUpdate, type TgCall } from "../notify/bot.ts";
import { deviceName, noteDevice } from "./devices.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `sec${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Sec ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, id: r.json().id as string, org: r.json().organizations[0].id as string, device: r.cookies.find((c) => c.name === "ok_dev")?.value };
}

test("device names", () => {
  assert.equal(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"), "Chrome, Windows");
  assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "Safari, iOS");
});

test("a new device goes to Telegram with «Це не я», which ends that session", async () => {
  const o = await register("d", "+380500000093");
  assert.ok(o.device, "the browser is remembered by a cookie");
  await db.insert(telegramLinks).values({ userId: o.id, chatId: `chat${tag}`, linkedAt: new Date() });
  const sent: { method: string; body: Record<string, any> }[] = [];
  const call: TgCall = async (method, body) => (sent.push({ method, body }), { ok: true });
  const fake = (cookie?: string) => {
    const cookies: Record<string, string> = cookie ? { ok_dev: cookie } : {};
    const set: Record<string, string> = {};
    return { req: { cookies, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0" } } as never, reply: { setCookie: (k: string, v: string) => (set[k] = v) } as never, set };
  };
  // The same browser again: nothing.
  const same = fake(o.device);
  assert.equal(await noteDevice(same.req, same.reply, o.id, crypto.randomUUID(), call), false);
  // Another browser: a message with the button.
  const [s] = await db.select().from(sessions).where(eq(sessions.userId, o.id));
  const other = fake();
  assert.equal(await noteDevice(other.req, other.reply, o.id, s!.id, call), true);
  assert.ok(other.set.ok_dev, "a new device cookie");
  assert.match(sent[0]!.body.text, /нового пристрою: Chrome, Windows/);
  assert.equal(sent[0]!.body.reply_markup.inline_keyboard[0][0].callback_data, `notme:${s!.id}`);
  assert.equal((await db.select().from(userDevices).where(eq(userDevices.userId, o.id))).length, 2);

  // «Це не я» from the person's chat ends the session; from another chat nothing happens.
  await handleUpdate({ callback_query: { id: "1", data: `notme:${s!.id}`, message: { chat: { id: "someone-else" } } } }, call);
  assert.equal((await db.select().from(sessions).where(and(eq(sessions.id, s!.id), isNotNull(sessions.revokedAt)))).length, 0);
  await handleUpdate({ callback_query: { id: "2", data: `notme:${s!.id}`, message: { chat: { id: `chat${tag}` } } } }, call);
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie: o.cookie } })).statusCode, 401, "signed out there");
});

test("«Вимагати 2FA»: the owner needs it first; a member without 2FA sees nothing until it is on; the team log", async () => {
  const o = await register("o", "+380500000094");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const inv = await app.inject({ method: "POST", url: "/api/team/invites", payload: { role: "manager", permissions: ["orders", "products"] }, headers: H });
  const m = await register("m", "+380500000095");
  await app.inject({ method: "POST", url: "/api/team/accept", payload: { token: inv.json().token }, headers: { cookie: m.cookie, origin: ORIGIN } });

  // The log: the manager's action with their name.
  await app.inject({ method: "POST", url: "/api/shop/orders", payload: { customer: { name: "Покупець", phone: "+380671110000" }, items: [{ name: "Листівка", price: 20, qty: 1 }], delivery: { method: "pickup" }, payment: "cod", source: "call" }, headers: { cookie: m.cookie, origin: ORIGIN } });
  const log = (await app.inject({ url: "/api/team/log", headers: { cookie: o.cookie } })).json();
  assert.ok(log.items.some((x: { name: string; action: string }) => x.name === "Sec m" && x.action === "order.manual"));
  assert.equal((await app.inject({ url: `/api/team/log?user=${m.id}`, headers: { cookie: o.cookie } })).json().items.every((x: { userId: string }) => x.userId === m.id), true);
  assert.equal((await app.inject({ url: "/api/team/log", headers: { cookie: m.cookie } })).statusCode, 403, "the owner only");

  assert.equal((await app.inject({ method: "PATCH", url: "/api/team/settings", payload: { require2fa: true }, headers: H })).json().error, "own_2fa_needed");
  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, o.id));
  assert.equal((await app.inject({ method: "PATCH", url: "/api/team/settings", payload: { require2fa: true }, headers: H })).statusCode, 200);
  const me = (await app.inject({ url: "/api/auth/me", headers: { cookie: m.cookie } })).json();
  assert.equal(me.twofaRequired, true);
  assert.deepEqual((await app.inject({ url: "/api/shop/orders", headers: { cookie: m.cookie } })).json(), [], "no data without 2FA");
  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, m.id));
  assert.equal((await app.inject({ url: "/api/shop/orders", headers: { cookie: m.cookie } })).json().length, 1, "with 2FA on, back to work");
});
