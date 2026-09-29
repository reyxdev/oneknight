import type { FastifyRequest } from "fastify";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { memberships } from "../db/schema.ts";

/** Everything a member can be allowed to do. The owner can always do everything. */
export const PERMISSIONS = ["orders", "products", "reviews", "analytics", "site", "modules", "billing", "team", "support"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Suggested permissions when inviting someone with a role. */
export const ROLE_DEFAULTS: Record<"manager" | "marketer", Permission[]> = {
  manager: ["orders", "products", "reviews", "support"],
  marketer: ["analytics", "reviews", "site"],
};

/** Organizations the user belongs to (any role). */
export async function orgIdsOf(userId: string): Promise<string[]> {
  const rows = await db.select({ id: memberships.organizationId }).from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt));
  return rows.map((r) => r.id);
}

export type Membership = { orgId: string; role: "owner" | "manager" | "marketer"; permissions: Permission[] };

export async function membershipsOf(userId: string): Promise<Membership[]> {
  const rows = await db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt));
  return rows.map((m) => ({ orgId: m.organizationId, role: m.role, permissions: m.role === "owner" ? [...PERMISSIONS] : (m.permissions.filter((p) => (PERMISSIONS as readonly string[]).includes(p)) as Permission[]) }));
}

/** The organization the request works in: the session's active one if still a member, else the first. */
export async function activeMembership(req: FastifyRequest): Promise<Membership | null> {
  const all = await membershipsOf(req.auth!.user.id);
  return all.find((m) => m.orgId === req.auth!.activeOrgId) ?? all[0] ?? null;
}

/**
 * Organization ids a request may touch for a permission: [active org] when the member has it, else [].
 * Every tenant query filters by this list, so a missing permission means "sees nothing".
 */
export async function orgScope(req: FastifyRequest, perm?: Permission): Promise<string[]> {
  const m = await activeMembership(req);
  if (!m) return [];
  if (perm && !m.permissions.includes(perm)) return [];
  return [m.orgId];
}
