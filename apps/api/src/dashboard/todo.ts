import { and, count, desc, eq, gt, inArray, isNull, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { insightDismissals, monitorChecks, orders, products, reviews, sites, subscriptions, tickets } from "../db/schema.ts";
import type { Permission } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { orderSettingsOf } from "../shop/settings.ts";

/**
 * «Що треба зробити»: things that need a person, each counted from real data and leading to the filtered list.
 * The id carries the numbers, so «Нагадати завтра» hides an item only until something changes.
 */
export type Todo = { id: string; key: string; tone: "bad" | "warn"; params: Record<string, string | number>; screen: string; tab?: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const CARRIERS = ["novaposhta", "ukrposhta"];
export const LOW_STOCK = 2;

/** Orders in work going by a carrier that still have no waybill. */
export const needsWaybill = () => and(eq(orders.status, "confirmed"), isNull(orders.waybill), inArray(dsql`${orders.delivery}->>'method'`, CARRIERS));

export async function todoFor(orgId: string, perms: Permission[], now = new Date()): Promise<Todo[]> {
  const out: Todo[] = [];
  const can = (p: Permission) => perms.includes(p);

  // Money first: the subscription, then orders.
  if (can("billing")) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
    if (sub?.status === "grace" || sub?.status === "suspended") out.push({ id: `billing:${sub.status}`, tone: "bad", key: sub.status === "grace" ? "billingGrace" : "billingSuspended", params: {}, screen: "billing" });
  }
  if (can("orders")) {
    // A new order becomes urgent when nobody took it within the business's hours («Бізнес → Замовлення»).
    const urgentAfter = (await orderSettingsOf(orgId)).urgentHours * HOUR;
    const [o] = await db
      .select({
        n: dsql<number>`count(*) filter (where ${orders.status} = 'new')`.mapWith(Number),
        urgent: dsql<number>`count(*) filter (where ${orders.status} = 'new' and ${orders.createdAt} <= ${new Date(now.getTime() - urgentAfter).toISOString()}::timestamptz)`.mapWith(Number),
      })
      .from(orders)
      .where(and(eq(orders.organizationId, orgId), eq(orders.isExample, false)));
    const [cb] = await db.select({ n: count() }).from(orders).where(and(eq(orders.organizationId, orgId), inArray(orders.status, ["new", "confirmed"]), lte(orders.callbackAt, now)));
    if (cb && cb.n > 0) out.push({ id: `callback:${cb.n}:${now.toISOString().slice(0, 13)}`, tone: "bad", key: "callback", params: { n: cb.n }, screen: "orders", tab: "callback" });
    if (o && o.n > 0) out.push({ id: `newOrders:${o.n}:${o.urgent}`, tone: o.urgent ? "bad" : "warn", key: o.urgent ? "newOrdersUrgent" : "newOrders", params: { n: o.n, urgent: o.urgent }, screen: "orders", tab: "new" });
  }
  if (can("orders") || can("shipping")) {
    const [w] = await db.select({ n: count() }).from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.isExample, false), needsWaybill()));
    if (w && w.n > 0) out.push({ id: `noWaybill:${w.n}`, tone: "warn", key: "noWaybill", params: { n: w.n }, screen: "orders", tab: "nowaybill" });
  }
  if (can("site")) {
    for (const s of await db.select().from(sites).where(eq(sites.organizationId, orgId))) {
      if (s.status === "live" && s.lastUp === false) out.push({ id: `down:${s.id}`, tone: "bad", key: "siteDown", params: { domain: s.domain }, screen: "site" });
      const [last] = await db.select({ ssl: monitorChecks.sslValidTo }).from(monitorChecks).where(eq(monitorChecks.siteId, s.id)).orderBy(desc(monitorChecks.checkedAt)).limit(1);
      if (last?.ssl) {
        const days = Math.floor((last.ssl.getTime() - now.getTime()) / DAY);
        if (days <= 14) out.push({ id: `ssl:${s.id}:${days}`, tone: days <= 3 ? "bad" : "warn", key: "sslExpiring", params: { domain: s.domain, days }, screen: "site" });
      }
    }
  }
  if (can("products")) {
    const [p] = await db
      .select({
        out: dsql<number>`count(*) filter (where ${products.stock} = 0)`.mapWith(Number),
        low: dsql<number>`count(*) filter (where ${products.stock} between 1 and ${LOW_STOCK})`.mapWith(Number),
      })
      .from(products)
      .where(and(eq(products.organizationId, orgId), eq(products.active, true)));
    if (p && p.out > 0) out.push({ id: `outOfStock:${p.out}`, tone: "warn", key: "outOfStock", params: { n: p.out }, screen: "products" });
    if (p && p.low > 0) out.push({ id: `lowStock:${p.low}`, tone: "warn", key: "lowStock", params: { n: p.low, max: LOW_STOCK }, screen: "products" });
  }
  if (can("reviews") && (await hasModule(orgId, "reviews"))) {
    const [r] = await db.select({ n: count() }).from(reviews).where(and(eq(reviews.organizationId, orgId), eq(reviews.status, "pending")));
    if (r && r.n > 0) out.push({ id: `reviews:${r.n}`, tone: "warn", key: "reviewsPending", params: { n: r.n }, screen: "reviews" });
  }
  if (can("support")) {
    const [t] = await db.select({ n: count() }).from(tickets).where(and(eq(tickets.organizationId, orgId), eq(tickets.status, "answered")));
    if (t && t.n > 0) out.push({ id: `support:${t.n}`, tone: "warn", key: "supportAnswered", params: { n: t.n }, screen: "support" });
  }

  const snoozed = await db.select({ id: insightDismissals.insightId }).from(insightDismissals).where(and(eq(insightDismissals.organizationId, orgId), gt(insightDismissals.until, now)));
  const hide = new Set(snoozed.map((d) => d.id));
  return out.filter((i) => !hide.has(i.id));
}

/** Orders to send: in work, not shipped yet. Oldest first, so nothing waits forever. */
export async function toShip(orgId: string) {
  return db
    .select({ id: orders.id, number: orders.number, customerName: orders.customerName, totalKop: orders.totalKop, status: orders.status, waybill: orders.waybill, method: dsql<string>`${orders.delivery}->>'method'`, createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.organizationId, orgId), eq(orders.isExample, false), eq(orders.status, "confirmed")))
    .orderBy(orders.createdAt)
    .limit(50);
}
