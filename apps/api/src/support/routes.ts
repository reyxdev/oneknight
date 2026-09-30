import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { notifications, organizations, replyTemplates, ticketMessages, tickets, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { orgScope } from "../auth/access.ts";
import { isTestContact, notifyOwner } from "../notify/telegram.ts";
import { audit } from "../audit.ts";
import { Upload, saveImage } from "../files/store.ts";

const categories = ["bug", "question", "change", "oneknight", "site", "other"] as const;
const NewTicket = z.object({ category: z.enum(categories), text: z.string().trim().min(5).max(5000), attachment: Upload.optional() });
const Reply = z.object({ text: z.string().trim().min(1).max(5000), attachment: Upload.optional() });
const uuid = z.string().uuid();
const big = { bodyLimit: 7 * 1024 * 1024 };

async function thread(ticketId: string) {
  return db
    .select({ id: ticketMessages.id, staff: ticketMessages.staff, body: ticketMessages.body, fileId: ticketMessages.fileId, at: ticketMessages.createdAt, author: users.name })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorId))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(ticketMessages.createdAt);
}

/** Client side: /api/tickets. */
export const supportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.post("/", { ...big, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const p = NewTicket.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [org] = await orgScope(req, "support");
    if (!org) return reply.code(404).send({ error: "not_found" });
    let fileId: string | null = null;
    if (p.data.attachment) {
      const f = await saveImage(p.data.attachment, { organizationId: org, uploaderId: req.auth!.user.id });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      fileId = f.file.id;
    }
    const [t] = await db.insert(tickets).values({ organizationId: org, userId: req.auth!.user.id, category: p.data.category }).returning();
    await db.insert(ticketMessages).values({ ticketId: t!.id, authorId: req.auth!.user.id, body: p.data.text, fileId });
    await audit(req, "ticket.create", req.auth!.user.id, { ticket: t!.id }, org);
    void notifyOwner(`🛟 Звернення #${t!.number} (${p.data.category})\n${req.auth!.user.name}: ${p.data.text.slice(0, 300)}`, req.log, { testContact: isTestContact(req.auth!.user.email) });
    return reply.code(201).send({ id: t!.id, number: t!.number, status: t!.status });
  });

  app.get("/", async (req) => {
    const orgs = await orgScope(req, "support");
    if (!orgs.length) return [];
    return db.select().from(tickets).where(inArray(tickets.organizationId, orgs)).orderBy(desc(tickets.updatedAt)).limit(50);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    const orgs = await orgScope(req, "support");
    const [t] = orgs.length ? await db.select().from(tickets).where(and(eq(tickets.id, req.params.id), inArray(tickets.organizationId, orgs))) : [];
    if (!t) return reply.code(404).send({ error: "not_found" });
    return { ...t, messages: await thread(t.id) };
  });

  app.post<{ Params: { id: string } }>("/:id/messages", { ...big, config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const p = Reply.safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const orgs = await orgScope(req, "support");
    const [t] = orgs.length ? await db.select().from(tickets).where(and(eq(tickets.id, req.params.id), inArray(tickets.organizationId, orgs))) : [];
    if (!t) return reply.code(404).send({ error: "not_found" });
    let fileId: string | null = null;
    if (p.data.attachment) {
      const f = await saveImage(p.data.attachment, { organizationId: t.organizationId, uploaderId: req.auth!.user.id });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      fileId = f.file.id;
    }
    await db.insert(ticketMessages).values({ ticketId: t.id, authorId: req.auth!.user.id, body: p.data.text, fileId });
    await db.update(tickets).set({ status: "open", updatedAt: new Date() }).where(eq(tickets.id, t.id));
    void notifyOwner(`🛟 Звернення #${t.number}: нове повідомлення\n${req.auth!.user.name}: ${p.data.text.slice(0, 300)}`, req.log, { testContact: isTestContact(req.auth!.user.email) });
    return { ok: true };
  });
};

