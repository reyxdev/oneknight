import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { orderEvents, orders, products, sites } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope, type Permission } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { Upload, saveImage } from "../files/store.ts";
import { setOrderStatus } from "./service.ts";

const uuid = z.string().uuid();
const ProductIn = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  price: z.number().min(0).max(10_000_000),
  stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  active: z.boolean().optional(),
  sort: z.number().int().optional(),
  photo: Upload.optional(),
});
const OrderPatch = z.object({
  status: z.enum(["new", "confirmed", "paid", "shipped", "done", "cancelled"]).optional(),
  waybill: z.string().trim().max(60).nullable().optional(),
  warranty: z.object({ enabled: z.boolean(), until: z.string().max(40).optional(), note: z.string().max(500).optional() }).optional(),
});

const view = (p: typeof products.$inferSelect) => ({ ...p, price: p.priceKop / 100, photo: p.photoFileId ? `/api/files/${p.photoFileId}` : null });

/** Account shop: /api/shop. Every query is limited to the user's organizations. */
export const shopRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  async function ownSite(req: FastifyRequest, siteId: string, perm: Permission) {
    if (!uuid.safeParse(siteId).success) return null;
    const orgs = await orgScope(req, perm);
    if (!orgs.length) return null;
    const [s] = await db.select().from(sites).where(and(eq(sites.id, siteId), inArray(sites.organizationId, orgs))).limit(1);
    return s ?? null;
  }
  async function ownProduct(req: FastifyRequest, id: string) {
    if (!uuid.safeParse(id).success) return null;
    const orgs = await orgScope(req, "products");
    if (!orgs.length) return null;
    const [p] = await db.select().from(products).where(and(eq(products.id, id), inArray(products.organizationId, orgs))).limit(1);
    return p ?? null;
  }

  app.get<{ Params: { siteId: string } }>("/sites/:siteId/products", async (req, reply) => {
    const site = await ownSite(req, req.params.siteId, "products");
    if (!site) return reply.code(404).send({ error: "not_found" });
    const rows = await db.select().from(products).where(eq(products.siteId, site.id)).orderBy(asc(products.sort), desc(products.createdAt));
    return rows.map(view);
  });

  app.post<{ Params: { siteId: string } }>("/sites/:siteId/products", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const site = await ownSite(req, req.params.siteId, "products");
    if (!site) return reply.code(404).send({ error: "not_found" });
    const p = ProductIn.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    let photoFileId: string | null = null;
    if (p.data.photo) {
      const f = await saveImage(p.data.photo, { organizationId: site.organizationId, uploaderId: req.auth!.user.id, isPublic: true });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      photoFileId = f.file.id;
    }
    const [row] = await db
      .insert(products)
      .values({ organizationId: site.organizationId, siteId: site.id, name: p.data.name, description: p.data.description ?? "", priceKop: Math.round(p.data.price * 100), stock: p.data.stock ?? null, active: p.data.active ?? true, sort: p.data.sort ?? 0, photoFileId })
      .returning();
    await audit(req, "product.create", req.auth!.user.id, { product: row!.id }, site.organizationId);
    return reply.code(201).send(view(row!));
  });

  app.patch<{ Params: { id: string } }>("/products/:id", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const cur = await ownProduct(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    const p = ProductIn.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    let photoFileId = cur.photoFileId;
    if (p.data.photo) {
      const f = await saveImage(p.data.photo, { organizationId: cur.organizationId, uploaderId: req.auth!.user.id, isPublic: true });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      photoFileId = f.file.id;
    }
    const [row] = await db
      .update(products)
      .set({
        ...(p.data.name !== undefined ? { name: p.data.name } : {}),
        ...(p.data.description !== undefined ? { description: p.data.description } : {}),
        ...(p.data.price !== undefined ? { priceKop: Math.round(p.data.price * 100) } : {}),
        ...(p.data.stock !== undefined ? { stock: p.data.stock } : {}),
        ...(p.data.active !== undefined ? { active: p.data.active } : {}),
        ...(p.data.sort !== undefined ? { sort: p.data.sort } : {}),
        photoFileId,
        updatedAt: new Date(),
      })
      .where(eq(products.id, cur.id))
      .returning();
    return view(row!);
  });

  app.delete<{ Params: { id: string } }>("/products/:id", async (req, reply) => {
    const cur = await ownProduct(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    await db.delete(products).where(eq(products.id, cur.id));
    await audit(req, "product.delete", req.auth!.user.id, { product: cur.id }, cur.organizationId);
    return { ok: true };
  });

  app.get<{ Querystring: { status?: string } }>("/orders", async (req) => {
    const orgs = await orgScope(req, "orders");
    if (!orgs.length) return [];
    const st = z.enum(["new", "confirmed", "paid", "shipped", "done", "cancelled"]).safeParse(req.query.status);
    return db
      .select({ id: orders.id, number: orders.number, customerName: orders.customerName, totalKop: orders.totalKop, status: orders.status, createdAt: orders.createdAt, siteId: orders.siteId, source: orders.source })
      .from(orders)
      .where(and(inArray(orders.organizationId, orgs), st.success ? eq(orders.status, st.data) : undefined))
      .orderBy(desc(orders.createdAt))
      .limit(200);
  });

  app.get<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
    const orgs = await orgScope(req, "orders");
    if (!uuid.safeParse(req.params.id).success || !orgs.length) return reply.code(404).send({ error: "not_found" });
    const [o] = await db.select().from(orders).where(and(eq(orders.id, req.params.id), inArray(orders.organizationId, orgs)));
    if (!o) return reply.code(404).send({ error: "not_found" });
    const events = await db.select({ status: orderEvents.status, at: orderEvents.createdAt }).from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(asc(orderEvents.createdAt));
    const { ip: _ip, ...rest } = o;
    return { ...rest, events };
  });

  app.patch<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
    const p = OrderPatch.safeParse(req.body);
    const orgs = await orgScope(req, "orders");
    if (!p.success || !uuid.safeParse(req.params.id).success || !orgs.length) return reply.code(400).send({ error: "invalid_input" });
    if (p.data.status) {
      const r = await setOrderStatus(req.params.id, orgs, p.data.status, req.auth!.user.id);
      if (!r.ok) return reply.code(r.error === "not_found" ? 404 : 409).send({ error: r.error });
    }
    if (p.data.waybill !== undefined || p.data.warranty) {
      await db
        .update(orders)
        .set({ ...(p.data.waybill !== undefined ? { waybill: p.data.waybill } : {}), ...(p.data.warranty ? { warranty: p.data.warranty } : {}), updatedAt: new Date() })
        .where(and(eq(orders.id, req.params.id), inArray(orders.organizationId, orgs)));
    }
    return { ok: true };
  });

  /** Replace a site's public key (e.g. if it leaked into the wrong place). */
  app.post<{ Params: { siteId: string } }>("/sites/:siteId/rotate-key", async (req, reply) => {
    const site = await ownSite(req, req.params.siteId, "site");
    if (!site) return reply.code(404).send({ error: "not_found" });
    const key = `sk_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.update(sites).set({ publicKey: key }).where(eq(sites.id, site.id));
    await audit(req, "site.rotate_key", req.auth!.user.id, { site: site.id }, site.organizationId);
    return { publicKey: key };
  });
};
