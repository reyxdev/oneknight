import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { memberships, notifications, telegramLinks } from "../db/schema.ts";
import { deliverTelegram, handleUpdate, type TgCall } from "./bot.ts";

const sent: { chat_id: string; text: string }[] = [];
const fake: TgCall = async (method, body) => {
  if (method === "getMe") return { ok: true, result: { username: "oneknight_test_bot" } };
  if (method === "sendMessage") {
    if (body.chat_id === "999") return { ok: false, description: "Forbidden: bot was blocked by the user" };
    sent.push(body as { chat_id: string; text: string });
    return { ok: true, result: {} };
  }
  return { ok: false, description: "unexpected" };
};
const app = await buildApp({ logger: false }, { tgCall: fake });
const ORIGIN = "http://localhost:3000";
const tag = `tg${Date.now()}`;
after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});
const start = (chat: number, text: string) => handleUpdate({ update_id: 1, message: { chat: { id: chat, type: "private" }, from: { username: "olena" }, text } }, fake);

async function account(n: string) {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: n, phone: "+380500000015", email: `${tag}-${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { H: { cookie: `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`, origin: ORIGIN }, org: reg.json().organizations[0].id as string, id: reg.json().id as string };
}

// Other test files create notifications at the same time; one run takes 50, so a few runs empty the queue.
const drain = async () => {
  for (let i = 0; i < 6; i++) await deliverTelegram(fake);
};

test("Telegram: link with a one-time /start token, receive allowed notifications, unlink", async () => {
  const owner = await account("owner");
  const staff = await account("staff");
  // staff joins the owner's business as a marketer without the "orders" permission
  await db.insert(memberships).values({ organizationId: owner.org, userId: staff.id, role: "marketer", permissions: ["reviews"] });

  const st = (await app.inject({ url: "/api/telegram", headers: { cookie: owner.H.cookie } })).json();
  assert.deepEqual([st.available, st.bot, st.linked], [true, "oneknight_test_bot", false]);
  const { url } = (await app.inject({ method: "POST", url: "/api/telegram/link", headers: owner.H })).json();
  const token = url.match(/^https:\/\/t\.me\/oneknight_test_bot\?start=([\w-]+)$/)![1];

  await start(111, "/start wrongtoken");
  assert.match(sent.at(-1)!.text, /Посилання недійсне/);
  await start(111, `/start ${token}`);
  assert.match(sent.at(-1)!.text, /Готово, owner!/);
  await start(222, `/start ${token}`);
  assert.match(sent.at(-1)!.text, /Посилання недійсне/, "token works once");
  assert.equal((await app.inject({ url: "/api/telegram", headers: { cookie: owner.H.cookie } })).json().username, "olena");

  const staffLink = (await app.inject({ method: "POST", url: "/api/telegram/link", headers: staff.H })).json().url.split("start=")[1];
  await start(333, `/start ${staffLink}`);

  sent.length = 0;
  await db.insert(notifications).values([
    { organizationId: owner.org, kind: "order", key: "newOrder", params: { n: 1042, total: 2200 } },
    { organizationId: owner.org, kind: "review", key: "newReview", params: { name: "Оксана", rating: 5 } },
  ]);
  await drain();
  const toOwner = sent.filter((m) => m.chat_id === "111").map((m) => m.text);
  const toStaff = sent.filter((m) => m.chat_id === "333").map((m) => m.text);
  assert.equal(toOwner.length, 2);
  assert.match(toOwner[0]!, /Нове замовлення №1042 на 2\s200 грн/);
  assert.deepEqual(toStaff.map((t) => t.split("\n")[1]), ["⭐ Новий відгук від Оксана (5★)"], "no orders without the permission");
  await drain();
  assert.equal(sent.length, 3, "each notification is sent once");

  // Opt-out of a kind, blocked bot, /stop.
  await app.inject({ method: "PATCH", url: "/api/telegram", payload: { kinds: ["order"] }, headers: owner.H });
  sent.length = 0;
  await db.insert(notifications).values({ organizationId: owner.org, kind: "review", key: "newReview", params: { name: "Іван", rating: 4 } });
  await drain();
  assert.equal(sent.filter((m) => m.chat_id === "111").length, 0, "kind switched off");
  await db.update(telegramLinks).set({ chatId: "999" }).where(eq(telegramLinks.userId, staff.id));
  await db.insert(notifications).values({ organizationId: owner.org, kind: "review", key: "newReview", params: { name: "Іван", rating: 4 } });
  await drain();
  assert.equal((await app.inject({ url: "/api/telegram", headers: { cookie: staff.H.cookie } })).json().linked, false, "blocked bot unlinks");
  await start(111, "/stop");
  assert.equal((await app.inject({ url: "/api/telegram", headers: { cookie: owner.H.cookie } })).json().linked, false);
});
