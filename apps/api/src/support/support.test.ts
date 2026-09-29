import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `sup${Date.now()}`;
// 1x1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Support ${n}`, phone: "+380500000002", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
}
const post = (url: string, payload: object, cookie: string) => app.inject({ method: "POST", url, payload, headers: { cookie, origin: ORIGIN } });

test("ticket with a screenshot: owner sees it, others do not; admin replies", async () => {
  const a = await register("a");
  const b = await register("b");
  assert.equal((await post("/api/tickets", { category: "bug", text: "abc" }, a)).statusCode, 400, "too short");
  const fake = await post("/api/tickets", { category: "bug", text: "Кнопка не працює", attachment: { data: Buffer.from("not an image").toString("base64") } }, a);
  assert.equal(fake.json().error, "unsupported_file");
  const r = await post("/api/tickets", { category: "bug", text: "Кнопка «Купити» не працює на телефоні", attachment: { name: "s.png", data: PNG } }, a);
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  const t = (await app.inject({ url: `/api/tickets/${id}`, headers: { cookie: a } })).json();
  assert.equal(t.messages.length, 1);
  const fileId = t.messages[0].fileId;
  const img = await app.inject({ url: `/api/files/${fileId}`, headers: { cookie: a } });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers["content-type"], "image/png");
  assert.equal((await app.inject({ url: `/api/files/${fileId}`, headers: { cookie: b } })).statusCode, 404, "other org cannot read the file");
  assert.equal((await app.inject({ url: `/api/files/${fileId}` })).statusCode, 401);
  assert.equal((await app.inject({ url: `/api/tickets/${id}`, headers: { cookie: b } })).statusCode, 404);

  assert.equal((await post(`/api/admin/tickets/${id}/messages`, { text: "Дякую, виправляю" }, a)).statusCode, 403);
  await db.update(users).set({ isAdmin: true }).where(eq(users.email, `${tag}b@test.oneknight.local`));
  assert.equal((await post(`/api/admin/tickets/${id}/messages`, { text: "Дякую, виправляю" }, b)).statusCode, 200);
  const after1 = (await app.inject({ url: `/api/tickets/${id}`, headers: { cookie: a } })).json();
  assert.equal(after1.status, "answered");
  assert.equal(after1.messages[1].staff, true);
  const n = (await app.inject({ url: "/api/notifications", headers: { cookie: a } })).json();
  assert.equal(n[0].key, "ticketAnswered");
  assert.equal((await post(`/api/tickets/${id}/messages`, { text: "Все працює, дякую!" }, a)).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/tickets/${id}`, headers: { cookie: a } })).json().status, "open");
});
