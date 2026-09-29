import { env } from "./config.ts";
import { buildApp } from "./app.ts";
import { sql } from "./db/client.ts";
import { startMonitor } from "./monitor/scheduler.ts";
import { runBilling } from "./billing/service.ts";

const app = await buildApp();
const stopMonitor = startMonitor(app.log, env.MONITOR_INTERVAL_MIN);
// Billing: renewals, grace periods and suspensions, hourly (idempotent, row-locked).
const billingTimer = setInterval(() => void runBilling().catch((e) => app.log.error(e)), 3600_000);
void runBilling().catch((e) => app.log.error(e));

const shutdown = async () => {
  stopMonitor();
  clearInterval(billingTimer);
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
