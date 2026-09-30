import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { contentIdeas, contentTemplates, notifications, organizations, reviews, sites } from "../db/schema.ts";
import { ensureContentSeed } from "./seed.ts";
import { addDays, generatePlan, MAX_PER_DAY } from "./engine.ts";
import { runContentMorning, runContentWeekly } from "./jobs.ts";
import { holidayDate, easter } from "./holidays.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `cont${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Content ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, org: r.json().organizations[0].id as string };
}

test("holiday dates: Easter by the Julian paschalion, the n-th weekday, Black Friday", () => {
  assert.deepEqual([easter(2025), easter(2026), easter(2027)], ["2025-04-20", "2026-04-12", "2027-05-02"]);
  assert.equal(holidayDate("nth:5:0:2", 2026), "2026-05-10", "Mother's day: the 2nd Sunday of May");
  assert.equal(holidayDate("blackfriday", 2026), "2026-11-27");
  assert.equal(holidayDate("easter+49", 2026), "2026-05-31");
});

test("content plan: beta gate, preview, rules of the plan, holidays and promotions, the team's changes, morning and weekly jobs", async () => {
  await ensureContentSeed();
  const starters = await db.select({ id: contentTemplates.id, bucket: contentTemplates.bucket }).from(contentTemplates);
  assert.ok(starters.length >= 190, "six months of daily ideas");
  for (const b of ["sale", "benefit", "trust", "fun"]) assert.ok(starters.some((t) => t.bucket === b));

  const o = await register("o", "+380500000071");
  const H = { cookie: o.cookie, origin: ORIGIN };
  const [site] = await db.insert(sites).values({ organizationId: o.org, domain: `${tag}.shop.com.ua`, name: "S", verifiedAt: new Date() }).returning();
  const add = async (name: string, price: number, extra = {}) => (await app.inject({ method: "POST", url: `/api/shop/sites/${site!.id}/products`, payload: { name, price, ...extra }, headers: H })).json().id as string;
  for (const [n, p] of [["Свічка лавандова", 250], ["Свічка ванільна", 260], ["Свічка кедрова", 300], ["Набір свічок", 700]] as const) await add(n, p);
  await add("Свічка з корицею", 200, { oldPrice: 250 });
  await db.insert(reviews).values({ organizationId: o.org, siteId: site!.id, authorName: "Олена Коваль", rating: 5, text: "Пахне чудово, горить довго.", consent: true, status: "published" });

  // Without the beta switch the module cannot be turned on; the screen shows 3 real ideas and counts the rest.
  assert.equal((await app.inject({ method: "POST", url: "/api/billing/trial", headers: H })).statusCode, 200);
  const install = () => app.inject({ method: "POST", url: "/api/billing/modules/content", headers: H });
  assert.equal((await install()).json().error, "beta_only");
  const preview = (await app.inject({ url: "/api/content/plan", headers: { cookie: o.cookie } })).json();
  assert.equal(preview.installed, false);
  assert.ok(preview.ideas.length <= 3 && preview.ideas.length > 0);
  assert.ok(preview.locked > 0, "the rest of the week is locked");
  assert.equal((await app.inject({ method: "POST", url: "/api/content/plan/refresh", headers: H })).statusCode, 403);

  await db.update(organizations).set({ features: ["content"] }).where(eq(organizations.id, o.org));
  assert.equal((await install()).statusCode, 200);

  // Settings: 4 channels, «на ти», no emoji, Sunday off, wholesale.
  const put = await app.inject({ method: "PUT", url: "/api/content/settings", headers: H, payload: { channels: { instagram: { on: true }, facebook: { on: true }, telegram: { on: true }, site: { on: true } }, voice: { address: "ty", tone: "friendly", emoji: false, avoid: [] }, rhythm: "active", daysOff: [0], wholesale: { min: 10, discount: 15 }, tag: "Свічкарня" } });
  assert.equal(put.statusCode, 200);
  assert.equal((await app.inject({ method: "PUT", url: "/api/content/settings", headers: H, payload: { balance: { sale: 50, benefit: 50, trust: 10, fun: 0 } } })).statusCode, 400, "the balance adds up to 100");

  // A month of the plan from a Monday outside holidays: the rules hold.
  const from = "2027-02-15";
  await generatePlan(o.org, { from, days: 28 });
  const ideas = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, o.org)));
  const month = ideas.filter((i) => i.day >= from && i.day <= addDays(from, 27));
  assert.ok(month.length >= 40, `a full month (${month.length})`);
  const perDay = new Map<string, typeof month>();
  for (const i of month) perDay.set(i.day, [...(perDay.get(i.day) ?? []), i]);
  for (const [day, list] of perDay) {
    assert.ok(list.length <= MAX_PER_DAY, `no more than 3 a day (${day})`);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) assert.ok(list.length <= 1 && list.every((i) => i.format === "stories" || i.format === "message" || i.format === "post" || i.format === "article" || i.format === "reels"), "Sunday: one light idea");
  }
  for (const i of month) {
    const all = [i.title, i.why, i.shot, i.textShort, i.textLong, i.cta, JSON.stringify(i.extra)].join("\n");
    assert.ok(!/\{[a-zA-Z]+\}|\{\{/.test(all), `every placeholder filled, the form of address chosen (${i.title})`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(i.textShort + i.textLong), "no emoji when switched off");
    assert.ok(i.hashtags.includes("свічкарня") && i.hashtags.length >= 5 && i.hashtags.length <= 10);
    assert.match(i.link ?? "", new RegExp(`^https://${tag}\\.shop\\.com\\.ua/\\?utm_source=${i.channel}&utm_medium=social&utm_campaign=content&utm_content=${i.id.slice(0, 8)}$`));
    if (i.channel === "site") assert.equal(i.format, "article");
  }
  // The same product in a channel at most once in 7 days.
  const withProduct = month.filter((i) => i.productId);
  assert.ok(withProduct.length > 0);
  for (const a of withProduct)
    for (const b of withProduct)
      if (a.id !== b.id && a.productId === b.productId && a.channel === b.channel) assert.ok(Math.abs(new Date(a.day).getTime() - new Date(b.day).getTime()) >= 7 * 86_400_000, "product gap");
  // A template does not come back within the month; the balance leans to sales; the one review is used once.
  const tpl = month.map((i) => i.templateId);
  assert.equal(new Set(tpl).size, tpl.length);
  const share = (b: string) => month.filter((i) => i.bucket === b).length / month.length;
  assert.ok(share("sale") >= share("fun") && share("sale") >= 0.25, `sales lead (${share("sale")})`);
  assert.ok(share("benefit") > 0 && share("trust") > 0);
  assert.equal(month.filter((i) => i.trigger === "review").length, 1);
  assert.ok(month.some((i) => i.trigger === "discount" && i.textShort.includes("250 грн")), "the old price from the product");

  // Holidays: the Defenders' day is only a word of respect; St Nicholas comes with a gift idea before it.
  await generatePlan(o.org, { from: "2027-09-29", days: 5 });
  const oct1 = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, o.org), eq(contentIdeas.day, "2027-10-01")));
  assert.ok(oct1.length >= 1 && oct1.every((i) => i.trigger === "holidayRespect" && i.productId === null), "nothing is sold on a day of memory");
  await generatePlan(o.org, { from: "2027-11-20", days: 17 });
  const nicholas = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, o.org), eq(contentIdeas.holiday, "nicholas")));
  assert.ok(nicholas.some((i) => i.trigger === "holidayCollection") && nicholas.some((i) => i.trigger === "holidaySale"));
  assert.ok(nicholas.every((i) => i.textShort.includes("День святого Миколая") || i.textLong.includes("День святого Миколая") || i.title.includes("Миколая")));

  // A promotion is announced 3 days before it starts and closed with «останній день».
  const promo = await app.inject({ method: "POST", url: "/api/content/promos", headers: H, payload: { name: "Тиждень ароматів", discount: 20, startsOn: addDays(from, 30), endsOn: addDays(from, 36) } });
  assert.equal(promo.statusCode, 201);
  await generatePlan(o.org, { from: addDays(from, 25), days: 17 });
  const promoIdeas = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, o.org), eq(contentIdeas.promoId, promo.json().id)));
  assert.deepEqual([...new Set(promoIdeas.map((i) => i.trigger))].sort(), ["promoAnnounce", "promoLast", "promoReminder"]);
  assert.ok(promoIdeas.find((i) => i.trigger === "promoAnnounce")!.day === addDays(from, 27));
  assert.ok(promoIdeas.every((i) => `${i.textShort}${i.textLong}`.includes("Тиждень ароматів")));

  // The plan in the API: markers, a channel filter.
  const plan = (await app.inject({ url: `/api/content/plan?from=${addDays(from, 28)}&days=14&channel=instagram`, headers: { cookie: o.cookie } })).json();
  assert.ok(plan.ideas.length > 0 && plan.ideas.every((i: { channel: string }) => i.channel === "instagram"));
  assert.equal(plan.promos.length, 1);

  // The team's changes: an edited idea stays through a refresh; «Інша ідея» fills the slot with another template.
  const [first, second] = month.filter((i) => i.day > from).slice(0, 2);
  const patch = await app.inject({ method: "PATCH", url: `/api/content/ideas/${first!.id}`, headers: H, payload: { textShort: "Свій текст", day: addDays(first!.day, 1) } });
  assert.equal(patch.json().locked, true, patch.body);
  await generatePlan(o.org, { from, days: 28 });
  const [kept] = await db.select().from(contentIdeas).where(eq(contentIdeas.id, first!.id));
  assert.equal(kept?.textShort, "Свій текст");
  const [fresh2] = await db.select().from(contentIdeas).where(and(eq(contentIdeas.organizationId, o.org), eq(contentIdeas.day, second!.day), eq(contentIdeas.channel, second!.channel), eq(contentIdeas.status, "todo")));
  const other = await app.inject({ method: "POST", url: `/api/content/ideas/${fresh2!.id}/other`, headers: H, payload: {} });
  assert.equal(other.statusCode, 200);
  assert.notEqual(other.json().templateId, fresh2!.templateId);
  assert.equal(other.json().day, second!.day);
  assert.equal((await db.select().from(contentIdeas).where(eq(contentIdeas.id, fresh2!.id))).length, 0);

  // Own idea, «Опубліковано», save as a template, delete.
  const own = await app.inject({ method: "POST", url: "/api/content/ideas", headers: H, payload: { day: from, channel: "instagram", title: "Прямий ефір", text: "Сьогодні о 19:00" } });
  assert.equal(own.statusCode, 201);
  const pub = await app.inject({ method: "PATCH", url: `/api/content/ideas/${own.json().id}`, headers: H, payload: { status: "published" } });
  assert.ok(pub.json().publishedAt);
  assert.equal((await app.inject({ method: "POST", url: `/api/content/ideas/${own.json().id}/template`, headers: H, payload: {} })).statusCode, 201);
  assert.equal((await db.select().from(contentTemplates).where(eq(contentTemplates.organizationId, o.org))).length, 1);
  assert.equal((await app.inject({ method: "GET", url: `/api/content/ideas/${own.json().id}/result`, headers: { cookie: o.cookie } })).json().visits, 0);
  await app.inject({ method: "DELETE", url: `/api/content/ideas/${own.json().id}`, headers: H });
  assert.equal((await db.select().from(contentIdeas).where(eq(contentIdeas.id, own.json().id))).length, 0);

  // Morning: today's ideas in the bell (once a day); Sunday evening: the new week.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  await generatePlan(o.org, { from: today, days: 7 });
  await db.insert(contentIdeas).values({ organizationId: o.org, day: today, time: "10:00", channel: "instagram", format: "post", bucket: "own", trigger: "own", title: "Ранкова ідея", why: "", shot: "", textShort: "Текст", textLong: "Текст", cta: "", custom: true, locked: true });
  const at10 = new Date(`${today}T08:00:00Z`);
  assert.equal(await runContentMorning(at10, [o.org]), 1);
  assert.equal(await runContentMorning(at10, [o.org]), 0, "once a day");
  const [morning] = await db.select().from(notifications).where(and(eq(notifications.organizationId, o.org), eq(notifications.key, "contentToday")));
  assert.ok(String((morning!.params as { list: string }).list).includes("Ранкова ідея"));
  const sunday = addDays(today, (7 - new Date(`${today}T12:00:00Z`).getUTCDay()) % 7);
  assert.equal(await runContentWeekly(new Date(`${sunday}T10:00:00Z`), [o.org]), 0, "before 18:00");
  assert.equal(await runContentWeekly(new Date(`${sunday}T17:00:00Z`), [o.org]), 1);
  const [week] = await db.select().from(notifications).where(and(eq(notifications.organizationId, o.org), eq(notifications.key, "contentWeek")));
  assert.equal((week!.params as { from: string }).from, addDays(sunday, 1));
  assert.ok((week!.params as { n: number }).n > 0);
});
