import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { env } from "../config.ts";
import { randomToken, sha256 } from "../security/crypto.ts";

export const SESSION_COOKIE = "ok_session";
/** Readable, non-secret hint so the static site can show "Відкрити ONEKNIGHT" without a request. */
export const HINT_COOKIE = "ok_auth";
const TTL_MS = 30 * 24 * 3600 * 1000;

export type AuthUser = typeof users.$inferSelect;
export type Auth = { user: AuthUser; sessionHash: string; sessionId: string; mfaPassed: boolean; activeOrgId: string | null };

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string, mfaPassed: boolean) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(sessions).values({ idHash: sha256(token), userId, mfaPassed, ip: req.ip, userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null, expiresAt });
  setCookies(reply, token, expiresAt);
}

function setCookies(reply: FastifyReply, token: string, expires: Date) {
  const base = { path: "/", sameSite: "lax" as const, secure: env.COOKIE_SECURE, expires };
  reply.setCookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  reply.setCookie(HINT_COOKIE, "1", { ...base, httpOnly: false });
}

export function clearCookies(reply: FastifyReply) {
  const base = { path: "/", sameSite: "lax" as const, secure: env.COOKIE_SECURE };
  reply.clearCookie(SESSION_COOKIE, base);
  reply.clearCookie(HINT_COOKIE, base);
}

/** Resolves the session from the cookie. Touches last_seen_at at most once a minute. */
export async function loadAuth(req: FastifyRequest): Promise<Auth | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const idHash = sha256(token);
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, idHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.idHash, idHash));
  }
  return { user: row.u, sessionHash: idHash, sessionId: row.s.id, mfaPassed: row.s.mfaPassed, activeOrgId: row.s.activeOrgId };
}

/** Full access requires the second factor when 2FA is on. */
export const isComplete = (a: Auth) => !a.user.totpEnabled || a.mfaPassed;
