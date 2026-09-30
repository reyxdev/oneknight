import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { analyticsEvents, contentComments, contentHolidays, contentIdeas, contentSettings, contentTemplates, memberships, notifications, organizations, products, promos, telegramLinks, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { audit } from "../audit.ts";
import { BEST_HOUR, BUCKETS, CHANNELS, RESULT_DAYS, addDays, generatePlan, kyivDay, learningOf, resultsOf, settingsOf } from "./engine.ts";
import { Upload, saveImage } from "../files/store.ts";
import { writeXlsx } from "../files/table.ts";
import { tgCall } from "../notify/bot.ts";
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
  /** The people who can get an idea or be named with @: the owner and members with «Контент». */
  async function team(org: string) {
    const rows = await db.select({ id: users.id, name: users.name, role: memberships.role, permissions: memberships.permissions }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.organizationId, org));
    return rows.filter((r) => r.role === "owner" || r.permissions.includes("content")).map((r) => ({ id: r.id, name: r.name ?? "" }));
  }
  const ideaOf = async (org: string, id: string) => (uuid.safeParse(id).success ? (await db.select().from(contentIdeas).where(and(eq(contentIdeas.id, id), eq(contentIdeas.organizationId, org))))[0] : undefined);

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
      assigneeId: uuid.nullable(),
      video: z.string().trim().url().max(500).refine((u) => /^https:\/\//.test(u)).nullable(),
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
    // Assigned only to someone of the team who works with «Контент»; they get the idea in the bell and Telegram.
    if (p.data.assigneeId && !(await team(a.org)).some((m) => m.id === p.data.assigneeId)) return reply.code(400).send({ error: "invalid_input" });
    if (p.data.assigneeId && p.data.assigneeId !== cur.assigneeId && p.data.assigneeId !== a.userId)
      await db.insert(notifications).values({ organizationId: a.org, userId: p.data.assigneeId, kind: "content", key: "contentAssigned", params: { title: cur.title, day: p.data.day ?? cur.day } });
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
   * The result of a published idea from its UTM link (utm_content = the idea): visits, orders, revenue in the first
   * 7 days after publishing — on the card from day 3, final from day 7 (K81).
   */
  app.get<{ Params: { id: string } }>("/ideas/:id/result", async (req, reply) => {
    const a = await full(req);
    const idea = a && (await ideaOf(a.org, req.params.id));
    if (!a || !idea) return reply.code(404).send({ error: "not_found" });
    if (!idea.publishedAt) return { visits: 0, orders: 0, revenueKop: null, days: 0, final: false };
    const until = new Date(idea.publishedAt.getTime() + RESULT_DAYS * 86_400_000);
    const [r] = await db
      .select({
        visits: dsql<number>`count(distinct ${analyticsEvents.session}) filter (where ${analyticsEvents.type} = 'pageview')`.mapWith(Number),
        orders: dsql<number>`count(*) filter (where ${analyticsEvents.type} = 'order')`.mapWith(Number),
        revenueKop: dsql<number>`coalesce(sum(${analyticsEvents.valueKop}) filter (where ${analyticsEvents.type} = 'order'), 0)`.mapWith(Number),
      })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.organizationId, a.org), eq(analyticsEvents.campaign, "content"), eq(analyticsEvents.content, idea.id.slice(0, 8)), gte(analyticsEvents.createdAt, idea.publishedAt), lte(analyticsEvents.createdAt, until)));
    const m = await activeMembership(req);
    const days = Math.min(RESULT_DAYS, Math.floor((Date.now() - idea.publishedAt.getTime()) / 86_400_000));
    return { ...r!, revenueKop: m?.permissions.includes("finance") ? r!.revenueKop : null, days, final: days >= RESULT_DAYS };
  });

  app.get("/team", async (req, reply) => {
    const a = await full(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    return team(a.org);
  });

  /** Comments on an idea; people named with @ get a notification (only to them). */
  app.get<{ Params: { id: string } }>("/ideas/:id/comments", async (req, reply) => {
    const a = await full(req);
    const idea = a && (await ideaOf(a.org, req.params.id));
    if (!a || !idea) return reply.code(404).send({ error: "not_found" });
    return db.select({ id: contentComments.id, text: contentComments.text, at: contentComments.createdAt, by: users.name, userId: contentComments.userId }).from(contentComments).leftJoin(users, eq(users.id, contentComments.userId)).where(eq(contentComments.ideaId, idea.id)).orderBy(asc(contentComments.createdAt));
  });
  app.post<{ Params: { id: string } }>("/ideas/:id/comments", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const a = await full(req);
    const idea = a && (await ideaOf(a.org, req.params.id));
    const p = z.object({ text: z.string().trim().min(1).max(2000), mentions: z.array(uuid).max(20).default([]) }).safeParse(req.body);
    if (!a || !idea) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const people = await team(a.org);
    const mentions = [...new Set(p.data.mentions)].filter((id) => people.some((x) => x.id === id));
    const [row] = await db.insert(contentComments).values({ organizationId: a.org, ideaId: idea.id, userId: a.userId, text: p.data.text, mentions }).returning();
    const me = people.find((x) => x.id === a.userId)?.name ?? "";
    for (const id of mentions.filter((x) => x !== a.userId)) await db.insert(notifications).values({ organizationId: a.org, userId: id, kind: "content", key: "contentMention", params: { name: me, title: idea.title } });
    return reply.code(201).send(row);
  });

  /** Up to 10 photos on an idea (the team's own shots); a video goes by link (`video` in PATCH). */
  const MAX_IDEA_PHOTOS = 10;
  app.post<{ Params: { id: string } }>("/ideas/:id/photos", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const a = await full(req);
    const idea = a && (await ideaOf(a.org, req.params.id));
    const p = z.object({ photo: Upload }).safeParse(req.body);
    if (!a || !idea) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (idea.photos.length >= MAX_IDEA_PHOTOS) return reply.code(400).send({ error: "too_many_photos" });
    const f = await saveImage(p.data.photo, { organizationId: a.org, uploaderId: a.userId });
    if (!f.ok) return reply.code(400).send({ error: f.error });
    const [row] = await db.update(contentIdeas).set({ photos: [...idea.photos, f.file.id], locked: true }).where(eq(contentIdeas.id, idea.id)).returning();
    return row;
  });
  app.delete<{ Params: { id: string; file: string } }>("/ideas/:id/photos/:file", async (req, reply) => {
    const a = await full(req);
    const idea = a && (await ideaOf(a.org, req.params.id));
    if (!a || !idea) return reply.code(404).send({ error: "not_found" });
    const [row] = await db.update(contentIdeas).set({ photos: idea.photos.filter((x) => x !== req.params.file) }).where(eq(contentIdeas.id, idea.id)).returning();
    return row;
  });

  /** «Повторити через N тижнів»: a copy of the idea (own, kept by refreshes) N weeks later, with its own link. */
  app.post<{ Params: { id: string } }>("/ideas/:id/repeat", async (req, reply) => {
    const a = await full(req);
    const idea = a && (await ideaOf(a.org, req.params.id));
    const p = z.object({ weeks: z.number().int().min(1).max(12) }).safeParse(req.body);
    if (!a || !idea) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const id = randomUUID();
    const { id: _id, createdAt: _c, publishedAt: _p, feedback: _f, ...rest } = idea;
    const [row] = await db
      .insert(contentIdeas)
      .values({ ...rest, id, day: addDays(idea.day, 7 * p.data.weeks), status: "todo", custom: true, locked: true, link: idea.link ? idea.link.replace(/utm_content=[0-9a-f]{8}/, `utm_content=${id.slice(0, 8)}`) : null })
      .returning();
    return reply.code(201).send(row);
  });

  /** «Надіслати собі в Telegram»: the ready text to the person's own linked chat. */
  app.post<{ Params: { id: string } }>("/ideas/:id/telegram", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const a = await full(req);
    const idea = a && (await ideaOf(a.org, req.params.id));
    if (!a || !idea) return reply.code(404).send({ error: "not_found" });
    const [link] = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, a.userId));
    if (!link?.chatId) return reply.code(409).send({ error: "not_linked" });
    const text = [idea.title, "", idea.textShort, idea.cta, idea.link ?? "", idea.hashtags.map((h) => `#${h}`).join(" ")].filter((x, i) => i === 1 || x).join("\n");
    const r = await tgCall("sendMessage", { chat_id: link.chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
    return r.ok ? { ok: true } : reply.code(502).send({ error: "telegram_failed" });
  });

  /** Not posted on their day (the last 7 days): «перенести на сьогодні» or «пропустити» all at once. */
  app.get("/missed", async (req, reply) => {
    const a = await full(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const today = kyivDay();
    return db.select({ id: contentIdeas.id, day: contentIdeas.day, title: contentIdeas.title, channel: contentIdeas.channel }).from(contentIdeas).where(and(eq(contentIdeas.organizationId, a.org), eq(contentIdeas.status, "todo"), lt(contentIdeas.day, today), gte(contentIdeas.day, addDays(today, -7)))).orderBy(asc(contentIdeas.day));
  });
  app.post("/missed", async (req, reply) => {
    const a = await full(req);
    const p = z.object({ action: z.enum(["today", "skip"]) }).safeParse(req.body);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const today = kyivDay();
    const where = and(eq(contentIdeas.organizationId, a.org), eq(contentIdeas.status, "todo"), lt(contentIdeas.day, today), gte(contentIdeas.day, addDays(today, -7)));
    const rows = await db.update(contentIdeas).set(p.data.action === "today" ? { day: today, locked: true } : { status: "skipped", locked: true }).where(where).returning({ id: contentIdeas.id });
    return { n: rows.length };
  });

  /** Export of the plan: Excel (.xlsx) or a calendar (.ics); the A4 print is a page of the panel. */
  app.get<{ Querystring: { format?: string; from?: string; days?: string } }>("/export", async (req, reply) => {
    const a = await full(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const from = dayRe.test(req.query.from ?? "") ? req.query.from! : kyivDay();
    const days = Math.min(92, Math.max(1, Number(req.query.days) || 7));
    const ideas = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, a.org), gte(contentIdeas.day, from), lte(contentIdeas.day, addDays(from, days - 1)), inArray(contentIdeas.status, ["todo", "awaiting", "published"]))).orderBy(asc(contentIdeas.day), asc(contentIdeas.time));
    if (req.query.format === "ics") {
      const esc = (x: string) => x.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      // Kyiv wall time to UTC (the offset of that very day, summer or winter), so no VTIMEZONE block is needed.
      const utc = (day: string, time: string) => {
        const guess = new Date(`${day}T${time}:00Z`);
        const kyiv = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }) + " UTC");
        return new Date(guess.getTime() - (kyiv.getTime() - guess.getTime())).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      };
      // Lines longer than 75 bytes are folded (RFC 5545).
      const fold = (line: string) => {
        const out: string[] = [];
        let cur = "";
        for (const ch of line) {
          if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
          cur += ch;
        }
        out.push(cur);
        return out.join("\r\n ");
      };
      const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ONEKNIGHT//Content plan//UK", "CALSCALE:GREGORIAN"];
      for (const i of ideas) {
        lines.push("BEGIN:VEVENT", `UID:${i.id}@oneknight`, `DTSTAMP:${stamp}`, `DTSTART:${utc(i.day, i.time)}`, "DURATION:PT30M", `SUMMARY:${esc(`${i.channel}: ${i.title}`)}`, `DESCRIPTION:${esc(`${i.textShort}\n\n${i.cta}${i.link ? `\n${i.link}` : ""}`)}`, "END:VEVENT");
      }
      lines.push("END:VCALENDAR");
      return reply.header("content-type", "text/calendar; charset=utf-8").header("content-disposition", `attachment; filename="content-${from}.ics"`).send(lines.map(fold).join("\r\n"));
    }
    const rows: (string | number | null)[][] = [["Дата", "Час", "Канал", "Формат", "Ідея", "Чому", "Що зняти", "Текст", "Заклик", "Хештеги", "Посилання", "Стан"]];
    const st: Record<string, string> = { todo: "Зробити", awaiting: "Чекає погодження", published: "Опубліковано" };
    for (const i of ideas) rows.push([i.day, i.time, i.channel, i.format, i.title, i.why, i.shot, i.textShort, i.cta, i.hashtags.map((h) => `#${h}`).join(" "), i.link, st[i.status] ?? i.status]);
    return reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("content-disposition", `attachment; filename="content-${from}.xlsx"`).send(writeXlsx(rows, "Контент-план"));
  });

  /**
   * «Що дав контент»: published ideas of the last 90 days and what their links brought (the first 7 days of each),
   * by channel and group, the best posts, weeks in a row with a post, and what the plan learned.
   */
  app.get("/stats", async (req, reply) => {
    const a = await full(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const since = addDays(kyivDay(), -90);
    const pub = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, a.org), eq(contentIdeas.status, "published"), isNotNull(contentIdeas.publishedAt), gte(contentIdeas.day, since))).orderBy(desc(contentIdeas.day));
    const res = await resultsOf(a.org, pub);
    const m = await activeMembership(req);
    const finance = !!m?.permissions.includes("finance");
    const sum = (list: typeof pub) => list.reduce((acc, i) => { const r = res.get(i.id); return { posts: acc.posts + 1, visits: acc.visits + (r?.visits ?? 0), orders: acc.orders + (r?.orders ?? 0), revenueKop: acc.revenueKop + (r?.revenueKop ?? 0) }; }, { posts: 0, visits: 0, orders: 0, revenueKop: 0 });
    const group = (key: (i: (typeof pub)[number]) => string) => [...new Set(pub.map(key))].map((k) => ({ key: k, ...sum(pub.filter((i) => key(i) === k)) })).sort((x, y) => y.visits + 5 * y.orders - (x.visits + 5 * x.orders));
    const noMoney = <T extends { revenueKop: number }>(x: T) => (finance ? x : { ...x, revenueKop: null });
    // Weeks in a row (Monday to Sunday) with at least one published idea, counting back from this week or the last.
    const weekOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
    const weeks = new Set(pub.map((i) => weekOf(i.day)));
    let w = weekOf(kyivDay());
    if (!weeks.has(w)) w = addDays(w, -7);
    let streak = 0;
    while (weeks.has(w)) { streak++; w = addDays(w, -7); }
    const learned = await learningOf(a.org, await settingsOf(a.org));
    return {
      total: noMoney(sum(pub)),
      channels: group((i) => i.channel).map(noMoney),
      buckets: group((i) => i.bucket).map(noMoney),
      top: pub.map((i) => ({ id: i.id, day: i.day, channel: i.channel, title: i.title, ...(res.get(i.id) ?? { visits: 0, orders: 0, revenueKop: 0 }) })).filter((x) => x.visits || x.orders).sort((x, y) => y.visits + 5 * y.orders - (x.visits + 5 * x.orders)).slice(0, 5).map(noMoney),
      streak,
      learning: { published: learned.published, needed: 10, shift: learned.shift, bestFormat: learned.bestFormat, bestChannel: learned.bestChannel, disliked: learned.disliked.size },
    };
  });

  /** A promotion before a sale holiday: the next 30 days' holidays without a promotion around them. */
  app.get("/advice", async (req, reply) => {
    const a = await full(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const today = kyivDay();
    const hol = holidaysBetween(await db.select().from(contentHolidays).where(and(eq(contentHolidays.active, true), eq(contentHolidays.kind, "sale"))), addDays(today, 3), addDays(today, 30));
    const mine = await db.select().from(promos).where(and(eq(promos.organizationId, a.org), gte(promos.endsOn, today)));
    return hol
      .filter((h) => !mine.some((p) => p.startsOn <= h.date && p.endsOn >= addDays(h.date, -h.prepDays)))
      .map((h) => ({ name: h.name, date: h.date, startsOn: addDays(h.date, -Math.min(h.prepDays, 7)) < today ? today : addDays(h.date, -Math.min(h.prepDays, 7)), endsOn: h.date }));
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

