import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, asc, count, desc, eq, gt, ilike, inArray, lte, or, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { customers, orderEvents, orders, products, sites, users } from "../db/schema.ts";
import { autoTags } from "../customers/routes.ts";
import { requireAuth } from "../auth/routes.ts";
import { SHIPPING_STATUSES, orderAccess, orgScope, type Permission } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { Upload, saveImage } from "../files/store.ts";
import { setOrderStatus, setPayment } from "./service.ts";
import { duplicatesOf } from "./work.ts";
import { needsWaybill } from "../dashboard/todo.ts";

const uuid = z.string().uuid();
const ProductIn = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  price: z.number().min(0).max(10_000_000),
  stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  active: z.boolean().optional(),
  sort: z.number().int().optional(),
  photo: Upload.optional(),
});
const GROUPS = ["new", "confirmed", "shipped", "done", "cancelled", "returned"] as const;
const OrderPatch = z.object({
  status: z.enum(GROUPS).optional(),
  /** The business's own status (its group follows). */
  statusId: z.string().uuid().nullable().optional(),
  /** Required when cancelling. */
  reason: z.string().trim().max(200).optional(),
  payment: z.object({ status: z.enum(["unpaid", "prepaid", "paid", "refunded"]), prepaidKop: z.number().int().min(0).max(1_000_000_000).default(0) }).optional(),
  waybill: z.string().trim().max(60).nullable().optional(),
  warranty: z.object({ enabled: z.boolean(), until: z.string().max(40).optional(), note: z.string().max(500).optional() }).optional(),
});

/** «+38067 *** ** 67»: enough to recognise, not enough to copy the base. */
export function maskPhone(p: string) {
  const d = p.replace(/\D/g, "");
  return d.length < 7 ? "***" : `+${d.slice(0, 5)} *** ** ${d.slice(-2)}`;
}

const view = (p: typeof products.$inferSelect) => ({ ...p, price: p.priceKop / 100, photo: p.photoFileId ? `/api/files/${p.photoFileId}` : null });

