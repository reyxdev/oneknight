import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lte, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { analyticsEvents, contentHolidays, contentIdeas, contentSettings, contentTemplates, organizations, products, promos } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { audit } from "../audit.ts";
import { BEST_HOUR, BUCKETS, CHANNELS, addDays, generatePlan, kyivDay, settingsOf } from "./engine.ts";
import { holidaysBetween } from "./holidays.ts";

const uuid = z.string().uuid();
const dayRe = /^\d{4}-\d{2}-\d{2}$/;
/** A business without the module sees 3 real ideas of this week, the rest locked (K88). */
const PREVIEW = 3;

const SettingsIn = z.object({
  channels: z.partialRecord(z.enum(CHANNELS), z.object({ on: z.boolean(), url: z.string().trim().max(300).optional() })),
  brief: z.object({ what: z.string().trim().max(200).optional(), unique: z.string().trim().max(300).optional(), audience: z.string().trim().max(300).optional(), goal: z.enum(["sales", "awareness", "loyal"]).optional(), time: z.enum(["little", "some", "much"]).optional() }),
  voice: z.object({ address: z.enum(["vy", "ty"]), tone: z.enum(["friendly", "business", "playful"]), emoji: z.boolean(), avoid: z.array(z.string().trim().min(1).max(40)).max(30) }),
  rhythm: z.enum(["light", "normal", "active", "custom"]),
  custom: z.partialRecord(z.enum(CHANNELS), z.number().int().min(0).max(14)),
  balance: z.object({ sale: z.number().int().min(0).max(100), benefit: z.number().int().min(0).max(100), trust: z.number().int().min(0).max(100), fun: z.number().int().min(0).max(100) }).refine((b) => b.sale + b.benefit + b.trust + b.fun === 100),
  daysOff: z.array(z.number().int().min(0).max(6)).max(6),
  wholesale: z.object({ min: z.number().int().min(2).max(100_000), discount: z.number().int().min(1).max(90) }).nullable(),
  approval: z.boolean(),
  ownDates: z.array(z.object({ date: z.string().regex(/^\d{2}-\d{2}$/), name: z.string().trim().min(2).max(80) })).max(30),
  tag: z.string().trim().max(40),
  siteId: uuid.nullable(),
}).partial();

