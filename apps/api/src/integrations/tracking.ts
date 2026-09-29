import { and, eq, gt, inArray, isNotNull, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { integrations, notifications, orderEvents, orders } from "../db/schema.ts";
import { decrypt } from "../security/crypto.ts";
import { setOrderStatus, type OrderStatus } from "../shop/service.ts";
import { npCall, type NpCall } from "./novaposhta.ts";
import { upFetch, type UpCreds, type UpFetch } from "./ukrposhta.ts";

const DAY = 86_400_000;
/** Waiting at the branch this long → «подзвоніть покупцю» on Home and in Telegram. */
export const WAITING_DAYS = 3;
export const UP_TRACKING = "https://www.ukrposhta.ua/status-tracking/0.0.1";

/**
 * What a carrier status means for the order: the group it moves to (from «В роботі» / «Відправлено» only),
 * and whether the parcel is waiting at the branch.
 * Nova Poshta codes (TrackingDocument.getStatusDocuments): 1 created, 2 deleted, 3 not found, 4–6/41/101 on the way,
 * 7/8 at the branch / parcel locker, 9–11 received, 102/103 refused, 105 storage over, 106 returned, 111 not delivered.
 */
export function npMeaning(code: number): { to?: OrderStatus; waiting?: boolean } {
  if ([4, 5, 6, 41, 101, 104, 112].includes(code)) return { to: "shipped" };
  if (code === 7 || code === 8) return { to: "shipped", waiting: true };
  if ([9, 10, 11].includes(code)) return { to: "done" };
  if ([102, 103, 105, 106].includes(code)) return { to: "returned" };
  return {};
}

/**
 * Ukrposhta events (status-tracking 0.0.1, Annex B): 10100 accepted, 20700–21500 on the way, 21700 at the delivery
 * office, 31100/31300/31400/21400 attempts and storage, 31200 returning, 41000 delivered — with eventReason_id 10
 * delivered back to the sender (= 41010), 10600/10602/10603 cancelled before acceptance.
 */
export function upMeaning(event: number, reasonId: number | null): { to?: OrderStatus; waiting?: boolean } {
  if (event === 41000 && reasonId === 10) return { to: "returned" };
  if (event === 41000 || event === 48000) return { to: "done" };
  if (event === 41010 || event === 31200) return { to: "returned" };
  if (event === 21700) return { to: "shipped", waiting: true };
  if ([10100, 20700, 20800, 20900, 21500, 31100, 31300, 31400, 21400].includes(event)) return { to: "shipped" };
  return {};
}

type Seen = { code: string; text: string; to?: OrderStatus; waiting?: boolean };

/** Last statuses of Nova Poshta waybills, 100 per request. */
async function npStatuses(apiKey: string, numbers: string[], call: NpCall) {
  const out = new Map<string, Seen>();
  for (let i = 0; i < numbers.length; i += 100) {
    const r = await call(apiKey, "TrackingDocument", "getStatusDocuments", { Documents: numbers.slice(i, i + 100).map((n) => ({ DocumentNumber: n, Phone: "" })) });
    if (!r.success) continue;
    for (const d of r.data) {
      const code = Number(d.StatusCode);
      if (d.Number && code) out.set(String(d.Number), { code: `np:${code}`, text: String(d.Status ?? ""), ...npMeaning(code) });
    }
  }
  return out;
}

/** Last statuses of Ukrposhta barcodes, 100 per request. */
async function upStatuses(bearer: string, barcodes: string[], f: UpFetch) {
  const out = new Map<string, Seen>();
  for (let i = 0; i < barcodes.length; i += 100) {
    const r = await f(`${UP_TRACKING}/statuses/last`, { method: "POST", bearer, body: barcodes.slice(i, i + 100) });
    if (r.status !== 200 || !Array.isArray(r.body)) continue;
    for (const s of r.body) {
      const event = Number(s.event);
      if (s.barcode && event) out.set(String(s.barcode), { code: `up:${event}${s.eventReason_id ? `:${s.eventReason_id}` : ""}`, text: String(s.eventName ?? ""), ...upMeaning(event, s.eventReason_id ?? null) });
    }
  }
  return out;
}

/**
 * Hourly: parcels of orders «В роботі» / «Відправлено» with a waybill are checked with the carrier; the status
 * follows (Відправлено, Завершено, Повернення — returns put items back in stock), every change is in the order
 * history, a parcel waiting 3+ days and a refusal are reported once.
 */
/** `orgId`: one business only (tests run side by side on the same database). */
export async function trackParcels(deps: { np?: NpCall; up?: UpFetch; skipTestAccounts?: boolean; orgId?: string } = {}, now = new Date()) {
  const rows = await db
    .select({ id: orders.id, org: orders.organizationId, number: orders.number, status: orders.status, waybill: orders.waybill, method: dsql<string>`${orders.delivery}->>'method'`, trackCode: orders.trackCode, arrivedAt: orders.arrivedAt, waitingNotified: orders.waitingNotified })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["confirmed", "shipped"]),
        isNotNull(orders.waybill),
        eq(orders.isExample, false),
        deps.orgId ? eq(orders.organizationId, deps.orgId) : undefined,
        gt(orders.createdAt, new Date(now.getTime() - 60 * DAY)),
        // The running server leaves businesses of automated tests to the tests.
        deps.skipTestAccounts
          ? dsql`not exists (select 1 from memberships m join users u on u.id = m.user_id where m.organization_id = ${orders.organizationId} and u.email like '%@test.oneknight.local')`
          : undefined,
      ),
    );
  const byOrg = new Map<string, typeof rows>();
  for (const r of rows) byOrg.set(r.org, [...(byOrg.get(r.org) ?? []), r]);
  let changed = 0;
  for (const [org, list] of byOrg) {
    const creds = await db.select().from(integrations).where(and(eq(integrations.organizationId, org), inArray(integrations.provider, ["novaposhta", "ukrposhta"])));
    const seen = new Map<string, Seen>();
    const np = creds.find((c) => c.provider === "novaposhta");
    const up = creds.find((c) => c.provider === "ukrposhta");
    const npList = list.filter((o) => o.method === "novaposhta").map((o) => o.waybill!);
    const upList = list.filter((o) => o.method === "ukrposhta").map((o) => o.waybill!);
    if (np && npList.length) for (const [k, v] of await npStatuses((JSON.parse(decrypt(np.credentialsEnc)) as { apiKey: string }).apiKey, npList, deps.np ?? npCall)) seen.set(k, v);
    if (up && upList.length) {
      const c = JSON.parse(decrypt(up.credentialsEnc)) as UpCreds;
      for (const [k, v] of await upStatuses(c.trackingBearer || c.bearer, upList, deps.up ?? upFetch)) seen.set(k, v);
    }
    for (const o of list) {
      const s = seen.get(o.waybill!);
      if (!s || s.code === o.trackCode) continue;
      changed++;
      const arrived = s.waiting && !o.arrivedAt ? { arrivedAt: now } : {};
      await db.update(orders).set({ trackCode: s.code, trackText: s.text, trackAt: now, ...arrived }).where(eq(orders.id, o.id));
      await db.insert(orderEvents).values({ orderId: o.id, kind: "tracking", data: { text: s.text, code: s.code } });
      // Forward only: a parcel on its way never moves an order back.
      const rank: Record<string, number> = { confirmed: 1, shipped: 2, done: 3, returned: 3 };
      if (s.to && rank[s.to]! > rank[o.status]!) {
        await setOrderStatus(o.id, [org], { status: s.to }, null);
        if (s.to === "returned") await db.insert(notifications).values({ organizationId: org, kind: "order", key: "parcelRefused", params: { n: o.number } });
      }
    }
  }
  // Waiting at the branch for 3+ days: reported once.
  const waiting = await db
    .select({ id: orders.id, org: orders.organizationId, number: orders.number })
    .from(orders)
    .where(and(eq(orders.status, "shipped"), eq(orders.waitingNotified, false), deps.orgId ? eq(orders.organizationId, deps.orgId) : undefined, isNotNull(orders.arrivedAt), dsql`${orders.arrivedAt} <= ${new Date(now.getTime() - WAITING_DAYS * DAY).toISOString()}::timestamptz`));
  for (const w of waiting) {
    await db.update(orders).set({ waitingNotified: true }).where(eq(orders.id, w.id));
    await db.insert(notifications).values({ organizationId: w.org, kind: "order", key: "parcelWaiting", params: { n: w.number, days: WAITING_DAYS } });
  }
  return { checked: rows.length, changed, waiting: waiting.length };
}
