import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { orders, products, sites } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `work${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("manual order, editing with stock and history, comments, responsible, «Не додзвонились», duplicates and merge", async () => {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Work", phone: "+380500000013", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = r.json().organizations[0].id as string;
  const H = { cookie, origin: ORIGIN };
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const [p] = await db.insert(products).values({ organizationId: org, siteId: site!.id, name: "Мед", priceKop: 20000, stock: 10 }).returning();
  const stock = async () => (await db.select().from(products).where(eq(products.id, p!.id)))[0]!.stock;

  const manual = (body: object) => app.inject({ method: "POST", url: "/api/shop/orders", payload: body, headers: H });
  const base = { customer: { name: "Ірина Бойко", phone: "+38 067 123 45 67" }, delivery: { method: "novaposhta", city: "Львів", branch: "5" }, payment: "cod", source: "instagram" };
  const c = await manual({ ...base, items: [{ productId: p!.id, qty: 2 }, { name: "Пакування подарункове", price: 50, qty: 1 }] });
  assert.equal(c.statusCode, 201);
  assert.equal(c.json().number, 1001);
  assert.equal(await stock(), 8, "catalogue items leave stock");
  const id = c.json().id;
  const get = async (oid = id) => (await app.inject({ url: `/api/shop/orders/${oid}`, headers: { cookie } })).json();
  const o1 = await get();
  assert.equal(o1.totalKop, 45000, "catalogue price from the database + a free item");
  assert.equal(o1.source, "instagram");
  assert.equal(o1.assignee, "Work", "whoever creates it is responsible");

  // Edit: 2 → 3 jars, the free item removed.
  const e = await app.inject({ method: "PATCH", url: `/api/shop/orders/${id}/edit`, payload: { items: [{ productId: p!.id, qty: 3 }], delivery: { method: "novaposhta", city: "Київ", branch: "12" } }, headers: H });
  assert.equal(e.statusCode, 200);
  assert.equal(await stock(), 7);
  const o2 = await get();
  assert.equal(o2.totalKop, 60000);
  const edit = o2.events.find((x: { kind: string }) => x.kind === "edit");
  assert.deepEqual(edit.data.items.to, ["Мед × 3"]);
  assert.equal(edit.data.delivery.to, "Київ, 12");
  assert.equal(edit.by, "Work");

  assert.equal((await app.inject({ method: "POST", url: `/api/shop/orders/${id}/comments`, payload: { text: "Просила зателефонувати після 18:00" }, headers: H })).statusCode, 201);
  assert.equal((await get()).events.at(-1).data.text, "Просила зателефонувати після 18:00");

  const na = await app.inject({ method: "POST", url: `/api/shop/orders/${id}/no-answer`, headers: H });
  assert.ok(new Date(na.json().callbackAt).getTime() - Date.now() > 1.9 * 3_600_000, "call again in 2 hours");
  await db.update(orders).set({ callbackAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, id));
  const todo = (await app.inject({ url: "/api/dashboard", headers: { cookie } })).json().todo;
  assert.equal(todo.find((t: { key: string }) => t.key === "callback")?.params.n, 1, "«Час передзвонити» on Home");
  assert.equal((await app.inject({ url: "/api/shop/orders?status=callback", headers: { cookie } })).json().length, 1);

  // A second order from the same phone the same day: a duplicate, merged into the first.
  const d = await manual({ ...base, customer: { name: "Ірина", phone: "0671234567" }, items: [{ productId: p!.id, qty: 1 }], source: "call" });
  assert.equal(await stock(), 6);
  const dup = await get();
  assert.deepEqual(dup.duplicates.map((x: { id: string }) => x.id), [d.json().id]);
  assert.equal((await app.inject({ method: "POST", url: `/api/shop/orders/${id}/merge`, payload: { other: d.json().id }, headers: H })).statusCode, 200);
  const merged = await get();
  assert.equal(merged.totalKop, 80000);
  assert.equal(merged.items.length, 2);
  const other = await get(d.json().id);
  assert.deepEqual([other.status, other.cancelReason], ["cancelled", "duplicate"]);
  assert.equal(await stock(), 6, "merging moves items, stock stays");

  // Sent orders are not edited any more.
  await app.inject({ method: "PATCH", url: `/api/shop/orders/${id}`, payload: { status: "shipped" }, headers: H });
  assert.equal((await app.inject({ method: "PATCH", url: `/api/shop/orders/${id}/edit`, payload: { comment: "x" }, headers: H })).json().error, "not_editable");
  assert.equal((await get()).callbackAt, null, "a status change ends «Не додзвонились»");
  assert.equal((await manual({ ...base, items: [{ productId: p!.id, qty: 99 }] })).json().error, "out_of_stock");

  // Bulk: status for several orders at once, cancelling still needs the reason; Excel.
  const a2 = (await manual({ ...base, customer: { name: "Олег", phone: "+380931110001" }, items: [{ name: "Листівка", price: 20, qty: 1 }] })).json();
  const b2 = (await manual({ ...base, customer: { name: "Ніна", phone: "+380931110002" }, items: [{ name: "Листівка", price: 20, qty: 1 }] })).json();
  const bulk = (body: object) => app.inject({ method: "POST", url: "/api/shop/orders/bulk-status", payload: body, headers: H });
  assert.deepEqual((await bulk({ ids: [a2.id, b2.id], status: "confirmed" })).json(), { done: 2, failed: [] });
  const noReason = (await bulk({ ids: [a2.id, b2.id], status: "cancelled" })).json();
  assert.equal(noReason.done, 0);
  assert.deepEqual(noReason.failed.map((x: { error: string }) => x.error), ["reason_required", "reason_required"]);
  assert.equal((await bulk({ ids: [a2.id], status: "cancelled", reason: "changed_mind" })).json().done, 1);
  const csv = await app.inject({ url: `/api/shop/orders/export?ids=${a2.id},${b2.id}`, headers: { cookie } });
  assert.match(String(csv.headers["content-type"]), /text\/csv/);
  const text = csv.body.replace(/^\uFEFF/, "");
  const [head, ...lines] = text.split("\r\n");
  assert.equal(head, "№;Дата;Статус;Покупець;Телефон;Товари;Сума, грн;Оплата;Доставка;ТТН;Джерело;Коментар");
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.includes("Скасовано") && l.includes("Олег") && l.includes("20,00")));
  await db.delete(sites).where(eq(sites.id, site!.id));
});

test("orders entered by hand do not pop up as «Нове замовлення»", async () => {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Fresh", phone: "+380500000017", email: `${tag}f@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`;
  const first = (await app.inject({ url: "/api/shop/orders/fresh", headers: { cookie } })).json();
  await app.inject({ method: "POST", url: "/api/shop/orders", payload: { customer: { name: "Вручну", phone: "+380931110009" }, items: [{ name: "Листівка", price: 20, qty: 1 }], delivery: { method: "pickup" }, payment: "cod", source: "call" }, headers: { cookie, origin: ORIGIN } });
  assert.deepEqual((await app.inject({ url: `/api/shop/orders/fresh?after=${encodeURIComponent(first.now)}`, headers: { cookie } })).json().orders, []);
});
