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
import { createUpShipment, ensureSender, upCities, upFetch, upOfficeByPostcode, upOffices, upSticker, verifyUp, type UpCreds, type UpFetch, type UpSettings } from "./ukrposhta.ts";
import { PDFDocument } from "pdf-lib";
import { CARRIERS, toShip } from "../dashboard/todo.ts";
import { forgetRozetkaToken, rozetkaFetch, rozetkaLogin, syncRozetka, type RozetkaFetch } from "./rozetka.ts";
import { createWaybill, findCities, findWarehouses, verifyKey, type NpCall, type NpSender, type NpSettings, npCall } from "./novaposhta.ts";

export const PROVIDERS = ["novaposhta", "ukrposhta", "prom", "olx", "rozetka", "google", "meta", "telegram"] as const;
/** Providers that can actually be connected today. The rest are shown honestly as "in development". */
export const LIVE_PROVIDERS = new Set<string>(["novaposhta", "ukrposhta", "prom", "rozetka"]);

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
export function integrationRoutes(call: NpCall = npCall, prom: PromFetch = promFetch, rozetka: RozetkaFetch = rozetkaFetch, printPdf: PrintPdf = fetchPdf, up: UpFetch = upFetch): FastifyPluginAsync {
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

    // ---------------- Ukrposhta: same flow as Nova Poshta (key here, waybill + printing in the order) ----------------
    const UpSenderSchema = z
      .object({
        type: z.enum(["INDIVIDUAL", "PRIVATE_ENTREPRENEUR", "COMPANY"]),
        firstName: z.string().trim().min(2).max(100).optional(),
        lastName: z.string().trim().min(2).max(100).optional(),
        middleName: z.string().trim().min(2).max(100).optional(),
        companyName: z.string().trim().min(2).max(250).optional(),
        phone: z.string().trim().regex(/^\+?[0-9\s()-]{9,20}$/),
        tin: z.string().trim().regex(/^\d{10}$/).optional(),
        edrpou: z.string().trim().regex(/^\d{5,8}$/).optional(),
        bankAccount: z.string().trim().toUpperCase().regex(/^UA\d{27}$/).optional(),
      })
      .refine((s) => (s.type === "COMPANY" ? !!s.companyName && !!s.edrpou : !!s.firstName && !!s.lastName), { path: ["name"] })
      .refine((s) => s.type !== "PRIVATE_ENTREPRENEUR" || !!s.tin, { path: ["tin"] })
      // The docs require the middle name of an individual sender for cash on delivery.
      .refine((s) => s.type !== "INDIVIDUAL" || !!s.middleName, { path: ["middleName"] });

    app.post("/ukrposhta/connect", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "modules");
      if (!org) return reply.code(403).send({ error: "forbidden" });
      const p = z.object({ bearer: z.string().trim().min(10).max(200), token: z.string().trim().min(10).max(200), sender: UpSenderSchema }).safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "invalid_input", fields: p.error.issues.map((i) => i.path.join(".")) });
      const v = await verifyUp(p.data.bearer, p.data.token, up);
      if (!v.ok) return reply.code(400).send({ error: "provider_rejected", detail: v.error });
      const enc = encrypt(JSON.stringify(p.data satisfies UpCreds));
      // New credentials or sender details: sender clients are created again on the next waybill.
      await db
        .insert(integrations)
        .values({ organizationId: org, provider: "ukrposhta", credentialsEnc: enc, status: "connected" })
        .onConflictDoUpdate({ target: [integrations.organizationId, integrations.provider], set: { credentialsEnc: enc, status: "connected", lastError: null, settings: {}, updatedAt: new Date() } });
      await audit(req, "integration.connect", req.auth!.user.id, { provider: "ukrposhta" }, org);
      return { ok: true };
    });

    async function upOf(orgId: string) {
      const row = await getIntegration(orgId, "ukrposhta");
      if (!row) return null;
      return { creds: JSON.parse(decrypt(row.credentialsEnc)) as UpCreds, settings: row.settings as UpSettings };
    }

    app.get<{ Querystring: { q?: string } }>("/ukrposhta/cities", async (req, reply) => {
      const [org] = await orgScope(req);
      const u = org ? await upOf(org) : null;
      if (!u) return reply.code(409).send({ error: "not_connected" });
      return upCities(u.creds.bearer, String(req.query.q ?? "").slice(0, 50), up);
    });

    app.get<{ Querystring: { city?: string; q?: string } }>("/ukrposhta/warehouses", async (req, reply) => {
      const [org] = await orgScope(req);
      const u = org ? await upOf(org) : null;
      if (!u || !req.query.city) return reply.code(409).send({ error: "not_connected" });
      return upOffices(u.creds.bearer, req.query.city, String(req.query.q ?? "").slice(0, 50), up);
    });

    app.get<{ Params: { orderId: string } }>("/ukrposhta/draft/:orderId", async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      if (!org || !z.string().uuid().safeParse(req.params.orderId).success) return reply.code(404).send({ error: "not_found" });
      const moduleActive = await hasModule(org, "ukrposhta");
      const u = await upOf(org);
      if (!moduleActive || !u) return { moduleActive, connected: !!u };
      const o = await orderOf(org, req.params.orderId);
      if (!o) return reply.code(404).send({ error: "not_found" });
      const s = u.settings;
      // A 5-digit postcode in the branch or address points at the exact office; otherwise suggest cities by name.
      const code = `${o.delivery.branch ?? ""} ${o.delivery.address ?? ""}`.match(/\b\d{5}\b/)?.[0];
      const exact = code ? await upOfficeByPostcode(u.creds.bearer, code, up) : null;
      const cities = !exact && o.delivery.city ? await upCities(u.creds.bearer, o.delivery.city, up) : [];
      return {
        moduleActive,
        connected: true,
        sender: s.cityRef && s.warehouseRef ? { city: { ref: s.cityRef, name: s.cityName ?? "", area: "" }, warehouse: { ref: s.warehouseRef, name: s.warehouseName ?? "", number: s.warehouseRef } } : null,
        recipient: { city: exact?.city ?? null, warehouse: exact?.office ?? null, cities, warehouses: [] },
        weight: s.weight ?? 1,
        size: { length: s.length ?? 30, width: s.width ?? 20, height: s.height ?? 10 },
        description: s.description ?? "",
        cod: o.payment === "cod" ? o.totalKop / 100 : 0,
      };
    });

    const UpWaybill = z.object({
      orderId: z.string().uuid(),
      sender: z.object({ cityRef: z.string().max(80), cityName: z.string().max(120), warehouseRef: z.string().regex(/^\d{5}$/), warehouseName: z.string().max(300) }),
      recipient: z.object({ cityRef: z.string().max(80), warehouseRef: z.string().regex(/^\d{5}$/) }),
      weight: z.number().min(0.05).max(30),
      size: z.object({ length: z.number().int().min(1).max(120), width: z.number().int().min(1).max(70), height: z.number().int().min(1).max(70) }),
      description: z.string().trim().max(255).optional(),
    });

    app.post("/ukrposhta/waybill", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      const p = UpWaybill.safeParse(req.body);
      if (!org || !p.success) return reply.code(400).send({ error: "invalid_input" });
      if (!(await hasModule(org, "ukrposhta"))) return reply.code(403).send({ error: "module_not_active" });
      const u = await upOf(org);
      if (!u) return reply.code(409).send({ error: "not_connected" });
      const o = await orderOf(org, p.data.orderId);
      if (!o) return reply.code(404).send({ error: "not_found" });
      if (o.waybill) return reply.code(409).send({ error: "already_has_waybill" });
      const where = and(eq(integrations.organizationId, org), eq(integrations.provider, "ukrposhta"));
      const fail = async (error: string) => {
        await db.update(integrations).set({ lastError: error, updatedAt: new Date() }).where(where);
        return reply.code(409).send({ error: error === "iban_required_for_cod" ? error : "provider_rejected", detail: error });
      };

      const postcode = p.data.sender.warehouseRef;
      const snd = await ensureSender(u.creds, postcode, u.settings.senders?.[postcode], up);
      if (!snd.ok) return fail(snd.error);
      const settings: UpSettings = {
        ...u.settings,
        ...p.data.sender,
        weight: p.data.weight,
        ...p.data.size,
        ...(p.data.description ? { description: p.data.description } : {}),
        senders: { ...u.settings.senders, [postcode]: snd.uuid },
      };
      await db.update(integrations).set({ settings, updatedAt: new Date() }).where(where);
      const r = await createUpShipment(
        u.creds,
        { senderUuid: snd.uuid, recipientPostcode: p.data.recipient.warehouseRef, customerName: o.customerName, customerPhone: o.customerPhone, totalUah: o.totalKop / 100, cod: o.payment === "cod", weightKg: p.data.weight, ...p.data.size, description: p.data.description },
        up,
      );
      if (!r.ok) return fail(r.error);
      await db.update(orders).set({ waybill: r.barcode, waybillRef: r.uuid, updatedAt: new Date() }).where(eq(orders.id, o.id));
      await audit(req, "order.waybill", req.auth!.user.id, { order: o.id, waybill: r.barcode, carrier: "ukrposhta" }, org);
      return { number: r.barcode, cost: r.cost };
    });

    /** 100x100 label, or the same label on A4 (kind=document). The PDF is fetched on the server with the stored token. */
    app.get<{ Params: { orderId: string }; Querystring: { kind?: string } }>("/ukrposhta/print/:orderId", async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      if (!org || !z.string().uuid().safeParse(req.params.orderId).success) return reply.code(404).send({ error: "not_found" });
      const u = await upOf(org);
      const o = await orderOf(org, req.params.orderId);
      if (!u || !o?.waybill) return reply.code(404).send({ error: "not_found" });
      const pdf = await upSticker(u.creds, o.waybillRef ?? o.waybill, req.query.kind !== "marking", up);
      if (!pdf) return reply.code(409).send({ error: "print_failed" });
      return reply.header("content-type", "application/pdf").header("content-disposition", `inline; filename="ukrposhta-${o.waybill}.pdf"`).header("cache-control", "private, no-store").send(pdf);
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

    /**
     * «Надрукувати всі ТТН»: every order waiting to be sent (confirmed or paid) that has a waybill, Nova Poshta
     * and Ukrposhta together, merged into one PDF. Orders whose document could not be fetched are listed in a header.
     */
    app.get<{ Querystring: { kind?: string } }>("/print-ready", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [org] = await orgScope(req, "orders");
      if (!org) return reply.code(404).send({ error: "not_found" });
      const marking = req.query.kind === "marking";
      const list = (await toShip(org)).filter((o) => o.waybill && CARRIERS.includes(o.method));
      if (!list.length) return reply.code(404).send({ error: "nothing_to_print" });
      const n = await np(org);
      const u = await upOf(org);
      const out = await PDFDocument.create();
      const failed: number[] = [];
      for (const o of list) {
        const [full] = await db.select({ waybill: orders.waybill, waybillRef: orders.waybillRef }).from(orders).where(eq(orders.id, o.id));
        const ref = full?.waybillRef ?? full?.waybill ?? "";
        const pdf =
          o.method === "novaposhta" && n
            ? await printPdf(`https://my.novaposhta.ua/orders/${marking ? "printMarking100x100" : "printDocument"}/orders[]/${encodeURIComponent(ref)}/type/pdf/apiKey/${n.creds.apiKey}`)
            : o.method === "ukrposhta" && u
              ? await upSticker(u.creds, ref, !marking, up)
              : null;
        try {
          if (!pdf) throw new Error("no pdf");
          const doc = await PDFDocument.load(pdf);
          for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
        } catch {
          failed.push(o.number);
        }
      }
      if (!out.getPageCount()) return reply.code(409).send({ error: "print_failed" });
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `inline; filename="ttn-${new Date().toISOString().slice(0, 10)}.pdf"`)
        .header("cache-control", "private, no-store")
        .header("x-failed-orders", failed.join(","))
        .send(Buffer.from(await out.save()));
    });
  };
}
