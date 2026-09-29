import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, inArray, lt, ne, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { orderEvents, orderStatuses, orders, products } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { SHIPPING_STATUSES, orderAccess } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { dropExamples } from "../onboarding/routes.ts";
import { setOrderStatus } from "./service.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Item = { productId: string; name: string; qty: number; priceKop: number };
const HOUR = 3_600_000;
/** «Не додзвонились»: call again in 2 hours. */
export const CALLBACK_AFTER = 2 * HOUR;
/** Orders that can still be edited: not sent yet. */
const EDITABLE = ["new", "confirmed"] as const;
export const MANUAL_SOURCES = ["call", "instagram", "viber", "telegram", "facebook", "tiktok", "in_person"] as const;
const isProduct = (id: string) => /^[0-9a-f-]{36}$/.test(id);

/** Takes (qty > 0) or returns (qty < 0) catalogue items from stock; not-tracked products are skipped. */
async function moveStock(tx: Tx, orgId: string, delta: Map<string, number>) {
  const ids = [...delta.keys()].filter(isProduct);
  if (!ids.length) return { ok: true as const };
  const rows = await tx.select().from(products).where(and(inArray(products.id, ids), eq(products.organizationId, orgId))).for("update");
  for (const p of rows) {
    const q = delta.get(p.id) ?? 0;
    if (!q || p.stock === null) continue;
    if (q > 0 && p.stock < q) return { ok: false as const, error: "out_of_stock", productId: p.id };
    await tx.update(products).set({ stock: p.stock - q, updatedAt: new Date() }).where(eq(products.id, p.id));
  }
  return { ok: true as const };
}
const qtyMap = (items: Item[]) => items.reduce((m, i) => m.set(i.productId, (m.get(i.productId) ?? 0) + i.qty), new Map<string, number>());

/** Catalogue items get the price from the database; a free item («довільний товар») keeps its name and price. */
async function buildItems(orgId: string, input: z.infer<typeof ItemIn>[]) {
  const ids = input.map((i) => i.productId).filter((x): x is string => !!x);
  const rows = ids.length ? await db.select().from(products).where(and(inArray(products.id, ids), eq(products.organizationId, orgId))) : [];
  const items: Item[] = [];
  for (const [n, i] of input.entries()) {
    if (i.productId) {
      const p = rows.find((r) => r.id === i.productId);
      if (!p) return null;
      items.push({ productId: p.id, name: p.name, qty: i.qty, priceKop: p.priceKop });
    } else items.push({ productId: `free:${n}`, name: i.name!, qty: i.qty, priceKop: Math.round(i.price! * 100) });
  }
  return items;
}

const ItemIn = z
  .object({ productId: z.string().uuid().optional(), name: z.string().trim().min(1).max(200).optional(), price: z.number().min(0).max(10_000_000).optional(), qty: z.number().int().min(1).max(999) })
  .refine((i) => !!i.productId || (!!i.name && i.price !== undefined), "catalogue item or name + price");
const Delivery = z.object({ method: z.enum(["novaposhta", "ukrposhta", "pickup", "courier"]), city: z.string().trim().max(100).optional(), branch: z.string().trim().max(200).optional(), address: z.string().trim().max(300).optional() });
const Customer = z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().regex(/^\+?[0-9\s()-]{9,20}$/), email: z.string().trim().email().max(254).optional().or(z.literal("")) });
const Manual = z.object({
  customer: Customer,
  items: z.array(ItemIn).min(1).max(50),
  delivery: Delivery,
  payment: z.enum(["cod", "iban", "card"]),
  source: z.string().trim().min(1).max(40),
  comment: z.string().trim().max(1000).optional(),
});
const Edit = z.object({ customer: Customer.optional(), items: z.array(ItemIn).min(1).max(50).optional(), delivery: Delivery.optional(), comment: z.string().trim().max(1000).nullable().optional() });

/** Other orders of the same phone within 24 hours (not cancelled): probably one purchase placed twice. */
export async function duplicatesOf(o: typeof orders.$inferSelect) {
  const digits = o.customerPhone.replace(/\D/g, "").slice(-9);
  if (digits.length < 9) return [];
  return db
    .select({ id: orders.id, number: orders.number, status: orders.status, createdAt: orders.createdAt })
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, o.organizationId),
        ne(orders.id, o.id),
        eq(orders.isExample, false),
        ne(orders.status, "cancelled"),
        gt(orders.createdAt, new Date(o.createdAt.getTime() - 24 * HOUR)),
        lt(orders.createdAt, new Date(o.createdAt.getTime() + 24 * HOUR)),
        dsql`right(regexp_replace(${orders.customerPhone}, '[^0-9]', '', 'g'), 9) = ${digits}`,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(5);
}

