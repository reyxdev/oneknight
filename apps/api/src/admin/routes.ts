import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { analyticsEvents, customers, integrations, memberships, moduleInstalls, orderStatuses, orders, organizations, products, reviews, sites, subscriptions, users } from "../db/schema.ts";
import { normalizeDomain } from "../monitor/probe.ts";
import { checkSite } from "../monitor/scheduler.ts";
import { DELETE_AFTER_DAYS, billingOverview, confirmTopup, startTrial } from "../billing/service.ts";
import { supportAdminRoutes } from "../support/routes.ts";
import { keyAdminRoutes } from "../billing/admin-keys.ts";
import { createReset } from "../auth/reset.ts";
import { topups } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { audit } from "../audit.ts";
import { overview } from "./overview.ts";
import { projectAdminRoutes } from "../projects/routes.ts";
import { adminClientRoutes } from "./clients.ts";
import { commsAdminRoutes } from "./comms.ts";
import { contentAdminRoutes } from "./content.ts";

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!req.auth?.user.isAdmin) return reply.code(403).send({ error: "forbidden" });
}

const NewSite = z.object({ organizationId: z.string().uuid(), domain: z.string().max(260), name: z.string().trim().max(100).optional() });
const SiteStatus = z.object({ status: z.enum(["building", "live", "paused"]) });
const uuid = z.string().uuid();

/** Platform administration (Ivan). Every route requires is_admin. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAdmin);
  await app.register(supportAdminRoutes, { prefix: "/tickets" });
  await app.register(keyAdminRoutes);
  await app.register(projectAdminRoutes);
  await app.register(adminClientRoutes);
  await app.register(commsAdminRoutes);
  await app.register(contentAdminRoutes);

  /** «Огляд»: Ivan's to-do first, then the numbers and «Ризик відтоку». */
  app.get("/overview", async () => overview());

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
    const subs = await db.select({ org: subscriptions.organizationId, status: subscriptions.status, periodEnd: subscriptions.periodEnd, suspendedAt: subscriptions.suspendedAt }).from(subscriptions);
    const purged = new Map((await db.select({ id: organizations.id, at: organizations.purgedAt }).from(organizations)).map((x) => [x.id, x.at]));
    const deletable = (s: (typeof subs)[number] | undefined) => !!s && s.status === "suspended" && !!s.suspendedAt && Date.now() - s.suspendedAt.getTime() >= DELETE_AFTER_DAYS * 86_400_000;
    return orgs.map((o) => {
      const sub = subs.find((x) => x.org === o.id);
      return { ...o, siteCount: counts.find((c) => c.org === o.id)?.n ?? 0, sites: siteList.filter((s) => s.org === o.id), subscription: sub ?? null, deletable: deletable(sub) && !purged.get(o.id), purgedAt: purged.get(o.id) ?? null };
    });
  });

  app.post("/sites", async (req, reply) => {
    const p = NewSite.safeParse(req.body);
    const domain = p.success ? normalizeDomain(p.data.domain) : null;
    if (!p.success || !domain) return reply.code(400).send({ error: "invalid_domain" });
    try {
      const [site] = await db.insert(sites).values({ organizationId: p.data.organizationId, domain, name: p.data.name || domain, verifiedAt: new Date() }).returning();
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

  /**
   * «Видалити дані» (owner's decision: the admin confirms): a business suspended for 90+ days loses its orders,
   * customers, products, websites, reviews, integrations and settings. The account, the login, the ledger and
   * support requests stay.
   */
  app.post<{ Params: { id: string } }>("/organizations/:id/purge", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, req.params.id));
    if (!s || s.status !== "suspended" || !s.suspendedAt || Date.now() - s.suspendedAt.getTime() < DELETE_AFTER_DAYS * 86_400_000) return reply.code(409).send({ error: "not_deletable" });
    await db.transaction(async (tx) => {
      const org = req.params.id;
      await tx.delete(orders).where(eq(orders.organizationId, org));
      await tx.delete(customers).where(eq(customers.organizationId, org));
      await tx.delete(sites).where(eq(sites.organizationId, org));
      await tx.delete(products).where(eq(products.organizationId, org));
      await tx.delete(reviews).where(eq(reviews.organizationId, org));
      await tx.delete(integrations).where(eq(integrations.organizationId, org));
      await tx.delete(analyticsEvents).where(eq(analyticsEvents.organizationId, org));
      await tx.delete(orderStatuses).where(eq(orderStatuses.organizationId, org));
      await tx.delete(moduleInstalls).where(eq(moduleInstalls.organizationId, org));
      await tx.update(organizations).set({ purgedAt: new Date(), requisites: null, onboarding: null, orderSettings: {}, customerSettings: {}, goalKop: null }).where(eq(organizations.id, org));
    });
    await audit(req, "admin.purge", req.auth!.user.id, {}, req.params.id);
    return { ok: true };
  });

  /** Start the 3-month free period for a website customer. */
  app.post<{ Params: { id: string } }>("/organizations/:id/trial", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const until = await startTrial(req.params.id);
    await audit(req, "subscription.trial", req.auth!.user.id, { until }, req.params.id);
    return { ok: true, until };
  });

  app.get<{ Params: { id: string } }>("/organizations/:id/billing", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    return billingOverview(req.params.id);
  });

  /** One-time password reset link for a person whose identity the admin has confirmed (no email sending). */
  app.post("/password-reset", async (req, reply) => {
    const p = z.object({ email: z.string().trim().toLowerCase().email(), resetTotp: z.boolean().default(false) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const r = await createReset(p.data.email, req.auth!.user.id, p.data.resetTotp);
    if (!r) return reply.code(404).send({ error: "user_not_found" });
    await audit(req, "admin.password_reset_link", req.auth!.user.id, { email: p.data.email, resetTotp: p.data.resetTotp && r.totpEnabled });
    return r;
  });

  app.get("/topups", async () => {
    return db
      .select({ id: topups.id, organizationId: topups.organizationId, org: organizations.name, amountKop: topups.amountKop, reference: topups.reference, status: topups.status, at: topups.createdAt })
      .from(topups)
      .innerJoin(organizations, eq(organizations.id, topups.organizationId))
      .orderBy(desc(topups.createdAt))
      .limit(100);
  });

  app.post<{ Params: { id: string; action: string } }>("/topups/:id/:action", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success || !["confirm", "cancel"].includes(req.params.action)) return reply.code(400).send({ error: "invalid_input" });
    if (req.params.action === "cancel") {
      const [row] = await db.update(topups).set({ status: "cancelled" }).where(eq(topups.id, req.params.id)).returning({ id: topups.id });
      await audit(req, "topup.cancel", req.auth!.user.id, { topup: req.params.id });
      return row ? { ok: true } : reply.code(404).send({ error: "not_found" });
    }
    const r = await confirmTopup(req.params.id, req.auth!.user.id);
    await audit(req, "topup.confirm", req.auth!.user.id, { topup: req.params.id, result: r });
    return r === "confirmed" ? { ok: true } : reply.code(r === "not_found" ? 404 : 409).send({ error: r });
  });
};
