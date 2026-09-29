// «Демо-магазин» for reviewing the panel: a second business of an existing account with made-up data
// (products, orders over the last 3 weeks, reviews). Everything is marked as demo and removable.
//   npm run demo:seed -w @oneknight/api -- you@example.com
//   npm run demo:seed -w @oneknight/api -- you@example.com --remove
import { and, eq, like } from "drizzle-orm";
import { db, sql } from "../src/db/client.ts";
import { memberships, moduleInstalls, orderEvents, orders, organizations, products, reviews, sites, subscriptions, users } from "../src/db/schema.ts";
import { addMonths } from "../src/billing/service.ts";

const DEMO_NAME = "Демо-магазин (приклад)";
// Domains are unique across the platform: one demo domain per person.
const email = process.argv[2]?.trim().toLowerCase();
const remove = process.argv.includes("--remove");
if (!email) {
  console.error("usage: demo:seed <email> [--remove]");
  process.exit(1);
}
const [user] = await db.select().from(users).where(eq(users.email, email));
if (!user) {
  console.error(`no account with email ${email}`);
  process.exit(1);
}

// Remove the previous demo of this person (organizations cascade to everything inside).
const old = await db
  .select({ id: organizations.id })
  .from(organizations)
  .innerJoin(memberships, eq(memberships.organizationId, organizations.id))
  .where(and(eq(memberships.userId, user.id), like(organizations.name, "Демо-магазин%")));
for (const o of old) await db.delete(organizations).where(eq(organizations.id, o.id));
if (remove) {
  console.log(`demo removed (${old.length})`);
  await sql.end();
  process.exit(0);
}

const now = Date.now();
const DAY = 86_400_000;
const [org] = await db.insert(organizations).values({ name: DEMO_NAME, onboarding: { hasSite: true, sells: ["home"], delivery: ["novaposhta"], channels: ["instagram"], at: new Date().toISOString() } }).returning();
const orgId = org!.id;
await db.insert(memberships).values({ organizationId: orgId, userId: user.id, role: "owner" });
await db.insert(subscriptions).values({ organizationId: orgId, status: "trial", trialEndsAt: addMonths(new Date(), 3), periodEnd: addMonths(new Date(), 3) });
await db.insert(moduleInstalls).values([
  { organizationId: orgId, moduleId: "reviews", free: true },
  { organizationId: orgId, moduleId: "analytics", free: true },
]);
// Paused: the monitor does not probe a made-up domain.
const [site] = await db.insert(sites).values({ organizationId: orgId, domain: `demo-${user.id.slice(0, 8)}.oneknight.example`, name: "Демо-сайт", status: "paused" }).returning();

const catalogue = [
  ["Хлібниця «Маки»", 1100, 3],
  ["Хлібниця «Смерека»", 1250, 7],
  ["Дошка для нарізки, дуб", 650, 14],
  ["Набір ложок, ясен (3 шт.)", 420, 25],
  ["Сільничка з кришкою", 380, 2],
  ["Підставка під гаряче", 290, 40],
  ["Скринька для чаю", 890, 0],
  ["Хлібниця «Гуцулка» (під замовлення)", 1450, null],
] as const;
const prods = await db
  .insert(products)
  .values(catalogue.map(([name, price, stock], i) => ({ organizationId: orgId, siteId: site!.id, name, priceKop: price * 100, stock, sort: i })))
  .returning();

const people = [
  ["Олена Коваль", "+380671112233", "Львів", "5"],
  ["Андрій Мельник", "+380503334455", "Київ", "112"],
  ["Ірина Бойко", "+380931234567", "Івано-Франківськ", "3"],
  ["Тарас Шевчук", "+380687654321", "Одеса", "28"],
  ["Марія Ткаченко", "+380661230000", "Харків", "44"],
  ["Юрій Кравець", "+380979998877", "Ужгород", "1"],
  ["Наталія Савчук", "+380955556677", "Київ", "305"],
] as const;
const statuses = ["new", "new", "new", "confirmed", "confirmed", "paid", "shipped", "shipped", "done", "done", "done", "done", "cancelled"] as const;
let n = 0;
for (let i = 0; i < 26; i++) {
  const person = people[i % people.length]!;
  const p1 = prods[i % prods.length]!;
  const p2 = i % 3 === 0 ? prods[(i + 3) % prods.length]! : null;
  const items = [{ productId: p1.id, name: p1.name, qty: 1, priceKop: p1.priceKop }, ...(p2 ? [{ productId: p2.id, name: p2.name, qty: 2, priceKop: p2.priceKop }] : [])];
  const status = i < 3 ? "new" : statuses[i % statuses.length]!;
  const createdAt = new Date(now - (i < 3 ? i * 3_600_000 : Math.round((i / 26) * 20 * DAY)));
  const [o] = await db
    .insert(orders)
    .values({
      organizationId: orgId,
      siteId: site!.id,
      customerName: person[0],
      customerPhone: person[1],
      items,
      totalKop: items.reduce((s, it) => s + it.priceKop * it.qty, 0),
      status,
      delivery: { method: "novaposhta", city: person[2], branch: person[3] },
      payment: i % 4 === 0 ? "iban" : "cod",
      comment: i % 5 === 0 ? "Подзвоніть перед відправкою" : null,
      createdAt,
      updatedAt: createdAt,
    })
    .returning();
  await db.insert(orderEvents).values({ orderId: o!.id, status: "new", createdAt });
  if (status !== "new") await db.insert(orderEvents).values({ orderId: o!.id, status, createdAt: new Date(createdAt.getTime() + 3_600_000) });
  n++;
}

await db.insert(reviews).values([
  { organizationId: orgId, siteId: site!.id, productId: prods[0]!.id, authorName: "Олена", rating: 5, text: "Приклад відгуку: хлібниця гарна, пахне деревом.", consent: true, status: "published", verified: true },
  { organizationId: orgId, siteId: site!.id, productId: prods[2]!.id, authorName: "Андрій", rating: 4, text: "Приклад відгуку: дошка важка й міцна, доставка 2 дні.", consent: true, status: "pending" },
  { organizationId: orgId, siteId: site!.id, productId: prods[3]!.id, authorName: "Ірина", rating: 5, text: "Приклад відгуку: ложки чудові, беру ще на подарунок.", consent: true, status: "pending" },
]);

console.log(`demo business «${DEMO_NAME}» created for ${email}: ${prods.length} products, ${n} orders, 3 reviews`);
await sql.end();
