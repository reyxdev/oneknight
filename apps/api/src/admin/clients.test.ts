import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { auditLog, notifications, orders, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `acl${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Acl ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, id: r.json().id as string, org: r.json().organizations[0].id as string };
}

test("«Бізнеси»: the table, tags and contract, notes, balance adjustment with a reason, the client's panel read only", async () => {
  const admin = await register("a", "+380500000071");
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
  const client = await register("c", "+380500000072");
  const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, cookie = admin.cookie) => app.inject({ method, url, payload, headers: { cookie, origin: ORIGIN } });
  assert.equal((await call("GET", "/api/admin/clients", undefined, client.cookie)).statusCode, 403);
  await db.insert(orders).values({ organizationId: client.org, customerName: "Покупець", customerPhone: "+380671110000", items: [], totalKop: 50000, delivery: { method: "pickup" }, payment: "cod" });

  const row = (await call("GET", "/api/admin/clients")).json().find((c: { id: string }) => c.id === client.org);
  assert.deepEqual([row.owner.name, row.orders30, row.balanceKop, row.contract], ["Acl c", 1, 0, false]);
  assert.ok(row.lastSeen, "last login from the sessions");

  await call("PATCH", `/api/admin/clients/${client.org}`, { tags: ["VIP", "свічки", "VIP"], contract: true });
  await call("POST", `/api/admin/clients/${client.org}/notes`, { text: "Дзвонити після 15:00" });
  assert.equal((await call("POST", `/api/admin/clients/${client.org}/adjust`, { amountUah: 150, reason: "x" })).statusCode, 400, "a reason is required");
  assert.equal((await call("POST", `/api/admin/clients/${client.org}/adjust`, { amountUah: 150, reason: "Компенсація за збій 01.10" })).json().balanceKop, 15000);
  await call("POST", `/api/admin/clients/${client.org}/adjust`, { amountUah: -50, reason: "Помилкове зарахування" });
  const card = (await call("GET", `/api/admin/clients/${client.org}`)).json();
  assert.deepEqual([card.tags, card.contract, card.notes[0].text, card.billing.balanceKop, card.team[0].role], [["VIP", "свічки"], true, "Дзвонити після 15:00", 10000, "owner"]);
  assert.ok(card.billing.ledger.some((l: { reason: string; kind: string }) => l.kind === "adjustment" && l.reason === "Компенсація за збій 01.10"), "the client sees the reason in «Оплата»");
  assert.equal((await db.select().from(notifications).where(and(eq(notifications.organizationId, client.org), eq(notifications.key, "balanceAdjusted")))).length, 2);

  // Looking at the client's panel: everything as the owner sees it, nothing can be changed, it is logged.
  assert.equal((await call("POST", `/api/admin/view/${client.org}`, {}, client.cookie)).statusCode, 403, "admins only");
  assert.equal((await call("POST", `/api/admin/view/${client.org}`)).statusCode, 200);
  const me = (await call("GET", "/api/auth/me")).json();
  assert.deepEqual([me.activeOrgId, me.viewing.name, me.role], [client.org, "Acl c", "owner"]);
  const seen = (await call("GET", "/api/shop/orders")).json();
  assert.equal(seen.length, 1, "the client's orders");
  assert.equal((await call("POST", "/api/shop/orders", { customer: { name: "Х", phone: "+380671110001" }, items: [{ name: "Х", price: 1, qty: 1 }], delivery: { method: "pickup" }, payment: "cod", source: "call" })).json().error, "view_only");
  assert.equal((await call("PATCH", "/api/auth/profile", { name: "Злам" })).json().error, "view_only");
  assert.equal((await call("POST", "/api/admin/view/stop", {})).statusCode, 200);
  assert.equal((await call("GET", "/api/auth/me")).json().viewing, undefined);
  const logged = await db.select().from(auditLog).where(eq(auditLog.organizationId, client.org));
  assert.ok(logged.some((l) => l.action === "admin.view_start") && logged.some((l) => l.action === "admin.view_stop") && logged.some((l) => l.action === "admin.balance_adjust"));
});
