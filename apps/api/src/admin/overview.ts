import { and, count, desc, eq, gt, gte, inArray, lt, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { leads, ledgerEntries, memberships, moduleInstalls, orders, organizations, platformState, sites, subscriptions, tickets, topups, users } from "../db/schema.ts";
import { DELETE_AFTER_DAYS, balanceKop, monthlyKop } from "../billing/service.ts";
import { adminDue } from "../projects/routes.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A new lead should hear from us within 4 working hours (Mon–Fri 10:00–18:00 Kyiv). */
export const LEAD_CONTACT_HOURS = 4;
export const RISK_IDLE_DAYS = 14;

/** Kyiv wall-clock parts of a moment. */
function kyiv(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", weekday: "short", hour: "numeric", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, hour: Number(p.hour) % 24 };
}
/** Working hours (Mon–Fri 10:00–18:00 Kyiv) between two moments, counted by quarter hours. */
export function workingHours(from: Date, to: Date) {
  let n = 0;
  for (let t = from.getTime(); t < to.getTime() && t - from.getTime() < 30 * DAY; t += HOUR / 4) {
    const k = kyiv(new Date(t));
    if (k.weekday !== "Sat" && k.weekday !== "Sun" && k.hour >= 10 && k.hour < 18) n += 0.25;
  }
  return n;
}

/**
 * «Ризик відтоку»: paying or trial businesses where the owner has not logged in for 14 days, no order came in 14
 * days (for a business older than that), or the next charge is within 7 days and the balance does not cover it.
 */
export async function churnRisk(now = new Date()) {
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, createdAt: organizations.createdAt, status: subscriptions.status, periodEnd: subscriptions.periodEnd, ownerName: users.name, ownerPhone: users.phone, lastSeen: dsql<Date | null>`(select max(s.last_seen_at) from sessions s where s.user_id = ${users.id})` })
    .from(organizations)
    .innerJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
    .innerJoin(memberships, and(eq(memberships.organizationId, organizations.id), eq(memberships.role, "owner")))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(subscriptions.status, ["trial", "active", "grace"]));
  const out = [];
  for (const r of rows) {
    const reasons: string[] = [];
    const lastSeen = r.lastSeen ? new Date(r.lastSeen) : null;
    if (!lastSeen || now.getTime() - lastSeen.getTime() > RISK_IDLE_DAYS * DAY) reasons.push("noLogin");
    if (now.getTime() - r.createdAt.getTime() > RISK_IDLE_DAYS * DAY) {
      const [o] = await db.select({ n: count() }).from(orders).where(and(eq(orders.organizationId, r.id), eq(orders.isExample, false), gt(orders.createdAt, new Date(now.getTime() - RISK_IDLE_DAYS * DAY))));
      if (!o?.n) reasons.push("noOrders");
    }
    if (r.status === "grace") reasons.push("grace");
    else if (r.status === "active" && r.periodEnd.getTime() - now.getTime() < 7 * DAY) {
      const [need, have] = [(await monthlyKop(r.id, db, r.periodEnd)).total, await balanceKop(r.id)];
      if (have < need) reasons.push("payment");
    }
    if (reasons.length) out.push({ id: r.id, name: r.name, owner: r.ownerName, phone: r.ownerPhone, status: r.status, lastSeen, reasons });
  }
  // The most reasons first.
  return out.sort((a, b) => b.reasons.length - a.reasons.length);
}

