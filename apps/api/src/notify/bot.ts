import https from "node:https";
import { and, asc, eq, gt, isNotNull, not } from "drizzle-orm";
import { db } from "../db/client.ts";
import { memberships, notifications, organizations, telegramLinks, users } from "../db/schema.ts";
import { env } from "../config.ts";
import { randomToken, sha256 } from "../security/crypto.ts";

/**
 * The ONEKNIGHT Telegram bot for clients: a person links their chat with a one-time /start token from the
 * account, then receives the notifications of their businesses they are allowed to see.
 */
export type TgCall = (method: string, body: Record<string, unknown>) => Promise<{ ok: boolean; result?: any; description?: string }>;

/**
 * getUpdates is a 25-second long poll. Sent through fetch it would hold the shared connection and make every
 * other Bot API call wait for it, so it gets its own socket.
 */
function longPoll(url: string, body: string): Promise<{ ok: boolean; result?: any; description?: string }> {
  return new Promise((resolve) => {
    const req = https.request(url, { method: "POST", agent: false, headers: { "content-type": "application/json" }, timeout: 40_000 }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ ok: false, description: `http_${res.statusCode}` });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ ok: false, description: String(e) }));
    req.end(body);
  });
}

export const tgCall: TgCall = async (method, body) => {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: "not_configured" };
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  if (method === "getUpdates") return longPoll(url, JSON.stringify(body));
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    return (await res.json().catch(() => ({ ok: false, description: `http_${res.status}` }))) as { ok: boolean; result?: any; description?: string };
  } catch (e) {
    return { ok: false, description: String(e) };
  }
};

export const KINDS = ["order", "review", "site", "billing", "ticket", "team"] as const;
/** Notification kinds that need a permission in the business; the rest go to every member who opted in. */
export const KIND_PERM: Record<string, string> = { order: "orders", review: "reviews", billing: "billing", ticket: "support", team: "team" };
const LINK_MINUTES = 15;

let botUsername: string | null = null;
export async function botName(call: TgCall = tgCall) {
  if (botUsername) return botUsername;
  const r = await call("getMe", {});
  botUsername = r.ok ? String(r.result?.username ?? "") || null : null;
  return botUsername;
}

export async function createLinkToken(userId: string) {
  const token = randomToken().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const values = { linkTokenHash: sha256(token), linkExpiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) };
  await db.insert(telegramLinks).values({ userId, ...values }).onConflictDoUpdate({ target: telegramLinks.userId, set: values });
  return token;
}

const HELP = "Це бот ONEKNIGHT. Щоб отримувати сповіщення, відкрийте ONEKNIGHT → Профіль → Telegram і натисніть «Підключити Telegram».";

/** One incoming update (private chats only). */
export async function handleUpdate(u: any, call: TgCall = tgCall) {
  const msg = u?.message;
  if (!msg || msg.chat?.type !== "private" || typeof msg.text !== "string") return;
  const chatId = String(msg.chat.id);
  const reply = (text: string) => call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  const [cmd, arg] = msg.text.trim().split(/\s+/, 2);

  if (cmd === "/start" && arg) {
    const linked = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ userId: telegramLinks.userId, name: users.name })
        .from(telegramLinks)
        .innerJoin(users, eq(users.id, telegramLinks.userId))
        .where(and(eq(telegramLinks.linkTokenHash, sha256(arg)), gt(telegramLinks.linkExpiresAt, new Date())))
        .for("update");
      if (!row) return null;
      // One chat serves one ONEKNIGHT account: linking here moves it from any previous account.
      await tx.update(telegramLinks).set({ chatId: null, linkedAt: null }).where(and(eq(telegramLinks.chatId, chatId), not(eq(telegramLinks.userId, row.userId))));
      await tx
        .update(telegramLinks)
        .set({ chatId, username: msg.from?.username ? String(msg.from.username).slice(0, 64) : null, linkTokenHash: null, linkExpiresAt: null, linkedAt: new Date() })
        .where(eq(telegramLinks.userId, row.userId));
      return row;
    });
    return reply(linked ? `Готово, ${linked.name}! Сповіщення ONEKNIGHT тепер приходитимуть сюди.\nВимкнути: /stop` : `Посилання недійсне або застаріло. ${HELP}`);
  }
  if (cmd === "/stop") {
    const rows = await db.update(telegramLinks).set({ chatId: null, linkedAt: null }).where(eq(telegramLinks.chatId, chatId)).returning({ userId: telegramLinks.userId });
    return reply(rows.length ? "Сповіщення вимкнено. Підключити знову можна в ONEKNIGHT → Профіль → Telegram." : HELP);
  }
  return reply(HELP);
}

