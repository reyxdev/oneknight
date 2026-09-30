import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { analyticsEvents, contentHolidays, contentIdeas, contentSettings, contentTemplates, orders, organizations, platformState, products, promos, reviews, sites } from "../db/schema.ts";
import { isLow } from "../products/routes.ts";
import { holidaysBetween } from "./holidays.ts";

export const CHANNELS = ["instagram", "facebook", "tiktok", "site", "telegram", "youtube", "viber"] as const;
export type Channel = (typeof CHANNELS)[number];
export const BUCKETS = ["sale", "benefit", "trust", "fun"] as const;
type Bucket = (typeof BUCKETS)[number];
type Template = typeof contentTemplates.$inferSelect;
type Product = typeof products.$inferSelect;

export type Settings = {
  channels: Partial<Record<Channel, { on: boolean; url?: string }>>;
  brief: { what?: string; unique?: string; audience?: string; goal?: string; time?: string };
  voice: { address: "vy" | "ty"; tone: "friendly" | "business" | "playful"; emoji: boolean; avoid: string[] };
  rhythm: "light" | "normal" | "active" | "custom";
  custom: Partial<Record<Channel, number>>;
  balance: Record<Bucket, number>;
  daysOff: number[];
  wholesale: { min: number; discount: number } | null;
  approval: boolean;
  ownDates: { date: string; name: string }[];
  tag: string;
  siteId: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  channels: { instagram: { on: true } },
  brief: {},
  voice: { address: "vy", tone: "friendly", emoji: true, avoid: [] },
  rhythm: "normal",
  custom: {},
  balance: { sale: 40, benefit: 30, trust: 20, fun: 10 },
  daysOff: [],
  wholesale: null,
  approval: false,
  ownDates: [],
  tag: "",
  siteId: null,
};

/** Posts a week per channel for «Звичайний»; «Легкий» is half, «Активний» one and a half (owner's decisions K07–K08). */
export const RHYTHM: Record<Channel, number> = { instagram: 4, facebook: 3, tiktok: 3, site: 1, telegram: 3, youtube: 2, viber: 2 };
/** General best hours until the business's own visits show better ones (K52). */
export const BEST_HOUR: Record<Channel, string> = { instagram: "19:00", facebook: "12:00", tiktok: "20:00", site: "10:00", telegram: "10:00", youtube: "18:00", viber: "11:00" };
export const MAX_PER_DAY = 3;
const PRODUCT_GAP_DAYS = 7;
const TEMPLATE_GAP_DAYS = 90;
const CATEGORY_WORDS: Record<string, string> = { clothes: "одяг і взуття", home: "товари для дому", handmade: "речі ручної роботи", beauty: "товари для краси", tech: "техніку", food: "смаколики", kids: "дитячі товари", services: "послуги" };
const CATEGORY_TAG: Record<string, string> = { clothes: "одяг", home: "дім", handmade: "ручнаробота", beauty: "краса", tech: "техніка", food: "їжа", kids: "дитячетовари", services: "послуги" };

const DAY = 86_400_000;
export const kyivDay = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / DAY);

export async function settingsOf(orgId: string): Promise<Settings> {
  const [row] = await db.select().from(contentSettings).where(eq(contentSettings.organizationId, orgId));
  const s = (row?.settings ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...s, voice: { ...DEFAULT_SETTINGS.voice, ...(s.voice ?? {}) }, balance: { ...DEFAULT_SETTINGS.balance, ...(s.balance ?? {}) }, channels: s.channels ?? DEFAULT_SETTINGS.channels };
}

export function weeklyCount(s: Settings, c: Channel, base: Record<Channel, number> = RHYTHM) {
  if (s.rhythm === "custom") return Math.max(0, Math.min(14, s.custom[c] ?? base[c]));
  const k = s.rhythm === "light" ? 0.5 : s.rhythm === "active" ? 1.5 : 1;
  return Math.max(1, Math.round(base[c] * k));
}

