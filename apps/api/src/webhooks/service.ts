import { createHmac, randomBytes } from "node:crypto";
import { and, eq, inArray, lt, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { notifications, webhookDeliveries, webhookEndpoints, webhookEvents } from "../db/schema.ts";
import { decrypt, encrypt } from "../security/crypto.ts";
import { publicPost } from "../security/public-fetch.ts";
import { env } from "../config.ts";

/** What a site can subscribe to (the triggers in migration 0047 write them). */
export const WEBHOOK_EVENTS = ["order.created", "order.status_changed", "order.payment_changed", "product.changed", "stock.changed", "category.changed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const MAX_ENDPOINTS = 3;
/** Retries after a failed attempt: 1 min, 5 min, 30 min, 2 h, 12 h — then «не доставлено». */
const RETRY_MIN = [1, 5, 30, 120, 720];
const DISABLE_AFTER = 20;

export type Sender = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;
const defaultSender: Sender = (url, body, headers) => publicPost(url, body, headers, { allowLocal: env.NODE_ENV !== "production" });

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;
export const sealSecret = (s: string) => encrypt(s);

/**
 * The signature the site checks: `x-oneknight-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 * The site rejects a signature older than 5 minutes.
 */
export function sign(secret: string, t: number, body: string) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/**
 * Which businesses a run handles: `orgIds` (tests run side by side on one database) or, for the running server,
 * everyone except automated test accounts (@test.oneknight.local), which the tests handle themselves.
 */
export type Scope = { orgIds?: string[]; skipTestAccounts?: boolean };
const scopeSql = (col: ReturnType<typeof dsql.raw>, o: Scope) =>
  o.orgIds
    ? dsql`${col} in (${dsql.join(o.orgIds.map((x) => dsql`${x}::uuid`), dsql`, `)})`
    : o.skipTestAccounts
      ? dsql`not exists (select 1 from memberships m join users u on u.id = m.user_id where m.organization_id = ${col} and u.email like '%@test.oneknight.local')`
      : dsql`true`;

/** Events → deliveries for every active endpoint of the site that wants them. Events of sites without endpoints are dropped. */
export async function dispatchEvents(opts: Scope = {}, limit = 500) {
  const batch = await db.execute<{ id: string; site_id: string | null; type: string; data: unknown; created_at: Date }>(dsql`
    update ${webhookEvents} set dispatched = true
    where id in (select id from ${webhookEvents} where not dispatched and ${scopeSql(dsql.raw("organization_id"), opts)} order by created_at limit ${limit} for update skip locked)
    returning id, site_id, type, data, created_at`);
  if (!batch.length) return 0;
  const siteIds = [...new Set(batch.map((e) => e.site_id).filter((x): x is string => !!x))];
  const endpoints = siteIds.length ? await db.select().from(webhookEndpoints).where(and(inArray(webhookEndpoints.siteId, siteIds), eq(webhookEndpoints.active, true))) : [];
  const rows = [];
  for (const e of batch)
    for (const ep of endpoints.filter((x) => x.siteId === e.site_id && x.events.includes(e.type)))
      rows.push({ endpointId: ep.id, eventId: e.id, type: e.type, payload: { id: e.id, type: e.type, createdAt: new Date(e.created_at).toISOString(), siteId: e.site_id, data: e.data } });
  if (rows.length) await db.insert(webhookDeliveries).values(rows);
  return rows.length;
}

async function attempt(d: typeof webhookDeliveries.$inferSelect, ep: typeof webhookEndpoints.$inferSelect, send: Sender) {
  const body = JSON.stringify(d.payload);
  const t = Math.floor(Date.now() / 1000);
  try {
    const r = await send(ep.url, body, { "x-oneknight-event": d.type, "x-oneknight-delivery": d.id, "x-oneknight-signature": sign(decrypt(ep.secret), t, body) });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, error: r.status >= 200 && r.status < 300 ? null : `http_${r.status}` };
  } catch (e) {
    return { ok: false, status: null, error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

/** Sends what is due. Each delivery is claimed first (its next attempt moved on), so two workers never send twice. */
export async function deliverDue(send: Sender = defaultSender, now = new Date(), opts: Scope = {}, limit = 100) {
  const claimed = await db.execute<{ id: string }>(dsql`
    update ${webhookDeliveries} set next_attempt_at = ${new Date(now.getTime() + 10 * 60_000).toISOString()}::timestamptz
    where id in (select d.id from ${webhookDeliveries} d join ${webhookEndpoints} e on e.id = d.endpoint_id
      where d.status = 'pending' and d.next_attempt_at <= ${now.toISOString()}::timestamptz and ${scopeSql(dsql.raw("e.organization_id"), opts)}
      order by d.next_attempt_at limit ${limit} for update of d skip locked)
    returning id`);
  let sent = 0;
  for (const { id } of claimed) {
    const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
    const [ep] = d ? await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId)) : [];
    if (!d || !ep) continue;
    if (!ep.active) {
      await db.update(webhookDeliveries).set({ status: "failed", lastError: "endpoint_off" }).where(eq(webhookDeliveries.id, id));
      continue;
    }
    const r = await attempt(d, ep, send);
    const attempts = d.attempts + 1;
    if (r.ok) {
      sent++;
      await db.update(webhookDeliveries).set({ status: "ok", attempts, lastStatus: r.status, lastError: null, deliveredAt: now }).where(eq(webhookDeliveries.id, id));
      if (ep.failures) await db.update(webhookEndpoints).set({ failures: 0 }).where(eq(webhookEndpoints.id, ep.id));
      continue;
    }
    const retry = RETRY_MIN[attempts - 1];
    if (retry !== undefined) {
      await db.update(webhookDeliveries).set({ attempts, lastStatus: r.status, lastError: r.error, nextAttemptAt: new Date(now.getTime() + retry * 60_000) }).where(eq(webhookDeliveries.id, id));
      continue;
    }
    await db.update(webhookDeliveries).set({ status: "failed", attempts, lastStatus: r.status, lastError: r.error }).where(eq(webhookDeliveries.id, id));
    const [e] = await db.update(webhookEndpoints).set({ failures: dsql`${webhookEndpoints.failures} + 1` }).where(eq(webhookEndpoints.id, ep.id)).returning({ failures: webhookEndpoints.failures });
    if ((e?.failures ?? 0) >= DISABLE_AFTER) {
      const [off] = await db.update(webhookEndpoints).set({ active: false, disabledAt: now }).where(and(eq(webhookEndpoints.id, ep.id), eq(webhookEndpoints.active, true))).returning({ id: webhookEndpoints.id });
      if (off) await db.insert(notifications).values({ organizationId: ep.organizationId, kind: "site", key: "webhookOff", params: { url: ep.url } });
    }
  }
  return sent;
}

/** «Надіслати тест»: a signed `ping` right now, with the answer of the site. */
export async function sendTest(ep: typeof webhookEndpoints.$inferSelect, send: Sender = defaultSender) {
  const payload = { id: `test_${randomBytes(6).toString("hex")}`, type: "ping", createdAt: new Date().toISOString(), siteId: ep.siteId, data: {} };
  const body = JSON.stringify(payload);
  try {
    const r = await send(ep.url, body, { "x-oneknight-event": "ping", "x-oneknight-delivery": payload.id, "x-oneknight-signature": sign(decrypt(ep.secret), Math.floor(Date.now() / 1000), body) });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: null, body: String((e as Error).message ?? e).slice(0, 200) };
  }
}

/** Delivered and failed deliveries are kept 30 days, sent-out events 7 days. */
export async function purgeWebhooks(now = new Date()) {
  await db.delete(webhookDeliveries).where(and(inArray(webhookDeliveries.status, ["ok", "failed"]), lt(webhookDeliveries.createdAt, new Date(now.getTime() - 30 * 86_400_000))));
  await db.delete(webhookEvents).where(and(eq(webhookEvents.dispatched, true), lte(webhookEvents.createdAt, new Date(now.getTime() - 7 * 86_400_000))));
}

