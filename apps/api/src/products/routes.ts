import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { orders, productCategories, productEvents, products, sites, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { Upload, saveImage } from "../files/store.ts";
import { readTable, writeXlsx } from "../files/table.ts";
import { AVAILABILITY, COLUMNS, importRows, rowsFromTable, rowsFromYml } from "./import.ts";
import { downloadPendingPhotos, publicFetch } from "./photos.ts";

type Product = typeof products.$inferSelect;
const uuid = z.string().uuid();
const DAY = 86_400_000;
/** «Закінчується» when no threshold is set on the product. */
export const DEFAULT_LOW_STOCK = 2;
const MAX_PHOTOS = 10;

/** What the buyer sees: a tracked product that ran out is «Немає» even if marked «В наявності». */
export function stateOf(p: Pick<Product, "availability" | "stock">) {
  return p.availability === "in_stock" && p.stock !== null && p.stock <= 0 ? "out" : p.availability;
}
/** Only «В наявності» and «Під замовлення» can be ordered (owner's decision: «Очікується» is only shown). */
export const orderable = (p: Pick<Product, "availability" | "stock">) => ["in_stock", "to_order"].includes(stateOf(p));
export const isLow = (p: Pick<Product, "stock" | "lowStock" | "availability">) => p.availability === "in_stock" && p.stock !== null && p.stock > 0 && p.stock <= (p.lowStock ?? DEFAULT_LOW_STOCK);

const money = z.number().min(0).max(10_000_000);
const ProductIn = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  price: money,
  oldPrice: money.nullable().optional(),
  cost: money.nullable().optional(),
  sku: z.string().trim().max(64).nullable().optional(),
  categoryId: uuid.nullable().optional(),
  availability: z.enum(AVAILABILITY).optional(),
  orderDays: z.number().int().min(1).max(365).nullable().optional(),
  stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  lowStock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  weightG: z.number().int().min(0).max(1_000_000).nullable().optional(),
  lengthCm: z.number().int().min(0).max(1000).nullable().optional(),
  widthCm: z.number().int().min(0).max(1000).nullable().optional(),
  heightCm: z.number().int().min(0).max(1000).nullable().optional(),
  warrantyMonths: z.number().int().min(0).max(240).nullable().optional(),
  attributes: z.array(z.object({ name: z.string().trim().min(1).max(100), value: z.string().trim().max(300) })).max(50).optional(),
  active: z.boolean().optional(),
  sort: z.number().int().optional(),
  photo: Upload.optional(),
});
type In = z.infer<typeof ProductIn>;

/** Request fields → columns (only those sent). Cost needs «Фінанси»; «Під замовлення» is not counted in stock. */
function columns(p: Partial<In>, finance: boolean) {
  const kop = (v: number | null | undefined) => (v === null || v === undefined ? v : Math.round(v * 100));
  const out: Partial<Product> = {};
  if (p.name !== undefined) out.name = p.name;
  if (p.description !== undefined) out.description = p.description;
  if (p.price !== undefined) out.priceKop = kop(p.price)!;
  if (p.oldPrice !== undefined) out.oldPriceKop = kop(p.oldPrice) ?? null;
  if (p.cost !== undefined && finance) out.costKop = kop(p.cost) ?? null;
  if (p.sku !== undefined) out.sku = p.sku || null;
  if (p.categoryId !== undefined) out.categoryId = p.categoryId;
  if (p.availability !== undefined) out.availability = p.availability;
  if (p.orderDays !== undefined) out.orderDays = p.orderDays;
  if (p.stock !== undefined) out.stock = p.stock;
  if (p.availability === "to_order") out.stock = null;
  for (const k of ["lowStock", "weightG", "lengthCm", "widthCm", "heightCm", "warrantyMonths"] as const) if (p[k] !== undefined) out[k] = p[k];
  if (p.attributes !== undefined) out.attributes = p.attributes;
  if (p.active !== undefined) out.active = p.active;
  if (p.sort !== undefined) out.sort = p.sort;
  return out;
}

const TRACKED = ["name", "description", "priceKop", "oldPriceKop", "costKop", "sku", "categoryId", "availability", "orderDays", "stock", "lowStock", "weightG", "lengthCm", "widthCm", "heightCm", "warrantyMonths", "attributes", "active"] as const;
function diff(cur: Product, next: Partial<Product>) {
  return TRACKED.filter((k) => k in next && JSON.stringify(cur[k] ?? null) !== JSON.stringify(next[k] ?? null)).map((field) => ({ field, from: cur[field] ?? null, to: next[field] ?? null }));
}

