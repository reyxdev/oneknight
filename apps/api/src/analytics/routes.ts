import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, inArray, lt, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { adSpend, analyticsEvents, orders, products, sites } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope, activeMembership } from "../auth/access.ts";
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

const Event = Context.extend({
  type: z.enum(["pageview", "lead", "product", "cart", "contact"]),
  path: z.string().max(500).optional(),
  /** product / cart: the product id; contact: which button (phone, viber, telegram, whatsapp). */
  ref: z.string().max(100).optional(),
});
const CONTACTS = ["phone", "viber", "telegram", "whatsapp"];

/** mobile / tablet / desktop from the user agent (the agent itself is never stored). */
export function deviceOf(ua: string) {
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|opera mini|windows phone/i.test(ua)) return "mobile";
  return "desktop";
}

export async function recordEvent(site: { id: string; organizationId: string; domain: string }, type: "pageview" | "lead" | "order" | "product" | "cart" | "contact", ctx: AnalyticsContext, extra: { path?: string; valueKop?: number; ref?: string; device?: string } = {}) {
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
    ref: extra.ref ?? null,
    device: extra.device ?? null,
  });
}

/** Public part (inside /api/public with the site already resolved). */
export const analyticsPublicRoutes: FastifyPluginAsync = async (app) => {
  app.post("/events", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (BOT.test(String(req.headers["user-agent"] ?? ""))) return reply.code(204).send();
    const site = req.site!;
    // Without the module the event is quietly dropped: the client's site console stays clean.
    if (!(await hasModule(site.organizationId, "analytics"))) return reply.code(204).send();
    const p = Event.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const ref = p.data.type === "contact" ? (CONTACTS.includes(p.data.ref ?? "") ? p.data.ref : undefined) : p.data.type === "product" || p.data.type === "cart" ? (z.string().uuid().safeParse(p.data.ref).success ? p.data.ref : undefined) : undefined;
    if ((p.data.type === "product" || p.data.type === "cart" || p.data.type === "contact") && !ref) return reply.code(400).send({ error: "invalid_input" });
    await recordEvent(site, p.data.type, p.data, { path: p.data.path, ref, device: p.data.type === "pageview" ? deviceOf(String(req.headers["user-agent"] ?? "")) : undefined });
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
        contacts: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'contact')`.mapWith(Number),
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
    // «Воронка»: browsing sessions that reached each step (a product page, the cart, an order).
    const [funnel] = await db
      .select({
        visits: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number),
        product: dsql<number>`count(distinct ${analyticsEvents.session}) filter (where ${analyticsEvents.type} = 'product')`.mapWith(Number),
        cart: dsql<number>`count(distinct ${analyticsEvents.session}) filter (where ${analyticsEvents.type} = 'cart')`.mapWith(Number),
        order: dsql<number>`count(distinct ${analyticsEvents.session}) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(where);
    const contacts = await db.select({ ref: analyticsEvents.ref, n: dsql<number>`count(*)`.mapWith(Number) }).from(analyticsEvents).where(and(where, eq(analyticsEvents.type, "contact"))).groupBy(analyticsEvents.ref);
    const pages = await db
      .select({ path: analyticsEvents.path, views: dsql<number>`count(*)`.mapWith(Number), sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number) })
      .from(analyticsEvents)
      .where(and(where, eq(analyticsEvents.type, "pageview")))
      .groupBy(analyticsEvents.path)
      .orderBy(desc(dsql`count(*)`))
      .limit(20);
    const devices = await db
      .select({ device: analyticsEvents.device, sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number) })
      .from(analyticsEvents)
      .where(and(where, eq(analyticsEvents.type, "pageview")))
      .groupBy(analyticsEvents.device);
    // «Товари»: sessions that opened a product vs pieces sold on the site in the same days.
    const views = await db
      .select({ id: analyticsEvents.ref, views: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number), carts: dsql<number>`count(distinct ${analyticsEvents.session}) filter (where ${analyticsEvents.type} = 'cart')`.mapWith(Number) })
      .from(analyticsEvents)
      .where(and(where, inArray(analyticsEvents.type, ["product", "cart"])))
      .groupBy(analyticsEvents.ref)
      .orderBy(desc(dsql`count(distinct ${analyticsEvents.session})`))
      .limit(30);
    const sold = await db.execute<{ pid: string; qty: number; revenue: number }>(dsql`
      select i->>'productId' as pid, sum((i->>'qty')::int)::int as qty, sum((i->>'qty')::int * (i->>'priceKop')::int)::bigint as revenue
      from ${orders}, jsonb_array_elements(${orders.items}) i
      where ${inArray(orders.siteId, siteIds)} and ${orders.createdAt} > ${since.toISOString()}::timestamptz and ${orders.isExample} = false and ${orders.status} not in ('cancelled', 'returned')
      group by 1`);
    const soldBy = new Map([...sold].map((r) => [r.pid, { qty: Number(r.qty), revenueKop: Number(r.revenue) }]));
    const ids = [...new Set([...views.map((v) => v.id), ...soldBy.keys()].filter((x): x is string => !!x && /^[0-9a-f-]{36}$/.test(x)))];
    const names = ids.length ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, ids)) : [];
    const productRows = ids
      .map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? null, views: views.find((v) => v.id === id)?.views ?? 0, carts: views.find((v) => v.id === id)?.carts ?? 0, sold: soldBy.get(id)?.qty ?? 0, revenueKop: soldBy.get(id)?.revenueKop ?? 0 }))
      .filter((r) => r.name)
      .sort((a, b) => b.views - a.views || b.sold - a.sold)
      .slice(0, 30);

    // Without `finance` the money columns are empty (null), the counts stay.
    const finance = (await activeMembership(req))?.permissions.includes("finance") ?? false;
    const totals = { ...tot!, conversion: tot!.sessions ? tot!.orders / tot!.sessions : 0, ...(finance ? {} : { revenueKop: null }) };
    return {
      days,
      totals,
      series: filled,
      sources: finance ? sources : sources.map((s) => ({ ...s, revenueKop: null })),
      funnel: funnel!,
      contacts: Object.fromEntries(contacts.map((c) => [c.ref, c.n])),
      pages,
      devices: Object.fromEntries(devices.map((d) => [d.device ?? "unknown", d.sessions])),
      products: productRows.map((r) => (finance ? r : { ...r, revenueKop: null })),
      finance,
    };
  });

  /**
   * «Реклама»: what was spent (entered by hand) against the orders and revenue of the same channel and campaign in
   * the chosen days. Money, so with «Фінанси» only.
   */
  async function financeOrgs(req: import("fastify").FastifyRequest) {
    const orgs = await orgScope(req, "analytics");
    const m = await activeMembership(req);
    return orgs.length && m?.permissions.includes("finance") ? orgs : [];
  }
  app.get<{ Querystring: { days?: string } }>("/ads", async (req, reply) => {
    const orgs = await financeOrgs(req);
    if (!orgs.length) return reply.code(403).send({ error: "forbidden" });
    const days = req.query.days === "7" ? 7 : req.query.days === "90" ? 90 : 30;
    const since = new Date(Date.now() - days * 86_400_000);
    const sinceDay = since.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
    const spend = await db.select().from(adSpend).where(and(inArray(adSpend.organizationId, orgs), dsql`${adSpend.toDate} >= ${sinceDay}`)).orderBy(desc(adSpend.fromDate));
    const result = await db
      .select({
        channel: analyticsEvents.channel,
        campaign: analyticsEvents.campaign,
        orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
        revenueKop: dsql<number>`coalesce(sum(${analyticsEvents.valueKop}) filter (where ${analyticsEvents.type} = 'order'), 0)`.mapWith(Number),
        sessions: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(and(inArray(analyticsEvents.organizationId, orgs), gt(analyticsEvents.createdAt, since)))
      .groupBy(analyticsEvents.channel, analyticsEvents.campaign);
    // Spend of a channel (a campaign when given) is set against what that channel brought.
    const keys = new Map<string, { channel: string; campaign: string | null; spentKop: number }>();
    for (const s of spend) {
      const k = `${s.channel}\u0000${s.campaign ?? ""}`;
      keys.set(k, { channel: s.channel, campaign: s.campaign, spentKop: (keys.get(k)?.spentKop ?? 0) + s.amountKop });
    }
    const rows = [...keys.values()].map((k) => {
      const got = result.filter((r) => r.channel === k.channel && (!k.campaign || r.campaign === k.campaign));
      const revenueKop = got.reduce((s, r) => s + r.revenueKop, 0);
      const ordersN = got.reduce((s, r) => s + r.orders, 0);
      return { ...k, sessions: got.reduce((s, r) => s + r.sessions, 0), orders: ordersN, revenueKop, roi: k.spentKop ? revenueKop / k.spentKop : null, costPerOrderKop: ordersN ? Math.round(k.spentKop / ordersN) : null };
    });
    return { days, rows, spend };
  });

  const Spend = z.object({ channel: z.string().trim().min(1).max(60), campaign: z.string().trim().max(150).optional(), fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.number().positive().max(10_000_000) });
  app.post("/spend", async (req, reply) => {
    const orgs = await financeOrgs(req);
    const p = Spend.safeParse(req.body);
    if (!orgs.length) return reply.code(403).send({ error: "forbidden" });
    if (!p.success || p.data.toDate < p.data.fromDate) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.insert(adSpend).values({ organizationId: orgs[0]!, channel: p.data.channel.toLowerCase(), campaign: p.data.campaign || null, fromDate: p.data.fromDate, toDate: p.data.toDate, amountKop: Math.round(p.data.amount * 100) }).returning();
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { id: string } }>("/spend/:id", async (req, reply) => {
    const orgs = await financeOrgs(req);
    if (!orgs.length || !z.string().uuid().safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    await db.delete(adSpend).where(and(eq(adSpend.id, req.params.id), inArray(adSpend.organizationId, orgs)));
    return { ok: true };
  });
};

export async function purgeAnalytics() {
  await db.delete(analyticsEvents).where(lt(analyticsEvents.createdAt, new Date(Date.now() - RETENTION_DAYS * 86_400_000)));
}

