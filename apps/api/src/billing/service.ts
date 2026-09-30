import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, lte, or, sql as dsql, sum } from "drizzle-orm";
import { moduleById, oneknightPricing as P, type ModuleId } from "@oneknight/domain";
import { db } from "../db/client.ts";
import { ledgerEntries, moduleInstalls, notifications, orders, organizations, promoCodes, promoRedemptions, sites, subscriptions, topups } from "../db/schema.ts";
import { env } from "../config.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;
const DAY = 86_400_000;
const UAH = 100;

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCMonth(r.getUTCMonth() + n);
  if (r.getUTCDate() < day) r.setUTCDate(0); // 31 Jan + 1 month = 28/29 Feb
  return r;
}

export async function balanceKop(orgId: string, x: Exec = db): Promise<number> {
  const [r] = await x.select({ s: sum(ledgerEntries.amountKop) }).from(ledgerEntries).where(eq(ledgerEntries.organizationId, orgId));
  return Number(r?.s ?? 0);
}

/** Modules charged at a renewal starting at `at`: the ones not covered by an access key at that moment. */
async function paidModules(orgId: string, x: Exec, at: Date) {
  const [r] = await x
    .select({ n: count() })
    .from(moduleInstalls)
    .where(and(eq(moduleInstalls.organizationId, orgId), or(isNull(moduleInstalls.paidUntil), lte(moduleInstalls.paidUntil, at))));
  return r?.n ?? 0;
}

/** The best percent discount still available to the organization (from promo codes). */
async function activeDiscount(orgId: string, x: Exec) {
  const [d] = await x
    .select({ promoId: promoRedemptions.promoId, percent: promoCodes.value, monthsLeft: promoRedemptions.monthsLeft })
    .from(promoRedemptions)
    .innerJoin(promoCodes, eq(promoCodes.id, promoRedemptions.promoId))
    .where(and(eq(promoRedemptions.organizationId, orgId), eq(promoCodes.kind, "percent"), gt(promoRedemptions.monthsLeft, 0)))
    .orderBy(desc(promoCodes.value))
    .limit(1);
  return d ?? null;
}

/**
 * What the renewal starting at `at` costs: ONEKNIGHT (unless covered by a key or a paid year) + every paid module
 * not covered by a key + every website after the first, minus the best promo discount. `parts` is the breakdown
 * shown in «Оплата».
 */
export async function monthlyKop(orgId: string, x: Exec = db, at = new Date()) {
  const [sub] = await x.select({ coveredUntil: subscriptions.coveredUntil }).from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  const base = sub?.coveredUntil && sub.coveredUntil > at ? 0 : P.perMonth;
  const modules = await paidModules(orgId, x, at);
  const [s] = await x.select({ n: count() }).from(sites).where(eq(sites.organizationId, orgId));
  const extraSites = Math.max(0, (s?.n ?? 0) - 1);
  const parts = { baseKop: base * UAH, modules, modulesKop: modules * P.modulePerMonth * UAH, extraSites, sitesKop: extraSites * P.extraSitePerMonth * UAH };
  const full = parts.baseKop + parts.modulesKop + parts.sitesKop;
  const discount = full > 0 ? await activeDiscount(orgId, x) : null;
  return { total: discount ? Math.round((full * (100 - discount.percent)) / 100) : full, full, discount, parts };
}

/** A year of ONEKNIGHT paid ahead: 12 months for the price of 10. Promo codes do not apply to it. */
export const YEAR_KOP = P.perMonth * (12 - P.yearGiftMonths) * UAH;

/**
 * «Почати підписку»: without a website from us there is no free period — the first month is paid from the balance
 * right away. A lapsed subscription (grace, suspended) is renewed the same way.
 */
