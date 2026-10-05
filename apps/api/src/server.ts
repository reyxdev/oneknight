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
import { trackParcels } from "./integrations/tracking.ts";
import { purgeTrash } from "./reviews/routes.ts";
import { purgeAnalytics } from "./analytics/routes.ts";
import { purgeAuditLog } from "./audit.ts";
import { purgeCarts } from "./carts/routes.ts";
import { downloadPendingPhotos } from "./products/photos.ts";
import { runMorningReport } from "./admin/overview.ts";
import { runAdminReminders } from "./projects/routes.ts";
import { runWeeklyAudits } from "./sites/audit.ts";
import { purgeContentHistory, runContentMorning, runContentWeekly } from "./content/jobs.ts";
import { ensureContentSeed } from "./content/seed.ts";
import { runStatusChecks } from "./site/status.ts";
import { deliverDue, dispatchEvents, purgeWebhooks } from "./webhooks/service.ts";
import { notifyOwner } from "./notify/telegram.ts";
import { runLeadNudges, runWeeklyLeads } from "./leads/portfolio.ts";

const app = await buildApp();
// Starter templates and holidays of «Контент-план» (added once; admin edits are kept).
await ensureContentSeed().catch((e) => app.log.error(e));
const stopMonitor = startMonitor(app.log, env.MONITOR_INTERVAL_MIN);
// Billing: renewals, grace periods and suspensions, hourly (idempotent, row-locked).
const billingTimer = setInterval(() => {
  void runBilling().catch((e) => app.log.error(e));
  // «Ранковий звіт» to Ivan's Telegram at 09:00 Kyiv.
  void runMorningReport((text) => notifyOwner(text, app.log)).catch((e) => app.log.error(e));
  // Portfolio: the week's leads on Sunday evening.
  void runWeeklyLeads((text) => notifyOwner(text, app.log)).catch((e) => app.log.error(e));
  // Leads without an answer, lead reminders, project deadlines.
  void runAdminReminders(app.log).catch((e) => app.log.error(e));
  // «Перевірка якості» of every confirmed site once a week.
  void runWeeklyAudits(app.log).catch((e) => app.log.error(e));
  // «Контент-план»: today's ideas in the morning, a new week on Sunday evening.
  void runContentMorning().catch((e) => app.log.error(e));
  void runContentWeekly().catch((e) => app.log.error(e));
  void purgeContentHistory().catch((e) => app.log.error(e));
}, 3600_000);
void runBilling().catch((e) => app.log.error(e));
void runMorningReport((text) => notifyOwner(text, app.log)).catch((e) => app.log.error(e));
const stopBot = startBotPolling(app.log);
// Portfolio leads without an answer for an hour of the owner's day (every 5 minutes).
const nudgeTimer = setInterval(() => void runLeadNudges((text) => notifyOwner(text, app.log)).catch((e) => app.log.error(e)), 5 * 60_000);
const tgTimer = setInterval(() => void deliverTelegram(undefined, { skipTestAccounts: true }).catch((e) => app.log.error(e)), 15_000);
// Webhooks to client sites: changes become deliveries, due deliveries go out (every 15 s); history is purged hourly.
let webhookBusy = false;
const webhookTimer = setInterval(() => {
  if (webhookBusy) return;
  webhookBusy = true;
  void dispatchEvents({ skipTestAccounts: true })
    .then(() => deliverDue(undefined, new Date(), { skipTestAccounts: true }))
    .catch((e) => app.log.error(e))
    .finally(() => (webhookBusy = false));
}, 15_000);
const webhookPurgeTimer = setInterval(() => void purgeWebhooks().catch((e) => app.log.error(e)), 3600_000);
// The public status page: every service checked every 5 minutes.
const statusTimer = setInterval(() => void runStatusChecks().catch((e) => app.log.error(e)), 5 * 60_000);
void runStatusChecks().catch((e) => app.log.error(e));
const backupTimer = setInterval(() => void runBackups(app.log).catch((e) => app.log.error(e)), 3600_000);
// Parcels: Nova Poshta and Ukrposhta statuses hourly (Відправлено / Завершено / Повернення, waiting at the branch).
const trackTimer = setInterval(() => void trackParcels({ skipTestAccounts: true }).catch((e) => app.log.error(e)), 3600_000);
const promTimer = setInterval(() => {
  void syncAllProm(app.log).catch((e) => app.log.error(e));
  void syncAllRozetka(app.log).catch((e) => app.log.error(e));
  // Pictures left by product imports (normally done right after the import).
  void downloadPendingPhotos().catch((e) => app.log.error(e));
}, 10 * 60_000);
const sweepTimer = setInterval(() => {
  void sweepOrphans().catch((e) => app.log.error(e));
  void purgeTrash().catch((e) => app.log.error(e));
  void purgeAnalytics().catch((e) => app.log.error(e));
  void purgeAuditLog().catch((e) => app.log.error(e));
  void purgeCarts().catch((e) => app.log.error(e));
  void sweepBackupFiles().catch((e) => app.log.error(e));
}, 24 * 3600_000);
void purgeTrash().catch((e) => app.log.error(e));

const shutdown = async () => {
  stopMonitor();
  clearInterval(billingTimer);
  clearInterval(sweepTimer);
  clearInterval(promTimer);
  clearInterval(trackTimer);
  clearInterval(backupTimer);
  clearInterval(statusTimer);
  clearInterval(webhookTimer);
  clearInterval(webhookPurgeTimer);
  clearInterval(tgTimer);
  clearInterval(nudgeTimer);
  stopBot();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
