import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { sql } from "../db/client.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { kyivTime } from "./import.ts";
import { mapRozetkaOrder, type RozetkaFetch } from "./rozetka.ts";

/** Orders shaped as in the Rozetka Seller API example for GET /orders/search (expand=delivery,purchases,user). */
const rzOrder = (id: number, extra: object = {}) => ({
  id,
  created: "2026-09-28 11:49:32",
  amount: "640.00",
  amount_with_discount: "600.00",
  status: 1,
  status_group: 1,
  comment: "Test_order",
  user_phone: "380954954374",
  ttn: "",
  payment_type: "cash",
  payment_type_name: "Наличная",
  user: { id: 39919762, contact_fio: "Василенко Василь" },
  delivery: { delivery_service_id: 5, delivery_service_name: "Новая Почта", recipient_title: "Test", place_street: "", place_number: "76", city: { id: 1, name: "Киев", name_ua: "Київ" }, name_logo: "nova-pochta" },
  purchases: [{ id: 158280800, price: "640.00", price_with_discount: "600.00", quantity: 1, item_id: 38221768, item_name: "Хлібниця «Маки»" }],
  ...extra,
});
let logins = 0;
let expire = false;
const calls: string[] = [];
const fake: RozetkaFetch = async (path, init) => {
  calls.push(path);
  if (path === "/sites") {
    const b = init.body as { username: string; password: string };
    if (b.username === "shop" && Buffer.from(b.password, "base64").toString() === "пароль 1") {
      logins++;
      return { status: 200, body: { success: true, content: { access_token: `tok${logins}`, market: { title: "Хлібниці Карпат" } } } };
    }
    return { status: 200, body: { success: false, errors: { message: "incorrect_username_password", code: 1004 } } };
  }
  if (expire && init.token === "tok2") return { status: 401, body: { success: false, errors: { message: "unauthorized" } } };
  return { status: 200, body: { success: true, content: { orders: [rzOrder(248888186), rzOrder(248888187, { status_group: 3 })], _meta: { pageCount: 1, currentPage: 1 } } } };
};

const app = await buildApp({ logger: false }, { rozetkaFetch: fake });
const ORIGIN = "http://localhost:3000";
const tag = `rz${Date.now()}`;
after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("kyivTime converts Kyiv local time (summer +3, winter +2)", () => {
  assert.equal(kyivTime("2026-07-01 12:00:00").toISOString(), "2026-07-01T09:00:00.000Z");
  assert.equal(kyivTime("2026-01-15 12:00:00").toISOString(), "2026-01-15T10:00:00.000Z");
});

test("mapRozetkaOrder follows the API example", () => {
  const m = mapRozetkaOrder(rzOrder(1))!;
  assert.deepEqual(m.delivery, { method: "novaposhta", address: "Київ", city: "Київ", branch: "76" });
  assert.deepEqual([m.customerName, m.payment, m.totalKop, m.items[0]!.priceKop, m.status], ["Василенко Василь", "cod", 60000, 60000, "new"]);
  assert.equal(mapRozetkaOrder(rzOrder(2, { status_group: 3 }))!.status, "cancelled");
});

test("Rozetka: login check, module gate, import once, re-login after an expired token", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Rz", phone: "+380500000016", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const H = { cookie, origin: ORIGIN };
  const connect = (body: object) => app.inject({ method: "POST", url: "/api/integrations/rozetka/connect", payload: body, headers: H });

  assert.deepEqual((await connect({ username: "shop", password: "wrong" })).json(), { error: "provider_rejected", detail: "incorrect_username_password" });
  assert.deepEqual((await connect({ username: "shop", password: "пароль 1" })).json(), { ok: true, market: "Хлібниці Карпат" });
  const list = (await app.inject({ url: "/api/integrations", headers: { cookie } })).json();
  assert.ok(!JSON.stringify(list).includes("пароль 1"), "password never returned");

  const sync = () => app.inject({ method: "POST", url: "/api/integrations/rozetka/sync", headers: H });
  assert.equal((await sync()).json().error, "module_not_active");
  await startTrial(org);
  await installModule(org, "rozetka");
  assert.deepEqual((await sync()).json(), { ok: true, imported: 2 });
  assert.match(calls.at(-1)!, /^\/orders\/search\?created_from=\d{4}-\d\d-\d\d&expand=delivery,purchases,user&sort=id&page=1$/);
  expire = true;
  assert.deepEqual((await sync()).json(), { ok: true, imported: 0 }, "no duplicates");
  assert.equal(logins, 3, "connect check + first sync + re-login after 401");
  const orders = (await app.inject({ url: "/api/shop/orders", headers: { cookie } })).json();
  assert.deepEqual(orders.map((o: { source: string; status: string }) => `${o.source}:${o.status}`).sort(), ["rozetka:cancelled", "rozetka:new"]);
});
