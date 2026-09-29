import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { analyticsEvents, orders } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgIdsOf } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { sitesWithStats } from "../sites/stats.ts";
import { dismissInsight, insightsFor } from "./insights.ts";

const DAY = 86_400_000;

/** GET /api/dashboard: everything the home screen needs in one request. */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req, reply) => {
    const [org] = await orgIdsOf(req.auth!.user.id);
    if (!org) return reply.code(404).send({ error: "not_found" });
    const since30 = new Date(Date.now() - 30 * DAY);
    const [o] = await db
      .select({
        // "Today" in Kyiv time, correct across the summer/winter time change.
        today: dsql<number>`count(*) filter (where (${orders.createdAt} at time zone 'Europe/Kyiv')::date = (now() at time zone 'Europe/Kyiv')::date and ${orders.status} <> 'cancelled')`.mapWith(Number),
        newCount: dsql<number>`count(*) filter (where ${orders.status} = 'new')`.mapWith(Number),
        revenue30: dsql<number>`coalesce(sum(${orders.totalKop}) filter (where ${orders.createdAt} >= ${since30.toISOString()}::timestamptz and ${orders.status} <> 'cancelled'), 0)`.mapWith(Number),
        orders30: dsql<number>`count(*) filter (where ${orders.createdAt} >= ${since30.toISOString()}::timestamptz and ${orders.status} <> 'cancelled')`.mapWith(Number),
      })
      .from(orders)
      .where(eq(orders.organizationId, org));
    const latest = await db
      .select({ id: orders.id, number: orders.number, customerName: orders.customerName, totalKop: orders.totalKop, status: orders.status, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.organizationId, org))
      .orderBy(desc(orders.createdAt))
      .limit(5);

    let traffic: { visitors30: number; series: { date: string; sessions: number; orders: number }[] } | null = null;
    if (await hasModule(org, "analytics")) {
      const day = dsql<string>`to_char(date_trunc('day', ${analyticsEvents.createdAt} at time zone 'Europe/Kyiv'), 'YYYY-MM-DD')`;
      const rows = await db
        .select({ date: day, sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number), orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number) })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.organizationId, org), gt(analyticsEvents.createdAt, since30)))
        .groupBy(day)
        .orderBy(day);
      const [v] = await db.select({ n: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number) }).from(analyticsEvents).where(and(eq(analyticsEvents.organizationId, org), gt(analyticsEvents.createdAt, since30)));
      const byDate = new Map(rows.map((r) => [r.date, r]));
      const series = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.now() - (29 - i) * DAY).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
        return byDate.get(d) ?? { date: d, sessions: 0, orders: 0 };
      });
      traffic = { visitors30: v?.n ?? 0, series };
    }
    return { orders: o, latest, traffic, sites: await sitesWithStats([org]), insights: await insightsFor(org) };
  });

  app.post("/insights/dismiss", async (req, reply) => {
    const p = z.object({ id: z.string().min(1).max(200) }).safeParse(req.body);
    const [org] = await orgIdsOf(req.auth!.user.id);
    if (!p.success || !org) return reply.code(400).send({ error: "invalid_input" });
    await dismissInsight(org, p.data.id);
    return { ok: true };
  });
};