/** «Звичайний» ритм каналів: the admin can change it (platform_state `contentRhythm`), else RHYTHM. */
export async function rhythmBase(): Promise<Record<Channel, number>> {
  const [row] = await db.select().from(platformState).where(eq(platformState.key, "contentRhythm"));
  return { ...RHYTHM, ...((row?.value ?? {}) as Partial<Record<Channel, number>>) };
}

/** How a published idea did: visits and orders from its UTM link (utm_content = the first 8 characters of its id). */
export const RESULT_DAYS = 7;
export async function resultsOf(orgId: string, ideas: { id: string; publishedAt: Date | null }[]) {
  const out = new Map<string, { visits: number; orders: number; revenueKop: number }>();
  if (!ideas.length) return out;
  const rows = await db.execute<{ c: string; visits: number; orders: number; revenue: number; at: Date }>(dsql`
    select ${analyticsEvents.content} as c, count(distinct ${analyticsEvents.session}) filter (where ${analyticsEvents.type} = 'pageview')::int as visits,
      count(*) filter (where ${analyticsEvents.type} = 'order')::int as orders,
      coalesce(sum(${analyticsEvents.valueKop}) filter (where ${analyticsEvents.type} = 'order'), 0)::bigint as revenue
    from ${analyticsEvents}
    where ${analyticsEvents.organizationId} = ${orgId} and ${analyticsEvents.campaign} = 'content' and ${inArray(analyticsEvents.content, ideas.map((i) => i.id.slice(0, 8)))}
    group by 1`);
  for (const r of rows) {
    const idea = ideas.find((i) => i.id.startsWith(r.c));
    if (idea) out.set(idea.id, { visits: Number(r.visits), orders: Number(r.orders), revenueKop: Number(r.revenue) });
  }
  return out;
}

/**
 * «План вчиться на результатах» (owner's decision 30.09.2026): with 10+ published ideas, the bucket that brings the
 * most (visits + 5 × orders per post) takes up to 10 points of the balance from the one that brings the least; the
 * best format of Instagram and the best channel get one more place a week. 👎 removes a template for the business
 * for good, 👍 brings it back twice as often.
 */
export async function learningOf(orgId: string, s: Settings) {
  const published = await db
    .select({ id: contentIdeas.id, bucket: contentIdeas.bucket, format: contentIdeas.format, channel: contentIdeas.channel, publishedAt: contentIdeas.publishedAt })
    .from(contentIdeas)
    .where(and(eq(contentIdeas.organizationId, orgId), eq(contentIdeas.status, "published"), gte(contentIdeas.day, addDays(kyivDay(), -180))));
  const votes = await db.select({ templateId: contentIdeas.templateId, feedback: contentIdeas.feedback }).from(contentIdeas).where(and(eq(contentIdeas.organizationId, orgId), isNotNull(contentIdeas.feedback), isNotNull(contentIdeas.templateId)));
  const disliked = new Set(votes.filter((v) => v.feedback === -1).map((v) => v.templateId!));
  const liked = new Set(votes.filter((v) => v.feedback === 1 && !disliked.has(v.templateId!)).map((v) => v.templateId!));
  const none = { balance: s.balance, shift: null as null | { from: Bucket; to: Bucket; points: number }, bestFormat: null as string | null, bestChannel: null as Channel | null, published: published.length, disliked, liked };
  if (published.length < 10) return none;
  const res = await resultsOf(orgId, published);
  const score = (key: (i: (typeof published)[number]) => string) => {
    const m = new Map<string, { n: number; sum: number }>();
    for (const i of published) {
      const r = res.get(i.id);
      const k = key(i);
      const cur = m.get(k) ?? { n: 0, sum: 0 };
      m.set(k, { n: cur.n + 1, sum: cur.sum + (r ? r.visits + 5 * r.orders : 0) });
    }
    return [...m].filter(([, v]) => v.n >= 3).map(([k, v]) => ({ k, avg: v.sum / v.n })).sort((a, b) => b.avg - a.avg);
  };
  const buckets = score((i) => i.bucket).filter((x) => (BUCKETS as readonly string[]).includes(x.k));
  const balance = { ...s.balance };
  let shift: typeof none.shift = null;
  if (buckets.length >= 2 && buckets[0]!.avg > 0) {
    const best = buckets[0]!.k as Bucket;
    const worst = buckets[buckets.length - 1]!.k as Bucket;
    const points = Math.min(10, balance[worst], Math.round((10 * (buckets[0]!.avg - buckets[buckets.length - 1]!.avg)) / buckets[0]!.avg));
    if (points > 0) {
      balance[best] += points;
      balance[worst] -= points;
      shift = { from: worst, to: best, points };
    }
  }
  const lead = (list: { k: string; avg: number }[]) => {
    const mean = list.reduce((a, x) => a + x.avg, 0) / (list.length || 1);
    return list.length >= 2 && list[0]!.avg > 0 && list[0]!.avg >= 1.3 * mean ? list[0]!.k : null;
  };
  const bestFormat = lead(score((i) => (i.channel === "instagram" ? i.format : "")).filter((x) => x.k));
  const bestChannel = lead(score((i) => i.channel).filter((x) => s.channels[x.k as Channel]?.on)) as Channel | null;
  return { balance, shift, bestFormat, bestChannel, published: published.length, disliked, liked };
}

