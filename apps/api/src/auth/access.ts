import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { memberships } from "../db/schema.ts";

/** Organizations the user belongs to. Every tenant query is filtered by this list. */
export async function orgIdsOf(userId: string): Promise<string[]> {
  const rows = await db.select({ id: memberships.organizationId }).from(memberships).where(eq(memberships.userId, userId));
  return rows.map((r) => r.id);
}
