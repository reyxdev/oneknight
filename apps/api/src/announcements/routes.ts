import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, isNull, lte, notExists, or, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { announcementDismissals, announcements, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { audit } from "../audit.ts";

const Item = z.object({
  kind: z.enum(["banner", "news"]),
  title: z.string().trim().min(2).max(120),
  text: z.string().trim().max(1000).default(""),
  link: z.string().trim().max(300).regex(/^(#[a-z0-9/-]+|https:\/\/\S+)$/).optional().or(z.literal("")),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

/** /api/announcements: the banner and «Що нового» for everyone in the panel; the admin writes them. */
export const announcementRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /** The latest active banner the person has not closed, and the news with the unread count. */
  app.get("/", async (req) => {
    const now = new Date();
    const userId = req.auth!.user.id;
    const [banner] = await db
      .select({ id: announcements.id, title: announcements.title, text: announcements.text, link: announcements.link })
      .from(announcements)
      .where(
        and(
          eq(announcements.kind, "banner"),
          lte(announcements.startsAt, now),
          or(isNull(announcements.endsAt), gt(announcements.endsAt, now)),
          notExists(db.select().from(announcementDismissals).where(and(eq(announcementDismissals.announcementId, announcements.id), eq(announcementDismissals.userId, userId)))),
        ),
      )
      .orderBy(desc(announcements.startsAt))
      .limit(1);
    const news = await db
      .select({ id: announcements.id, title: announcements.title, text: announcements.text, link: announcements.link, at: announcements.startsAt })
      .from(announcements)
      .where(and(eq(announcements.kind, "news"), lte(announcements.startsAt, now)))
      .orderBy(desc(announcements.startsAt))
      .limit(10);
    const [u] = await db.select({ seen: users.newsSeenAt }).from(users).where(eq(users.id, userId));
    return { banner: banner ?? null, news, unread: news.filter((n) => !u?.seen || n.at > u.seen).length };
  });

  app.post<{ Params: { id: string } }>("/:id/dismiss", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    await db.insert(announcementDismissals).values({ userId: req.auth!.user.id, announcementId: req.params.id }).onConflictDoNothing();
    return { ok: true };
  });

  app.post("/seen", async (req) => {
    await db.update(users).set({ newsSeenAt: new Date() }).where(eq(users.id, req.auth!.user.id));
    return { ok: true };
  });

  // ---- admin ----
  app.get("/all", async (req, reply) => {
    if (!req.auth!.user.isAdmin) return reply.code(403).send({ error: "forbidden" });
    return db
      .select({
        id: announcements.id,
        kind: announcements.kind,
        title: announcements.title,
        text: announcements.text,
        link: announcements.link,
        startsAt: announcements.startsAt,
        endsAt: announcements.endsAt,
        closed: dsql<number>`(select count(*) from ${announcementDismissals} d where d.announcement_id = ${announcements.id})`.mapWith(Number),
      })
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(100);
  });

  app.post("/", async (req, reply) => {
    if (!req.auth!.user.isAdmin) return reply.code(403).send({ error: "forbidden" });
    const p = Item.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db
      .insert(announcements)
      .values({ kind: p.data.kind, title: p.data.title, text: p.data.text, link: p.data.link || null, startsAt: p.data.startsAt ? new Date(p.data.startsAt) : new Date(), endsAt: p.data.endsAt ? new Date(p.data.endsAt) : null, createdBy: req.auth!.user.id })
      .returning();
    await audit(req, "admin.announcement", req.auth!.user.id, { kind: p.data.kind, title: p.data.title });
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!req.auth!.user.isAdmin || !z.string().uuid().safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    await db.delete(announcements).where(eq(announcements.id, req.params.id));
    return { ok: true };
  });
};
