import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { integrations, sites } from "../db/schema.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { upPhone, type UpFetch } from "./ukrposhta.ts";

const BEARER = "b".repeat(36);
const TOKEN = "t".repeat(36);
const calls: { method: string; url: string; body: any }[] = [];
let addr = 1000;
/** Responses shaped as in the Ukrposhta docs (eCom 0.0.1, address classifier v3.22). */
const fake: UpFetch = async (url, init: { method?: string; bearer: string; body?: any; binary?: boolean }) => {
  calls.push({ method: init.method ?? "GET", url, body: init.body });
  if (init.bearer !== BEARER) return { status: 401, body: { error: "unauthorized", error_description: "Unauthorized - invalid or missing token" } };
  const u = new URL(url);
  if (u.pathname.endsWith("/phones/UA/prohibited")) return u.searchParams.get("token") === TOKEN ? { status: 200, body: [{ phone: "5555556", country: "UA" }] } : { status: 401, body: { error: "unauthorized" } };
  if (u.pathname.endsWith("/get_city_by_region_id_and_district_id_and_city_ua")) return { status: 200, body: { Entries: { Entry: [{ CITY_ID: "5374", CITY_UA: "Бровари", SHORTCITYTYPE_UA: "м.", REGION_UA: "Київська", DISTRICT_UA: "Броварський", CITY_KATOTTG: "UA32020050010059371" }] } } };
  if (u.pathname.endsWith("/get_postoffices_by_postcode_cityid_cityvpzid")) return { status: 200, body: { Entries: { Entry: [{ POSTCODE: "07400", POSTOFFICE_UA: "Бровари", STREET_UA_VPZ: "вул. Героїв України, 20", LOCK_CODE: "0", IS_SECURITY: "0" }, { POSTCODE: "07401", POSTOFFICE_UA: "Бровари 1", LOCK_CODE: "65535" }] } } };
  if (u.pathname.endsWith("/get_postoffices_by_postindex")) return { status: 200, body: { Entries: { Entry: { POSTCODE: u.searchParams.get("pi"), PO_SHORT: "Львів 5", ADDRESS: "вул. Городоцька, 1", CITY_UA: "Львів", POCITY_ID: "1", LOCK_CODE: "0" } } } };
  if (u.pathname.endsWith("/addresses")) return { status: 200, body: { id: ++addr, postcode: init.body.postcode } };
  if (u.pathname.endsWith("/clients")) return { status: 200, body: { uuid: `client-${init.body.lastName ?? init.body.name}`, addressId: init.body.addressId } };
  if (u.pathname.endsWith("/shipments")) return { status: 200, body: { uuid: "ship-uuid", barcode: "0500113894965", deliveryPrice: 55 } };
  if (u.pathname.includes("/sticker")) return { status: 200, body: null, buffer: Buffer.from("%PDF-1.4 label") };
  return { status: 404, body: { message: "unexpected" } };
};

const app = await buildApp({ logger: false }, { upFetch: fake });
const ORIGIN = "http://localhost:3000";
const tag = `up${Date.now()}`;
after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("upPhone uses the national format from the docs", () => {
  assert.equal(upPhone("+380 67 123 12 34"), "0671231234");
  assert.equal(upPhone("671231234"), "0671231234");
});

