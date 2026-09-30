import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "../db/client.ts";
import { loginEvents, memberships, moduleInstalls, organizations, sessions, subscriptions, users } from "../db/schema.ts";
import { hashPassword, verifyPassword } from "../security/password.ts";
import { decrypt, encrypt } from "../security/crypto.ts";
import { checkTotp, newTotpSecret, totpUri } from "../security/totp.ts";
import { clearCookies, createSession, isComplete, loadAuth, type Auth } from "./session.ts";
import { isLockedOut } from "./limits.ts";
import { audit } from "../audit.ts";
import { PERMISSIONS, membershipsOf } from "./access.ts";
import { referrerOf } from "../billing/referrals.ts";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(200);
const Register = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\+?[0-9\s()-]{9,20}$/),
  email,
  password,
  /** Referral code from «/app/?start=register&ref=CODE». */
  ref: z.string().trim().max(20).optional(),
});
const Login = z.object({ email, password: z.string().min(1).max(200) });
const Code = z.object({ code: z.string().trim() });
const Disable = z.object({ code: z.string().trim(), password: z.string().min(1).max(200) });

const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

function bad(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

async function me(user: Auth["user"], activeOrgId: string | null = null, viewOrgId: string | null = null) {
  if (viewOrgId) return viewedMe(user, viewOrgId);
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, user.id))
    .orderBy(memberships.createdAt);
  const all = await membershipsOf(user.id);
  const active = all.find((m) => m.orgId === activeOrgId) ?? all[0] ?? null;
  // Installed modules of the active business: the menu shows a lock on sections whose module is not connected.
  const modules = active ? (await db.select({ id: moduleInstalls.moduleId }).from(moduleInstalls).where(eq(moduleInstalls.organizationId, active.orgId))).map((m) => m.id) : [];
  const [org] = active ? await db.select({ onboarding: organizations.onboarding }).from(organizations).where(eq(organizations.id, active.orgId)) : [];
  const [sub] = active ? await db.select({ status: subscriptions.status, periodEnd: subscriptions.periodEnd }).from(subscriptions).where(eq(subscriptions.organizationId, active.orgId)) : [];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isAdmin: user.isAdmin,
    totpEnabled: user.totpEnabled,
    organizations: orgs,
    activeOrgId: active?.orgId ?? null,
    role: active?.role ?? null,
    permissions: active?.permissions ?? [],
    modules,
    // The owner answers the questions after sign-up once; invited people never see them.
    onboarded: active?.role !== "owner" || !!org?.onboarding,
    // The business requires 2FA and this person has not turned it on: the panel asks for it first.
    twofaRequired: !!active?.require2fa && !user.totpEnabled,
    subscription: sub ?? null,
  };
}

/** The admin in a client's panel: the business as its owner sees it, marked as viewing (read only). */
async function viewedMe(user: Auth["user"], orgId: string) {
  const [org] = await db.select({ id: organizations.id, name: organizations.name, onboarding: organizations.onboarding }).from(organizations).where(eq(organizations.id, orgId));
  const modules = (await db.select({ id: moduleInstalls.moduleId }).from(moduleInstalls).where(eq(moduleInstalls.organizationId, orgId))).map((m) => m.id);
  const [sub] = await db.select({ status: subscriptions.status, periodEnd: subscriptions.periodEnd }).from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isAdmin: true,
    totpEnabled: user.totpEnabled,
    organizations: org ? [{ id: org.id, name: org.name, role: "owner" as const }] : [],
    activeOrgId: orgId,
    role: "owner" as const,
    permissions: [...PERMISSIONS],
    modules,
    onboarded: true,
    subscription: sub ?? null,
    viewing: { orgId, name: org?.name ?? "" },
  };
}

async function logAttempt(req: FastifyRequest, emailAttempted: string, userId: string | null, success: boolean, reason: string) {
  await db.insert(loginEvents).values({ emailAttempted, userId, success, reason, ip: req.ip, userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null });
}

