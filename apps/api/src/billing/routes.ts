import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ModuleId } from "@oneknight/domain";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { moduleInstalls } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgIdsOf } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { billingOverview, createTopup, installModule, paymentsConfigured, requisites } from "./service.ts";

const Topup = z.object({ amountUah: z.number().int().min(50).max(100_000) });

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /** Billing of the user's (first) organization. */
  app.get("/", async (req, reply) => {
    const [org] = await orgIdsOf(req.auth!.user.id);
    if (!org) return reply.code(404).send({ error: "not_found" });
    return { ...(await billingOverview(org)), requisites: requisites() };
  });

  app.post("/topups", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const [org] = await orgIdsOf(req.auth!.user.id);
    if (!org) return reply.code(404).send({ error: "not_found" });
    if (!paymentsConfigured()) return reply.code(409).send({ error: "payments_not_configured" });
    const p = Topup.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const t = await createTopup(org, req.auth!.user.id, p.data.amountUah);
    await audit(req, "topup.create", req.auth!.user.id, { topup: t.id, amount: p.data.amountUah }, org);
    return reply.code(201).send({ id: t.id, reference: t.reference, amountKop: t.amountKop, status: t.status, requisites: requisites() });
  });

  app.post<{ Params: { id: string } }>("/modules/:id", async (req, reply) => {
    const [org] = await orgIdsOf(req.auth!.user.id);
    if (!org) return reply.code(404).send({ error: "not_found" });
    const r = await installModule(org, req.params.id as ModuleId);
    if (!r.ok) return reply.code(r.error === "not_found" ? 404 : 409).send({ error: r.error });
    await audit(req, "module.install", req.auth!.user.id, { module: req.params.id, free: r.free }, org);
    return r;
  });

  app.delete<{ Params: { id: string } }>("/modules/:id", async (req, reply) => {
    const [org] = await orgIdsOf(req.auth!.user.id);
    if (!org) return reply.code(404).send({ error: "not_found" });
    await db.delete(moduleInstalls).where(and(eq(moduleInstalls.organizationId, org), eq(moduleInstalls.moduleId, req.params.id)));
    await audit(req, "module.remove", req.auth!.user.id, { module: req.params.id }, org);
    return { ok: true };
  });
};
