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
