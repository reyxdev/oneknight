import { and, avg, count, desc, eq, gt, inArray, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { monitorChecks, sites } from "../db/schema.ts";

const DAY = 86_400_000;

/** Sites with the numbers the account shows: uptime over 30 days, average response over 24 h, last result, SSL days left. */
export async function sitesWithStats(orgIds: string[]) {
  if (!orgIds.length) return [];
  const list = await db.select().from(sites).where(inArray(sites.organizationId, orgIds)).orderBy(sites.createdAt);
  return Promise.all(
    list.map(async (s) => {
      const [u] = await db
        .select({ total: count(), up: dsql<number>`count(*) filter (where ${monitorChecks.up})`.mapWith(Number) })
        .from(monitorChecks)
        .where(and(eq(monitorChecks.siteId, s.id), gt(monitorChecks.checkedAt, new Date(Date.now() - 30 * DAY))));
      const [r] = await db
        .select({ ms: avg(monitorChecks.responseMs) })
        .from(monitorChecks)
        .where(and(eq(monitorChecks.siteId, s.id), eq(monitorChecks.up, true), gt(monitorChecks.checkedAt, new Date(Date.now() - DAY))));
      const [last] = await db.select().from(monitorChecks).where(eq(monitorChecks.siteId, s.id)).orderBy(desc(monitorChecks.checkedAt)).limit(1);
      return {
        id: s.id,
        domain: s.domain,
        name: s.name,
        status: s.status,
        publicKey: s.publicKey,
        reviewModeration: s.reviewModeration,
        verifiedAt: s.verifiedAt,
        okSeenAt: s.okSeenAt,
        settings: s.settings,
        checks30d: u?.total ?? 0,
        uptime30d: u && u.total ? u.up / u.total : null,
        avgMs24h: r?.ms ? Math.round(Number(r.ms)) : null,
        last: last ? { at: last.checkedAt, up: last.up, statusCode: last.statusCode, responseMs: last.responseMs, error: last.error } : null,
        sslDaysLeft: last?.sslValidTo ? Math.floor((last.sslValidTo.getTime() - Date.now()) / DAY) : null,
      };
    }),
  );
}
