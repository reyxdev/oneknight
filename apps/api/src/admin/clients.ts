import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { ledgerEntries, memberships, notifications, orgNotes, organizations, sessions, sites, subscriptions, users } from "../db/schema.ts";
import { audit } from "../audit.ts";
import { DELETE_AFTER_DAYS, balanceKop, billingOverview } from "../billing/service.ts";

const uuid = z.string().uuid();
const DAY = 86_400_000;

/**
 * «Бізнеси» for the admin: the table (owner, state, balance, modules, last login, orders in 30 days, tags, contract),
 * the card (team, billing, notes), a balance adjustment with a reason, and looking at the client's panel read only.
 */
export const adminClientRoutes: FastifyPluginAsync = async (app) => {
  app.get("/clients", async () => {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const rows = await db.execute<{
      id: string; name: string; created_at: Date; admin_tags: string[]; support_contract: boolean; purged_at: Date | null;
      owner_name: string | null; owner_email: string | null; owner_phone: string | null;
      status: string | null; period_end: Date | null; balance: number; modules: number; last_seen: Date | null; orders30: number; notes: number;
    }>(dsql`
      select o.id, o.name, o.created_at, o.admin_tags, o.support_contract, o.purged_at,
        u.name as owner_name, u.email as owner_email, u.phone as owner_phone,
        s.status, s.period_end,
        coalesce((select sum(l.amount_kop) from ledger_entries l where l.organization_id = o.id), 0)::int as balance,
        (select count(*) from module_installs mi where mi.organization_id = o.id)::int as modules,
        (select max(se.last_seen_at) from sessions se join memberships mm on mm.user_id = se.user_id where mm.organization_id = o.id) as last_seen,
        (select count(*) from orders od where od.organization_id = o.id and not od.is_example and od.created_at > ${since}::timestamptz)::int as orders30,
        (select count(*) from org_notes n where n.organization_id = o.id)::int as notes
      from organizations o
      left join memberships m on m.organization_id = o.id and m.role = 'owner'
      left join users u on u.id = m.user_id
      left join subscriptions s on s.organization_id = o.id
      order by o.created_at desc`);
    return [...rows].map((r) => ({
      id: r.id, name: r.name, createdAt: r.created_at, tags: r.admin_tags, contract: r.support_contract, purgedAt: r.purged_at,
      owner: { name: r.owner_name, email: r.owner_email, phone: r.owner_phone },
      status: r.status, periodEnd: r.period_end, balanceKop: Number(r.balance), modules: r.modules, lastSeen: r.last_seen, orders30: r.orders30, notes: r.notes,
    }));
  });

  /** The card: team, billing (balance, next charge, ledger), notes. */
  app.get<{ Params: { id: string } }>("/clients/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [org] = await db.select({ id: organizations.id, name: organizations.name, tags: organizations.adminTags, contract: organizations.supportContract, features: organizations.features, createdAt: organizations.createdAt, purgedAt: organizations.purgedAt }).from(organizations).where(eq(organizations.id, req.params.id));
    if (!org) return reply.code(404).send({ error: "not_found" });
    const team = await db
      .select({ name: users.name, email: users.email, phone: users.phone, role: memberships.role, lastSeen: dsql<Date | null>`(select max(s.last_seen_at) from sessions s where s.user_id = ${users.id})` })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, org.id));
    const notes = await db.select({ id: orgNotes.id, text: orgNotes.text, at: orgNotes.createdAt, by: users.name }).from(orgNotes).leftJoin(users, eq(users.id, orgNotes.userId)).where(eq(orgNotes.organizationId, org.id)).orderBy(desc(orgNotes.createdAt));
    const siteList = await db.select({ id: sites.id, domain: sites.domain, status: sites.status, lastUp: sites.lastUp }).from(sites).where(eq(sites.organizationId, org.id));
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org.id));
    const deletable = !org.purgedAt && sub?.status === "suspended" && !!sub.suspendedAt && Date.now() - sub.suspendedAt.getTime() >= DELETE_AFTER_DAYS * DAY;
    return { ...org, team, notes, sites: siteList, deletable, billing: await billingOverview(org.id) };
  });

  app.patch<{ Params: { id: string } }>("/clients/:id", async (req, reply) => {
    const p = z.object({ tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(), contract: z.boolean().optional(), features: z.array(z.enum(["content"])).max(5).optional() }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db
      .update(organizations)
      .set({ ...(p.data.tags ? { adminTags: [...new Set(p.data.tags)] } : {}), ...(p.data.contract !== undefined ? { supportContract: p.data.contract } : {}), ...(p.data.features ? { features: [...new Set(p.data.features)] } : {}) })
      .where(eq(organizations.id, req.params.id))
      .returning({ id: organizations.id, tags: organizations.adminTags, contract: organizations.supportContract, features: organizations.features });
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (p.data.contract !== undefined) await audit(req, "admin.support_contract", req.auth!.user.id, { contract: p.data.contract }, row.id);
    return row;
  });

  app.post<{ Params: { id: string } }>("/clients/:id/notes", async (req, reply) => {
    const p = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [n] = await db.insert(orgNotes).values({ organizationId: req.params.id, userId: req.auth!.user.id, text: p.data.text }).returning();
    return reply.code(201).send(n);
  });

  /**
   * «Коригування балансу»: plus or minus with a reason. The client sees it in «Оплата» with that reason and gets a
   * notification; the admin's action is in the log.
   */
  app.post<{ Params: { id: string } }>("/clients/:id/adjust", async (req, reply) => {
    const p = z.object({ amountUah: z.number().min(-100_000).max(100_000).refine((v) => v !== 0), reason: z.string().trim().min(3).max(200) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, req.params.id));
    if (!org) return reply.code(404).send({ error: "not_found" });
    const amountKop = Math.round(p.data.amountUah * 100);
    await db.insert(ledgerEntries).values({ organizationId: org.id, kind: "adjustment", amountKop, reason: p.data.reason, createdBy: req.auth!.user.id, meta: { by: "admin" } });
    await db.insert(notifications).values({ organizationId: org.id, kind: "billing", key: "balanceAdjusted", params: { amount: amountKop / 100, reason: p.data.reason } });
    await audit(req, "admin.balance_adjust", req.auth!.user.id, { amountKop, reason: p.data.reason }, org.id);
    return { balanceKop: await balanceKop(org.id) };
  });

  /** «Переглянути кабінет»: the admin's session shows the client's panel read only (2 hours at most), logged. */
  app.post<{ Params: { id: string } }>("/view/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, req.params.id));
    if (!org) return reply.code(404).send({ error: "not_found" });
    await db.update(sessions).set({ viewOrgId: org.id, viewStartedAt: new Date() }).where(eq(sessions.idHash, req.auth!.sessionHash));
    await audit(req, "admin.view_start", req.auth!.user.id, { name: org.name }, org.id);
    return { ok: true };
  });

  app.post("/view/stop", async (req) => {
    const [s] = await db.select({ org: sessions.viewOrgId }).from(sessions).where(and(eq(sessions.idHash, req.auth!.sessionHash), gt(sessions.viewStartedAt, new Date(0))));
    await db.update(sessions).set({ viewOrgId: null, viewStartedAt: null }).where(eq(sessions.idHash, req.auth!.sessionHash));
    if (s?.org) await audit(req, "admin.view_stop", req.auth!.user.id, {}, s.org);
    return { ok: true };
  });
};
