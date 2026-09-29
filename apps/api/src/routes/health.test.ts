import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.ts";
import { sql } from "../db/client.ts";

const app = await buildApp({ logger: false });
after(async () => {
  await app.close();
  await sql.end();
});

test("GET /api/health reports the database as up", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, db: "up" });
});
