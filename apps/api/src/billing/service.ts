import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, sum } from "drizzle-orm";
import { moduleById, oneknightPricing as P, type ModuleId } from "@oneknight/domain";
import { db } from "../db/client.ts";
import { ledgerEntries, moduleInstalls, notifications, subscriptions, topups } from "../db/schema.ts";
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

async function paidModules(orgId: string, x: Exec) {
  const [r] = await x.select({ n: count() }).from(moduleInstalls).where(eq(moduleInstalls.organizationId, orgId));
  return r?.n ?? 0;
}

/** What one month costs after the free period: ONEKNIGHT + every installed paid module. */
export async function monthlyKop(orgId: string, x: Exec = db): Promise<number> {
  return (P.perMonth + (await paidModules(orgId, x)) * P.modulePerMonth) * UAH;
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

    const total = await monthlyKop(orgId, tx);
    const bal = await balanceKop(orgId, tx);
    if (bal >= total) {
      const start = sub.periodEnd > now ? sub.periodEnd : now;
      const periodEnd = addMonths(start, 1);
      await tx.insert(ledgerEntries).values({ organizationId: orgId, kind: "charge", amountKop: -total, reason: "renewal", meta: { from: start.toISOString(), to: periodEnd.toISOString() } });
      // After the free period every installed module is paid.
      await tx.update(moduleInstalls).set({ free: false }).where(eq(moduleInstalls.organizationId, orgId));
      await tx.update(subscriptions).set({ status: "active", periodEnd, graceUntil: null, updatedAt: now }).where(eq(subscriptions.organizationId, orgId));
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
      await tx.update(subscriptions).set({ status: "suspended", updatedAt: now }).where(eq(subscriptions.organizationId, orgId));
      await note(tx, orgId, "suspended", { amount: (total - bal) / UAH });
      return "suspended";
    }
    return "noop";
  });
}

/** Hourly: every subscription that reached its period end or waits in grace/suspension. */
export async function runBilling(now = new Date()) {
  const due = await db
    .select({ org: subscriptions.organizationId })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["trial", "active", "grace"]));
  const results: string[] = [];
  for (const { org } of due) results.push(await settle(org, now));
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
    monthlyKop: await monthlyKop(orgId),
    modules: mods.map((m) => ({ id: m.moduleId, free: m.free, installedAt: m.installedAt })),
    freeModulesLeft: sub?.status === "trial" ? Math.max(0, P.freeModules - mods.filter((m) => m.free).length) : 0,
    paymentsConfigured: paymentsConfigured(),
    ledger,
    topups: tops,
  };
}
