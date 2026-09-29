import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { backups } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { createBackup, readBackup } from "./service.ts";

/** /api/backups: owner only, the backup holds everything including the team and billing. */
export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);
  const ownerOrg = async (req: Parameters<typeof activeMembership>[0]) => {
    const m = await activeMembership(req);
    return m?.role === "owner" ? m.orgId : null;
  };

  app.get("/", async (req, reply) => {
    const org = await ownerOrg(req);
    if (!org) return reply.code(403).send({ error: "owner_only" });
    return db.select({ id: backups.id, kind: backups.kind, size: backups.size, counts: backups.counts, createdAt: backups.createdAt }).from(backups).where(eq(backups.organizationId, org)).orderBy(desc(backups.createdAt));
  });

  app.post("/", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const org = await ownerOrg(req);
    if (!org) return reply.code(403).send({ error: "owner_only" });
    const b = await createBackup(org, "manual", req.auth!.user.id);
    await audit(req, "backup.create", req.auth!.user.id, { backup: b.id }, org);
    return reply.code(201).send({ id: b.id, kind: b.kind, size: b.size, counts: b.counts, createdAt: b.createdAt });
  });

  app.get<{ Params: { id: string } }>("/:id/download", async (req, reply) => {
    const org = await ownerOrg(req);
    if (!org || !z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    const [b] = await db.select().from(backups).where(and(eq(backups.id, req.params.id), eq(backups.organizationId, org)));
    if (!b) return reply.code(404).send({ error: "not_found" });
    await audit(req, "backup.download", req.auth!.user.id, { backup: b.id }, org);
    const name = `oneknight-backup-${b.createdAt.toISOString().slice(0, 10)}.json.gz`;
    return reply.header("content-type", "application/gzip").header("content-disposition", `attachment; filename="${name}"`).header("cache-control", "private, no-store").send(await readBackup(b.storageKey));
  });
};
