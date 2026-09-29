import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { orderStatuses, orders, organizations } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";

const GROUPS = ["new", "confirmed", "shipped", "done", "cancelled", "returned"] as const;
export const DEFAULT_URGENT_HOURS = 2;
const Settings = z.object({
  reasons: z.array(z.string().trim().min(1).max(100)).max(20),
  sources: z.array(z.string().trim().min(1).max(40)).max(20),
  urgentHours: z.number().int().min(1).max(72),
});

export async function orderSettingsOf(orgId: string) {
  const [o] = await db.select({ s: organizations.orderSettings }).from(organizations).where(eq(organizations.id, orgId));
  return { reasons: o?.s.reasons ?? [], sources: o?.s.sources ?? [], urgentHours: o?.s.urgentHours ?? DEFAULT_URGENT_HOURS };
}

/**
 * /api/shop/settings — «Бізнес → Замовлення»: the business's own statuses (each inside a group), own cancel reasons,
 * own sources of manual orders, hours until a new order is urgent. Everyone working with orders reads them; only
 * the owner changes them.
 */
export const orderSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req, reply) => {
    const m = await activeMembership(req);
    if (!m || !(m.permissions.includes("orders") || m.permissions.includes("shipping"))) return reply.code(403).send({ error: "forbidden" });
    const statuses = await db.select({ id: orderStatuses.id, name: orderStatuses.name, group: orderStatuses.group, sort: orderStatuses.sort }).from(orderStatuses).where(eq(orderStatuses.organizationId, m.orgId)).orderBy(asc(orderStatuses.sort), asc(orderStatuses.createdAt));
    return { statuses, ...(await orderSettingsOf(m.orgId)), canEdit: m.role === "owner" };
  });

  async function owner(req: Parameters<typeof activeMembership>[0]) {
    const m = await activeMembership(req);
    return m?.role === "owner" ? m.orgId : null;
  }

  app.put("/", async (req, reply) => {
    const org = await owner(req);
    const p = Settings.safeParse(req.body);
    if (!org) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    await db.update(organizations).set({ orderSettings: p.data }).where(eq(organizations.id, org));
    await audit(req, "business.order_settings", req.auth!.user.id, p.data, org);
    return { ok: true };
  });

  app.post("/statuses", async (req, reply) => {
    const org = await owner(req);
    const p = z.object({ name: z.string().trim().min(1).max(40), group: z.enum(GROUPS) }).safeParse(req.body);
    if (!org) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const all = await db.select({ id: orderStatuses.id }).from(orderStatuses).where(eq(orderStatuses.organizationId, org));
    if (all.length >= 30) return reply.code(409).send({ error: "too_many" });
    const [row] = await db.insert(orderStatuses).values({ organizationId: org, name: p.data.name, group: p.data.group, sort: all.length }).returning();
    await audit(req, "business.status_add", req.auth!.user.id, { name: p.data.name, group: p.data.group }, org);
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>("/statuses/:id", async (req, reply) => {
    const org = await owner(req);
    const p = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
    if (!org) return reply.code(403).send({ error: "forbidden" });
    if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(orderStatuses).set({ name: p.data.name }).where(and(eq(orderStatuses.id, req.params.id), eq(orderStatuses.organizationId, org))).returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });

  /** Orders with the deleted status keep their group (shown by the group's name). */
  app.delete<{ Params: { id: string } }>("/statuses/:id", async (req, reply) => {
    const org = await owner(req);
    if (!org || !z.string().uuid().safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    await db.update(orders).set({ statusId: null }).where(and(eq(orders.statusId, req.params.id), eq(orders.organizationId, org)));
    await db.delete(orderStatuses).where(and(eq(orderStatuses.id, req.params.id), eq(orderStatuses.organizationId, org)));
    await audit(req, "business.status_delete", req.auth!.user.id, { id: req.params.id }, org);
    return { ok: true };
  });
};
