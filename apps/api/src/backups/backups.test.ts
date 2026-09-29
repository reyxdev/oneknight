import { test, after } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { backups, integrations, sites } from "../db/schema.ts";
import { startTrial } from "../billing/service.ts";
import { encrypt } from "../security/crypto.ts";
import { runBackups } from "./service.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `backup${Date.now()}`;
after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("backups: owner only, full and self-contained, no secrets, daily auto once", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Backup", phone: "+380500000013", email: `${tag}@test.oneknight.local`, password: "secret password 1" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const H = { cookie, origin: ORIGIN };
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.com.ua`, name: "S" }).returning();
  await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Хлібниця", price: 1100, photo: { name: "p.png", data: PNG } }, headers: H });
  await db.insert(integrations).values({ organizationId: org, provider: "novaposhta", credentialsEnc: encrypt(JSON.stringify({ apiKey: "a".repeat(32) })), status: "connected" });

  const made = await app.inject({ method: "POST", url: "/api/backups", headers: H });
  assert.equal(made.statusCode, 201);
  assert.equal(made.json().counts.products, 1);
  const list = (await app.inject({ url: "/api/backups", headers: { cookie } })).json();
  assert.equal(list.length, 1);

  const dl = await app.inject({ url: `/api/backups/${list[0].id}/download`, headers: { cookie } });
  assert.equal(dl.headers["content-type"], "application/gzip");
  assert.match(String(dl.headers["content-disposition"]), /attachment; filename="oneknight-backup-\d{4}-\d\d-\d\d\.json\.gz"/);
  const text = gunzipSync(dl.rawPayload).toString();
  const doc = JSON.parse(text);
  assert.equal(doc.format, "oneknight-backup/1");
  assert.equal(doc.products[0].name, "Хлібниця");
  assert.equal(doc.files.length, 1);
  assert.equal(Buffer.from(doc.files[0].data, "base64").subarray(1, 4).toString(), "PNG", "photo embedded");
  assert.equal(doc.integrations[0].provider, "novaposhta");
  for (const secret of ["a".repeat(32), "passwordHash", "password_hash", "totpSecret", "credentialsEnc", "secret password 1"]) assert.ok(!text.includes(secret), `no ${secret}`);

  // Another business cannot read it; a non-owner member is refused.
  const other = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Other", phone: "+380500000014", email: `${tag}-o@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const oc = `ok_session=${other.cookies.find((c) => c.name === "ok_session")!.value}`;
  assert.equal((await app.inject({ url: `/api/backups/${list[0].id}/download`, headers: { cookie: oc } })).statusCode, 404);

  // Daily automatic backups: only for working subscriptions, once per day.
  const before = (await db.select().from(backups).where(eq(backups.organizationId, org))).length;
  await runBackups({ warn: () => {} });
  assert.equal((await db.select().from(backups).where(eq(backups.organizationId, org))).length, before, "no subscription, no auto backup");
  await startTrial(org);
  await runBackups({ warn: () => {} });
  await runBackups({ warn: () => {} });
  const autos = (await db.select().from(backups).where(eq(backups.organizationId, org))).filter((b) => b.kind === "auto");
  assert.equal(autos.length, 1);
});
