import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, or, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { orderEvents, orderStatuses, organizations, orders, sites, webhookDeliveries, webhookEndpoints } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership, orgScope } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { sha256 } from "../security/crypto.ts";
import { env } from "../config.ts";
import { catalogOf, categoriesOf, createSiteOrder } from "../public/routes.ts";
import { MAX_ENDPOINTS, WEBHOOK_EVENTS, newWebhookSecret, sealSecret, sendTest } from "../webhooks/service.ts";

declare module "fastify" {
  interface FastifyRequest {
    apiSite?: typeof sites.$inferSelect;
  }
}

const uuid = z.string().uuid();
/** `ok_sec_` + 43 characters of 32 random bytes. */
const SECRET_RE = /^ok_sec_[A-Za-z0-9_-]{43}$/;
const hintOf = (key: string) => `${key.slice(0, 11)}…${key.slice(-4)}`;
const keyOf = (req: FastifyRequest) => String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();

/**
 * The secret key: from the site's own server only. A request that a browser made (Origin or Sec-Fetch-* headers) is
 * refused, so a key pasted into a page never works. The previous key keeps working 24 hours after a change.
 */
async function secretSite(req: FastifyRequest, reply: FastifyReply) {
  // Browsers mark every request with Sec-Fetch-Site / Sec-Fetch-Dest (and cross-site ones with Origin). Servers send
  // neither (Node's fetch adds only Sec-Fetch-Mode, which is therefore not a sign of a browser).
  if (req.headers.origin || req.headers["sec-fetch-site"] || req.headers["sec-fetch-dest"]) return reply.code(403).send({ error: "secret_key_in_browser" });
  const key = keyOf(req);
  if (!SECRET_RE.test(key)) return reply.code(401).send({ error: "invalid_secret_key" });
  const h = sha256(key);
  const [site] = await db
    .select()
    .from(sites)
    .where(or(eq(sites.secretKeyHash, h), and(eq(sites.prevSecretKeyHash, h), gt(sites.prevSecretExpiresAt, new Date()))))
    .limit(1);
  if (!site) return reply.code(401).send({ error: "invalid_secret_key" });
  req.apiSite = site;
}

/** Limits by site (a site's server calls from one address, so the per-address limits of the public API do not fit). */
const perSite = (max: number, timeWindow: string) => ({ rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => `v1:${sha256(keyOf(req)).slice(0, 16)}` } });

/** /api/v1: the API for the site's own server (the secret key). Versioned: a breaking change becomes /v2. */
export const v1Routes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", secretSite);

  app.get("/site", { config: perSite(600, "1 minute") }, async (req) => {
    const s = req.apiSite!;
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, s.organizationId));
    return { id: s.id, domain: s.domain, name: s.name, business: org?.name ?? "", verified: !!s.verifiedAt, publicKey: s.publicKey };
  });

  app.get("/products", { config: perSite(600, "1 minute") }, async (req) => catalogOf(req.apiSite!.id));
  app.get<{ Params: { id: string } }>("/products/:id", { config: perSite(600, "1 minute") }, async (req, reply) => {
    const p = (await catalogOf(req.apiSite!.id)).find((x) => x.id === req.params.id);
    return p ?? reply.code(404).send({ error: "not_found" });
  });
  app.get("/categories", { config: perSite(600, "1 minute") }, async (req) => categoriesOf(req.apiSite!.id));

  /** An order from the site's server; `customerIp` (optional) is kept with the order as the buyer's address. */
  app.post("/orders", { config: perSite(300, "10 minutes") }, async (req, reply) => {
    const ip = z.object({ customerIp: z.union([z.ipv4(), z.ipv6()]).optional() }).safeParse(req.body);
    const r = await createSiteOrder(req.apiSite!, req.body, (ip.success && ip.data.customerIp) || req.ip);
    return reply.code(r.code).send(r.body);
  });

  /** An order of this site by its number (the site's own «order» page): status, items, sums, delivery, waybill. */
  app.get<{ Params: { number: string } }>("/orders/:number", { config: perSite(600, "1 minute") }, async (req, reply) => {
    const n = Number(req.params.number);
    if (!Number.isInteger(n) || n < 1) return reply.code(404).send({ error: "not_found" });
    const [o] = await db.select().from(orders).where(and(eq(orders.siteId, req.apiSite!.id), eq(orders.number, n)));
    if (!o) return reply.code(404).send({ error: "not_found" });
    const [custom] = o.statusId ? await db.select({ name: orderStatuses.name }).from(orderStatuses).where(eq(orderStatuses.id, o.statusId)) : [];
    const history = await db.select({ status: orderEvents.status, at: orderEvents.createdAt }).from(orderEvents).where(and(eq(orderEvents.orderId, o.id), inArray(orderEvents.kind, ["status", "created"]))).orderBy(orderEvents.createdAt);
    return {
      number: o.number,
      status: o.status,
      statusName: custom?.name ?? null,
      paymentStatus: o.paymentStatus,
      prepaid: o.prepaidKop / 100,
      total: o.totalKop / 100,
      items: o.items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty, price: i.priceKop / 100 })),
      delivery: o.delivery,
      payment: o.payment,
      waybill: o.waybill ?? null,
      createdAt: o.createdAt,
      history: history.filter((h) => h.status).map((h) => ({ status: h.status, at: h.at })),
    };
  });
};

