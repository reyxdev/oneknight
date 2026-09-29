import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { integrations } from "../db/schema.ts";
import { hasModule } from "../billing/service.ts";
import { decrypt } from "../security/crypto.ts";
import { insertMarketOrder, kyivTime, type MarketOrder } from "./import.ts";

/** Rozetka Seller API (https://api-seller.rozetka.com.ua/apidoc): login with the seller's cabinet credentials. */
export type RozetkaFetch = (path: string, init: { method?: string; token?: string; body?: unknown }) => Promise<{ status: number; body: any }>;

const BASE = "https://api-seller.rozetka.com.ua";
export const rozetkaFetch: RozetkaFetch = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "content-language": "uk", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

export type RozetkaCreds = { username: string; password: string };

/** POST /sites; the password is sent base64-encoded, as the API requires. */
export async function rozetkaLogin(c: RozetkaCreds, f: RozetkaFetch = rozetkaFetch): Promise<{ ok: true; token: string; market: string | null } | { ok: false; error: string }> {
  const r = await f("/sites", { method: "POST", body: { username: c.username, password: Buffer.from(c.password, "utf8").toString("base64") } });
  const token = r.body?.success ? r.body.content?.access_token : null;
  if (token) return { ok: true, token: String(token), market: r.body.content?.market?.title ? String(r.body.content.market.title) : null };
  return { ok: false, error: String(r.body?.errors?.message ?? `http_${r.status}`) };
}

const kop = (v: unknown) => Math.round((Number(String(v ?? "0").replace(",", ".")) || 0) * 100);

/** A Rozetka order as stored in ONEKNIGHT (fields as in the /orders/search example, expand=delivery,purchases,user). */
export function mapRozetkaOrder(o: any): MarketOrder | null {
  if (!o || o.id == null) return null;
  const d = o.delivery ?? {};
  const np = d.name_logo === "nova-pochta" || /нова|новая/i.test(String(d.delivery_service_name ?? ""));
  const city = d.city ? String(d.city.name_ua || d.city.name || "").trim() : "";
  const address = [city, d.place_street, d.place_house].filter(Boolean).join(", ");
  // status_group: 1 in progress, 2 finished successfully, 3 finished unsuccessfully (same groups as the "type" filter).
  const status = o.status_group === 2 ? "done" : o.status_group === 3 ? "cancelled" : "new";
  return {
    externalId: String(o.id),
    customerName: String(o.user?.contact_fio || d.recipient_title || "Rozetka").slice(0, 200),
    customerPhone: String(o.user_phone ?? "").slice(0, 40),
    customerEmail: null,
    items: (Array.isArray(o.purchases) ? o.purchases : []).map((p: any) => ({ productId: `rozetka:${p.item_id}`, name: String(p.item_name ?? p.item?.name ?? "").slice(0, 300), qty: Math.max(1, Number(p.quantity) || 1), priceKop: kop(p.price_with_discount ?? p.price) })),
    totalKop: kop(o.amount_with_discount ?? o.amount),
    status,
    delivery: {
      method: np ? "novaposhta" : String(d.delivery_service_name ?? "other").slice(0, 100),
      ...(address ? { address: address.slice(0, 300) } : {}),
      ...(np && city ? { city } : {}),
      ...(np && d.place_number ? { branch: String(d.place_number) } : {}),
    },
    payment: o.payment_type === "cash" ? "cod" : String(o.payment_type_name ?? o.payment_type ?? "other").slice(0, 100),
    comment: o.comment ? String(o.comment).slice(0, 2000) : null,
    waybill: o.ttn ? String(o.ttn) : null,
    createdAt: o.created ? kyivTime(String(o.created)) : new Date(),
  };
}

// Access tokens are reused while they work; a 401 logs in again.
const tokens = new Map<string, string>();
export const forgetRozetkaToken = (orgId: string) => tokens.delete(orgId);
type Settings = { lastSyncAt?: string; lastOrderAt?: string; market?: string | null };
const MAX_PAGES = 10;

export async function syncRozetka(orgId: string, f: RozetkaFetch = rozetkaFetch): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.organizationId, orgId), eq(integrations.provider, "rozetka")));
  if (!row) return { ok: false, error: "not_connected" };
  if (!(await hasModule(orgId, "rozetka"))) return { ok: false, error: "module_not_active" };
  const creds = JSON.parse(decrypt(row.credentialsEnc)) as RozetkaCreds;
  const settings = row.settings as Settings;
  const where = and(eq(integrations.organizationId, orgId), eq(integrations.provider, "rozetka"));
  const fail = async (error: string) => {
    await db.update(integrations).set({ lastError: error, status: error === "incorrect_username_password" ? "error" : row.status, updatedAt: new Date() }).where(where);
    return { ok: false as const, error };
  };

  const get = async (path: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let token = tokens.get(orgId);
      if (!token) {
        const l = await rozetkaLogin(creds, f);
        if (!l.ok) return { error: l.error };
        token = l.token;
        tokens.set(orgId, token);
      }
      const r = await f(path, { token });
      if (r.status === 401) {
        tokens.delete(orgId);
        continue;
      }
      return r.status === 200 && r.body?.success ? { body: r.body.content } : { error: String(r.body?.errors?.message ?? `http_${r.status}`) };
    }
    return { error: "unauthorized" };
  };

  // First sync: 30 days back; later ones from the day before the newest imported order (the date filter is by day).
  const from = settings.lastOrderAt ? new Date(new Date(settings.lastOrderAt).getTime() - 86_400_000) : new Date(Date.now() - 30 * 86_400_000);
  const day = from.toISOString().slice(0, 10);
  let imported = 0;
  let newest = settings.lastOrderAt ? new Date(settings.lastOrderAt) : null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await get(`/orders/search?created_from=${day}&expand=delivery,purchases,user&sort=id&page=${page}`);
    if ("error" in r) return fail(r.error!);
    const list: any[] = Array.isArray(r.body?.orders) ? r.body.orders : [];
    for (const src of list) {
      const o = mapRozetkaOrder(src);
      if (!o) continue;
      if (!newest || o.createdAt > newest) newest = o.createdAt;
      if (await insertMarketOrder(orgId, "rozetka", o)) imported++;
    }
    if (page >= Number(r.body?._meta?.pageCount ?? 1)) break;
  }
  await db
    .update(integrations)
    .set({ settings: { ...settings, lastSyncAt: new Date().toISOString(), ...(newest ? { lastOrderAt: newest.toISOString() } : {}) }, status: "connected", lastError: null, updatedAt: new Date() })
    .where(where);
  return { ok: true, imported };
}

export async function syncAllRozetka(log: { warn: (o: object, m: string) => void }, f: RozetkaFetch = rozetkaFetch) {
  const rows = await db.select({ org: integrations.organizationId }).from(integrations).where(and(eq(integrations.provider, "rozetka"), sql`${integrations.status} <> 'error'`));
  for (const { org } of rows) {
    const r = await syncRozetka(org, f).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!r.ok && r.error !== "module_not_active") log.warn({ org, error: r.error }, "rozetka sync failed");
  }
}
