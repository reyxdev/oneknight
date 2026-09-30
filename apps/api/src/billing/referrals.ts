import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { ledgerEntries, memberships, notifications, subscriptions, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { addMonths } from "./service.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The person's referral code, made once (8 characters without look-alikes). */
export async function refCodeOf(userId: string) {
  const [u] = await db.select({ code: users.refCode }).from(users).where(eq(users.id, userId));
  if (u?.code) return u.code;
  for (;;) {
    const code = [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    const [row] = await db.update(users).set({ refCode: code }).where(and(eq(users.id, userId), isNull(users.refCode))).returning({ code: users.refCode }).catch(() => [] as { code: string | null }[]);
    if (row?.code) return row.code;
    const [again] = await db.select({ code: users.refCode }).from(users).where(eq(users.id, userId));
    if (again?.code) return again.code;
  }
}

export async function referrerOf(code: string | undefined) {
  if (!code || !/^[A-Z0-9]{8}$/.test(code)) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.refCode, code));
  return u?.id ?? null;
}

/** One free month of ONEKNIGHT: added after what is already paid, free or covered. */
async function grantMonth(orgId: string, now: Date) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  const paidTo = sub && (sub.status === "trial" || sub.status === "active") && sub.periodEnd > now ? sub.periodEnd : now;
  const from = sub?.coveredUntil && sub.coveredUntil > paidTo ? sub.coveredUntil : paidTo;
  const until = addMonths(from, 1);
  if (!sub) await db.insert(subscriptions).values({ organizationId: orgId, status: "active", periodEnd: now, coveredUntil: until });
  else await db.update(subscriptions).set({ coveredUntil: until, updatedAt: now }).where(eq(subscriptions.organizationId, orgId));
  await db.insert(notifications).values({ organizationId: orgId, kind: "billing", key: "referralReward", params: { until: until.toISOString() } });
}

/**
 * After a business paid (a charge in its ledger): if its owner came through a referral link and nobody got the
 * reward yet, both get a month — the invited business and the inviter's first own business. Once per invited person.
 */
export async function rewardReferral(orgId: string, now = new Date()) {
  const [owner] = await db
    .select({ id: users.id, referredBy: users.referredBy, rewardedAt: users.referralRewardedAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")));
  if (!owner?.referredBy || owner.rewardedAt) return false;
  const [paid] = await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.organizationId, orgId), eq(ledgerEntries.kind, "charge"), lt(ledgerEntries.amountKop, 0))).limit(1);
  if (!paid) return false;
  const [claimed] = await db.update(users).set({ referralRewardedAt: now }).where(and(eq(users.id, owner.id), isNull(users.referralRewardedAt))).returning({ id: users.id });
  if (!claimed) return false;
  await grantMonth(orgId, now);
  const [inviterOrg] = await db.select({ org: memberships.organizationId }).from(memberships).where(and(eq(memberships.userId, owner.referredBy), eq(memberships.role, "owner"))).orderBy(asc(memberships.createdAt)).limit(1);
  if (inviterOrg) await grantMonth(inviterOrg.org, now);
  return true;
}

/** /api/referrals: the person's link and who came through it. */
export const referralRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);
  app.get("/", async (req) => {
    const code = await refCodeOf(req.auth!.user.id);
    const invited = await db
      .select({ name: users.name, at: users.createdAt, rewardedAt: users.referralRewardedAt })
      .from(users)
      .where(eq(users.referredBy, req.auth!.user.id))
      .orderBy(desc(users.createdAt))
      .limit(100);
    return {
      code,
      // Only the first name: the inviter does not get other people's contacts.
      invited: invited.map((u) => ({ name: u.name.split(/\s+/)[0] ?? "", at: u.at, rewarded: !!u.rewardedAt })),
      months: invited.filter((u) => u.rewardedAt).length,
    };
  });};
