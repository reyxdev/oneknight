import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { sites } from "../db/schema.ts";
import { installModule, startTrial } from "../billing/service.ts";
import { channelOf } from "./channel.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `ana${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

test("channelOf speaks the owner's language", () => {
  assert.equal(channelOf("ig", null, "shop.ua"), "instagram");
  assert.equal(channelOf(null, "https://www.google.com/search?q=x", "shop.ua"), "google");
  assert.equal(channelOf(null, "https://l.facebook.com/l.php", "shop.ua"), "facebook");
  assert.equal(channelOf(null, "https://shop.ua/catalog", "shop.ua"), "direct");
  assert.equal(channelOf(null, null, "shop.ua"), "direct");
  assert.equal(channelOf("partner-blog", null, "shop.ua"), "other:partner-blog");
});

test("events -> sources: channel → campaign → visits → leads → orders", async () => {
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Ana", phone: "+380500000005", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const cookie = `ok_session=${reg.cookies.find((c) => c.name === "ok_session")!.value}`;
  const org = reg.json().organizations[0].id as string;
  const [site] = await db.insert(sites).values({ organizationId: org, domain: `${tag}.shop.com.ua`, name: "S" }).returning();
  const K = { "x-site-key": site!.publicKey };
  const ev = (body: object, ua = "Mozilla/5.0") => app.inject({ method: "POST", url: "/api/public/events", payload: body, headers: { ...K, "user-agent": ua } });

  assert.equal((await ev({ type: "pageview", session: "a".repeat(20) })).statusCode, 204, "without the module events are dropped quietly");
  await startTrial(org);
  await installModule(org, "analytics");

  const ig = { source: "instagram", campaign: "reel17" };
  for (let i = 0; i < 3; i++) assert.equal((await ev({ type: "pageview", session: `ig${i}`.padEnd(20, "x"), ...ig, path: "/" })).statusCode, 204);
  await ev({ type: "lead", session: "ig0".padEnd(20, "x"), ...ig });
  await ev({ type: "pageview", session: "g0".padEnd(20, "x"), referrer: "https://www.google.com/" });
  await ev({ type: "pageview", session: "bot".padEnd(20, "x") }, "Googlebot/2.1");

  const prod = (await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name: "Мед", price: 250 }, headers: { cookie, origin: ORIGIN } })).json();
  const o = await app.inject({
    method: "POST",
    url: "/api/public/orders",
    payload: { customer: { name: "Ігор", phone: "+380671234567" }, items: [{ productId: prod.id, qty: 2 }], delivery: { method: "pickup" }, payment: "cod", analytics: { session: "ig1".padEnd(20, "x"), ...ig } },
    headers: K,
  });
  assert.equal(o.statusCode, 201);

  const a = (await app.inject({ url: "/api/analytics?days=7", headers: { cookie } })).json();
  assert.equal(a.totals.sessions, 4, "bot is ignored");
  assert.equal(a.totals.orders, 1);
  assert.equal(a.totals.revenueKop, 50000);
  assert.equal(a.series.length, 7);
  const insta = a.sources.find((s: { channel: string }) => s.channel === "instagram");
  assert.deepEqual([insta.campaign, insta.sessions, insta.leads, insta.orders], ["reel17", 3, 1, 1]);
  assert.ok(a.sources.some((s: { channel: string }) => s.channel === "google"));
  await db.delete(sites).where(eq(sites.id, site!.id));
});
