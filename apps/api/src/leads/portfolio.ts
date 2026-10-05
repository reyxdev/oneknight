import type { FastifyPluginAsync } from "fastify";
import { and, count, eq, gt, gte, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { CONTACT_WAYS, EXTRAS, SITE_KINDS, SPRAVY, normalizeUaPhone, portfolioEstimate } from "@oneknight/domain";
import { db } from "../db/client.ts";
import { leads, platformState } from "../db/schema.ts";
import { notifyOwner, type TgButton } from "../notify/telegram.ts";
import { audit } from "../audit.ts";
import { portfolioSettings } from "../site/landing.ts";

/**
 * Leads from the portfolio (answers 161, 201–207, 404–420, 471–472): name, Ukrainian phone, how to reach,
 * about the business and the calculator's choices (the price is computed again here). They land in «Заявки» and in
 * the owner's Telegram with buttons that set the lead's state.
 */
const PER_PHONE_PER_DAY = 3;

const Calc = z.object({
  kind: z.enum(SITE_KINDS),
  tier: z.number().int().min(0).max(3),
  extras: z.array(z.enum(EXTRAS)).max(EXTRAS.length),
  earn: z.number().int().min(0).max(10_000_000).nullable().optional(),
  sprava: z.enum(SPRAVY).nullable(),
});
const Body = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(20),
  contact: z.enum(CONTACT_WAYS).default("call"),
  about: z.string().trim().max(1000).optional(),
  calc: Calc.optional(),
  locale: z.enum(["uk", "en"]).default("uk"),
  website: z.string().max(0).optional(),
});

export const SPRAVA_UK: Record<(typeof SPRAVY)[number], string> = { sto: "СТО", shop: "магазин", master: "майстер", usadba: "садиба", salon: "салон краси", producer: "виробник", home: "майстер на дім", cafe: "кафе" };
const KIND_UK = { card: "візитка", service: "сайт послуг", shop: "інтернет-магазин" } as const;
const EXTRA_UK = { logo: "логотип", ads: "налаштування реклами", seo: "SEO і GEO", support: "підтримка" } as const;
const CONTACT_UK = { call: "дзвінок", viber: "Viber", telegram: "Telegram", whatsapp: "WhatsApp" } as const;
/** States the owner sets from Telegram (answers 414, 471). */
export const TG_STATES = { contacted: "Передзвонив", no_answer: "Не додзвонився", thinking: "Думає", agreed: "Домовились", lost: "Відмова" } as const;
type TgState = keyof typeof TG_STATES;
const money = (n: number) => n.toLocaleString("uk-UA").replace(/ /g, " ");

export const leadButtons = (id: string): TgButton[][] => [
  [{ text: TG_STATES.contacted, callback_data: `lead:contacted:${id}` }, { text: TG_STATES.no_answer, callback_data: `lead:no_answer:${id}` }],
  [{ text: TG_STATES.thinking, callback_data: `lead:thinking:${id}` }, { text: TG_STATES.agreed, callback_data: `lead:agreed:${id}` }, { text: TG_STATES.lost, callback_data: `lead:lost:${id}` }],
];

export const portfolioLeadRoutes: FastifyPluginAsync = async (app) => {
  app.post("/portfolio", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const p = Body.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const b = p.data;
    const phone = normalizeUaPhone(b.phone);
    if (!phone) return reply.code(400).send({ error: "bad_phone" });
    // No captcha (answer 417): the hidden field above, and at most 3 requests from one number a day.
    const [n] = await db.select({ n: count() }).from(leads).where(and(eq(leads.phone, phone), gt(leads.createdAt, new Date(Date.now() - 86_400_000))));
    if ((n?.n ?? 0) >= PER_PHONE_PER_DAY) return reply.code(429).send({ error: "too_many_requests" });

    const s = await portfolioSettings();
    const estimate = b.calc ? portfolioEstimate(s.prices, b.calc, s.placesLeft) : null;
    const [lead] = await db
      .insert(leads)
      .values({
        name: b.name,
        phone,
        service: "website",
        siteType: b.calc?.kind ?? "unsure",
        brief: { origin: "portfolio", contact: b.contact, ...(b.about ? { about: b.about } : {}), ...(b.calc ? { calc: b.calc, estimate } : {}) },
        source: "site",
        locale: b.locale,
        ip: req.ip,
      })
      .returning({ id: leads.id, number: leads.number, createdAt: leads.createdAt });
    await audit(req, "lead.create", null, { lead: lead!.id, origin: "portfolio" });

    // What the owner sees in Telegram (answer 205): a tappable number, the business, the price, the text.
    const c = b.calc;
    const price = !estimate ? null : estimate.big ? `≈ від ${money(estimate.from)} грн (понад 500 товарів)` : `≈ ${money(estimate.total)} грн${estimate.save ? ` (знижка ${money(estimate.save)})` : ""}`;
    const text = [
      `Нова заявка #${lead!.number}${b.locale === "en" ? " · EN" : ""}`,
      `${b.name} · ${phone}`,
      `Зручніше: ${CONTACT_UK[b.contact]}`,
      ...(c ? [`Справа: ${c.sprava ? SPRAVA_UK[c.sprava] : "інше"} · ${KIND_UK[c.kind]}${c.extras.length ? ` + ${c.extras.map((e) => EXTRA_UK[e]).join(", ")}` : ""}`] : []),
      ...(price ? [`Ціна: ${price}`] : []),
      ...(c?.earn ? [`З клієнта: ${money(c.earn)} грн`] : []),
      ...(b.about ? ["", b.about.slice(0, 800)] : []),
    ].join("\n");
    // Browser tests name their leads «E2E …»: those never reach the owner's Telegram.
    void notifyOwner(text, req.log, { buttons: leadButtons(lead!.id), testContact: /E2E/.test(b.name) });
    return reply.code(201).send({ number: lead!.number });
  });
};

