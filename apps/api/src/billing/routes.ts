import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ModuleId } from "@oneknight/domain";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { moduleInstalls, organizations } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { redeem } from "./keys.ts";
import { rewardReferral } from "./referrals.ts";
import { trialUsedByPhone, billingOverview, createTopup, installModule, payYear, paymentsConfigured, requisites, startSelfTrial, startSubscription } from "./service.ts";

const Topup = z.object({ amountUah: z.number().int().min(50).max(100_000) });

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /** «Почати пробний період» (once per business). */
  app.post("/trial", async (req, reply) => {
    const [org] = await orgScope(req, "billing");
    if (!org) return reply.code(403).send({ error: "forbidden" });
    if (await trialUsedByPhone(org, req.auth!.user.phone)) return reply.code(409).send({ error: "trial_used" });
    const until = await startSelfTrial(org);
    if (!until) return reply.code(409).send({ error: "already_started" });
    await audit(req, "billing.trial_started", req.auth!.user.id, { until: until.toISOString() }, org);
    return { until };
  });

  /** «Почати підписку» / renew a lapsed one from the balance. */
  app.post("/subscribe", async (req, reply) => {
    const [org] = await orgScope(req, "billing");
    if (!org) return reply.code(403).send({ error: "forbidden" });
    const r = await startSubscription(org);
    if (!r.ok) return reply.code(409).send(r);
    await rewardReferral(org);
    await audit(req, "billing.subscribe", req.auth!.user.id, { until: r.until.toISOString() }, org);
    return r;
  });

  /** «Оплатити рік» (2 months as a gift). */
  app.post("/year", async (req, reply) => {
    const [org] = await orgScope(req, "billing");
    if (!org) return reply.code(403).send({ error: "forbidden" });
    const r = await payYear(org);
    if (!r.ok) return reply.code(409).send(r);
    await rewardReferral(org);
    await audit(req, "billing.year", req.auth!.user.id, { until: r.until.toISOString() }, org);
    return r;
  });

  /** Billing of the user's (first) organization. */
  app.get("/", async (req, reply) => {
    const [org] = await orgScope(req, "billing");
    if (!org) return reply.code(404).send({ error: "not_found" });
    return { ...(await billingOverview(org)), requisites: requisites() };
  });

  app.post("/topups", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const [org] = await orgScope(req, "billing");
    if (!org) return reply.code(404).send({ error: "not_found" });
    if (!paymentsConfigured()) return reply.code(409).send({ error: "payments_not_configured" });
    const p = Topup.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const t = await createTopup(org, req.auth!.user.id, p.data.amountUah);
    await audit(req, "topup.create", req.auth!.user.id, { topup: t.id, amount: p.data.amountUah }, org);
    return reply.code(201).send({ id: t.id, reference: t.reference, amountKop: t.amountKop, status: t.status, requisites: requisites() });
  });

  /** Access key or promo code. Tight rate limit: codes must not be guessable by trying. */
  app.post("/redeem", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const [org] = await orgScope(req, "billing");
    if (!org) return reply.code(404).send({ error: "not_found" });
    const p = z.object({ code: z.string().max(60) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_code" });
    const r = await redeem(org, p.data.code, req.auth!.user.id);
    await audit(req, "billing.redeem", req.auth!.user.id, r.ok ? { type: r.type, kind: r.kind } : { error: r.error }, org);
    return r.ok ? r : reply.code(r.error === "invalid_code" ? 404 : 409).send({ error: r.error });
  });

  app.post<{ Params: { id: string } }>("/modules/:id", async (req, reply) => {
    const [org] = await orgScope(req, "modules");
    if (!org) return reply.code(404).send({ error: "not_found" });
    // «Контент-план» opens for beta businesses first (the admin's switch).
    if (req.params.id === "content") {
      const [o] = await db.select({ features: organizations.features }).from(organizations).where(eq(organizations.id, org));
      if (!o?.features.includes("content")) return reply.code(403).send({ error: "beta_only" });
    }
    const r = await installModule(org, req.params.id as ModuleId);
    if (!r.ok) return reply.code(r.error === "not_found" ? 404 : 409).send({ error: r.error });
    await audit(req, "module.install", req.auth!.user.id, { module: req.params.id, free: r.free }, org);
    return r;
  });

  app.delete<{ Params: { id: string } }>("/modules/:id", async (req, reply) => {
    const [org] = await orgScope(req, "modules");
    if (!org) return reply.code(404).send({ error: "not_found" });
    await db.delete(moduleInstalls).where(and(eq(moduleInstalls.organizationId, org), eq(moduleInstalls.moduleId, req.params.id)));
    await audit(req, "module.remove", req.auth!.user.id, { module: req.params.id }, org);
    return { ok: true };
  });
};
