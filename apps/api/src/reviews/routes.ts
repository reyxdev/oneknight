import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { files, notifications, orders, products, reviews, sites } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { Upload, saveImage } from "../files/store.ts";
import { audit } from "../audit.ts";

export const TRASH_DAYS = 30;
const uuid = z.string().uuid();
const digits = (s: string) => s.replace(/\D/g, "").slice(-9);

const NewReview = z.object({
  name: z.string().trim().min(2).max(100),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(3).max(3000),
  consent: z.boolean(),
  productId: z.string().uuid().optional(),
  photo: Upload.optional(),
  videoUrl: z.string().url().max(500).refine((u) => u.startsWith("https://"), "https only").optional(),
  /** Proof of purchase: order number + the phone used in that order. */
  orderNumber: z.number().int().positive().optional(),
  phone: z.string().max(30).optional(),
  website: z.string().max(0).optional(),
});

const publicView = (r: typeof reviews.$inferSelect & { productName?: string | null }) => ({
  id: r.id,
  name: r.authorName,
  rating: r.rating,
  text: r.text,
  verified: r.verified,
  product: r.productId ? { id: r.productId, name: r.productName ?? null } : null,
  photo: r.photoFileId ? `/api/files/${r.photoFileId}` : null,
  videoUrl: r.videoUrl,
  date: r.createdAt,
  /** The business's public answer. */
  reply: r.reply ? { text: r.reply, date: r.replyAt } : null,
  source: r.source,
});

/** Public part (inside /api/public, site key already resolved in req.site). */
export const reviewPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/reviews", async (req, reply) => {
    const site = req.site!;
    if (!(await hasModule(site.organizationId, "reviews"))) return reply.code(403).send({ error: "module_not_active" });
    const rows = await db
      .select({ r: reviews, productName: products.name })
      .from(reviews)
      .leftJoin(products, eq(products.id, reviews.productId))
      .where(and(eq(reviews.siteId, site.id), eq(reviews.status, "published")))
      .orderBy(desc(reviews.createdAt))
      .limit(100);
    return rows.map(({ r, productName }) => publicView({ ...r, productName }));
  });

  app.post("/reviews", { bodyLimit: 7 * 1024 * 1024, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const site = req.site!;
    if (!(await hasModule(site.organizationId, "reviews"))) return reply.code(403).send({ error: "module_not_active" });
    const p = NewReview.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const b = p.data;
    let productId: string | null = null;
    if (b.productId) {
      const [prod] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, b.productId), eq(products.siteId, site.id)));
      productId = prod?.id ?? null;
    }
    let orderId: string | null = null;
    let verified = false;
    if (b.orderNumber && b.phone) {
      const [o] = await db.select().from(orders).where(and(eq(orders.number, b.orderNumber), eq(orders.siteId, site.id), eq(orders.isExample, false)));
      if (o && digits(o.customerPhone) === digits(b.phone) && o.status !== "cancelled") {
        orderId = o.id;
        verified = true;
        // Suggest the product from the order when the author did not pick one.
        if (!productId && o.items.length === 1) productId = o.items[0]!.productId;
      }
    }
    let photoFileId: string | null = null;
    if (b.photo) {
      const f = await saveImage(b.photo, { organizationId: site.organizationId, uploaderId: null, isPublic: false });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      photoFileId = f.file.id;
    }
    const publishNow = site.reviewModeration === "off" && b.consent;
    const [r] = await db
      .insert(reviews)
      .values({ organizationId: site.organizationId, siteId: site.id, productId, orderId, verified, authorName: b.name, rating: b.rating, text: b.text, consent: b.consent, photoFileId, videoUrl: b.videoUrl ?? null, status: publishNow ? "published" : "pending", ip: req.ip })
      .returning();
    if (publishNow && photoFileId) await db.update(files).set({ isPublic: true }).where(eq(files.id, photoFileId));
    await db.insert(notifications).values({ organizationId: site.organizationId, kind: "review", key: "newReview", params: { name: b.name, rating: b.rating } });
    return reply.code(201).send({ id: r!.id, status: r!.status, verified });
  });
};