/** {{ви-form|ти-form}} by the brand voice, emoji removed when the business does not want them. */
export function voiced(text: string, v: Settings["voice"]) {
  let out = text.replace(/\{\{([^|{}]*)\|([^|{}]*)\}\}/g, (_, vy: string, ty: string) => (v.address === "ty" ? ty : vy));
  if (!v.emoji) out = out.replace(/\p{Extended_Pictographic}️?/gu, "").replace(/ {2,}/g, " ").replace(/ +\n/g, "\n").trim();
  return out;
}
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{([a-zA-Z0-9]+)\}/g, (m, k: string) => vars[k] ?? m);
const hasUnfilled = (text: string) => /\{[a-zA-Z0-9]+\}/.test(text);
const money = (kop: number) => `${(kop / 100).toLocaleString("uk-UA", { maximumFractionDigits: 2 })} грн`;
const dateWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "UTC" });

/** Everything the plan knows about the business right now (real data only). */
export async function businessData(orgId: string, today: string) {
  const [org] = await db.select({ name: organizations.name, onboarding: organizations.onboarding }).from(organizations).where(eq(organizations.id, orgId));
  const list = await db.select().from(products).where(and(eq(products.organizationId, orgId), isNull(products.archivedAt), eq(products.active, true)));
  const usable = list.filter((p) => p.promote !== "no");
  const sold30 = new Map<string, number>();
  const sold60 = new Set<string>();
  const rows = await db.execute<{ pid: string; qty: number; recent: boolean }>(dsql`
    select i->>'productId' as pid, sum((i->>'qty')::int)::int as qty, bool_or(${orders.createdAt} > now() - interval '30 days') as recent
    from ${orders}, jsonb_array_elements(${orders.items}) i
    where ${orders.organizationId} = ${orgId} and ${orders.isExample} = false and ${orders.status} not in ('cancelled', 'returned') and ${orders.createdAt} > now() - interval '60 days'
    group by 1`);
  for (const r of rows) {
    sold60.add(r.pid);
    if (r.recent) sold30.set(r.pid, Number(r.qty));
  }
  const day0 = new Date(`${today}T00:00:00Z`).getTime();
  const promoted = (a: Product[]) => [...a.filter((p) => p.promote === "yes"), ...a.filter((p) => p.promote !== "yes")];
  const photoFirst = (a: Product[]) => [...a.filter((p) => p.photoFileId), ...a.filter((p) => !p.photoFileId)];
  const inStock = usable.filter((p) => p.availability !== "out" && !(p.availability === "in_stock" && p.stock === 0));
  const data = {
    name: org?.name ?? "",
    sells: ((org?.onboarding as { sells?: string[] } | null)?.sells ?? []).filter((x) => x !== "other"),
    hits: photoFirst(inStock.filter((p) => (sold30.get(p.id) ?? 0) >= 2).sort((a, b) => (sold30.get(b.id) ?? 0) - (sold30.get(a.id) ?? 0))),
    fresh: photoFirst(inStock.filter((p) => day0 - p.createdAt.getTime() <= 14 * DAY)),
    low: inStock.filter((p) => isLow(p)),
    discount: inStock.filter((p) => p.oldPriceKop !== null && p.oldPriceKop > p.priceKop),
    stale: inStock.filter((p) => !sold60.has(p.id) && day0 - p.createdAt.getTime() > 30 * DAY),
    catalog: promoted(photoFirst(inStock)),
    sold30,
    reviews: await db
      .select({ id: reviews.id, name: reviews.authorName, rating: reviews.rating, text: reviews.text, productId: reviews.productId, photo: reviews.photoFileId })
      .from(reviews)
      .where(and(eq(reviews.organizationId, orgId), eq(reviews.status, "published"), gte(reviews.rating, 4)))
      .orderBy(desc(reviews.createdAt))
      .limit(50),
    promos: await db.select().from(promos).where(and(eq(promos.organizationId, orgId), gte(promos.endsOn, today))),
    newCount: list.filter((p) => day0 - p.createdAt.getTime() <= 30 * DAY).length,
    sleeping: Number(
      (
        await db.execute<{ n: number }>(dsql`select count(*)::int as n from (select customer_id, max(created_at) as last from ${orders} where organization_id = ${orgId} and customer_id is not null and not is_example group by 1) x where x.last < now() - interval '90 days'`)
      )[0]?.n ?? 0,
    ),
  };
  return data;
}
type Data = Awaited<ReturnType<typeof businessData>>;

