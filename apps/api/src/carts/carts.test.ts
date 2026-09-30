import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { carts, orders, sites } from "../db/schema.ts";
import { todoFor } from "../dashboard/todo.ts";
import { purgeCarts } from "./routes.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `cart${Date.now()}`;
const HOUR = 3_600_000;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Cart ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string };
}

test("unfinished carts: collected from the site, a call after 2 hours, finished by an order, won back by the team", async () => {
  const o = await register("o", "+380500000033");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const [site] = await db.insert(sites).values({ organizationId: o.org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const K = { "x-site-key": site!.publicKey, "user-agent": "Mozilla/5.0" };
  const add = async (name: string, price: number) => (await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name, price }, headers: H })).json().id as string;
  const honey = await add("Мед", 250);
  const tea = await add("Чай", 100);
  const send = (body: object) => app.inject({ method: "POST", url: "/api/public/carts", payload: body, headers: K });
  const s = (x: string) => x.padEnd(20, "0");
  const age = (session: string, hours: number) => db.update(carts).set({ updatedAt: new Date(Date.now() - hours * HOUR) }).where(eq(carts.session, s(session)));
  const list = async (view = "waiting", cookie = o.cookie) => (await app.inject({ url: `/api/shop/carts?view=${view}`, headers: { cookie } })).json();

  // Prices come from the catalogue; unknown products are skipped; the phone is normalised.
  assert.equal((await send({ session: s("a"), phone: "067 111 22 33", name: "Олена", items: [{ id: honey, qty: 2 }, { id: "00000000-0000-4000-8000-000000000000", qty: 5 }] })).statusCode, 204);
  const [a] = await db.select().from(carts).where(eq(carts.session, s("a")));
  assert.deepEqual([a!.phone, a!.items.length, a!.totalKop], ["+380671112233", 1, 50000]);
  // The cart follows the site: a changed cart replaces the old one, an emptied one is gone.
  await send({ session: s("a"), phone: "067 111 22 33", name: "Олена", items: [{ id: honey, qty: 2 }, { id: tea, qty: 1 }] });
  await send({ session: s("e"), phone: "0501110000", items: [{ id: tea, qty: 1 }] });
  await send({ session: s("e"), phone: "0501110000", items: [] });
  assert.equal((await db.select().from(carts).where(eq(carts.organizationId, o.org))).length, 1);
  assert.equal((await send({ session: s("x"), phone: "12", items: [] })).statusCode, 400);

  // Not yet «незавершений»: less than 2 hours.
  assert.equal((await list()).carts.length, 0);
  assert.ok(!(await todoFor(o.org, ["orders"])).some((t) => t.key === "carts"));
  await age("a", 3);
  const w = await list();
  assert.deepEqual([w.carts.length, w.carts[0].totalKop, w.carts[0].name, w.stats.waiting], [1, 60000, "Олена", 1]);
  const todo = (await todoFor(o.org, ["orders"])).find((t) => t.key === "carts");
  assert.deepEqual([todo?.params.n, todo?.tab], [1, "carts"], "Home: «N кошиків чекають дзвінка»");
  const id = w.carts[0].id as string;
  const act = (action: string, extra = {}) => app.inject({ method: "POST", url: `/api/shop/carts/${id}`, payload: { action, ...extra }, headers: H });

  // «Не додзвонились»: again in 2 hours, the Home item waits too.
  assert.equal((await act("no-answer")).json().calls, 1);
  assert.ok(!(await todoFor(o.org, ["orders"])).some((t) => t.key === "carts"));
  assert.equal((await list()).carts.length, 1, "still in the list, with the time to call again");
  await act("note", { note: "Передзвонити після 18:00" });
  // «Не цікаво» and back.
  await act("close");
  assert.deepEqual([(await list()).carts.length, (await list("closed")).carts.length], [0, 1]);
  await act("reopen");
  assert.equal((await list()).carts[0].note, "Передзвонити після 18:00");

  // The buyer ordered within 2 hours: the cart was never unfinished and is deleted.
  await send({ session: s("b"), phone: "+380931112233", items: [{ id: tea, qty: 1 }] });
  const order = (body: object) => app.inject({ method: "POST", url: "/api/public/orders", payload: { items: [{ productId: tea, qty: 1 }], delivery: { method: "pickup" }, payment: "cod", ...body }, headers: K });
  assert.equal((await order({ customer: { name: "Ігор", phone: "093 111 22 33" } })).statusCode, 201);
  assert.equal((await db.select().from(carts).where(eq(carts.session, s("b")))).length, 0);
  // Ordered later by the buyer (same browsing session, another phone): «Оформили самі».
  await send({ session: s("c"), phone: "+380631112233", items: [{ id: tea, qty: 1 }] });
  await age("c", 5);
  await order({ customer: { name: "Марія", phone: "+380991234567" }, analytics: { session: s("c") } });
  const ordered = await list("ordered");
  assert.deepEqual([ordered.carts.length, ordered.carts[0].recovered, ordered.stats.self], [1, false, 1]);

  // «Оформити замовлення» from the cart: the order is «з кошика», tied to the site, the cart counts as won back.
  const made = await app.inject({ method: "POST", url: "/api/shop/orders", payload: { customer: { name: "Олена", phone: "+380671112233" }, items: [{ productId: honey, qty: 2 }, { productId: tea, qty: 1 }], delivery: { method: "novaposhta", city: "Київ", branch: "1" }, payment: "cod", source: "call", cart: id }, headers: H });
  assert.equal(made.statusCode, 201);
  const [mo] = await db.select().from(orders).where(eq(orders.id, made.json().id));
  assert.deepEqual([mo!.source, mo!.siteId], ["cart", site!.id]);
  const after2 = await list("ordered");
  assert.deepEqual([after2.stats.recovered, after2.stats.recoveredKop, after2.stats.waiting], [1, 60000, 0]);
  // The same visit changing its cart again is not collected any more.
  await send({ session: s("a"), phone: "067 111 22 33", items: [{ id: tea, qty: 9 }] });
  assert.equal((await db.select().from(carts).where(eq(carts.id, id)))[0]!.totalKop, 60000);

  // A manager without «Фінанси» sees no sums; a packer does not see carts.
  const invite = async (role: string, permissions: string[], n: string, phone: string) => {
    const who = await register(n, phone);
    const inv = await app.inject({ method: "POST", url: "/api/team/invites", payload: { role, permissions }, headers: H });
    await app.inject({ method: "POST", url: "/api/team/accept", payload: { token: inv.json().token }, headers: { cookie: who.cookie, origin: ORIGIN } });
    return who;
  };
  const mgr = await invite("manager", ["orders"], "m", "+380500000034");
  const m = await list("ordered", mgr.cookie);
  assert.deepEqual([m.carts[0].totalKop, m.carts[0].items[0].priceKop, m.stats.recoveredKop], [null, null, null]);
  const pack = await invite("packer", ["shipping"], "p", "+380500000035");
  assert.equal((await app.inject({ url: "/api/shop/carts", headers: { cookie: pack.cookie } })).statusCode, 403);

  // Kept 30 days.
  await db.update(carts).set({ updatedAt: new Date(Date.now() - 31 * 24 * HOUR) }).where(eq(carts.organizationId, o.org));
  await purgeCarts();
  assert.equal((await db.select().from(carts).where(eq(carts.organizationId, o.org))).length, 0);
});