export async function startSubscription(orgId: string, now = new Date()): Promise<{ ok: true; until: Date } | { ok: false; error: "already_active" | "insufficient_funds"; needKop?: number }> {
  const [cur] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  if (cur && (cur.status === "active" || cur.status === "trial")) return { ok: false, error: "already_active" };
  if (cur && (cur.status === "grace" || cur.status === "suspended")) {
    const r = await settle(orgId, now);
    if (r === "renewed") return { ok: true, until: (await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)))[0]!.periodEnd };
    const { total } = await monthlyKop(orgId, db, now);
    return { ok: false, error: "insufficient_funds", needKop: Math.max(0, total - (await balanceKop(orgId))) };
  }
  return db.transaction(async (tx) => {
    const { total, discount } = await monthlyKop(orgId, tx, now);
    const bal = await balanceKop(orgId, tx);
    if (bal < total) return { ok: false as const, error: "insufficient_funds" as const, needKop: total - bal };
    const periodEnd = addMonths(now, 1);
    if (total > 0) await tx.insert(ledgerEntries).values({ organizationId: orgId, kind: "charge", amountKop: -total, reason: "renewal", meta: { from: now.toISOString(), to: periodEnd.toISOString(), ...(discount ? { discountPercent: discount.percent } : {}) } });
    if (discount) await tx.update(promoRedemptions).set({ monthsLeft: discount.monthsLeft - 1 }).where(and(eq(promoRedemptions.promoId, discount.promoId), eq(promoRedemptions.organizationId, orgId)));
    await tx
      .insert(subscriptions)
      .values({ organizationId: orgId, status: "active", periodEnd })
      .onConflictDoUpdate({ target: subscriptions.organizationId, set: { status: "active", periodEnd, graceUntil: null, suspendedAt: null, deletionWarned: null, updatedAt: now } });
    await note(tx, orgId, "subscriptionStarted", { amount: total / UAH, until: periodEnd.toISOString() });
    return { ok: true as const, until: periodEnd };
  });
}

/**
 * «Оплатити рік»: ONEKNIGHT is covered for 12 months after what is already paid (or free); renewals in that time
 * charge only modules and extra websites.
 */
export async function payYear(orgId: string, now = new Date()): Promise<{ ok: true; until: Date } | { ok: false; error: "insufficient_funds"; needKop: number }> {
  return db.transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)).for("update");
    const bal = await balanceKop(orgId, tx);
    if (bal < YEAR_KOP) return { ok: false as const, error: "insufficient_funds" as const, needKop: YEAR_KOP - bal };
    const paidTo = sub && (sub.status === "trial" || sub.status === "active") && sub.periodEnd > now ? sub.periodEnd : now;
    const from = sub?.coveredUntil && sub.coveredUntil > paidTo ? sub.coveredUntil : paidTo;
    const until = addMonths(from, 12);
    await tx.insert(ledgerEntries).values({ organizationId: orgId, kind: "charge", amountKop: -YEAR_KOP, reason: "year", meta: { from: from.toISOString(), to: until.toISOString() } });
    if (!sub) await tx.insert(subscriptions).values({ organizationId: orgId, status: "active", periodEnd: now, coveredUntil: until });
    else
      await tx
        .update(subscriptions)
        .set({ coveredUntil: until, ...(sub.status === "grace" || sub.status === "suspended" || sub.status === "cancelled" ? { status: "active" as const, periodEnd: now, graceUntil: null, suspendedAt: null, deletionWarned: null } : {}), updatedAt: now })
        .where(eq(subscriptions.organizationId, orgId));
    await note(tx, orgId, "yearPaid", { amount: YEAR_KOP / UAH, until: until.toISOString() });
    return { ok: true as const, until };
  });
}

/** After this many days of suspension the admin may delete the business data. */
export const DELETE_AFTER_DAYS = 90;

/** Warnings before the data of a suspended business may be deleted: 30, 7 and 1 day before, each once. */
async function warnDeletion(now: Date) {
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.status, "suspended"));
  for (const s of subs) {
    if (!s.suspendedAt) continue;
    const left = DELETE_AFTER_DAYS - (now.getTime() - s.suspendedAt.getTime()) / DAY;
    const step = [1, 7, 30].find((d) => left <= d);
    if (step === undefined || left <= 0 || (s.deletionWarned !== null && s.deletionWarned <= step)) continue;
    await db.update(subscriptions).set({ deletionWarned: step }).where(eq(subscriptions.organizationId, s.organizationId));
    await note(db, s.organizationId, "dataDeletionSoon", { days: Math.max(1, Math.ceil(left)) });
  }
}

/**
 * «Лише перегляд»: nothing can be changed in a business whose subscription is suspended or cancelled, or that
 * went through the questions after sign-up without any subscription (its phone already had the free trial), or
 * whose data was deleted. The website keeps working: the public API is not affected.
 */
export async function isReadOnly(orgId: string) {
  const [o] = await db
    .select({ status: subscriptions.status, onboarding: organizations.onboarding, purgedAt: organizations.purgedAt })
    .from(organizations)
    .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
    .where(eq(organizations.id, orgId));
  if (!o) return false;
  if (o.purgedAt) return true;
  if (o.status === "suspended" || o.status === "cancelled") return true;
  return !o.status && !!o.onboarding;
}

/**
 * Reminders: the renewal is in 3 days and the balance does not cover it; a paid year ends in 14 days. Each once.
 */