/** The best hour for a channel: from the business's own visits from that channel (30+), else the general one. */
async function hoursOf(orgId: string) {
  const rows = await db.execute<{ channel: string; h: number; n: number }>(dsql`
    select channel, extract(hour from created_at at time zone 'Europe/Kyiv')::int as h, count(*)::int as n
    from ${analyticsEvents} where organization_id = ${orgId} and type = 'pageview' and created_at > now() - interval '30 days'
    group by 1, 2`);
  const out: Partial<Record<Channel, string>> = {};
  for (const c of CHANNELS) {
    const mine = [...rows].filter((r) => r.channel === c);
    if (mine.reduce((s, r) => s + Number(r.n), 0) < 30) continue;
    const top = mine.sort((a, b) => Number(b.n) - Number(a.n))[0]!;
    out[c] = `${String(top.h).padStart(2, "0")}:00`;
  }
  return out;
}

/** The format of an idea in a channel (K43–K49); days off get only light stories (K71). */
function formatFor(c: Channel, light: boolean, turn: number, best: string | null = null): string {
  if (c === "tiktok" || c === "youtube") return "reels";
  if (c === "site") return "article";
  if (c === "telegram" || c === "viber") return "message";
  if (c === "facebook") return "post";
  if (light) return "stories";
  const turns = ["post", "carousel", "reels", "stories", ...(best ? [best] : [])];
  return turns[turn % turns.length]!;
}

type Event = { day: string; trigger: string; promoId?: string; holiday?: { key: string; name: string; kind: string; date: string } };
/**
 * Dated ideas that do not wait for a slot: promotions (announce 3 days before, a reminder halfway, the last day)
 * and holidays (a collection at the start of the preparation, a gift idea, a reminder 3 days before; greetings and
 * days of memory on the day itself).
 */
