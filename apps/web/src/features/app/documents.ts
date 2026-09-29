/**
 * Documents a business gives its customers: видаткова накладна, рахунок-фактура, гарантійний талон. Built from
 * the business's own requisites (never ONEKNIGHT's), printed by the browser (A4, «Зберегти як PDF»).
 */
export type Requisites = {
  kind: "fop" | "tov" | "person";
  name: string;
  code?: string;
  iban?: string;
  bank?: string;
  address?: string;
  phone?: string;
  email?: string;
  vat: boolean;
  vatNumber?: string;
  signer?: string;
  signature: string | null;
  stamp: string | null;
};
export type DocOrder = {
  number: number;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  items: { name: string; qty: number; priceKop: number }[];
  totalKop: number;
  delivery: { method: string; city?: string; branch?: string; address?: string };
  warranty: { enabled: boolean; until?: string; note?: string };
};
export type DocKind = "delivery-note" | "invoice" | "warranty";

const ONES_M = ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"];
const ONES_F = ["", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"];
const TEENS = ["десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять", "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять"];
const TENS = ["", "", "двадцять", "тридцять", "сорок", "п'ятдесят", "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"];
const HUNDREDS = ["", "сто", "двісті", "триста", "чотириста", "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот"];

/** «1 гривня», «2 гривні», «5 гривень», «11 гривень», «21 гривня». */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

function triple(n: number, feminine: boolean) {
  const out = [HUNDREDS[Math.floor(n / 100)]!];
  const r = n % 100;
  if (r >= 10 && r < 20) out.push(TEENS[r - 10]!);
  else out.push(TENS[Math.floor(r / 10)]!, (feminine ? ONES_F : ONES_M)[r % 10]!);
  return out.filter(Boolean).join(" ");
}

/** Whole number in Ukrainian words (up to billions); `feminine` for «гривня», «тисяча». */
export function numberInWords(n: number, feminine = true) {
  if (n === 0) return "нуль";
  const parts: string[] = [];
  const groups: [number, [string, string, string] | null, boolean][] = [
    [Math.floor(n / 1e9) % 1000, ["мільярд", "мільярди", "мільярдів"], false],
    [Math.floor(n / 1e6) % 1000, ["мільйон", "мільйони", "мільйонів"], false],
    [Math.floor(n / 1e3) % 1000, ["тисяча", "тисячі", "тисяч"], true],
    [n % 1000, null, feminine],
  ];
  for (const [v, forms, fem] of groups) {
    if (!v) continue;
    parts.push(triple(v, fem));
    if (forms) parts.push(plural(v, forms));
  }
  return parts.join(" ");
}

/** «Одна тисяча двісті п'ятдесят гривень 00 копійок» — the sum in words for documents. */
export function amountInWords(kop: number) {
  const uah = Math.floor(kop / 100);
  const k = kop % 100;
  const s = `${numberInWords(uah)} ${plural(uah, ["гривня", "гривні", "гривень"])} ${String(k).padStart(2, "0")} ${plural(k, ["копійка", "копійки", "копійок"])}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (kop: number) => (kop / 100).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (d: string | Date) => new Date(d).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" });
const METHODS: Record<string, string> = { novaposhta: "Нова пошта", ukrposhta: "Укрпошта", pickup: "Самовивіз", courier: "Кур'єр" };

function party(r: Requisites, withBank: boolean) {
  const kind = r.kind === "fop" ? "РНОКПП" : r.kind === "tov" ? "ЄДРПОУ" : "Код";
  return [
    `<b>${esc(r.name)}</b>`,
    r.code && `${kind}: ${esc(r.code)}`,
    r.vat && r.vatNumber && `ІПН платника ПДВ: ${esc(r.vatNumber)}`,
    !r.vat && "Не є платником ПДВ",
    withBank && r.iban && `IBAN: ${esc(r.iban)}${r.bank ? `, ${esc(r.bank)}` : ""}`,
    r.address && esc(r.address),
    [r.phone, r.email].filter(Boolean).map(esc).join(", "),
  ]
    .filter(Boolean)
    .join("<br>");
}

function sign(r: Requisites, role: string) {
  return `<div class="sign"><span>${esc(role)}</span><span class="line">${r.signature ? `<img class="sig" src="${esc(r.signature)}" alt="">` : ""}${r.stamp ? `<img class="stamp" src="${esc(r.stamp)}" alt="">` : ""}</span><span>${esc(r.signer ?? "")}</span></div>`;
}

function itemsTable(o: DocOrder, r: Requisites) {
  const rows = o.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="c">шт.</td><td class="r">${i.qty}</td><td class="r">${money(i.priceKop)}</td><td class="r">${money(i.priceKop * i.qty)}</td></tr>`).join("");
  // Prices include VAT: its part is 1/6 of the sum (20%).
  const vat = r.vat ? `<tr><td colspan="5" class="r">У тому числі ПДВ 20%:</td><td class="r">${money(Math.round(o.totalKop / 6))}</td></tr>` : `<tr><td colspan="5" class="r">Без ПДВ</td><td></td></tr>`;
  return `<table><thead><tr><th>№</th><th>Товар</th><th>Од.</th><th>К-сть</th><th>Ціна, грн</th><th>Сума, грн</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="5" class="r">Разом:</td><td class="r">${money(o.totalKop)}</td></tr>${vat}</tbody></table><p>Всього на суму: <b>${esc(amountInWords(o.totalKop))}</b></p>`;
}

