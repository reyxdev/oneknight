// Home end to end: «Перші кроки» from real data, period with comparison, «Що треба зробити» leading to filtered
// lists and «Нагадати завтра», «Відправити сьогодні», monthly goal. Data: the «Демо-магазин» seed.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const SHOTS = process.env.SHOTS;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `home-e2e${Date.now()}@test.oneknight.local`;
const seen = (loc, timeout = 5000) => loc.waitFor({ timeout }).then(() => true, () => false);

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Головна E2E");
await pg.getByLabel("Телефон").fill("+380670001313");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("home e2e password");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо").waitFor();
const steps = pg.locator(".ok-steps");
ok(await seen(steps.getByText("0 з 6")), "a new owner sees «Перші кроки» with nothing done");
ok(!(await steps.getByRole("button", { name: "Отримати +7 днів" }).count()), "no reward before every step is done");
ok(await seen(pg.getByText("Усе зроблено. Нічого не чекає.")), "empty business: nothing invented in «Що треба зробити»");

execSync(`npm run -s demo:seed -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
const demo = await pg.locator(".ok-site select option", { hasText: "Демо-магазин" }).getAttribute("value");
await pg.locator(".ok-site select").selectOption(demo);
await pg.locator(".ok-home-stats").waitFor();
ok(await seen(steps.getByText("2 з 6")), "demo business: website and products are done, checked from data");
ok((await pg.locator(".ok-stat", { hasText: "Виручка" }).innerText()).includes("₴") || (await pg.locator(".ok-stat", { hasText: "Виручка" }).innerText()).includes("грн"), "revenue for the period");
ok(await seen(pg.locator(".ok-stat", { hasText: "Замовлення" }).locator(".ok-delta")), "comparison with the previous period");

const todo = pg.locator(".ok-todos");
ok(await seen(todo.getByText(/Нових замовлень: \d+/)), "new orders in «Що треба зробити»");
ok(await seen(todo.getByText(/Підтверджені без ТТН/)), "confirmed orders without a waybill");
ok(await seen(todo.getByText(/закінчується|немає в наявності/).first()), "stock problems");
if (SHOTS) {
  // The panel scrolls inside itself: a tall window shows the whole Home.
  await pg.setViewportSize({ width: 1280, height: 2000 });
  await pg.waitForTimeout(1600); // the chart draws itself
  await pg.screenshot({ path: `${SHOTS}/home-desktop.png` });
  await pg.setViewportSize({ width: 1280, height: 900 });
}

await todo.getByText(/Підтверджені без ТТН/).click();
ok(await seen(pg.getByRole("button", { name: "Без ТТН", pressed: true })), "the item opens the filtered order list");
ok((await pg.locator(".ok-rows > li").count()) > 0, "the filtered list is not empty");
await pg.goBack();
await pg.locator(".ok-todos").waitFor();

const ship = pg.locator(".okp", { hasText: "Відправити сьогодні" });
const first = ship.locator(".ok-row").first();
const num = (await first.locator(".num").first().innerText()).trim();
await first.click();
ok(await seen(pg.locator(".ok-split[data-open='true'] .okp").last().getByText(num.replace("#", ""), { exact: false }).first()), "«Відправити сьогодні» opens the order");
await pg.goBack();
await pg.locator(".ok-todos").waitFor();

const before = await todo.locator("li").count();
await todo.locator("li").first().getByRole("button", { name: "Нагадати завтра" }).click();
await pg.waitForFunction((n) => document.querySelectorAll(".ok-todos > li").length === n - 1, before);
ok(true, "«Нагадати завтра» hides the item");

await pg.getByRole("button", { name: "30 днів" }).click();
await pg.waitForFunction(() => document.querySelector(".ok-axis")?.textContent);
await pg.reload({ waitUntil: "networkidle" });
ok(await seen(pg.getByRole("button", { name: "30 днів", pressed: true })), "the period is remembered");

await pg.getByLabel("Ціль на місяць, грн").fill("50000");
await pg.getByRole("button", { name: "Зберегти ціль" }).click();
ok(await seen(pg.getByText(/Виконано \d+%/)), "monthly goal with the done percentage");

await pg.setViewportSize({ width: 390, height: 844 });
await pg.reload({ waitUntil: "networkidle" });
await pg.locator(".ok-home-stats").waitFor();
ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal scroll on a phone");
if (SHOTS) {
  await pg.setViewportSize({ width: 390, height: 2400 });
  await pg.waitForTimeout(1600);
  await pg.screenshot({ path: `${SHOTS}/home-mobile.png` });
}

// Known intermittent hydration notice on the sign-up page (same filter as team-e2e).
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs.join("\n") : "none");
await b.close();
cleanupTestData();
process.exit(failed || errs.length ? 1 : 0);