async function remindRenewals(now: Date) {
  const subs = await db.select().from(subscriptions).where(inArray(subscriptions.status, ["active", "trial"]));
  for (const s of subs) {
    const left = s.periodEnd.getTime() - now.getTime();
    if (left > 0 && left <= 3 * DAY && s.renewRemindedFor?.getTime() !== s.periodEnd.getTime()) {
      const { total } = await monthlyKop(s.organizationId, db, s.periodEnd);
      const bal = await balanceKop(s.organizationId);
      if (total > bal) {
        await db.update(subscriptions).set({ renewRemindedFor: s.periodEnd }).where(eq(subscriptions.organizationId, s.organizationId));
        await note(db, s.organizationId, "renewSoon", { amount: (total - bal) / UAH, until: s.periodEnd.toISOString() });
      }
    }
    if (s.coveredUntil) {
      const yl = s.coveredUntil.getTime() - now.getTime();
      const [year] = await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.organizationId, s.organizationId), eq(ledgerEntries.reason, "year"))).limit(1);
      if (year && yl > 0 && yl <= 14 * DAY && s.yearRemindedFor?.getTime() !== s.coveredUntil.getTime()) {
        await db.update(subscriptions).set({ yearRemindedFor: s.coveredUntil }).where(eq(subscriptions.organizationId, s.organizationId));
        await note(db, s.organizationId, "yearEnding", { until: s.coveredUntil.toISOString() });
      }
    }
  }
}

async function note(x: Exec, orgId: string, key: string, params: Record<string, string | number> = {}) {
  await x.insert(notifications).values({ organizationId: orgId, kind: "billing", key, params });
}

/** Website customers get 3 months of ONEKNIGHT free (plus up to 5 paid modules free during that time). */
export async function startTrial(orgId: string, now = new Date()) {
  const trialEndsAt = addMonths(now, P.freeMonths);
  await db
    .insert(subscriptions)
    .values({ organizationId: orgId, status: "trial", trialEndsAt, periodEnd: trialEndsAt })
    .onConflictDoUpdate({ target: subscriptions.organizationId, set: { status: "trial", trialEndsAt, periodEnd: trialEndsAt, graceUntil: null, updatedAt: now } });
  await note(db, orgId, "trialStarted", { until: trialEndsAt.toISOString() });
  return trialEndsAt;
}

/** One free trial per phone number: another business of the same person (or the same phone) already had one. */
export async function trialUsedByPhone(orgId: string, phone: string) {
  const [used] = await db.execute<{ n: number }>(dsql`
    select count(*)::int as n from subscriptions s
    join memberships m on m.organization_id = s.organization_id and m.role = 'owner'
    join users u on u.id = m.user_id
    where s.trial_ends_at is not null and s.organization_id <> ${orgId}
      and ok_phone_key(u.phone) = ok_phone_key(${phone})`);
  return (used?.n ?? 0) > 0;
}

/** «Почати пробний період»: 30 days of ONEKNIGHT (up to 5 paid modules free) for a business that never had a subscription. */
export const SELF_TRIAL_DAYS = 30;
export async function startSelfTrial(orgId: string, now = new Date()) {
  const trialEndsAt = new Date(now.getTime() + SELF_TRIAL_DAYS * DAY);
  const [row] = await db.insert(subscriptions).values({ organizationId: orgId, status: "trial", trialEndsAt, periodEnd: trialEndsAt }).onConflictDoNothing().returning();
  if (!row) return null;
  await note(db, orgId, "trialStartedDays", { days: SELF_TRIAL_DAYS, until: trialEndsAt.toISOString() });
  return trialEndsAt;
}

/** Trial ends soon: a reminder 3 days before and 1 day before, each once. */
async function remindTrials(now: Date) {
  const trials = await db.select().from(subscriptions).where(eq(subscriptions.status, "trial"));
  for (const t of trials) {
    const left = (t.periodEnd.getTime() - now.getTime()) / DAY;
    const step = left <= 0 ? null : left <= 1 ? 1 : left <= 3 ? 3 : null;
    if (step === null || (t.trialReminded !== null && t.trialReminded <= step)) continue;
    await db.update(subscriptions).set({ trialReminded: step }).where(eq(subscriptions.organizationId, t.organizationId));
    await note(db, t.organizationId, "trialEnding", { days: Math.ceil(left), until: t.periodEnd.toISOString() });
  }
}

/**
 * Renewal at the end of a period. Paid from the balance when it covers the month; otherwise the
 * service keeps working for GRACE_DAYS, then it is suspended. Row lock prevents double charging.
 */
