import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { notifications, orderEvents, orders } from "../db/schema.ts";

export type MarketOrder = {
  externalId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  items: { productId: string; name: string; qty: number; priceKop: number }[];
  totalKop: number;
  status: "new" | "confirmed" | "paid" | "shipped" | "done" | "cancelled";
  delivery: { method: string; city?: string; branch?: string; address?: string };
  payment: string;
  comment: string | null;
  waybill: string | null;
  createdAt: Date;
};

/** Stores a marketplace order once (unique per organization, source and external id) and notifies. */
export async function insertMarketOrder(orgId: string, source: string, o: MarketOrder): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [ins] = await tx
      .insert(orders)
      .values({ organizationId: orgId, siteId: null, source, ...o })
      .onConflictDoNothing({ target: [orders.organizationId, orders.source, orders.externalId] })
      .returning({ id: orders.id, number: orders.number });
    if (!ins) return false;
    // The first real order replaces the «Приклад» ones.
    await tx.delete(orders).where(and(eq(orders.organizationId, orgId), eq(orders.isExample, true)));
    await tx.insert(orderEvents).values({ orderId: ins.id, status: o.status });
    await tx.insert(notifications).values({ organizationId: orgId, kind: "order", key: "newOrder", params: { n: ins.number, total: o.totalKop / 100 } });
    return true;
  });
}

/** Marketplaces send local Kyiv time without an offset ("2019-07-25 11:49:32"). */
export function kyivTime(s: string): Date {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(s);
  if (!m) return new Date();
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  // Offset of Kyiv at that moment (+2 or +3), read from the time zone database.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const kyivOfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(asUtc - (kyivOfUtc - asUtc));
}
