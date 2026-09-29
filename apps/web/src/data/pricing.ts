export { websiteTypes, oneknightPricing, type WebsiteTypeId } from "@oneknight/domain";

export function formatUAH(amount: number, lang: "uk" | "en"): string {
  const n = new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US").format(amount);
  return lang === "uk" ? `${n} грн` : `UAH ${n}`;
}