export async function settle(orgId: string, now = new Date()): Promise<"renewed" | "grace" | "suspended" | "noop"> {
  return db.transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)).for("update");
    if (!sub || sub.status === "cancelled") return "noop";
    const due = sub.status === "grace" || sub.status === "suspended" || sub.periodEnd <= now;
    if (!due) return "noop";

    const start = sub.periodEnd > now ? sub.periodEnd : now;
    const { total, discount } = await monthlyKop(orgId, tx, start);
    const bal = await balanceKop(orgId, tx);
    if (bal >= total) {
      const periodEnd = addMonths(start, 1);
      if (total > 0) await tx.insert(ledgerEntries).values({ organizationId: orgId, kind: "charge", amountKop: -total, reason: "renewal", meta: { from: start.toISOString(), to: periodEnd.toISOString(), ...(discount ? { discountPercent: discount.percent } : {}) } });
      if (discount) await tx.update(promoRedemptions).set({ monthsLeft: discount.monthsLeft - 1 }).where(and(eq(promoRedemptions.promoId, discount.promoId), eq(promoRedemptions.organizationId, orgId)));
      // After the free period every installed module is paid.
      await tx.update(moduleInstalls).set({ free: false }).where(eq(moduleInstalls.organizationId, orgId));
      await tx.update(subscriptions).set({ status: "active", periodEnd, graceUntil: null, suspendedAt: null, deletionWarned: null, updatedAt: now }).where(eq(subscriptions.organizationId, orgId));
      await note(tx, orgId, "renewed", { amount: total / UAH, until: periodEnd.toISOString() });
      return "renewed";
    }
    if (sub.status === "trial" || sub.status === "active") {
      const graceUntil = new Date(sub.periodEnd.getTime() + env.GRACE_DAYS * DAY);
      await tx.update(subscriptions).set({ status: "grace", graceUntil, updatedAt: now }).where(eq(subscriptions.organizationId, orgId));
      await note(tx, orgId, "lowBalance", { days: env.GRACE_DAYS, amount: (total - bal) / UAH, until: graceUntil.toISOString() });
      return "grace";
    }
    if (sub.status === "grace" && sub.graceUntil && sub.graceUntil <= now) {
      await tx.update(subscriptions).set({ status: "suspended", suspendedAt: now, deletionWarned: null, updatedAt: now }).where(eq(subscriptions.organizationId, orgId));
      await note(tx, orgId, "suspended", { amount: (total - bal) / UAH });
      return "suspended";
    }
    return "noop";
  });
}

/** Hourly: every subscription that reached its period end or waits in grace/suspension. */
export async function runBilling(now = new Date()) {
  await remindTrials(now);
  await remindRenewals(now);
  await warnDeletion(now);
  const due = await db
    .select({ org: subscriptions.organizationId })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["trial", "active", "grace"]));
  const results: string[] = [];
  for (const { org } of due) {
    const r = await settle(org, now);
    results.push(r);
    // The first real payment of an invited business: a month for both (imported here: referrals.ts uses this file).
    if (r === "renewed") await (await import("./referrals.ts")).rewardReferral(org, now);
  }
  return results;
}

export const paymentsConfigured = () => !!(env.PAYMENT_IBAN && env.PAYMENT_RECIPIENT);
export const requisites = () => (paymentsConfigured() ? { recipient: env.PAYMENT_RECIPIENT!, iban: env.PAYMENT_IBAN!, taxId: env.PAYMENT_TAX_ID ?? null } : null);

/** The client announces a transfer. It becomes balance only when an admin confirms the money arrived. */
export async function createTopup(orgId: string, userId: string, amountUah: number) {
  const reference = `OK-${randomBytes(4).toString("hex").toUpperCase()}`;
  const [t] = await db.insert(topups).values({ organizationId: orgId, amountKop: amountUah * UAH, reference, createdBy: userId }).returning();
  return t!;
}

export async function confirmTopup(id: string, adminId: string): Promise<"confirmed" | "not_found" | "not_pending"> {
  const res = await db.transaction(async (tx) => {
    const [t] = await tx.select().from(topups).where(eq(topups.id, id)).for("update");
    if (!t) return { r: "not_found" as const };
    if (t.status !== "pending") return { r: "not_pending" as const };
    await tx.update(topups).set({ status: "confirmed", confirmedBy: adminId, confirmedAt: new Date() }).where(eq(topups.id, id));
    await tx.insert(ledgerEntries).values({ organizationId: t.organizationId, kind: "topup", amountKop: t.amountKop, reason: `topup:${t.reference}`, createdBy: adminId });
    await note(tx, t.organizationId, "topupConfirmed", { amount: t.amountKop / UAH });
    return { r: "confirmed" as const, org: t.organizationId };
  });
  // Money arrived: a subscription waiting in grace or suspension renews right away.
  if (res.r === "confirmed") await settle(res.org);
  return res.r;
}