/** Long polling for local and single-server setups (no public webhook URL needed). */
export function startBotPolling(log: { warn: (o: object, m: string) => void }, call: TgCall = tgCall) {
  let stopped = false;
  let offset = 0;
  void (async () => {
    while (!stopped) {
      const r = await call("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
      if (!r.ok) {
        if (r.description !== "not_configured") log.warn({ err: r.description }, "telegram polling failed");
        await new Promise((ok) => setTimeout(ok, r.description === "not_configured" ? 3_600_000 : 5_000));
        continue;
      }
      for (const u of r.result ?? []) {
        offset = Math.max(offset, Number(u.update_id) + 1);
        await handleUpdate(u, call).catch((e) => log.warn({ err: String(e) }, "telegram update failed"));
      }
    }
  })();
  return () => {
    stopped = true;
  };
}

const money = (v: unknown) => new Intl.NumberFormat("uk-UA").format(Number(v) || 0);
/** Plain Ukrainian text for each notification key (the account shows the same events). */
export function notificationText(key: string, p: Record<string, any>, finance = true): string | null {
  switch (key) {
    // Without `finance` the person does not see sums, in Telegram either.
    case "newOrder": return finance ? `🛒 Нове замовлення №${p.n} на ${money(p.total)} грн` : `🛒 Нове замовлення №${p.n}`;
    case "newReview": return `⭐ Новий відгук від ${p.name} (${p.rating}★)`;
    case "siteDown": return `⚠️ ${p.domain} недоступний${p.error ? ` (${p.error})` : ""}`;
    case "siteUp": return `✅ ${p.domain} знову працює`;
    case "sslExpiring": return `🔒 SSL для ${p.domain} закінчується через ${p.days} дн.`;
    case "lowBalance": return `💳 Не вистачає ${money(p.amount)} грн для продовження ONEKNIGHT. Сервіс працює ще ${p.days} дн.`;
    case "suspended": return `⛔ Підписку ONEKNIGHT призупинено: не вистачає ${money(p.amount)} грн`;
    case "renewed": return `✅ Підписку ONEKNIGHT продовжено, списано ${money(p.amount)} грн`;
    case "topupConfirmed": return `💳 Баланс ONEKNIGHT поповнено на ${money(p.amount)} грн`;
    case "ticketAnswered": return `💬 Підтримка відповіла на звернення №${p.n}`;
    case "memberJoined": return `👤 ${p.name} приєднався до команди`;
    case "keyRedeemed": return "🔑 Ключ доступу активовано";
    case "trialStarted": return "🎉 ONEKNIGHT відкрито безкоштовно на 3 місяці";
    case "trialStartedDays": return `🎉 Пробний період ONEKNIGHT: ${p.days} днів безкоштовно`;
    case "trialEnding": return `⏳ Пробний період ONEKNIGHT закінчується через ${p.days} дн. Оплатіть підписку в розділі «Оплата», щоб робота не зупинилась.`;
    case "firstStepsReward": return "🎁 Перші кроки пройдено: +7 днів ONEKNIGHT безкоштовно";
    default: return null;
  }
}

/**
 * Sends new notifications to linked chats. Each notification is claimed once (flag set before sending), so
 * several API processes or a restart never send twice. Only the last hour is considered.
 */
export async function deliverTelegram(call: TgCall = tgCall) {
  const pending = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.telegramDone, false), gt(notifications.createdAt, new Date(Date.now() - 3_600_000))))
    .orderBy(asc(notifications.createdAt))
    .limit(50);
  let sent = 0;
  for (const n of pending) {
    const [claimed] = await db.update(notifications).set({ telegramDone: true }).where(and(eq(notifications.id, n.id), eq(notifications.telegramDone, false))).returning({ id: notifications.id });
    if (!claimed) continue;
    if (!notificationText(n.key, n.params as Record<string, unknown>)) continue;
    const people = await db
      .select({ chatId: telegramLinks.chatId, kinds: telegramLinks.kinds, role: memberships.role, permissions: memberships.permissions, org: organizations.name })
      .from(telegramLinks)
      .innerJoin(memberships, eq(memberships.userId, telegramLinks.userId))
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.organizationId, n.organizationId), isNotNull(telegramLinks.chatId)));
    for (const p of people) {
      if (!p.kinds.includes(n.kind)) continue;
      const perm = KIND_PERM[n.kind];
      if (perm && p.role !== "owner" && !p.permissions.includes(perm)) continue;
      const text = notificationText(n.key, n.params as Record<string, unknown>, p.role === "owner" || p.permissions.includes("finance"))!;
      const r = await call("sendMessage", { chat_id: p.chatId, text: `${p.org}\n${text}`, disable_web_page_preview: true });
      if (r.ok) sent++;
      // The person blocked the bot or deleted the chat: stop trying.
      else if (/blocked|chat not found|deactivated/i.test(r.description ?? "")) await db.update(telegramLinks).set({ chatId: null, linkedAt: null }).where(eq(telegramLinks.chatId, p.chatId!));
    }
  }
  return sent;
}

export async function telegramStatus(userId: string) {
  const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId));
  return { linked: !!row?.chatId, username: row?.username ?? null, kinds: row?.kinds ?? [...KINDS] };
}

export const setKinds = (userId: string, kinds: string[]) =>
  db
    .insert(telegramLinks)
    .values({ userId, kinds })
    .onConflictDoUpdate({ target: telegramLinks.userId, set: { kinds } });

export const unlink = (userId: string) => db.update(telegramLinks).set({ chatId: null, linkedAt: null, linkTokenHash: null }).where(eq(telegramLinks.userId, userId));
