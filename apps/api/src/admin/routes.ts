import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { leads, memberships, organizations, sites, users } from "../db/schema.ts";
import { normalizeDomain } from "../monitor/probe.ts";
import { checkSite } from "../monitor/scheduler.ts";
import { requireAuth } from "../auth/routes.ts";
import { audit } from "../audit.ts";

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!req.auth?.user.isAdmin) return reply.code(403).send({ error: "forbidden" });
}

const Status = z.object({ status: z.enum(["new", "in_progress", "won", "lost"]) });
const NewSite = z.object({ organizationId: z.string().uuid(), domain: z.string().max(260), name: z.string().trim().max(100).optional() });
const SiteStatus = z.object({ status: z.enum(["building", "live", "paused"]) });
const uuid = z.string().uuid();

/** Platform administration (Ivan). Every route requires is_admin. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAdmin);

  app.get("/leads", async () => {
    return db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200);
  });

  /** Clients: organizations with their owner and number of sites. */
  app.get("/organizations", async () => {
    const orgs = await db
      .select({ id: organizations.id, name: organizations.name, ownerName: users.name, ownerEmail: users.email, ownerPhone: users.phone, createdAt: organizations.createdAt })
      .from(organizations)
      .leftJoin(memberships, eq(memberships.organizationId, organizations.id))
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.role, "owner"))
      .orderBy(desc(organizations.createdAt));
    const counts = await db.select({ org: sites.organizationId, n: count() }).from(sites).groupBy(sites.organizationId);
    const siteList = await db.select({ id: sites.id, org: sites.organizationId, domain: sites.domain, status: sites.status, lastUp: sites.lastUp }).from(sites);
    return orgs.map((o) => ({ ...o, siteCount: counts.find((c) => c.org === o.id)?.n ?? 0, sites: siteList.filter((s) => s.org === o.id) }));
  });

  app.post("/sites", async (req, reply) => {
    const p = NewSite.safeParse(req.body);
    const domain = p.success ? normalizeDomain(p.data.domain) : null;
    if (!p.success || !domain) return reply.code(400).send({ error: "invalid_domain" });
    try {
      const [site] = await db.insert(sites).values({ organizationId: p.data.organizationId, domain, name: p.data.name || domain }).returning();
      await audit(req, "site.create", req.auth!.user.id, { site: site!.id, domain }, p.data.organizationId);
      void checkSite(site!, req.log).catch(() => {});
      return reply.code(201).send(site);
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === "23505") return reply.code(409).send({ error: "domain_taken" });
      if (code === "23503") return reply.code(400).send({ error: "invalid_input" });
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>("/sites/:id", async (req, reply) => {
    const p = SiteStatus.safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(sites).set({ status: p.data.status }).where(eq(sites.id, req.params.id)).returning({ id: sites.id, status: sites.status });
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  app.delete<{ Params: { id: string } }>("/sites/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    await db.delete(sites).where(eq(sites.id, req.params.id));
    await audit(req, "site.delete", req.auth!.user.id, { site: req.params.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/sites/:id/check", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [site] = await db.select().from(sites).where(eq(sites.id, req.params.id)).limit(1);
    if (!site) return reply.code(404).send({ error: "not_found" });
    return checkSite(site, req.log);
  });

  app.patch<{ Params: { id: string } }>("/leads/:id", async (req, reply) => {
    const p = Status.safeParse(req.body);
    if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(leads).set({ status: p.data.status, updatedAt: new Date() }).where(eq(leads.id, req.params.id)).returning({ id: leads.id, status: leads.status });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await audit(req, "lead.status", req.auth!.user.id, { lead: row.id, status: row.status });
    return row;
  });
};
