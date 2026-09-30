import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, avg, count, desc, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { orders, productCategories, products, reviews, sites } from "../db/schema.ts";
import { isLow, orderable, stateOf } from "../products/routes.ts";
import { env } from "../config.ts";
import { placeOrder } from "../shop/service.ts";
import { reviewPublicRoutes } from "../reviews/routes.ts";
import { Context, analyticsPublicRoutes, recordEvent } from "../analytics/routes.ts";
import { hasModule } from "../billing/service.ts";
import { cartPublicRoutes, finishCarts } from "../carts/routes.ts";

type Site = typeof sites.$inferSelect;
declare module "fastify" {
  interface FastifyRequest {
    site?: Site;
  }
}

/** A site's own pages may call the public API from the browser: https://domain and https://www.domain. */
function originAllowed(origin: string, site: Site) {
  try {
    const u = new URL(origin);
    if (env.NODE_ENV !== "production" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    return u.protocol === "https:" && (u.hostname === site.domain || u.hostname === `www.${site.domain}`);
  } catch {
    return false;
  }
}

async function siteByKey(req: FastifyRequest, reply: FastifyReply) {
  const key = (req.headers["x-site-key"] as string | undefined) ?? (req.query as { key?: string }).key;
  if (!key || !/^sk_[0-9a-f]{32}$/.test(key)) return reply.code(401).send({ error: "invalid_site_key" });
  const [site] = await db.select().from(sites).where(eq(sites.publicKey, key)).limit(1);
  if (!site) return reply.code(401).send({ error: "invalid_site_key" });
  const origin = req.headers.origin;
  if (origin) {
    if (!originAllowed(origin, site)) return reply.code(403).send({ error: "bad_origin" });
    reply.header("access-control-allow-origin", origin).header("vary", "origin");
  }
  req.site = site;
  // Proof that ok.js is installed («Перші кроки»); written at most once an hour.
  if (!site.okSeenAt || Date.now() - site.okSeenAt.getTime() > 3_600_000) await db.update(sites).set({ okSeenAt: new Date() }).where(eq(sites.id, site.id));
}

const Order = z.object({
  customer: z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().regex(/^\+?[0-9\s()-]{9,20}$/), email: z.string().trim().email().max(254).optional().or(z.literal("")) }),
  items: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(99) })).min(1).max(50),
  delivery: z.object({ method: z.enum(["novaposhta", "ukrposhta", "pickup", "courier"]), city: z.string().max(100).optional(), branch: z.string().max(200).optional(), address: z.string().max(300).optional() }),
  payment: z.enum(["cod", "iban", "card"]),
  comment: z.string().max(1000).optional(),
  website: z.string().max(0).optional(),
  /** From the tracking script (window.oneknight.context()): ties the order to its traffic source. */
  analytics: Context.optional(),
});

