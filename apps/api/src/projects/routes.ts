import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lte, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { leadNotes, leads, notifications, organizations, projectComments, projectItems, projects, sites, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { Upload, saveImage } from "../files/store.ts";
import { normalizeDomain } from "../monitor/probe.ts";
import { startTrial } from "../billing/service.ts";
import { notifyOwner } from "../notify/telegram.ts";
import { LEAD_CONTACT_HOURS, workingHours } from "../admin/overview.ts";

const uuid = z.string().uuid();
const DAY = 86_400_000;
export const STAGES = ["brief", "design", "development", "content", "launch", "done"] as const;
const STAGE_UK: Record<string, string> = { brief: "Бриф", design: "Дизайн", development: "Розробка", content: "Наповнення", launch: "Запуск", done: "Готово" };
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
type Log = { warn: (o: object, m: string) => void };

const LEAD_STATUSES = ["new", "contacted", "proposal", "prepaid", "in_work", "done", "lost"] as const;

/** The client's view of a project: no invitation token, stages with their approvals. */
async function projectView(id: string, forAdmin: boolean) {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) return null;
  const items = await db.select().from(projectItems).where(eq(projectItems.projectId, id)).orderBy(asc(projectItems.createdAt));
  const comments = await db
    .select({ id: projectComments.id, kind: projectComments.kind, text: projectComments.text, fromAdmin: projectComments.fromAdmin, fileId: projectComments.fileId, at: projectComments.createdAt, by: users.name })
    .from(projectComments)
    .leftJoin(users, eq(users.id, projectComments.userId))
    .where(eq(projectComments.projectId, id))
    .orderBy(asc(projectComments.createdAt));
  const { inviteTokenHash, deadlineNotified: _d, ...rest } = p;
  const org = forAdmin && p.organizationId ? (await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.organizationId)))[0]?.name ?? null : undefined;
  return {
    ...rest,
    ...(forAdmin ? { invitePending: !!inviteTokenHash && !p.organizationId, organization: org } : {}),
    paidKop: p.payments.filter((x) => x.paidAt).reduce((s, x) => s + x.amountKop, 0),
    items: items.map((i) => ({ ...i, files: i.files.map((f) => ({ id: f, url: `/api/files/${f}` })) })),
    comments: comments.map((c) => ({ ...c, file: c.fileId ? `/api/files/${c.fileId}` : null })),
  };
}

async function tellClient(orgId: string | null, key: string, params: Record<string, unknown>) {
  if (orgId) await db.insert(notifications).values({ organizationId: orgId, kind: "site", key, params });
}

