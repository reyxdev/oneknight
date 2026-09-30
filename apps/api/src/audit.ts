import type { FastifyRequest } from "fastify";
import { lt } from "drizzle-orm";
import { db } from "./db/client.ts";
import { auditLog } from "./db/schema.ts";

export function audit(req: FastifyRequest, action: string, userId: string | null, meta: Record<string, unknown> = {}, organizationId: string | null = null) {
  return db.insert(auditLog).values({ action, userId, organizationId, meta, ip: req.ip });
}

/** The actions log is kept a year. */
export async function purgeAuditLog(now = new Date()) {
  await db.delete(auditLog).where(lt(auditLog.createdAt, new Date(now.getTime() - 365 * 86_400_000)));
}