/**
 * Public API for the client's website: /api/public/*. Authenticated by the site key (x-site-key header),
 * no cookies. Browsers may call it only from the site's own domain (CORS).
 */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  // Error answers (401, 403 bad_origin, 415, 429) carry the CORS header too, so the site's fetch reads the error code
  // instead of failing with a network error. Data itself never leaves: a foreign origin gets only 403.
  app.addHook("onSend", async (req, reply, payload) => {
    const origin = req.headers.origin;
    if (origin && !reply.getHeader("access-control-allow-origin")) reply.header("access-control-allow-origin", origin).header("vary", "origin");
    return payload;
  });
  app.options("/*", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) reply.header("access-control-allow-origin", origin).header("vary", "origin");
    return reply
      .header("access-control-allow-methods", "GET, POST")
      .header("access-control-allow-headers", "content-type, x-site-key")
      .header("access-control-max-age", "600")
      .code(204)
      .send();
  });

  await app.register(async (scoped) => {
    scoped.addHook("preHandler", siteByKey);
    await scoped.register(reviewPublicRoutes);
    await scoped.register(analyticsPublicRoutes);
    await scoped.register(cartPublicRoutes);
  });

  app.get("/products", { preHandler: siteByKey }, async (req) => catalogOf(req.site!.id));

  /**
   * What ok.js should switch on for this site (the site's settings; reviews need the module). Read by the
   * widgets loader after the page has loaded.
   */
  app.get("/widgets", { preHandler: siteByKey }, async (req) => {
    const st = req.site!.settings ?? {};
    const reviewsOn = await hasModule(req.site!.organizationId, "reviews");
    const on = !st.widgetsOff;
    return { socialProof: on && !!st.socialProof, reviews: on && reviewsOn && !!st.reviewsBlock, stars: on && reviewsOn && !!st.stars, poweredBy: !!st.poweredBy };
  });

  /**
   * «Соціальний доказ»: real orders of the site from the last 48 hours — the first name only, the city, one product
   * with its photo. Nothing when the widget is off.
   */
  app.get("/social-proof", { preHandler: siteByKey }, async (req) => {
    const st = req.site!.settings ?? {};
    if (st.widgetsOff || !st.socialProof) return [];
    const rows = await db
      .select({ name: orders.customerName, delivery: orders.delivery, items: orders.items, at: orders.createdAt })
      .from(orders)
      .where(and(eq(orders.siteId, req.site!.id), eq(orders.isExample, false), gt(orders.createdAt, new Date(Date.now() - 48 * 3_600_000)), notInArray(orders.status, ["cancelled", "returned"])))
      .orderBy(desc(orders.createdAt))
      .limit(10);
    const ids = [...new Set(rows.map((r) => r.items[0]?.productId).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/.test(x)))];
    const photos = ids.length ? await db.select({ id: products.id, photo: products.photoFileId }).from(products).where(and(eq(products.siteId, req.site!.id), inArray(products.id, ids))) : [];
    return rows
      .filter((r) => r.items[0])
      .map((r) => ({
        name: r.name.trim().split(/\s+/)[0]!.slice(0, 30),
        city: (r.delivery.city ?? "").split(",")[0]!.trim().slice(0, 40) || null,
        product: r.items[0]!.name,
        photo: photos.find((p) => p.id === r.items[0]!.productId)?.photo ? `/api/files/${photos.find((p) => p.id === r.items[0]!.productId)!.photo}` : null,
        minutes: Math.max(1, Math.round((Date.now() - r.at.getTime()) / 60_000)),
      }));
  });

  /** Rating of the site: the number of published reviews and the average (stars on the site). */
  app.get("/reviews/summary", { preHandler: siteByKey }, async (req, reply) => {
    if (!(await hasModule(req.site!.organizationId, "reviews"))) return reply.code(403).send({ error: "module_not_active" });
    const [r] = await db.select({ n: count(), avg: avg(reviews.rating) }).from(reviews).where(and(eq(reviews.siteId, req.site!.id), eq(reviews.status, "published")));
    return { count: r?.n ?? 0, average: r?.avg ? Math.round(Number(r.avg) * 10) / 10 : null };
  });

  /**
   * «Зірки для Google»: schema.org JSON-LD with the rating, to put into the page on the site's server
   * (<script type="application/ld+json">). Google decides itself whether to show stars.
   */
  app.get("/reviews/schema", { preHandler: siteByKey }, async (req, reply) => {
    if (!(await hasModule(req.site!.organizationId, "reviews"))) return reply.code(403).send({ error: "module_not_active" });
    const [r] = await db.select({ n: count(), avg: avg(reviews.rating) }).from(reviews).where(and(eq(reviews.siteId, req.site!.id), eq(reviews.status, "published")));
    const latest = await db.select().from(reviews).where(and(eq(reviews.siteId, req.site!.id), eq(reviews.status, "published"))).orderBy(desc(reviews.createdAt)).limit(5);
    const site = req.site!;
    return {
      "@context": "https://schema.org",
      "@type": "Store",
      name: site.name,
      url: `https://${site.domain}/`,
      ...(r && r.n > 0
        ? {
            aggregateRating: { "@type": "AggregateRating", ratingValue: Math.round(Number(r.avg) * 10) / 10, reviewCount: r.n, bestRating: 5, worstRating: 1 },
            review: latest.map((x) => ({ "@type": "Review", author: { "@type": "Person", name: x.authorName }, datePublished: x.createdAt.toISOString().slice(0, 10), reviewBody: x.text, reviewRating: { "@type": "Rating", ratingValue: x.rating, bestRating: 5, worstRating: 1 } })),
          }
        : {}),
    };
  });

  /** Categories of the catalogue (a tree by `parentId`). */
  app.get("/categories", { preHandler: siteByKey }, async (req) => categoriesOf(req.site!.id));

  app.post("/orders", { preHandler: siteByKey, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const r = await createSiteOrder(req.site!, req.body, req.ip);
    return reply.code(r.code).send(r.body);
  });
};

/** The catalogue a site shows: active products in the account's order (ok.js, the public API and /v1 alike). */
export async function catalogOf(siteId: string) {
    const rows = await db.select().from(products).where(and(eq(products.siteId, siteId), eq(products.active, true), isNull(products.archivedAt))).orderBy(asc(products.sort), asc(products.createdAt));
    // Cost, thresholds and the history never leave the account.
    return rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      price: p.priceKop / 100,
      oldPrice: p.oldPriceKop !== null && p.oldPriceKop > p.priceKop ? p.oldPriceKop / 100 : null,
      discountPercent: p.oldPriceKop !== null && p.oldPriceKop > p.priceKop ? Math.round((1 - p.priceKop / p.oldPriceKop) * 100) : null,
      /** in_stock · to_order · expected · out; only in_stock and to_order can be ordered. */
      availability: stateOf(p),
      orderDays: p.availability === "to_order" ? p.orderDays : null,
      inStock: orderable(p),
      stock: p.stock,
      /** «Залишилось N шт.». */
      fewLeft: isLow(p),
      photo: p.photoFileId ? `/api/files/${p.photoFileId}` : null,
      photos: p.photos.map((id) => `/api/files/${id}`),
      attributes: p.attributes,
      warrantyMonths: p.warrantyMonths,
      weightG: p.weightG,
    }));
}

export async function categoriesOf(siteId: string) {
  const rows = await db.select().from(productCategories).where(eq(productCategories.siteId, siteId)).orderBy(asc(productCategories.sort), asc(productCategories.name));
  return rows.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
}

/** An order from the site (the browser with the public key, or the site's server with the secret one). */
export async function createSiteOrder(site: typeof sites.$inferSelect, body: unknown, ip: string) {
  const p = Order.safeParse(body);
  if (!p.success) return { code: 400, body: { error: "invalid_input" } as object };
  const r = await placeOrder(site, p.data, ip);
  if (!r.ok) return { code: 409, body: r as object };
  await finishCarts(site.organizationId, r.order.id, p.data.customer.phone, p.data.analytics?.session);
  if (p.data.analytics && (await hasModule(site.organizationId, "analytics"))) await recordEvent(site, "order", p.data.analytics, { valueKop: r.order.totalKop });
  return { code: 201, body: { number: r.order.number, total: r.order.totalKop / 100, status: r.order.status } as object };
}
