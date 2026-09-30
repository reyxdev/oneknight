import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { productCategories, productEvents, products } from "../db/schema.ts";
import { xmlDecode } from "../files/table.ts";

export const AVAILABILITY = ["in_stock", "to_order", "expected", "out"] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** One product from a file: only what the file had (an empty cell changes nothing). */
export type Row = {
  sku?: string;
  name?: string;
  priceKop?: number;
  oldPriceKop?: number | null;
  costKop?: number | null;
  stock?: number | null;
  availability?: Availability;
  orderDays?: number | null;
  lowStock?: number | null;
  category?: string[];
  description?: string;
  weightG?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  warrantyMonths?: number | null;
  photos?: string[];
  attributes?: { name: string; value: string }[];
  active?: boolean;
};

/** Columns of the template and the export; a file may use either the Ukrainian or the English header. */
export const COLUMNS = [
  ["sku", "Артикул", "sku"],
  ["name", "Назва", "name"],
  ["price", "Ціна", "price"],
  ["oldPrice", "Стара ціна", "old price"],
  ["cost", "Собівартість", "cost"],
  ["stock", "Залишок", "stock"],
  ["availability", "Наявність", "availability"],
  ["orderDays", "Днів під замовлення", "order days"],
  ["lowStock", "Поріг «закінчується»", "low stock"],
  ["category", "Категорія", "category"],
  ["description", "Опис", "description"],
  ["weight", "Вага, г", "weight"],
  ["length", "Довжина, см", "length"],
  ["width", "Ширина, см", "width"],
  ["height", "Висота, см", "height"],
  ["warranty", "Гарантія, міс.", "warranty"],
  ["photos", "Фото (посилання)", "photos"],
  ["attributes", "Характеристики", "attributes"],
  ["active", "На сайті", "on site"],
] as const;
type Key = (typeof COLUMNS)[number][0];

