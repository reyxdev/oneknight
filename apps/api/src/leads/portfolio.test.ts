import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";
import { DEFAULT_PORTFOLIO_PRICES, normalizeUaPhone, portfolioEstimate } from "@oneknight/domain";
import { buildApp } from "../app.ts";
import { db, sql } from "../db/client.ts";
import { leads } from "../db/schema.ts";
import { handleLeadButton, ownerMinutes, runLeadNudges } from "./portfolio.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
// A number nobody has: 099 + the test's own digits.
const tail = String(Date.now()).slice(-7);
const PHONE = `+38099${tail}`;

after(async () => {
  await db.delete(leads).where(like(leads.phone, `+38099${tail}%`));
  await app.close();
  await sql.end();
});

const post = (payload: object, ip = "10.9.0.1") => app.inject({ method: "POST", url: "/api/leads/portfolio", payload, headers: { origin: ORIGIN }, remoteAddress: ip });

test("calculator: one rounded price, −25% on the site and logo only while places are left, 50/50, payback", () => {
  const p = DEFAULT_PORTFOLIO_PRICES;
  const e = portfolioEstimate(p, { kind: "service", tier: 1, extras: ["logo", "ads", "support"], earn: 800 }, 8);
  assert.ok(!e.big);
  if (e.big) return;
  // 12 000 + 1 500 (up to 30 services) + 1 500 logo = 15 000 → −3 800 (25%, to hundreds); + 2 000 ads (no discount).
  assert.deepEqual([e.full, e.save, e.total, e.first + e.second, e.monthly, e.payback], [17000, 3800, 13200, 13200, 1000, 17]);
  const none = portfolioEstimate(p, { kind: "service", tier: 1, extras: ["logo", "ads"] }, 0);
  assert.ok(!none.big && none.save === 0 && none.total === 17000, "no places — no discount");
  const big = portfolioEstimate(p, { kind: "shop", tier: 3, extras: [] }, 8);
  assert.deepEqual(big, { big: true, from: 25000, monthly: 0 });
  assert.equal(normalizeUaPhone("067 123-45-67"), "+380671234567");
  assert.equal(normalizeUaPhone("+48 600 123 456"), null, "Ukrainian numbers only");
});

test("portfolio settings are public; the admin changes them", async () => {
  const r = await app.inject({ url: "/api/site/portfolio" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().prices.base.card, 7000);
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/site/portfolio", payload: {}, headers: { origin: ORIGIN } })).statusCode, 401);
});

test("a lead from the portfolio: Ukrainian phone, price computed again, 3 a day per number, spam trap", async () => {
  assert.equal((await post({ name: "Тест", phone: "+48 600 123 456" })).json().error, "bad_phone");
  assert.equal((await post({ name: "Тест", phone: PHONE, website: "spam" })).statusCode, 400);
  const r = await post({ name: "Портфоліо Тест", phone: `099 ${tail}`, contact: "viber", about: "СТО в Косові", calc: { kind: "service", tier: 0, extras: ["logo"], earn: 1000, sprava: "sto" }, locale: "uk" });
  assert.equal(r.statusCode, 201);
  const [row] = await db.select().from(leads).where(eq(leads.number, r.json().number));
  assert.equal(row!.phone, PHONE);
  const brief = row!.brief as { origin: string; contact: string; estimate: { total: number } };
  assert.equal(brief.origin, "portfolio");
  assert.equal(brief.contact, "viber");
  assert.ok(brief.estimate.total > 0 && brief.estimate.total < 13500, "server's own price");
  assert.equal((await post({ name: "Тест", phone: PHONE }, "10.9.0.2")).statusCode, 201);
  assert.equal((await post({ name: "Тест", phone: PHONE }, "10.9.0.3")).statusCode, 201);
  assert.equal((await post({ name: "Тест", phone: PHONE }, "10.9.0.4")).statusCode, 429, "fourth from the same number in a day");

  // Telegram buttons: only from the owner's chat.
  assert.equal(await handleLeadButton(`lead:agreed:${row!.id}`, "1", "2"), null);
  assert.deepEqual(await handleLeadButton(`lead:agreed:${row!.id}`, "2", "2"), { number: row!.number, label: "Домовились" });
  const [after1] = await db.select().from(leads).where(eq(leads.id, row!.id));
  assert.equal(after1!.status, "agreed");
});

test("an unanswered lead nudges the owner once, after an hour of the owner's day (9–21 Kyiv)", async () => {
  // 10:00 → 11:30 Kyiv is 90 minutes of the owner's day; 22:00 → 08:00 is none.
  assert.equal(ownerMinutes(new Date("2026-10-05T07:00:00Z"), new Date("2026-10-05T08:30:00Z")), 60);
  assert.equal(ownerMinutes(new Date("2026-10-05T19:00:00Z"), new Date("2026-10-06T05:00:00Z")), 0);
  const r = await post({ name: "Нагадування", phone: `099 ${tail}`.replace(/.$/, (d) => String((Number(d) + 1) % 10)) }, "10.9.0.5");
  assert.equal(r.statusCode, 201);
  const sent: string[] = [];
  const later = new Date(Date.now() + 26 * 3600_000);
  await runLeadNudges(async (t) => (sent.push(t), true), later);
  await runLeadNudges(async (t) => (sent.push(t), true), later);
  assert.equal(sent.filter((t) => t.includes(`#${r.json().number}`)).length, 1);
});