/** A button under a lead in the owner's Telegram: sets the state and notes it in the message. Owner's chat only. */
export async function handleLeadButton(data: string, chatId: string, ownerChatId: string | undefined) {
  const [, state, id] = data.split(":");
  if (!ownerChatId || chatId !== ownerChatId || !state || !(state in TG_STATES) || !/^[0-9a-f-]{36}$/.test(id ?? "")) return null;
  const [row] = await db.update(leads).set({ status: state as TgState, updatedAt: new Date(), lateNotified: true }).where(eq(leads.id, id!)).returning({ number: leads.number });
  return row ? { number: row.number, label: TG_STATES[state as TgState] } : null;
}

/** Owner's hours: every day 9:00–21:00 Kyiv (answer 208). Minutes of those hours between two moments. */
export function ownerMinutes(from: Date, to: Date, limit = 60) {
  let m = 0;
  for (let t = from.getTime(); t < to.getTime() && m < limit; t += 60_000) {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "numeric", hour12: false }).format(new Date(t)));
    if (h >= 9 && h < 21) m++;
  }
  return m;
}

/** A new portfolio lead without an answer for 1 working hour — once, to the owner's Telegram (answer 415). */
export async function runLeadNudges(send: (text: string) => Promise<boolean>, now = new Date()) {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.status, "new"), eq(leads.lateNotified, false), dsql`${leads.brief}->>'origin' = 'portfolio'`, gt(leads.createdAt, new Date(now.getTime() - 3 * 86_400_000))));
  let sent = 0;
  for (const l of rows) {
    if (ownerMinutes(l.createdAt, now) < 60) continue;
    await db.update(leads).set({ lateNotified: true }).where(eq(leads.id, l.id));
    if (await send(`⏰ Заявка #${l.number} (${l.name}, ${l.phone}) чекає вже годину`)) sent++;
  }
  return sent;
}

/** Sunday evening (20:00 Kyiv), once a week: leads of the week and how they went (answer 472). */
export async function runWeeklyLeads(send: (text: string) => Promise<boolean>, now = new Date()) {
  const kyiv = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const day = kyiv.find((x) => x.type === "weekday")?.value;
  const hour = Number(kyiv.find((x) => x.type === "hour")?.value);
  if (day !== "Sun" || hour < 20) return false;
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const [mark] = await db.select().from(platformState).where(eq(platformState.key, "portfolio_weekly"));
  if ((mark?.value as { day?: string } | undefined)?.day === today) return false;
  await db.insert(platformState).values({ key: "portfolio_weekly", value: { day: today } }).onConflictDoUpdate({ target: platformState.key, set: { value: { day: today }, updatedAt: now } });
  const week = await db.select({ status: leads.status, brief: leads.brief }).from(leads).where(and(gte(leads.createdAt, new Date(now.getTime() - 7 * 86_400_000)), dsql`${leads.brief}->>'origin' = 'portfolio'`));
  const by = (st: string) => week.filter((l) => l.status === st).length;
  const withCalc = week.filter((l) => !!(l.brief as { calc?: unknown }).calc).length;
  const text = [`📊 Тиждень на сайті`, `Заявок: ${week.length} (з розрахунком: ${withCalc})`, `Домовились: ${by("agreed")} · думають: ${by("thinking")} · відмова: ${by("lost")}`, `Ще без відповіді: ${by("new")}`].join("\n");
  return send(text);
}

