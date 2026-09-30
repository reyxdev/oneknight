import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { orders, products, sites } from "../db/schema.ts";
import { todoFor } from "../dashboard/todo.ts";
import { readTable, writeXlsx } from "../files/table.ts";
import { parcelOf } from "../integrations/routes.ts";
import { privateAddress, publicFetch } from "./photos.ts";
import { rowsFromYml } from "./import.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `prod${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Prod ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string };
}

test("xlsx: written and read back; CSV too", () => {
  const rows = readTable(writeXlsx([["Назва", "Ціна"], ["Мед & «липа»", 250.5]]));
  assert.deepEqual(rows, [["Назва", "Ціна"], ["Мед & «липа»", "250.5"]]);
  assert.deepEqual(readTable(Buffer.from("﻿Назва;Ціна\n\"Чай; зелений\";99,5\n")), [["Назва", "Ціна"], ["Чай; зелений", "99,5"]]);
});

test("imports never reach private addresses", async () => {
  assert.ok(privateAddress("127.0.0.1") && privateAddress("10.1.2.3") && privateAddress("192.168.0.1") && privateAddress("::1") && privateAddress("::ffff:172.16.0.1"));
  assert.ok(!privateAddress("8.8.8.8"));
  for (const url of ["http://localhost/x.xml", "http://127.0.0.1/x", "file:///etc/passwd", "http://user:pw@example.com/"]) await assert.rejects(publicFetch(url, 1000), /bad_url|ENOTFOUND/);
});

test("Prom YML: categories as a path, old price, stock, availability, pictures, params", () => {
  const { rows } = rowsFromYml(`<?xml version="1.0"?><yml_catalog><shop><categories><category id="1">Декор</category><category id="2" parentId="1">Свічки</category></categories>
    <offers><offer id="77" available="true"><name>Свічка</name><name_ua>Свічка «Лаванда»</name_ua><price>350</price><oldprice>420</oldprice><vendorCode>SV-1</vendorCode>
    <quantity_in_stock>12</quantity_in_stock><categoryId>2</categoryId><picture>https://cdn.example.com/1.jpg</picture><param name="Об'єм" unit="мл">200</param>
    <description><![CDATA[<p>Соєвий <b>віск</b></p>]]></description><weight>0.3</weight></offer>
    <offer id="78" available="false"><name>Без ціни</name></offer></offers></shop></yml_catalog>`);
  assert.equal(rows.length, 1, "an offer without a price is an error");
  assert.deepEqual(rows[0]!.row, { sku: "SV-1", name: "Свічка «Лаванда»", priceKop: 35000, oldPriceKop: 42000, stock: 12, availability: "in_stock", description: "Соєвий віск", category: ["Декор", "Свічки"], photos: ["https://cdn.example.com/1.jpg"], attributes: [{ name: "Об'єм", value: "200 мл" }], weightG: 300 });
});

