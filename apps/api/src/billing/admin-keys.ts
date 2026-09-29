import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { moduleCatalog } from "@oneknight/domain";
import { db } from "../db/client.ts";
import { accessKeys, organizations, promoCodes } from "../db/schema.ts";
import { audit } from "../audit.ts";
import { generateKeys } from "./keys.ts";

const uuid = z.string().uuid();
const liveModules = moduleCatalog.filter((m) => m.live).map((m) => m.id) as [string, ...string[]];
const date = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d\d-\d\d$/)).transform((s) => new Date(s.length === 10 ? `${s}T23:59:59Z` : s));

const KeyBatch = z
  .object({ kind: z.enum(["oneknight", "module"]), moduleId: z.enum(liveModules).optional(), months: z.number().int().min(1).max(36), count: z.number().int().min(1).max(500), activateBefore: date.optional(), note: z.string().trim().max(200).optional() })
  .refine((b) => b.kind === "oneknight" || !!b.moduleId, { path: ["moduleId"] });
const Promo = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,32}$/),
  kind: z.enum(["percent", "bonus"]),
  value: z.number().int().min(1).max(100_000),
  months: z.number().int().min(1).max(12).default(1),
  maxUses: z.number().int().min(1).max(1_000_000).optional(),
  validUntil: date.optional(),
  note: z.string().trim().max(200).optional(),
}).refine((p) => p.kind !== "percent" || p.value <= 100, { path: ["value"] });

/** /api/admin/keys and /api/admin/promos (registered inside the admin plugin, so admin-only). */
export const keyAdminRoutes: FastifyPluginAsync = async (app) => {
  /** Batches with counts; individual keys only show their last 4 characters. */
  app.get("/keys", async () => {
    const batches = await db
      .select({
        batch: accessKeys.batch,
        kind: accessKeys.kind,
        moduleId: accessKeys.moduleId,
        months: accessKeys.months,
        activateBefore: accessKeys.activateBefore,
        note: accessKeys.note,
        createdAt: sql<string>`min(${accessKeys.createdAt})`,
        total: count(),
        redeemed: sql<number>`count(${accessKeys.redeemedAt})::int`,
        disabled: sql<number>`count(*) filter (where ${accessKeys.disabled})::int`,
      })
      .from(accessKeys)
      .groupBy(accessKeys.batch, accessKeys.kind, accessKeys.moduleId, accessKeys.months, accessKeys.activateBefore, accessKeys.note)
      .orderBy(desc(sql`min(${accessKeys.createdAt})`));
    return batches;
  });

  app.get<{ Params: { batch: string } }>("/keys/:batch", async (req, reply) => {
    if (!uuid.safeParse(req.params.batch).success) return reply.code(400).send({ error: "invalid_input" });
    return db
      .select({ id: accessKeys.id, hint: accessKeys.hint, disabled: accessKeys.disabled, redeemedAt: accessKeys.redeemedAt, org: organizations.name })
      .from(accessKeys)
      .leftJoin(organizations, eq(organizations.id, accessKeys.redeemedBy))
      .where(eq(accessKeys.batch, req.params.batch))
      .orderBy(accessKeys.hint);
  });

  app.post("/keys", async (req, reply) => {
    const p = KeyBatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const r = await generateKeys(p.data as Parameters<typeof generateKeys>[0], req.auth!.user.id);
    await audit(req, "keys.generate", req.auth!.user.id, { batch: r.batch, count: r.codes.length, kind: p.data.kind, module: p.data.moduleId ?? null, months: p.data.months });
    return reply.code(201).send(r);
  });

  /** Disable/enable one key or all unused keys of a batch. */
  app.patch<{ Params: { id: string } }>("/keys/:id", async (req, reply) => {
    const p = z.object({ disabled: z.boolean(), wholeBatch: z.boolean().optional() }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const where = p.data.wholeBatch ? and(eq(accessKeys.batch, req.params.id), isNull(accessKeys.redeemedAt)) : eq(accessKeys.id, req.params.id);
    const rows = await db.update(accessKeys).set({ disabled: p.data.disabled }).where(where).returning({ id: accessKeys.id });
    await audit(req, "keys.disable", req.auth!.user.id, { target: req.params.id, disabled: p.data.disabled, n: rows.length });
    return rows.length ? { ok: true, n: rows.length } : reply.code(404).send({ error: "not_found" });
  });

  /** Deletes the unused keys of a batch. Activated keys stay as a record of what was granted. */
  app.delete<{ Params: { batch: string } }>("/keys/batch/:batch", async (req, reply) => {
    if (!uuid.safeParse(req.params.batch).success) return reply.code(400).send({ error: "invalid_input" });
    const rows = await db.delete(accessKeys).where(and(eq(accessKeys.batch, req.params.batch), isNull(accessKeys.redeemedAt))).returning({ id: accessKeys.id });
    const [left] = await db.select({ n: count() }).from(accessKeys).where(and(eq(accessKeys.batch, req.params.batch), isNotNull(accessKeys.redeemedAt)));
    await audit(req, "keys.delete", req.auth!.user.id, { batch: req.params.batch, n: rows.length });
    return { ok: true, deleted: rows.length, kept: left?.n ?? 0 };
  });

  app.get("/promos", async () => db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)));

  app.post("/promos", async (req, reply) => {
    const p = Promo.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db
      .insert(promoCodes)
      .values({ ...p.data, maxUses: p.data.maxUses ?? null, validUntil: p.data.validUntil ?? null, note: p.data.note ?? null, createdBy: req.auth!.user.id })
      .onConflictDoNothing()
      .returning();
    if (!row) return reply.code(409).send({ error: "code_taken" });
    await audit(req, "promo.create", req.auth!.user.id, { promo: row.id, code: row.code });
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>("/promos/:id", async (req, reply) => {
    const p = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(promoCodes).set({ active: p.data.active }).where(eq(promoCodes.id, req.params.id)).returning({ id: promoCodes.id });
    return row ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  /** Only a never-used code can be deleted; a used one is switched off instead, to keep the history. */
  app.delete<{ Params: { id: string } }>("/promos/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.delete(promoCodes).where(and(eq(promoCodes.id, req.params.id), eq(promoCodes.uses, 0))).returning({ id: promoCodes.id });
    await audit(req, "promo.delete", req.auth!.user.id, { promo: req.params.id, deleted: !!row });
    return row ? { ok: true } : reply.code(409).send({ error: "promo_used" });
  });
};
