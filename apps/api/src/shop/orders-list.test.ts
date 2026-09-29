import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { orders } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `olist${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `List ${n}`, phone: "+380500000009", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string, id: r.json().id as string };
}
const H = (cookie: string) => ({ cookie, origin: ORIGIN });

async function join(owner: { cookie: string }, role: string, permissions: string[], n: string) {
  const who = await register(n);
  const inv = await app.inject({ method: "POST", url: "/api/team/invites", payload: { role, permissions }, headers: H(owner.cookie) });
  assert.equal(inv.statusCode, 201);
  await app.inject({ method: "POST", url: "/api/team/accept", payload: { token: inv.json().token }, headers: H(who.cookie) });
  return who;
}

test("orders list: sort by column, pages of 50, no sorting by sum without «Фінанси»", async () => {
  const owner = await register("o5");
  const base = { organizationId: owner.org, customerPhone: "+380", items: [], payment: "cod", delivery: { method: "pickup" } };
  await db.insert(orders).values(Array.from({ length: 55 }, (_, i) => ({ ...base, customerName: `Покупець ${String(i).padStart(2, "0")}`, totalKop: (i % 7) * 1000 + i })));
  const list = async (cookie: string, q: string) => (await app.inject({ url: `/api/shop/orders?${q}`, headers: { cookie } })).json();
  const p1 = await list(owner.cookie, "limit=51&page=1");
  assert.equal(p1.length, 51, "a next page exists");
  const p2 = await list(owner.cookie, "limit=51&page=2");
  assert.equal(p2.length, 5);
  assert.equal(new Set([...p1.slice(0, 50), ...p2].map((o: { id: string }) => o.id)).size, 55, "pages do not overlap");
  const byName = await list(owner.cookie, "sort=customer&dir=asc&limit=51");
  assert.equal(byName[0].customerName, "Покупець 00");
  const bySum = await list(owner.cookie, "sort=total&dir=desc&limit=51");
  assert.ok(bySum[0].totalKop >= bySum[1].totalKop && bySum[0].totalKop >= bySum[50].totalKop);
  const mgr = await join(owner, "manager", ["orders"], "mgr5");
  const mgrSum = await list(mgr.cookie, "sort=total&dir=desc&limit=51");
  assert.deepEqual(mgrSum.map((o: { id: string }) => o.id), (await list(mgr.cookie, "limit=51")).map((o: { id: string }) => o.id), "without finance the sum sort falls back to date");
});
