import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, desc, eq, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { customerNotes, customers, orders, organizations, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";

export const DEFAULT_SLEEP_DAYS = 90;
/** «Постійний» after this many completed orders; «Проблемний» after one refused parcel. */
export const REGULAR_AFTER = 3;
export const PRESET_TAGS = ["vip", "wholesale"] as const;
const SEGMENTS = ["all", "new", "regular", "sleeping", "top", "risky"] as const;

type Stats = { orders: number; sumKop: number; lastAt: string | null; done: number; returned: number; cancelled: number };

/** Customers work with `orders` (a shipping-only member does not see the base); sums need `finance`. */
async function access(req: FastifyRequest) {
  const m = await activeMembership(req);
  if (!m || !m.permissions.includes("orders")) return null;
  return { org: m.orgId, finance: m.permissions.includes("finance"), owner: m.role === "owner", userId: req.auth!.user.id };
}

export async function customerSettingsOf(orgId: string) {
  const [o] = await db.select({ s: organizations.customerSettings }).from(organizations).where(eq(organizations.id, orgId));
  return { tags: o?.s.tags ?? [], sleepDays: o?.s.sleepDays ?? DEFAULT_SLEEP_DAYS };
}

/** Counted from the business's orders (examples never count). The sum is of orders not cancelled or returned. */
const statsSql = (orgId: string) => dsql`
  select customer_id,
    count(*) filter (where status <> 'cancelled')::int as orders,
    coalesce(sum(total_kop) filter (where status not in ('cancelled', 'returned')), 0)::int as sum_kop,
    max(created_at) as last_at,
    count(*) filter (where status = 'done')::int as done,
    count(*) filter (where status = 'returned')::int as returned,
    count(*) filter (where status = 'cancelled')::int as cancelled
  from orders where organization_id = ${orgId} and not is_example and customer_id is not null group by customer_id`;

/** «Постійний» and «Проблемний» are never set by hand: they follow the orders. */
export const autoTags = (s: Pick<Stats, "done" | "returned">) => [...(s.done >= REGULAR_AFTER ? ["regular"] : []), ...(s.returned >= 1 ? ["problem"] : [])];

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /**
   * The base: segments Усі · Нові (first order within 30 days) · Постійні · Сплячі (no purchase for N days) ·
   * Топ (by sum) · Ризикові (a refused parcel or 2+ cancellations); search by name or phone; pages of 50.
   */
  app.get<{ Querystring: { segment?: string; q?: string; sort?: string; dir?: string; page?: string; limit?: string } }>("/", async (req, reply) => {
    const a = await access(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    const seg = z.enum(SEGMENTS).catch("all").parse(req.query.segment);
    const { sleepDays } = await customerSettingsOf(a.org);
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    const digits = q.replace(/\D/g, "");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 51));
    const page = Math.max(1, Math.min(10_000, Number(req.query.page) || 1));
    const where = [dsql`c.organization_id = ${a.org}`];
    if (q.length >= 2) where.push(digits.length >= 3 ? dsql`(c.name ilike ${`%${q}%`} or (coalesce(c.phone_key, '') || ',' || array_to_string(c.extra_phones, ',')) like ${`%${digits}%`})` : dsql`c.name ilike ${`%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`}`);
    if (seg === "new") where.push(dsql`c.created_at >= now() - interval '30 days'`);
    if (seg === "regular") where.push(dsql`coalesce(s.done, 0) >= ${REGULAR_AFTER}`);
    if (seg === "sleeping") where.push(dsql`s.last_at < now() - make_interval(days => ${sleepDays})`);
    if (seg === "risky") where.push(dsql`(coalesce(s.returned, 0) >= 1 or coalesce(s.cancelled, 0) >= 2)`);
    if (seg === "top") where.push(dsql`coalesce(s.sum_kop, 0) > 0`);
    const sortCols: Record<string, ReturnType<typeof dsql>> = {
      name: dsql`c.name collate "uk-UA-x-icu"`,
      orders: dsql`coalesce(s.orders, 0)`,
      last: dsql`s.last_at`,
      createdAt: dsql`c.created_at`,
      ...(a.finance ? { sum: dsql`coalesce(s.sum_kop, 0)` } : {}),
    };
    const key = seg === "top" && a.finance ? "sum" : req.query.sort && sortCols[req.query.sort] ? req.query.sort : "last";
    const dir = seg === "top" ? dsql`desc` : req.query.dir === "asc" ? dsql`asc` : dsql`desc`;
    const rows = await db.execute<{ id: string; name: string; phone: string | null; email: string | null; company: string | null; tags: string[]; city: string | null; first_source: string | null; anonymized_at: string | null; created_at: string; orders: number | null; sum_kop: number | null; last_at: string | null; done: number | null; returned: number | null }>(dsql`
      with s as (${statsSql(a.org)})
      select c.id, c.name, c.phone, c.email, c.company, c.tags, c.delivery->>'city' as city, c.first_source, c.anonymized_at, c.created_at,
        s.orders, s.sum_kop, s.last_at, s.done, s.returned
      from customers c left join s on s.customer_id = c.id
      where ${dsql.join(where, dsql` and `)}
      order by ${sortCols[key]} ${dir} nulls last, c.created_at desc
      limit ${limit} offset ${(page - 1) * Math.min(limit, 50)}`);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      company: r.company,
      tags: r.tags,
      auto: autoTags({ done: r.done ?? 0, returned: r.returned ?? 0 }),
      city: r.city,
      firstSource: r.first_source,
      anonymized: !!r.anonymized_at,
      createdAt: r.created_at,
      orders: r.orders ?? 0,
      sumKop: a.finance ? (r.sum_kop ?? 0) : null,
      lastAt: r.last_at,
    }));
  });

  /** Own tags with colours and the «сплячий» threshold («Бізнес → Клієнти»); the owner changes them. */
  app.get("/settings", async (req, reply) => {
    const a = await access(req);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    return { ...(await customerSettingsOf(a.org)), canEdit: a.owner };
  });
  app.put("/settings", async (req, reply) => {
    const a = await access(req);
    const p = z
      .object({ tags: z.array(z.object({ id: z.string().regex(/^t_[a-z0-9]{6,12}$/), name: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-f]{6}$/i) })).max(30), sleepDays: z.number().int().min(14).max(730) })
      .safeParse(req.body);
    if (!a?.owner) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    await db.update(organizations).set({ customerSettings: p.data }).where(eq(organizations.id, a.org));
    await audit(req, "business.customer_settings", a.userId, { tags: p.data.tags.length, sleepDays: p.data.sleepDays }, a.org);
    return { ok: true };
  });

  /** The card: details, numbers, every order, notes. */
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const a = await access(req);
    if (!a || !z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    const [c] = await db.select().from(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, a.org)));
    if (!c) return reply.code(404).send({ error: "not_found" });
    const list = await db
      .select({ id: orders.id, number: orders.number, status: orders.status, statusId: orders.statusId, totalKop: orders.totalKop, createdAt: orders.createdAt, source: orders.source })
      .from(orders)
      .where(and(eq(orders.customerId, c.id), eq(orders.isExample, false)))
      .orderBy(desc(orders.createdAt))
      .limit(200);
    const notes = await db
      .select({ id: customerNotes.id, text: customerNotes.text, at: customerNotes.createdAt, by: users.name })
      .from(customerNotes)
      .leftJoin(users, eq(users.id, customerNotes.userId))
      .where(eq(customerNotes.customerId, c.id))
      .orderBy(desc(customerNotes.createdAt));
    const live = list.filter((o) => o.status !== "cancelled");
    const stats = {
      orders: live.length,
      sumKop: a.finance ? live.filter((o) => o.status !== "returned").reduce((s, o) => s + o.totalKop, 0) : null,
      lastAt: list[0]?.createdAt ?? null,
      done: list.filter((o) => o.status === "done").length,
      returned: list.filter((o) => o.status === "returned").length,
      cancelled: list.filter((o) => o.status === "cancelled").length,
    };
    const { phoneKey: _k, ...rest } = c;
    return {
      ...rest,
      auto: autoTags(stats),
      stats,
      orders: list.map((o) => ({ ...o, totalKop: a.finance ? o.totalKop : null })),
      notes,
    };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const a = await access(req);
    const settings = a ? await customerSettingsOf(a.org) : null;
    const allowedTags = new Set<string>([...PRESET_TAGS, ...(settings?.tags.map((t) => t.id) ?? [])]);
    const p = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        email: z.string().trim().email().max(254).nullable().optional().or(z.literal("")),
        company: z.string().trim().max(200).nullable().optional(),
        edrpou: z.string().trim().regex(/^\d{8,10}$/).nullable().optional().or(z.literal("")),
        tags: z.array(z.string().max(20)).max(20).optional(),
      })
      .safeParse(req.body);
    if (!a || !z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    if (!p.success || p.data.tags?.some((t) => !allowedTags.has(t))) return reply.code(400).send({ error: "invalid_input" });
    const set = { ...p.data, ...(p.data.email === "" ? { email: null } : {}), ...(p.data.edrpou === "" ? { edrpou: null } : {}) };
    const [row] = await db.update(customers).set({ ...set, updatedAt: new Date() }).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, a.org), dsql`${customers.anonymizedAt} is null`)).returning({ id: customers.id });
    return row ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  app.post<{ Params: { id: string } }>("/:id/notes", async (req, reply) => {
    const a = await access(req);
    const p = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!a || !p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, a.org)));
    if (!c) return reply.code(404).send({ error: "not_found" });
    await db.insert(customerNotes).values({ customerId: c.id, userId: a.userId, text: p.data.text });
    return reply.code(201).send({ ok: true });
  });

  /**
   * Two records of one person: orders, notes, tags and phones of the other move here; the other is removed.
   * Future orders from either phone come here.
   */
  app.post<{ Params: { id: string } }>("/:id/merge", async (req, reply) => {
    const a = await access(req);
    const p = z.object({ other: z.string().uuid() }).safeParse(req.body);
    if (!a || !p.success || !z.string().uuid().safeParse(req.params.id).success || p.data.other === req.params.id) return reply.code(400).send({ error: "invalid_input" });
    const r = await db.transaction(async (tx) => {
      const both = await tx.select().from(customers).where(and(eq(customers.organizationId, a.org), dsql`${customers.id} in (${req.params.id}, ${p.data.other})`)).for("update");
      const main = both.find((x) => x.id === req.params.id);
      const other = both.find((x) => x.id === p.data.other);
      if (!main || !other) return false;
      if (main.anonymizedAt || other.anonymizedAt) return null;
      const phones = [...new Set([...main.extraPhones, ...(other.phoneKey ? [other.phoneKey] : []), ...other.extraPhones])].filter((x) => x !== main.phoneKey);
      await tx.update(orders).set({ customerId: main.id }).where(eq(orders.customerId, other.id));
      await tx.update(customerNotes).set({ customerId: main.id }).where(eq(customerNotes.customerId, other.id));
      await tx.delete(customers).where(eq(customers.id, other.id));
      await tx
        .update(customers)
        .set({
          extraPhones: phones,
          tags: [...new Set([...main.tags, ...other.tags])],
          email: main.email ?? other.email,
          company: main.company ?? other.company,
          edrpou: main.edrpou ?? other.edrpou,
          createdAt: main.createdAt < other.createdAt ? main.createdAt : other.createdAt,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, main.id));
      return true;
    });
    if (r === false) return reply.code(404).send({ error: "not_found" });
    if (r === null) return reply.code(409).send({ error: "anonymized" });
    await audit(req, "customer.merge", a.userId, { customer: req.params.id, other: p.data.other }, a.org);
    return { ok: true };
  });

  /**
   * The customer asked to delete their data: name, phones, email, company, address and notes are wiped from
   * the customer and all their orders; the orders stay as numbers. Cannot be undone; owner only.
   */
  app.post<{ Params: { id: string } }>("/:id/anonymize", async (req, reply) => {
    const a = await access(req);
    if (!a?.owner || !z.string().uuid().safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    const done = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(customers).where(and(eq(customers.id, req.params.id), eq(customers.organizationId, a.org))).for("update");
      if (!c) return false;
      const gone = "Знеособлено";
      await tx
        .update(orders)
        .set({ customerName: gone, customerPhone: "", customerEmail: null, comment: null, delivery: dsql`jsonb_build_object('method', ${orders.delivery}->>'method')`, ip: null, updatedAt: new Date() })
        .where(eq(orders.customerId, c.id));
      await tx.delete(customerNotes).where(eq(customerNotes.customerId, c.id));
      await tx
        .update(customers)
        .set({ name: gone, phone: null, phoneKey: null, extraPhones: [], email: null, company: null, edrpou: null, delivery: null, tags: [], anonymizedAt: new Date(), updatedAt: new Date() })
        .where(eq(customers.id, c.id));
      return true;
    });
    if (!done) return reply.code(404).send({ error: "not_found" });
    await audit(req, "customer.anonymize", a.userId, { customer: req.params.id }, a.org);
    return { ok: true };
  });

  /**
   * Import from Excel (saved as CSV, «;» or «,»): Ім'я, Телефон, Пошта, Компанія, Мітки, Нотатка. A known phone
   * fills empty fields of that customer; a new one is created. Rows without a proper phone are listed back.
   */
  app.post("/import", { bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const a = await access(req);
    const p = z.object({ csv: z.string().max(1_500_000) }).safeParse(req.body);
    if (!a) return reply.code(403).send({ error: "forbidden" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const lines = p.data.csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return reply.code(400).send({ error: "empty" });
    const sep = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
    const parse = (l: string) => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i]!;
        if (q) {
          if (ch === '"' && l[i + 1] === '"') (cur += '"'), i++;
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === sep) out.push(cur.trim()), (cur = "");
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const head = parse(lines[0]!).map((h) => h.toLowerCase());
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
    const iName = col("ім", "им", "name", "піб");
    const iPhone = col("тел", "phone");
    const iEmail = col("пошт", "email", "e-mail");
    const iCompany = col("компан", "company");
    const iTags = col("міт", "tag");
    const iNote = col("нотат", "комент", "note");
    if (iPhone < 0) return reply.code(400).send({ error: "no_phone_column" });
    const { tags: own } = await customerSettingsOf(a.org);
    const tagIds = new Map<string, string>([["vip", "vip"], ["опт", "wholesale"], ["wholesale", "wholesale"], ...own.map((t) => [t.name.toLowerCase(), t.id] as [string, string])]);
    let created = 0;
    let updated = 0;
    const skipped: number[] = [];
    for (const [n, line] of lines.slice(1, 5001).entries()) {
      const v = parse(line);
      const phone = v[iPhone] ?? "";
      let key = phone.replace(/\D/g, "");
      if (key.length === 10 && key.startsWith("0")) key = `38${key}`;
      else if (key.length === 9) key = `380${key}`;
      if (key.length < 11 || key.length > 15) {
        skipped.push(n + 2);
        continue;
      }
      const tags = (iTags >= 0 ? (v[iTags] ?? "").split(/[,|]/) : []).map((t) => tagIds.get(t.trim().toLowerCase())).filter((x): x is string => !!x);
      const [known] = await db.select().from(customers).where(and(eq(customers.organizationId, a.org), dsql`(${customers.phoneKey} = ${key} or ${key} = any(${customers.extraPhones}))`));
      let id = known?.id;
      if (known) {
        await db
          .update(customers)
          .set({ email: known.email ?? (v[iEmail] || null), company: known.company ?? (v[iCompany] || null), tags: [...new Set([...known.tags, ...tags])], updatedAt: new Date() })
          .where(eq(customers.id, known.id));
        updated++;
      } else {
        const [c] = await db
          .insert(customers)
          .values({ organizationId: a.org, name: (iName >= 0 && v[iName]) || phone, phoneKey: key, phone, email: (iEmail >= 0 && v[iEmail]) || null, company: (iCompany >= 0 && v[iCompany]) || null, tags, firstSource: "import" })
          .returning({ id: customers.id });
        id = c!.id;
        created++;
      }
      if (iNote >= 0 && v[iNote]) await db.insert(customerNotes).values({ customerId: id!, userId: a.userId, text: v[iNote]!.slice(0, 2000) });
    }
    await audit(req, "customer.import", a.userId, { created, updated, skipped: skipped.length }, a.org);
    return { created, updated, skipped };
  });

  /** The whole base as a CSV for Excel: owner only (protecting the base). */
  app.get("/export", async (req, reply) => {
    const a = await access(req);
    if (!a?.owner) return reply.code(403).send({ error: "forbidden" });
    const { tags: own } = await customerSettingsOf(a.org);
    const tagName = (t: string) => own.find((x) => x.id === t)?.name ?? ({ vip: "VIP", wholesale: "Опт" } as Record<string, string>)[t] ?? t;
    const rows = await db.execute<{ name: string; phone: string | null; email: string | null; company: string | null; tags: string[]; city: string | null; orders: number | null; sum_kop: number | null; last_at: string | null }>(dsql`
      with s as (${statsSql(a.org)})
      select c.name, c.phone, c.email, c.company, c.tags, c.delivery->>'city' as city, s.orders, s.sum_kop, s.last_at
      from customers c left join s on s.customer_id = c.id
      where c.organization_id = ${a.org} and c.anonymized_at is null order by c.created_at`);
    const cell = (v: unknown) => {
      const x = String(v ?? "");
      return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    const lines = rows.map((r) => [r.name, r.phone, r.email, r.company, r.tags.map(tagName).join(", "), r.city, r.orders ?? 0, ((r.sum_kop ?? 0) / 100).toFixed(2).replace(".", ","), r.last_at ? new Date(r.last_at).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" }) : ""].map(cell).join(";"));
    await audit(req, "customer.export", a.userId, { n: rows.length }, a.org);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(`\uFEFF${["Ім'я;Телефон;Пошта;Компанія;Мітки;Місто;Замовлень;Сума, грн;Останнє замовлення", ...lines].join("\r\n")}`);
  });
};
