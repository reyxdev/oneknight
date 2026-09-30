import { and, desc, eq, gte, isNull, lt, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { statusChecks, statusIncidents } from "../db/schema.ts";
import { env } from "../config.ts";
import { tgCall } from "../notify/bot.ts";

/**
 * The public status page (owner's decision 30.09.2026): every 5 minutes each service is checked; 2 failed checks in
 * a row open an incident, the next good one closes it; the owner adds an explanation in the admin. 90 days kept.
 */
export const SERVICES = ["panel", "api", "bot", "novaposhta", "ukrposhta"] as const;
export type Service = (typeof SERVICES)[number];
export type Probe = () => Promise<boolean>;

const reachable = async (url: string, init: RequestInit = {}) => {
  const r = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  return r.status < 500;
};

/** Real checks. The bot is checked only when it is configured (otherwise it is not shown at all). */
export function defaultProbes(): Partial<Record<Service, Probe>> {
  return {
    panel: () => reachable(`${env.SITE_URL ?? env.APP_ORIGINS[0] ?? "http://localhost:8080"}/app/`),
    api: async () => {
      await db.execute(dsql`select 1`);
      return true;
    },
    ...(env.TELEGRAM_BOT_TOKEN ? { bot: async () => (await tgCall("getMe", {})).ok } : {}),
    novaposhta: () => reachable("https://api.novaposhta.ua/v2.0/json/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelName: "Common", calledMethod: "getTimeIntervals", methodProperties: {} }) }),
    ukrposhta: () => reachable("https://www.ukrposhta.ua/status-tracking/0.0.1/statuses/last?barcode=0"),
  };
}

export async function runStatusChecks(probes: Partial<Record<Service, Probe>> = defaultProbes(), now = new Date()) {
  for (const [service, probe] of Object.entries(probes) as [Service, Probe][]) {
    const t0 = Date.now();
    const ok = await probe().catch(() => false);
    const ms = Date.now() - t0;
    const [prev] = await db.select().from(statusChecks).where(and(eq(statusChecks.service, service), lt(statusChecks.at, now))).orderBy(desc(statusChecks.at)).limit(1);
    await db.insert(statusChecks).values({ service, ok, ms, at: now });
    const [open] = await db.select().from(statusIncidents).where(and(eq(statusIncidents.service, service), isNull(statusIncidents.endedAt)));
    if (ok && open) await db.update(statusIncidents).set({ endedAt: now }).where(eq(statusIncidents.id, open.id));
    if (!ok && !open && prev && !prev.ok) await db.insert(statusIncidents).values({ service, startedAt: prev.at });
  }
  await db.delete(statusChecks).where(lt(statusChecks.at, new Date(now.getTime() - 90 * 86_400_000)));
}

const kyivDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });

/** What the page shows: the state now, 90 days of daily uptime (null = no checks that day), incidents with notes. */
export async function statusSummary(now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const rows = await db.execute<{ service: string; day: string; total: number; good: number }>(dsql`
    select service, to_char(at at time zone 'Europe/Kyiv', 'YYYY-MM-DD') as day, count(*)::int as total, count(*) filter (where ok)::int as good
    from ${statusChecks} where at >= ${since.toISOString()}::timestamptz and at <= ${now.toISOString()}::timestamptz group by 1, 2`);
  const last = await db.execute<{ service: string; ok: boolean; at: Date }>(dsql`
    select distinct on (service) service, ok, at from ${statusChecks} where at <= ${now.toISOString()}::timestamptz order by service, at desc`);
  const incidents = await db.select().from(statusIncidents).where(and(gte(statusIncidents.startedAt, since), lte(statusIncidents.startedAt, now))).orderBy(desc(statusIncidents.startedAt));
  const days = Array.from({ length: 90 }, (_, i) => kyivDay(new Date(now.getTime() - (89 - i) * 86_400_000)));
  const shown = SERVICES.filter((s) => s !== "bot" || env.TELEGRAM_BOT_TOKEN || last.some((l) => l.service === "bot"));
  return {
    services: shown.map((service) => {
      const l = last.find((x) => x.service === service);
      const open = incidents.find((i) => i.service === service && !i.endedAt);
      return {
        service,
        state: !l ? "unknown" : open ? "down" : l.ok ? "up" : "degraded",
        checkedAt: l?.at ?? null,
        days: days.map((day) => {
          const r = rows.find((x) => x.service === service && x.day === day);
          return { day, uptime: r ? Math.round((1000 * Number(r.good)) / Number(r.total)) / 10 : null };
        }),
      };
    }),
    incidents: incidents.map((i) => ({ id: i.id, service: i.service, startedAt: i.startedAt, endedAt: i.endedAt, note: i.note })),
  };
}

export async function incidentsForAdmin() {
  return db.select().from(statusIncidents).orderBy(desc(statusIncidents.startedAt)).limit(100);
}

export async function noteIncident(id: string, note: string | null) {
  const [row] = await db.update(statusIncidents).set({ note }).where(eq(statusIncidents.id, id)).returning();
  return row ?? null;
}