/**
 * Installs a module. Free inside the trial while fewer than 5 free modules are used; otherwise the
 * current month is charged now and the module renews with the subscription. Only live modules install.
 */
export async function installModule(orgId: string, moduleId: ModuleId): Promise<{ ok: true; free: boolean } | { ok: false; error: string }> {
  const def = moduleById(moduleId);
  if (!def) return { ok: false, error: "not_found" };
  if (!def.live) return { ok: false, error: "module_not_available" };
  return db.transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)).for("update");
    if (!sub || !["trial", "active", "grace"].includes(sub.status)) return { ok: false as const, error: "subscription_required" };
    const [exists] = await tx.select().from(moduleInstalls).where(and(eq(moduleInstalls.organizationId, orgId), eq(moduleInstalls.moduleId, moduleId)));
    if (exists) return { ok: true as const, free: exists.free };
    const [freeUsed] = await tx.select({ n: count() }).from(moduleInstalls).where(and(eq(moduleInstalls.organizationId, orgId), eq(moduleInstalls.free, true)));
    const free = sub.status === "trial" && (freeUsed?.n ?? 0) < P.freeModules;
    if (!free) {
      const price = def.price * UAH;
      if ((await balanceKop(orgId, tx)) < price) return { ok: false as const, error: "insufficient_balance" };
      await tx.insert(ledgerEntries).values({ organizationId: orgId, kind: "charge", amountKop: -price, reason: `module:${moduleId}` });
    }
    await tx.insert(moduleInstalls).values({ organizationId: orgId, moduleId, free });
    return { ok: true as const, free };
  });
}

export async function billingOverview(orgId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  const mods = await db.select().from(moduleInstalls).where(eq(moduleInstalls.organizationId, orgId));
  const ledger = await db.select({ id: ledgerEntries.id, kind: ledgerEntries.kind, amountKop: ledgerEntries.amountKop, reason: ledgerEntries.reason, at: ledgerEntries.createdAt }).from(ledgerEntries).where(eq(ledgerEntries.organizationId, orgId)).orderBy(desc(ledgerEntries.createdAt)).limit(20);
  const tops = await db.select({ id: topups.id, amountKop: topups.amountKop, reference: topups.reference, status: topups.status, at: topups.createdAt }).from(topups).where(eq(topups.organizationId, orgId)).orderBy(desc(topups.createdAt)).limit(10);
  return {
    subscription: sub ? { status: sub.status, trialEndsAt: sub.trialEndsAt, periodEnd: sub.periodEnd, graceUntil: sub.graceUntil } : null,
    balanceKop: await balanceKop(orgId),
    ...(await (async () => {
      // The next renewal: its price with key coverage and discounts applied.
      const m = await monthlyKop(orgId, db, sub && sub.periodEnd > new Date() ? sub.periodEnd : new Date());
      return { monthlyKop: m.total, monthlyFullKop: m.full, parts: m.parts, discount: m.discount ? { percent: m.discount.percent, monthsLeft: m.discount.monthsLeft } : null };
    })()),
    coveredUntil: sub?.coveredUntil ?? null,
    modules: mods.map((m) => ({ id: m.moduleId, free: m.free, paidUntil: m.paidUntil, installedAt: m.installedAt })),
    freeModulesLeft: sub?.status === "trial" ? Math.max(0, P.freeModules - mods.filter((m) => m.free).length) : 0,
    paymentsConfigured: paymentsConfigured(),
    yearKop: YEAR_KOP,
    // «Через ONEKNIGHT пройшло N замовлень на X грн»: what the panel did for the business.
    value: await (async () => {
      const [v] = await db
        .select({ n: count(), kop: sum(orders.totalKop) })
        .from(orders)
        .where(and(eq(orders.organizationId, orgId), eq(orders.isExample, false), inArray(orders.status, ["new", "confirmed", "shipped", "done"])));
      return { orders: v?.n ?? 0, kop: Number(v?.kop ?? 0) };
    })(),
    ledger,
    topups: tops,
  };
}

/** A module works for an organization when it is installed and the subscription is not suspended. */
export async function hasModule(orgId: string, moduleId: ModuleId): Promise<boolean> {
  const [row] = await db
    .select({ status: subscriptions.status })
    .from(moduleInstalls)
    .innerJoin(subscriptions, eq(subscriptions.organizationId, moduleInstalls.organizationId))
    .where(and(eq(moduleInstalls.organizationId, orgId), eq(moduleInstalls.moduleId, moduleId)))
    .limit(1);
  return !!row && ["trial", "active", "grace"].includes(row.status);
}
