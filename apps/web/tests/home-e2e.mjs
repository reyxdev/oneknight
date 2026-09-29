// Home end to end: «Перші кроки» from real data, period with comparison, «Що треба зробити» leading to filtered
// lists and «Нагадати завтра», «Відправити сьогодні», monthly goal. Data: the «Демо-магазин» seed.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { onboard } from "./nav.mjs";
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
await onboard(pg);
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
ok((await pg.locator(".app-table tbody tr").count()) > 0, "the filtered list is not empty");
// The table: sort by a column, hide a column (remembered), ↓ Enter opens, Esc closes the panel.
await pg.getByRole("button", { name: "Усі", exact: true }).click();
await pg.locator("th", { hasText: "Клієнт" }).getByRole("button").click();
await pg.waitForFunction(() => document.querySelector("th[aria-sort]")?.textContent?.includes("Клієнт"));
await pg.locator("th", { hasText: "Клієнт" }).getByRole("button").click();
await pg.waitForFunction(() => document.querySelector("th[aria-sort]")?.getAttribute("aria-sort") === "ascending");
await pg.waitForTimeout(500);
const names = await pg.locator(".app-table tbody td[data-main] b").allInnerTexts();
ok(names.length > 1 && names.every((n, i) => i === 0 || names[i - 1].localeCompare(n, "uk") <= 0), "sorted by customer A→Я");
await pg.getByRole("button", { name: "Колонки" }).click();
await pg.getByRole("group", { name: "Колонки" }).getByLabel("Дата").uncheck();
ok(!(await pg.locator("th", { hasText: "Дата" }).count()), "a column can be hidden");
await pg.reload({ waitUntil: "networkidle" });
await pg.locator(".app-table").waitFor();
ok(!(await pg.locator("th", { hasText: "Дата" }).count()), "hidden columns are remembered");
await pg.locator(".app-table tbody tr").first().focus();
await pg.keyboard.press("ArrowDown");
await pg.keyboard.press("Enter");
ok(await seen(pg.locator(".ok-split[data-open='true'] .ok-detail")), "↓ Enter opens the order in the panel on the right");
if (SHOTS) {
  await pg.setViewportSize({ width: 1280, height: 900 });
  await pg.screenshot({ path: `${SHOTS}/orders-table.png` });
}
await pg.locator("body").click({ position: { x: 5, y: 300 } });
await pg.keyboard.press("Escape");
ok(await seen(pg.locator(".ok-split[data-open='false']")), "Esc closes the panel");
await pg.getByRole("button", { name: "Колонки" }).click();
await pg.getByRole("group", { name: "Колонки" }).getByLabel("Дата").check();
await pg.getByRole("button", { name: "Без ТТН" }).click();
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

// «/» search: by name, ↓ Enter opens the order; «?» shows the keys; «N» on «Товари» opens a new product.
await pg.locator("body").click({ position: { x: 5, y: 300 } });
await pg.keyboard.press("/");
ok(await pg.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Пошук"), "«/» focuses the search");
await pg.keyboard.type("Олена Ков");
await pg.locator(".app-search-hit").first().waitFor();
ok((await pg.locator(".app-search-hit").count()) >= 1, "search finds the customer's orders");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/search.png` });
await pg.keyboard.press("Enter");
ok(await seen(pg.locator(".ok-split[data-open='true']")), "Enter opens the order");
await pg.locator("body").click({ position: { x: 5, y: 300 } });
await pg.keyboard.press("Shift+Slash");
ok(await seen(pg.getByRole("dialog", { name: "Клавіші" })), "«?» shows the keys");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/keys.png` });
await pg.keyboard.press("Escape");
await pg.locator(".ok-side").getByRole("button", { name: "Товари", exact: true }).click();
await pg.locator("body").click({ position: { x: 5, y: 300 } });
await pg.keyboard.press("n");
ok(await seen(pg.getByLabel("Назва")), "«N» opens a new product");
await pg.locator(".ok-side").getByRole("button", { name: "Головна", exact: true }).click();

