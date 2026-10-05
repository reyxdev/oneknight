import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq, ilike, isNull, or, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { contentHolidays, contentTemplates, platformState } from "../db/schema.ts";
import { CHANNELS, rhythmBase } from "../content/engine.ts";
import { calculatorConfig, portfolioSettings } from "../site/landing.ts";
import { incidentsForAdmin, noteIncident } from "../site/status.ts";
import { audit } from "../audit.ts";
import { holidayDate } from "../content/holidays.ts";

const uuid = z.string().uuid();
const TRIGGERS = ["hit", "new", "lowStock", "stale", "discount", "catalog", "review", "promoAnnounce", "promoReminder", "promoLast", "wholesale", "sleeping", "evergreen", "holidaySale", "holidayCollection", "holidayReminder", "holidayGreeting", "holidayRespect"] as const;
const Template = z.object({
  bucket: z.enum(["sale", "benefit", "trust", "fun"]),
  trigger: z.enum(TRIGGERS),
  categories: z.array(z.enum(["clothes", "home", "handmade", "beauty", "tech", "food", "kids", "services"])).max(8),
  title: z.string().trim().min(3).max(120),
  why: z.string().trim().min(3).max(400),
  shot: z.string().trim().min(3).max(300),
  short: z.string().trim().min(3).max(600),
  long: z.string().trim().min(3).max(3000),
  cta: z.string().trim().min(2).max(200),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(10),
  hooks: z.array(z.string().trim().min(1).max(120)).max(5),
  stories: z.array(z.object({ text: z.string().trim().min(1).max(200), sticker: z.enum(["poll", "question", "link", "quiz", "none"]) })).max(6),
  slides: z.array(z.object({ heading: z.string().trim().min(1).max(120), photo: z.string().trim().min(1).max(200) })).max(10),
  article: z.object({ topic: z.string().trim().min(3).max(200), outline: z.array(z.string().trim().min(1).max(200)).min(2).max(10) }).nullable(),
  light: z.boolean(),
  active: z.boolean(),
});