/** The panel side: «Сайт → API й вебхуки» — the secret key (owner only) and up to 3 webhook addresses. */
export const siteApiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  async function manage(req: FastifyRequest, id: string) {
    if (!uuid.safeParse(id).success) return null;
    const orgs = await orgScope(req, "site");
    const [s] = orgs.length ? await db.select().from(sites).where(and(eq(sites.id, id), inArray(sites.organizationId, orgs))) : [];
    return s ?? null;
  }
  const endpointOf = async (siteId: string, id: string) => (uuid.safeParse(id).success ? (await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.siteId, siteId))))[0] : undefined);
  const Url = z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://") || (env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)));
  const Events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length);

  app.get<{ Params: { id: string } }>("/sites/:id/api", async (req, reply) => {
    const s = await manage(req, req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    const eps = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.siteId, s.id)).orderBy(webhookEndpoints.createdAt);
    const stats = eps.length
      ? await db
          .select({ id: webhookDeliveries.endpointId, ok: dsql<number>`count(*) filter (where status = 'ok')`.mapWith(Number), failed: dsql<number>`count(*) filter (where status = 'failed')`.mapWith(Number), pending: dsql<number>`count(*) filter (where status = 'pending')`.mapWith(Number) })
          .from(webhookDeliveries)
          .where(and(inArray(webhookDeliveries.endpointId, eps.map((e) => e.id)), gt(webhookDeliveries.createdAt, new Date(Date.now() - 7 * 86_400_000))))
          .groupBy(webhookDeliveries.endpointId)
      : [];
    const m = await activeMembership(req);
    return {
      owner: m?.role === "owner",
      secretKey: s.secretKeyHash ? { hint: s.secretKeyHint, createdAt: s.secretKeyCreatedAt, previousUntil: s.prevSecretExpiresAt && s.prevSecretExpiresAt > new Date() ? s.prevSecretExpiresAt : null } : null,
      events: WEBHOOK_EVENTS,
      max: MAX_ENDPOINTS,
      webhooks: eps.map((e) => ({ id: e.id, url: e.url, events: e.events, active: e.active, disabledAt: e.disabledAt, createdAt: e.createdAt, week: stats.find((x) => x.id === e.id) ?? { ok: 0, failed: 0, pending: 0 } })),
    };
  });

  /** A new secret key, shown once. The one it replaces keeps working 24 hours (time to update the site). */
  app.post<{ Params: { id: string } }>("/sites/:id/secret-key", async (req, reply) => {
    const s = await manage(req, req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    if ((await activeMembership(req))?.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    const key = `ok_sec_${randomBytes(32).toString("base64url")}`;
    const now = new Date();
    await db
      .update(sites)
      .set({ secretKeyHash: sha256(key), secretKeyHint: hintOf(key), secretKeyCreatedAt: now, prevSecretKeyHash: s.secretKeyHash, prevSecretExpiresAt: s.secretKeyHash ? new Date(now.getTime() + 24 * 3_600_000) : null })
      .where(eq(sites.id, s.id));
    await audit(req, s.secretKeyHash ? "site.secret_key_replace" : "site.secret_key_create", req.auth!.user.id, { site: s.id }, s.organizationId);
    return { key, hint: hintOf(key) };
  });

  /** Switch the secret key off at once (and the previous one): the site's server loses access. */
  app.delete<{ Params: { id: string } }>("/sites/:id/secret-key", async (req, reply) => {
    const s = await manage(req, req.params.id);
    if (!s) return reply.code(404).send({ error: "not_found" });
    if ((await activeMembership(req))?.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    await db.update(sites).set({ secretKeyHash: null, secretKeyHint: null, secretKeyCreatedAt: null, prevSecretKeyHash: null, prevSecretExpiresAt: null }).where(eq(sites.id, s.id));
    await audit(req, "site.secret_key_revoke", req.auth!.user.id, { site: s.id }, s.organizationId);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/sites/:id/webhooks", async (req, reply) => {
    const s = await manage(req, req.params.id);
    const p = z.object({ url: Url, events: Events }).safeParse(req.body);
    if (!s) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [n] = await db.select({ n: dsql<number>`count(*)`.mapWith(Number) }).from(webhookEndpoints).where(eq(webhookEndpoints.siteId, s.id));
    if ((n?.n ?? 0) >= MAX_ENDPOINTS) return reply.code(409).send({ error: "too_many_webhooks" });
    const secret = newWebhookSecret();
    const [e] = await db.insert(webhookEndpoints).values({ organizationId: s.organizationId, siteId: s.id, url: p.data.url, events: [...new Set(p.data.events)], secret: sealSecret(secret) }).returning({ id: webhookEndpoints.id });
    await audit(req, "site.webhook_add", req.auth!.user.id, { site: s.id, url: p.data.url }, s.organizationId);
    return reply.code(201).send({ id: e!.id, secret });
  });

  app.patch<{ Params: { id: string; wid: string } }>("/sites/:id/webhooks/:wid", async (req, reply) => {
    const s = await manage(req, req.params.id);
    const e = s && (await endpointOf(s.id, req.params.wid));
    const p = z.object({ url: Url, events: Events, active: z.boolean() }).partial().safeParse(req.body);
    if (!s || !e) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    await db
      .update(webhookEndpoints)
      .set({ ...(p.data.url ? { url: p.data.url } : {}), ...(p.data.events ? { events: [...new Set(p.data.events)] } : {}), ...(p.data.active !== undefined ? { active: p.data.active, ...(p.data.active ? { failures: 0, disabledAt: null } : {}) } : {}) })
      .where(eq(webhookEndpoints.id, e.id));
    return { ok: true };
  });

  /** A new signing secret, shown once (the old one stops at once). */
  app.post<{ Params: { id: string; wid: string } }>("/sites/:id/webhooks/:wid/secret", async (req, reply) => {
    const s = await manage(req, req.params.id);
    const e = s && (await endpointOf(s.id, req.params.wid));
    if (!s || !e) return reply.code(404).send({ error: "not_found" });
    const secret = newWebhookSecret();
    await db.update(webhookEndpoints).set({ secret: sealSecret(secret) }).where(eq(webhookEndpoints.id, e.id));
    await audit(req, "site.webhook_secret", req.auth!.user.id, { site: s.id, webhook: e.id }, s.organizationId);
    return { secret };
  });

  app.delete<{ Params: { id: string; wid: string } }>("/sites/:id/webhooks/:wid", async (req, reply) => {
    const s = await manage(req, req.params.id);
    const e = s && (await endpointOf(s.id, req.params.wid));
    if (!s || !e) return reply.code(404).send({ error: "not_found" });
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, e.id));
    await audit(req, "site.webhook_remove", req.auth!.user.id, { site: s.id, url: e.url }, s.organizationId);
    return { ok: true };
  });

  app.post<{ Params: { id: string; wid: string } }>("/sites/:id/webhooks/:wid/test", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const s = await manage(req, req.params.id);
    const e = s && (await endpointOf(s.id, req.params.wid));
    if (!s || !e) return reply.code(404).send({ error: "not_found" });
    return sendTest(e);
  });

  app.get<{ Params: { id: string; wid: string } }>("/sites/:id/webhooks/:wid/deliveries", async (req, reply) => {
    const s = await manage(req, req.params.id);
    const e = s && (await endpointOf(s.id, req.params.wid));
    if (!s || !e) return reply.code(404).send({ error: "not_found" });
    return db
      .select({ id: webhookDeliveries.id, type: webhookDeliveries.type, status: webhookDeliveries.status, attempts: webhookDeliveries.attempts, lastStatus: webhookDeliveries.lastStatus, lastError: webhookDeliveries.lastError, nextAttemptAt: webhookDeliveries.nextAttemptAt, createdAt: webhookDeliveries.createdAt, deliveredAt: webhookDeliveries.deliveredAt, payload: webhookDeliveries.payload })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, e.id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
  });

  /** «Надіслати ще раз»: the delivery goes out on the next round, attempts counted from zero. */
  app.post<{ Params: { id: string; wid: string; did: string } }>("/sites/:id/webhooks/:wid/deliveries/:did/retry", async (req, reply) => {
    const s = await manage(req, req.params.id);
    const e = s && (await endpointOf(s.id, req.params.wid));
    if (!s || !e || !uuid.safeParse(req.params.did).success) return reply.code(404).send({ error: "not_found" });
    const [d] = await db.update(webhookDeliveries).set({ status: "pending", attempts: 0, nextAttemptAt: new Date() }).where(and(eq(webhookDeliveries.id, req.params.did), eq(webhookDeliveries.endpointId, e.id))).returning({ id: webhookDeliveries.id });
    return d ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });
};
