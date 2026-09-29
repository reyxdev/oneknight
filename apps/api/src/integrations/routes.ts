import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { integrations, orders } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope } from "../auth/access.ts";
import { hasModule } from "../billing/service.ts";
import { decrypt, encrypt } from "../security/crypto.ts";
import { audit } from "../audit.ts";
import { promFetch, syncProm, verifyPromToken, type PromFetch } from "./prom.ts";
import { forgetRozetkaToken, rozetkaFetch, rozetkaLogin, syncRozetka, type RozetkaFetch } from "./rozetka.ts";
import { createWaybill, findCities, findWarehouses, verifyKey, type NpCall, type NpSender, type NpSettings, npCall } from "./novaposhta.ts";

export const PROVIDERS = ["novaposhta", "ukrposhta", "prom", "olx", "rozetka", "google", "meta", "telegram"] as const;
/** Providers that can actually be connected today. The rest are shown honestly as "in development". */
export const LIVE_PROVIDERS = new Set<string>(["novaposhta", "prom", "rozetka"]);

type NpCreds = { apiKey: string; sender: NpSender };

async function getIntegration(orgId: string, provider: string) {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.organizationId, orgId), eq(integrations.provider, provider)));
  return row ?? null;
}

/** PDF from my.novaposhta.ua; a redirect (to the login page) or any non-PDF answer means it failed. */
export type PrintPdf = (url: string) => Promise<Buffer | null>;
export const fetchPdf: PrintPdf = async (url) => {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200 || !String(res.headers.get("content-type")).includes("pdf")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
};