/** Admin «Контент-план»: the idea templates, the holidays (K91–K92). Businesses' own templates are not shown here. */
export const contentAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { bucket?: string; trigger?: string; q?: string } }>("/content/templates", async (req) => {
    const q = req.query.q?.trim();
    const rows = await db
      .select()
      .from(contentTemplates)
      .where(and(isNull(contentTemplates.organizationId), req.query.bucket ? eq(contentTemplates.bucket, req.query.bucket) : undefined, req.query.trigger ? eq(contentTemplates.trigger, req.query.trigger) : undefined, q ? or(ilike(contentTemplates.title, `%${q}%`), ilike(contentTemplates.short, `%${q}%`)) : undefined))
      .orderBy(asc(contentTemplates.bucket), asc(contentTemplates.trigger), asc(contentTemplates.key));
    const counts = await db.select({ bucket: contentTemplates.bucket, n: dsql<number>`count(*) filter (where ${contentTemplates.active})`.mapWith(Number) }).from(contentTemplates).where(isNull(contentTemplates.organizationId)).groupBy(contentTemplates.bucket);
    return { templates: rows, counts: Object.fromEntries(counts.map((c) => [c.bucket, c.n])), triggers: TRIGGERS };
  });

  app.post("/content/templates", async (req, reply) => {
    const p = Template.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.insert(contentTemplates).values({ ...p.data, key: `admin-${p.data.bucket}-${p.data.trigger}-${Date.now().toString(36)}` }).returning();
    await audit(req, "admin.content_template", req.auth!.user.id, { template: row!.id });
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>("/content/templates/:id", async (req, reply) => {
    const p = Template.partial().safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(contentTemplates).set(p.data).where(and(eq(contentTemplates.id, req.params.id), isNull(contentTemplates.organizationId))).returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  /** Status page: incidents and the owner's explanation shown on /status. */
  app.get("/site/incidents", async () => incidentsForAdmin());
  app.patch<{ Params: { id: string } }>("/site/incidents/:id", async (req, reply) => {
    const p = z.object({ note: z.string().trim().max(1000).nullable() }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const row = await noteIncident(req.params.id, p.data.note || null);
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  /** The website calculator on the public site: base prices, product tiers, design, languages, content, range. */
  app.get("/site/calculator", async () => calculatorConfig());
  app.put("/site/calculator", async (req, reply) => {
    const money = z.number().int().min(0).max(1_000_000);
    const p = z
      .object({
        base: z.object({ card: money, service: money, shop: money, corporate: money }),
        products: z.array(z.object({ max: z.number().int().min(1).max(1_000_000).nullable(), add: money })).min(1).max(8).refine((t) => t.filter((x) => x.max === null).length <= 1),
        customDesignPct: z.number().int().min(0).max(300),
        languagePct: z.number().int().min(0).max(300),
        contentPer10: money,
        contentMax: money,
        spreadPct: z.number().int().min(0).max(300),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    await db.insert(platformState).values({ key: "calculator", value: p.data }).onConflictDoUpdate({ target: platformState.key, set: { value: p.data, updatedAt: new Date() } });
    await audit(req, "admin.calculator", req.auth!.user.id, p.data);
    return p.data;
  });

  /** The portfolio: calculator prices, places left with −25%, sites in work now. */
  app.get("/site/portfolio", async () => portfolioSettings());
  app.put("/site/portfolio", async (req, reply) => {
    const money = z.number().int().min(0).max(1_000_000);
    const p = z
      .object({
        prices: z.object({
          base: z.object({ card: money, service: money, shop: money }),
          shopAdd: z.tuple([money, money, money, money.nullable()]),
          serviceAdd: z.tuple([money, money, money]),
          extras: z.object({ logo: money, ads: money, seo: money, support: money }),
          discountPct: z.number().int().min(0).max(90),
          bigShopFrom: money,
        }),
        placesLeft: z.number().int().min(0).max(100),
        buildingNow: z.number().int().min(0).max(100),
        live: z.boolean(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    await db.insert(platformState).values({ key: "portfolio", value: p.data }).onConflictDoUpdate({ target: platformState.key, set: { value: p.data, updatedAt: new Date() } });
    await audit(req, "admin.portfolio", req.auth!.user.id, p.data);
    return p.data;
  });

  /** «Звичайний» ритм каналів (posts a week); «Легкий» / «Активний» are half / one and a half of it. */
  app.get("/content/rhythm", async () => rhythmBase());
  app.put("/content/rhythm", async (req, reply) => {
    const p = z.partialRecord(z.enum(CHANNELS), z.number().int().min(0).max(14)).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const value = { ...(await rhythmBase()), ...p.data };
    await db.insert(platformState).values({ key: "contentRhythm", value }).onConflictDoUpdate({ target: platformState.key, set: { value, updatedAt: new Date() } });
    await audit(req, "admin.content_rhythm", req.auth!.user.id, value);
    return value;
  });

  const Holiday = z.object({ name: z.string().trim().min(2).max(120), rule: z.string().trim().max(40).refine((r) => holidayDate(r, 2030) !== null), kind: z.enum(["sale", "greeting", "respect"]), prepDays: z.number().int().min(0).max(30), active: z.boolean() });
  app.get("/content/holidays", async () => {
    const year = new Date().getFullYear();
    return (await db.select().from(contentHolidays).orderBy(asc(contentHolidays.rule))).map((h) => ({ ...h, next: holidayDate(h.rule, year) }));
  });
  app.post("/content/holidays", async (req, reply) => {
    const p = Holiday.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.insert(contentHolidays).values({ ...p.data, key: `admin-${Date.now().toString(36)}` }).returning();
    return reply.code(201).send(row);
  });
  app.patch<{ Params: { id: string } }>("/content/holidays/:id", async (req, reply) => {
    const p = Holiday.partial().safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(contentHolidays).set(p.data).where(eq(contentHolidays.id, req.params.id)).returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });
};