test("products: fields, history, archive, categories, bulk prices, import by article, export, site API, stock alerts, warranty, waybill weight", async () => {
  const o = await register("o", "+380500000041");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const [site] = await db.insert(sites).values({ organizationId: o.org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const S = `/api/shop/sites/${site!.id}`;
  const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object, cookie = o.cookie) => app.inject({ method, url, payload, headers: { cookie, origin: ORIGIN } });

  // Categories with a subcategory.
  const decor = (await call("POST", `${S}/categories`, { name: "Декор" })).json();
  const candles = (await call("POST", `${S}/categories`, { name: "Свічки", parentId: decor.id })).json();
  assert.equal((await call("PATCH", `/api/shop/categories/${decor.id}`, { parentId: candles.id })).statusCode, 400, "not under its own subcategory");

  const made = await call("POST", `${S}/products`, { name: "Свічка «Лаванда»", price: 350, oldPrice: 420, cost: 120, sku: "SV-1", categoryId: candles.id, stock: 3, lowStock: 3, weightG: 300, lengthCm: 8, widthCm: 8, heightCm: 10, warrantyMonths: 6, attributes: [{ name: "Аромат", value: "лаванда" }] });
  assert.equal(made.statusCode, 201);
  const p = made.json();
  assert.deepEqual([p.price, p.oldPrice, p.cost, p.state, p.low], [350, 420, 120, "in_stock", true]);
  assert.equal((await call("POST", `${S}/products`, { name: "Інша", price: 1, sku: "SV-1" })).statusCode, 409, "the article is unique in the site");
  const tea = (await call("POST", `${S}/products`, { name: "Чай", price: 100, availability: "expected" })).json();

  // History: who changed what.
  await call("PATCH", `/api/shop/products/${p.id}`, { price: 370, stock: 10 });
  const card = (await call("GET", `/api/shop/products/${p.id}`)).json();
  const edit = card.events.find((e: { kind: string }) => e.kind === "edit");
  assert.deepEqual(edit.changes.map((c: { field: string }) => c.field).sort(), ["priceKop", "stock"]);
  assert.equal(edit.by, "Prod o");
  assert.equal(card.stats.soldAll, 0);

  // Site API: old price and discount, availability; «Очікується» cannot be ordered, cost never leaves the account.
  const K = { "x-site-key": site!.publicKey };
  const pub = (await app.inject({ url: "/api/public/products", headers: K })).json();
  const pubCandle = pub.find((x: { id: string }) => x.id === p.id);
  assert.deepEqual([pubCandle.oldPrice, pubCandle.discountPercent, pubCandle.availability, pubCandle.inStock, pubCandle.cost, pubCandle.costKop], [420, 12, "in_stock", true, undefined, undefined]);
  assert.equal(pub.find((x: { id: string }) => x.id === tea.id).inStock, false);
  assert.equal((await app.inject({ url: "/api/public/categories", headers: K })).json().length, 2);
  const buy = (items: object[]) => app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Ігор", phone: "+380671234567" }, items, delivery: { method: "novaposhta", city: "Київ" }, payment: "cod" }, headers: K });
  assert.equal((await buy([{ productId: tea.id, qty: 1 }])).json().error, "unavailable");
  const bought = await buy([{ productId: p.id, qty: 2 }]);
  assert.equal(bought.statusCode, 201);

  // Weight of the parcel from the products; the warranty starts when the order is received.
  const [ord] = await db.select().from(orders).where(eq(orders.organizationId, o.org));
  assert.deepEqual(await parcelOf(ord!), { weight: 0.6, size: { length: 8, width: 8, height: 20 } });
  assert.equal((await call("PATCH", `/api/shop/orders/${ord!.id}`, { status: "done" })).statusCode, 200);
  const [done] = await db.select().from(orders).where(eq(orders.id, ord!.id));
  assert.equal(done!.warranty.enabled, true);
  assert.ok(done!.warranty.until! > new Date().toISOString().slice(0, 10));

  // Sales in the card; delete only without orders, otherwise the archive.
  const card2 = (await call("GET", `/api/shop/products/${p.id}`)).json();
  assert.deepEqual([card2.stats.sold30, card2.stats.revenue30Kop, card2.stats.profit30Kop], [2, 74000, 74000 - 2 * 12000]);
  assert.equal((await call("DELETE", `/api/shop/products/${p.id}`)).json().error, "has_orders");
  assert.equal((await call("DELETE", `/api/shop/products/${tea.id}`)).statusCode, 200);

  // Stock 8 of threshold 3: not low; set 2 → «Закінчується» by its own threshold on Home.
  await call("PATCH", `/api/shop/products/${p.id}`, { stock: 2 });
  assert.equal((await todoFor(o.org, ["products"])).find((t) => t.key === "lowStock")?.params.n, 1);

  // Duplicate (hidden, no article), bulk: −10% keeping the old price, archive.
  const copy = (await call("POST", `/api/shop/products/${p.id}/duplicate`)).json();
  assert.deepEqual([copy.sku, copy.active, copy.name], [null, false, "Свічка «Лаванда» (копія)"]);
  await call("PATCH", `/api/shop/products/${copy.id}`, { oldPrice: null });
  assert.equal((await call("POST", `${S}/products/bulk`, { ids: [copy.id], action: { kind: "price", percent: -10, keepOld: true } })).statusCode, 200);
  const [c2] = await db.select().from(products).where(eq(products.id, copy.id));
  assert.deepEqual([c2!.priceKop, c2!.oldPriceKop], [33300, 37000], "370 − 10% = 333 (whole hryvnias), 370 stays crossed out");
  await call("POST", `/api/shop/products/${copy.id}/archive`, { archived: true });
  assert.ok(!(await call("GET", `${S}/products`)).json().some((x: { id: string }) => x.id === copy.id));
  assert.ok((await call("GET", `${S}/products?archived=1`)).json().some((x: { id: string }) => x.id === copy.id));
  assert.ok(!(await app.inject({ url: "/api/public/products", headers: K })).json().some((x: { id: string }) => x.id === copy.id), "archived: off the site");

  // Import: preview first, then apply; the article updates, an empty cell changes nothing, a new one is created.
  const file = writeXlsx([
    ["Артикул", "Назва", "Ціна", "Залишок", "Категорія", "Наявність", "Характеристики"],
    ["SV-1", "", 399, 20, "", "", ""],
    ["TEA-2", "Чай «Карпати»", 120, "", "Напої / Чай", "під замовлення", "Вага: 100 г; Смак: м'ята"],
    ["", "Без ціни", "", "", "", "", ""],
    ["X", "Погана", 5, "", "", "колись", ""],
  ]);
  const imp = (apply: boolean) => call("POST", `${S}/products/import`, { file: { name: "p.xlsx", data: file.toString("base64") }, apply });
  const preview = (await imp(false)).json();
  assert.deepEqual([preview.created, preview.updated, preview.errorCount], [1, 1, 2]);
  assert.equal((await db.select().from(products).where(eq(products.siteId, site!.id))).length, 2, "preview changes nothing");
  await imp(true);
  const [sv] = await db.select().from(products).where(eq(products.sku, "SV-1"));
  assert.deepEqual([sv!.priceKop, sv!.stock, sv!.name, sv!.categoryId], [39900, 20, "Свічка «Лаванда»", candles.id]);
  const [tea2] = await db.select().from(products).where(eq(products.sku, "TEA-2"));
  assert.deepEqual([tea2!.availability, tea2!.stock, tea2!.attributes.length], ["to_order", null, 2]);
  const cats = (await call("GET", `${S}/categories`)).json();
  assert.deepEqual(cats.categories.map((c: { name: string }) => c.name).sort(), ["Декор", "Напої", "Свічки", "Чай"]);
  assert.equal(cats.archived, 1);
  // Deleting a category: products stay without one, subcategories move up.
  await call("DELETE", `/api/shop/categories/${decor.id}`);
  const after2 = (await call("GET", `${S}/categories`)).json();
  assert.equal(after2.categories.find((c: { name: string }) => c.name === "Свічки").parentId, null);

  // Export in the import format.
  const ex = await call("GET", `${S}/products/export.xlsx`);
  const table = readTable(ex.rawPayload);
  assert.equal(table[0]![0], "Артикул");
  assert.ok(table.some((r) => r[0] === "SV-1" && r[2] === "399" && r[9] === "Свічки"));

  // Without «Фінанси»: no cost anywhere, cost from a file is ignored.
  const inv = await call("POST", "/api/team/invites", { role: "manager", permissions: ["products"] });
  const mgr = await register("m", "+380500000042");
  await app.inject({ method: "POST", url: "/api/team/accept", payload: { token: inv.json().token }, headers: { cookie: mgr.cookie, origin: ORIGIN } });
  const mcard = (await call("GET", `/api/shop/products/${p.id}`, undefined, mgr.cookie)).json();
  assert.deepEqual([mcard.cost, mcard.stats.profit30Kop, mcard.stats.sold30], [null, undefined, 2]);
  await call("PATCH", `/api/shop/products/${p.id}`, { cost: 1 }, mgr.cookie);
  assert.equal((await db.select().from(products).where(eq(products.id, p.id)))[0]!.costKop, 12000);
});
