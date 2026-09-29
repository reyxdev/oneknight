import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { notifications, sites } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope } from "../auth/access.ts";
import { lastChecks } from "../monitor/scheduler.ts";
import { sitesWithStats } from "./stats.ts";

export const Appearance = z.object({
  buttonAnim: z.enum(["none", "lift", "pulse", "shine"]),
  hover: z.enum(["none", "glow", "underline", "scale"]),
  sound: z.enum(["off", "soft", "glass", "wood"]),
  notice: z.enum(["toast", "banner", "minimal"]),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export const siteRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/sites", async (req) => sitesWithStats(await orgScope(req)));

  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>("/sites/:id/checks", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const orgs = await orgScope(req);
    const [site] = orgs.length ? await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, req.params.id), inArray(sites.organizationId, orgs))).limit(1) : [];
    if (!site) return reply.code(404).send({ error: "not_found" });
    const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
    return lastChecks(site.id, new Date(Date.now() - hours * 3600_000));
  });

  /** Look and feel the client's site applies through ok.js. Needs the "site" permission to change. */
  app.patch<{ Params: { id: string } }>("/sites/:id/appearance", async (req, reply) => {
    const p = Appearance.safeParse(req.body);
    const orgs = await orgScope(req, "site");
    if (!p.success || !z.string().uuid().safeParse(req.params.id).success || !orgs.length) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(sites).set({ appearance: p.data }).where(and(eq(sites.id, req.params.id), inArray(sites.organizationId, orgs))).returning({ appearance: sites.appearance });
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/notifications", async (req) => {
    const orgs = await orgScope(req);
    if (!orgs.length) return [];
    return db
      .select({ id: notifications.id, kind: notifications.kind, key: notifications.key, params: notifications.params, read: notifications.readAt, at: notifications.createdAt })
      .from(notifications)
      .where(inArray(notifications.organizationId, orgs))
      .orderBy(desc(notifications.createdAt))
      .limit(30)
      .then((rows) => rows.map((r) => ({ ...r, read: r.read !== null })));
  });

  app.post("/notifications/read", async (req) => {
    const orgs = await orgScope(req);
    if (orgs.length) await db.update(notifications).set({ readAt: new Date() }).where(and(inArray(notifications.organizationId, orgs), isNull(notifications.readAt)));
    return { ok: true };
  });
};
