import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gte, lt, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { analyticsEvents, orders, organizations, reviews } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { audit } from "../audit.ts";
import { dismissInsight, insightsFor } from "./insights.ts";
import { CARRIERS, todoFor, toShip } from "./todo.ts";
import { claimReward, stepsOf } from "./steps.ts";

const DAY = 86_400_000;
const KYIV = "Europe/Kyiv";
/** Inlined, not a parameter: Postgres must see the same expression in SELECT and GROUP BY. */
const TZ = dsql.raw(`'${KYIV}'`);
export const PERIODS = ["today", "7", "30", "90"] as const;
export type Period = (typeof PERIODS)[number];

/** Start of today and of this month in Kyiv time, as exact instants (correct across the summer/winter change). */
async function kyivStarts() {
  const [r] = await db.execute<{ day: string; month: string; next: string }>(
    dsql`select date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ} as day,
                date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ} as month,
                (date_trunc('month', now() at time zone ${TZ}) + interval '1 month') at time zone ${TZ} as next`,
  );
  return { day: new Date(r!.day), month: new Date(r!.month), next: new Date(r!.next) };
}

/** Revenue and order counts in [from, to). Revenue = every order except cancelled ones. */
async function sales(orgId: string, from: Date, to: Date) {
  const [r] = await db
    .select({
      revenueKop: dsql<number>`coalesce(sum(${orders.totalKop}) filter (where ${orders.status} <> 'cancelled'), 0)`.mapWith(Number),
      orders: dsql<number>`count(*) filter (where ${orders.status} <> 'cancelled')`.mapWith(Number),
      cancelled: dsql<number>`count(*) filter (where ${orders.status} = 'cancelled')`.mapWith(Number),
    })
    .from(orders)
    .where(and(eq(orders.organizationId, orgId), gte(orders.createdAt, from), lt(orders.createdAt, to)));
  return r!;
}

async function visits(orgId: string, from: Date, to: Date) {
  const [r] = await db
    .select({ sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number), orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number) })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.organizationId, orgId), gte(analyticsEvents.createdAt, from), lt(analyticsEvents.createdAt, to)));
  return r!;
}

const kyivDate = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: KYIV });
const kyivHour = (t: number) => Number(new Date(t).toLocaleString("en-GB", { timeZone: KYIV, hour: "2-digit", hourCycle: "h23" }));