test("Ukrposhta: connect, offices, waybill from the order form, printing", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Up", phone: "+380500000017", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const H = { cookie, origin: ORIGIN };
  const sender = { type: "PRIVATE_ENTREPRENEUR", firstName: "Іван", lastName: "Майстер", phone: "+380671231234", tin: "1234567890", bankAccount: "UA073808050000000026000439806" };

  const connect = (body: object) => app.inject({ method: "POST", url: "/api/integrations/ukrposhta/connect", payload: body, headers: H });
  assert.equal((await connect({ bearer: BEARER, token: TOKEN, sender: { ...sender, tin: undefined } })).json().error, "invalid_input", "ФОП needs ІПН");
  assert.deepEqual((await connect({ bearer: "x".repeat(36), token: TOKEN, sender })).json(), { error: "provider_rejected", detail: "unauthorized" });
  assert.equal((await connect({ bearer: BEARER, token: TOKEN, sender })).json().ok, true);
  const [row] = await db.select().from(integrations).where(eq(integrations.organizationId, org));
  assert.ok(!row!.credentialsEnc.includes(BEARER) && !JSON.stringify(await (await app.inject({ url: "/api/integrations", headers: { cookie } })).json()).includes(TOKEN));

  const cities = (await app.inject({ url: "/api/integrations/ukrposhta/cities?q=Бровари", headers: { cookie } })).json();
  assert.deepEqual(cities[0], { ref: "UA32020050010059371|5374", name: "м. Бровари", area: "Броварський, Київська" });
  const offices = (await app.inject({ url: `/api/integrations/ukrposhta/warehouses?city=${encodeURIComponent(cities[0].ref)}`, headers: { cookie } })).json();
  assert.deepEqual(offices.map((o: { ref: string }) => o.ref), ["07400"], "blocked offices hidden");

  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const prod = (await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Хлібниця", price: 1100 }, headers: H })).json();
  await app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Олена Коваль", phone: "067 111 22 33" }, items: [{ productId: prod.id, qty: 1 }], delivery: { method: "ukrposhta", city: "Львів", branch: "79005" }, payment: "cod" }, headers: { "x-site-key": site!.publicKey } });
  const orderId = (await app.inject({ url: "/api/shop/orders", headers: { cookie } })).json()[0].id;

  assert.deepEqual((await app.inject({ url: `/api/integrations/ukrposhta/draft/${orderId}`, headers: { cookie } })).json(), { moduleActive: false, connected: true });
  await startTrial(org);
  await installModule(org, "ukrposhta");
  const draft = (await app.inject({ url: `/api/integrations/ukrposhta/draft/${orderId}`, headers: { cookie } })).json();
  assert.equal(draft.recipient.warehouse.ref, "79005", "office found by the postcode from the order");
  assert.deepEqual([draft.cod, draft.size], [1100, { length: 30, width: 20, height: 10 }]);

  const body = { orderId, sender: { cityRef: cities[0].ref, cityName: cities[0].name, warehouseRef: "07400", warehouseName: offices[0].name }, recipient: { cityRef: "", warehouseRef: "79005" }, weight: 1.2, size: { length: 30, width: 20, height: 12 }, description: "Хлібниця" };
  calls.length = 0;
  const w = await app.inject({ method: "POST", url: "/api/integrations/ukrposhta/waybill", payload: body, headers: H });
  assert.equal(w.json().number, "0500113894965");
  const clients = calls.filter((c) => c.url.includes("/clients"));
  assert.deepEqual(clients[0]!.body, { type: "PRIVATE_ENTREPRENEUR", addressId: 1001, phoneNumber: "0671231234", firstName: "Іван", lastName: "Майстер", tin: "1234567890", bankAccount: "UA073808050000000026000439806" });
  assert.deepEqual(clients[1]!.body, { type: "INDIVIDUAL", firstName: "Олена", lastName: "Коваль", addressId: 1002, phoneNumber: "0671112233" });
  const ship = calls.find((c) => c.url.includes("/shipments"))!;
  assert.match(ship.url, new RegExp(`/ecom/0\\.0\\.1/shipments\\?token=${TOKEN}$`));
  assert.deepEqual(ship.body, {
    sender: { uuid: "client-Майстер" },
    recipient: { uuid: "client-Коваль" },
    type: "STANDARD",
    deliveryType: "W2W",
    paidByRecipient: true,
    description: "Хлібниця",
    parcels: [{ name: "Parcel", weight: 1200, length: 30, width: 20, height: 12, declaredPrice: 1100 }],
    postPay: 1100,
    postPayPaidByRecipient: true,
    transferPostPayToBankAccount: true,
  });
  const o = (await app.inject({ url: `/api/shop/orders/${orderId}`, headers: { cookie } })).json();
  assert.deepEqual([o.waybill, o.waybillRef], ["0500113894965", "ship-uuid"]);

  // The sender client is reused for the same sender office.
  const again = (await app.inject({ url: `/api/integrations/ukrposhta/draft/${orderId}`, headers: { cookie } })).json();
  assert.equal(again.sender.warehouse.ref, "07400");
  const [saved] = await db.select().from(integrations).where(eq(integrations.organizationId, org));
  assert.deepEqual((saved!.settings as { senders: object }).senders, { "07400": "client-Майстер" });

  const pdf = await app.inject({ url: `/api/integrations/ukrposhta/print/${orderId}`, headers: { cookie } });
  assert.equal(pdf.headers["content-type"], "application/pdf");
  assert.match(calls.at(-1)!.url, /^https:\/\/www\.ukrposhta\.ua\/forms\/ecom\/0\.0\.1\/shipments\/ship-uuid\/sticker\?token=t+&size=SIZE_A4$/);
  await app.inject({ url: `/api/integrations/ukrposhta/print/${orderId}?kind=marking`, headers: { cookie } });
  assert.ok(calls.at(-1)!.url.endsWith(`sticker?token=${TOKEN}`), "100x100 label");
  await db.delete(sites).where(eq(sites.id, site!.id));
});