/** «Огляд»: first what needs Ivan, then the numbers (all from the database, nothing estimated). */
export async function overview(now = new Date()) {
  const month = new Date(now.getTime() - 30 * DAY);
  const prevMonth = new Date(now.getTime() - 60 * DAY);

  const newLeads = await db.select({ id: leads.id, number: leads.number, name: leads.name, createdAt: leads.createdAt }).from(leads).where(eq(leads.status, "new")).orderBy(leads.createdAt);
  const lateLeads = newLeads.filter((l) => workingHours(l.createdAt, now) >= LEAD_CONTACT_HOURS);
  const [topupsPending] = await db.select({ n: count() }).from(topups).where(eq(topups.status, "pending"));
  const [ticketsOpen] = await db.select({ n: count() }).from(tickets).where(eq(tickets.status, "open"));
  const down = await db.select({ id: sites.id, domain: sites.domain }).from(sites).where(and(eq(sites.status, "live"), eq(sites.lastUp, false)));
  const grace = await db.select({ id: organizations.id, name: organizations.name, graceUntil: subscriptions.graceUntil }).from(subscriptions).innerJoin(organizations, eq(organizations.id, subscriptions.organizationId)).where(eq(subscriptions.status, "grace"));
  const [deletable] = await db
    .select({ n: count() })
    .from(subscriptions)
    .innerJoin(organizations, eq(organizations.id, subscriptions.organizationId))
    .where(and(eq(subscriptions.status, "suspended"), lte(subscriptions.suspendedAt, new Date(now.getTime() - DELETE_AFTER_DAYS * DAY)), dsql`${organizations.purgedAt} is null`));

  const due = await adminDue(now);
  const todo = [
    ...(lateLeads.length ? [{ key: "leadsLate", n: lateLeads.length, screen: "admin" }] : []),
    ...(newLeads.length > lateLeads.length ? [{ key: "leadsNew", n: newLeads.length - lateLeads.length, screen: "admin" }] : []),
    ...(due.reminders ? [{ key: "leadsRemind", n: due.reminders, screen: "admin" }] : []),
    ...(due.deadlines ? [{ key: "deadlines", n: due.deadlines, screen: "projects" }] : []),
    ...(topupsPending!.n ? [{ key: "topups", n: topupsPending!.n, screen: "topups" }] : []),
    ...(ticketsOpen!.n ? [{ key: "tickets", n: ticketsOpen!.n, screen: "tickets" }] : []),
    ...(down.length ? [{ key: "sitesDown", n: down.length, screen: "clients", list: down.map((s) => s.domain) }] : []),
    ...(grace.length ? [{ key: "grace", n: grace.length, screen: "clients", list: grace.map((g) => g.name) }] : []),
    ...(deletable!.n ? [{ key: "deletable", n: deletable!.n, screen: "clients" }] : []),
  ];

  // Money: what was really charged in 30 days, and what the paying businesses will be charged monthly.
  const [charged] = await db.select({ s: dsql<number>`coalesce(-sum(${ledgerEntries.amountKop}), 0)`.mapWith(Number) }).from(ledgerEntries).where(and(eq(ledgerEntries.kind, "charge"), gt(ledgerEntries.createdAt, month)));
  const [chargedPrev] = await db.select({ s: dsql<number>`coalesce(-sum(${ledgerEntries.amountKop}), 0)`.mapWith(Number) }).from(ledgerEntries).where(and(eq(ledgerEntries.kind, "charge"), gt(ledgerEntries.createdAt, prevMonth), lte(ledgerEntries.createdAt, month)));
  const paying = await db.select({ id: subscriptions.organizationId }).from(subscriptions).where(inArray(subscriptions.status, ["active", "grace"]));
  let monthlyKopSum = 0;
  for (const p of paying) monthlyKopSum += (await monthlyKop(p.id, db, now)).total;

  const [regs] = await db.select({ n: count() }).from(organizations).where(gt(organizations.createdAt, month));
  const [regsPrev] = await db.select({ n: count() }).from(organizations).where(and(gt(organizations.createdAt, prevMonth), lte(organizations.createdAt, month)));
  const byStatus = await db.select({ status: subscriptions.status, n: count() }).from(subscriptions).groupBy(subscriptions.status);
  // Trial → paid: businesses whose first charge was in the last 30 days.
  const [converted] = await db.execute<{ n: number }>(dsql`select count(*)::int as n from (select organization_id, min(created_at) as first from ${ledgerEntries} where kind = 'charge' group by 1) f where f.first > ${month.toISOString()}::timestamptz`);
  const [churned] = await db.select({ n: count() }).from(subscriptions).where(gt(subscriptions.suspendedAt, month));
  const funnel = await db.select({ status: leads.status, n: count() }).from(leads).where(gt(leads.createdAt, new Date(now.getTime() - 90 * DAY))).groupBy(leads.status);
  const modules = await db.select({ id: moduleInstalls.moduleId, n: count() }).from(moduleInstalls).groupBy(moduleInstalls.moduleId).orderBy(desc(count()));

  return {
    todo,
    numbers: {
      chargedKop: charged!.s,
      chargedPrevKop: chargedPrev!.s,
      monthlyKop: monthlyKopSum,
      paying: paying.length,
      registrations: regs!.n,
      registrationsPrev: regsPrev!.n,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
      converted: Number(converted?.n ?? 0),
      churned: churned!.n,
    },
    funnel: Object.fromEntries(funnel.map((f) => [f.status, f.n])),
    modules,
    risk: await churnRisk(now),
  };
}

