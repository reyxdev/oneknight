import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { orders } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `cust${Date.now()}`;
const DAY = 86_400_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Cust ${n}`, phone: "+380500000016", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string };
}

test("customers: one per phone from orders, numbers, automatic tags, segments, own tags, notes", async () => {
  const o = await register("o");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const base = { organizationId: o.org, items: [], payment: "cod", delivery: { method: "novaposhta", city: "Львів", branch: "5" } };
  // The same person written three ways, and another one.
  await db.insert(orders).values([
    { ...base, customerName: "Олена Коваль", customerPhone: "067 111 22 33", totalKop: 10000, status: "done" as const },
    { ...base, customerName: "Олена", customerPhone: "+380671112233", totalKop: 20000, status: "done" as const },
    { ...base, customerName: "Олена К.", customerPhone: "380 (67) 111-22-33", totalKop: 30000, status: "done" as const },
    { ...base, customerName: "Андрій", customerPhone: "0501112233", totalKop: 5000, status: "returned" as const },
    { ...base, customerName: "Андрій", customerPhone: "0501112233", totalKop: 7000, status: "cancelled" as const },
  ]);
  const list = async (q = "") => (await app.inject({ url: `/api/customers${q}`, headers: { cookie: o.cookie } })).json();
  const all = await list();
  assert.equal(all.length, 2, "one customer per phone");
  const olena = all.find((c: { name: string }) => c.name === "Олена Коваль");
  assert.deepEqual([olena.orders, olena.sumKop, olena.auto, olena.city], [3, 60000, ["regular"], "Львів"], "the first name stays; «Постійний» after 3 completed");
  const andrii = all.find((c: { name: string }) => c.name === "Андрій");
  assert.deepEqual([andrii.orders, andrii.sumKop, andrii.auto], [1, 0, ["problem"]], "a refused parcel → «Проблемний»; returned and cancelled are not sales");
  assert.deepEqual((await list("?segment=regular")).map((c: { id: string }) => c.id), [olena.id]);
  assert.deepEqual((await list("?segment=risky")).map((c: { id: string }) => c.id), [andrii.id]);
  assert.deepEqual((await list("?segment=top")).map((c: { id: string }) => c.id), [olena.id], "top by sum, with purchases only");
  assert.deepEqual((await list("?q=1112233")).length, 2, "search by phone digits");
  assert.deepEqual((await list("?q=олена")).map((c: { id: string }) => c.id), [olena.id]);
  await db.update(orders).set({ createdAt: new Date(Date.now() - 100 * DAY) }).where(eq(orders.customerId, olena.id));
  assert.deepEqual((await list("?segment=sleeping")).map((c: { id: string }) => c.id), [olena.id], "no purchase for 90+ days");

  // Tags: presets and own ones; notes.
  const patch = (id: string, body: object) => app.inject({ method: "PATCH", url: `/api/customers/${id}`, payload: body, headers: H });
  assert.equal((await patch(olena.id, { tags: ["vip"], company: "ТОВ «Смачно»" })).statusCode, 200);
  assert.equal((await patch(olena.id, { tags: ["t_unknown1"] })).statusCode, 400, "only known tags");
  await app.inject({ method: "PUT", url: "/api/customers/settings", payload: { tags: [{ id: "t_abc123", name: "Блогер", color: "#aa3377" }], sleepDays: 60 }, headers: H });
  assert.equal((await patch(olena.id, { tags: ["vip", "t_abc123"] })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: `/api/customers/${olena.id}/notes`, payload: { text: "Любить подарункове пакування" }, headers: H })).statusCode, 201);
  const card = (await app.inject({ url: `/api/customers/${olena.id}`, headers: { cookie: o.cookie } })).json();
  assert.deepEqual(card.tags, ["vip", "t_abc123"]);
  assert.equal(card.company, "ТОВ «Смачно»");
  assert.equal(card.orders.length, 3);
  assert.equal(card.notes[0].text, "Любить подарункове пакування");
  assert.equal(card.notes[0].by, "Cust o");

  // The order card shows the customer with «Проблемний».
  const [oa] = await db.select().from(orders).where(eq(orders.customerId, andrii.id)).limit(1);
  const detail = (await app.inject({ url: `/api/shop/orders/${oa!.id}`, headers: { cookie: o.cookie } })).json();
  assert.deepEqual([detail.customer.id, detail.customer.auto], [andrii.id, ["problem"]]);

  // Without «Фінанси» no sums; a packer does not see the base.
  const invite = async (role: string, permissions: string[], n: string) => {
    const who = await register(n);
    const inv = await app.inject({ method: "POST", url: "/api/team/invites", payload: { role, permissions }, headers: H });
    await app.inject({ method: "POST", url: "/api/team/accept", payload: { token: inv.json().token }, headers: { cookie: who.cookie, origin: ORIGIN } });
    return who;
  };
  const mgr = await invite("manager", ["orders"], "m");
  assert.equal((await app.inject({ url: "/api/customers", headers: { cookie: mgr.cookie } })).json()[0].sumKop, null);
  const pack = await invite("packer", ["shipping"], "p");
  assert.equal((await app.inject({ url: "/api/customers", headers: { cookie: pack.cookie } })).statusCode, 403);
});