/** /api/content: the plan of the business (right «Контент»; the module, or a preview of 3 ideas without it). */
export const contentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);
  async function access(req: FastifyRequest) {
    const m = await activeMembership(req);
    if (!m || !m.permissions.includes("content")) return null;
    const [o] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, m.orgId));
    const installed = await hasModule(m.orgId, "content");
    return { org: m.orgId, userId: req.auth!.user.id, installed, beta: installed || !!o?.features.includes("content"), owner: m.role === "owner" };
  }
  const full = async (req: FastifyRequest) => {
    const a = await access(req);
    return a?.installed ? a : null;
  };

  app.get("/settings", async (req, reply) => {
    const a = await access(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const [row] = await db.select().from(contentSettings).where(eq(contentSettings.organizationId, a.org));
    return { settings: await settingsOf(a.org), configured: !!row && Object.keys(row.settings as object).length > 0, installed: a.installed, beta: a.beta, channels: CHANNELS, hours: BEST_HOUR };
  });

  app.put("/settings", async (req, reply) => {
    const a = await full(req);
    const p = SettingsIn.safeParse(req.body);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const next = { ...(await settingsOf(a.org)), ...p.data };
    await db.insert(contentSettings).values({ organizationId: a.org, settings: next }).onConflictDoUpdate({ target: contentSettings.organizationId, set: { settings: next, updatedAt: new Date() } });
    // New settings shape the future ideas at once (what the team touched stays).
    const r = await generatePlan(a.org);
    return { settings: next, made: r.made };
  });

  /**
   * The plan for [from, from + days): ideas, holidays and promotions as markers. Built on the first visit and
   * refreshed weekly (and by «Оновити план»). Without the module: this week's first 3 ideas, the rest counted.
   */
  app.get<{ Querystring: { from?: string; days?: string; channel?: string } }>("/plan", async (req, reply) => {
    const a = await access(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const from = dayRe.test(req.query.from ?? "") ? req.query.from! : kyivDay();
    const days = Math.min(42, Math.max(1, Number(req.query.days) || 7));
    const to = addDays(from, days - 1);
    const [st] = await db.select({ at: contentSettings.generatedAt }).from(contentSettings).where(eq(contentSettings.organizationId, a.org));
    if (!st?.at) await generatePlan(a.org);
    const ch = (CHANNELS as readonly string[]).includes(req.query.channel ?? "") ? req.query.channel! : null;
    let ideas = await db
      .select()
      .from(contentIdeas)
      .where(and(eq(contentIdeas.organizationId, a.org), gte(contentIdeas.day, from), lte(contentIdeas.day, to), ch ? eq(contentIdeas.channel, ch) : undefined))
      .orderBy(asc(contentIdeas.day), asc(contentIdeas.time));
    let locked = 0;
    if (!a.installed) {
      const today = kyivDay();
      const week = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, a.org), gte(contentIdeas.day, today), lte(contentIdeas.day, addDays(today, 6)))).orderBy(asc(contentIdeas.day), asc(contentIdeas.time));
      locked = Math.max(0, week.length - PREVIEW);
      ideas = week.slice(0, PREVIEW);
    }
    const holidays = holidaysBetween(await db.select().from(contentHolidays).where(eq(contentHolidays.active, true)), from, to).map((h) => ({ date: h.date, name: h.name, kind: h.kind }));
    const promoList = await db.select().from(promos).where(and(eq(promos.organizationId, a.org), gte(promos.endsOn, from), lte(promos.startsOn, to)));
    const photos = ideas.map((i) => i.productId).filter((x): x is string => !!x);
    const prodRows = photos.length ? await db.select({ id: products.id, name: products.name, photos: products.photos }).from(products).where(inArray(products.id, photos)) : [];
    return {
      from,
      days,
      installed: a.installed,
      beta: a.beta,
      locked,
      ideas: ideas.map((i) => ({ ...i, product: i.productId ? prodRows.find((p) => p.id === i.productId) ?? null : null })),
      holidays,
      promos: promoList,
    };
  });

  app.post("/plan/refresh", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const a = await full(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    return generatePlan(a.org);
  });

  /** The ideas of today (Home «Сьогодні запостити»). */
  app.get("/today", async (req, reply) => {
    const a = await full(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    return db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, a.org), eq(contentIdeas.day, kyivDay()))).orderBy(asc(contentIdeas.time));
  });

  const Patch = z
    .object({
      day: z.string().regex(dayRe),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      channel: z.enum(CHANNELS),
      title: z.string().trim().min(1).max(120),
      textShort: z.string().trim().max(2200),
      textLong: z.string().trim().max(5000),
      cta: z.string().trim().max(200),
      hashtags: z.array(z.string().trim().min(1).max(60)).max(30),
      status: z.enum(["todo", "published", "skipped", "awaiting"]),
      feedback: z.union([z.literal(1), z.literal(-1)]).nullable(),
    })
    .partial();
  /** Editing, moving to another day, «Опубліковано», 👍 / 👎: the idea is the team's now and a refresh keeps it. */
  app.patch<{ Params: { id: string } }>("/ideas/:id", async (req, reply) => {
    const a = await full(req);
    const p = Patch.safeParse(req.body);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [cur] = await db.select().from(contentIdeas).where(and(eq(contentIdeas.id, req.params.id), eq(contentIdeas.organizationId, a.org)));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    const s = await settingsOf(a.org);
    // With approval on, only the owner moves an idea out of «чекає погодження».
    if (s.approval && cur.status === "awaiting" && p.data.status && p.data.status !== "awaiting" && !a.owner) return reply.code(403).send({ error: "owner_approves" });
    const [row] = await db
      .update(contentIdeas)
      .set({ ...p.data, locked: true, ...(p.data.status === "published" ? { publishedAt: new Date() } : p.data.status ? { publishedAt: null } : {}) })
      .where(eq(contentIdeas.id, cur.id))
      .returning();
    return row;
  });

  /** «Інша ідея»: the same day and channel, another template (and product). */
  app.post<{ Params: { id: string } }>("/ideas/:id/other", async (req, reply) => {
    const a = await full(req);
    if (!a || !uuid.safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    const [cur] = await db.select().from(contentIdeas).where(and(eq(contentIdeas.id, req.params.id), eq(contentIdeas.organizationId, a.org)));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    // The old idea is set aside as «пропущено» (so its template is not picked again right away); the other ideas of
    // the day are held for a moment, so only this slot is filled again.
    await db.update(contentIdeas).set({ status: "skipped", locked: true }).where(eq(contentIdeas.id, cur.id));
    const held = await db.update(contentIdeas).set({ locked: true }).where(and(eq(contentIdeas.organizationId, a.org), eq(contentIdeas.day, cur.day), eq(contentIdeas.locked, false))).returning({ id: contentIdeas.id });
    const before = new Set((await db.select({ id: contentIdeas.id }).from(contentIdeas).where(and(eq(contentIdeas.organizationId, a.org), eq(contentIdeas.day, cur.day)))).map((x) => x.id));
    await generatePlan(a.org, { from: cur.day, days: 1, seed: Date.now() % 100_000 });
    if (held.length) await db.update(contentIdeas).set({ locked: false }).where(inArray(contentIdeas.id, held.map((h) => h.id)));
    const [fresh] = (await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, a.org), eq(contentIdeas.day, cur.day)))).filter((x) => !before.has(x.id));
    if (!fresh) {
      await db.update(contentIdeas).set({ status: cur.status, locked: cur.locked }).where(eq(contentIdeas.id, cur.id));
      return reply.code(409).send({ error: "no_other" });
    }
    await db.delete(contentIdeas).where(eq(contentIdeas.id, cur.id));
    return fresh;
  });

  /** «+ Своя ідея» on any day. */
  const Own = z.object({ day: z.string().regex(dayRe), channel: z.enum(CHANNELS), title: z.string().trim().min(1).max(120), text: z.string().trim().max(5000).default(""), time: z.string().regex(/^\d{2}:\d{2}$/).optional() });
  app.post("/ideas", async (req, reply) => {
    const a = await full(req);
    const p = Own.safeParse(req.body);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const id = randomUUID();
    const [row] = await db
      .insert(contentIdeas)
      .values({ id, organizationId: a.org, day: p.data.day, time: p.data.time ?? BEST_HOUR[p.data.channel], channel: p.data.channel, format: p.data.channel === "site" ? "article" : "post", bucket: "own", trigger: "own", title: p.data.title, why: "Ваша ідея.", shot: "", textShort: p.data.text.slice(0, 2200), textLong: p.data.text, cta: "", custom: true, locked: true })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { id: string } }>("/ideas/:id", async (req, reply) => {
    const a = await full(req);
    if (!a || !uuid.safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    const [cur] = await db.select().from(contentIdeas).where(and(eq(contentIdeas.id, req.params.id), eq(contentIdeas.organizationId, a.org)));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    // A generated idea is kept as «пропущено» (its template waits before coming back); an own one is deleted.
    if (cur.custom) await db.delete(contentIdeas).where(eq(contentIdeas.id, cur.id));
    else await db.update(contentIdeas).set({ status: "skipped", locked: true }).where(eq(contentIdeas.id, cur.id));
    return { ok: true };
  });

  /** «Зберегти як шаблон»: the business's own template made from this idea (its texts as they are now). */
  app.post<{ Params: { id: string } }>("/ideas/:id/template", async (req, reply) => {
    const a = await full(req);
    if (!a || !uuid.safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    const [cur] = await db.select().from(contentIdeas).where(and(eq(contentIdeas.id, req.params.id), eq(contentIdeas.organizationId, a.org)));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    const bucket = (BUCKETS as readonly string[]).includes(cur.bucket) ? cur.bucket : "trust";
    const [t] = await db
      .insert(contentTemplates)
      .values({ key: `own-${a.org.slice(0, 8)}-${randomUUID().slice(0, 8)}`, organizationId: a.org, bucket, trigger: "evergreen", title: cur.title, why: "Ваш збережений шаблон.", shot: cur.shot || "Фото за вашим вибором.", short: cur.textShort, long: cur.textLong || cur.textShort, cta: cur.cta, hashtags: cur.hashtags, hooks: cur.extra.hooks ?? [], stories: cur.extra.stories ?? [], slides: cur.extra.slides ?? [], article: cur.extra.article ?? null, light: cur.format === "stories" })
      .returning({ id: contentTemplates.id });
    return reply.code(201).send(t);
  });

  /**
   * The result of a published idea from its UTM link (utm_content = the idea): visits, orders, revenue — shown on
   * the card from 3 days after publishing (K81).
   */
  app.get<{ Params: { id: string } }>("/ideas/:id/result", async (req, reply) => {
    const a = await full(req);
    if (!a || !uuid.safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    const [r] = await db
      .select({
        visits: dsql<number>`count(distinct ${analyticsEvents.session})`.mapWith(Number),
        orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
        revenueKop: dsql<number>`coalesce(sum(${analyticsEvents.valueKop}) filter (where ${analyticsEvents.type} = 'order'), 0)`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.organizationId, a.org), eq(analyticsEvents.campaign, "content"), eq(analyticsEvents.content, req.params.id.slice(0, 8))));
    const m = await activeMembership(req);
    return { ...r!, revenueKop: m?.permissions.includes("finance") ? r!.revenueKop : null };
  });

  // «Акції»: the business's own promotions with dates; the plan announces, reminds and says «останній день».
  const Promo = z.object({ name: z.string().trim().min(2).max(120), discount: z.number().int().min(1).max(90).nullable().optional(), productIds: z.array(uuid).max(200).default([]), startsOn: z.string().regex(dayRe), endsOn: z.string().regex(dayRe) }).refine((p) => p.endsOn >= p.startsOn);
  app.get("/promos", async (req, reply) => {
    const a = await access(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    return db.select().from(promos).where(eq(promos.organizationId, a.org)).orderBy(asc(promos.startsOn));
  });
  app.post("/promos", async (req, reply) => {
    const a = await full(req);
    const p = Promo.safeParse(req.body);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.insert(promos).values({ organizationId: a.org, name: p.data.name, discount: p.data.discount ?? null, productIds: p.data.productIds, startsOn: p.data.startsOn, endsOn: p.data.endsOn }).returning();
    await audit(req, "content.promo", a.userId, { promo: row!.id }, a.org);
    await generatePlan(a.org);
    return reply.code(201).send(row);
  });
  app.delete<{ Params: { id: string } }>("/promos/:id", async (req, reply) => {
    const a = await full(req);
    if (!a || !uuid.safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    await db.delete(promos).where(and(eq(promos.id, req.params.id), eq(promos.organizationId, a.org)));
    await generatePlan(a.org);
    return { ok: true };
  });
};

