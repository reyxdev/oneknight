import type { FastifyPluginAsync } from "fastify";
import { and, gt, inArray, lt, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { analyticsEvents, sites } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { channelOf } from "./channel.ts";

const RETENTION_DAYS = 400;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor/i;

/** First-touch context the tracking script keeps for the browsing session (sessionStorage). */
export const Context = z.object({
  session: z.string().regex(/^[a-z0-9]{16,64}$/),
  source: z.string().max(100).optional(),
  medium: z.string().max(100).optional(),
  campaign: z.string().max(150).optional(),
  content: z.string().max(150).optional(),
  referrer: z.string().max(500).optional(),
});
export type AnalyticsContext = z.infer<typeof Context>;

const Event = Context.extend({ type: z.enum(["pageview", "lead"]), path: z.string().max(500).optional() });

export async function recordEvent(site: { id: string; organizationId: string; domain: string }, type: "pageview" | "lead" | "order", ctx: AnalyticsContext, extra: { path?: string; valueKop?: number } = {}) {
  await db.insert(analyticsEvents).values({
    organizationId: site.organizationId,
    siteId: site.id,
    type,
    session: ctx.session,
    path: extra.path ?? null,
    channel: channelOf(ctx.source, ctx.referrer, site.domain),
    source: ctx.source ?? null,
    medium: ctx.medium ?? null,
    campaign: ctx.campaign ?? null,
    content: ctx.content ?? null,
    valueKop: extra.valueKop ?? null,
  });
}

/** Public part (inside /api/public with the site already resolved). */
export const analyticsPublicRoutes: FastifyPluginAsync = async (app) => {
  app.post("/events", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (BOT.test(String(req.headers["user-agent"] ?? ""))) return reply.code(204).send();
    const site = req.site!;
    if (!(await hasModule(site.organizationId, "analytics"))) return reply.code(403).send({ error: "module_not_active" });
    const p = Event.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    await recordEvent(site, p.data.type, p.data, { path: p.data.path });
    return reply.code(204).send();
  });
};

/** Account part: GET /api/analytics?days=7|30&site=<id>. */
export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);
  app.get<{ Querystring: { days?: string; site?: string } }>("/", async (req, reply) => {
    const orgs = await orgScope(req, "analytics");
    if (!orgs.length) return reply.code(404).send({ error: "not_found" });
    const days = req.query.days === "7" ? 7 : req.query.days === "90" ? 90 : 30;
    const siteIds = (await db.select({ id: sites.id }).from(sites).where(inArray(sites.organizationId, orgs))).map((s) => s.id).filter((id) => !req.query.site || id === req.query.site);
    if (!siteIds.length) return { days, totals: null, series: [], sources: [] };
    const since = new Date(Date.now() - days * 86_400_000);
    const where = and(inArray(analyticsEvents.siteId, siteIds), gt(analyticsEvents.createdAt, since));

    const [tot] = await db
      .select({
        sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number),
        pageviews: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'pageview')`.mapWith(Number),
        leads: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'lead')`.mapWith(Number),
        orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
        revenueKop: dsql<number>`coalesce(sum(${analyticsEvents.valueKop}) filter (where ${analyticsEvents.type} = 'order'), 0)`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(where);

    const day = dsql<string>`to_char(date_trunc('day', ${analyticsEvents.createdAt} at time zone 'Europe/Kyiv'), 'YYYY-MM-DD')`;
    const series = await db
      .select({
        date: day,
        sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number),
        orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(where)
      .groupBy(day)
      .orderBy(day);

    const sources = await db
      .select({
        channel: analyticsEvents.channel,
        campaign: analyticsEvents.campaign,
        sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number),
        leads: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'lead')`.mapWith(Number),
        orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
        revenueKop: dsql<number>`coalesce(sum(${analyticsEvents.valueKop}) filter (where ${analyticsEvents.type} = 'order'), 0)`.mapWith(Number),
        source: dsql<string | null>`max(${analyticsEvents.source})`,
        medium: dsql<string | null>`max(${analyticsEvents.medium})`,
      })
      .from(analyticsEvents)
      .where(where)
      .groupBy(analyticsEvents.channel, analyticsEvents.campaign)
      .orderBy(dsql`count(distinct ${analyticsEvents.session}) desc`)
      .limit(30);

    // Fill days without data so the chart has a continuous axis.
    const byDate = new Map(series.map((s) => [s.date, s]));
    const filled = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
      return byDate.get(d) ?? { date: d, sessions: 0, orders: 0 };
    });
    return { days, totals: { ...tot!, conversion: tot!.sessions ? tot!.orders / tot!.sessions : 0 }, series: filled, sources };
  });
};

export async function purgeAnalytics() {
  await db.delete(analyticsEvents).where(lt(analyticsEvents.createdAt, new Date(Date.now() - RETENTION_DAYS * 86_400_000)));
}

