import type { FastifyBaseLogger } from "fastify";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { monitorChecks, notifications, sites } from "../db/schema.ts";
import { notifyOrg } from "../notify/notify.ts";
import { probe } from "./probe.ts";

const RETENTION_DAYS = 90;
const SSL_WARN_DAYS = 14;
const CONCURRENCY = 4;

type Site = typeof sites.$inferSelect;

/** Probes one site, stores the result and raises notifications on up/down changes and near SSL expiry. */
export async function checkSite(site: Site, log: FastifyBaseLogger | Console) {
  const r = await probe(site.domain);
  await db.insert(monitorChecks).values({ siteId: site.id, up: r.up, statusCode: r.statusCode, responseMs: r.responseMs, sslValidTo: r.sslValidTo, error: r.error });
  await db.update(sites).set({ lastUp: r.up, lastCheckedAt: new Date() }).where(eq(sites.id, site.id));

  if (site.lastUp !== null && site.lastUp !== r.up) {
    await notifyOrg(
      site.organizationId,
      "site",
      r.up ? "siteUp" : "siteDown",
      { domain: site.domain, error: r.error ?? "" },
      r.up ? `✅ ${site.domain} знову працює` : `⚠️ ${site.domain} недоступний (${r.error})`,
      log,
    );
  }
  if (r.sslValidTo) {
    const days = Math.floor((r.sslValidTo.getTime() - Date.now()) / 86_400_000);
    if (days <= SSL_WARN_DAYS) {
      const [recent] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.organizationId, site.organizationId), eq(notifications.key, "sslExpiring"), gt(notifications.createdAt, new Date(Date.now() - 86_400_000))))
        .limit(1);
      if (!recent) await notifyOrg(site.organizationId, "site", "sslExpiring", { domain: site.domain, days }, `🔒 SSL для ${site.domain} закінчується через ${days} дн.`, log);
    }
  }
  return r;
}

async function runAll(log: FastifyBaseLogger) {
  const list = await db.select().from(sites).where(eq(sites.status, "live"));
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    await Promise.all(list.slice(i, i + CONCURRENCY).map((s) => checkSite(s, log).catch((e) => log.warn({ err: String(e), site: s.domain }, "check failed"))));
  }
  await db.delete(monitorChecks).where(lt(monitorChecks.checkedAt, new Date(Date.now() - RETENTION_DAYS * 86_400_000)));
}

/** In-process scheduler. Moves to a separate worker when the API runs on more than one instance. */
export function startMonitor(log: FastifyBaseLogger, everyMinutes: number) {
  if (everyMinutes <= 0) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAll(log);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 15_000);
  const id = setInterval(tick, everyMinutes * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(id);
  };
}

export async function lastChecks(siteId: string, since: Date) {
  return db
    .select({ at: monitorChecks.checkedAt, up: monitorChecks.up, ms: monitorChecks.responseMs, code: monitorChecks.statusCode })
    .from(monitorChecks)
    .where(and(eq(monitorChecks.siteId, siteId), gt(monitorChecks.checkedAt, since)))
    .orderBy(desc(monitorChecks.checkedAt));
}
