import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { invites, memberships, notifications, organizations, sessions, users } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { INVITE_ROLES, PERMISSIONS, orgScope, type Permission } from "../auth/access.ts";
import { randomToken, sha256 } from "../security/crypto.ts";
import { audit } from "../audit.ts";

const uuid = z.string().uuid();
const Perms = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);
const NewInvite = z.object({ role: z.enum(INVITE_ROLES), permissions: Perms, note: z.string().trim().max(100).optional() });
const Update = z.object({ role: z.enum(INVITE_ROLES).optional(), permissions: Perms.optional() });
const INVITE_DAYS = 7;

/** /api/team: members, permissions and invitation links of the active organization (needs "team"). */
export const teamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req, reply) => {
    const [org] = await orgScope(req, "team");
    if (!org) return reply.code(403).send({ error: "forbidden" });
    const members = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, permissions: memberships.permissions, since: memberships.createdAt, totp: users.totpEnabled })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, org))
      .orderBy(memberships.createdAt);
    const pending = await db
      .select({ id: invites.id, role: invites.role, permissions: invites.permissions, note: invites.note, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
      .from(invites)
      .where(and(eq(invites.organizationId, org), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt));
    return { members: members.map((m) => ({ ...m, permissions: m.role === "owner" ? [...PERMISSIONS] : m.permissions })), invites: pending, all: PERMISSIONS };
  });

  /** Creates a one-time link. The token is shown once; only its hash is stored. */
  app.post("/invites", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const [org] = await orgScope(req, "team");
    if (!org) return reply.code(403).send({ error: "forbidden" });
    const p = NewInvite.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const token = randomToken();
    const [inv] = await db
      .insert(invites)
      .values({ organizationId: org, tokenHash: sha256(token), role: p.data.role, permissions: p.data.permissions, note: p.data.note ?? null, createdBy: req.auth!.user.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) })
      .returning({ id: invites.id, expiresAt: invites.expiresAt });
    await audit(req, "team.invite", req.auth!.user.id, { invite: inv!.id, role: p.data.role }, org);
    return reply.code(201).send({ ...inv, token });
  });

  app.delete<{ Params: { id: string } }>("/invites/:id", async (req, reply) => {
    const [org] = await orgScope(req, "team");
    if (!org || !uuid.safeParse(req.params.id).success) return reply.code(403).send({ error: "forbidden" });
    await db.delete(invites).where(and(eq(invites.id, req.params.id), eq(invites.organizationId, org)));
    return { ok: true };
  });

  app.patch<{ Params: { userId: string } }>("/members/:userId", async (req, reply) => {
    const [org] = await orgScope(req, "team");
    const p = Update.safeParse(req.body);
    if (!org || !p.success || !uuid.safeParse(req.params.userId).success) return reply.code(400).send({ error: "invalid_input" });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.organizationId, org), eq(memberships.userId, req.params.userId)));
    if (!m) return reply.code(404).send({ error: "not_found" });
    if (m.role === "owner") return reply.code(409).send({ error: "owner_fixed" });
    await db
      .update(memberships)
      .set({ ...(p.data.role ? { role: p.data.role } : {}), ...(p.data.permissions ? { permissions: p.data.permissions } : {}) })
      .where(and(eq(memberships.organizationId, org), eq(memberships.userId, req.params.userId)));
    await audit(req, "team.update", req.auth!.user.id, { member: req.params.userId, ...p.data }, org);
    return { ok: true };
  });

  app.delete<{ Params: { userId: string } }>("/members/:userId", async (req, reply) => {
    const [org] = await orgScope(req, "team");
    if (!org || !uuid.safeParse(req.params.userId).success) return reply.code(400).send({ error: "invalid_input" });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.organizationId, org), eq(memberships.userId, req.params.userId)));
    if (!m) return reply.code(404).send({ error: "not_found" });
    if (m.role === "owner") return reply.code(409).send({ error: "owner_fixed" });
    await db.delete(memberships).where(and(eq(memberships.organizationId, org), eq(memberships.userId, req.params.userId)));
    // Sessions that were working in this organization fall back to the member's own organization.
    await db.update(sessions).set({ activeOrgId: null }).where(and(eq(sessions.userId, req.params.userId), eq(sessions.activeOrgId, org)));
    await audit(req, "team.remove", req.auth!.user.id, { member: req.params.userId }, org);
    return { ok: true };
  });

  /** Accept an invitation (the signed-in user joins the organization and switches to it). */
  app.post("/accept", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const p = z.object({ token: z.string().min(20).max(100) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const res = await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invites).where(eq(invites.tokenHash, sha256(p.data.token))).for("update");
      if (!inv || inv.usedAt || inv.expiresAt < new Date()) return { error: "invite_invalid" as const };
      const [exists] = await tx.select().from(memberships).where(and(eq(memberships.organizationId, inv.organizationId), eq(memberships.userId, req.auth!.user.id)));
      if (!exists) await tx.insert(memberships).values({ organizationId: inv.organizationId, userId: req.auth!.user.id, role: inv.role, permissions: inv.permissions as Permission[] });
      await tx.update(invites).set({ usedAt: new Date(), usedBy: req.auth!.user.id }).where(eq(invites.id, inv.id));
      await tx.update(sessions).set({ activeOrgId: inv.organizationId }).where(eq(sessions.idHash, req.auth!.sessionHash));
      await tx.insert(notifications).values({ organizationId: inv.organizationId, kind: "team", key: "memberJoined", params: { name: req.auth!.user.name } });
      const [o] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, inv.organizationId));
      return { orgId: inv.organizationId, name: o?.name ?? "" };
    });
    if ("error" in res) return reply.code(410).send(res);
    await audit(req, "team.join", req.auth!.user.id, {}, res.orgId);
    return res;
  });
};
