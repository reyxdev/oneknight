import { env } from "./config.ts";
import { buildApp } from "./app.ts";
import { sql } from "./db/client.ts";
import { startMonitor } from "./monitor/scheduler.ts";

const app = await buildApp();
const stopMonitor = startMonitor(app.log, env.MONITOR_INTERVAL_MIN);

const shutdown = async () => {
  stopMonitor();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
