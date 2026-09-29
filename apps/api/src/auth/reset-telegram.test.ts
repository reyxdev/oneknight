import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { telegramLinks } from "../db/schema.ts";

const sent: { chat_id: unknown; text: string }[] = [];
const app = await buildApp({ logger: false }, { tgCall: async (method, body) => (method === "sendMessage" && sent.push(body as { chat_id: unknown; text: string }), { ok: true, result: {} }) });
const ORIGIN = "http://localhost:3000";
const tag = `rtg${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("«Забули пароль?»: a one-time link in the person's Telegram, the same answer for unknown emails", async () => {
  const email = `${tag}@test.oneknight.local`;
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Reset", phone: "+380500000010", email, password: "long enough" }, headers: { origin: ORIGIN } });
  const ask = (e: string) => app.inject({ method: "POST", url: "/api/auth/reset/telegram", payload: { email: e }, headers: { origin: ORIGIN } });

  assert.deepEqual((await ask(email)).json(), { ok: true });
  assert.equal(sent.length, 0, "no Telegram connected: nothing is sent, same answer");
  assert.deepEqual((await ask(`nobody${tag}@test.oneknight.local`)).json(), { ok: true });

  await db.insert(telegramLinks).values({ userId: reg.json().id, chatId: `77${Date.now()}` });
  assert.deepEqual((await ask(email.toUpperCase())).json(), { ok: true });
  assert.equal(sent.length, 1);
  const token = sent[0]!.text.match(/\/app\/\?reset=([\w-]+)/)?.[1];
  assert.ok(token && sent[0]!.text.startsWith("🔑"), "the link goes to the linked chat");
  assert.ok(sent[0]!.text.includes(`${ORIGIN}/app/?reset=`), "on the site the person asked from");
  const info = await app.inject({ url: `/api/auth/reset/${token}` });
  assert.equal(info.json().name, "Reset");
  const done = await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "a brand new one" }, headers: { origin: ORIGIN } });
  assert.equal(done.statusCode, 200);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "a brand new one" }, headers: { origin: ORIGIN } });
  assert.equal(login.statusCode, 200);
});
