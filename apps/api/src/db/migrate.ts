import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.ts";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
await migrate(db, { migrationsFolder: folder });
console.log("migrations applied");
await sql.end();