function eventsBetween(data: Data, holidays: (typeof contentHolidays.$inferSelect)[], own: Settings["ownDates"], from: string, to: string): Event[] {
  const out: Event[] = [];
  for (const p of data.promos) {
    const announce = p.startsOn > from ? addDays(p.startsOn, -3) < from ? from : addDays(p.startsOn, -3) : null;
    if (announce && announce <= to) out.push({ day: announce, trigger: "promoAnnounce", promoId: p.id });
    const len = daysBetween(p.startsOn, p.endsOn);
    const mid = addDays(p.startsOn, Math.floor(len / 2));
    if (len >= 4 && mid >= from && mid <= to) out.push({ day: mid, trigger: "promoReminder", promoId: p.id });
    if (p.endsOn >= from && p.endsOn <= to && len >= 1) out.push({ day: p.endsOn, trigger: "promoLast", promoId: p.id });
  }
  const ownAsHolidays = own.map((o, i) => ({ id: `own${i}`, key: `own-${i}`, name: o.name, rule: `fixed:${o.date}`, kind: "greeting", prepDays: 2, active: true }));
  for (const h of holidaysBetween([...holidays.filter((x) => x.active), ...ownAsHolidays], from, addDays(to, 16))) {
    const hol = { key: h.key, name: h.name, kind: h.kind, date: h.date };
    if (h.kind === "sale") {
      const start = addDays(h.date, -h.prepDays);
      if (start >= from && start <= to) out.push({ day: start, trigger: "holidayCollection", holiday: hol });
      const gift = addDays(h.date, -Math.max(4, Math.round(h.prepDays / 2)));
      if (gift >= from && gift <= to && gift > start) out.push({ day: gift, trigger: "holidaySale", holiday: hol });
      const remind = addDays(h.date, -3);
      if (remind >= from && remind <= to && remind > gift) out.push({ day: remind, trigger: "holidayReminder", holiday: hol });
    } else if (h.date <= to) out.push({ day: h.date, trigger: h.kind === "respect" ? "holidayRespect" : "holidayGreeting", holiday: hol });
  }
  return out;
}

const BUCKET_OF: Record<string, Bucket> = { holidayRespect: "trust", holidayGreeting: "trust" };

/**
 * Builds (or refreshes) the plan for [from, from + days): ideas the team touched stay; the rest of the future is
 * made again from today's data (K39). At most 3 ideas a day across channels (K79).
 */