/** Account shop: /api/shop. Every query is limited to the user's organizations. */
export const shopRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  async function ownSite(req: FastifyRequest, siteId: string, perm: Permission) {
    if (!uuid.safeParse(siteId).success) return null;
    const orgs = await orgScope(req, perm);
    if (!orgs.length) return null;
    const [s] = await db.select().from(sites).where(and(eq(sites.id, siteId), inArray(sites.organizationId, orgs))).limit(1);
    return s ?? null;
  }
  async function ownProduct(req: FastifyRequest, id: string) {
    if (!uuid.safeParse(id).success) return null;
    const orgs = await orgScope(req, "products");
    if (!orgs.length) return null;
    const [p] = await db.select().from(products).where(and(eq(products.id, id), inArray(products.organizationId, orgs))).limit(1);
    return p ?? null;
  }

  app.get<{ Params: { siteId: string } }>("/sites/:siteId/products", async (req, reply) => {
    const site = await ownSite(req, req.params.siteId, "products");
    if (!site) return reply.code(404).send({ error: "not_found" });
    const rows = await db.select().from(products).where(eq(products.siteId, site.id)).orderBy(asc(products.sort), desc(products.createdAt));
    return rows.map(view);
  });

  app.post<{ Params: { siteId: string } }>("/sites/:siteId/products", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const site = await ownSite(req, req.params.siteId, "products");
    if (!site) return reply.code(404).send({ error: "not_found" });
    const p = ProductIn.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    let photoFileId: string | null = null;
    if (p.data.photo) {
      const f = await saveImage(p.data.photo, { organizationId: site.organizationId, uploaderId: req.auth!.user.id, isPublic: true });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      photoFileId = f.file.id;
    }
    const [row] = await db
      .insert(products)
      .values({ organizationId: site.organizationId, siteId: site.id, name: p.data.name, description: p.data.description ?? "", priceKop: Math.round(p.data.price * 100), stock: p.data.stock ?? null, active: p.data.active ?? true, sort: p.data.sort ?? 0, photoFileId })
      .returning();
    await audit(req, "product.create", req.auth!.user.id, { product: row!.id }, site.organizationId);
    return reply.code(201).send(view(row!));
  });

  app.patch<{ Params: { id: string } }>("/products/:id", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const cur = await ownProduct(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    const p = ProductIn.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    let photoFileId = cur.photoFileId;
    if (p.data.photo) {
      const f = await saveImage(p.data.photo, { organizationId: cur.organizationId, uploaderId: req.auth!.user.id, isPublic: true });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      photoFileId = f.file.id;
    }
    const [row] = await db
      .update(products)
      .set({
        ...(p.data.name !== undefined ? { name: p.data.name } : {}),
        ...(p.data.description !== undefined ? { description: p.data.description } : {}),
        ...(p.data.price !== undefined ? { priceKop: Math.round(p.data.price * 100) } : {}),
        ...(p.data.stock !== undefined ? { stock: p.data.stock } : {}),
        ...(p.data.active !== undefined ? { active: p.data.active } : {}),
        ...(p.data.sort !== undefined ? { sort: p.data.sort } : {}),
        photoFileId,
        updatedAt: new Date(),
      })
      .where(eq(products.id, cur.id))
      .returning();
    return view(row!);
  });

  app.delete<{ Params: { id: string } }>("/products/:id", async (req, reply) => {
    const cur = await ownProduct(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    await db.delete(products).where(eq(products.id, cur.id));
    await audit(req, "product.delete", req.auth!.user.id, { product: cur.id }, cur.organizationId);
    return { ok: true };
  });

  /**
   * Orders list: filter, sort by column (newest first by default) and pages (`limit` up to 200, `page` from 1).
   * The panel asks for 51 to know whether there is a next page of 50. Sorting by sum needs `finance`.
   */
  app.get<{ Querystring: { status?: string; payment?: string; sort?: string; dir?: string; page?: string; limit?: string } }>("/orders", async (req) => {
    const acc = await orderAccess(req);
    if (!acc) return [];
    const orgs = [acc.org];
    const st = z.enum(GROUPS).safeParse(req.query.status);
    // "nowaybill": confirmed or paid, going by a carrier, no waybill yet («Що треба зробити» on Home).
    // "nowaybill": in work, going by a carrier, no waybill yet; "callback": «Не додзвонились», time to call again.
    const filter =
      req.query.status === "nowaybill"
        ? needsWaybill()
        : req.query.status === "callback"
          ? and(inArray(orders.status, ["new", "confirmed"]), lte(orders.callbackAt, new Date()))
          : req.query.status === "waiting"
            ? and(eq(orders.status, "shipped"), lte(orders.arrivedAt, new Date(Date.now() - 3 * 86_400_000)))
          : st.success
            ? eq(orders.status, st.data)
            : undefined;
    const pay = z.enum(["unpaid", "prepaid", "paid", "refunded"]).safeParse(req.query.payment);
    // Names in Ukrainian alphabetical order (А, Б, … Є, … І, Ї …), not by code points.
    const cols = { createdAt: orders.createdAt, number: orders.number, customer: dsql`${orders.customerName} collate "uk-UA-x-icu"`, status: orders.status, ...(acc.finance ? { total: orders.totalKop } : {}) };
    const col = cols[req.query.sort as keyof typeof cols] ?? orders.createdAt;
    const order = req.query.dir === "asc" ? asc(col) : desc(col);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 200));
    const page = Math.max(1, Math.min(10_000, Number(req.query.page) || 1));
    // Pages are 50 long; one more row than a page only tells the panel that a next page exists.
    const offset = (page - 1) * Math.min(limit, 50);
    return db
      .select({
        id: orders.id,
        number: orders.number,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        totalKop: orders.totalKop,
        status: orders.status,
        statusId: orders.statusId,
        paymentStatus: orders.paymentStatus,
        waybill: orders.waybill,
        callbackAt: orders.callbackAt,
        trackText: orders.trackText,
        createdAt: orders.createdAt,
        siteId: orders.siteId,
        source: orders.source,
        isExample: orders.isExample,
      })
      .from(orders)
      .where(and(inArray(orders.organizationId, orgs), filter, pay.success && acc.finance ? eq(orders.paymentStatus, pay.data) : undefined, acc.full ? undefined : inArray(orders.status, [...SHIPPING_STATUSES])))
      .orderBy(order, desc(orders.number))
      .limit(limit)
      .offset(offset)
      .then((rows) => rows.map((r) => ({ ...r, customerPhone: acc.full ? r.customerPhone : maskPhone(r.customerPhone), ...(acc.finance ? {} : { totalKop: null, paymentStatus: null }) })));
  });

  /**
   * Global search («/» in the panel): orders by number, customer name or phone, products by name. Five of each,
   * newest first, only what the member may see.
   */
  app.get<{ Querystring: { q?: string } }>("/search", async (req) => {
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    if (q.length < 2) return { orders: [], products: [] };
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, "");
    const acc = await orderAccess(req);
    const found = acc
      ? await db
          .select({ id: orders.id, number: orders.number, customerName: orders.customerName, status: orders.status, createdAt: orders.createdAt })
          .from(orders)
          .where(
            and(
              eq(orders.organizationId, acc.org),
              eq(orders.isExample, false),
              acc.full ? undefined : inArray(orders.status, [...SHIPPING_STATUSES]),
              or(
                ilike(orders.customerName, like),
                digits.length >= 3 ? dsql`regexp_replace(${orders.customerPhone}, '[^0-9]', '', 'g') like ${`%${digits}%`}` : undefined,
                /^[#№]?\s*\d+$/.test(q) && Number(digits) <= 2_147_483_647 ? eq(orders.number, Number(digits)) : undefined,
              ),
            ),
          )
          .orderBy(desc(orders.createdAt))
          .limit(5)
      : [];
    const [prodOrg] = await orgScope(req, "products");
    const prods = prodOrg
      ? await db.select({ id: products.id, name: products.name, stock: products.stock, active: products.active, priceKop: products.priceKop }).from(products).where(and(eq(products.organizationId, prodOrg), ilike(products.name, like))).orderBy(asc(products.name)).limit(5)
      : [];
    // Customers by name or phone (the base needs `orders`, not shipping only).
    const people = acc?.full
      ? await db
          .select({ id: customers.id, name: customers.name, phone: customers.phone })
          .from(customers)
          .where(and(eq(customers.organizationId, acc.org), dsql`${customers.anonymizedAt} is null`, or(ilike(customers.name, like), digits.length >= 3 ? dsql`(${customers.phoneKey} || ',' || array_to_string(${customers.extraPhones}, ',')) like ${`%${digits}%`}` : undefined)))
          .orderBy(desc(customers.updatedAt))
          .limit(5)
      : [];
    return { orders: found, products: prods, customers: people };
  });

  // Orders the team entered by hand are not «new» for the window: whoever entered it already knows.
  const MANUAL_NOT = dsql`not exists (select 1 from order_events e where e.order_id = ${orders.id} and e.kind = 'created')`;

  /**
   * New orders since the last check, for the «Нове замовлення» window and sound while the panel is open, plus
   * how many wait for confirmation (the browser tab counter). The first call (no `after`) returns only `now`.
   */
  app.get<{ Querystring: { after?: string } }>("/orders/fresh", async (req) => {
    const now = new Date();
    const acc = await orderAccess(req);
    if (!acc?.full) return { now, newCount: 0, orders: [] };
    const [c] = await db.select({ n: count() }).from(orders).where(and(eq(orders.organizationId, acc.org), eq(orders.isExample, false), eq(orders.status, "new")));
    const after = z.string().datetime().safeParse(req.query.after);
    const rows = after.success
      ? await db
          .select({ id: orders.id, number: orders.number, customerName: orders.customerName, totalKop: orders.totalKop, items: orders.items, createdAt: orders.createdAt })
          .from(orders)
          .where(and(eq(orders.organizationId, acc.org), eq(orders.isExample, false), eq(orders.status, "new"), MANUAL_NOT, gt(orders.createdAt, new Date(after.data)), lte(orders.createdAt, now)))
          .orderBy(asc(orders.createdAt))
          .limit(10)
      : [];
    return {
      now,
      newCount: c?.n ?? 0,
      orders: rows.map((o) => ({ ...o, totalKop: acc.finance ? o.totalKop : null, items: o.items.map((i) => ({ name: i.name, qty: i.qty })) })),
    };
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!uuid.safeParse(req.params.id).success || !acc) return reply.code(404).send({ error: "not_found" });
    const [o] = await db.select().from(orders).where(and(eq(orders.id, req.params.id), eq(orders.organizationId, acc.org), acc.full ? undefined : inArray(orders.status, [...SHIPPING_STATUSES])));
    if (!o) return reply.code(404).send({ error: "not_found" });
    // One timeline: statuses, payment, comments, waybills, edits, calls — with who did it.
    const events = await db
      .select({ kind: orderEvents.kind, status: orderEvents.status, data: orderEvents.data, at: orderEvents.createdAt, by: users.name })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.userId))
      .where(eq(orderEvents.orderId, o.id))
      .orderBy(asc(orderEvents.createdAt));
    const [assignee] = o.assigneeId ? await db.select({ name: users.name }).from(users).where(eq(users.id, o.assigneeId)) : [];
    // Mini card of the customer: tags (with «Проблемний» → advice «лише передоплата») and how many orders.
    let customer = null;
    if (acc.full && o.customerId) {
      const [c] = await db.select({ id: customers.id, name: customers.name, tags: customers.tags }).from(customers).where(eq(customers.id, o.customerId));
      const [s] = await db
        .select({ orders: dsql<number>`count(*) filter (where ${orders.status} <> 'cancelled')`.mapWith(Number), done: dsql<number>`count(*) filter (where ${orders.status} = 'done')`.mapWith(Number), returned: dsql<number>`count(*) filter (where ${orders.status} = 'returned')`.mapWith(Number) })
        .from(orders)
        .where(and(eq(orders.customerId, o.customerId), eq(orders.isExample, false)));
      if (c && s) customer = { ...c, orders: s.orders, auto: autoTags(s) };
    }
    const extra = { assignee: assignee?.name ?? null, duplicates: acc.full && !o.isExample ? await duplicatesOf(o) : [], customer };
    const { ip: _ip, ...base } = o;
    const all = { ...base, ...extra };
    // «Комплектувальник» sees the phone partly (the carrier has it on the waybill anyway).
    const rest = acc.full ? all : { ...all, customerPhone: maskPhone(all.customerPhone), customerEmail: null };
    // Without `finance`: no sums at all (total, item prices, prepayment).
    if (!acc.finance) return { ...rest, totalKop: null, prepaidKop: null, paymentStatus: null, items: rest.items.map((i) => ({ ...i, priceKop: null })), events, finance: false };
    return { ...rest, events, finance: true };
  });

  app.patch<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
    const p = OrderPatch.safeParse(req.body);
    const acc = await orderAccess(req);
    if (!p.success || !uuid.safeParse(req.params.id).success || !acc) return reply.code(400).send({ error: "invalid_input" });
    const orgs = [acc.org];
    // Shipping only: mark orders in work as sent (and take it back: «Скасувати»), enter the waybill; nothing else.
    if (!acc.full && ((p.data.status && !(SHIPPING_STATUSES as readonly string[]).includes(p.data.status)) || p.data.statusId || p.data.warranty || p.data.payment)) return reply.code(403).send({ error: "forbidden" });
    if (!acc.full) {
      const [o] = await db.select({ status: orders.status }).from(orders).where(and(eq(orders.id, req.params.id), eq(orders.organizationId, acc.org)));
      if (!o || !(SHIPPING_STATUSES as readonly string[]).includes(o.status)) return reply.code(404).send({ error: "not_found" });
    }
    if (p.data.status || p.data.statusId !== undefined) {
      const from = acc.full ? undefined : p.data.status === "shipped" ? (["confirmed"] as const) : (["shipped"] as const);
      const r = await setOrderStatus(req.params.id, orgs, { status: p.data.status, statusId: p.data.statusId, reason: p.data.reason }, req.auth!.user.id, from);
      if (!r.ok) return reply.code(r.error === "not_found" ? 404 : r.error === "forbidden" ? 403 : r.error === "reason_required" || r.error === "invalid_status" ? 400 : 409).send({ error: r.error });
    }
    if (p.data.payment) {
      if (!acc.finance) return reply.code(403).send({ error: "forbidden" });
      const r = await setPayment(req.params.id, acc.org, p.data.payment.status, p.data.payment.prepaidKop, req.auth!.user.id);
      if (!r.ok) return reply.code(r.error === "not_found" ? 404 : 400).send({ error: r.error });
    }
    if (p.data.waybill !== undefined || p.data.warranty) {
      await db
        .update(orders)
        .set({ ...(p.data.waybill !== undefined ? { waybill: p.data.waybill, waybillRef: null } : {}), ...(p.data.warranty ? { warranty: p.data.warranty } : {}), updatedAt: new Date() })
        .where(and(eq(orders.id, req.params.id), inArray(orders.organizationId, orgs)));
    }
    return { ok: true };
  });

  /** Replace a site's public key (e.g. if it leaked into the wrong place). */
  app.post<{ Params: { siteId: string } }>("/sites/:siteId/rotate-key", async (req, reply) => {
    const site = await ownSite(req, req.params.siteId, "site");
    if (!site) return reply.code(404).send({ error: "not_found" });
    const key = `sk_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.update(sites).set({ publicKey: key }).where(eq(sites.id, site.id));
    await audit(req, "site.rotate_key", req.auth!.user.id, { site: site.id }, site.organizationId);
    return { publicKey: key };
  });
};
