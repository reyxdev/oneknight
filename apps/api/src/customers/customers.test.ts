import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { writeXlsx } from "../files/table.ts";
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

test("customers: merge, anonymize, import from Excel (CSV), export for the owner, search", async () => {
  const o = await register("o2");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const base = { organizationId: o.org, items: [], payment: "cod", delivery: { method: "novaposhta", city: "Київ", branch: "1" } };
  await db.insert(orders).values([
    { ...base, customerName: "Ірина", customerPhone: "+380931234567", totalKop: 10000, status: "done" as const },
    { ...base, customerName: "Ірина робочий", customerPhone: "+380661234567", totalKop: 20000, status: "done" as const, comment: "Ірина, під'їзд 2" },
  ]);
  const list = async (q = "") => (await app.inject({ url: `/api/customers${q}`, headers: { cookie: o.cookie } })).json();
  const [a, b] = (await list("?sort=createdAt&dir=asc")) as { id: string }[];
  await app.inject({ method: "POST", url: `/api/customers/${b!.id}/notes`, payload: { text: "Робочий телефон" }, headers: H });
  assert.equal((await app.inject({ method: "POST", url: `/api/customers/${a!.id}/merge`, payload: { other: b!.id }, headers: H })).statusCode, 200);
  const merged = await list();
  assert.equal(merged.length, 1);
  assert.equal(merged[0].orders, 2);
  // A new order from the second phone comes to the same customer.
  await db.insert(orders).values({ ...base, customerName: "І.", customerPhone: "0661234567", totalKop: 5000 });
  const card = (await app.inject({ url: `/api/customers/${a!.id}`, headers: { cookie: o.cookie } })).json();
  assert.equal(card.orders.length, 3);
  assert.equal(card.notes[0].text, "Робочий телефон");
  assert.deepEqual(card.extraPhones, ["380661234567"]);

  // Search finds customers too.
  const found = (await app.inject({ url: "/api/shop/search?q=0661234", headers: { cookie: o.cookie } })).json();
  assert.deepEqual(found.customers.map((c: { id: string }) => c.id), [a!.id]);

  // Import: a new customer, a known phone fills gaps, a bad row is reported.
  const csv = "﻿Ім'я;Телефон;Пошта;Компанія;Мітки;Нотатка\nОксана;067 555 44 33;oks@example.com;;VIP;З ярмарку\nІрина;+380931234567;iryna@example.com;ТОВ Квітка;Опт;\nБез телефону;12;;;;\n";
  const imp = (await app.inject({ method: "POST", url: "/api/customers/import", payload: { csv }, headers: H })).json();
  assert.deepEqual(imp, { created: 1, updated: 1, skipped: [4] });
  const after = await list("?q=Оксана");
  assert.deepEqual([after[0].tags, after[0].email, after[0].firstSource], [["vip"], "oks@example.com", "import"]);
  const iryna = (await app.inject({ url: `/api/customers/${a!.id}`, headers: { cookie: o.cookie } })).json();
  assert.deepEqual([iryna.email, iryna.company, iryna.tags], ["iryna@example.com", "ТОВ Квітка", ["wholesale"]]);
  // The same from an .xlsx file as Excel saves it.
  const xlsx = writeXlsx([["Ім'я", "Телефон"], ["Тарас", "0501231231"]]).toString("base64");
  assert.deepEqual((await app.inject({ method: "POST", url: "/api/customers/import", payload: { file: { name: "base.xlsx", data: xlsx } }, headers: H })).json(), { created: 1, updated: 0, skipped: [] });

  const exp = await app.inject({ url: "/api/customers/export", headers: { cookie: o.cookie } });
  assert.match(exp.body, /Оксана;067 555 44 33;oks@example\.com/);

  // Anonymize: data gone from the customer and the orders, numbers stay.
  assert.equal((await app.inject({ method: "POST", url: `/api/customers/${a!.id}/anonymize`, headers: H })).statusCode, 200);
  const gone = (await app.inject({ url: `/api/customers/${a!.id}`, headers: { cookie: o.cookie } })).json();
  assert.deepEqual([gone.name, gone.phone, gone.email, gone.notes.length, gone.orders.length], ["Знеособлено", null, null, 0, 3]);
  const [ord] = await db.select().from(orders).where(eq(orders.customerId, a!.id)).limit(1);
  assert.deepEqual([ord!.customerName, ord!.customerPhone, ord!.comment, ord!.delivery], ["Знеособлено", "", null, { method: "novaposhta" }]);
  assert.doesNotMatch((await app.inject({ url: "/api/customers/export", headers: { cookie: o.cookie } })).body, /Ірина|0931234567/);
});
