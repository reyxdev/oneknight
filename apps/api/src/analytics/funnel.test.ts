import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { orders, products, reviews, sites } from "../db/schema.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { importRozetkaReviews, type RozetkaFetch } from "../integrations/rozetka.ts";
import { deviceOf } from "./routes.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `fun${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("devices from the user agent", () => {
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Safari/537.36"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0"), "desktop");
});

test("funnel, contacts, pages, devices, products, ad payback; widgets, social proof, stars for Google; review replies; Rozetka reviews", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Fun", phone: "+380500000092", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const H = { cookie, origin: ORIGIN };
  const org = reg.json().organizations[0].id as string;
  await startTrial(org);
  await installModule(org, "analytics");
  await installModule(org, "reviews");
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "Свічки", verifiedAt: new Date() }).returning();
  const [candle] = await db.insert(products).values({ organizationId: org, siteId: site!.id, name: "Свічка «Лаванда»", priceKop: 35000 }).returning();
  const K = { "x-site-key": site!.publicKey };
  const s = (x: string) => x.padEnd(20, "0");
  const ev = (body: object, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/140") => app.inject({ method: "POST", url: "/api/public/events", payload: body, headers: { ...K, "user-agent": ua } });

  // Three visits: all see a page, two open the product, one adds it to the cart and orders; contacts clicked.
  const phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";
  for (const x of ["a", "b", "c"]) await ev({ type: "pageview", session: s(x), path: "/", source: "instagram", campaign: "spring" }, x === "a" ? phone : undefined);
  await ev({ type: "pageview", session: s("a"), path: "/candles/lavender", source: "instagram", campaign: "spring" }, phone);
  for (const x of ["a", "b"]) await ev({ type: "product", session: s(x), ref: candle!.id, source: "instagram", campaign: "spring" });
  await ev({ type: "cart", session: s("a"), ref: candle!.id, source: "instagram", campaign: "spring" });
  assert.equal((await ev({ type: "product", session: s("a"), ref: "not-a-uuid" })).statusCode, 400);
  await ev({ type: "contact", session: s("b"), ref: "viber" });
  await ev({ type: "contact", session: s("c"), ref: "phone" });
  const order = await app.inject({ method: "POST", url: "/api/public/orders", payload: { customer: { name: "Олена Коваль", phone: "+380671234567" }, items: [{ productId: candle!.id, qty: 2 }], delivery: { method: "novaposhta", city: "Київ", branch: "1" }, payment: "cod", analytics: { session: s("a"), source: "instagram", campaign: "spring" } }, headers: K });
  assert.equal(order.statusCode, 201);

  const a = (await app.inject({ url: "/api/analytics?days=7", headers: { cookie } })).json();
  assert.deepEqual(a.funnel, { visits: 3, product: 2, cart: 1, order: 1 });
  assert.deepEqual([a.contacts.viber, a.contacts.phone, a.totals.contacts], [1, 1, 2]);
  assert.deepEqual([a.devices.mobile, a.devices.desktop], [1, 2]);
  assert.equal(a.pages.find((p: { path: string }) => p.path === "/").sessions, 3);
  const prod = a.products.find((p: { id: string }) => p.id === candle!.id);
  assert.deepEqual([prod.views, prod.carts, prod.sold, prod.revenueKop], [2, 1, 2, 70000]);

  // Ad payback: 350 грн spent on Instagram, 700 грн of orders came from it.
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await app.inject({ method: "POST", url: "/api/analytics/spend", payload: { channel: "Instagram", fromDate: today, toDate: today, amount: 350 }, headers: H })).statusCode, 201);
  const ads = (await app.inject({ url: "/api/analytics/ads?days=7", headers: { cookie } })).json();
  assert.deepEqual([ads.rows[0].channel, ads.rows[0].spentKop, ads.rows[0].revenueKop, ads.rows[0].roi, ads.rows[0].costPerOrderKop], ["instagram", 35000, 70000, 2, 35000]);

  // Widgets: off until switched on; social proof shows the first name and city only.
  assert.deepEqual((await app.inject({ url: "/api/public/widgets", headers: K })).json(), { socialProof: false, reviews: false, stars: false, poweredBy: false });
  assert.deepEqual((await app.inject({ url: "/api/public/social-proof", headers: K })).json(), []);
  await app.inject({ method: "PATCH", url: `/api/sites/${site!.id}`, payload: { settings: { socialProof: true, stars: true, reviewsBlock: true } }, headers: H });
  assert.deepEqual((await app.inject({ url: "/api/public/widgets", headers: K })).json(), { socialProof: true, reviews: true, stars: true, poweredBy: false });
  const sp = (await app.inject({ url: "/api/public/social-proof", headers: K })).json();
  assert.deepEqual([sp[0].name, sp[0].city, sp[0].product], ["Олена", "Київ", "Свічка «Лаванда»"]);
  assert.ok(!JSON.stringify(sp).includes("Коваль") && !JSON.stringify(sp).includes("380"), "no surname, no phone");
  await app.inject({ method: "PATCH", url: `/api/sites/${site!.id}`, payload: { settings: { widgetsOff: true } }, headers: H });
  assert.deepEqual((await app.inject({ url: "/api/public/social-proof", headers: K })).json(), [], "«вимкнути всі»");

  // Reviews: a reply shown on the site; the rating and the schema.org data for Google.
  const [rv] = await db.insert(reviews).values({ organizationId: org, siteId: site!.id, authorName: "Ірина", rating: 4, text: "Гарно пахне", consent: true, status: "published" }).returning();
  assert.equal((await app.inject({ method: "PUT", url: `/api/reviews/${rv!.id}/reply`, payload: { text: "Дякуємо, Ірино!" }, headers: H })).statusCode, 200);
  const pub = (await app.inject({ url: "/api/public/reviews", headers: K })).json();
  assert.equal(pub[0].reply.text, "Дякуємо, Ірино!");
  assert.deepEqual((await app.inject({ url: "/api/public/reviews/summary", headers: K })).json(), { count: 1, average: 4 });
  const ld = (await app.inject({ url: "/api/public/reviews/schema", headers: K })).json();
  assert.deepEqual([ld["@type"], ld.aggregateRating.ratingValue, ld.aggregateRating.reviewCount, ld.review[0].reviewRating.ratingValue], ["Store", 4, 1, 4]);

  // Rozetka: like / middle / dislike → 5 / 3 / 1 (owner's decision), to moderation, each once, with the store's reply.
  const fake: RozetkaFetch = async (path) => {
    if (path === "/sites") return { status: 200, body: { success: true, content: { access_token: "t" } } };
    return {
      status: 200,
      body: {
        success: true,
        content: {
          marketReviews: [
            { id: 11, user: "#### Олег", vote: "like", comment: "Швидко", review_delivery: "Доставка за день", created_at: "2026-09-20 10:00:00", reply: { comment: "Дякуємо!", created_at: "2026-09-21 09:00:00" } },
            { id: 12, user: "Марія", vote: "middle", comment: "", created_at: "2026-09-21 10:00:00" },
            { id: 13, user: "Ігор", vote: "dislike", comment: "Довго", created_at: "2026-09-22 10:00:00" },
          ],
          _meta: { pageCount: 1 },
        },
      },
    };
  };
  assert.equal((await importRozetkaReviews(org, { username: "u", password: "p" }, fake)).imported, 3);
  assert.equal((await importRozetkaReviews(org, { username: "u", password: "p" }, fake)).imported, 0, "each once");
  const rz = await db.select().from(reviews).where(eq(reviews.source, "rozetka"));
  const mine = rz.filter((r) => r.organizationId === org).sort((x, y) => Number(x.externalId) - Number(y.externalId));
  assert.deepEqual(mine.map((r) => [r.authorName, r.rating, r.status]), [["Олег", 5, "pending"], ["Марія", 3, "pending"], ["Ігор", 1, "pending"]]);
  assert.deepEqual([mine[0]!.text, mine[0]!.reply], ["Швидко\nДоставка за день", "Дякуємо!"]);
  await db.delete(orders).where(eq(orders.organizationId, org));
});