// A customer orders on the website while the panel is open: window with the order, the tab shows the count.
const siteKey = await pg.evaluate(async () => (await (await fetch("/api/sites")).json())[0].publicKey);
const prodId = (await (await fetch(`${BASE}/api/public/products`, { headers: { "x-site-key": siteKey } })).json())[0].id;
const placed = await fetch(`${BASE}/api/public/orders`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": siteKey }, body: JSON.stringify({ customer: { name: "Нова Покупчиня", phone: "+380671112299" }, items: [{ productId: prodId, qty: 1 }], delivery: { method: "novaposhta", city: "Київ", branch: "1" }, payment: "cod" }) });
ok(placed.status === 201, "website order placed");
const win = pg.getByRole("dialog", { name: "Нове замовлення" });
ok(await seen(win, 20000), "«Нове замовлення» window pops up");
ok(await win.getByText("Нова Покупчиня").isVisible(), "the window shows the customer");
ok(/^\(\d+\) /.test(await pg.title()), `the browser tab counts waiting orders (${await pg.title()})`);
await win.getByRole("button", { name: "Підтвердити" }).click();
ok(await seen(pg.locator(".app-toast", { hasText: "В роботі" })), "confirmed from the window, with «Скасувати»");

// «Бізнес → Замовлення»: an own status inside a group appears in the order card.
await pg.locator(".ok-side").getByRole("button", { name: "Бізнес", exact: true }).click();
await pg.getByRole("tab", { name: "Замовлення" }).click();
await pg.getByLabel("Назва статусу", { exact: true }).fill("Чекає оплати");
await pg.getByLabel("Група").selectOption("confirmed");
await pg.getByRole("button", { name: "Додати статус" }).click();
await pg.locator(".app-status-groups input[value='Чекає оплати']").waitFor();
await pg.locator(".ok-side").getByRole("button", { name: "Замовлення", exact: true }).click();
await pg.locator(".app-table tbody tr").first().click();
const sel = pg.locator(".ok-detail").getByLabel("Змінити статус");
await sel.waitFor();
ok((await sel.locator("option").allInnerTexts()).includes("Чекає оплати"), "own status in the order card");
await sel.selectOption({ label: "Чекає оплати" });
ok(await seen(pg.locator(".ok-detail .app-order-top .ok-pill", { hasText: "Чекає оплати" })), "the order gets the own status");
await pg.locator(".ok-side").getByRole("button", { name: "Головна", exact: true }).click();

// «Приховати суми й телефони»: blurred, remembered; text size from «Мій профіль».
await pg.getByRole("button", { name: "Приховати суми й телефони" }).click();
ok(await pg.locator("[data-private='true'] .app-secret").first().isVisible(), "sums are hidden");
await pg.reload({ waitUntil: "networkidle" });
ok((await pg.locator(".ok-app").getAttribute("data-private")) === "true", "the choice is remembered");
await pg.getByRole("button", { name: "Приховати суми й телефони" }).click();
await pg.locator(".ok-side").getByRole("button", { name: "Мій профіль", exact: true }).click();
await pg.getByRole("radio", { name: "Великий" }).click();
ok((await pg.evaluate(() => document.documentElement.style.fontSize)) === "125%", "text size changes the panel");
await pg.getByRole("radio", { name: "Звичайний" }).click();
await pg.locator(".ok-side").getByRole("button", { name: "Головна", exact: true }).click();

await pg.setViewportSize({ width: 390, height: 844 });
await pg.reload({ waitUntil: "networkidle" });
await pg.locator(".ok-home-stats").waitFor();
ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal scroll on a phone");
// Phone: swipe a new order to the right to confirm it; the round «+» opens a new product.
await pg.locator(".ok-bottom").getByRole("button", { name: "Замовлення" }).click();
await pg.getByRole("button", { name: "Нове", exact: true }).click();
await pg.locator(".app-table tbody tr").first().waitFor();
const swipedName = (await pg.locator(".app-table tbody tr").first().locator("td[data-main] b").innerText()).trim();
await pg.locator(".app-table tbody tr").first().evaluate((tr) => {
  const r = tr.getBoundingClientRect();
  const ev = (type, x) => tr.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", clientX: x, clientY: r.top + 10, isPrimary: true }));
  ev("pointerdown", r.left + 20);
  ev("pointermove", r.left + 80);
  ev("pointermove", r.left + 140);
  ev("pointerup", r.left + 140);
});
ok(await seen(pg.locator(".app-toast", { hasText: "В роботі" })), `swipe right confirms a new order (${swipedName})`);
await pg.locator(".app-fab").click();
ok(await seen(pg.getByLabel("Назва")), "the round «+» opens a new product");
await pg.locator(".ok-bottom").getByRole("button", { name: "Головна" }).click();
if (SHOTS) {
  await pg.locator(".ok-bottom").getByRole("button", { name: "Замовлення" }).click();
  await pg.locator(".app-table").waitFor();
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${SHOTS}/orders-mobile.png` });
  await pg.locator(".ok-bottom").getByRole("button", { name: "Головна" }).click();
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
