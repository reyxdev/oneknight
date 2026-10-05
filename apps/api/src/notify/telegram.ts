import { env } from "../config.ts";

/** Automated tests use this email domain; their activity never reaches the owner's Telegram. */
export const isTestContact = (email: string | null | undefined) => !!email && email.endsWith("@test.oneknight.local");

export type TgButton = { text: string; callback_data: string };

/**
 * Sends a plain-text message to the owner's Telegram chat, optionally with buttons under it.
 * No-op when not configured or under test. Never throws.
 */
export async function notifyOwner(text: string, log: { warn: (o: object, m: string) => void }, opts: { testContact?: boolean; buttons?: TgButton[][] } = {}) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  if (env.NODE_ENV === "test" || opts.testContact) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true, ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      log.warn({ status: res.status, description: body?.description }, "telegram notify failed");
    }
    return res.ok;
  } catch (e) {
    log.warn({ err: String(e) }, "telegram notify failed");
    return false;
  }
}
