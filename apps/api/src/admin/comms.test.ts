import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { broadcasts, ideas, notifications, organizations, subscriptions, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `cms${Date.now()}`;
const made: string[] = [];

after(async () => {
  if (made.length) await db.delete(broadcasts).where(inArray(broadcasts.id, made));
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Cms ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, id: r.json().id as string, org: r.json().organizations[0].id as string };
}

test("support queue with contract first and a timer, reply templates, messages to a segment, ideas", async () => {
  const admin = await register("a", "+380500000081");
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
  const plain = await register("p", "+380500000082");
  const vip = await register("v", "+380500000083");
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, cookie = admin.cookie) => app.inject({ method, url, payload, headers: { cookie, origin: ORIGIN } });

  // Two open requests; the business with a contract goes first.
  await call("POST", "/api/tickets", { category: "question", text: "Як додати менеджера?" }, plain.cookie);
  await call("POST", "/api/tickets", { category: "bug", text: "Не друкується ТТН" }, vip.cookie);
  await db.update(organizations).set({ supportContract: true }).where(eq(organizations.id, vip.org));
  const queue = (await call("GET", "/api/admin/tickets")).json().filter((t: { org: string }) => t.org.startsWith("Cms"));
  assert.deepEqual([queue[0].contract, queue[1].contract], [true, false]);
  assert.ok(queue.every((t: { waitingSince: string | null }) => t.waitingSince), "the timer runs from the client's message");

  const tpl = (await call("GET", "/api/admin/tickets/templates")).json();
  assert.ok(tpl.length >= 10 && tpl.some((t: { body: string }) => t.body.includes("{name}")), "10 starter templates");
  const mine = (await call("POST", "/api/admin/tickets/templates", { title: "Тест", body: "Вітаю, {name}" })).json();
  await call("DELETE", `/api/admin/tickets/templates/${mine.id}`);

  // A message to businesses on trial only.
  await db.insert(subscriptions).values({ organizationId: plain.org, status: "trial", periodEnd: new Date(Date.now() + 86_400_000) });
  await db.insert(subscriptions).values({ organizationId: vip.org, status: "active", periodEnd: new Date(Date.now() + 86_400_000) });
  const n = (await call("POST", "/api/admin/broadcasts/count", { segment: "trial" })).json().recipients;
  assert.ok(n >= 1);
  assert.equal((await call("POST", "/api/admin/broadcasts", { title: "Нове: кошики", text: "Спробуйте", segment: "trial" }, plain.cookie)).statusCode, 403);
  const sent = (await call("POST", "/api/admin/broadcasts", { title: `Нове: кошики ${tag}`, text: "Спробуйте незавершені кошики", segment: "trial" })).json();
  made.push(sent.id);
  const got = async (org: string) => (await db.select().from(notifications).where(and(eq(notifications.organizationId, org), eq(notifications.key, "broadcast")))).length;
  assert.deepEqual([await got(plain.org), await got(vip.org)], [1, 0], "only the segment");

  // Ideas: the client suggests, Ivan marks done, the client is told.
  assert.equal((await call("POST", "/api/ideas", { text: "Друк наклейок з логотипом" }, plain.cookie)).statusCode, 201);
  const idea = (await call("GET", "/api/admin/ideas")).json().find((i: { text: string }) => i.text === "Друк наклейок з логотипом");
  assert.equal(idea.status, "new");
  await call("PATCH", `/api/admin/ideas/${idea.id}`, { status: "done" });
  assert.equal((await call("GET", "/api/ideas/mine", undefined, plain.cookie)).json()[0].status, "done");
  assert.equal((await db.select().from(notifications).where(and(eq(notifications.organizationId, plain.org), eq(notifications.key, "ideaDone")))).length, 1);
  await db.delete(ideas).where(eq(ideas.id, idea.id));
});
