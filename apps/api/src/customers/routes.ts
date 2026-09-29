import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, desc, eq, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { customerNotes, customers, orders, organizations, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";

export const DEFAULT_SLEEP_DAYS = 90;
/** «Постійний» after this many completed orders; «Проблемний» after one refused parcel. */
export const REGULAR_AFTER = 3;
export const PRESET_TAGS = ["vip", "wholesale"] as const;
const SEGMENTS = ["all", "new", "regular", "sleeping", "top", "risky"] as const;

type Stats = { orders: number; sumKop: number; lastAt: string | null; done: number; returned: number; cancelled: number };

/** Customers work with `orders` (a shipping-only member does not see the base); sums need `finance`. */
async function access(req: FastifyRequest) {
  const m = await activeMembership(req);
  if (!m || !m.permissions.includes("orders")) return null;
  return { org: m.orgId, finance: m.permissions.includes("finance"), owner: m.role === "owner", userId: req.auth!.user.id };
}

export async function customerSettingsOf(orgId: string) {
  const [o] = await db.select({ s: organizations.customerSettings }).from(organizations).where(eq(organizations.id, orgId));
  return { tags: o?.s.tags ?? [], sleepDays: o?.s.sleepDays ?? DEFAULT_SLEEP_DAYS };
}

/** Counted from the business's orders (examples never count). The sum is of orders not cancelled or returned. */
const statsSql = (orgId: string) => dsql`
  select customer_id,
    count(*) filter (where status <> 'cancelled')::int as orders,
    coalesce(sum(total_kop) filter (where status not in ('cancelled', 'returned')), 0)::int as sum_kop,
    max(created_at) as last_at,
    count(*) filter (where status = 'done')::int as done,
    count(*) filter (where status = 'returned')::int as returned,
    count(*) filter (where status = 'cancelled')::int as cancelled
  from orders where organization_id = ${orgId} and not is_example and customer_id is not null group by customer_id`;

/** «Постійний» and «Проблемний» are never set by hand: they follow the orders. */
export const autoTags = (s: Pick<Stats, "done" | "returned">) => [...(s.done >= REGULAR_AFTER ? ["regular"] : []), ...(s.returned >= 1 ? ["problem"] : [])];

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /**
   * The base: segments Усі · Нові (first order within 30 days) · Постійні · Сплячі (no purchase for N days) ·
   * Топ (by sum) · Ризикові (a refused parcel or 2+ cancellations); search by name or phone; pages of 50.
   */
  app.get<{ Querystring: { segment?: string; q?: string; sort?: string; dir?: string; page?: string; limit?: string } }>("/", async (req, reply) => {
    const a = await access(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const seg = z.enum(SEGMENTS).catch("all").parse(req.query.segment);
    const { sleepDays } = await customerSettingsOf(a.org);
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    const digits = q.replace(/\D/g, "");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 51));
    const page = Math.max(1, Math.min(10_000, Number(req.query.page) || 1));
    const where = [dsql`c.organization_id = ${a.org}`];
    if (q.length >= 2) where.push(digits.length >= 3 ? dsql`(c.name ilike ${`%${q}%`} or c.phone_key like ${`%${digits}%`})` : dsql`c.name ilike ${`%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`}`);
    if (seg === "new") where.push(dsql`c.created_at >= now() - interval '30 days'`);
    if (seg === "regular") where.push(dsql`coalesce(s.done, 0) >= ${REGULAR_AFTER}`);
    if (seg === "sleeping") where.push(dsql`s.last_at < now() - make_interval(days => ${sleepDays})`);
    if (seg === "risky") where.push(dsql`(coalesce(s.returned, 0) >= 1 or coalesce(s.cancelled, 0) >= 2)`);
    if (seg === "top") where.push(dsql`coalesce(s.sum_kop, 0) > 0`);
    const sortCols: Record<string, ReturnType<typeof dsql>> = {
      name: dsql`c.name collate "uk-UA-x-icu"`,
      orders: dsql`coalesce(s.orders, 0)`,
      last: dsql`s.last_at`,
      createdAt: dsql`c.created_at`,
      ...(a.finance ? { sum: dsql`coalesce(s.sum_kop, 0)` } : {}),
    };
    const key = seg === "top" && a.finance ? "sum" : req.query.sort && sortCols[req.query.sort] ? req.query.sort : "last";
    const dir = seg === "top" ? dsql`desc` : req.query.dir === "asc" ? dsql`asc` : dsql`desc`;
    const rows = await db.execute<{ id: string; name: string; phone: string | null; email: string | null; company: string | null; tags: string[]; city: string | null; first_source: string | null; anonymized_at: string | null; created_at: string; orders: number | null; sum_kop: number | null; last_at: string | null; done: number | null; returned: number | null }>(dsql`
      with s as (${statsSql(a.org)})
      select c.id, c.name, c.phone, c.email, c.company, c.tags, c.delivery->>'city' as city, c.first_source, c.anonymized_at, c.created_at,
        s.orders, s.sum_kop, s.last_at, s.done, s.returned
      from customers c left join s on s.customer_id = c.id
      where ${dsql.join(where, dsql` and `)}
      order by ${sortCols[key]} ${dir} nulls last, c.created_at desc
      limit ${limit} offset ${(page - 1) * Math.min(limit, 50)}`);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      company: r.company,
      tags: r.tags,
      auto: autoTags({ done: r.done ?? 0, returned: r.returned ?? 0 }),
      city: r.city,
      firstSource: r.first_source,
      anonymized: !!r.anonymized_at,
      createdAt: r.created_at,
      orders: r.orders ?? 0,
      sumKop: a.finance ? (r.sum_kop ?? 0) : null,
      lastAt: r.last_at,
    }));
  });

  /** Own tags with colours and the «сплячий» threshold («Бізнес → Клієнти»); the owner changes them. */
  app.get("/settings", async (req, reply) => {
    const a = await access(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    return { ...(await customerSettingsOf(a.org)), canEdit: a.owner };
  });
  app.put("/settings", async (req, reply) => {
    const a = await access(req);
    const p = z
      .object({ tags: z.array(z.object({ id: z.string().regex(/^t_[a-z0-9]{6,12}$/), name: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-f]{6}$/i) })).max(30), sleepDays: z.number().int().min(14).max(730) })
      .safeParse(req.body);
    if (!a?.owner) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    await db.update(organizations).set({ customerSettings: p.data }).where(eq(organizations.id, a.org));
    await audit(req, "business.customer_settings", a.userId, { tags: p.data.tags.length, sleepDays: p.data.sleepDays }, a.org);
    return { ok: true };
  });

  /** The card: details, numbers, every order, notes. */
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const a = await access(req);
    if (!a || !z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    const [c] = await db.select().from(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, a.org)));
    if (!c) return reply.code(404).send({ error: "not_found" });
    const list = await db
      .select({ id: orders.id, number: orders.number, status: orders.status, statusId: orders.statusId, totalKop: orders.totalKop, createdAt: orders.createdAt, source: orders.source })
      .from(orders)
      .where(and(eq(orders.customerId, c.id), eq(orders.isExample, false)))
      .orderBy(desc(orders.createdAt))
      .limit(200);
    const notes = await db
      .select({ id: customerNotes.id, text: customerNotes.text, at: customerNotes.createdAt, by: users.name })
      .from(customerNotes)
      .leftJoin(users, eq(users.id, customerNotes.userId))
      .where(eq(customerNotes.customerId, c.id))
      .orderBy(desc(customerNotes.createdAt));
    const live = list.filter((o) => o.status !== "cancelled");
    const stats = {
      orders: live.length,
      sumKop: a.finance ? live.filter((o) => o.status !== "returned").reduce((s, o) => s + o.totalKop, 0) : null,
      lastAt: list[0]?.createdAt ?? null,
      done: list.filter((o) => o.status === "done").length,
      returned: list.filter((o) => o.status === "returned").length,
      cancelled: list.filter((o) => o.status === "cancelled").length,
    };
    const { phoneKey: _k, ...rest } = c;
    return {
      ...rest,
      auto: autoTags(stats),
      stats,
      orders: list.map((o) => ({ ...o, totalKop: a.finance ? o.totalKop : null })),
      notes,
    };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const a = await access(req);
    const settings = a ? await customerSettingsOf(a.org) : null;
    const allowedTags = new Set<string>([...PRESET_TAGS, ...(settings?.tags.map((t) => t.id) ?? [])]);
    const p = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        email: z.string().trim().email().max(254).nullable().optional().or(z.literal("")),
        company: z.string().trim().max(200).nullable().optional(),
        edrpou: z.string().trim().regex(/^\d{8,10}$/).nullable().optional().or(z.literal("")),
        tags: z.array(z.string().max(20)).max(20).optional(),
      })
      .safeParse(req.body);
    if (!a || !z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    if (!p.success || p.data.tags?.some((t) => !allowedTags.has(t))) return reply.code(400).send({ error: "invalid_input" });
    const set = { ...p.data, ...(p.data.email === "" ? { email: null } : {}), ...(p.data.edrpou === "" ? { edrpou: null } : {}) };
    const [row] = await db.update(customers).set({ ...set, updatedAt: new Date() }).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, a.org), dsql`${customers.anonymizedAt} is null`)).returning({ id: customers.id });
    return row ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  app.post<{ Params: { id: string } }>("/:id/notes", async (req, reply) => {
    const a = await access(req);
    const p = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!a || !p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, a.org)));
    if (!c) return reply.code(404).send({ error: "not_found" });
    await db.insert(customerNotes).values({ customerId: c.id, userId: a.userId, text: p.data.text });
    return reply.code(201).send({ ok: true });
  });
};
