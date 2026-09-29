import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { notifications, orderEvents, orders, products } from "../db/schema.ts";

export type OrderStatus = (typeof orders.$inferSelect)["status"];
export type NewOrder = {
  customer: { name: string; phone: string; email?: string };
  items: { productId: string; qty: number }[];
  delivery: { method: string; city?: string; branch?: string; address?: string };
  payment: string;
  comment?: string;
};

/**
 * Creates an order from the client's website. Prices and names come from the database (never from the
 * request); stock is checked and reserved in the same transaction with row locks.
 */
export async function placeOrder(site: { id: string; organizationId: string }, input: NewOrder, ip: string) {
  const ids = [...new Set(input.items.map((i) => i.productId))];
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(products).where(and(inArray(products.id, ids), eq(products.siteId, site.id), eq(products.active, true))).for("update");
    if (rows.length !== ids.length) return { ok: false as const, error: "unknown_product" };
    const byId = new Map(rows.map((r) => [r.id, r]));
    const qty = new Map<string, number>();
    for (const i of input.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.qty);
    for (const [id, q] of qty) {
      const p = byId.get(id)!;
      if (p.stock !== null && p.stock < q) return { ok: false as const, error: "out_of_stock", productId: id };
    }
    const items = [...qty].map(([id, q]) => ({ productId: id, name: byId.get(id)!.name, qty: q, priceKop: byId.get(id)!.priceKop }));
    const totalKop = items.reduce((s, i) => s + i.priceKop * i.qty, 0);
    for (const [id, q] of qty) {
      if (byId.get(id)!.stock !== null) await tx.update(products).set({ stock: dsql`${products.stock} - ${q}`, updatedAt: new Date() }).where(eq(products.id, id));
    }
    const [o] = await tx
      .insert(orders)
      .values({
        organizationId: site.organizationId,
        siteId: site.id,
        customerName: input.customer.name,
        customerPhone: input.customer.phone,
        customerEmail: input.customer.email || null,
        items,
        totalKop,
        delivery: input.delivery,
        payment: input.payment,
        comment: input.comment || null,
        ip,
      })
      .returning({ id: orders.id, number: orders.number, totalKop: orders.totalKop, status: orders.status });
    await tx.insert(orderEvents).values({ orderId: o!.id, status: "new" });
    // The first real order replaces the «Приклад» ones.
    await tx.delete(orders).where(and(eq(orders.organizationId, site.organizationId), eq(orders.isExample, true)));
    await tx.insert(notifications).values({ organizationId: site.organizationId, kind: "order", key: "newOrder", params: { n: o!.number, total: totalKop / 100 } });
    return { ok: true as const, order: o! };
  });
}

/** Status change with stock bookkeeping: cancelling returns items to stock, reopening takes them again. */
/** `from`: the change is allowed only from these statuses (a shipping-only member: confirmed / paid to shipped). */
export async function setOrderStatus(orderId: string, orgIds: string[], status: OrderStatus, userId: string, from?: readonly OrderStatus[]) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), inArray(orders.organizationId, orgIds))).for("update");
    if (!o) return { ok: false as const, error: "not_found" };
    if (o.status === status) return { ok: true as const };
    if (from && !from.includes(o.status)) return { ok: false as const, error: "forbidden" };
    const restock = status === "cancelled" ? 1 : o.status === "cancelled" ? -1 : 0;
    if (restock) {
      // Marketplace items ("prom:123") are not local products and have no stock here.
      const ids = o.items.map((i) => i.productId).filter((id) => /^[0-9a-f-]{36}$/.test(id));
      const rows = ids.length ? await tx.select().from(products).where(inArray(products.id, ids)).for("update") : [];
      for (const i of o.items) {
        const p = rows.find((r) => r.id === i.productId);
        if (!p || p.stock === null) continue;
        if (restock < 0 && p.stock < i.qty) return { ok: false as const, error: "out_of_stock" };
        await tx.update(products).set({ stock: p.stock + restock * i.qty, updatedAt: new Date() }).where(eq(products.id, p.id));
      }
    }
    await tx.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, orderId));
    await tx.insert(orderEvents).values({ orderId, status, userId });
    return { ok: true as const };
  });
}
