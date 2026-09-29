// Grants platform admin to an existing account: npm run admin:grant -w @oneknight/api -- you@example.com
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("usage: admin:grant <email>");
  process.exit(1);
}
const rows = await db.update(users).set({ isAdmin: true, updatedAt: new Date() }).where(eq(users.email, email)).returning({ id: users.id });
console.log(rows.length ? `admin granted to ${email}` : `no account with email ${email}`);
await sql.end();
