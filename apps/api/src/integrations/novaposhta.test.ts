import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { integrations, sites } from "../db/schema.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { npPhone, type NpCall } from "./novaposhta.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const calls: { model: string; method: string; props: Record<string, any> }[] = [];
/** Recorded-style Nova Poshta responses (shape as returned by api.novaposhta.ua). */
const fake: NpCall = async (apiKey, model, method, props) => {
  calls.push({ model, method, props });
  if (apiKey !== KEY) return { success: false, data: [], errors: ["API key expired"] };
  const key = `${model}.${method}`;
  if (key === "Counterparty.getCounterparties") return { success: true, data: [{ Ref: "sender-cp", Description: "ФОП Тест" }], errors: [] };
  if (key === "Counterparty.getCounterpartyContactPersons") return { success: true, data: [{ Ref: "sender-contact", Description: "Іван Тест", Phones: "380671234567" }], errors: [] };
  if (key === "Address.getCities") return { success: true, data: String(props.FindByString).startsWith("Льв") ? [{ Ref: "city-lviv", Description: "Львів", AreaDescription: "Львівська" }] : [{ Ref: "city-kyiv", Description: "Київ", AreaDescription: "Київська" }], errors: [] };
  if (key === "Address.getWarehouses") return { success: true, data: [{ Ref: `wh-${props.CityRef}-5`, Description: "Відділення №5", Number: "5" }, { Ref: `wh-${props.CityRef}-50`, Description: "Відділення №50", Number: "50" }], errors: [] };
  if (key === "Counterparty.save") return { success: true, data: [{ Ref: "rec-cp", ContactPerson: { data: [{ Ref: "rec-contact" }] } }], errors: [] };
  if (key === "InternetDocument.save") return { success: true, data: [{ Ref: "doc-ref", IntDocNumber: "20450000000001", CostOnSite: 70 }], errors: [] };
  return { success: false, data: [], errors: ["unexpected"] };
};

const app = await buildApp({ logger: false }, { npCall: fake });
const ORIGIN = "http://localhost:3000";
const tag = `np${Date.now()}`;
after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("npPhone normalises Ukrainian numbers", () => {
  assert.equal(npPhone("+380 67 123 45 67"), "380671234567");
  assert.equal(npPhone("067-123-45-67"), "380671234567");
  assert.equal(npPhone("671234567"), "380671234567");
});

test("Nova Poshta: connect with a real-shaped key check, sender address, waybill from an order", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "NP", phone: "+380500000009", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const H = { cookie, origin: ORIGIN };

  assert.equal((await app.inject({ method: "POST", url: "/api/integrations/novaposhta/connect", payload: { apiKey: "short" }, headers: H })).json().error, "invalid_key_format");
  const bad = await app.inject({ method: "POST", url: "/api/integrations/novaposhta/connect", payload: { apiKey: "f".repeat(32) }, headers: H });
  assert.deepEqual(bad.json(), { error: "provider_rejected", detail: "API key expired" });
  const good = await app.inject({ method: "POST", url: "/api/integrations/novaposhta/connect", payload: { apiKey: KEY }, headers: H });
  assert.equal(good.json().sender.name, "Іван Тест");
  const [row] = await db.select().from(integrations).where(eq(integrations.organizationId, org));
  assert.ok(!row!.credentialsEnc.includes(KEY), "key stored encrypted");
  const list = (await app.inject({ url: "/api/integrations", headers: { cookie } })).json();
  assert.equal(list.find((x: { provider: string }) => x.provider === "novaposhta").status, "connected");
  assert.ok(!JSON.stringify(list).includes(KEY), "key never returned");

  const cities = (await app.inject({ url: "/api/integrations/novaposhta/cities?q=Київ", headers: { cookie } })).json();
  const whs = (await app.inject({ url: `/api/integrations/novaposhta/warehouses?city=${cities[0].ref}&q=5`, headers: { cookie } })).json();
  await app.inject({ method: "PATCH", url: "/api/integrations/novaposhta/settings", payload: { cityRef: cities[0].ref, cityName: cities[0].name, warehouseRef: whs[0].ref, warehouseName: whs[0].name, weight: 1.5 }, headers: H });

  // An order from the website with a text address
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const prod = (await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Хлібниця", price: 1100 }, headers: H })).json();
  await app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Олена Коваль", phone: "067 111 22 33" }, items: [{ productId: prod.id, qty: 1 }], delivery: { method: "novaposhta", city: "Львів", branch: "№ 5" }, payment: "cod" }, headers: { "x-site-key": site!.publicKey } });
  const orderId = (await app.inject({ url: "/api/shop/orders", headers: { cookie } })).json()[0].id;

  assert.equal((await app.inject({ method: "POST", url: "/api/integrations/novaposhta/waybill", payload: { orderId }, headers: H })).json().error, "module_not_active");
  await startTrial(org);
  await installModule(org, "novaposhta");
  calls.length = 0;
  const w = await app.inject({ method: "POST", url: "/api/integrations/novaposhta/waybill", payload: { orderId }, headers: H });
  assert.equal(w.json().number, "20450000000001");
  const doc = calls.find((c) => c.method === "save" && c.model === "InternetDocument")!.props;
  assert.equal(doc.CityRecipient, "city-lviv");
  assert.equal(doc.RecipientAddress, "wh-city-lviv-5", "branch №5 resolved exactly, not №50");
  assert.equal(doc.RecipientsPhone, "380671112233");
  assert.equal(doc.Weight, "1.5");
  assert.deepEqual(doc.BackwardDeliveryData, [{ PayerType: "Recipient", CargoType: "Money", RedeliveryString: "1100" }], "cash on delivery");
  assert.equal(calls.find((c) => c.model === "Counterparty" && c.method === "save")!.props.LastName, "Коваль");
  assert.equal((await app.inject({ url: `/api/shop/orders/${orderId}`, headers: { cookie } })).json().waybill, "20450000000001");
  assert.equal((await app.inject({ method: "POST", url: "/api/integrations/novaposhta/waybill", payload: { orderId }, headers: H })).json().error, "already_has_waybill");
  await db.delete(sites).where(eq(sites.id, site!.id));
});