const STYLE = `
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { font: 11pt/1.45 "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 4mm; }
.meta { color: #444; margin: 0 0 6mm; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-bottom: 6mm; }
.parties h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; color: #666; margin: 0 0 1.5mm; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0; }
th, td { border: 1px solid #999; padding: 1.6mm 2mm; vertical-align: top; }
th { background: #f1f1f1; font-weight: 600; text-align: left; }
.r { text-align: right; white-space: nowrap; } .c { text-align: center; }
.total td { font-weight: 700; }
.signs { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 12mm; }
.sign { display: grid; gap: 1mm; }
.sign .line { position: relative; height: 22mm; border-bottom: 1px solid #111; }
.sign .sig { position: absolute; left: 4mm; bottom: 1mm; max-height: 16mm; max-width: 40mm; }
.sign .stamp { position: absolute; left: 30mm; bottom: -8mm; max-height: 36mm; max-width: 36mm; opacity: .9; }
.note { border: 1px solid #999; padding: 3mm; margin-top: 4mm; }
.sign > span { min-height: 1.45em; }
th:first-child { width: 8mm; }
td.r, th:nth-child(n+3) { width: 1%; white-space: nowrap; }
@media screen { body { max-width: 190mm; margin: 12mm auto; padding: 0 6mm; } }
`;

/** Full HTML page of one document, ready for printing. */
export function renderDocument(kind: DocKind, o: DocOrder, r: Requisites) {
  const buyer = `<b>${esc(o.customerName)}</b><br>${esc(o.customerPhone)}${o.delivery.city ? `<br>${esc([METHODS[o.delivery.method] ?? o.delivery.method, o.delivery.city, o.delivery.branch, o.delivery.address].filter(Boolean).join(", "))}` : ""}`;
  let title = "";
  let body = "";
  if (kind === "delivery-note") {
    title = `Видаткова накладна № ${o.number}`;
    body = `<h1>${title}</h1><p class="meta">від ${date(o.createdAt)}</p>
      <div class="parties"><div><h2>Постачальник</h2>${party(r, true)}</div><div><h2>Покупець</h2>${buyer}</div></div>
      ${itemsTable(o, r)}
      <div class="signs">${sign(r, "Відвантажив(ла)")}<div class="sign"><span>Отримав(ла)</span><span class="line"></span><span>${esc(o.customerName)}</span></div></div>`;
  } else if (kind === "invoice") {
    title = `Рахунок-фактура № ${o.number}`;
    body = `<h1>${title}</h1><p class="meta">від ${date(o.createdAt)}</p>
      <div class="parties"><div><h2>Постачальник</h2>${party(r, true)}</div><div><h2>Платник</h2>${buyer}</div></div>
      ${itemsTable(o, r)}
      <p>Призначення платежу: <b>Оплата за рахунком № ${o.number} від ${date(o.createdAt)}${r.vat ? `, у т.ч. ПДВ ${money(Math.round(o.totalKop / 6))} грн` : ", без ПДВ"}</b></p>
      <div class="signs">${sign(r, "Виписав(ла)")}<div></div></div>`;
  } else {
    title = `Гарантійний талон до замовлення № ${o.number}`;
    body = `<h1>Гарантійний талон</h1><p class="meta">до замовлення № ${o.number} від ${date(o.createdAt)}</p>
      <div class="parties"><div><h2>Продавець</h2>${party(r, false)}</div><div><h2>Покупець</h2>${buyer}</div></div>
      <table><thead><tr><th>№</th><th>Товар</th><th>К-сть</th></tr></thead><tbody>${o.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="r">${i.qty}</td></tr>`).join("")}</tbody></table>
      <div class="note"><b>Гарантія${o.warranty.until ? ` до ${date(o.warranty.until)}` : ""}.</b>${o.warranty.note ? `<br>${esc(o.warranty.note)}` : ""}</div>
      <div class="signs">${sign(r, "Продавець")}<div class="sign"><span>Покупець</span><span class="line"></span><span>${esc(o.customerName)}</span></div></div>`;
  }
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

/** Opens the document in a new tab and the print dialog (images load first). */
export function printDocument(html: string) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  const go = () => setTimeout(() => w.print(), 150);
  if (w.document.readyState === "complete") go();
  else w.addEventListener("load", go);
  return true;
}
