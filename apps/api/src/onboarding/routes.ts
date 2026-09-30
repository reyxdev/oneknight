import type { FastifyPluginAsync } from "fastify";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { orders, organizations, subscriptions } from "../db/schema.ts";
import { startSelfTrial, trialUsedByPhone } from "../billing/service.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";

export const SELLS = ["clothes", "home", "handmade", "beauty", "tech", "food", "kids", "services", "other"] as const;
export const DELIVERY = ["novaposhta", "ukrposhta", "pickup", "courier"] as const;
export const CHANNELS = ["instagram", "facebook", "tiktok", "prom", "rozetka", "olx", "none"] as const;

const Answers = z.object({
  hasSite: z.boolean(),
  siteUrl: z.string().trim().max(200).optional(),
  sells: z.array(z.enum(SELLS)).min(1).max(SELLS.length),
  sellsOther: z.string().trim().max(100).optional(),
  delivery: z.array(z.enum(DELIVERY)).min(1).max(DELIVERY.length),
  channels: z.array(z.enum(CHANNELS)).min(1).max(CHANNELS.length),
});

/** Three orders marked «Приклад»: the owner sees how orders look before the first real one arrives. */
export async function seedExamples(orgId: string) {
  const [has] = await db.select({ n: count() }).from(orders).where(eq(orders.organizationId, orgId));
  if ((has?.n ?? 0) > 0) return;
  const now = Date.now();
  const base = { organizationId: orgId, isExample: true, customerPhone: "+380000000000", payment: "cod" };
  await db.insert(orders).values([
    { ...base, customerName: "Приклад: Олена", items: [{ productId: "example", name: "Приклад товару", qty: 1, priceKop: 120000 }], totalKop: 120000, delivery: { method: "novaposhta", city: "Львів", branch: "5" }, createdAt: new Date(now - 3_600_000) },
    { ...base, customerName: "Приклад: Андрій", items: [{ productId: "example", name: "Приклад товару", qty: 2, priceKop: 45000 }], totalKop: 90000, status: "confirmed" as const, delivery: { method: "novaposhta", city: "Київ", branch: "112" }, createdAt: new Date(now - 26 * 3_600_000) },
    { ...base, customerName: "Приклад: Ірина", items: [{ productId: "example", name: "Приклад товару", qty: 1, priceKop: 65000 }], totalKop: 65000, status: "done" as const, payment: "iban", delivery: { method: "pickup" }, createdAt: new Date(now - 4 * 86_400_000) },
  ]);
}

/** The examples go away with the first real order (or «Прибрати приклад»). */
export async function dropExamples(orgId: string) {
  await db.delete(orders).where(and(eq(orders.organizationId, orgId), eq(orders.isExample, true)));
}

/** /api/onboarding: the questions right after sign-up (owner of the business, answered once). */
export const onboardingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.post("/", async (req, reply) => {
    const m = await activeMembership(req);
    if (!m) return reply.code(404).send({ error: "not_found" });
    if (m.role !== "owner") return reply.code(403).send({ error: "forbidden" });
    const p = Answers.safeParse(req.body);
    if (!p.success || (p.data.sells.includes("other") && !p.data.sellsOther)) return reply.code(400).send({ error: "invalid_input" });
    const [org] = await db.select({ onboarding: organizations.onboarding }).from(organizations).where(eq(organizations.id, m.orgId));
    if (org?.onboarding) return reply.code(409).send({ error: "already_answered" });
    await db.update(organizations).set({ onboarding: { ...p.data, at: new Date().toISOString() } }).where(eq(organizations.id, m.orgId));
    await seedExamples(m.orgId);
    // The 30-day trial starts by itself (owner's decision), unless this phone already had one.
    const [sub] = await db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.organizationId, m.orgId));
    const trial = !sub && !(await trialUsedByPhone(m.orgId, req.auth!.user.phone)) ? await startSelfTrial(m.orgId) : null;
    await audit(req, "business.onboarding", req.auth!.user.id, p.data, m.orgId);
    return { ok: true, trialUntil: trial };
  });

  /** «Прибрати приклад». */
  app.delete("/examples", async (req, reply) => {
    const m = await activeMembership(req);
    if (!m || !m.permissions.includes("orders")) return reply.code(403).send({ error: "forbidden" });
    await dropExamples(m.orgId);
    return { ok: true };
  });
};
