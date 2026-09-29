import { and, count, eq, gt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { loginEvents } from "../db/schema.ts";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 20;

/** Failed attempts in the last 15 minutes, by email and by IP. Stored in the database, so restarts do not reset it. */
export async function isLockedOut(email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [byEmail] = await db.select({ n: count() }).from(loginEvents).where(and(eq(loginEvents.emailAttempted, email), eq(loginEvents.success, false), gt(loginEvents.createdAt, since)));
  if ((byEmail?.n ?? 0) >= MAX_PER_EMAIL) return true;
  const [byIp] = await db.select({ n: count() }).from(loginEvents).where(and(eq(loginEvents.ip, ip), eq(loginEvents.success, false), gt(loginEvents.createdAt, since)));
  return (byIp?.n ?? 0) >= MAX_PER_IP;
}