const norm = (s: string) => s.toLowerCase().replace(/[«»"',.()]/g, "").replace(/\s+/g, " ").trim();
const num = (s: string) => {
  if (!s.trim()) return null;
  const v = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const kop = (s: string) => {
  const v = num(s);
  return v === null || v > 10_000_000 ? null : Math.round(v * 100);
};
const int = (s: string, max = 1_000_000) => {
  const v = num(s);
  return v === null || v > max ? null : Math.round(v);
};

export function availabilityFrom(s: string): Availability | null {
  const v = norm(s);
  if (/^(в наявності|є в наявності|є|так|in stock|in_stock|available|\+)$/.test(v)) return "in_stock";
  if (/^(під замовлення|to order|to_order|preorder)/.test(v)) return "to_order";
  if (/^(очікується|expected|coming)/.test(v)) return "expected";
  if (/^(немає|нема|немає в наявності|ні|out|out of stock|-)$/.test(v)) return "out";
  return null;
}
const yes = (s: string) => /^(так|yes|1|true|\+|показувати)$/.test(norm(s)) ? true : /^(ні|no|0|false|-|приховати)$/.test(norm(s)) ? false : null;
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

/** Rows of a table (the first row is the header) → products; unknown columns are ignored. */
export function rowsFromTable(table: string[][]): { rows: { line: number; row: Row }[]; errors: { line: number; error: string }[] } {
  const head = (table[0] ?? []).map(norm);
  const index = new Map<Key, number>();
  for (const [key, uk, en] of COLUMNS) {
    const [u, e] = [norm(uk), norm(en)];
    const i = head.findIndex((h) => h === u || h === e || (h.length > 3 && (u.startsWith(h) || h.startsWith(`${u} `))));
    if (i >= 0) index.set(key, i);
  }
  const rows: { line: number; row: Row }[] = [];
  const errors: { line: number; error: string }[] = [];
  if (!index.has("name") && !index.has("sku")) return { rows, errors: [{ line: 1, error: "no_columns" }] };
  for (const [n, cells] of table.slice(1).entries()) {
    const line = n + 2;
    const get = (k: Key) => (index.has(k) ? (cells[index.get(k)!] ?? "").trim() : "");
    if (!cells.some((c) => c.trim())) continue;
    const r: Row = {};
    const bad = (error: string) => errors.push({ line, error });
    if (get("sku")) r.sku = get("sku").slice(0, 64);
    if (get("name")) r.name = get("name").slice(0, 200);
    if (get("price")) {
      const v = kop(get("price"));
      if (v === null) { bad("price"); continue; }
      r.priceKop = v;
    }
    if (get("oldPrice")) r.oldPriceKop = kop(get("oldPrice"));
    if (get("cost")) r.costKop = kop(get("cost"));
    if (get("stock")) r.stock = int(get("stock"));
    if (get("availability")) {
      const a = availabilityFrom(get("availability"));
      if (!a) { bad("availability"); continue; }
      r.availability = a;
    }
    if (get("orderDays")) r.orderDays = int(get("orderDays"), 365);
    if (get("lowStock")) r.lowStock = int(get("lowStock"));
    if (get("category")) r.category = get("category").split(/\s*[/>]\s*/).map((x) => x.trim().slice(0, 100)).filter(Boolean).slice(0, 4);
    if (get("description")) r.description = get("description").slice(0, 5000);
    if (get("weight")) r.weightG = int(get("weight"), 1_000_000);
    if (get("length")) r.lengthCm = int(get("length"), 1000);
    if (get("width")) r.widthCm = int(get("width"), 1000);
    if (get("height")) r.heightCm = int(get("height"), 1000);
    if (get("warranty")) r.warrantyMonths = int(get("warranty"), 240);
    if (get("photos")) r.photos = get("photos").split(/[\s,;]+/).filter(isUrl).slice(0, 10);
    if (get("attributes"))
      r.attributes = get("attributes")
        .split(/\s*;\s*/)
        .map((pair) => pair.split(/\s*:\s*/))
        .filter((x) => x.length >= 2 && x[0])
        .map(([name, ...v]) => ({ name: name!.slice(0, 100), value: v.join(":").slice(0, 300) }))
        .slice(0, 50);
    if (get("active")) {
      const v = yes(get("active"));
      if (v !== null) r.active = v;
    }
    rows.push({ line, row: r });
  }
  return { rows, errors };
}

const tag = (body: string, name: string) => {
  const m = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? xmlDecode(m[1]!).trim() : "";
};
const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? xmlDecode(m[1]!) : "";
};
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();

/**
 * Prom / Rozetka YML catalogue: <categories> and <offer> with name(_ua), price, oldprice / price_old, vendorCode,
 * quantity_in_stock, available, description(_ua), picture, param, weight (kg). The offer id is the article when
 * there is no vendorCode.
 */
export function rowsFromYml(xml: string): { rows: { line: number; row: Row }[]; errors: { line: number; error: string }[] } {
  const cats = new Map<string, { name: string; parent: string }>();
  for (const m of xml.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>/g)) cats.set(attr(m[1]!, "id"), { name: xmlDecode(m[2]!).trim(), parent: attr(m[1]!, "parentId") });
  const path = (id: string) => {
    const out: string[] = [];
    for (let c = cats.get(id), i = 0; c && i < 4; c = cats.get(c.parent), i++) out.unshift(c.name.slice(0, 100));
    return out;
  };
  const rows: { line: number; row: Row }[] = [];
  const errors: { line: number; error: string }[] = [];
  let n = 0;
  for (const m of xml.matchAll(/<offer\b([^>]*)>([\s\S]*?)<\/offer>/g)) {
    n++;
    if (n > 5000) break;
    const [attrs, body] = [m[1]!, m[2]!];
    const r: Row = {};
    const sku = tag(body, "vendorCode") || attr(attrs, "id");
    if (sku) r.sku = sku.slice(0, 64);
    const name = tag(body, "name_ua") || tag(body, "name");
    if (name) r.name = name.slice(0, 200);
    const price = kop(tag(body, "price"));
    if (price === null) {
      errors.push({ line: n, error: "price" });
      continue;
    }
    r.priceKop = price;
    const old = tag(body, "oldprice") || tag(body, "price_old");
    if (old) r.oldPriceKop = kop(old);
    const qty = tag(body, "quantity_in_stock") || tag(body, "quantity") || tag(body, "stock_quantity");
    if (qty) r.stock = int(qty);
    const available = attr(attrs, "available");
    if (available) r.availability = available === "false" ? "out" : "in_stock";
    const desc = tag(body, "description_ua") || tag(body, "description");
    if (desc) r.description = plain(desc).slice(0, 5000);
    const cat = tag(body, "categoryId");
    if (cat && cats.has(cat)) r.category = path(cat);
    const pics = [...body.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((p) => xmlDecode(p[1]!).trim()).filter(isUrl).slice(0, 10);
    if (pics.length) r.photos = pics;
    const params = [...body.matchAll(/<param\b([^>]*)>([\s\S]*?)<\/param>/g)].map((p) => ({ name: attr(p[1]!, "name").slice(0, 100), value: `${xmlDecode(p[2]!).trim()}${attr(p[1]!, "unit") ? ` ${attr(p[1]!, "unit")}` : ""}`.slice(0, 300) })).filter((p) => p.name && p.value);
    if (params.length) r.attributes = params.slice(0, 50);
    const w = num(tag(body, "weight"));
    if (w !== null) r.weightG = Math.round(w * 1000);
    rows.push({ line: n, row: r });
  }
  if (!n) errors.push({ line: 0, error: "no_offers" });
  return { rows, errors };
}

/** Finds or creates the category path («Одяг / Сукні») inside the site. */
async function categoryId(orgId: string, siteId: string, names: string[], cache: Map<string, string>) {
  let parent: string | null = null;
  for (const [i, name] of names.entries()) {
    const key = names.slice(0, i + 1).join("\u0000").toLowerCase();
    let id = cache.get(key);
    if (!id) {
      const [found] = await db
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(and(eq(productCategories.siteId, siteId), parent ? eq(productCategories.parentId, parent) : isNull(productCategories.parentId), eq(productCategories.name, name)))
        .limit(1);
      id = found?.id ?? (await db.insert(productCategories).values({ organizationId: orgId, siteId, parentId: parent, name }).returning({ id: productCategories.id }))[0]!.id;
      cache.set(key, id);
    }
    parent = id;
  }
  return parent;
}

/**
 * Applies (or, with `apply` false, only counts) the rows: a known article updates that product with the filled
 * cells, a new article or no article makes a new product (it needs a name and a price). Cost is taken only with
 * «Фінанси». Pictures are queued and downloaded in the background.
 */
export async function importRows(site: { id: string; organizationId: string }, parsed: ReturnType<typeof rowsFromTable>, opts: { apply: boolean; finance: boolean; userId: string }) {
  const skus = parsed.rows.map((r) => r.row.sku).filter((x): x is string => !!x);
  const known = new Map<string, typeof products.$inferSelect>();
  for (let i = 0; i < skus.length; i += 500) for (const p of await db.select().from(products).where(and(eq(products.siteId, site.id), inArray(products.sku, skus.slice(i, i + 500))))) known.set(p.sku!, p);
  const errors = [...parsed.errors];
  let created = 0;
  let updated = 0;
  let photos = 0;
  const cache = new Map<string, string>();
  const seen = new Set<string>();
  for (const { line, row } of parsed.rows) {
    if (!opts.finance) delete row.costKop;
    if (row.sku && seen.has(row.sku)) {
      errors.push({ line, error: "duplicate_sku" });
      continue;
    }
    if (row.sku) seen.add(row.sku);
    const cur = row.sku ? known.get(row.sku) : undefined;
    if (!cur && (!row.name || row.priceKop === undefined)) {
      errors.push({ line, error: "name_price" });
      continue;
    }
    if (row.availability === "to_order") row.stock = null;
    if (!opts.apply) {
      cur ? updated++ : created++;
      photos += row.photos?.length ?? 0;
      continue;
    }
    const catId = row.category?.length ? await categoryId(site.organizationId, site.id, row.category, cache) : undefined;
    const fields = {
      ...(row.name !== undefined ? { name: row.name } : {}),
      ...(row.priceKop !== undefined ? { priceKop: row.priceKop } : {}),
      ...(row.oldPriceKop !== undefined ? { oldPriceKop: row.oldPriceKop } : {}),
      ...(row.costKop !== undefined ? { costKop: row.costKop } : {}),
      ...(row.stock !== undefined ? { stock: row.stock } : {}),
      ...(row.availability !== undefined ? { availability: row.availability } : {}),
      ...(row.orderDays !== undefined ? { orderDays: row.orderDays } : {}),
      ...(row.lowStock !== undefined ? { lowStock: row.lowStock } : {}),
      ...(catId !== undefined ? { categoryId: catId } : {}),
      ...(row.description !== undefined ? { description: row.description } : {}),
      ...(row.weightG !== undefined ? { weightG: row.weightG } : {}),
      ...(row.lengthCm !== undefined ? { lengthCm: row.lengthCm } : {}),
      ...(row.widthCm !== undefined ? { widthCm: row.widthCm } : {}),
      ...(row.heightCm !== undefined ? { heightCm: row.heightCm } : {}),
      ...(row.warrantyMonths !== undefined ? { warrantyMonths: row.warrantyMonths } : {}),
      ...(row.attributes !== undefined ? { attributes: row.attributes } : {}),
      ...(row.active !== undefined ? { active: row.active } : {}),
    };
    if (cur) {
      // Pictures of a known product are added only when it has none (a repeated import does not pile them up).
      const pending = row.photos?.length && !cur.photos.length ? row.photos : undefined;
      await db.update(products).set({ ...fields, ...(pending ? { pendingPhotos: pending } : {}), updatedAt: new Date() }).where(eq(products.id, cur.id));
      const changes = Object.entries(fields).filter(([k, v]) => JSON.stringify((cur as Record<string, unknown>)[k]) !== JSON.stringify(v)).map(([field, to]) => ({ field, from: (cur as Record<string, unknown>)[field] ?? null, to }));
      if (changes.length) await db.insert(productEvents).values({ productId: cur.id, userId: opts.userId, kind: "import", changes });
      photos += pending?.length ?? 0;
      updated++;
    } else {
      const [p] = await db
        .insert(products)
        .values({ organizationId: site.organizationId, siteId: site.id, name: row.name!, priceKop: row.priceKop!, ...fields, sku: row.sku ?? null, pendingPhotos: row.photos ?? [] })
        .returning({ id: products.id });
      await db.insert(productEvents).values({ productId: p!.id, userId: opts.userId, kind: "import" });
      photos += row.photos?.length ?? 0;
      created++;
    }
  }
  return { created, updated, photos, errors: errors.slice(0, 50), errorCount: errors.length };
}
