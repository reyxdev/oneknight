import type { FastifyRequest } from "fastify";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { memberships } from "../db/schema.ts";

/**
 * Everything a member can be allowed to do. The owner can always do everything.
 * `finance`: sees money (revenue, order sums, the goal). `shipping`: only orders waiting to be sent: waybills,
 * printing, «Відправлено» (the «Комплектувальник» role); `orders` includes it.
 */
export const PERMISSIONS = ["orders", "shipping", "finance", "products", "reviews", "analytics", "site", "modules", "billing", "team", "support"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Suggested permissions when inviting someone with a role. */
export const ROLE_DEFAULTS: Record<"manager" | "marketer" | "packer", Permission[]> = {
  manager: ["orders", "products", "reviews", "support"],
  marketer: ["analytics", "reviews", "site"],
  packer: ["shipping"],
};
export const INVITE_ROLES = ["manager", "marketer", "packer"] as const;

/** Organizations the user belongs to (any role). */
export async function orgIdsOf(userId: string): Promise<string[]> {
  const rows = await db.select({ id: memberships.organizationId }).from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt));
  return rows.map((r) => r.id);
}

export type Membership = { orgId: string; role: "owner" | "manager" | "marketer" | "packer"; permissions: Permission[] };

export async function membershipsOf(userId: string): Promise<Membership[]> {
  const rows = await db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.createdAt));
  return rows.map((m) => ({ orgId: m.organizationId, role: m.role, permissions: m.role === "owner" ? [...PERMISSIONS] : (m.permissions.filter((p) => (PERMISSIONS as readonly string[]).includes(p)) as Permission[]) }));
}

/** The organization the request works in: the session's active one if still a member, else the first. */
export async function activeMembership(req: FastifyRequest): Promise<Membership | null> {
  // The admin looking at a client's panel sees it as its owner does; every change is refused (app.ts).
  if (req.auth?.viewOrgId) return { orgId: req.auth.viewOrgId, role: "owner", permissions: [...PERMISSIONS] };
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

/**
 * Orders access of the request: full (`orders`) or shipping only (`shipping`: confirmed, paid and shipped orders),
 * and whether sums are visible (`finance`). Null = no access to orders at all.
 */
export async function orderAccess(req: FastifyRequest): Promise<{ org: string; full: boolean; finance: boolean } | null> {
  const m = await activeMembership(req);
  if (!m) return null;
  const full = m.permissions.includes("orders");
  if (!full && !m.permissions.includes("shipping")) return null;
  return { org: m.orgId, full, finance: m.permissions.includes("finance") };
}

/** Statuses a shipping-only member sees and may work with. */
export const SHIPPING_STATUSES = ["confirmed", "shipped"] as const;