/** The morning report to Ivan's Telegram: the same things as «Огляд», in a few lines. */
export async function morningText(now = new Date()) {
  const o = await overview(now);
  const uah = (kop: number) => `${Math.round(kop / 100).toLocaleString("uk-UA")} грн`;
  const since = new Date(now.getTime() - DAY);
  const [leadsDay] = await db.select({ n: count() }).from(leads).where(gt(leads.createdAt, since));
  const [regsDay] = await db.select({ n: count() }).from(organizations).where(gt(organizations.createdAt, since));
  const [topupsDay] = await db.select({ n: count(), s: dsql<number>`coalesce(sum(${ledgerEntries.amountKop}), 0)`.mapWith(Number) }).from(ledgerEntries).where(and(eq(ledgerEntries.kind, "topup"), gte(ledgerEntries.createdAt, since), lt(ledgerEntries.createdAt, now)));
  const todo: Record<string, string> = {
    leadsLate: "заявки без відповіді понад 4 год",
    leadsNew: "нові заявки",
    leadsRemind: "нагадування по заявках",
    deadlines: "дедлайни проєктів близько або минули",
    topups: "поповнення чекають підтвердження",
    tickets: "звернення чекають відповіді",
    sitesDown: "сайти клієнтів недоступні",
    grace: "бізнеси в пільгових днях",
    deletable: "можна видалити дані (90 днів призупинення)",
  };
  const lines = [
    "☀️ Ранковий звіт ONEKNIGHT",
    "",
    o.todo.length ? "Справи:" : "Справ немає.",
    ...o.todo.map((t) => `• ${todo[t.key]}: ${t.n}`),
    "",
    `За добу: заявок ${leadsDay!.n}, реєстрацій ${regsDay!.n}, поповнень ${topupsDay!.n} (${uah(topupsDay!.s)})`,
    `Списано за 30 днів: ${uah(o.numbers.chargedKop)}; щомісячно платять ${o.numbers.paying} (${uah(o.numbers.monthlyKop)})`,
    `Ризик відтоку: ${o.risk.length}`,
  ];
  return lines.join("\n");
}

/** Every morning at 09:00 Kyiv, once a day (checked hourly; a restart does not send it twice). */
export async function runMorningReport(send: (text: string) => Promise<boolean>, now = new Date()) {
  const day = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  if (kyiv(now).hour < 9) return false;
  const [s] = await db.select().from(platformState).where(eq(platformState.key, "morningReport"));
  if (s?.value === day) return false;
  if (!(await send(await morningText(now)))) return false;
  await db.insert(platformState).values({ key: "morningReport", value: day }).onConflictDoUpdate({ target: platformState.key, set: { value: day, updatedAt: now } });
  return true;
}
