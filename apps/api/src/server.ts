import { env } from "./config.ts";
import { buildApp } from "./app.ts";
import { sql } from "./db/client.ts";
import { startMonitor } from "./monitor/scheduler.ts";
import { runBilling } from "./billing/service.ts";
import { sweepOrphans } from "./files/store.ts";
import { syncAllProm } from "./integrations/prom.ts";
import { syncAllRozetka } from "./integrations/rozetka.ts";
import { runBackups, sweepBackupFiles } from "./backups/service.ts";
import { deliverTelegram, startBotPolling } from "./notify/bot.ts";
import { purgeTrash } from "./reviews/routes.ts";
import { purgeAnalytics } from "./analytics/routes.ts";

const app = await buildApp();
const stopMonitor = startMonitor(app.log, env.MONITOR_INTERVAL_MIN);
// Billing: renewals, grace periods and suspensions, hourly (idempotent, row-locked).
const billingTimer = setInterval(() => void runBilling().catch((e) => app.log.error(e)), 3600_000);
void runBilling().catch((e) => app.log.error(e));
const stopBot = startBotPolling(app.log);
const tgTimer = setInterval(() => void deliverTelegram(undefined, { skipTestAccounts: true }).catch((e) => app.log.error(e)), 15_000);
const backupTimer = setInterval(() => void runBackups(app.log).catch((e) => app.log.error(e)), 3600_000);
const promTimer = setInterval(() => {
  void syncAllProm(app.log).catch((e) => app.log.error(e));
  void syncAllRozetka(app.log).catch((e) => app.log.error(e));
}, 10 * 60_000);
const sweepTimer = setInterval(() => {
  void sweepOrphans().catch((e) => app.log.error(e));
  void purgeTrash().catch((e) => app.log.error(e));
  void purgeAnalytics().catch((e) => app.log.error(e));
  void sweepBackupFiles().catch((e) => app.log.error(e));
}, 24 * 3600_000);
void purgeTrash().catch((e) => app.log.error(e));

const shutdown = async () => {
  stopMonitor();
  clearInterval(billingTimer);
  clearInterval(sweepTimer);
  clearInterval(promTimer);
  clearInterval(backupTimer);
  clearInterval(tgTimer);
  stopBot();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
