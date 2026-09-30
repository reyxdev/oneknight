import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { leads, memberships } from "../db/schema.ts";
import { loadAuth, isComplete } from "../auth/session.ts";
import { requireAuth } from "../auth/routes.ts";
import { isTestContact, notifyOwner } from "../notify/telegram.ts";
import { audit } from "../audit.ts";
import { estimateSite } from "@oneknight/domain";
import { calculatorConfig } from "../site/landing.ts";
import { randomToken, sha256 } from "../security/crypto.ts";

const CLAIM_DAYS = 7;

/** «Створіть кабінет, щоб бачити статус»: the new account takes the visitor's lead with its key. */
export async function claimLead(token: string | undefined, userId: string, orgId: string) {
  if (!token) return;
  await db.update(leads).set({ userId, organizationId: orgId, claimTokenHash: null, claimExpiresAt: null }).where(and(eq(leads.claimTokenHash, sha256(token)), gt(leads.claimExpiresAt, new Date()), isNull(leads.userId)));
}

const short = z.string().trim().max(300);
const long = z.string().trim().max(3000);
/** Step 2 (optional): the brief. */
const Brief = z.object({
  business: z.string().trim().max(500).optional(),
  about: long.optional(),
  audience: short.optional(),
  logo: z.enum(["have", "need", "no", ""]).optional(),
  photos: z.enum(["have", "need", "no", ""]).optional(),
  features: z.array(z.string().max(40)).max(20).optional(),
  references: short.optional(),
  special: long.optional(),
});
/** «Замовити з цим розрахунком»: the calculator's choice and its range, as the visitor saw it. */
const Estimate = z.object({
  siteType: z.enum(["card", "service", "shop", "corporate"]),
  products: z.string().max(20),
  design: z.enum(["ready", "custom"]),
  languages: z.number().int().min(1).max(5),
  content: z.number().int().min(0).max(1000),
  from: z.number().int().min(0).max(10_000_000),
  to: z.number().int().min(0).max(10_000_000),
});
/** Step 1: who and what; the brief may come with it or later (step 2). */
const Lead = Brief.extend({
  service: z.enum(["website", "automation", "analytics", "advertising", "seo"]),
  siteType: z.enum(["card", "service", "shop", "corporate", "unsure"]).optional(),
  estimate: Estimate.optional(),
  locale: z.enum(["uk", "en"]).default("uk"),
  // Only for visitors without an account:
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().regex(/^\+?[0-9\s()-]{9,20}$/).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  /** Honeypot: humans never fill it. */
  website: z.string().max(0).optional(),
});

const ANON_PER_IP_PER_HOUR = 5;

export const leadRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const p = Lead.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const b = p.data;
    const a = await loadAuth(req);
    const user = a && isComplete(a) ? a.user : null;

    if (!user) {
      if (!b.name || !b.phone) return reply.code(400).send({ error: "contact_required" });
      const since = new Date(Date.now() - 3600_000);
      const [n] = await db.select({ n: count() }).from(leads).where(and(eq(leads.ip, req.ip), gt(leads.createdAt, since)));
      if ((n?.n ?? 0) >= ANON_PER_IP_PER_HOUR) return reply.code(429).send({ error: "too_many_requests" });
    }
    const org = user ? (await db.select({ id: memberships.organizationId }).from(memberships).where(eq(memberships.userId, user.id)).limit(1))[0] : undefined;

    // The range is computed again from the owner's numbers: the lead keeps what the calculator really gives.
    if (b.estimate) b.estimate = { ...b.estimate, ...estimateSite(await calculatorConfig(), b.estimate) };
    const { service, siteType, locale, name, phone, email, website: _hp, ...brief } = b;
    // The key for step 2 (the brief) and, for a visitor, for taking the lead into a new account.
    const token = randomToken();
    const [lead] = await db
      .insert(leads)
      .values({
        userId: user?.id ?? null,
        organizationId: org?.id ?? null,
        name: user?.name ?? name!,
        phone: user?.phone ?? phone!,
        email: user?.email ?? (email || null),
        service,
        siteType: service === "website" ? (siteType ?? "unsure") : null,
        brief,
        source: user ? "app" : "site",
        locale,
        ip: req.ip,
        claimTokenHash: sha256(token),
        claimExpiresAt: new Date(Date.now() + CLAIM_DAYS * 86_400_000),
      })
      .returning({ id: leads.id, number: leads.number, status: leads.status, createdAt: leads.createdAt });

    await audit(req, "lead.create", user?.id ?? null, { lead: lead!.id });
    void notifyOwner(
      [`Нова заявка #${lead!.number}`, `${user?.name ?? name} · ${user?.phone ?? phone}`, `Напрям: ${service}${siteType ? ` (${siteType})` : ""}`, ...(b.business ? [`Бізнес: ${b.business}`] : []), ...(b.estimate ? [`Розрахунок: ${b.estimate.from}–${b.estimate.to} грн`] : [])].join("\n"),
      req.log,
      { testContact: isTestContact(user?.email ?? email) },
    );
    return reply.code(201).send({ ...lead, token });
  });

  /** Step 2: the visitor adds the brief to their lead with the key from step 1 (7 days). */
  app.patch("/brief", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const p = Brief.extend({ token: z.string().min(20).max(100) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const { token, ...brief } = p.data;
    const [lead] = await db.select().from(leads).where(and(eq(leads.claimTokenHash, sha256(token)), gt(leads.claimExpiresAt, new Date())));
    if (!lead) return reply.code(404).send({ error: "not_found" });
    const clean = Object.fromEntries(Object.entries(brief).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
    await db.update(leads).set({ brief: { ...(lead.brief as object), ...clean }, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    void notifyOwner([`Бриф до заявки #${lead.number}`, ...(brief.business ? [`Бізнес: ${brief.business}`] : []), ...(brief.about ? [brief.about.slice(0, 500)] : [])].join("\n"), req.log, { testContact: isTestContact(lead.email) });
    return { ok: true, number: lead.number };
  });

  app.get("/mine", { preHandler: requireAuth }, async (req) => {
    return db
      .select({ id: leads.id, number: leads.number, service: leads.service, siteType: leads.siteType, status: leads.status, business: leads.brief, createdAt: leads.createdAt })
      .from(leads)
      .where(eq(leads.userId, req.auth!.user.id))
      .orderBy(desc(leads.createdAt))
      .limit(50)
      .then((rows) => rows.map((r) => ({ ...r, business: (r.business as { business?: string }).business ?? "" })));
  });
};
