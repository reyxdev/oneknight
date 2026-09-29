/**
 * Single source of truth for every public price. Do not repeat these numbers in copy:
 * copy uses placeholders that are filled from here.
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
  supportPerMonth: 1000,
  freeMonths: 3,
  freeModules: 5,
  supportResponseHours: 48,
} as const;

export function formatUAH(amount: number, lang: "uk" | "en"): string {
  const n = new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US").format(amount);
  return lang === "uk" ? `${n} грн` : `UAH ${n}`;
}
