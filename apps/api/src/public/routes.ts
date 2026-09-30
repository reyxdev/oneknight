import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { productCategories, products, sites } from "../db/schema.ts";
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

  app.get("/products", { preHandler: siteByKey }, async (req) => {
    const rows = await db.select().from(products).where(and(eq(products.siteId, req.site!.id), eq(products.active, true), isNull(products.archivedAt))).orderBy(asc(products.sort), asc(products.createdAt));
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
  });

  /** Categories of the catalogue (a tree by `parentId`). */
  app.get("/categories", { preHandler: siteByKey }, async (req) => {
    const rows = await db.select().from(productCategories).where(eq(productCategories.siteId, req.site!.id)).orderBy(asc(productCategories.sort), asc(productCategories.name));
    return rows.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
  });

  app.post("/orders", { preHandler: siteByKey, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const p = Order.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const r = await placeOrder(req.site!, p.data, req.ip);
    if (!r.ok) return reply.code(409).send(r);
    await finishCarts(req.site!.organizationId, r.order.id, p.data.customer.phone, p.data.analytics?.session);
    if (p.data.analytics && (await hasModule(req.site!.organizationId, "analytics"))) await recordEvent(req.site!, "order", p.data.analytics, { valueKop: r.order.totalKop });
    return reply.code(201).send({ number: r.order.number, total: r.order.totalKop / 100, status: r.order.status });
  });
};
