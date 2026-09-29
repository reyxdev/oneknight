import type { FastifyRequest } from "fastify";
import { db } from "./db/client.ts";
import { auditLog } from "./db/schema.ts";

export function audit(req: FastifyRequest, action: string, userId: string | null, meta: Record<string, unknown> = {}, organizationId: string | null = null) {
  return db.insert(auditLog).values({ action, userId, organizationId, meta, ip: req.ip });
}