/** Admin side: /api/admin/tickets. Registered inside the admin plugin (admin check applies). */
export const supportAdminRoutes: FastifyPluginAsync = async (app) => {
  /**
   * The queue: open requests first, businesses with a support contract first among them, then the longest
   * waiting. `waitingSince`: the client's first message after our last reply (the timer).
   */
  app.get("/", async () => {
    const rows = await db
      .select({
        id: tickets.id,
        number: tickets.number,
        category: tickets.category,
        status: tickets.status,
        updatedAt: tickets.updatedAt,
        createdAt: tickets.createdAt,
        org: organizations.name,
        contract: organizations.supportContract,
        waitingSince: dsql<Date | null>`(select min(m.created_at) from ticket_messages m where m.ticket_id = ${tickets.id} and not m.staff and m.created_at > coalesce((select max(s.created_at) from ticket_messages s where s.ticket_id = ${tickets.id} and s.staff), 'epoch'))`,
      })
      .from(tickets)
      .innerJoin(organizations, eq(organizations.id, tickets.organizationId))
      .orderBy(desc(tickets.updatedAt))
      .limit(200);
    const rank = (r: (typeof rows)[number]) => (r.status === "open" ? 0 : r.status === "answered" ? 1 : 2);
    return rows.sort((x, y) => rank(x) - rank(y) || Number(y.contract) - Number(x.contract) || (x.status === "open" ? new Date(x.waitingSince ?? x.updatedAt).getTime() - new Date(y.waitingSince ?? y.updatedAt).getTime() : 0));
  });

  /** Ready answers; {name} and {n} are filled in the panel. */
  app.get("/templates", async () => db.select().from(replyTemplates).orderBy(asc(replyTemplates.sort), asc(replyTemplates.createdAt)));
  const Template = z.object({ title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(3000), sort: z.number().int().optional() });
  app.post("/templates", async (req, reply) => {
    const p = Template.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.insert(replyTemplates).values(p.data).returning();
    return reply.code(201).send(row);
  });
  app.patch<{ Params: { id: string } }>("/templates/:id", async (req, reply) => {
    const p = Template.partial().safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(replyTemplates).set(p.data).where(eq(replyTemplates.id, req.params.id)).returning();
    return row ?? reply.code(404).send({ error: "not_found" });
  });
  app.delete<{ Params: { id: string } }>("/templates/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    await db.delete(replyTemplates).where(eq(replyTemplates.id, req.params.id));
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    const [t] = await db.select().from(tickets).where(eq(tickets.id, req.params.id));
    if (!t) return reply.code(404).send({ error: "not_found" });
    return { ...t, messages: await thread(t.id) };
  });
  app.post<{ Params: { id: string } }>("/:id/messages", big, async (req, reply) => {
    const p = Reply.safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [t] = await db.select().from(tickets).where(eq(tickets.id, req.params.id));
    if (!t) return reply.code(404).send({ error: "not_found" });
    let fileId: string | null = null;
    if (p.data.attachment) {
      const f = await saveImage(p.data.attachment, { organizationId: t.organizationId, uploaderId: req.auth!.user.id });
      if (!f.ok) return reply.code(400).send({ error: f.error });
      fileId = f.file.id;
    }
    await db.insert(ticketMessages).values({ ticketId: t.id, authorId: req.auth!.user.id, staff: true, body: p.data.text, fileId });
    await db.update(tickets).set({ status: "answered", updatedAt: new Date() }).where(eq(tickets.id, t.id));
    await db.insert(notifications).values({ organizationId: t.organizationId, kind: "ticket", key: "ticketAnswered", params: { n: t.number } });
    return { ok: true };
  });
  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const p = z.object({ status: z.enum(["open", "answered", "closed"]) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    await db.update(tickets).set({ status: p.data.status, updatedAt: new Date() }).where(eq(tickets.id, req.params.id));
    return { ok: true };
  });
};