/** /api/shop: manual orders, editing before sending, comments, the responsible person, calls, duplicates. */
export const orderWorkRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /** «+ Замовлення»: a customer, catalogue or free items, delivery, payment and where it came from. */
  app.post("/orders", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!acc?.full) return reply.code(403).send({ error: "forbidden" });
    const p = Manual.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const items = await buildItems(acc.org, p.data.items);
    if (!items) return reply.code(400).send({ error: "unknown_product" });
    const userId = req.auth!.user.id;
    const r = await db.transaction(async (tx) => {
      const s = await moveStock(tx, acc.org, qtyMap(items));
      if (!s.ok) return s;
      const [o] = await tx
        .insert(orders)
        .values({
          organizationId: acc.org,
          source: p.data.source,
          customerName: p.data.customer.name,
          customerPhone: p.data.customer.phone.replace(/\s/g, ""),
          customerEmail: p.data.customer.email || null,
          items,
          totalKop: items.reduce((sum, i) => sum + i.priceKop * i.qty, 0),
          delivery: p.data.delivery,
          payment: p.data.payment,
          comment: p.data.comment || null,
          assigneeId: userId,
        })
        .returning({ id: orders.id, number: orders.number });
      await tx.insert(orderEvents).values({ orderId: o!.id, kind: "created", status: "new", userId, data: { source: p.data.source } });
      return { ok: true as const, order: o! };
    });
    if (!r.ok) return reply.code(409).send(r);
    await dropExamples(acc.org);
    await audit(req, "order.manual", userId, { order: r.order.id }, acc.org);
    return reply.code(201).send(r.order);
  });

  /** Editing until the order is sent; stock follows the change, every change is in the history. */
  app.patch<{ Params: { id: string } }>("/orders/:id/edit", async (req, reply) => {
    const acc = await orderAccess(req);
    const p = Edit.safeParse(req.body);
    if (!acc?.full) return reply.code(403).send({ error: "forbidden" });
    if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const items = p.data.items ? await buildItems(acc.org, p.data.items) : null;
    if (p.data.items && !items) return reply.code(400).send({ error: "unknown_product" });
    const r = await db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, req.params.id), eq(orders.organizationId, acc.org))).for("update");
      if (!o) return { ok: false as const, error: "not_found" };
      if (!(EDITABLE as readonly string[]).includes(o.status)) return { ok: false as const, error: "not_editable" };
      const changed: Record<string, unknown> = {};
      const set: Partial<typeof orders.$inferInsert> = {};
      if (items) {
        // Kept free items keep their key; stock moves by the difference.
        const delta = qtyMap(items);
        for (const [id, q] of qtyMap(o.items)) delta.set(id, (delta.get(id) ?? 0) - q);
        const s = await moveStock(tx, acc.org, delta);
        if (!s.ok) return s;
        set.items = items;
        set.totalKop = items.reduce((sum, i) => sum + i.priceKop * i.qty, 0);
        changed.items = { from: o.items.map((i) => `${i.name} × ${i.qty}`), to: items.map((i) => `${i.name} × ${i.qty}`) };
        if (o.paymentStatus === "prepaid" && o.prepaidKop >= set.totalKop) Object.assign(set, { paymentStatus: "unpaid", prepaidKop: 0 });
      }
      if (p.data.customer) {
        const c = { customerName: p.data.customer.name, customerPhone: p.data.customer.phone.replace(/\s/g, ""), customerEmail: p.data.customer.email || null };
        if (c.customerName !== o.customerName || c.customerPhone !== o.customerPhone || c.customerEmail !== o.customerEmail) {
          Object.assign(set, c);
          changed.customer = { from: `${o.customerName}, ${o.customerPhone}`, to: `${c.customerName}, ${c.customerPhone}` };
        }
      }
      if (p.data.delivery && JSON.stringify(p.data.delivery) !== JSON.stringify(o.delivery)) {
        // A new address makes an old waybill wrong only if one was made; that stays visible in the history.
        set.delivery = p.data.delivery;
        changed.delivery = { from: [o.delivery.city, o.delivery.branch, o.delivery.address].filter(Boolean).join(", "), to: [p.data.delivery.city, p.data.delivery.branch, p.data.delivery.address].filter(Boolean).join(", ") };
      }
      if (p.data.comment !== undefined && (p.data.comment || null) !== o.comment) {
        set.comment = p.data.comment || null;
        changed.comment = true;
      }
      if (!Object.keys(changed).length) return { ok: true as const };
      await tx.update(orders).set({ ...set, updatedAt: new Date() }).where(eq(orders.id, o.id));
      await tx.insert(orderEvents).values({ orderId: o.id, kind: "edit", userId: req.auth!.user.id, data: changed });
      return { ok: true as const };
    });
    if (!r.ok) return reply.code(r.error === "not_found" ? 404 : 409).send(r);
    return r;
  });

  /** Internal comment of the team (never shown to the customer). */
  app.post<{ Params: { id: string } }>("/orders/:id/comments", async (req, reply) => {
    const acc = await orderAccess(req);
    const p = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!acc || !p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [o] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, req.params.id), eq(orders.organizationId, acc.org)));
    if (!o) return reply.code(404).send({ error: "not_found" });
    await db.insert(orderEvents).values({ orderId: o.id, kind: "comment", userId: req.auth!.user.id, data: { text: p.data.text } });
    return reply.code(201).send({ ok: true });
  });

  /** «Взяти в роботу»: the person becomes responsible. */
  app.post<{ Params: { id: string } }>("/orders/:id/take", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!acc?.full || !z.string().uuid().safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    const [o] = await db.update(orders).set({ assigneeId: req.auth!.user.id, updatedAt: new Date() }).where(and(eq(orders.id, req.params.id), eq(orders.organizationId, acc.org))).returning({ id: orders.id });
    if (!o) return reply.code(404).send({ error: "not_found" });
    await db.insert(orderEvents).values({ orderId: o.id, kind: "assign", userId: req.auth!.user.id });
    return { ok: true };
  });

  /** «Не додзвонились»: the call is written down and the order comes back in 2 hours. */
  app.post<{ Params: { id: string } }>("/orders/:id/no-answer", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!acc?.full || !z.string().uuid().safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    const at = new Date(Date.now() + CALLBACK_AFTER);
    const [o] = await db
      .update(orders)
      .set({ callbackAt: at, updatedAt: new Date() })
      .where(and(eq(orders.id, req.params.id), eq(orders.organizationId, acc.org), inArray(orders.status, [...EDITABLE])))
      .returning({ id: orders.id });
    if (!o) return reply.code(409).send({ error: "not_editable" });
    await db.insert(orderEvents).values({ orderId: o.id, kind: "call", userId: req.auth!.user.id, data: { result: "no_answer", callbackAt: at.toISOString() } });
    return { callbackAt: at };
  });

  /**
   * Duplicate: the other order's items move into this one and the other is cancelled as «Дубль». Items only move,
   * so stock does not change.
   */
  app.post<{ Params: { id: string } }>("/orders/:id/merge", async (req, reply) => {
    const acc = await orderAccess(req);
    const p = z.object({ other: z.string().uuid() }).safeParse(req.body);
    if (!acc?.full || !p.success || !z.string().uuid().safeParse(req.params.id).success || p.data.other === req.params.id) return reply.code(400).send({ error: "invalid_input" });
    const userId = req.auth!.user.id;
    const r = await db.transaction(async (tx) => {
      const both = await tx.select().from(orders).where(and(inArray(orders.id, [req.params.id, p.data.other]), eq(orders.organizationId, acc.org))).for("update");
      const main = both.find((x) => x.id === req.params.id);
      const other = both.find((x) => x.id === p.data.other);
      if (!main || !other) return { ok: false as const, error: "not_found" };
      if (![main, other].every((x) => (EDITABLE as readonly string[]).includes(x.status) && !x.waybill)) return { ok: false as const, error: "not_editable" };
      const items = [...main.items, ...other.items.map((i, n) => (isProduct(i.productId) ? i : { ...i, productId: `${i.productId}-m${n}` }))];
      await tx.update(orders).set({ items, totalKop: main.totalKop + other.totalKop, updatedAt: new Date() }).where(eq(orders.id, main.id));
      await tx.update(orders).set({ status: "cancelled", statusId: null, cancelReason: "duplicate", callbackAt: null, updatedAt: new Date() }).where(eq(orders.id, other.id));
      await tx.insert(orderEvents).values([
        { orderId: main.id, kind: "merge", userId, data: { number: other.number } },
        { orderId: other.id, kind: "status", status: "cancelled", userId, data: { reason: "duplicate", mergedInto: main.number } },
      ]);
      return { ok: true as const };
    });
    if (!r.ok) return reply.code(r.error === "not_found" ? 404 : 409).send(r);
    await audit(req, "order.merge", userId, { order: req.params.id, other: p.data.other }, acc.org);
    return r;
  });

  /**
   * Bulk status change of the orders chosen in the list. Each order goes through the same rules (stock, reason
   * for cancelling); the answer says which could not be changed and why.
   */
  app.post("/orders/bulk-status", async (req, reply) => {
    const acc = await orderAccess(req);
    const p = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(200), status: z.enum(["new", "confirmed", "shipped", "done", "cancelled", "returned"]).optional(), statusId: z.string().uuid().nullable().optional(), reason: z.string().trim().max(200).optional() })
      .safeParse(req.body);
    if (!acc || !p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!acc.full && (p.data.status !== "shipped" || p.data.statusId)) return reply.code(403).send({ error: "forbidden" });
    const rows = await db.select({ id: orders.id, number: orders.number }).from(orders).where(and(eq(orders.organizationId, acc.org), inArray(orders.id, p.data.ids)));
    const failed: { number: number; error: string }[] = [];
    for (const o of rows) {
      const r = await setOrderStatus(o.id, [acc.org], { status: p.data.status, statusId: p.data.statusId, reason: p.data.reason }, req.auth!.user.id, acc.full ? undefined : ["confirmed"]);
      if (!r.ok) failed.push({ number: o.number, error: r.error });
    }
    await audit(req, "order.bulk_status", req.auth!.user.id, { n: rows.length, status: p.data.status ?? p.data.statusId }, acc.org);
    return { done: rows.length - failed.length, failed };
  });

  /**
   * Excel (CSV that Excel opens: UTF-8 with BOM, «;»). The chosen orders or the current filter. No sums without
   * «Фінанси»; «Комплектувальник» gets only the orders to send and partly hidden phones.
   */
  app.get<{ Querystring: { ids?: string; status?: string } }>("/orders/export", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!acc) return reply.code(403).send({ error: "forbidden" });
    const ids = String(req.query.ids ?? "").split(",").filter((x) => z.string().uuid().safeParse(x).success).slice(0, 5000);
    const st = z.enum(["new", "confirmed", "shipped", "done", "cancelled", "returned"]).safeParse(req.query.status);
    const rows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.organizationId, acc.org), eq(orders.isExample, false), ids.length ? inArray(orders.id, ids) : undefined, st.success ? eq(orders.status, st.data) : undefined, acc.full ? undefined : inArray(orders.status, [...SHIPPING_STATUSES])))
      .orderBy(desc(orders.createdAt))
      .limit(5000);
    const own = new Map((await db.select().from(orderStatuses).where(eq(orderStatuses.organizationId, acc.org))).map((s) => [s.id, s.name]));
    const GROUP: Record<string, string> = { new: "Нове", confirmed: "В роботі", shipped: "Відправлено", done: "Завершено", cancelled: "Скасовано", returned: "Повернення" };
    const PAY: Record<string, string> = { unpaid: "Не оплачено", prepaid: "Передоплата", paid: "Оплачено", refunded: "Кошти повернуто" };
    const date = (d: Date) => d.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const cell = (v: unknown) => {
      const s = String(v ?? "");
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["№", "Дата", "Статус", "Покупець", "Телефон", "Товари", ...(acc.finance ? ["Сума, грн", "Оплата"] : []), "Доставка", "ТТН", "Джерело", "Коментар"];
    const lines = rows.map((o) =>
      [
        o.number,
        date(o.createdAt),
        (o.statusId && own.get(o.statusId)) || GROUP[o.status],
        o.customerName,
        acc.full ? o.customerPhone : "***",
        o.items.map((i) => `${i.name} × ${i.qty}`).join(", "),
        ...(acc.finance ? [(o.totalKop / 100).toFixed(2).replace(".", ","), PAY[o.paymentStatus]] : []),
        [o.delivery.method, o.delivery.city, o.delivery.branch, o.delivery.address].filter(Boolean).join(", "),
        o.waybill ?? "",
        o.source,
        o.comment ?? "",
      ]
        .map(cell)
        .join(";"),
    );
    await audit(req, "order.export", req.auth!.user.id, { n: rows.length }, acc.org);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(`\uFEFF${[head.join(";"), ...lines].join("\r\n")}`);
  });
};
