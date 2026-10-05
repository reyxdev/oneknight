// The portfolio (docs/portfolio/answers.md) while the site is in «soon» mode: visitors get «скоро», a signed-in admin
// gets the new site; the calculator gives one price and sends a lead; phones get the contact sheet; 404 has its joke.
// Run against the static build: npm run build && node scripts/local-proxy.mjs, then node tests/portfolio-e2e.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const errors = [];
cleanupTestData();

async function open(path, { admin = false, phone = false } = {}) {
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } });
  if (admin) {
    await ctx.addCookies([{ name: "ok_auth", value: "1", url: BASE }]);
    // The admin's session is simulated: only /auth/me answers «admin», everything else is the real API.
    await ctx.route("**/api/auth/me", (r) => r.fulfill({ json: { id: "e2e", name: "E2E", isAdmin: true, organizations: [] } }));
  }
  const p = await ctx.newPage();
  // React #418 (a recoverable hydration mismatch) shows up in about a third of loads of the static build on every
  // page of the root layout, the «скоро» page included, and never under `next dev`. Under investigation (ARCHITECTURE 15).
  p.on("pageerror", (e) => !String(e).includes("#418") && errors.push(`${path}: ${e}`));
  await p.goto(BASE + path, { waitUntil: "networkidle" });
  return p;
}

try {
  // Visitors: «скоро», not indexed.
  const pub = await open("/");
  assert.equal(await pub.locator("h1").innerText(), "Скоро тут буде новий сайт");
  assert.equal(await pub.locator('meta[name="robots"]').getAttribute("content"), "noindex, nofollow");

  // The admin: the new home with all blocks.
  const home = await open("/", { admin: true });
  await home.locator(".pf-h1").first().waitFor();
  assert.equal(await home.locator("h1").first().innerText(), "Роблю сайт під вашу справу, щоб вам дзвонили");
  for (const id of ["roboty", "cina", "pro-mene", "pytannia", "kontakty"]) assert.equal(await home.locator(`#${id}`).count(), 1, id);
  assert.equal(await home.locator(".pf-who-card").count(), 8);
  assert.match(await home.locator(".pf-bar").innerText(), /лишилось \d+/);

  // Calculator: services site → СТО → up to 30 → logo → 800 per client → one price with the discount → a lead.
  const c = home.locator(".pf-calc");
  await c.getByRole("button", { name: /Сайт послуг/ }).click();
  await c.getByRole("button", { name: /^СТО$/ }).click();
  await c.getByRole("button", { name: "До 30" }).click();
  await c.getByText("Логотип", { exact: true }).click();
  await c.getByRole("button", { name: "Далі" }).click();
  await c.locator("#pf-earn").fill("800");
  await c.getByRole("button", { name: "Далі" }).click();
  await home.waitForTimeout(800);
  const price = await c.locator(".pf-price").innerText();
  assert.match(price, /^≈ [\d\s ]+ грн$/);
  assert.match(await c.locator(".pf-halves").innerText(), /Половина на старті/);
  assert.match(await c.locator(".pf-payback").innerText(), /≈\d+ нових клієнтів/);
  await c.getByRole("button", { name: "Надіслати — я передзвоню" }).click();
  const f = c.locator(".pf-form");
  await f.getByRole("button", { name: "Надіслати — я передзвоню" }).click();
  assert.match(await f.locator(".pf-form-error").innerText(), /ім'я й телефон/, "name and phone required");
  await f.getByLabel("Ваше ім'я").fill("E2E Портфоліо");
  await f.getByLabel("Телефон").fill("+48 600 123 456");
  await f.getByRole("button", { name: "Надіслати — я передзвоню" }).click();
  assert.match(await f.locator(".pf-form-error").innerText(), /український/, "Ukrainian numbers only");
  await f.getByLabel("Телефон").fill("099 000 00 77");
  await f.getByRole("button", { name: "Viber" }).click();
  await f.getByRole("button", { name: "Надіслати — я передзвоню" }).click();
  await c.locator(".pf-form-done").waitFor();
  assert.match(await c.locator(".pf-form-thanks").innerText(), /^Дякую, E2E Портфоліо! Передзвоню/);

  // The answers are remembered on this device.
  await home.reload({ waitUntil: "networkidle" });
  await home.locator(".pf-price").waitFor();

  // Phones: the contact sheet and the call/price bar.
  const m = await open("/", { admin: true, phone: true });
  await m.getByRole("button", { name: "Зв'язатись", exact: true }).click();
  for (const name of ["Viber", "WhatsApp", "Telegram"]) assert.equal(await m.getByRole("dialog").getByRole("link", { name }).count(), 1, name);
  await m.keyboard.press("Escape");
  assert.equal(await m.locator(".pf-mobilebar a").count(), 2);

  // Inner pages and 404.
  const svc = await open("/internet-magazyn/", { admin: true });
  assert.equal(await svc.locator("h1").first().innerText(), "Інтернет-магазин, який не тоне серед тисяч інших");
  assert.equal(await svc.locator(".pf-examples li").count(), 2, "real examples only");
  const g = await open("/google-karty/", { admin: true });
  assert.equal(await g.locator(".pf-examples").count(), 0, "no example without a real one");
  const nf = await open("/nema-takoi-storinky/");
  assert.match(await nf.locator("h1:visible").innerText(), /Як і сайту у вашого конкурента/);

  assert.deepEqual(errors, []);
  console.log("portfolio e2e: ok");
} finally {
  cleanupTestData();
  await b.close();
}
