import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { reviews, sites } from "../db/schema.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { purgeTrash } from "./routes.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `rev${Date.now()}`;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("reviews: module gate, verified purchase, moderation, photo privacy, trash purge", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Rev", phone: "+380500000004", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const K = { "x-site-key": site!.publicKey };
  const body = { name: "Марія", rating: 5, text: "Чудова хлібниця!", consent: true, photo: { data: PNG } };

  assert.equal((await app.inject({ method: "POST", url: "/api/public/reviews", payload: body, headers: K })).json().error, "module_not_active");
  await startTrial(org);
  assert.deepEqual(await installModule(org, "reviews"), { ok: true, free: true });

  // A product and an order for the verified-purchase check
  const prod = (await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Хлібниця", price: 1100 }, headers: { cookie, origin: ORIGIN } })).json();
  const order = (await app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Марія", phone: "+380 67 111 22 33" }, items: [{ productId: prod.id, qty: 1 }], delivery: { method: "pickup" }, payment: "cod" }, headers: K })).json();

  const r1 = await app.inject({ method: "POST", url: "/api/public/reviews", payload: { ...body, orderNumber: order.number, phone: "0671112233" }, headers: K });
  assert.equal(r1.statusCode, 201);
  assert.equal(r1.json().status, "pending", "manual moderation by default");
  assert.equal(r1.json().verified, true);
  const noConsent = (await app.inject({ method: "POST", url: "/api/public/reviews", payload: { ...body, consent: false, photo: undefined }, headers: K })).json();
  assert.equal((await app.inject({ url: "/api/public/reviews", headers: K })).json().length, 0);

  const pending = (await app.inject({ url: "/api/reviews?status=pending", headers: { cookie } })).json();
  const mine = pending.find((x: { id: string }) => x.id === r1.json().id);
  assert.equal(mine.product.id, prod.id, "product suggested from the order");
  assert.equal((await app.inject({ url: mine.photo })).statusCode, 401, "photo is private before approval");
  const act = (id: string, a: string) => app.inject({ method: "POST", url: `/api/reviews/${id}/${a}`, payload: {}, headers: { cookie, origin: ORIGIN } });
  assert.equal((await act(noConsent.id, "approve")).json().error, "no_consent");
  assert.equal((await act(mine.id, "approve")).statusCode, 200);
  const pub = (await app.inject({ url: "/api/public/reviews", headers: K })).json();
  assert.equal(pub.length, 1);
  assert.equal(pub[0].verified, true);
  assert.equal((await app.inject({ url: pub[0].photo })).statusCode, 200, "photo public after approval");

  // Moderation off publishes immediately
  await app.inject({ method: "PATCH", url: `/api/reviews/settings/${site!.id}`, payload: { moderation: "off" }, headers: { cookie, origin: ORIGIN } });
  assert.equal((await app.inject({ method: "POST", url: "/api/public/reviews", payload: { ...body, photo: undefined }, headers: K })).json().status, "published");

  // Reject -> trash, purged after 30 days
  await act(mine.id, "reject");
  await db.update(reviews).set({ trashedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(reviews.id, mine.id));
  assert.ok((await purgeTrash()) >= 1);
  assert.equal((await db.select().from(reviews).where(eq(reviews.id, mine.id))).length, 0);
  await db.delete(sites).where(eq(sites.id, site!.id));
});
