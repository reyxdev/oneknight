// Sends one test line to the configured Telegram chat: npm run notify:test -w @oneknight/api
import { env } from "../src/config.ts";
import { notifyOwner } from "../src/notify/telegram.ts";

if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
  console.log("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty in .env");
  process.exit(1);
}
const ok = await notifyOwner("✅ ONEKNIGHT: сповіщення працюють. Сюди приходитимуть нові заявки й падіння сайтів.", { warn: (o, m) => console.log(m, o) });
console.log(ok ? "sent" : "failed");
process.exit(ok ? 0 : 1);