const photoUrl = (id: string) => `/api/files/${id}`;
/** A product for the panel; without «Фінанси» there is no cost (and no profit). */
function view(p: Product, finance: boolean, sold30 = 0) {
  const { costKop, pendingPhotos, ...rest } = p;
  return {
    ...rest,
    price: p.priceKop / 100,
    oldPrice: p.oldPriceKop === null ? null : p.oldPriceKop / 100,
    cost: finance && costKop !== null ? costKop / 100 : null,
    photo: p.photoFileId ? photoUrl(p.photoFileId) : null,
    photos: p.photos.map((id) => ({ id, url: photoUrl(id) })),
    photosLoading: pendingPhotos.length,
    state: stateOf(p),
    low: isLow(p),
    archived: !!p.archivedAt,
    sold30,
  };
}

/** Pieces sold per product (not cancelled or returned) since `since`. */
async function soldSince(orgId: string, since: Date, productId?: string) {
  const rows = await db.execute<{ pid: string; qty: number; revenue: number }>(dsql`
    select i->>'productId' as pid, sum((i->>'qty')::int)::int as qty, sum((i->>'qty')::int * (i->>'priceKop')::int)::bigint as revenue
    from ${orders}, jsonb_array_elements(${orders.items}) i
    where ${orders.organizationId} = ${orgId} and ${orders.isExample} = false and ${orders.createdAt} > ${since.toISOString()}::timestamptz
      and ${orders.status} not in ('cancelled', 'returned') ${productId ? dsql`and i->>'productId' = ${productId}` : dsql``}
    group by 1`);
  return new Map([...rows].map((r) => [r.pid, { qty: Number(r.qty), revenueKop: Number(r.revenue) }]));
}

