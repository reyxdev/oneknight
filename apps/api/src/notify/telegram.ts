import { env } from "../config.ts";

/** Sends a plain-text message to the owner's Telegram chat. No-op when not configured. Never throws. */
export async function notifyOwner(text: string, log: { warn: (o: object, m: string) => void }) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
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
