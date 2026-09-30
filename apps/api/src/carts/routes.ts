import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { carts, products } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orderAccess } from "../auth/access.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A cart becomes «незавершений» 2 hours after its last change without an order. */
export const ABANDON_AFTER = 2 * HOUR;
/** Carts (with the buyer's phone) are kept this long, then deleted. */
export const KEEP_DAYS = 30;
/** «Не додзвонились»: call again in 2 hours (as with orders). */
const CALLBACK_AFTER = 2 * HOUR;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor/i;

/** «067 111 22 33», «0671112233», «+380671112233» → «+380671112233» (other countries stay as typed digits). */
export function normalizePhone(p: string) {
  let d = p.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) d = `38${d}`;
  else if (d.length === 9) d = `380${d}`;
  return `+${d}`;
}

const CartIn = z.object({
  session: z.string().regex(/^[a-z0-9]{16,64}$/),
  phone: z.string().trim().regex(/^\+?[0-9\s()-]{9,20}$/),
  name: z.string().trim().max(100).optional(),
  items: z.array(z.object({ id: z.string().uuid(), qty: z.number().int().min(1).max(99) })).max(50),
});

/**
 * An order came (from the site, by phone or from the team): carts of the same browsing session or phone are finished.
 * A cart that never became «незавершений» (changed less than 2 hours ago) is simply deleted.
 */
export async function finishCarts(orgId: string, orderId: string, phone: string, session?: string, now = new Date()) {
  const match = or(dsql`ok_phone_key(${carts.phone}) = ok_phone_key(${phone})`, session ? eq(carts.session, session) : undefined);
  const open = and(eq(carts.organizationId, orgId), isNull(carts.orderId), match);
  await db.delete(carts).where(and(open, gt(carts.updatedAt, new Date(now.getTime() - ABANDON_AFTER))));
  await db.update(carts).set({ orderId, callbackAt: null }).where(open);
}

/** The team made an order from the cart («Оформити замовлення»). */
export async function recoverCart(orgId: string, cartId: string, orderId: string) {
  const [c] = await db.update(carts).set({ orderId, recovered: true, callbackAt: null }).where(and(eq(carts.id, cartId), eq(carts.organizationId, orgId), isNull(carts.orderId))).returning({ phone: carts.phone });
  return c ?? null;
}

export async function purgeCarts(now = new Date()) {
  await db.delete(carts).where(lt(carts.updatedAt, new Date(now.getTime() - KEEP_DAYS * DAY)));
}

/** Carts waiting for a call now: abandoned, not closed, no order, not postponed by «Не додзвонились». */
export const dueCarts = (orgId: string, now: Date) =>
  and(eq(carts.organizationId, orgId), isNull(carts.orderId), isNull(carts.closedAt), lte(carts.updatedAt, new Date(now.getTime() - ABANDON_AFTER)), or(isNull(carts.callbackAt), lte(carts.callbackAt, now)));

/** Public part (inside /api/public with the site already resolved): ok.js sends the cart once the phone is typed. */
export const cartPublicRoutes: FastifyPluginAsync = async (app) => {
  app.post("/carts", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (BOT.test(String(req.headers["user-agent"] ?? ""))) return reply.code(204).send();
    const p = CartIn.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const site = req.site!;
    const [known] = await db.select().from(carts).where(and(eq(carts.siteId, site.id), eq(carts.session, p.data.session)));
    // Finished or closed by the team: later changes of the same visit are not collected again.
    if (known && (known.orderId || known.closedAt)) return reply.code(204).send();
    const ids = [...new Set(p.data.items.map((i) => i.id))];
    const rows = ids.length ? await db.select().from(products).where(and(inArray(products.id, ids), eq(products.siteId, site.id), eq(products.active, true), isNull(products.archivedAt))) : [];
    const qty = new Map<string, number>();
    for (const i of p.data.items) if (rows.some((r) => r.id === i.id)) qty.set(i.id, (qty.get(i.id) ?? 0) + i.qty);
    const items = [...qty].map(([id, q]) => {
      const r = rows.find((x) => x.id === id)!;
      return { productId: id, name: r.name, qty: q, priceKop: r.priceKop };
    });
    // An emptied cart is nothing to call about.
    if (!items.length) {
      if (known) await db.delete(carts).where(eq(carts.id, known.id));
      return reply.code(204).send();
    }
    const values = { phone: normalizePhone(p.data.phone), name: p.data.name || null, items, totalKop: items.reduce((s, i) => s + i.priceKop * i.qty, 0), updatedAt: new Date() };
    await db
      .insert(carts)
      .values({ organizationId: site.organizationId, siteId: site.id, session: p.data.session, ...values })
      .onConflictDoUpdate({ target: [carts.siteId, carts.session], set: values });
    return reply.code(204).send();
  });
};