/** /api/integrations. `call` lets tests replace the Nova Poshta network client. */
export function integrationRoutes(call: NpCall = npCall, prom: PromFetch = promFetch, rozetka: RozetkaFetch = rozetkaFetch, printPdf: PrintPdf = fetchPdf): FastifyPluginAsync {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get("/", async (req) => {
      const [org] = await orgScope(req, "modules");
      const rows = org ? await db.select().from(integrations).where(eq(integrations.organizationId, org)) : [];
      return PROVIDERS.map((p) => {
        const r = rows.find((x) => x.provider === p);
        return { provider: p, available: LIVE_PROVIDERS.has(p), status: r ? r.status : "not_connected", settings: r?.settings ?? {}, lastError: r?.lastError ?? null, connectedAt: r?.connectedAt ?? null };
      });
    });

    app.post("/novaposhta/connect", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "modules");
      if (!org) return reply.code(403).send({ error: "forbidden" });
      const p = z.object({ apiKey: z.string().trim().regex(/^[0-9a-f]{32}$/i) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "invalid_key_format" });
      const v = await verifyKey(p.data.apiKey, call);
      if (!v.ok) return reply.code(400).send({ error: "provider_rejected", detail: v.error });
      const creds: NpCreds = { apiKey: p.data.apiKey, sender: v.sender };
      await db
        .insert(integrations)
        .values({ organizationId: org, provider: "novaposhta", credentialsEnc: encrypt(JSON.stringify(creds)), status: "connected" })
        .onConflictDoUpdate({ target: [integrations.organizationId, integrations.provider], set: { credentialsEnc: encrypt(JSON.stringify(creds)), status: "connected", lastError: null, updatedAt: new Date() } });
      await audit(req, "integration.connect", req.auth!.user.id, { provider: "novaposhta" }, org);
      return { ok: true, sender: { name: v.sender.name, phone: v.sender.phone } };
    });

    app.delete<{ Params: { provider: string } }>("/:provider", async (req, reply) => {
      const [org] = await orgScope(req, "modules");
      if (!org) return reply.code(403).send({ error: "forbidden" });
      await db.delete(integrations).where(and(eq(integrations.organizationId, org), eq(integrations.provider, req.params.provider)));
      await audit(req, "integration.disconnect", req.auth!.user.id, { provider: req.params.provider }, org);
      return { ok: true };
    });

    app.post("/prom/connect", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "modules");
      if (!org) return reply.code(403).send({ error: "forbidden" });
      const p = z.object({ token: z.string().trim().regex(/^[0-9a-zA-Z_-]{20,128}$/) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "invalid_key_format" });
      const v = await verifyPromToken(p.data.token, prom);
      if (!v.ok) return reply.code(400).send({ error: "provider_rejected", detail: v.error });
      const enc = encrypt(JSON.stringify({ token: p.data.token }));
      await db
        .insert(integrations)
        .values({ organizationId: org, provider: "prom", credentialsEnc: enc, status: "connected" })
        .onConflictDoUpdate({ target: [integrations.organizationId, integrations.provider], set: { credentialsEnc: enc, status: "connected", lastError: null, updatedAt: new Date() } });
      await audit(req, "integration.connect", req.auth!.user.id, { provider: "prom" }, org);
      return { ok: true };
    });

    app.post("/prom/sync", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      if (!org) return reply.code(403).send({ error: "forbidden" });
      const r = await syncProm(org, prom);
      if (!r.ok) return reply.code(r.error === "module_not_active" ? 403 : 409).send({ error: r.error === "not_connected" || r.error === "module_not_active" ? r.error : "provider_rejected", detail: r.error });
      return r;
    });

    app.post("/rozetka/connect", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "modules");
      if (!org) return reply.code(403).send({ error: "forbidden" });
      const p = z.object({ username: z.string().trim().min(2).max(200), password: z.string().min(1).max(200) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "invalid_input" });
      const l = await rozetkaLogin(p.data, rozetka);
      if (!l.ok) return reply.code(400).send({ error: "provider_rejected", detail: l.error });
      forgetRozetkaToken(org);
      const enc = encrypt(JSON.stringify(p.data));
      await db
        .insert(integrations)
        .values({ organizationId: org, provider: "rozetka", credentialsEnc: enc, status: "connected", settings: { market: l.market } })
        .onConflictDoUpdate({ target: [integrations.organizationId, integrations.provider], set: { credentialsEnc: enc, status: "connected", lastError: null, updatedAt: new Date() } });
      await audit(req, "integration.connect", req.auth!.user.id, { provider: "rozetka" }, org);
      return { ok: true, market: l.market };
    });

    app.post("/rozetka/sync", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      if (!org) return reply.code(403).send({ error: "forbidden" });
      const r = await syncRozetka(org, rozetka);
      if (!r.ok) return reply.code(r.error === "module_not_active" ? 403 : 409).send({ error: r.error === "not_connected" || r.error === "module_not_active" ? r.error : "provider_rejected", detail: r.error });
      return r;
    });

    async function np(orgId: string) {
      const row = await getIntegration(orgId, "novaposhta");
      if (!row) return null;
      return { row, creds: JSON.parse(decrypt(row.credentialsEnc)) as NpCreds, settings: row.settings as NpSettings };
    }

    app.get<{ Querystring: { q?: string } }>("/novaposhta/cities", async (req, reply) => {
      const [org] = await orgScope(req);
      const n = org ? await np(org) : null;
      if (!n) return reply.code(409).send({ error: "not_connected" });
      return findCities(n.creds.apiKey, String(req.query.q ?? "").slice(0, 50), call);
    });

    app.get<{ Querystring: { city?: string; q?: string } }>("/novaposhta/warehouses", async (req, reply) => {
      const [org] = await orgScope(req);
      const n = org ? await np(org) : null;
      if (!n || !req.query.city) return reply.code(409).send({ error: "not_connected" });
      return findWarehouses(n.creds.apiKey, req.query.city, String(req.query.q ?? "").slice(0, 50), call);
    });

    /** Resolves the customer's city and branch from the order text; exact match only, otherwise candidates. */
    async function resolveRecipient(key: string, o: typeof orders.$inferSelect) {
      const cities = o.delivery.city ? await findCities(key, o.delivery.city, call) : [];
      const exact = cities.filter((c) => c.name.toLowerCase() === String(o.delivery.city).trim().toLowerCase());
      const city = exact.length === 1 ? exact[0]! : cities.length === 1 ? cities[0]! : null;
      const branch = String(o.delivery.branch ?? "").replace(/\D/g, "");
      const warehouses = city ? await findWarehouses(key, city.ref, branch, call) : [];
      const warehouse = warehouses.find((w) => w.number === branch) ?? null;
      return { city, warehouse, cities, warehouses };
    }

    async function orderOf(org: string, id: string) {
      const [o] = await db.select().from(orders).where(and(eq(orders.id, id), inArray(orders.organizationId, [org])));
      return o ?? null;
    }

    /** Everything the "Оформити ТТН" form needs, prefilled: last sender address, recipient from the order, parcel. */
    app.get<{ Params: { orderId: string } }>("/novaposhta/draft/:orderId", async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      if (!org || !z.string().uuid().safeParse(req.params.orderId).success) return reply.code(404).send({ error: "not_found" });
      const moduleActive = await hasModule(org, "novaposhta");
      const n = await np(org);
      if (!moduleActive || !n) return { moduleActive, connected: !!n };
      const o = await orderOf(org, req.params.orderId);
      if (!o) return reply.code(404).send({ error: "not_found" });
      const s = n.settings;
      return {
        moduleActive,
        connected: true,
        sender: s.cityRef && s.warehouseRef ? { city: { ref: s.cityRef, name: s.cityName ?? "", area: "" }, warehouse: { ref: s.warehouseRef, name: s.warehouseName ?? "", number: "" } } : null,
        recipient: await resolveRecipient(n.creds.apiKey, o),
        weight: s.weight ?? 1,
        description: s.description ?? "",
        cod: o.payment === "cod" ? o.totalKop / 100 : 0,
      };
    });

    const Place = z.object({ cityRef: z.string().min(1).max(60), cityName: z.string().max(120), warehouseRef: z.string().min(1).max(60), warehouseName: z.string().max(300) });
    const Waybill = z.object({
      orderId: z.string().uuid(),
      sender: Place,
      recipient: z.object({ cityRef: z.string().min(1).max(60), warehouseRef: z.string().min(1).max(60) }),
      weight: z.number().min(0.1).max(1000),
      description: z.string().trim().max(100).optional(),
    });

    /** Creates the waybill from the form. The sender address, weight and description become the next defaults. */
    app.post("/novaposhta/waybill", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      const p = Waybill.safeParse(req.body);
      if (!org || !p.success) return reply.code(400).send({ error: "invalid_input" });
      if (!(await hasModule(org, "novaposhta"))) return reply.code(403).send({ error: "module_not_active" });
      const n = await np(org);
      if (!n) return reply.code(409).send({ error: "not_connected" });
      const o = await orderOf(org, p.data.orderId);
      if (!o) return reply.code(404).send({ error: "not_found" });
      if (o.waybill) return reply.code(409).send({ error: "already_has_waybill" });

      const settings: NpSettings = { ...p.data.sender, weight: p.data.weight, ...(p.data.description ? { description: p.data.description } : {}) };
      await db.update(integrations).set({ settings: { ...n.settings, ...settings }, updatedAt: new Date() }).where(and(eq(integrations.organizationId, org), eq(integrations.provider, "novaposhta")));
      const r = await createWaybill(n.creds.apiKey, n.creds.sender, settings, { customerName: o.customerName, customerPhone: o.customerPhone, totalUah: o.totalKop / 100, cod: o.payment === "cod", recipientCityRef: p.data.recipient.cityRef, recipientWarehouseRef: p.data.recipient.warehouseRef }, call);
      if (!r.ok) {
        await db.update(integrations).set({ lastError: r.error, updatedAt: new Date() }).where(and(eq(integrations.organizationId, org), eq(integrations.provider, "novaposhta")));
        return reply.code(409).send({ error: "provider_rejected", detail: r.error });
      }
      await db.update(orders).set({ waybill: r.number, waybillRef: r.ref, updatedAt: new Date() }).where(eq(orders.id, o.id));
      await audit(req, "order.waybill", req.auth!.user.id, { order: o.id, waybill: r.number }, org);
      return { number: r.number, cost: r.cost };
    });

    /**
     * Printable PDF of the waybill (A4 document) or the 100x100 label, fetched from my.novaposhta.ua on the
     * server so the API key never reaches the browser.
     */
    app.get<{ Params: { orderId: string }; Querystring: { kind?: string } }>("/novaposhta/print/:orderId", async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      if (!org || !z.string().uuid().safeParse(req.params.orderId).success) return reply.code(404).send({ error: "not_found" });
      const n = await np(org);
      const o = await orderOf(org, req.params.orderId);
      if (!n || !o?.waybill) return reply.code(404).send({ error: "not_found" });
      const kind = req.query.kind === "marking" ? "printMarking100x100" : "printDocument";
      const pdf = await printPdf(`https://my.novaposhta.ua/orders/${kind}/orders[]/${encodeURIComponent(o.waybillRef ?? o.waybill)}/type/pdf/apiKey/${n.creds.apiKey}`);
      if (!pdf) return reply.code(409).send({ error: "print_failed" });
      return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="ttn-${o.waybill}.pdf"`).header("cache-control", "private, no-store").send(pdf);
    });
  };
}
