import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../config.ts";
import * as schema from "./schema.ts";

export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
