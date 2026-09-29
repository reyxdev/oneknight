import { and, eq, gt, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { analyticsEvents, insightDismissals } from "../db/schema.ts";

export type Insight = { id: string; tone: "bad" | "warn" | "good"; key: string; params: Record<string, string | number>; action?: string };

const DAY = 86_400_000;
const MIN_SESSIONS = 50; // below this, week-over-week changes are noise
const MIN_CHANNEL = 10;

async function convWindow(orgId: string, from: Date, to: Date) {
  const [r] = await db
    .select({
      sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number),
      orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
    })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.organizationId, orgId), gt(analyticsEvents.createdAt, from), lte(analyticsEvents.createdAt, to)));
  return r ?? { sessions: 0, orders: 0 };
}

async function channelWindow(orgId: string, from: Date, to: Date) {
  return db
    .select({ channel: analyticsEvents.channel, sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number) })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.organizationId, orgId), gt(analyticsEvents.createdAt, from), lte(analyticsEvents.createdAt, to)))
    .groupBy(analyticsEvents.channel);
}

/**
 * «Підказки»: recommendations computed only from the organization's own analytics.
 * Each one: what happened (key), why (copy), what to do (copy). Nothing is shown without enough data behind it.
 * Things that need doing (orders, stock, site problems) are in todo.ts.
 */
export async function insightsFor(orgId: string, now = new Date()): Promise<Insight[]> {
  const out: Insight[] = [];

  // Week over week, only with enough traffic to mean something.
  const w1 = await convWindow(orgId, new Date(now.getTime() - 7 * DAY), now);
  const w0 = await convWindow(orgId, new Date(now.getTime() - 14 * DAY), new Date(now.getTime() - 7 * DAY));
  if (w1.sessions >= MIN_SESSIONS && w0.sessions >= MIN_SESSIONS && w0.orders > 0) {
    const c1 = w1.orders / w1.sessions;
    const c0 = w0.orders / w0.sessions;
    const change = Math.round(((c1 - c0) / c0) * 100);
    if (change <= -15) out.push({ id: "conv:drop", tone: "warn", key: "conversionDrop", params: { v: -change, visits: w1.sessions }, action: "analytics" });
    if (change >= 25) out.push({ id: "conv:up", tone: "good", key: "conversionUp", params: { v: change }, action: "analytics" });
  }
  const ch1 = await channelWindow(orgId, new Date(now.getTime() - 7 * DAY), now);
  const ch0 = await channelWindow(orgId, new Date(now.getTime() - 14 * DAY), new Date(now.getTime() - 7 * DAY));
  const growth = ch1
    .map((c) => ({ c, prev: ch0.find((x) => x.channel === c.channel)?.sessions ?? 0 }))
    .filter(({ c, prev }) => prev >= MIN_CHANNEL && c.channel !== "direct" && (c.sessions - prev) / prev >= 0.3)
    .sort((a, b) => b.c.sessions - a.c.sessions)[0];
  if (growth) out.push({ id: `grow:${growth.c.channel}`, tone: "good", key: "channelUp", params: { channel: growth.c.channel, v: Math.round(((growth.c.sessions - growth.prev) / growth.prev) * 100) }, action: "analytics" });

  const dismissed = await db.select({ id: insightDismissals.insightId }).from(insightDismissals).where(and(eq(insightDismissals.organizationId, orgId), gt(insightDismissals.until, now)));
  const hide = new Set(dismissed.map((d) => d.id));
  return out.filter((i) => !hide.has(i.id));
}

/** Hides an insight or a «Що треба зробити» item (for a day: «Нагадати завтра»). */
export async function dismissInsight(orgId: string, insightId: string, days = 7) {
  await db
    .insert(insightDismissals)
    .values({ organizationId: orgId, insightId, until: new Date(Date.now() + days * DAY) })
    .onConflictDoUpdate({ target: [insightDismissals.organizationId, insightDismissals.insightId], set: { until: new Date(Date.now() + days * DAY) } });
}

