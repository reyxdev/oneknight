import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { leads, memberships } from "../db/schema.ts";
import { loadAuth, isComplete } from "../auth/session.ts";
import { requireAuth } from "../auth/routes.ts";
import { isTestContact, notifyOwner } from "../notify/telegram.ts";
import { audit } from "../audit.ts";

const short = z.string().trim().max(300);
const long = z.string().trim().max(3000);
const Lead = z.object({
  service: z.enum(["website", "automation", "analytics", "advertising", "seo"]),
  siteType: z.enum(["card", "service", "shop", "corporate", "unsure"]).optional(),
  business: z.string().trim().min(3).max(500),
  about: long.optional(),
  audience: short.optional(),
  logo: z.enum(["have", "need", "no", ""]).optional(),
  photos: z.enum(["have", "need", "no", ""]).optional(),
  features: z.array(z.string().max(40)).max(20).optional(),
  references: short.optional(),
  special: long.optional(),
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

    const { service, siteType, locale, name, phone, email, website: _hp, ...brief } = b;
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
      })
      .returning({ id: leads.id, number: leads.number, status: leads.status, createdAt: leads.createdAt });

    await audit(req, "lead.create", user?.id ?? null, { lead: lead!.id });
    void notifyOwner(
      [`Нова заявка #${lead!.number}`, `${user?.name ?? name} · ${user?.phone ?? phone}`, `Напрям: ${service}${siteType ? ` (${siteType})` : ""}`, `Бізнес: ${b.business}`].join("\n"),
      req.log,
      { testContact: isTestContact(user?.email ?? email) },
    );
    return reply.code(201).send(lead);
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