export async function generatePlan(orgId: string, opts: { from?: string; days?: number; seed?: number } = {}) {
  const from = opts.from ?? kyivDay();
  const days = opts.days ?? 30;
  const to = addDays(from, days - 1);
  const s = await settingsOf(orgId);
  const data = await businessData(orgId, from);
  const channels = CHANNELS.filter((c) => s.channels[c]?.on);
  const [site] = await db.select({ id: sites.id, domain: sites.domain }).from(sites).where(s.siteId ? and(eq(sites.organizationId, orgId), eq(sites.id, s.siteId)) : eq(sites.organizationId, orgId)).orderBy(sites.createdAt).limit(1);
  const templates = (await db.select().from(contentTemplates).where(and(eq(contentTemplates.active, true), dsql`(${contentTemplates.organizationId} is null or ${contentTemplates.organizationId} = ${orgId})`))).filter(
    (t) => !t.categories.length || !data.sells.length || t.categories.some((c) => data.sells.includes(c)),
  );
  const holidays = await db.select().from(contentHolidays);
  const hours = await hoursOf(orgId);
  const learned = await learningOf(orgId, s);
  const base = await rhythmBase();

  // Keep what the team touched; the rest of the window is built again (days after it stay as they are).
  await db.delete(contentIdeas).where(and(eq(contentIdeas.organizationId, orgId), gte(contentIdeas.day, from), lte(contentIdeas.day, to), eq(contentIdeas.locked, false), eq(contentIdeas.custom, false), inArray(contentIdeas.status, ["todo", "awaiting"])));
  const kept = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, orgId), gte(contentIdeas.day, addDays(from, -TEMPLATE_GAP_DAYS)), lte(contentIdeas.day, to)));
  const perDay = new Map<string, number>();
  for (const k of kept) if (k.day >= from && k.status !== "skipped") perDay.set(k.day, (perDay.get(k.day) ?? 0) + 1);
  // History for variety: templates used lately, products per channel, reviews already shown.
  const usedTemplate = new Map<string, string>();
  for (const k of kept) if (k.templateId && (usedTemplate.get(k.templateId) ?? "") < k.day) usedTemplate.set(k.templateId, k.day);
  const productDays: { channel: string; productId: string; day: string }[] = kept.filter((k) => k.productId).map((k) => ({ channel: k.channel, productId: k.productId!, day: k.day }));
  const usedReviews = new Set(kept.map((k) => k.reviewId).filter(Boolean) as string[]);
  const bucketCount: Record<Bucket, number> = { sale: 0, benefit: 0, trust: 0, fun: 0 };
  for (const k of kept) if (k.day >= addDays(from, -28) && (BUCKETS as readonly string[]).includes(k.bucket)) bucketCount[k.bucket as Bucket]++;
  // A deterministic «random» so the same data gives the same plan (and tests can rely on it).
  let seed = opts.seed ?? [...orgId].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) ^ Number(from.replace(/-/g, ""));
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 10_000) / 10_000;

  const slots: { day: string; channel: Channel; light: boolean; event?: Event }[] = [];
  const events = channels.length ? eventsBetween(data, holidays, s.ownDates, from, to) : [];
  const respectDays = new Set(events.filter((e) => e.trigger === "holidayRespect").map((e) => e.day));
  const main: Channel = channels.includes("instagram") ? "instagram" : (channels[0] as Channel);
  for (const e of events) slots.push({ day: e.day, channel: main, light: e.trigger === "holidayReminder" || e.trigger.startsWith("holidayG") || e.trigger === "holidayRespect", event: e });
  channels.forEach((c, ci) => {
    const n = weeklyCount(s, c, base) + (learned.bestChannel === c ? 1 : 0);
    for (let d = 0; d < days; d++) {
      const day = addDays(from, d);
      const wd = weekday(day);
      // n posts spread over the 7 days of the week, each channel shifted so they do not all land on one day.
      const positions = Array.from({ length: n }, (_, i) => (Math.floor((i * 7) / n) + ci) % 7);
      if (!positions.includes(wd)) continue;
      if (respectDays.has(day)) continue;
      slots.push({ day, channel: c, light: s.daysOff.includes(wd) });
    }
  });
  slots.sort((a, b) => a.day.localeCompare(b.day) || Number(!!b.event) - Number(!!a.event));

  const made: (typeof contentIdeas.$inferInsert)[] = [];
  let turn = 0;
  for (const slot of slots) {
    const count = perDay.get(slot.day) ?? 0;
    if (count >= MAX_PER_DAY) continue;
    // A day off keeps one light idea.
    if (slot.light && !slot.event && count >= 1) continue;
    const idea = pick(slot);
    if (!idea) continue;
    made.push(idea);
    perDay.set(slot.day, count + 1);
  }

  function pick(slot: (typeof slots)[number]): (typeof contentIdeas.$inferInsert) | null {
    const format = formatFor(slot.channel, slot.light, turn++, learned.bestFormat);
    const tries: { bucket: Bucket; trigger: string }[] = [];
    if (slot.event) tries.push({ bucket: BUCKET_OF[slot.event.trigger] ?? "sale", trigger: slot.event.trigger });
    else {
      // The bucket furthest below its share of the plan goes first (sale 40 · benefit 30 · trust 20 · fun 10).
      const total = Object.values(bucketCount).reduce((a, b) => a + b, 0) + 1;
      const order = [...BUCKETS].sort((a, b) => bucketCount[a] / total - learned.balance[a] / 100 - (bucketCount[b] / total - learned.balance[b] / 100));
      const site = slot.channel === "site";
      for (const b of site ? (["benefit", ...order.filter((x) => x !== "benefit")] as Bucket[]) : order) {
        const triggers =
          b === "sale"
            ? shuffle([
                ...(data.hits.length ? ["hit", "hit"] : []),
                ...(data.fresh.length ? ["new", "new"] : []),
                ...(data.low.length ? ["lowStock"] : []),
                ...(data.discount.length ? ["discount"] : []),
                ...(data.stale.length ? ["stale"] : []),
                ...(s.wholesale && !made.some((m) => m.trigger === "wholesale" && daysBetween(m.day!, slot.day) < 14) ? ["wholesale"] : []),
                ...(data.sleeping >= 5 && data.newCount > 0 && !made.some((m) => m.trigger === "sleeping" && daysBetween(m.day!, slot.day) < 30) ? ["sleeping"] : []),
                ...(data.catalog.length ? ["catalog"] : []),
              ])
            : b === "benefit"
              ? shuffle([...(data.catalog.length ? ["catalog"] : []), "evergreen", "evergreen"])
              : b === "trust"
                ? [...(data.reviews.some((r) => !usedReviews.has(r.id)) ? ["review"] : []), "evergreen"]
                : ["evergreen"];
        for (const t of triggers) tries.push({ bucket: b, trigger: t });
      }
    }
    for (const t of tries) {
      const idea = build(slot, format, t.bucket, t.trigger);
      if (idea) {
        bucketCount[t.bucket]++;
        return idea;
      }
    }
    return null;
  }

  function shuffle<T>(a: T[]) {
    return a.map((x) => ({ x, k: rnd() })).sort((p, q) => p.k - q.k).map((p) => p.x);
  }

  function productFor(trigger: string, channel: string, day: string): Product | null | undefined {
    const pool = trigger === "hit" ? data.hits : trigger === "new" ? data.fresh : trigger === "lowStock" ? data.low : trigger === "discount" ? data.discount : trigger === "stale" ? data.stale : ["catalog", "holidaySale"].includes(trigger) ? data.catalog : null;
    if (pool === null) return undefined;
    // The same product at most once in 7 days in a channel (K34).
    return pool.find((p) => !productDays.some((u) => u.productId === p.id && u.channel === channel && Math.abs(daysBetween(u.day, day)) < PRODUCT_GAP_DAYS)) ?? null;
  }

  function build(slot: (typeof slots)[number], format: string, bucket: Bucket, trigger: string): (typeof contentIdeas.$inferInsert) | null {
    const product = productFor(trigger, slot.channel, slot.day);
    if (product === null) return null;
    const review = trigger === "review" ? data.reviews.find((r) => !usedReviews.has(r.id)) : undefined;
    if (trigger === "review" && !review) return null;
    const promo = slot.event?.promoId ? data.promos.find((p) => p.id === slot.event!.promoId) : undefined;
    const hol = slot.event?.holiday;
    const vars: Record<string, string> = {
      business: data.name,
      category: s.brief.what?.trim() || data.sells.map((x) => CATEGORY_WORDS[x]).filter(Boolean).join(", ") || "наші товари",
      ...(product ? { product: product.name, price: money(product.priceKop), sold30: String(data.sold30.get(product.id) ?? 0), left: String(product.stock ?? ""), ...(product.oldPriceKop && product.oldPriceKop > product.priceKop ? { oldPrice: money(product.oldPriceKop), discount: String(Math.round((1 - product.priceKop / product.oldPriceKop) * 100)) } : {}) } : {}),
      ...(review ? { review: review.text.trim().slice(0, 400), reviewer: review.name.trim().split(/\s+/)[0]!, rating: String(review.rating) } : {}),
      ...(promo ? { promo: promo.name, promoEnd: `до ${dateWords(promo.endsOn)}`, ...(promo.discount ? { discount: String(promo.discount) } : {}) } : {}),
      ...(hol ? { holiday: hol.name, days: String(Math.max(0, daysBetween(slot.day, hol.date))) } : {}),
      ...(s.wholesale ? { wholesaleMin: String(s.wholesale.min), wholesaleDiscount: String(s.wholesale.discount) } : {}),
      newCount: String(data.newCount),
    };
    const lastUse = (t: Template) => usedTemplate.get(t.id) ?? "";
    const fits = templates
      .filter((t) => t.trigger === trigger && t.bucket === bucket && (!slot.light || t.light) && (slot.channel !== "site" || !!t.article || trigger.startsWith("holiday") || trigger.startsWith("promo")))
      .filter((t) => !learned.disliked.has(t.id))
      .filter((t) => { const gap = learned.liked.has(t.id) ? TEMPLATE_GAP_DAYS / 2 : TEMPLATE_GAP_DAYS; return !lastUse(t) || daysBetween(lastUse(t), slot.day) >= gap || lastUse(t) < addDays(from, -gap); })
      .map((t) => ({ t, k: (lastUse(t) ? 1 : 0) + rnd() }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.t);
    for (const t of fits) {
      const texts = [t.title, t.why, t.shot, t.short, t.long, t.cta].map((x) => voiced(fill(x, vars), s.voice));
      // Every placeholder must come from real data; words the business avoids rule a template out.
      if (texts.some(hasUnfilled)) continue;
      if (s.voice.avoid.some((w) => w.trim() && texts.some((x) => x.toLowerCase().includes(w.trim().toLowerCase())))) continue;
      const id = randomUUID();
      const fillAll = (x: string) => voiced(fill(x, vars), s.voice);
      const extra =
        format === "reels" ? { hooks: t.hooks.map(fillAll) } : format === "stories" ? { stories: t.stories.map((f) => ({ ...f, text: fillAll(f.text) })) } : format === "carousel" ? { slides: t.slides.map((x) => ({ heading: fillAll(x.heading), photo: fillAll(x.photo) })) } : format === "article" ? { article: t.article ? { topic: fillAll(t.article.topic), outline: t.article.outline.map(fillAll) } : null } : {};
      if (Object.values(extra).some((v) => (Array.isArray(v) ? v.some((y) => hasUnfilled(typeof y === "string" ? y : JSON.stringify(y))) : v && hasUnfilled(JSON.stringify(v))))) continue;
      const tags = [...new Set([...t.hashtags, ...data.sells.map((x) => CATEGORY_TAG[x]).filter((x): x is string => !!x), ...(s.tag ? [s.tag.replace(/^#/, "")] : []), "україна"].map((x) => x.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "")).filter((x): x is string => !!x))].slice(0, 10);
      const why = [texts[1], dataWhy(trigger, vars)].filter(Boolean).join(" ");
      usedTemplate.set(t.id, slot.day);
      if (product) productDays.push({ channel: slot.channel, productId: product.id, day: slot.day });
      if (review) usedReviews.add(review.id);
      return {
        id,
        organizationId: orgId,
        day: slot.day,
        time: hours[slot.channel] ?? BEST_HOUR[slot.channel],
        channel: slot.channel,
        also: format === "post" || format === "carousel" ? channels.filter((c) => c !== slot.channel && ["facebook", "telegram", "viber"].includes(c)) : [],
        format,
        bucket,
        templateId: t.id,
        trigger,
        productId: product?.id ?? null,
        reviewId: review?.id ?? null,
        promoId: promo?.id ?? null,
        holiday: hol?.key ?? null,
        siteId: site?.id ?? null,
        title: texts[0]!,
        why,
        shot: texts[2]!,
        textShort: texts[3]!,
        textLong: texts[4]!,
        cta: texts[5]!,
        hashtags: tags.length >= 5 ? tags : [...tags, "покупки", "магазин", "новинки"].slice(0, 5),
        extra,
        link: site ? `https://${site.domain}/?utm_source=${slot.channel}&utm_medium=social&utm_campaign=content&utm_content=${id.slice(0, 8)}` : null,
        status: s.approval ? "awaiting" : "todo",
      };
    }
    return null;
  }

  if (made.length) for (let i = 0; i < made.length; i += 200) await db.insert(contentIdeas).values(made.slice(i, i + 200));
  await db.insert(contentSettings).values({ organizationId: orgId, generatedAt: new Date() }).onConflictDoUpdate({ target: contentSettings.organizationId, set: { generatedAt: new Date() } });
  return { made: made.length, kept: kept.filter((k) => k.day >= from).length, events };
}

/** «Чому саме це» from the data behind the idea (real figures only). */
function dataWhy(trigger: string, v: Record<string, string>) {
  if (trigger === "hit" && v.sold30) return `Цей товар купили ${v.sold30} разів за 30 днів.`;
  if (trigger === "new") return "Новинка каталогу: про неї ще не знають.";
  if (trigger === "lowStock" && v.left) return `Лишилось ${v.left} шт.`;
  if (trigger === "discount" && v.discount) return `Зараз знижка ${v.discount}%.`;
  if (trigger === "stale") return "Товар давно не показували — варто нагадати про нього.";
  if (trigger === "review" && v.rating) return `Справжній відгук на ${v.rating}★.`;
  if (trigger === "sleeping") return `Відтоді, як деякі клієнти купували, у каталозі з'явилось ${v.newCount} нових товарів.`;
  return "";
}

