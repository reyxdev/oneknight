import { and, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { contentIdeas, moduleInstalls, notifications, platformState, subscriptions } from "../db/schema.ts";
import { addDays, generatePlan, kyivDay } from "./engine.ts";

const CHANNEL_NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", site: "Сайт", telegram: "Telegram", youtube: "YouTube", viber: "Viber" };

/** Businesses with the module that works now (installed, subscription not suspended). */
async function withModule(orgIds?: string[]) {
  const rows = await db
    .select({ org: moduleInstalls.organizationId })
    .from(moduleInstalls)
    .innerJoin(subscriptions, eq(subscriptions.organizationId, moduleInstalls.organizationId))
    .where(and(eq(moduleInstalls.moduleId, "content"), inArray(subscriptions.status, ["trial", "active", "grace"]), orgIds ? inArray(moduleInstalls.organizationId, orgIds) : undefined));
  return rows.map((r) => r.org);
}

const kyiv = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", weekday: "short", hour: "numeric", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, hour: Number(p.hour) % 24 };
};
async function once(key: string, value: string, run: () => Promise<void>) {
  const [s] = await db.select().from(platformState).where(eq(platformState.key, key));
  if (s?.value === value) return false;
  await db.insert(platformState).values({ key, value }).onConflictDoUpdate({ target: platformState.key, set: { value, updatedAt: new Date() } });
  await run();
  return true;
}

/** Sunday from 18:00 Kyiv: the plan is refreshed for 30 days and «новий тиждень готовий» goes to the bell and Telegram (K76). */
export async function runContentWeekly(now = new Date(), orgIds?: string[]) {
  const k = kyiv(now);
  if (k.weekday !== "Sun" || k.hour < 18) return 0;
  let n = 0;
  await once(orgIds ? `contentWeek:${orgIds.join(",")}` : "contentWeek", kyivDay(now), async () => {
    for (const org of await withModule(orgIds)) {
      await generatePlan(org, { from: kyivDay(now) });
      const from = addDays(kyivDay(now), 1);
      const to = addDays(from, 6);
      const week = await db.select({ id: contentIdeas.id }).from(contentIdeas).where(and(eq(contentIdeas.organizationId, org), gte(contentIdeas.day, from), lte(contentIdeas.day, to), inArray(contentIdeas.status, ["todo", "awaiting"]))).then((r) => r.length);
      await db.insert(notifications).values({ organizationId: org, kind: "content", key: "contentWeek", params: { n: week, from, to } });
      n++;
    }
  });
  return n;
}

/** Every morning from 09:00 Kyiv: today's ideas with the first ready text, and yesterday's not posted (K19, K70). */
export async function runContentMorning(now = new Date(), orgIds?: string[]) {
  if (kyiv(now).hour < 9) return 0;
  let n = 0;
  const today = kyivDay(now);
  await once(orgIds ? `contentMorning:${orgIds.join(",")}` : "contentMorning", today, async () => {
    for (const org of await withModule(orgIds)) {
      const ideas = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, org), eq(contentIdeas.day, today), inArray(contentIdeas.status, ["todo", "awaiting"])));
      const missed = await db.select({ id: contentIdeas.id }).from(contentIdeas).where(and(eq(contentIdeas.organizationId, org), eq(contentIdeas.day, addDays(today, -1)), eq(contentIdeas.status, "todo")));
      if (!ideas.length && !missed.length) continue;
      const list = ideas
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((i) => `${i.time} ${CHANNEL_NAME[i.channel] ?? i.channel} — ${i.title}`)
        .join("\n");
      const first = ideas[0] ? `\n\n${ideas[0].textShort}` : "";
      const late = missed.length ? `\n\nВчора не опубліковано: ${missed.length}. Перенести чи пропустити — у «Контенті».` : "";
      await db.insert(notifications).values({ organizationId: org, kind: "content", key: "contentToday", params: { n: ideas.length, list: `${list}${first}${late}`.trim() } });
      // Each person with ideas assigned to them today gets their own list (owner's decision 30.09.2026).
      const people = [...new Set(ideas.map((i) => i.assigneeId).filter((x): x is string => !!x))];
      for (const userId of people) {
        const mine = ideas.filter((i) => i.assigneeId === userId).sort((a, b) => a.time.localeCompare(b.time));
        await db.insert(notifications).values({ organizationId: org, userId, kind: "content", key: "contentYours", params: { n: mine.length, list: mine.map((i) => `${i.time} ${CHANNEL_NAME[i.channel] ?? i.channel} — ${i.title}`).join("\n") } });
      }
      n++;
    }
  });
  return n;
}

/** History is kept 12 months; an idea with 👎 stays (it keeps its template away from the business). */
export async function purgeContentHistory(now = new Date()) {
  const rows = await db.delete(contentIdeas).where(and(lt(contentIdeas.day, addDays(kyivDay(now), -365)), or(isNull(contentIdeas.feedback), ne(contentIdeas.feedback, -1)))).returning({ id: contentIdeas.id });
  return rows.length;
}
