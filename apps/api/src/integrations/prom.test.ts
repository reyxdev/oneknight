import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { sql } from "../db/client.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { mapPromOrder, promKop, type PromFetch } from "./prom.ts";

const TOKEN = "19efbdc8ee723b7eb9e6dae1f7a20ca4378b288c";
/** Orders shaped as in the Prom public API spec (Orders/schemas/Order.yaml). */
const promOrder = (id: number, extra: object = {}) => ({
  id,
  date_created: "2026-09-28T12:50:34.588791+00:00",
  client_first_name: "Оксана",
  client_last_name: "Мельник",
  client_notes: "Подзвоніть перед відправкою",
  products: [{ id: 555, name: "Хлібниця «Маки»", quantity: 2, price: "1 100 грн" }],
  phone: "+380671234567",
  email: "oksana@example.com",
  price: "2 200 грн",
  full_price: "2 270 грн",
  delivery_option: { id: 1, name: "Нова Пошта" },
  delivery_provider_data: { provider: "nova_poshta", type: "W2W", declaration_number: null },
  delivery_address: "Львів, №5 (до 30 кг): вул. Городоцька, 1",
  payment_option: { id: 2, name: "Накладений платіж" },
  status: "pending",
  source: "portal",
  ...extra,
});
const paths: string[] = [];
let orders = [promOrder(9001), promOrder(9002, { status: "received" }), promOrder(9003, { status: "draft" })];
const fake: PromFetch = async (token, path) => {
  paths.push(path);
  if (token !== TOKEN) return { status: 401, body: null };
  return { status: 200, body: { orders: path.includes("limit=1&") || path.endsWith("limit=1") ? orders.slice(0, 1) : orders } };
};

const app = await buildApp({ logger: false }, { promFetch: fake });
const ORIGIN = "http://localhost:3000";
const tag = `prom${Date.now()}`;
after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("promKop and mapPromOrder follow the Prom spec shapes", () => {
  assert.equal(promKop("1 100,50 грн"), 110050);
  assert.equal(promKop("17.20"), 1720);
  assert.equal(mapPromOrder(promOrder(1, { status: "draft" })), null);
  const m = mapPromOrder(promOrder(1))!;
  assert.deepEqual(m.delivery, { method: "novaposhta", address: "Львів, №5 (до 30 кг): вул. Городоцька, 1", city: "Львів", branch: "5" });
  assert.equal(m.payment, "cod");
  assert.equal(m.totalKop, 220000);
  assert.deepEqual(m.items, [{ productId: "prom:555", name: "Хлібниця «Маки»", qty: 2, priceKop: 110000 }]);
});

test("Prom: token check, module gate, import without duplicates", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Prom", phone: "+380500000010", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const H = { cookie, origin: ORIGIN };

  const bad = await app.inject({ method: "POST", url: "/api/integrations/prom/connect", payload: { token: "a".repeat(40) }, headers: H });
  assert.deepEqual(bad.json(), { error: "provider_rejected", detail: "unauthorized" });
  assert.equal((await app.inject({ method: "POST", url: "/api/integrations/prom/connect", payload: { token: TOKEN }, headers: H })).json().ok, true);
  assert.equal((await app.inject({ method: "POST", url: "/api/integrations/prom/sync", headers: H })).json().error, "module_not_active");

  await startTrial(org);
  await installModule(org, "prom");
  const s1 = (await app.inject({ method: "POST", url: "/api/integrations/prom/sync", headers: H })).json();
  assert.deepEqual(s1, { ok: true, imported: 2 }, "draft skipped");
  assert.match(paths.at(-1)!, /^\/orders\/list\?limit=100&date_from=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  orders = [...orders, promOrder(9004, { status: "cancelled" })];
  assert.deepEqual((await app.inject({ method: "POST", url: "/api/integrations/prom/sync", headers: H })).json(), { ok: true, imported: 1 }, "only new ones");

  const list = (await app.inject({ url: "/api/shop/orders", headers: { cookie } })).json();
  assert.equal(list.length, 3);
  assert.ok(list.every((o: { source: string; siteId: null }) => o.source === "prom" && o.siteId === null));
  const received = list.find((o: { status: string }) => o.status === "confirmed");
  assert.ok(received, "received -> confirmed");
  const full = (await app.inject({ url: `/api/shop/orders/${received.id}`, headers: { cookie } })).json();
  assert.equal(full.customerName, "Оксана Мельник");
  assert.equal(full.externalId, "9002");
  // Cancelling a marketplace order must not touch local stock (items are "prom:..." ids).
  assert.equal((await app.inject({ method: "PATCH", url: `/api/shop/orders/${received.id}`, payload: { status: "cancelled" }, headers: H })).json().ok, true);
  assert.equal((await app.inject({ method: "PATCH", url: `/api/shop/orders/${received.id}`, payload: { status: "new" }, headers: H })).json().ok, true);
  const notes = (await app.inject({ url: "/api/notifications", headers: { cookie } })).json();
  assert.ok(JSON.stringify(notes).includes("newOrder"));
});