/** preHandler: requires a complete session (second factor passed when enabled). */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const a = await loadAuth(req);
  if (!a) return bad(reply, 401, "unauthorized");
  if (!isComplete(a)) return bad(reply, 401, "mfa_required");
  req.auth = a;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", strict, async (req, reply) => {
    const p = Register.safeParse(req.body);
    if (!p.success) return bad(reply, 400, "invalid_input");
    const { name, phone, email: mail, password: pw } = p.data;
    const passwordHash = await hashPassword(pw);
    const referredBy = await referrerOf(p.data.ref?.toUpperCase());
    try {
      const user = await db.transaction(async (tx) => {
        const [u] = await tx.insert(users).values({ name, phone, email: mail, passwordHash, referredBy }).returning();
        const [org] = await tx.insert(organizations).values({ name }).returning();
        await tx.insert(memberships).values({ userId: u!.id, organizationId: org!.id, role: "owner", permissions: [] });
        return u!;
      });
      await createSession(req, reply, user.id, true);
      await logAttempt(req, mail, user.id, true, "register");
      await audit(req, "user.register", user.id);
      return reply.code(201).send(await me(user));
    } catch (e) {
      // Drizzle wraps the driver error; the Postgres code sits on the cause.
      const code = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === "23505") return bad(reply, 409, "email_taken");
      throw e;
    }
  });

  app.post("/login", strict, async (req, reply) => {
    const p = Login.safeParse(req.body);
    if (!p.success) return bad(reply, 400, "invalid_input");
    const { email: mail, password: pw } = p.data;
    if (await isLockedOut(mail, req.ip)) {
      await logAttempt(req, mail, null, false, "rate_limited");
      return bad(reply, 429, "too_many_attempts");
    }
    const [user] = await db.select().from(users).where(eq(users.email, mail)).limit(1);
    const ok = await verifyPassword(user?.passwordHash ?? null, pw);
    if (!user || !ok) {
      await logAttempt(req, mail, user?.id ?? null, false, user ? "bad_password" : "unknown_email");
      return bad(reply, 401, "invalid_credentials");
    }
    await createSession(req, reply, user.id, !user.totpEnabled);
    await logAttempt(req, mail, user.id, true, user.totpEnabled ? "password_ok_mfa_pending" : "ok");
    if (user.totpEnabled) return { mfaRequired: true };
    return { mfaRequired: false, user: await me(user) };
  });

  app.post("/login/totp", strict, async (req, reply) => {
    const a = await loadAuth(req);
    if (!a) return bad(reply, 401, "unauthorized");
    if (isComplete(a)) return { user: await me(a.user, a.activeOrgId) };
    const p = Code.safeParse(req.body);
    if (!p.success || !a.user.totpSecretEnc) return bad(reply, 400, "invalid_input");
    if (await isLockedOut(a.user.email, req.ip)) return bad(reply, 429, "too_many_attempts");
    const step = await checkTotp(decrypt(a.user.totpSecretEnc), p.data.code, a.user.totpLastStep);
    if (step === null) {
      await logAttempt(req, a.user.email, a.user.id, false, "bad_totp");
      return bad(reply, 401, "invalid_code");
    }
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, a.user.id));
    await db.update(sessions).set({ mfaPassed: true }).where(eq(sessions.idHash, a.sessionHash));
    await logAttempt(req, a.user.email, a.user.id, true, "ok");
    return { user: await me(a.user, a.activeOrgId) };
  });

  app.post("/logout", async (req, reply) => {
    const a = await loadAuth(req);
    if (a) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.idHash, a.sessionHash));
      await audit(req, "user.logout", a.user.id);
    }
    clearCookies(reply);
    return { ok: true };
  });

  app.get("/me", async (req, reply) => {
    const a = await loadAuth(req);
    if (!a) {
      clearCookies(reply);
      return bad(reply, 401, "unauthorized");
    }
    if (!isComplete(a)) return bad(reply, 401, "mfa_required");
    return me(a.user, a.activeOrgId, a.viewOrgId ?? null);
  });

  /** Switch the organization this session works in. */
  app.post("/org", { preHandler: requireAuth }, async (req, reply) => {
    const p = z.object({ orgId: z.string().uuid() }).safeParse(req.body);
    if (!p.success) return bad(reply, 400, "invalid_input");
    const mine = await membershipsOf(req.auth!.user.id);
    if (!mine.some((m) => m.orgId === p.data.orgId)) return bad(reply, 404, "not_found");
    await db.update(sessions).set({ activeOrgId: p.data.orgId }).where(eq(sessions.idHash, req.auth!.sessionHash));
    return me(req.auth!.user, p.data.orgId);
  });

  /** The person's own name and phone; the business name too when they own the active business. */
  app.patch("/profile", { preHandler: requireAuth }, async (req, reply) => {
    const p = z.object({ name: Register.shape.name.optional(), phone: Register.shape.phone.optional(), businessName: z.string().trim().min(2).max(120).optional() }).safeParse(req.body);
    if (!p.success) return bad(reply, 400, "invalid_input");
    const u = req.auth!.user;
    const { businessName, ...own } = p.data;
    if (businessName) {
      const m = (await membershipsOf(u.id)).find((x) => x.orgId === req.auth!.activeOrgId) ?? (await membershipsOf(u.id))[0];
      if (m?.role !== "owner") return bad(reply, 403, "owner_only");
      await db.update(organizations).set({ name: businessName }).where(eq(organizations.id, m.orgId));
    }
    const [updated] = Object.keys(own).length ? await db.update(users).set({ ...own, updatedAt: new Date() }).where(eq(users.id, u.id)).returning() : [u];
    await audit(req, "user.profile", u.id, { fields: Object.keys(p.data) });
    return me(updated!, req.auth!.activeOrgId);
  });

  /** Changing the password signs out every other device. */
  app.post("/password", { ...strict, preHandler: requireAuth }, async (req, reply) => {
    const p = z.object({ current: z.string().min(1).max(200), next: password }).safeParse(req.body);
    if (!p.success) return bad(reply, 400, "invalid_input");
    const u = req.auth!.user;
    if (!(await verifyPassword(u.passwordHash, p.data.current))) {
      await logAttempt(req, u.email, u.id, false, "bad_password_change");
      return bad(reply, 401, "invalid_credentials");
    }
    await db.update(users).set({ passwordHash: await hashPassword(p.data.next), updatedAt: new Date() }).where(eq(users.id, u.id));
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), ne(sessions.idHash, req.auth!.sessionHash)));
    await audit(req, "user.password_change", u.id);
    return { ok: true };
  });

  app.get("/sessions", { preHandler: requireAuth }, async (req) => {
    const rows = await db
      .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, idHash: sessions.idHash })
      .from(sessions)
      .where(and(eq(sessions.userId, req.auth!.user.id), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map(({ idHash, ...r }) => ({ ...r, current: idHash === req.auth!.sessionHash }));
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", { preHandler: requireAuth }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return bad(reply, 400, "invalid_input");
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, req.auth!.user.id), ne(sessions.idHash, req.auth!.sessionHash)));
    await audit(req, "session.revoke", req.auth!.user.id, { session: req.params.id });
    return { ok: true };
  });

  app.get("/login-history", { preHandler: requireAuth }, async (req) => {
    return db
      .select({ success: loginEvents.success, reason: loginEvents.reason, ip: loginEvents.ip, userAgent: loginEvents.userAgent, createdAt: loginEvents.createdAt })
      .from(loginEvents)
      .where(eq(loginEvents.userId, req.auth!.user.id))
      .orderBy(desc(loginEvents.createdAt))
      .limit(20);
  });

  app.post("/2fa/setup", { ...strict, preHandler: requireAuth }, async (req, reply) => {
    const u = req.auth!.user;
    if (u.totpEnabled) return bad(reply, 409, "already_enabled");
    const secret = newTotpSecret();
    await db.update(users).set({ totpSecretEnc: encrypt(secret), updatedAt: new Date() }).where(eq(users.id, u.id));
    const uri = totpUri(secret, u.email);
    return { secret, uri, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
  });

  app.post("/2fa/enable", { ...strict, preHandler: requireAuth }, async (req, reply) => {
    const u = req.auth!.user;
    const p = Code.safeParse(req.body);
    if (!p.success || !u.totpSecretEnc || u.totpEnabled) return bad(reply, 400, "invalid_input");
    const step = await checkTotp(decrypt(u.totpSecretEnc), p.data.code, null);
    if (step === null) return bad(reply, 401, "invalid_code");
    await db.update(users).set({ totpEnabled: true, totpLastStep: step, updatedAt: new Date() }).where(eq(users.id, u.id));
    // The current session already proved both factors.
    await db.update(sessions).set({ mfaPassed: true }).where(eq(sessions.idHash, req.auth!.sessionHash));
    await audit(req, "2fa.enable", u.id);
    return { ok: true };
  });

  app.post("/2fa/disable", { ...strict, preHandler: requireAuth }, async (req, reply) => {
    const u = req.auth!.user;
    const p = Disable.safeParse(req.body);
    if (!p.success || !u.totpEnabled || !u.totpSecretEnc) return bad(reply, 400, "invalid_input");
    const okPw = await verifyPassword(u.passwordHash, p.data.password);
    const step = okPw ? await checkTotp(decrypt(u.totpSecretEnc), p.data.code, u.totpLastStep) : null;
    if (step === null) return bad(reply, 401, "invalid_credentials");
    await db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, updatedAt: new Date() }).where(eq(users.id, u.id));
    await audit(req, "2fa.disable", u.id);
    return { ok: true };
  });
};
