import type { Lang } from "@/config";
import { uk, type Dict } from "./uk";
import { en } from "./en";

const dicts: Record<Lang, Dict> = { uk, en };

export function getDict(lang: Lang): Dict {
  return dicts[lang];
}

/** Fills {placeholders}. Keeps prices out of copy: pass values from data/pricing.ts. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

export const localePrefix = (lang: Lang) => (lang === "uk" ? "" : "/en");
export const withLang = (lang: Lang, path: string) => `${localePrefix(lang)}${path === "/" ? "/" : path}`;
export type { Dict };

/** Plural word for a count: plural("uk", 2, { one: "візит", few: "візити", many: "візитів" }) -> "візити". */
export function plural(lang: Lang, n: number, forms: { one: string; few?: string; many?: string; other?: string }): string {
  const cat = new Intl.PluralRules(lang === "uk" ? "uk-UA" : "en-US").select(n);
  return (forms as Record<string, string | undefined>)[cat] ?? forms.other ?? forms.many ?? forms.few ?? forms.one;
}
