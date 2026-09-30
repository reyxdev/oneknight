/**
 * Single source of truth for every price, shared by the site, the account and the API.
 * Do not repeat these numbers in copy: copy uses placeholders filled from here.
 */
export const websiteTypes = [
  { id: "card", from: 7000 },
  { id: "service", from: 12000 },
  { id: "shop", from: 14000 },
  { id: "corporate", from: 15000 },
] as const;

export type WebsiteTypeId = (typeof websiteTypes)[number]["id"];

export const oneknightPricing = {
  currency: "UAH",
  perMonth: 149,
  modulePerMonth: 99,
  /** Every website after the first one. */
  extraSitePerMonth: 149,
  /** A year paid ahead: 12 months for the price of 10 (ONEKNIGHT itself; modules stay monthly). */
  yearGiftMonths: 2,
  supportPerMonth: 1000,
  freeMonths: 3,
  freeModules: 5,
  supportResponseHours: 48,
  /** Grace period when the balance cannot cover a renewal (configurable within this range). */
  graceDaysMin: 3,
  graceDaysMax: 7,
} as const;

/**
 * The website calculator (owner's decisions H24–H26, draft of 30.09.2026): the base «від» price of the type, plus
 * the number of products, a design from scratch, extra languages and content filling; shown as a range «від — до».
 * The owner edits the numbers in the admin; the site and the server compute the same way.
 */
export type CalculatorConfig = {
  base: Record<WebsiteTypeId, number>;
  /** Tiers by the number of products or service pages: up to `max` (null = more) adds `add` UAH. */
  products: { max: number | null; add: number }[];
  customDesignPct: number;
  languagePct: number;
  /** Filling pages / products with content: per 10, capped. */
  contentPer10: number;
  contentMax: number;
  /** The upper end of the range: «до» = «від» + this %. */
  spreadPct: number;
};

export const DEFAULT_CALCULATOR: CalculatorConfig = {
  base: { card: 7000, service: 12000, shop: 14000, corporate: 15000 },
  products: [
    { max: 50, add: 0 },
    { max: 300, add: 3000 },
    { max: 1000, add: 6000 },
    { max: null, add: 10000 },
  ],
  customDesignPct: 30,
  languagePct: 20,
  contentPer10: 1500,
  contentMax: 10000,
  spreadPct: 30,
};

export type CalculatorInput = { siteType: WebsiteTypeId; products: string; design: "ready" | "custom"; languages: number; content: number };

/** `products` is the tier's `max` as text, or "more". Rounded to 100 UAH. */
export function estimateSite(c: CalculatorConfig, i: CalculatorInput) {
  const tier = c.products.find((t) => (t.max === null ? i.products === "more" : String(t.max) === i.products)) ?? c.products[0]!;
  const base = c.base[i.siteType] + tier.add;
  const design = i.design === "custom" ? (base * c.customDesignPct) / 100 : 0;
  const langs = (base * c.languagePct * Math.max(0, i.languages - 1)) / 100;
  const content = Math.min(c.contentMax, Math.ceil(Math.max(0, i.content) / 10) * c.contentPer10);
  const round = (x: number) => Math.round(x / 100) * 100;
  const from = round(base + design + langs + content);
  return { from, to: round(from * (1 + c.spreadPct / 100)) };
}
