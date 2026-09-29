import { and, count, eq, gt, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { analyticsEvents, insightDismissals, monitorChecks, orders, products, reviews, sites, subscriptions } from "../db/schema.ts";

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
 * Problems and recommendations computed only from the organization's own data.
 * Each insight: what happened (key), why (copy), what to do (copy). Nothing is shown without data behind it.
 */
export async function insightsFor(orgId: string, now = new Date()): Promise<Insight[]> {
  const out: Insight[] = [];
  const siteList = await db.select().from(sites).where(eq(sites.organizationId, orgId));

  for (const s of siteList) {
    if (s.status === "live" && s.lastUp === false) out.push({ id: `down:${s.id}`, tone: "bad", key: "siteDown", params: { domain: s.domain }, action: "site" });
    const [last] = await db.select({ ssl: monitorChecks.sslValidTo }).from(monitorChecks).where(eq(monitorChecks.siteId, s.id)).orderBy(dsql`${monitorChecks.checkedAt} desc`).limit(1);
    if (last?.ssl) {
      const days = Math.floor((last.ssl.getTime() - now.getTime()) / DAY);
      if (days <= 14) out.push({ id: `ssl:${s.id}`, tone: days <= 3 ? "bad" : "warn", key: "sslExpiring", params: { domain: s.domain, days }, action: "site" });
    }
  }

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  if (sub?.status === "grace" || sub?.status === "suspended") out.push({ id: `billing:${sub.status}`, tone: "bad", key: sub.status === "grace" ? "billingGrace" : "billingSuspended", params: {}, action: "billing" });

  const [waiting] = await db.select({ n: count() }).from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.status, "new"), lte(orders.createdAt, new Date(now.getTime() - DAY))));
  if (waiting && waiting.n > 0) out.push({ id: "orders:waiting", tone: "warn", key: "ordersWaiting", params: { n: waiting.n }, action: "orders" });

  const low = await db.select({ name: products.name, stock: products.stock }).from(products).where(and(eq(products.organizationId, orgId), eq(products.active, true), lte(products.stock, 2)));
  for (const p of low.slice(0, 3)) out.push({ id: `stock:${p.name}`, tone: p.stock === 0 ? "bad" : "warn", key: p.stock === 0 ? "outOfStock" : "lowStock", params: { name: p.name, n: p.stock ?? 0 }, action: "products" });

  const [pend] = await db.select({ n: count() }).from(reviews).where(and(eq(reviews.organizationId, orgId), eq(reviews.status, "pending")));
  if (pend && pend.n > 0) out.push({ id: "reviews:pending", tone: "warn", key: "reviewsPending", params: { n: pend.n }, action: "reviews" });

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

export async function dismissInsight(orgId: string, insightId: string, days = 7) {
  await db
    .insert(insightDismissals)
    .values({ organizationId: orgId, insightId, until: new Date(Date.now() + days * DAY) })
    .onConflictDoUpdate({ target: [insightDismissals.organizationId, insightDismissals.insightId], set: { until: new Date(Date.now() + days * DAY) } });
}

