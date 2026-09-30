import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { moduleCatalog } from "@oneknight/domain";
import { db } from "../db/client.ts";
import { broadcasts, ideas, moduleInstalls, notifications, organizations, subscriptions, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { notifyOwner } from "../notify/telegram.ts";

const uuid = z.string().uuid();
const Segment = z.union([z.enum(["all", "trial", "debt"]), z.string().regex(/^module:[a-z-]{2,30}$/)]);
const Message = z.object({ title: z.string().trim().min(3).max(120), text: z.string().trim().min(3).max(2000), segment: Segment });
const IDEA_STATUSES = ["new", "planned", "done", "declined"] as const;

/** Businesses of a segment: all (with data), on trial, with a debt (grace or suspended), with a module installed. */
export async function segmentOrgs(segment: string) {
  const alive = isNull(organizations.purgedAt);
  if (segment === "all") return (await db.select({ id: organizations.id }).from(organizations).where(alive)).map((r) => r.id);
  if (segment === "trial" || segment === "debt") {
    const statuses = segment === "trial" ? (["trial"] as const) : (["grace", "suspended"] as const);
    return (await db.select({ id: organizations.id }).from(organizations).innerJoin(subscriptions, eq(subscriptions.organizationId, organizations.id)).where(and(alive, inArray(subscriptions.status, [...statuses])))).map((r) => r.id);
  }
  const moduleId = segment.slice(7);
  return (await db.select({ id: organizations.id }).from(organizations).innerJoin(moduleInstalls, eq(moduleInstalls.organizationId, organizations.id)).where(and(alive, eq(moduleInstalls.moduleId, moduleId)))).map((r) => r.id);
}

/** Admin «Комунікації»: messages to all or a segment (preview, a test to Ivan's Telegram, send), and ideas. */
export const commsAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/broadcasts", async () => ({
    list: await db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(50),
    modules: moduleCatalog.filter((m) => m.live).map((m) => m.id),
  }));

  app.post("/broadcasts/count", async (req, reply) => {
    const p = z.object({ segment: Segment }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    return { recipients: (await segmentOrgs(p.data.segment)).length };
  });

  /** «Тест собі»: the same text to Ivan's Telegram before sending it to clients. */
  app.post("/broadcasts/test", async (req, reply) => {
    const p = Message.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    return { sent: await notifyOwner(`📣 ${p.data.title}\n${p.data.text}`, req.log) };
  });

  /** Sends: every business of the segment gets it in the bell; its owner in Telegram too (their «Оплата» channel). */
  app.post("/broadcasts", async (req, reply) => {
    const p = Message.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const orgs = await segmentOrgs(p.data.segment);
    if (!orgs.length) return reply.code(409).send({ error: "empty_segment" });
    for (let i = 0; i < orgs.length; i += 500) await db.insert(notifications).values(orgs.slice(i, i + 500).map((organizationId) => ({ organizationId, kind: "billing", key: "broadcast", params: { title: p.data.title, text: p.data.text } })));
    const [b] = await db.insert(broadcasts).values({ ...p.data, recipients: orgs.length, createdBy: req.auth!.user.id }).returning();
    await audit(req, "admin.broadcast", req.auth!.user.id, { segment: p.data.segment, recipients: orgs.length });
    return reply.code(201).send(b);
  });

  app.get("/ideas", async () =>
    db
      .select({ id: ideas.id, text: ideas.text, status: ideas.status, createdAt: ideas.createdAt, org: organizations.name, by: users.name })
      .from(ideas)
      .leftJoin(organizations, eq(organizations.id, ideas.organizationId))
      .leftJoin(users, eq(users.id, ideas.userId))
      .orderBy(dsql`case ${ideas.status} when 'new' then 0 when 'planned' then 1 else 2 end`, desc(ideas.createdAt))
      .limit(300),
  );

  /** «Зроблено» tells the business that suggested it. */
  app.patch<{ Params: { id: string } }>("/ideas/:id", async (req, reply) => {
    const p = z.object({ status: z.enum(IDEA_STATUSES) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [cur] = await db.select().from(ideas).where(eq(ideas.id, req.params.id));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    await db.update(ideas).set({ status: p.data.status, updatedAt: new Date() }).where(eq(ideas.id, cur.id));
    if (p.data.status === "done" && cur.status !== "done" && cur.organizationId) await db.insert(notifications).values({ organizationId: cur.organizationId, kind: "billing", key: "ideaDone", params: { text: cur.text.slice(0, 80) } });
    return { ok: true };
  });
};

/** «Запропонувати ідею» from the panel: /api/ideas. */
export const ideaRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);
  app.post("/", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = z.object({ text: z.string().trim().min(10).max(2000) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const m = await activeMembership(req);
    await db.insert(ideas).values({ organizationId: m?.orgId ?? null, userId: req.auth!.user.id, text: p.data.text });
    await notifyOwner(`💡 Ідея від ${req.auth!.user.name}: ${p.data.text.slice(0, 500)}`, req.log);
    return reply.code(201).send({ ok: true });
  });
  app.get("/mine", async (req) =>
    db.select({ id: ideas.id, text: ideas.text, status: ideas.status, createdAt: ideas.createdAt }).from(ideas).where(eq(ideas.userId, req.auth!.user.id)).orderBy(desc(ideas.createdAt)).limit(50),
  );
};
