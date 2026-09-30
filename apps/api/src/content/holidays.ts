/**
 * Holidays and trading dates of the plan. A rule gives the date in a year:
 *   fixed:MM-DD · easter · easter+N (Easter by the Julian paschalion, as kept in Ukraine) · nth:M:W:N (the N-th
 *   weekday W of month M, W 0 = Sunday) · blackfriday (the day after the 4th Thursday of November).
 * kind: sale — gifts and offers are fine; greeting — only a greeting; respect — a day of memory, nothing is sold.
 */
export const HOLIDAYS: { key: string; name: string; rule: string; kind: "sale" | "greeting" | "respect"; prepDays: number }[] = [
  { key: "new-year", name: "Новий рік", rule: "fixed:01-01", kind: "sale", prepDays: 14 },
  { key: "valentine", name: "День закоханих", rule: "fixed:02-14", kind: "sale", prepDays: 12 },
  { key: "women", name: "8 березня", rule: "fixed:03-08", kind: "sale", prepDays: 12 },
  { key: "easter", name: "Великдень", rule: "easter", kind: "sale", prepDays: 10 },
  { key: "trinity", name: "Трійця", rule: "easter+49", kind: "greeting", prepDays: 2 },
  { key: "remembrance", name: "День пам'яті та перемоги над нацизмом", rule: "fixed:05-08", kind: "respect", prepDays: 1 },
  { key: "mothers", name: "День матері", rule: "nth:5:0:2", kind: "sale", prepDays: 10 },
  { key: "fathers", name: "День батька", rule: "nth:6:0:3", kind: "sale", prepDays: 10 },
  { key: "constitution", name: "День Конституції України", rule: "fixed:06-28", kind: "greeting", prepDays: 2 },
  { key: "statehood", name: "День Української Державності", rule: "fixed:07-15", kind: "greeting", prepDays: 2 },
  { key: "flag", name: "День Державного Прапора", rule: "fixed:08-23", kind: "greeting", prepDays: 2 },
  { key: "independence", name: "День Незалежності України", rule: "fixed:08-24", kind: "greeting", prepDays: 3 },
  { key: "knowledge", name: "1 вересня", rule: "fixed:09-01", kind: "sale", prepDays: 14 },
  { key: "defenders", name: "День захисників і захисниць України", rule: "fixed:10-01", kind: "respect", prepDays: 1 },
  { key: "halloween", name: "Гелловін", rule: "fixed:10-31", kind: "sale", prepDays: 7 },
  { key: "language", name: "День української писемності та мови", rule: "fixed:11-09", kind: "greeting", prepDays: 2 },
  { key: "blackfriday", name: "Чорна п'ятниця", rule: "blackfriday", kind: "sale", prepDays: 10 },
  { key: "nicholas", name: "День святого Миколая", rule: "fixed:12-06", kind: "sale", prepDays: 14 },
  { key: "christmas", name: "Різдво", rule: "fixed:12-25", kind: "sale", prepDays: 14 },
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Easter by the Julian paschalion, as a Gregorian date (valid 1900–2099: +13 days). */
export function easter(year: number) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const g = new Date(Date.UTC(year, month - 1, day + 13));
  return iso(g.getUTCFullYear(), g.getUTCMonth() + 1, g.getUTCDate());
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The date of a rule in a year, or null for a rule that cannot be read. */
export function holidayDate(rule: string, year: number): string | null {
  if (rule.startsWith("fixed:")) {
    const m = rule.match(/^fixed:(\d{2})-(\d{2})$/);
    return m ? `${year}-${m[1]}-${m[2]}` : null;
  }
  if (rule === "easter") return easter(year);
  const e = rule.match(/^easter\+(\d{1,3})$/);
  if (e) return addDays(easter(year), Number(e[1]));
  const n = rule.match(/^nth:(\d{1,2}):([0-6]):([1-5])$/);
  if (n) {
    const [month, weekday, nth] = [Number(n[1]), Number(n[2]), Number(n[3])];
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return iso(year, month, 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7);
  }
  if (rule === "blackfriday") {
    const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    const thursday4 = 1 + ((4 - first + 7) % 7) + 21;
    return iso(year, 11, thursday4 + 1);
  }
  return null;
}

/** Holidays that fall into [from, to] (both inclusive, YYYY-MM-DD), with their dates. */
export function holidaysBetween<T extends { rule: string }>(list: T[], from: string, to: string) {
  const out: (T & { date: string })[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    for (const h of list) {
      const date = holidayDate(h.rule, y);
      if (date && date >= from && date <= to) out.push({ ...h, date });
    }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