/** /api/shop: the catalogue of each site (right `products`). */
export const productRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  async function member(req: FastifyRequest) {
    const m = await activeMembership(req);
    return m && m.permissions.includes("products") ? { org: m.orgId, finance: m.permissions.includes("finance"), userId: req.auth!.user.id } : null;
  }
  async function ownSite(req: FastifyRequest, siteId: string) {
    const m = await member(req);
    if (!m || !uuid.safeParse(siteId).success) return null;
    const [s] = await db.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.organizationId, m.org))).limit(1);
    return s ? { site: s, ...m } : null;
  }
  async function ownProduct(req: FastifyRequest, id: string) {
    const m = await member(req);
    if (!m || !uuid.safeParse(id).success) return null;
    const [p] = await db.select().from(products).where(and(eq(products.id, id), eq(products.organizationId, m.org))).limit(1);
    return p ? { p, ...m } : null;
  }
  const validCategory = async (siteId: string, id: string | null | undefined) => !id || !!(await db.select({ id: productCategories.id }).from(productCategories).where(and(eq(productCategories.id, id), eq(productCategories.siteId, siteId)))).length;
  const skuTaken = async (siteId: string, sku: string | null | undefined, except?: string) =>
    !!sku && !!(await db.select({ id: products.id }).from(products).where(and(eq(products.siteId, siteId), eq(products.sku, sku), except ? dsql`${products.id} <> ${except}` : undefined))).length;

  /** The list: active products, or the archive (`archived=1`); with pieces sold in 30 days. */
  app.get<{ Params: { siteId: string }; Querystring: { archived?: string } }>("/sites/:siteId/products", async (req, reply) => {
    const a = await ownSite(req, req.params.siteId);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.siteId, a.site.id), req.query.archived === "1" ? isNotNull(products.archivedAt) : isNull(products.archivedAt)))
      .orderBy(asc(products.sort), desc(products.createdAt));
    const sold = await soldSince(a.org, new Date(Date.now() - 30 * DAY));
    return rows.map((p) => view(p, a.finance, sold.get(p.id)?.qty ?? 0));
  });

  app.post<{ Params: { siteId: string } }>("/sites/:siteId/products", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const a = await ownSite(req, req.params.siteId);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const p = ProductIn.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!(await validCategory(a.site.id, p.data.categoryId))) return reply.code(400).send({ error: "invalid_input" });
    if (await skuTaken(a.site.id, p.data.sku)) return reply.code(409).send({ error: "sku_taken" });
    let photoFileId: string | null = null;
    if (p.data.photo) {
      const f = await saveImage(p.data.photo, { organizationId: a.org, uploaderId: a.userId, isPublic: true });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      photoFileId = f.file.id;
    }
    const [row] = await db
      .insert(products)
      .values({ organizationId: a.org, siteId: a.site.id, ...(columns(p.data, a.finance) as { name: string; priceKop: number }), photoFileId, photos: photoFileId ? [photoFileId] : [] })
      .returning();
    await db.insert(productEvents).values({ productId: row!.id, userId: a.userId, kind: "created" });
    await audit(req, "product.create", a.userId, { product: row!.id }, a.org);
    return reply.code(201).send(view(row!, a.finance));
  });

  /** The card: the product, its sales (pieces for everyone, money with «Фінанси») and its history. */
  app.get<{ Params: { id: string } }>("/products/:id", async (req, reply) => {
    const a = await ownProduct(req, req.params.id);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const all = (await soldSince(a.org, new Date(0), a.p.id)).get(a.p.id) ?? { qty: 0, revenueKop: 0 };
    const month = (await soldSince(a.org, new Date(Date.now() - 30 * DAY), a.p.id)).get(a.p.id) ?? { qty: 0, revenueKop: 0 };
    const profit = (s: { qty: number; revenueKop: number }) => (a.p.costKop === null ? null : s.revenueKop - a.p.costKop * s.qty);
    const events = await db
      .select({ id: productEvents.id, kind: productEvents.kind, changes: productEvents.changes, at: productEvents.createdAt, by: users.name })
      .from(productEvents)
      .leftJoin(users, eq(users.id, productEvents.userId))
      .where(eq(productEvents.productId, a.p.id))
      .orderBy(desc(productEvents.createdAt))
      .limit(50);
    return {
      ...view(a.p, a.finance, month.qty),
      stats: {
        sold30: month.qty,
        soldAll: all.qty,
        ...(a.finance ? { revenue30Kop: month.revenueKop, revenueAllKop: all.revenueKop, profit30Kop: profit(month), profitAllKop: profit(all) } : {}),
      },
      // Cost changes are money: hidden without «Фінанси».
      events: events.map((e) => ({ ...e, changes: a.finance ? e.changes : e.changes.filter((c) => c.field !== "costKop") })).filter((e) => e.kind !== "edit" || e.changes.length),
      finance: a.finance,
    };
  });

  app.patch<{ Params: { id: string } }>("/products/:id", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const a = await ownProduct(req, req.params.id);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const p = ProductIn.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!(await validCategory(a.p.siteId, p.data.categoryId))) return reply.code(400).send({ error: "invalid_input" });
    if (await skuTaken(a.p.siteId, p.data.sku, a.p.id)) return reply.code(409).send({ error: "sku_taken" });
    const next = columns(p.data, a.finance);
    if (p.data.photo) {
      if (a.p.photos.length >= MAX_PHOTOS) return reply.code(400).send({ error: "too_many_photos" });
      const f = await saveImage(p.data.photo, { organizationId: a.org, uploaderId: a.userId, isPublic: true });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      next.photos = [...a.p.photos, f.file.id];
      next.photoFileId = next.photos[0]!;
    }
    const changes = diff(a.p, next);
    const [row] = await db.update(products).set({ ...next, updatedAt: new Date() }).where(eq(products.id, a.p.id)).returning();
    if (changes.length) await db.insert(productEvents).values({ productId: a.p.id, userId: a.userId, kind: "edit", changes });
    return view(row!, a.finance);
  });

  /** Gallery order and removal: `ids` is the new order of the product's own photos (the first is the main one). */
  app.put<{ Params: { id: string } }>("/products/:id/photos", async (req, reply) => {
    const a = await ownProduct(req, req.params.id);
    const p = z.object({ ids: z.array(uuid).max(MAX_PHOTOS) }).safeParse(req.body);
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (!p.success || p.data.ids.some((id) => !a.p.photos.includes(id)) || new Set(p.data.ids).size !== p.data.ids.length) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(products).set({ photos: p.data.ids, photoFileId: p.data.ids[0] ?? null, updatedAt: new Date() }).where(eq(products.id, a.p.id)).returning();
    if (p.data.ids.length < a.p.photos.length) await db.insert(productEvents).values({ productId: a.p.id, userId: a.userId, kind: "edit", changes: [{ field: "photos", from: a.p.photos.length, to: p.data.ids.length }] });
    return view(row!, a.finance);
  });

  /** «Дублювати»: a copy without the article, hidden from the site until checked. */
  app.post<{ Params: { id: string } }>("/products/:id/duplicate", async (req, reply) => {
    const a = await ownProduct(req, req.params.id);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const { id: _id, createdAt: _c, updatedAt: _u, sku: _s, archivedAt: _a, ...copy } = a.p;
    const [row] = await db.insert(products).values({ ...copy, name: `${a.p.name} (копія)`.slice(0, 200), sku: null, active: false }).returning();
    await db.insert(productEvents).values({ productId: row!.id, userId: a.userId, kind: "duplicate", changes: [{ field: "from", from: a.p.id, to: a.p.name }] });
    return reply.code(201).send(view(row!, a.finance));
  });

  /** «В архів» / «Повернути з архіву»: an archived product is off the site and out of the lists. */
  app.post<{ Params: { id: string } }>("/products/:id/archive", async (req, reply) => {
    const a = await ownProduct(req, req.params.id);
    const p = z.object({ archived: z.boolean() }).safeParse(req.body);
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(products).set({ archivedAt: p.data.archived ? new Date() : null, updatedAt: new Date() }).where(eq(products.id, a.p.id)).returning();
    await db.insert(productEvents).values({ productId: a.p.id, userId: a.userId, kind: p.data.archived ? "archive" : "restore" });
    return view(row!, a.finance);
  });

  /** Deleting is only for a product no order has: otherwise it goes to the archive. */
  app.delete<{ Params: { id: string } }>("/products/:id", async (req, reply) => {
    const a = await ownProduct(req, req.params.id);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const [used] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.organizationId, a.org), dsql`${orders.items} @> ${JSON.stringify([{ productId: a.p.id }])}::jsonb`)).limit(1);
    if (used) return reply.code(409).send({ error: "has_orders" });
    await db.delete(products).where(eq(products.id, a.p.id));
    await audit(req, "product.delete", a.userId, { product: a.p.id, name: a.p.name }, a.org);
    return { ok: true };
  });

  /**
   * Chosen products at once: prices by a percentage (rounded to whole hryvnias; lowering can keep the old price
   * crossed out), a category, shown / hidden on the site, the archive.
   */
  const Bulk = z.object({
    ids: z.array(uuid).min(1).max(5000),
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("price"), percent: z.number().min(-90).max(500), keepOld: z.boolean().default(false) }),
      z.object({ kind: z.literal("category"), categoryId: uuid.nullable() }),
      z.object({ kind: z.literal("active"), value: z.boolean() }),
      z.object({ kind: z.literal("archive"), value: z.boolean() }),
    ]),
  });
  app.post<{ Params: { siteId: string } }>("/sites/:siteId/products/bulk", async (req, reply) => {
    const a = await ownSite(req, req.params.siteId);
    const p = Bulk.safeParse(req.body);
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const act = p.data.action;
    if (act.kind === "category" && !(await validCategory(a.site.id, act.categoryId))) return reply.code(400).send({ error: "invalid_input" });
    const rows = await db.select().from(products).where(and(eq(products.siteId, a.site.id), inArray(products.id, p.data.ids)));
    for (const cur of rows) {
      let next: Partial<Product> = {};
      if (act.kind === "price") {
        const priceKop = Math.max(0, Math.round((cur.priceKop * (1 + act.percent / 100)) / 100) * 100);
        next = { priceKop, ...(act.percent < 0 && act.keepOld ? { oldPriceKop: cur.oldPriceKop ?? cur.priceKop } : {}), ...(act.percent > 0 && cur.oldPriceKop !== null && cur.oldPriceKop <= priceKop ? { oldPriceKop: null } : {}) };
      } else if (act.kind === "category") next = { categoryId: act.categoryId };
      else if (act.kind === "active") next = { active: act.value };
      else next = { archivedAt: act.value ? new Date() : null };
      const changes = act.kind === "archive" ? [] : diff(cur, next);
      if (act.kind !== "archive" && !changes.length) continue;
      await db.update(products).set({ ...next, updatedAt: new Date() }).where(eq(products.id, cur.id));
      await db.insert(productEvents).values({ productId: cur.id, userId: a.userId, kind: act.kind === "archive" ? (act.value ? "archive" : "restore") : "bulk", changes });
    }
    await audit(req, "product.bulk", a.userId, { kind: act.kind, count: rows.length }, a.org);
    return { done: rows.length };
  });

  /** Categories with subcategories and the number of products (not archived) in each. */
  app.get<{ Params: { siteId: string } }>("/sites/:siteId/categories", async (req, reply) => {
    const a = await ownSite(req, req.params.siteId);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const cats = await db.select().from(productCategories).where(eq(productCategories.siteId, a.site.id)).orderBy(asc(productCategories.sort), asc(productCategories.name));
    const counts = await db
      .select({ id: products.categoryId, n: dsql<number>`count(*)`.mapWith(Number) })
      .from(products)
      .where(and(eq(products.siteId, a.site.id), isNull(products.archivedAt)))
      .groupBy(products.categoryId);
    const [arch] = await db.select({ n: dsql<number>`count(*)`.mapWith(Number) }).from(products).where(and(eq(products.siteId, a.site.id), isNotNull(products.archivedAt)));
    return {
      categories: cats.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, sort: c.sort, count: counts.find((x) => x.id === c.id)?.n ?? 0 })),
      none: counts.find((x) => x.id === null)?.n ?? 0,
      all: counts.reduce((s, x) => s + x.n, 0),
      archived: arch!.n,
    };
  });

  const CategoryIn = z.object({ name: z.string().trim().min(1).max(100), parentId: uuid.nullable().optional(), sort: z.number().int().optional() });
  app.post<{ Params: { siteId: string } }>("/sites/:siteId/categories", async (req, reply) => {
    const a = await ownSite(req, req.params.siteId);
    const p = CategoryIn.safeParse(req.body);
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (!p.success || !(await validCategory(a.site.id, p.data.parentId))) return reply.code(400).send({ error: "invalid_input" });
    const [c] = await db.insert(productCategories).values({ organizationId: a.org, siteId: a.site.id, name: p.data.name, parentId: p.data.parentId ?? null, sort: p.data.sort ?? 0 }).returning();
    return reply.code(201).send(c);
  });

  app.patch<{ Params: { id: string } }>("/categories/:id", async (req, reply) => {
    const m = await member(req);
    const p = CategoryIn.partial().safeParse(req.body);
    if (!m || !uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [c] = await db.select().from(productCategories).where(and(eq(productCategories.id, req.params.id), eq(productCategories.organizationId, m.org)));
    if (!c) return reply.code(404).send({ error: "not_found" });
    if (p.data.parentId) {
      // Not under itself or its own subcategory.
      for (let id: string | null = p.data.parentId; id; ) {
        if (id === c.id) return reply.code(400).send({ error: "invalid_input" });
        const [up] = await db.select({ parentId: productCategories.parentId, siteId: productCategories.siteId }).from(productCategories).where(eq(productCategories.id, id));
        if (!up || up.siteId !== c.siteId) return reply.code(400).send({ error: "invalid_input" });
        id = up.parentId;
      }
    }
    const [row] = await db.update(productCategories).set(p.data).where(eq(productCategories.id, c.id)).returning();
    return row;
  });

  /** Deleting a category: its products stay without a category, its subcategories move one level up. */
  app.delete<{ Params: { id: string } }>("/categories/:id", async (req, reply) => {
    const m = await member(req);
    if (!m || !uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    const [c] = await db.select().from(productCategories).where(and(eq(productCategories.id, req.params.id), eq(productCategories.organizationId, m.org)));
    if (!c) return reply.code(404).send({ error: "not_found" });
    await db.update(productCategories).set({ parentId: c.parentId }).where(eq(productCategories.parentId, c.id));
    await db.delete(productCategories).where(eq(productCategories.id, c.id));
    return { ok: true };
  });

  /**
   * Import from Excel (.xlsx or CSV) or a Prom / Rozetka YML file or link. `apply` false only counts what would
   * happen (new, updated, errors); the same request with `apply` true does it.
   */
  const ImportIn = z.object({ file: Upload.extend({ data: z.string().max(14_000_000) }).optional(), url: z.string().url().max(1000).optional(), apply: z.boolean() }).refine((x) => !!x.file !== !!x.url);
  app.post<{ Params: { siteId: string } }>("/sites/:siteId/products/import", { bodyLimit: 15 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const a = await ownSite(req, req.params.siteId);
    const p = ImportIn.safeParse(req.body);
    if (!a) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    let buf: Buffer;
    try {
      buf = p.data.file ? Buffer.from(p.data.file.data.replace(/^data:[^;]*;base64,/, ""), "base64") : await publicFetch(p.data.url!, 20 * 1024 * 1024);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error && e.message === "file_too_large" ? "file_too_large" : "fetch_failed" });
    }
    // .xlsx is a zip (its XML inside is not a YML catalogue).
    const zip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
    const text = buf.subarray(0, 512).toString("utf8");
    let parsed;
    try {
      parsed = !zip && /<yml_catalog|<offers|<\?xml/.test(text) ? rowsFromYml(buf.toString("utf8")) : rowsFromTable(readTable(buf));
    } catch {
      return reply.code(400).send({ error: "unreadable" });
    }
    if (parsed.rows.length > 5000) return reply.code(400).send({ error: "too_many_rows" });
    const r = await importRows(a.site, parsed, { apply: p.data.apply, finance: a.finance, userId: a.userId });
    if (p.data.apply) {
      await audit(req, "product.import", a.userId, { created: r.created, updated: r.updated, errors: r.errorCount }, a.org);
      if (r.photos) void downloadPendingPhotos(undefined, a.org).catch((e) => req.log.error(e));
    }
    return { ...r, total: parsed.rows.length };
  });

  const sheet = (rows: (string | number | null)[][], name: string, reply: import("fastify").FastifyReply) =>
    reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${name}"`)
      .send(writeXlsx(rows, "Товари"));

  /** Template for the import: the headers and one example row. */
  app.get("/products/template.xlsx", async (req, reply) => {
    if (!(await member(req))) return reply.code(403).send({ error: "forbidden" });
    return sheet(
      [
        COLUMNS.map((c) => c[1]),
        ["SV-001", "Свічка «Лаванда»", 350, 420, 120, 12, "в наявності", null, 3, "Декор / Свічки", "Соєвий віск, 40 годин горіння", 300, 8, 8, 10, null, "https://example.com/photo.jpg", "Аромат: лаванда; Об'єм: 200 мл", "так"],
      ],
      "oneknight-products-template.xlsx",
      reply,
    );
  });

  /** The site's catalogue as Excel in the import format (cost only with «Фінанси»). */
  app.get<{ Params: { siteId: string } }>("/sites/:siteId/products/export.xlsx", async (req, reply) => {
    const a = await ownSite(req, req.params.siteId);
    if (!a) return reply.code(404).send({ error: "not_found" });
    const cats = await db.select().from(productCategories).where(eq(productCategories.siteId, a.site.id));
    const path = (id: string | null) => {
      const out: string[] = [];
      for (let c = cats.find((x) => x.id === id), i = 0; c && i < 4; c = cats.find((x) => x.id === c!.parentId), i++) out.unshift(c.name);
      return out.join(" / ");
    };
    const avail = { in_stock: "в наявності", to_order: "під замовлення", expected: "очікується", out: "немає" } as Record<string, string>;
    const origin = `${req.protocol}://${req.headers.host}`;
    const rows = await db.select().from(products).where(and(eq(products.siteId, a.site.id), isNull(products.archivedAt))).orderBy(asc(products.sort), asc(products.name));
    const k = (v: number | null) => (v === null ? null : v / 100);
    await audit(req, "product.export", a.userId, { count: rows.length }, a.org);
    return sheet(
      [
        COLUMNS.map((c) => c[1]),
        ...rows.map((p) => [p.sku, p.name, k(p.priceKop), k(p.oldPriceKop), a.finance ? k(p.costKop) : null, p.stock, avail[p.availability] ?? p.availability, p.orderDays, p.lowStock, path(p.categoryId), p.description, p.weightG, p.lengthCm, p.widthCm, p.heightCm, p.warrantyMonths, p.photos.map((id) => `${origin}${photoUrl(id)}`).join(" "), p.attributes.map((x) => `${x.name}: ${x.value}`).join("; "), p.active ? "так" : "ні"]),
      ],
      `products-${new Date().toISOString().slice(0, 10)}.xlsx`,
      reply,
    );
  });
};

/** Products that are «Закінчується» / «Немає» (Home, «Що треба зробити»). */
export async function stockAlerts(orgId: string) {
  const [r] = await db
    .select({
      out: dsql<number>`count(*) filter (where ${products.availability} = 'in_stock' and ${products.stock} = 0)`.mapWith(Number),
      low: dsql<number>`count(*) filter (where ${products.availability} = 'in_stock' and ${products.stock} > 0 and ${products.stock} <= coalesce(${products.lowStock}, ${DEFAULT_LOW_STOCK}))`.mapWith(Number),
    })
    .from(products)
    .where(and(eq(products.organizationId, orgId), eq(products.active, true), isNull(products.archivedAt)));
  return r!;
}

