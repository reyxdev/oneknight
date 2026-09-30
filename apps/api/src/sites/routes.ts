import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { notifications, siteAudits, sites } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership, orgScope, type Permission } from "../auth/access.ts";
import { KIND_PERM } from "../notify/bot.ts";
import { lastChecks } from "../monitor/scheduler.ts";
import { sitesWithStats } from "./stats.ts";
import { normalizeDomain } from "../monitor/probe.ts";
import { audit } from "../audit.ts";
import { runAudit, verifySite } from "./audit.ts";

export const siteRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/sites", async (req) => sitesWithStats(await orgScope(req)));

  /** A site of the active business that the member may manage (right `site`). */
  async function manage(req: import("fastify").FastifyRequest, id: string) {
    if (!z.string().uuid().safeParse(id).success) return null;
    const orgs = await orgScope(req, "site");
    const [s] = orgs.length ? await db.select().from(sites).where(and(eq(sites.id, id), inArray(sites.organizationId, orgs))) : [];
    return s ?? null;
  }

  /**
   * «Додати сайт»: the client adds the domain; it waits for ok.js (found on the page → confirmed, monitored and,
   * from the second website on, +149 грн/міс).
   */
  app.post("/sites", async (req, reply) => {
    const p = z.object({ domain: z.string().max(260), name: z.string().trim().max(100).optional() }).safeParse(req.body);
    const domain = p.success ? normalizeDomain(p.data.domain) : null;
    if (!p.success || !domain) return reply.code(400).send({ error: "invalid_domain" });
    const [org] = await orgScope(req, "site");
    if (!org) return reply.code(403).send({ error: "forbidden" });
    const [taken] = await db.select({ id: sites.id }).from(sites).where(eq(sites.domain, domain));
    if (taken) return reply.code(409).send({ error: "domain_taken" });
    const [site] = await db.insert(sites).values({ organizationId: org, domain, name: p.data.name || domain }).returning();
    await audit(req, "site.add", req.auth!.user.id, { site: site!.id, domain }, org);
    return reply.code(201).send({ id: site!.id, domain, publicKey: site!.publicKey });
  });

  /** «Перевірити зараз»: looks for ok.js on the domain. */
  app.post<{ Params: { id: string } }>("/sites/:id/verify", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const s = await manage(req, req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    return { verified: await verifySite(s) };
  });

  /** Name and settings: «Зроблено на ONEKNIGHT», the widgets and «вимкнути всі». */
  const Settings = z.object({ poweredBy: z.boolean(), widgetsOff: z.boolean(), socialProof: z.boolean(), reviewsBlock: z.boolean(), stars: z.boolean() }).partial();
  app.patch<{ Params: { id: string } }>("/sites/:id", async (req, reply) => {
    const p = z.object({ name: z.string().trim().min(1).max(100).optional(), settings: Settings.optional() }).safeParse(req.body);
    const s = await manage(req, req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db
      .update(sites)
      .set({ ...(p.data.name ? { name: p.data.name } : {}), ...(p.data.settings ? { settings: { ...s.settings, ...p.data.settings } } : {}) })
      .where(eq(sites.id, s.id))
      .returning({ name: sites.name, settings: sites.settings });
    return row;
  });

  /** Only a site still waiting for ok.js can be removed by the client (a working one keeps orders and products). */
  app.delete<{ Params: { id: string } }>("/sites/:id", async (req, reply) => {
    const s = await manage(req, req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (s.verifiedAt) return reply.code(409).send({ error: "verified" });
    await db.delete(sites).where(eq(sites.id, s.id));
    await audit(req, "site.remove", req.auth!.user.id, { domain: s.domain }, s.organizationId);
    return { ok: true };
  });

  /** «Перевірка якості»: the last audit and the history of results. */
  app.get<{ Params: { id: string } }>("/sites/:id/audit", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const orgs = await orgScope(req);
    const [s] = orgs.length ? await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, req.params.id), inArray(sites.organizationId, orgs))) : [];
    if (!s) return reply.code(404).send({ error: "not_found" });
    const rows = await db.select().from(siteAudits).where(eq(siteAudits.siteId, s.id)).orderBy(desc(siteAudits.createdAt)).limit(12);
    return { last: rows[0] ?? null, history: rows.map((r) => ({ at: r.createdAt, passed: r.passed, total: r.total })) };
  });

  app.post<{ Params: { id: string } }>("/sites/:id/audit", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req, reply) => {
    const s = await manage(req, req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (!s.verifiedAt) return reply.code(409).send({ error: "not_verified" });
    try {
      return await runAudit(s);
    } catch {
      return reply.code(502).send({ error: "site_unreachable" });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>("/sites/:id/checks", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const orgs = await orgScope(req);
    const [site] = orgs.length ? await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, req.params.id), inArray(sites.organizationId, orgs))).limit(1) : [];
    if (!site) return reply.code(404).send({ error: "not_found" });
    const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
    return lastChecks(site.id, new Date(Date.now() - hours * 3600_000));
  });

  /** The bell: only kinds the member may see (same rule as Telegram); without `finance`, no order sums. */
  app.get("/notifications", async (req) => {
    const m = await activeMembership(req);
    if (!m) return [];
    const orgs = [m.orgId];
    const finance = m.permissions.includes("finance");
    return db
      .select({ id: notifications.id, kind: notifications.kind, key: notifications.key, params: notifications.params, read: notifications.readAt, at: notifications.createdAt })
      .from(notifications)
      .where(and(inArray(notifications.organizationId, orgs), or(isNull(notifications.userId), eq(notifications.userId, req.auth!.user.id))))
      .orderBy(desc(notifications.createdAt))
      .limit(30)
      .then((rows) =>
        rows
          .filter((r) => !KIND_PERM[r.kind] || m.permissions.includes(KIND_PERM[r.kind] as Permission))
          .map((r) => {
            const { total: _t, ...rest } = r.params as Record<string, unknown>;
            return { ...r, params: finance || r.key !== "newOrder" ? r.params : rest, read: r.read !== null };
          }),
      );
  });

  app.post("/notifications/read", async (req) => {
    const orgs = await orgScope(req);
    if (orgs.length) await db.update(notifications).set({ readAt: new Date() }).where(and(inArray(notifications.organizationId, orgs), isNull(notifications.readAt)));
    return { ok: true };
  });
};