/** Revenue and orders per hour (today) or per day, with empty buckets filled so the chart has no gaps. */
async function series(orgId: string, period: Period, from: Date, now: Date) {
  const hourly = period === "today";
  const bucket = hourly
    ? dsql<string>`extract(hour from ${orders.createdAt} at time zone ${TZ})::int::text`
    : dsql<string>`to_char(${orders.createdAt} at time zone ${TZ}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ b: bucket, revenueKop: dsql<number>`coalesce(sum(${orders.totalKop}), 0)`.mapWith(Number), orders: dsql<number>`count(*)`.mapWith(Number) })
    .from(orders)
    .where(and(eq(orders.organizationId, orgId), gte(orders.createdAt, from), lt(orders.createdAt, now), dsql`${orders.status} <> 'cancelled'`))
    .groupBy(bucket);
  const by = new Map(rows.map((r) => [r.b, r]));
  // Noon of each day keeps the date right on the days the clock changes.
  const labels = hourly ? Array.from({ length: kyivHour(now.getTime()) + 1 }, (_, h) => String(h)) : Array.from({ length: Number(period) }, (_, i) => kyivDate(from.getTime() + i * DAY + DAY / 2));
  return labels.map((b) => ({ label: b, revenueKop: by.get(b)?.revenueKop ?? 0, orders: by.get(b)?.orders ?? 0 }));
}

/**
 * GET /api/dashboard?period=today|7|30|90: everything Home needs in one request. Each block is present only
 * when the member may see it; the period is compared with the one right before it (same length).
 */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { period?: string } }>("/", async (req, reply) => {
    const m = await activeMembership(req);
    if (!m) return reply.code(404).send({ error: "not_found" });
    const org = m.orgId;
    const can = (p: (typeof m.permissions)[number]) => m.permissions.includes(p);
    const period: Period = (PERIODS as readonly string[]).includes(req.query.period ?? "") ? (req.query.period as Period) : "7";
    const now = new Date();
    const starts = await kyivStarts();
    // "7 days" = today and the 6 days before it; the previous period ends at the same moment of its last day.
    const from = period === "today" ? starts.day : new Date(starts.day.getTime() - (Number(period) - 1) * DAY);
    const span = period === "today" ? DAY : Number(period) * DAY;
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = new Date(now.getTime() - span);

    // Without `finance` every sum is null: counts stay, money is not sent at all.
    const finance = can("finance");
    const noMoney = <T extends { revenueKop: number }>(x: T) => (finance ? x : { ...x, revenueKop: null });
    let salesBlock = null;
    let goal = null;
    let ship = null;
    if (can("orders")) {
      const cur = await sales(org, from, now);
      const prev = await sales(org, prevFrom, prevTo);
      salesBlock = { cur: noMoney(cur), prev: noMoney(prev), series: (await series(org, period, from, now)).map(noMoney) };
    }
    if (can("orders") && finance) {
      const [o] = await db.select({ goalKop: organizations.goalKop }).from(organizations).where(eq(organizations.id, org));
      const monthKop = (await sales(org, starts.month, now)).revenueKop;
      const part = (now.getTime() - starts.month.getTime()) / (starts.next.getTime() - starts.month.getTime());
      // A forecast from the first two days of a month would be noise.
      goal = { goalKop: o?.goalKop ?? null, monthKop, forecastKop: part >= 0.1 ? Math.round(monthKop / part) : null, canEdit: m.role === "owner" };
    }
    if (can("orders") || can("shipping")) {
      const list = (await toShip(org)).map((x) => (finance ? x : { ...x, totalKop: null }));
      ship = { list, printable: list.filter((x) => x.waybill && CARRIERS.includes(x.method)).length };
    }
    const analytics = can("analytics") && (await hasModule(org, "analytics"));
    const traffic = analytics ? { cur: await visits(org, from, now), prev: await visits(org, prevFrom, prevTo) } : null;
    const latestReviews =
      can("reviews") && (await hasModule(org, "reviews"))
        ? await db
            .select({ id: reviews.id, authorName: reviews.authorName, rating: reviews.rating, text: reviews.text, status: reviews.status, createdAt: reviews.createdAt })
            .from(reviews)
            .where(and(eq(reviews.organizationId, org), dsql`${reviews.status} <> 'trash'`))
            .orderBy(desc(reviews.createdAt))
            .limit(3)
        : null;
    const steps = m.role === "owner" ? await stepsOf(org, req.auth!.user.id, now) : null;

    return {
      period,
      sales: salesBlock,
      traffic,
      goal,
      ship,
      todo: await todoFor(org, m.permissions, now),
      steps: steps && !steps.rewardedAt ? steps.done : null,
      reviews: latestReviews,
      tips: analytics ? (await insightsFor(org, now)).slice(0, 3) : [],
    };
  });

  /** «Нагадати завтра» for a «Що треба зробити» item, «Зроблено» for a tip (a week). */
  app.post("/insights/dismiss", async (req, reply) => {
    const p = z.object({ id: z.string().min(1).max(200), days: z.union([z.literal(1), z.literal(7)]).optional() }).safeParse(req.body);
    const m = await activeMembership(req);
    if (!p.success || !m) return reply.code(400).send({ error: "invalid_input" });
    await dismissInsight(m.orgId, p.data.id, p.data.days ?? 7);
    return { ok: true };
  });

  /** Monthly revenue goal, owner only. Null clears it. */
  app.patch("/goal", async (req, reply) => {
    const p = z.object({ goalUah: z.number().int().min(1).max(100_000_000).nullable() }).safeParse(req.body);
    const m = await activeMembership(req);
    if (!p.success || !m) return reply.code(400).send({ error: "invalid_input" });
    if (m.role !== "owner") return reply.code(403).send({ error: "forbidden" });
    await db.update(organizations).set({ goalKop: p.data.goalUah === null ? null : p.data.goalUah * 100 }).where(eq(organizations.id, m.orgId));
    await audit(req, "business.goal", req.auth!.user.id, { goalUah: p.data.goalUah }, m.orgId);
    return { ok: true };
  });

  app.post("/first-steps/claim", async (req, reply) => {
    const m = await activeMembership(req);
    if (!m) return reply.code(404).send({ error: "not_found" });
    if (m.role !== "owner") return reply.code(403).send({ error: "forbidden" });
    const r = await claimReward(m.orgId, req.auth!.user.id);
    if (!r.ok) return reply.code(409).send({ error: r.error });
    await audit(req, "billing.first_steps_reward", req.auth!.user.id, { until: r.until }, m.orgId);
    return r;
  });
};
