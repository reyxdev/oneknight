// Products: categories with subcategories, a product with every field and a gallery, stock threshold, import of the
// real .xlsx template, bulk price change with the old price kept, tiles, history.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard, openBusiness } from "./nav.mjs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:8080";
const SHOTS = process.env.SHOTS;
const shot = fileURLToPath(new URL("./fixture-screenshot.png", import.meta.url));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => { if (!String(e).includes("#418")) errs.push(`${pg.url()} ${String(e).slice(0, 80)}`); });
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 5000) => loc.waitFor({ timeout }).then(() => true, () => false);
const email = `products-e2e${Date.now()}@test.oneknight.local`;

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Товари E2E");
await pg.getByLabel("Телефон").fill("+380670007792");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("products e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await onboard(pg);
execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
const biz = await openBusiness(pg, "Товари E2E");
await biz.getByRole("tab", { name: "Сайти" }).click();
await biz.getByLabel("Домен").fill("products.example.net");
await biz.getByRole("button", { name: "Додати" }).click();
await biz.getByText("products.example.net").waitFor();
await go(pg, "Товари");

// Categories: «Одяг» and inside it «Сукні».
const cats = pg.locator(".app-cats");
await cats.getByRole("button", { name: "Категорія" }).click();
await cats.getByLabel("Назва категорії").fill("Одяг");
await cats.getByRole("button", { name: "Додати" }).click();
await cats.getByRole("button", { name: /^Одяг/ }).waitFor();
await cats.getByRole("button", { name: "Категорія" }).click();
await cats.getByLabel("Назва категорії").fill("Сукні");
await cats.getByLabel("Всередині").selectOption({ label: "· Одяг" });
await cats.getByRole("button", { name: "Додати" }).click();
ok(await seen(cats.getByRole("button", { name: /^Сукні/ })), "a subcategory in the tree");

// A product with every field and two photos.
await pg.getByRole("button", { name: "Додати товар" }).click();
const ed = pg.locator(".ok-detail");
await ed.locator(".app-gallery input[type=file]").setInputFiles([shot, shot]);
ok(await ed.locator(".app-gallery figure").nth(1).waitFor({ timeout: 5000 }).then(() => true, () => false), "two photos chosen at once");
await ed.getByLabel("Назва", { exact: true }).fill("Сукня з льону");
await ed.getByLabel("Артикул").fill("DR-1");
await ed.getByLabel("Категорія").selectOption({ label: "· Сукні" });
await ed.getByLabel("Ціна, грн", { exact: true }).fill("1200");
await ed.getByLabel("Стара ціна, грн").fill("1500");
await ed.getByLabel("Собівартість, грн").fill("700");
ok(await seen(ed.getByText(/Прибуток з одного: 500.*\(42%\)/)), "profit per piece from the cost");
await ed.getByLabel("Залишок", { exact: true }).fill("4");
await ed.getByLabel("Поріг «закінчується»").fill("5");
await ed.getByLabel("Вага, г").fill("400");
await ed.getByRole("button", { name: "Додати характеристику" }).click();
await ed.getByLabel("Назва (напр. Колір)").fill("Колір");
await ed.getByLabel("Значення").fill("білий");
await ed.getByRole("button", { name: "Зберегти" }).click();
const row = pg.locator(".app-table tbody tr", { hasText: "Сукня з льону" });
ok(await seen(row), "saved into the list");
ok(await seen(ed.locator(".app-gallery figure img").nth(1)), "the card opens with the gallery");
ok((await ed.locator(".app-gallery figcaption").innerText()).includes("Головне"), "the first photo is the main one");
ok(await row.getByText("1 500").isVisible(), "the old price is crossed out in the list");
ok(await row.getByText("Сукні").isVisible(), "the category in the list");
await pg.getByRole("button", { name: "Закінчується", exact: true }).click();
ok(await seen(row), "4 of threshold 5: «Закінчується»");
await pg.getByRole("button", { name: "Усі", exact: true }).click();
if (SHOTS) {
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${SHOTS}/products-card.png` });
}

// History: a change shows who changed what.
await ed.getByLabel("Ціна, грн", { exact: true }).fill("1250");
await ed.getByRole("button", { name: "Зберегти" }).click();
await pg.getByText("Збережено").first().waitFor();
await ed.getByText(/Історія змін/).click();
ok(await seen(ed.getByText(/Змінено: ціна 1\s?200.* → 1\s?250/)), "history: the price change with the old and new value");

// Import the real .xlsx template: first what will happen, then the import.
await ed.getByRole("button", { name: "Закрити" }).click().catch(() => {});
const template = await pg.context().request.get(`${BASE}/api/shop/products/template.xlsx`);
ok(template.ok() && (await template.body()).subarray(0, 2).toString() === "PK", "the template is a real .xlsx");
await pg.getByRole("button", { name: "Імпорт" }).click();
const dlg = pg.getByRole("dialog");
await dlg.locator("input[type=file]").setInputFiles({ name: "template.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await template.body() });
ok(await seen(dlg.getByText("Нових товарів")), "the preview counts before importing");
await dlg.getByRole("button", { name: "Імпортувати (1)" }).click();
ok(await seen(pg.getByText("Імпорт: нових 1, оновлено 0")), "imported");
ok(await seen(pg.locator(".app-table tbody tr", { hasText: "Свічка «Лаванда»" })), "the imported product is in the list");
ok(await seen(cats.getByRole("button", { name: /^Свічки/ })), "its category path «Декор / Свічки» was created");

// Bulk: −10% on both, keeping the old price crossed out.
await pg.locator(".app-table thead input[type=checkbox]").check();
await pg.getByLabel("Ціна, % (−10 або 15)").fill("-10");
await pg.getByRole("button", { name: "Змінити ціну" }).click();
ok(await seen(pg.getByText("Змінено товарів: 2")), "bulk price change");
ok(await seen(pg.locator(".app-table tbody tr", { hasText: "Свічка «Лаванда»" }).getByText("315")), "350 − 10% = 315");

await pg.getByRole("radio", { name: "Плитка" }).click();
ok((await pg.locator(".app-tiles li").count()) === 2, "tiles view");
if (SHOTS) {
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${SHOTS}/products-tiles.png` });
  await pg.getByRole("radio", { name: "Таблиця" }).click();
  await pg.getByRole("button", { name: "Імпорт" }).click();
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${SHOTS}/products-import.png` });
  await pg.keyboard.press("Escape");
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${SHOTS}/products-phone.png` });
}

ok(errs.length === 0, `no page errors ${errs.join(" | ")}`);
cleanupTestData();
await b.close();
process.exit(failed ? 1 : 0);