/** Admin part (inside /api/admin): leads funnel, notes, reminders, projects. */
export const projectAdminRoutes: FastifyPluginAsync = async (app) => {
  /** Leads with the number of notes and their project. */
  app.get("/leads", async () => {
    const rows = await db.select().from(leads).orderBy(desc(leads.createdAt)).limit(300);
    const notes = await db.select({ leadId: leadNotes.leadId, n: dsql<number>`count(*)`.mapWith(Number) }).from(leadNotes).groupBy(leadNotes.leadId);
    const proj = await db.select({ id: projects.id, number: projects.number, leadId: projects.leadId }).from(projects).where(isNotNull(projects.leadId));
    const now = new Date();
    return rows.map((l) => ({ ...l, ip: undefined, notes: notes.find((n) => n.leadId === l.id)?.n ?? 0, project: proj.find((p) => p.leadId === l.id) ?? null, late: l.status === "new" && workingHours(l.createdAt, now) >= LEAD_CONTACT_HOURS }));
  });

  app.get<{ Params: { id: string } }>("/leads/:id/notes", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    return db.select({ id: leadNotes.id, text: leadNotes.text, at: leadNotes.createdAt, by: users.name }).from(leadNotes).leftJoin(users, eq(users.id, leadNotes.userId)).where(eq(leadNotes.leadId, req.params.id)).orderBy(desc(leadNotes.createdAt));
  });

  app.post<{ Params: { id: string } }>("/leads/:id/notes", async (req, reply) => {
    const p = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [n] = await db.insert(leadNotes).values({ leadId: req.params.id, userId: req.auth!.user.id, text: p.data.text }).returning();
    return reply.code(201).send(n);
  });

  /** Status (a lost lead may keep its reason) and the reminder. */
  const LeadPatch = z.object({
    status: z.enum(LEAD_STATUSES).optional(),
    lostReason: z.string().trim().max(300).nullable().optional(),
    remindAt: z.string().datetime({ offset: true }).nullable().optional(),
    remindText: z.string().trim().max(300).nullable().optional(),
  });
  app.patch<{ Params: { id: string } }>("/leads/:id", async (req, reply) => {
    const p = LeadPatch.safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const set = {
      ...(p.data.status ? { status: p.data.status } : {}),
      ...(p.data.lostReason !== undefined ? { lostReason: p.data.lostReason } : {}),
      ...(p.data.remindAt !== undefined ? { remindAt: p.data.remindAt ? new Date(p.data.remindAt) : null, remindSent: false } : {}),
      ...(p.data.remindText !== undefined ? { remindText: p.data.remindText } : {}),
      updatedAt: new Date(),
    };
    const [row] = await db.update(leads).set(set).where(eq(leads.id, req.params.id)).returning({ id: leads.id, status: leads.status });
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (p.data.status) await audit(req, "lead.status", req.auth!.user.id, { lead: row.id, status: row.status });
    return row;
  });

  /**
   * «Почати проєкт»: a project from the lead. A client with an account gets it in «Послуги» at once; otherwise the
   * answer has a one-time invitation link (Ivan sends it in a messenger), registering with it joins the project.
   */
  app.post<{ Params: { id: string } }>("/leads/:id/project", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [l] = await db.select().from(leads).where(eq(leads.id, req.params.id));
    if (!l) return reply.code(404).send({ error: "not_found" });
    const [had] = await db.select({ id: projects.id }).from(projects).where(eq(projects.leadId, l.id));
    if (had) return reply.code(409).send({ error: "project_exists", id: had.id });
    const token = l.organizationId ? null : randomBytes(24).toString("base64url");
    const title = String((l.brief as { business?: string }).business ?? l.name).slice(0, 120);
    const [p] = await db.insert(projects).values({ leadId: l.id, organizationId: l.organizationId, title, inviteTokenHash: token ? hash(token) : null }).returning({ id: projects.id, number: projects.number });
    await db.update(leads).set({ status: "in_work", updatedAt: new Date() }).where(eq(leads.id, l.id));
    await audit(req, "project.create", req.auth!.user.id, { project: p!.id, lead: l.id });
    return reply.code(201).send({ ...p, invite: token });
  });

  app.get("/projects", async () => {
    const rows = await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(200);
    const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
    return rows.map(({ inviteTokenHash, ...p }) => ({ ...p, organization: orgs.find((o) => o.id === p.organizationId)?.name ?? null, invitePending: !!inviteTokenHash && !p.organizationId, paidKop: p.payments.filter((x) => x.paidAt).reduce((s, x) => s + x.amountKop, 0) }));
  });

  app.get<{ Params: { id: string } }>("/projects/:id", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    return (await projectView(req.params.id, true)) ?? reply.code(404).send({ error: "not_found" });
  });

  /** A new invitation link (the old one stops working). */
  app.post<{ Params: { id: string } }>("/projects/:id/invite", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const token = randomBytes(24).toString("base64url");
    const [p] = await db.update(projects).set({ inviteTokenHash: hash(token) }).where(and(eq(projects.id, req.params.id), isNull(projects.organizationId))).returning({ id: projects.id });
    return p ? { invite: token } : reply.code(409).send({ error: "already_joined" });
  });

  const Payment = z.object({ id: z.string().max(40).optional(), label: z.string().trim().min(1).max(100), amountKop: z.number().int().min(0).max(100_000_000), paidAt: z.string().max(40).nullable() });
  const ProjectPatch = z.object({
    title: z.string().trim().min(1).max(120).optional(),
    domain: z.string().max(260).nullable().optional(),
    stage: z.enum(STAGES).optional(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    amountKop: z.number().int().min(0).max(100_000_000).nullable().optional(),
    payments: z.array(Payment).max(20).optional(),
  });
  /** Ivan's changes; moving the stage is logged in the project's history for the client. */
  app.patch<{ Params: { id: string } }>("/projects/:id", async (req, reply) => {
    const p = ProjectPatch.safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [cur] = await db.select().from(projects).where(eq(projects.id, req.params.id));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    const domain = p.data.domain === undefined ? undefined : p.data.domain ? normalizeDomain(p.data.domain) : null;
    if (p.data.domain && !domain) return reply.code(400).send({ error: "invalid_domain" });
    await db
      .update(projects)
      .set({
        ...(p.data.title ? { title: p.data.title } : {}),
        ...(domain !== undefined ? { domain } : {}),
        ...(p.data.stage && p.data.stage !== cur.stage ? { stage: p.data.stage, awaiting: false } : {}),
        ...(p.data.deadline !== undefined ? { deadline: p.data.deadline, deadlineNotified: null } : {}),
        ...(p.data.amountKop !== undefined ? { amountKop: p.data.amountKop } : {}),
        ...(p.data.payments ? { payments: p.data.payments.map((x) => ({ ...x, id: x.id ?? randomUUID() })) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, cur.id));
    if (p.data.stage && p.data.stage !== cur.stage) await db.insert(projectComments).values({ projectId: cur.id, userId: req.auth!.user.id, fromAdmin: true, kind: "stage", text: p.data.stage });
    return projectView(cur.id, true);
  });

  /** «На погодження»: the current stage is ready; the client approves it or asks for changes. */
  app.post<{ Params: { id: string } }>("/projects/:id/ready", async (req, reply) => {
    const p = z.object({ text: z.string().trim().max(2000).default("") }).safeParse(req.body ?? {});
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [cur] = await db.update(projects).set({ awaiting: true, updatedAt: new Date() }).where(eq(projects.id, req.params.id)).returning();
    if (!cur) return reply.code(404).send({ error: "not_found" });
    await db.insert(projectComments).values({ projectId: cur.id, userId: req.auth!.user.id, fromAdmin: true, kind: "ready", text: p.data.text });
    await tellClient(cur.organizationId, "projectReady", { n: cur.number, stage: STAGE_UK[cur.stage] });
    return projectView(cur.id, true);
  });

  app.post<{ Params: { id: string } }>("/projects/:id/items", async (req, reply) => {
    const p = z.object({ text: z.string().trim().min(1).max(300) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    await db.insert(projectItems).values({ projectId: req.params.id, text: p.data.text });
    return reply.code(201).send(await projectView(req.params.id, true));
  });

  app.delete<{ Params: { id: string; item: string } }>("/projects/:id/items/:item", async (req, reply) => {
    if (!uuid.safeParse(req.params.item).success) return reply.code(400).send({ error: "invalid_input" });
    await db.delete(projectItems).where(and(eq(projectItems.id, req.params.item), eq(projectItems.projectId, req.params.id)));
    return projectView(req.params.id, true);
  });

  app.post<{ Params: { id: string } }>("/projects/:id/comments", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const p = z.object({ text: z.string().trim().max(4000).default(""), file: Upload.optional() }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success || (!p.data.text && !p.data.file)) return reply.code(400).send({ error: "invalid_input" });
    const [cur] = await db.select().from(projects).where(eq(projects.id, req.params.id));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    const file = p.data.file ? await saveImage(p.data.file, { organizationId: cur.organizationId, uploaderId: req.auth!.user.id }) : null;
    if (file && !file.ok) return reply.code(400).send({ error: file.error });
    await db.insert(projectComments).values({ projectId: cur.id, userId: req.auth!.user.id, fromAdmin: true, text: p.data.text, fileId: file?.ok ? file.file.id : null });
    await tellClient(cur.organizationId, "projectComment", { n: cur.number });
    return reply.code(201).send(await projectView(cur.id, true));
  });

  /**
   * «Запустити»: the project is done; the website goes to the client's «Сайт» with monitoring and ONEKNIGHT opens
   * free for 3 months (with up to 5 modules), as for every website from us.
   */
  app.post<{ Params: { id: string } }>("/projects/:id/launch", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [cur] = await db.select().from(projects).where(eq(projects.id, req.params.id));
    if (!cur) return reply.code(404).send({ error: "not_found" });
    if (!cur.organizationId) return reply.code(409).send({ error: "no_client" });
    if (cur.launchedAt) return reply.code(409).send({ error: "already_launched" });
    if (cur.domain) await db.insert(sites).values({ organizationId: cur.organizationId, domain: cur.domain, name: cur.title, status: "live", verifiedAt: new Date() }).onConflictDoNothing();
    const until = await startTrial(cur.organizationId);
    await db.update(projects).set({ stage: "done", awaiting: false, launchedAt: new Date(), updatedAt: new Date() }).where(eq(projects.id, cur.id));
    await db.insert(projectComments).values({ projectId: cur.id, userId: req.auth!.user.id, fromAdmin: true, kind: "launched", text: cur.domain ?? "" });
    if (cur.leadId) await db.update(leads).set({ status: "done", updatedAt: new Date() }).where(eq(leads.id, cur.leadId));
    await tellClient(cur.organizationId, "projectLaunched", { n: cur.number, domain: cur.domain ?? cur.title });
    await audit(req, "project.launch", req.auth!.user.id, { project: cur.id, until }, cur.organizationId);
    return projectView(cur.id, true);
  });
};

/** Client part: /api/projects — the business's own projects in «Послуги». */
export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);
  async function own(req: FastifyRequest, id: string) {
    const m = await activeMembership(req);
    if (!m || !uuid.safeParse(id).success) return null;
    const [p] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.organizationId, m.orgId)));
    return p ?? null;
  }

  app.get("/", async (req) => {
    const m = await activeMembership(req);
    if (!m) return [];
    const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, m.orgId)).orderBy(desc(projects.createdAt));
    return Promise.all(rows.map((r) => projectView(r.id, false)));
  });

  /** Joining by the invitation link (after registering or logging in). */
  app.post("/claim", async (req, reply) => {
    const p = z.object({ token: z.string().min(20).max(100) }).safeParse(req.body);
    const m = await activeMembership(req);
    if (!p.success || !m) return reply.code(400).send({ error: "invalid_input" });
    if (m.role !== "owner") return reply.code(403).send({ error: "forbidden" });
    const [row] = await db.update(projects).set({ organizationId: m.orgId, inviteTokenHash: null, updatedAt: new Date() }).where(and(eq(projects.inviteTokenHash, hash(p.data.token)), isNull(projects.organizationId))).returning();
    if (!row) return reply.code(404).send({ error: "invalid_link" });
    if (row.leadId) await db.update(leads).set({ organizationId: m.orgId, userId: req.auth!.user.id }).where(eq(leads.id, row.leadId));
    await audit(req, "project.join", req.auth!.user.id, { project: row.id }, m.orgId);
    return projectView(row.id, false);
  });

  /** «Погодити»: the stage is approved, the project moves to the next one. */
  app.post<{ Params: { id: string } }>("/:id/approve", async (req, reply) => {
    const cur = await own(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    if (!cur.awaiting) return reply.code(409).send({ error: "not_awaiting" });
    const next = STAGES[Math.min(STAGES.indexOf(cur.stage) + 1, STAGES.indexOf("launch"))]!;
    const approvals = { ...cur.approvals, [cur.stage]: { ...cur.approvals[cur.stage], approvedAt: new Date().toISOString() } };
    await db.update(projects).set({ approvals, stage: cur.stage === "launch" ? "launch" : next, awaiting: false, updatedAt: new Date() }).where(eq(projects.id, cur.id));
    await db.insert(projectComments).values({ projectId: cur.id, userId: req.auth!.user.id, kind: "approved", text: cur.stage });
    await notifyOwner(`✅ Проєкт №${cur.number} «${cur.title}»: клієнт погодив етап «${STAGE_UK[cur.stage]}»`, req.log);
    return projectView(cur.id, false);
  });

  /** «Потрібні правки»: back to work on the same stage, with what to change; the rounds are counted. */
  app.post<{ Params: { id: string } }>("/:id/changes", async (req, reply) => {
    const p = z.object({ text: z.string().trim().min(3).max(4000) }).safeParse(req.body);
    const cur = await own(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    if (!cur.awaiting) return reply.code(409).send({ error: "not_awaiting" });
    const revisions = (cur.approvals[cur.stage]?.revisions ?? 0) + 1;
    await db.update(projects).set({ approvals: { ...cur.approvals, [cur.stage]: { ...cur.approvals[cur.stage], revisions } }, awaiting: false, updatedAt: new Date() }).where(eq(projects.id, cur.id));
    await db.insert(projectComments).values({ projectId: cur.id, userId: req.auth!.user.id, kind: "changes", text: p.data.text });
    await notifyOwner(`✏️ Проєкт №${cur.number} «${cur.title}»: правки до етапу «${STAGE_UK[cur.stage]}» (${revisions}-й раз)\n${p.data.text.slice(0, 500)}`, req.log);
    return projectView(cur.id, false);
  });

  app.post<{ Params: { id: string } }>("/:id/comments", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const p = z.object({ text: z.string().trim().max(4000).default(""), file: Upload.optional() }).safeParse(req.body);
    const cur = await own(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    if (!p.success || (!p.data.text && !p.data.file)) return reply.code(400).send({ error: "invalid_input" });
    const file = p.data.file ? await saveImage(p.data.file, { organizationId: cur.organizationId, uploaderId: req.auth!.user.id }) : null;
    if (file && !file.ok) return reply.code(400).send({ error: file.error });
    await db.insert(projectComments).values({ projectId: cur.id, userId: req.auth!.user.id, text: p.data.text, fileId: file?.ok ? file.file.id : null });
    await notifyOwner(`💬 Проєкт №${cur.number} «${cur.title}»: ${p.data.text.slice(0, 500) || "файл"}`, req.log);
    return reply.code(201).send(await projectView(cur.id, false));
  });

  /** A checklist item: done / not done, and files for it. */
  app.patch<{ Params: { id: string; item: string } }>("/:id/items/:item", { bodyLimit: 7 * 1024 * 1024 }, async (req, reply) => {
    const p = z.object({ done: z.boolean().optional(), file: Upload.optional() }).safeParse(req.body);
    const cur = await own(req, req.params.id);
    if (!cur) return reply.code(404).send({ error: "not_found" });
    if (!p.success || !uuid.safeParse(req.params.item).success) return reply.code(400).send({ error: "invalid_input" });
    const [item] = await db.select().from(projectItems).where(and(eq(projectItems.id, req.params.item), eq(projectItems.projectId, cur.id)));
    if (!item) return reply.code(404).send({ error: "not_found" });
    const file = p.data.file ? await saveImage(p.data.file, { organizationId: cur.organizationId, uploaderId: req.auth!.user.id }) : null;
    if (file && !file.ok) return reply.code(400).send({ error: file.error });
    await db.update(projectItems).set({ ...(p.data.done !== undefined ? { done: p.data.done } : {}), ...(file?.ok ? { files: [...item.files, file.file.id].slice(-20) } : {}) }).where(eq(projectItems.id, item.id));
    if (p.data.done) await notifyOwner(`📎 Проєкт №${cur.number}: клієнт виконав «${item.text}»`, req.log);
    return projectView(cur.id, false);
  });
};

/**
 * Hourly for Ivan's Telegram (each once): a new lead without an answer for 4 working hours, a lead reminder that
 * is due, a project deadline in 3 days and a missed one.
 */
export async function runAdminReminders(log: Log, now = new Date(), send: (text: string) => Promise<boolean> = (t) => notifyOwner(t, log)) {
  let sent = 0;
  for (const l of await db.select().from(leads).where(and(eq(leads.status, "new"), eq(leads.lateNotified, false)))) {
    if (workingHours(l.createdAt, now) < LEAD_CONTACT_HOURS) continue;
    await db.update(leads).set({ lateNotified: true }).where(eq(leads.id, l.id));
    if (await send(`⏰ Заявка #${l.number} (${l.name}, ${l.phone}) без відповіді понад ${LEAD_CONTACT_HOURS} робочі години`)) sent++;
  }
  for (const l of await db.select().from(leads).where(and(eq(leads.remindSent, false), lte(leads.remindAt, now)))) {
    await db.update(leads).set({ remindSent: true }).where(eq(leads.id, l.id));
    if (await send(`🔔 Нагадування: заявка #${l.number} (${l.name}, ${l.phone})${l.remindText ? `: ${l.remindText}` : ""}`)) sent++;
  }
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const in3 = new Date(now.getTime() + 3 * DAY).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  for (const p of await db.select().from(projects).where(and(isNotNull(projects.deadline), isNull(projects.launchedAt)))) {
    if (p.deadline! < today && p.deadlineNotified !== 0) {
      await db.update(projects).set({ deadlineNotified: 0 }).where(eq(projects.id, p.id));
      if (await send(`🚨 Проєкт №${p.number} «${p.title}»: дедлайн ${p.deadline} минув (етап «${STAGE_UK[p.stage]}»)`)) sent++;
    } else if (p.deadline! >= today && p.deadline! <= in3 && p.deadlineNotified === null) {
      await db.update(projects).set({ deadlineNotified: 3 }).where(eq(projects.id, p.id));
      if (await send(`📅 Проєкт №${p.number} «${p.title}»: дедлайн ${p.deadline} (етап «${STAGE_UK[p.stage]}»)`)) sent++;
    }
  }
  return sent;
}

/** For «Огляд»: projects whose deadline is within 3 days or missed, and lead reminders that are due. */
export async function adminDue(now = new Date()) {
  const in3 = new Date(now.getTime() + 3 * DAY).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const [d] = await db.select({ n: dsql<number>`count(*)`.mapWith(Number) }).from(projects).where(and(isNotNull(projects.deadline), isNull(projects.launchedAt), lte(projects.deadline, in3)));
  const [r] = await db.select({ n: dsql<number>`count(*)`.mapWith(Number) }).from(leads).where(and(lte(leads.remindAt, now), dsql`${leads.status} not in ('done', 'lost')`));
  return { deadlines: d!.n, reminders: r!.n };
}