const VIEWS = ["waiting", "ordered", "closed"] as const;

/** /api/shop/carts: the list for a call (right `orders`), «Не додзвонились», «Не цікаво», a note. */
export const cartRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { view?: string } }>("/carts", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!acc?.full) return reply.code(403).send({ error: "forbidden" });
    const view = (VIEWS as readonly string[]).includes(req.query.view ?? "") ? req.query.view! : "waiting";
    const now = new Date();
    const abandoned = lte(carts.updatedAt, new Date(now.getTime() - ABANDON_AFTER));
    const where =
      view === "waiting"
        ? and(eq(carts.organizationId, acc.org), isNull(carts.orderId), isNull(carts.closedAt), abandoned)
        : view === "ordered"
          ? and(eq(carts.organizationId, acc.org), isNotNull(carts.orderId))
          : and(eq(carts.organizationId, acc.org), isNull(carts.orderId), isNotNull(carts.closedAt));
    const rows = await db.select().from(carts).where(where).orderBy(desc(carts.updatedAt)).limit(200);
    const [s] = await db
      .select({
        abandoned: dsql<number>`count(*) filter (where ${carts.orderId} is null and ${carts.updatedAt} <= ${new Date(now.getTime() - ABANDON_AFTER).toISOString()}::timestamptz or ${carts.orderId} is not null)`.mapWith(Number),
        waiting: dsql<number>`count(*) filter (where ${carts.orderId} is null and ${carts.closedAt} is null and ${carts.updatedAt} <= ${new Date(now.getTime() - ABANDON_AFTER).toISOString()}::timestamptz)`.mapWith(Number),
        recovered: dsql<number>`count(*) filter (where ${carts.recovered})`.mapWith(Number),
        recoveredKop: dsql<number>`coalesce(sum(${carts.totalKop}) filter (where ${carts.recovered}), 0)`.mapWith(Number),
        self: dsql<number>`count(*) filter (where ${carts.orderId} is not null and not ${carts.recovered})`.mapWith(Number),
      })
      .from(carts)
      .where(eq(carts.organizationId, acc.org));
    const strip = <T extends { totalKop: number; items: { priceKop: number }[] }>(c: T) => (acc.finance ? c : { ...c, totalKop: null, items: c.items.map((i) => ({ ...i, priceKop: null })) });
    return {
      view,
      stats: { ...s!, recoveredKop: acc.finance ? s!.recoveredKop : null, keepDays: KEEP_DAYS },
      carts: rows.map((c) => strip({ id: c.id, phone: c.phone, name: c.name, items: c.items, totalKop: c.totalKop, orderId: c.orderId, recovered: c.recovered, closedAt: c.closedAt, calls: c.calls, callbackAt: c.callbackAt, note: c.note, createdAt: c.createdAt, updatedAt: c.updatedAt })),
      finance: acc.finance,
    };
  });

  /** The number next to the «Незавершені кошики» tab: carts waiting for a call. */
  app.get("/carts/count", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!acc?.full) return reply.code(403).send({ error: "forbidden" });
    const [c] = await db.select({ n: dsql<number>`count(*)`.mapWith(Number) }).from(carts).where(dueCarts(acc.org, new Date()));
    return { waiting: c!.n };
  });

  const Act = z.object({ action: z.enum(["no-answer", "close", "reopen", "note"]), note: z.string().trim().max(1000).optional() });
  app.post<{ Params: { id: string } }>("/carts/:id", async (req, reply) => {
    const acc = await orderAccess(req);
    if (!acc?.full) return reply.code(403).send({ error: "forbidden" });
    const p = Act.safeParse(req.body);
    if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const own = and(eq(carts.id, req.params.id), eq(carts.organizationId, acc.org), isNull(carts.orderId));
    const set =
      p.data.action === "no-answer"
        ? { calls: dsql`${carts.calls} + 1`, callbackAt: new Date(Date.now() + CALLBACK_AFTER) }
        : p.data.action === "close"
          ? { closedAt: new Date(), callbackAt: null }
          : p.data.action === "reopen"
            ? { closedAt: null }
            : { note: p.data.note || null };
    const [c] = await db.update(carts).set(set).where(own).returning({ id: carts.id, callbackAt: carts.callbackAt, calls: carts.calls });
    if (!c) return reply.code(404).send({ error: "not_found" });
    return c;
  });
};
