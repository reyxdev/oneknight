import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { integrations, notifications, orderEvents, orders } from "../db/schema.ts";
import { hasModule } from "../billing/service.ts";
import { decrypt } from "../security/crypto.ts";

/** Prom.ua public API v1 (https://public-api.docs.prom.ua), Bearer token from the seller's cabinet. */
export type PromFetch = (token: string, path: string) => Promise<{ status: number; body: any }>;

export const promFetch: PromFetch = async (token, path) => {
  const res = await fetch(`https://my.prom.ua/api/v1${path}`, { headers: { authorization: `Bearer ${token}`, "x-language": "uk" }, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

export async function verifyPromToken(token: string, f: PromFetch = promFetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await f(token, "/orders/list?limit=1");
  if (r.status === 200 && Array.isArray(r.body?.orders)) return { ok: true };
  return { ok: false, error: r.status === 401 || r.status === 403 ? "unauthorized" : `http_${r.status}` };
}

/** Prom sends money as strings ("1100", "1 100,50 грн"): keep digits and the decimal part. */
export function promKop(v: unknown): number {
  const s = String(v ?? "").replace(/\s| /g, "").replace(",", ".");
  const m = s.match(/\d+(\.\d+)?/);
  return m ? Math.round(Number(m[0]) * 100) : 0;
}

const STATUS: Record<string, "new" | "confirmed" | "paid" | "done" | "cancelled"> = { pending: "new", received: "confirmed", paid: "paid", delivered: "done", cancelled: "cancelled" };
const METHOD: Record<string, string> = { nova_poshta: "novaposhta", ukrposhta: "ukrposhta" };

/** A Prom order as stored in ONEKNIGHT. Drafts are not orders yet and are skipped (null). */
export function mapPromOrder(o: any) {
  if (!o || o.status === "draft" || o.id == null) return null;
  const provider = o.delivery_provider_data?.provider as string | undefined;
  const address = String(o.delivery_address ?? "").trim();
  // "Київ, №5 (до 30 кг): вул. ..." -> city + branch number, used to match a Nova Poshta branch.
  const city = address.split(",")[0]?.trim();
  const branch = address.match(/№\s*(\d+)/)?.[1];
  const payName = String(o.payment_option?.name ?? "").trim();
  const items = (Array.isArray(o.products) ? o.products : []).map((p: any) => ({
    productId: `prom:${p.id}`,
    name: String(p.name ?? "").slice(0, 300),
    qty: Math.max(1, Math.round(Number(p.quantity) || 1)),
    priceKop: promKop(p.price),
  }));
  return {
    externalId: String(o.id),
    customerName: [o.client_first_name, o.client_last_name].filter(Boolean).join(" ").trim() || "Prom",
    customerPhone: String(o.phone ?? "").slice(0, 40),
    customerEmail: o.email ? String(o.email).slice(0, 200) : null,
    items,
    totalKop: promKop(o.price),
    status: STATUS[o.status] ?? "new",
    delivery: {
      method: (provider && METHOD[provider]) || String(o.delivery_option?.name ?? "other").slice(0, 100),
      ...(address ? { address: address.slice(0, 300) } : {}),
      ...(provider === "nova_poshta" && city ? { city } : {}),
      ...(provider === "nova_poshta" && branch ? { branch } : {}),
    },
    payment: /наклад|післяплат|при отрим|cash on delivery/i.test(payName) ? "cod" : payName.slice(0, 100) || "other",
    comment: o.client_notes ? String(o.client_notes).slice(0, 2000) : null,
    waybill: o.delivery_provider_data?.declaration_number ? String(o.delivery_provider_data.declaration_number) : null,
    createdAt: o.date_created ? new Date(o.date_created) : new Date(),
  };
}

type PromSettings = { lastSyncAt?: string; lastOrderAt?: string };
const promDate = (d: Date) => d.toISOString().slice(0, 19);
const MAX_PAGES = 10;

/**
 * Pulls new Prom orders into ONEKNIGHT. Orders already imported are left as they are (the seller works with
 * them here). First sync goes 30 days back; later ones overlap by a day and rely on the unique external id.
 */
export async function syncProm(orgId: string, f: PromFetch = promFetch): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.organizationId, orgId), eq(integrations.provider, "prom")));
  if (!row) return { ok: false, error: "not_connected" };
  if (!(await hasModule(orgId, "prom"))) return { ok: false, error: "module_not_active" };
  const { token } = JSON.parse(decrypt(row.credentialsEnc)) as { token: string };
  const settings = row.settings as PromSettings;
  const from = settings.lastOrderAt ? new Date(new Date(settings.lastOrderAt).getTime() - 86_400_000) : new Date(Date.now() - 30 * 86_400_000);

  let imported = 0;
  let newest = settings.lastOrderAt ? new Date(settings.lastOrderAt) : null;
  let lastId: number | null = null;
  const fail = async (error: string) => {
    await db.update(integrations).set({ lastError: error, status: error === "unauthorized" ? "error" : row.status, updatedAt: new Date() }).where(and(eq(integrations.organizationId, orgId), eq(integrations.provider, "prom")));
    return { ok: false as const, error };
  };
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await f(token, `/orders/list?limit=100&date_from=${promDate(from)}${lastId ? `&last_id=${lastId - 1}` : ""}`);
    if (r.status !== 200 || !Array.isArray(r.body?.orders)) return fail(r.status === 401 || r.status === 403 ? "unauthorized" : `http_${r.status}`);
    const list: any[] = r.body.orders;
    for (const src of list) {
      const o = mapPromOrder(src);
      if (!o) continue;
      if (!newest || o.createdAt > newest) newest = o.createdAt;
      const added = await db.transaction(async (tx) => {
        const [ins] = await tx
          .insert(orders)
          .values({ organizationId: orgId, siteId: null, source: "prom", ...o })
          .onConflictDoNothing({ target: [orders.organizationId, orders.source, orders.externalId] })
          .returning({ id: orders.id, number: orders.number });
        if (!ins) return false;
        await tx.insert(orderEvents).values({ orderId: ins.id, status: o.status });
        await tx.insert(notifications).values({ organizationId: orgId, kind: "order", key: "newOrder", params: { n: ins.number, total: o.totalKop / 100 } });
        return true;
      });
      if (added) imported++;
    }
    if (list.length < 100) break;
    lastId = Math.min(...list.map((x) => Number(x.id)));
  }
  await db
    .update(integrations)
    .set({ settings: { ...settings, lastSyncAt: new Date().toISOString(), ...(newest ? { lastOrderAt: newest.toISOString() } : {}) }, status: "connected", lastError: null, updatedAt: new Date() })
    .where(and(eq(integrations.organizationId, orgId), eq(integrations.provider, "prom")));
  return { ok: true, imported };
}

/** Scheduler entry: every connected organization with the Prom module. Errors stay per organization. */
export async function syncAllProm(log: { warn: (o: object, m: string) => void }, f: PromFetch = promFetch) {
  const rows = await db.select({ org: integrations.organizationId }).from(integrations).where(and(eq(integrations.provider, "prom"), sql`${integrations.status} <> 'error'`));
  for (const { org } of rows) {
    const r = await syncProm(org, f).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!r.ok && r.error !== "module_not_active") log.warn({ org, error: r.error }, "prom sync failed");
  }
}
