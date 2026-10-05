/**
 * The portfolio calculator (owner's answers 119–135, 262–271, 301–308, 396–397, 401–412, 458–467): one rounded «≈»
 * price, −25% on the site and the logo only while discounted places are left, 50/50 payment.
 * Shared by the site (instant result) and the API (recomputes what a lead sends).
 */
export const SITE_KINDS = ["card", "service", "shop"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];
export const EXTRAS = ["logo", "ads", "seo", "support"] as const;
export type Extra = (typeof EXTRAS)[number];
export const SPRAVY = ["sto", "shop", "master", "usadba", "salon", "producer", "home", "cafe"] as const;
export type Sprava = (typeof SPRAVY)[number];

export type PortfolioPrices = {
  base: Record<SiteKind, number>;
  /** Added by the number of products: up to 20 · 100 · 500 · more (null = the price after a talk). */
  shopAdd: [number, number, number, number | null];
  /** Added by the number of services with prices: up to 10 · 30 · more. */
  serviceAdd: [number, number, number];
  /** One-off except `support` (monthly). */
  extras: Record<Extra, number>;
  discountPct: number;
  /** Shown as «≈ від …» for shops with more than 500 products. */
  bigShopFrom: number;
};

export const DEFAULT_PORTFOLIO_PRICES: PortfolioPrices = {
  base: { card: 7000, service: 12000, shop: 17000 },
  shopAdd: [0, 3000, 8000, null],
  serviceAdd: [0, 1500, 4000],
  extras: { logo: 1500, ads: 2000, seo: 2000, support: 1000 },
  discountPct: 25,
  bigShopFrom: 25000,
};

/** What each business type ticks by default (answers 301–308; Google Maps is always a gift). */
export const SPRAVA_PRESETS: Record<Sprava, { kind: SiteKind; extras: Extra[] }> = {
  sto: { kind: "service", extras: [] },
  shop: { kind: "shop", extras: ["ads"] },
  master: { kind: "card", extras: [] },
  usadba: { kind: "service", extras: ["ads"] },
  salon: { kind: "service", extras: [] },
  producer: { kind: "shop", extras: ["seo"] },
  home: { kind: "card", extras: ["ads"] },
  cafe: { kind: "service", extras: [] },
};

export type PortfolioInput = { kind: SiteKind; tier: number; extras: Extra[]; earn?: number | null };
export type PortfolioEstimate =
  | { big: true; from: number; monthly: number }
  | { big: false; total: number; full: number; save: number; monthly: number; first: number; second: number; payback: number | null };

const round100 = (n: number) => Math.round(n / 100) * 100;

export function tiersOf(kind: SiteKind): number {
  return kind === "shop" ? 4 : kind === "service" ? 3 : 1;
}

export function portfolioEstimate(p: PortfolioPrices, i: PortfolioInput, placesLeft: number): PortfolioEstimate {
  const tier = Math.max(0, Math.min(tiersOf(i.kind) - 1, Math.trunc(i.tier)));
  const has = (e: Extra) => i.extras.includes(e);
  const monthly = has("support") ? p.extras.support : 0;
  const add = i.kind === "shop" ? p.shopAdd[tier] : i.kind === "service" ? p.serviceAdd[tier] : 0;
  if (add === null) return { big: true, from: p.bigShopFrom, monthly };
  const site = p.base[i.kind] + (add ?? 0);
  const discountable = site + (has("logo") ? p.extras.logo : 0);
  const full = discountable + (has("ads") ? p.extras.ads : 0) + (has("seo") ? p.extras.seo : 0);
  const save = placesLeft > 0 ? round100((discountable * p.discountPct) / 100) : 0;
  const total = round100(full - save);
  const first = round100(total / 2);
  const earn = i.earn && i.earn > 0 ? i.earn : null;
  return { big: false, total, full: round100(full), save, monthly, first, second: total - first, payback: earn ? Math.ceil(total / earn) : null };
}

/** Ukrainian numbers only (answer 418): 0XX…, 380XX…, +380XX… with any spaces or dashes → +380XXXXXXXXX, else null. */
export function normalizeUaPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const n = d.length === 10 && d.startsWith("0") ? `38${d}` : d.length === 12 && d.startsWith("380") ? d : null;
  return n ? `+${n}` : null;
}

/** «Як вам зручніше?» (answer 416). */
export const CONTACT_WAYS = ["call", "viber", "telegram", "whatsapp"] as const;
export type ContactWay = (typeof CONTACT_WAYS)[number];
