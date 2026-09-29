import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { passwordResets, sessions, users } from "../db/schema.ts";
import { decrypt, randomToken, sha256 } from "../security/crypto.ts";
import { hashPassword } from "../security/password.ts";
import { checkTotp } from "../security/totp.ts";
import { audit } from "../audit.ts";

const HOURS = 24;
const strict = { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } };

/** Admin side: a new link replaces any unused one for the same person. */
export async function createReset(email: string, adminId: string, resetTotp: boolean) {
  const [u] = await db.select({ id: users.id, totpEnabled: users.totpEnabled }).from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u) return null;
  const token = randomToken();
  await db.transaction(async (tx) => {
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, u.id), isNull(passwordResets.usedAt)));
    await tx.insert(passwordResets).values({ userId: u.id, tokenHash: sha256(token), resetTotp: resetTotp && u.totpEnabled, createdBy: adminId, expiresAt: new Date(Date.now() + HOURS * 3_600_000) });
  });
  return { token, hours: HOURS, totpEnabled: u.totpEnabled };
}

async function findValid(token: string) {
  const [r] = await db
    .select({ reset: passwordResets, user: users })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
  return r ?? null;
}

/** /api/auth/reset: public, token-authenticated. */
export const resetRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>("/:token", strict, async (req, reply) => {
    const r = await findValid(req.params.token.slice(0, 100));
    if (!r) return reply.code(404).send({ error: "invalid_link" });
    // A second factor is still asked unless the admin reset it too: a leaked link alone must not be enough.
    return { name: r.user.name, totpRequired: r.user.totpEnabled && !r.reset.resetTotp };
  });

  app.post("/", strict, async (req, reply) => {
    const p = z.object({ token: z.string().max(100), password: z.string().min(8).max(200), code: z.string().trim().max(10).optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input" });
    const r = await findValid(p.data.token);
    if (!r) return reply.code(404).send({ error: "invalid_link" });
    const { user, reset } = r;
    let step: number | null = null;
    if (user.totpEnabled && !reset.resetTotp) {
      if (!p.data.code || !user.totpSecretEnc) return reply.code(401).send({ error: "code_required" });
      step = await checkTotp(decrypt(user.totpSecretEnc), p.data.code, user.totpLastStep);
      if (step === null) return reply.code(401).send({ error: "invalid_code" });
    }
    const passwordHash = await hashPassword(p.data.password);
    const done = await db.transaction(async (tx) => {
      const [used] = await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt))).returning({ id: passwordResets.id });
      if (!used) return false;
      await tx
        .update(users)
        .set({ passwordHash, ...(step !== null ? { totpLastStep: step } : {}), ...(reset.resetTotp ? { totpEnabled: false, totpSecretEnc: null, totpLastStep: null } : {}), updatedAt: new Date() })
        .where(eq(users.id, user.id));
      // Everyone signed in with the old password is signed out.
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      return true;
    });
    if (!done) return reply.code(404).send({ error: "invalid_link" });
    await audit(req, "user.password_reset", user.id, { totpReset: reset.resetTotp });
    return { ok: true };
  });
};