/** Account part: /api/reviews. */
export const reviewRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { status?: string } }>("/", async (req, reply) => {
    const orgs = await orgScope(req, "reviews");
    if (!orgs.length) return [];
    const st = z.enum(["pending", "published", "trash"]).safeParse(req.query.status);
    const rows = await db
      .select({ r: reviews, productName: products.name, domain: sites.domain })
      .from(reviews)
      .leftJoin(products, eq(products.id, reviews.productId))
      .innerJoin(sites, eq(sites.id, reviews.siteId))
      .where(and(inArray(reviews.organizationId, orgs), st.success ? eq(reviews.status, st.data) : undefined))
      .orderBy(desc(reviews.createdAt))
      .limit(200);
    return rows.map(({ r, productName, domain }) => ({ ...publicView({ ...r, productName }), status: r.status, consent: r.consent, trashedAt: r.trashedAt, domain, photo: r.photoFileId ? `/api/files/${r.photoFileId}` : null }));
  });

  /** The business's public answer under the review (empty text removes it). */
  app.put<{ Params: { id: string } }>("/:id/reply", async (req, reply) => {
    const p = z.object({ text: z.string().trim().max(2000) }).safeParse(req.body);
    const orgs = await orgScope(req, "reviews");
    if (!p.success || !uuid.safeParse(req.params.id).success || !orgs.length) return reply.code(400).send({ error: "invalid_input" });
    const [r] = await db
      .update(reviews)
      .set({ reply: p.data.text || null, replyAt: p.data.text ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(reviews.id, req.params.id), inArray(reviews.organizationId, orgs)))
      .returning({ id: reviews.id, organizationId: reviews.organizationId });
    if (!r) return reply.code(404).send({ error: "not_found" });
    await audit(req, "review.reply", req.auth!.user.id, { review: r.id }, r.organizationId);
    return { ok: true };
  });

  app.post<{ Params: { id: string; action: string } }>("/:id/:action", async (req, reply) => {
    const action = z.enum(["approve", "reject", "restore", "delete"]).safeParse(req.params.action);
    const orgs = await orgScope(req, "reviews");
    if (!action.success || !uuid.safeParse(req.params.id).success || !orgs.length) return reply.code(400).send({ error: "invalid_input" });
    const [r] = await db.select().from(reviews).where(and(eq(reviews.id, req.params.id), inArray(reviews.organizationId, orgs)));
    if (!r) return reply.code(404).send({ error: "not_found" });
    const now = new Date();
    if (action.data === "approve") {
      if (!r.consent) return reply.code(409).send({ error: "no_consent" });
      await db.update(reviews).set({ status: "published", trashedAt: null, updatedAt: now }).where(eq(reviews.id, r.id));
      if (r.photoFileId) await db.update(files).set({ isPublic: true }).where(eq(files.id, r.photoFileId));
    } else if (action.data === "reject") {
      await db.update(reviews).set({ status: "trash", trashedAt: now, updatedAt: now }).where(eq(reviews.id, r.id));
      if (r.photoFileId) await db.update(files).set({ isPublic: false }).where(eq(files.id, r.photoFileId));
    } else if (action.data === "restore") {
      await db.update(reviews).set({ status: "pending", trashedAt: null, updatedAt: now }).where(eq(reviews.id, r.id));
    } else {
      await db.delete(reviews).where(eq(reviews.id, r.id));
      if (r.photoFileId) await db.delete(files).where(eq(files.id, r.photoFileId));
    }
    await audit(req, `review.${action.data}`, req.auth!.user.id, { review: r.id }, r.organizationId);
    return { ok: true };
  });

  app.patch<{ Params: { siteId: string } }>("/settings/:siteId", async (req, reply) => {
    const p = z.object({ moderation: z.enum(["off", "manual"]) }).safeParse(req.body);
    const orgs = await orgScope(req, "reviews");
    if (!p.success || !uuid.safeParse(req.params.siteId).success || !orgs.length) return reply.code(400).send({ error: "invalid_input" });
    const [s] = await db.update(sites).set({ reviewModeration: p.data.moderation }).where(and(eq(sites.id, req.params.siteId), inArray(sites.organizationId, orgs))).returning({ id: sites.id });
    return s ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });
};

/** Rejected reviews are deleted for good after 30 days in the trash. */
export async function purgeTrash(now = new Date()) {
  const old = await db.select({ id: reviews.id, photo: reviews.photoFileId }).from(reviews).where(and(eq(reviews.status, "trash"), lt(reviews.trashedAt, new Date(now.getTime() - TRASH_DAYS * 86_400_000))));
  if (!old.length) return 0;
  await db.delete(reviews).where(inArray(reviews.id, old.map((o) => o.id)));
  const photos = old.map((o) => o.photo).filter((x): x is string => !!x);
  if (photos.length) await db.delete(files).where(inArray(files.id, photos));
  return old.length;
}
