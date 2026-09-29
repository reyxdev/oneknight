import { createHash, randomInt, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { moduleById, type ModuleId } from "@oneknight/domain";
import { db } from "../db/client.ts";
import { accessKeys, ledgerEntries, moduleInstalls, notifications, promoCodes, promoRedemptions, subscriptions } from "../db/schema.ts";
import { addMonths, settle } from "./service.ts";

// No 0/O, 1/I/L: keys are typed from a message or a screenshot.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const newKeyCode = () => `OK-${block()}-${block()}-${block()}`;
/** Keys are compared ignoring case, spaces and dashes. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const keyHash = (code: string) => createHash("sha256").update(normalizeCode(code)).digest("hex");

export type KeyBatch = { kind: "oneknight" | "module"; moduleId?: ModuleId; months: number; count: number; activateBefore?: Date; note?: string };

/** Generates a batch and returns the codes. They are not stored in clear and cannot be shown again. */
export async function generateKeys(b: KeyBatch, adminId: string) {
  const batch = randomUUID();
  const codes = Array.from({ length: b.count }, newKeyCode);
  await db.insert(accessKeys).values(
    codes.map((c) => ({ codeHash: keyHash(c), hint: c.slice(-4), batch, kind: b.kind, moduleId: b.kind === "module" ? b.moduleId! : null, months: b.months, activateBefore: b.activateBefore ?? null, note: b.note ?? null, createdBy: adminId })),
  );
  return { batch, codes };
}

type Redeemed =
  | { ok: true; type: "key"; kind: "oneknight" | "module"; moduleId: string | null; months: number; until: string }
  | { ok: true; type: "promo"; kind: "percent" | "bonus"; value: number; months: number }
  | { ok: false; error: "invalid_code" | "expired" | "already_used" | "subscription_required" | "module_not_available" };

const DEAD = ["suspended", "cancelled"];
const later = (...d: (Date | null | undefined)[]) => new Date(Math.max(...d.filter((x): x is Date => !!x).map((x) => x.getTime())));

/**
 * Activates an access key or a promo code for an organization. Keys: ONEKNIGHT or a module is covered for
 * N months (starting after what is already paid). Promo codes: a percent off the next renewals, or a bonus
 * on the balance. Everything happens under row locks, so a code cannot be used twice concurrently.
 */
export async function redeem(orgId: string, raw: string, userId: string, now = new Date()): Promise<Redeemed> {
  const code = normalizeCode(raw);
  if (code.length < 3 || code.length > 40) return { ok: false, error: "invalid_code" };
  const res = await db.transaction(async (tx): Promise<Redeemed> => {
    const [key] = await tx.select().from(accessKeys).where(eq(accessKeys.codeHash, keyHash(code))).for("update");
    if (key) {
      if (key.disabled) return { ok: false, error: "invalid_code" };
      if (key.redeemedAt) return { ok: false, error: "already_used" };
      if (key.activateBefore && key.activateBefore < now) return { ok: false, error: "expired" };
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)).for("update");
      // Coverage starts after the period that is already paid (or free), never in the past.
      const paidTo = sub && (sub.status === "trial" || sub.status === "active") ? sub.periodEnd : now;
      let until: Date;
      if (key.kind === "oneknight") {
        until = addMonths(later(now, paidTo, sub?.coveredUntil), key.months);
        if (!sub) await tx.insert(subscriptions).values({ organizationId: orgId, status: "active", periodEnd: now, coveredUntil: until });
        else await tx.update(subscriptions).set({ coveredUntil: until, updatedAt: now }).where(eq(subscriptions.organizationId, orgId));
      } else {
        const def = moduleById(key.moduleId as ModuleId);
        if (!def?.live) return { ok: false, error: "module_not_available" };
        if (!sub || DEAD.includes(sub.status)) return { ok: false, error: "subscription_required" };
        const [inst] = await tx.select().from(moduleInstalls).where(and(eq(moduleInstalls.organizationId, orgId), eq(moduleInstalls.moduleId, def.id))).for("update");
        until = addMonths(later(now, paidTo, inst?.paidUntil), key.months);
        if (inst) await tx.update(moduleInstalls).set({ paidUntil: until }).where(and(eq(moduleInstalls.organizationId, orgId), eq(moduleInstalls.moduleId, def.id)));
        else await tx.insert(moduleInstalls).values({ organizationId: orgId, moduleId: def.id, free: false, paidUntil: until });
      }
      await tx.update(accessKeys).set({ redeemedBy: orgId, redeemedAt: now }).where(eq(accessKeys.id, key.id));
      await tx.insert(notifications).values({ organizationId: orgId, kind: "billing", key: "keyRedeemed", params: { module: key.moduleId ?? "oneknight", until: until.toISOString() } });
      return { ok: true, type: "key", kind: key.kind, moduleId: key.moduleId, months: key.months, until: until.toISOString() };
    }

    const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code)).for("update");
    if (!promo || !promo.active) return { ok: false, error: "invalid_code" };
    const [before] = await tx.select().from(promoRedemptions).where(and(eq(promoRedemptions.promoId, promo.id), eq(promoRedemptions.organizationId, orgId)));
    if (before) return { ok: false, error: "already_used" };
    if ((promo.validUntil && promo.validUntil < now) || (promo.maxUses !== null && promo.uses >= promo.maxUses)) return { ok: false, error: "expired" };
    const [used] = await tx.insert(promoRedemptions).values({ promoId: promo.id, organizationId: orgId, monthsLeft: promo.kind === "percent" ? promo.months : 0 }).onConflictDoNothing().returning();
    if (!used) return { ok: false, error: "already_used" };
    await tx.update(promoCodes).set({ uses: sql`${promoCodes.uses} + 1` }).where(eq(promoCodes.id, promo.id));
    if (promo.kind === "bonus") await tx.insert(ledgerEntries).values({ organizationId: orgId, kind: "adjustment", amountKop: promo.value * 100, reason: `promo:${promo.code}`, createdBy: userId });
    return { ok: true, type: "promo", kind: promo.kind, value: promo.value, months: promo.months };
  });
  // A subscription waiting in grace or suspension may renew right away now.
  if (res.ok) await settle(orgId, now);
  return res;
}
