import { inArray, like, or } from "drizzle-orm";
import { db } from "./db/client.ts";
import { loginEvents, memberships, organizations, users } from "./db/schema.ts";

/** Removes test accounts matching an email prefix together with their organizations (sites, leads links cascade). */
export async function cleanupTestUsers(emailPrefix: string) {
  const u = await db.select({ id: users.id, email: users.email }).from(users).where(like(users.email, `${emailPrefix}%`));
  if (u.length) {
    const orgs = await db.select({ id: memberships.organizationId }).from(memberships).where(inArray(memberships.userId, u.map((x) => x.id)));
    await db.delete(users).where(inArray(users.id, u.map((x) => x.id)));
    if (orgs.length) await db.delete(organizations).where(inArray(organizations.id, orgs.map((o) => o.id)));
  }
  await db.delete(loginEvents).where(or(like(loginEvents.emailAttempted, `${emailPrefix}%`)));
}
