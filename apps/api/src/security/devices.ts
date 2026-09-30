import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../db/client.ts";
import { telegramLinks, userDevices } from "../db/schema.ts";
import { env } from "../config.ts";
import { randomToken, sha256 } from "./crypto.ts";
import { tgCall, type TgCall } from "../notify/bot.ts";

export const DEVICE_COOKIE = "ok_dev";
const TWO_YEARS = 2 * 365 * 24 * 3600 * 1000;

/** «Chrome, Windows» from a user agent (only for the message; the agent is kept with the session anyway). */
export function deviceName(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "браузер";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser}, ${os}` : browser;
}

/**
 * After a sign-in: the browser is remembered by a random id in a long-lived cookie (kept hashed). A browser not
 * seen before, when the person has signed in elsewhere already, sends «вхід з нового пристрою» with «Це не я» to
 * their Telegram (if connected). The first browser of a new account says nothing.
 */
export async function noteDevice(req: FastifyRequest, reply: FastifyReply, userId: string, sessionId: string, call: TgCall = tgCall) {
  let token = req.cookies[DEVICE_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    token = randomToken().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 43);
    reply.setCookie(DEVICE_COOKIE, token, { path: "/", sameSite: "lax", secure: env.COOKIE_SECURE, httpOnly: true, expires: new Date(Date.now() + TWO_YEARS) });
  }
  const deviceHash = sha256(token);
  const ua = String(req.headers["user-agent"] ?? "").slice(0, 300);
  const [fresh] = await db.insert(userDevices).values({ userId, deviceHash, userAgent: ua }).onConflictDoNothing().returning({ userId: userDevices.userId });
  if (!fresh) {
    await db.update(userDevices).set({ lastSeenAt: new Date() }).where(and(eq(userDevices.userId, userId), eq(userDevices.deviceHash, deviceHash)));
    return false;
  }
  const [other] = await db.select({ h: userDevices.deviceHash }).from(userDevices).where(and(eq(userDevices.userId, userId), ne(userDevices.deviceHash, deviceHash))).limit(1);
  if (!other) return false;
  const [link] = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(and(eq(telegramLinks.userId, userId), isNotNull(telegramLinks.chatId)));
  if (link?.chatId) {
    const when = new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    await call("sendMessage", {
      chat_id: link.chatId,
      text: `🔐 Вхід в ONEKNIGHT з нового пристрою: ${deviceName(ua)}, ${when}.\nЯкщо це ви — нічого робити не треба.`,
      reply_markup: { inline_keyboard: [[{ text: "Це не я", callback_data: `notme:${sessionId}` }]] },
    }).catch(() => null);
  }
  return true;
}
