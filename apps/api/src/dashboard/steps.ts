import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { notifications, organizations, products, sites, subscriptions, telegramLinks, users } from "../db/schema.ts";

/** «Перші кроки» in order. Each is checked against real data, never ticked by hand. */
export const STEPS = ["site", "okjs", "products", "subscription", "twofa", "telegram"] as const;
export type Step = (typeof STEPS)[number];
export const REWARD_DAYS = 7;
const DAY = 86_400_000;

export async function stepsOf(orgId: string, userId: string, now = new Date()) {
  const [org] = await db.select({ rewardedAt: organizations.firstStepsRewardAt }).from(organizations).where(eq(organizations.id, orgId));
  const [s] = await db.select({ n: count(), seen: count(sites.okSeenAt) }).from(sites).where(eq(sites.organizationId, orgId));
  const [p] = await db.select({ n: count() }).from(products).where(eq(products.organizationId, orgId));
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  const [u] = await db.select({ totp: users.totpEnabled }).from(users).where(eq(users.id, userId));
  const [tg] = await db.select({ n: count() }).from(telegramLinks).where(and(eq(telegramLinks.userId, userId), isNotNull(telegramLinks.chatId)));
  const done: Record<Step, boolean> = {
    site: (s?.n ?? 0) > 0,
    okjs: (s?.seen ?? 0) > 0,
    products: (p?.n ?? 0) > 0,
    // Paid or covered by an access key; the free trial does not count as starting the subscription.
    subscription: sub?.status === "active" || !!(sub?.coveredUntil && sub.coveredUntil > now),
    twofa: !!u?.totp,
    telegram: (tg?.n ?? 0) > 0,
  };
  return { done, rewardedAt: org?.rewardedAt ?? null };
}

/**
 * Grants +7 days of ONEKNIGHT once, after every step is done: the current period (trial or paid) is simply
 * longer, so the next renewal moves 7 days later. A lapsed subscription is reopened for 7 days.
 */
export async function claimReward(orgId: string, userId: string, now = new Date()): Promise<{ ok: true; until: string } | { ok: false; error: "not_done" | "already" }> {
  const { done } = await stepsOf(orgId, userId, now);
  if (!STEPS.every((k) => done[k])) return { ok: false, error: "not_done" };
  return db.transaction(async (tx) => {
    const [org] = await tx.update(organizations).set({ firstStepsRewardAt: now }).where(and(eq(organizations.id, orgId), isNull(organizations.firstStepsRewardAt))).returning();
    if (!org) return { ok: false, error: "already" } as const;
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)).for("update");
    const running = sub && (sub.status === "trial" || sub.status === "active") && sub.periodEnd > now;
    const until = new Date((running ? sub.periodEnd.getTime() : now.getTime()) + REWARD_DAYS * DAY);
    if (!sub) await tx.insert(subscriptions).values({ organizationId: orgId, status: "active", periodEnd: until });
    else
      await tx
        .update(subscriptions)
        .set({ periodEnd: until, ...(running ? {} : { status: "active" as const, graceUntil: null }), ...(sub.status === "trial" && sub.trialEndsAt ? { trialEndsAt: until } : {}), updatedAt: now })
        .where(eq(subscriptions.organizationId, orgId));
    await tx.insert(notifications).values({ organizationId: orgId, kind: "billing", key: "firstStepsReward", params: { days: REWARD_DAYS, until: until.toISOString() } });
    return { ok: true, until: until.toISOString() } as const;
  });
}
