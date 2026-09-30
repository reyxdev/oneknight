import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { integrations, reviews, sites } from "../db/schema.ts";
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

/** A GET to the Seller API with the business's token (logged in again once when it expired). */
export async function rozetkaGet(orgId: string, creds: RozetkaCreds, path: string, f: RozetkaFetch = rozetkaFetch): Promise<{ body: any } | { error: string }> {
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
}

/** Rozetka's store rating → stars (owner's decision): like 5, middle 3, dislike 1. */
export const ROZETKA_STARS: Record<string, number> = { like: 5, middle: 3, dislike: 1 };

/**
 * Reviews about the store on Rozetka → «Відгуки» of the business (its first website), each once, to moderation like
 * every review. The text joins the general comment and the comments on choice, service and delivery; the store's
 * reply on Rozetka comes as the reply.
 */
export async function importRozetkaReviews(orgId: string, creds: RozetkaCreds, f: RozetkaFetch = rozetkaFetch) {
  const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.organizationId, orgId)).orderBy(asc(sites.createdAt)).limit(1);
  if (!site) return { imported: 0, error: "no_site" };
  let imported = 0;
  for (let page = 1; page <= 3; page++) {
    const r = await rozetkaGet(orgId, creds, `/market-reviews/search?status_review=active&sort=desc&page=${page}`, f);
    if ("error" in r) return { imported, error: r.error };
    const list: any[] = Array.isArray(r.body?.marketReviews) ? r.body.marketReviews : [];
    for (const x of list) {
      const rating = ROZETKA_STARS[String(x.vote)];
      if (!rating || !x.id) continue;
      const text = [x.comment, x.review_convenience, x.review_manager, x.review_delivery].filter((t) => typeof t === "string" && t.trim()).map((t: string) => t.trim()).join("\n");
      const name = String(x.user ?? "").replace(/^[#*\s]+/, "").trim().slice(0, 100) || "Покупець Rozetka";
      const replyText = typeof x.reply?.comment === "string" && x.reply.comment.trim() ? x.reply.comment.trim() : null;
      const [row] = await db
        .insert(reviews)
        .values({
          organizationId: orgId,
          siteId: site.id,
          authorName: name,
          rating,
          text: text.slice(0, 5000),
          consent: true,
          status: "pending",
          source: "rozetka",
          externalId: String(x.id),
          reply: replyText,
          replyAt: replyText ? kyivTime(String(x.reply.created_at ?? x.created_at)) : null,
          createdAt: x.created_at ? kyivTime(String(x.created_at)) : new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: reviews.id });
      if (row) imported++;
    }
    if (page >= Number(r.body?._meta?.pageCount ?? 1)) break;
  }
  return { imported };
}

export async function syncRozetka(orgId: string, f: RozetkaFetch = rozetkaFetch): Promise<{ ok: true; imported: number; reviewsImported?: number } | { ok: false; error: string }> {
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

  const get = (path: string) => rozetkaGet(orgId, creds, path, f);

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
  // Reviews about the store, when the business uses «Відгуки».
  const reviewsImported = (await hasModule(orgId, "reviews")) ? (await importRozetkaReviews(orgId, creds, f)).imported : undefined;
  await db
    .update(integrations)
    .set({ settings: { ...settings, lastSyncAt: new Date().toISOString(), ...(newest ? { lastOrderAt: newest.toISOString() } : {}) }, status: "connected", lastError: null, updatedAt: new Date() })
    .where(where);
  return { ok: true, imported, ...(reviewsImported !== undefined ? { reviewsImported } : {}) };
}

export async function syncAllRozetka(log: { warn: (o: object, m: string) => void }, f: RozetkaFetch = rozetkaFetch) {
  const rows = await db.select({ org: integrations.organizationId }).from(integrations).where(and(eq(integrations.provider, "rozetka"), sql`${integrations.status} <> 'error'`));
  for (const { org } of rows) {
    const r = await syncRozetka(org, f).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!r.ok && r.error !== "module_not_active") log.warn({ org, error: r.error }, "rozetka sync failed");
  }
}
