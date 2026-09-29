// Shop flow: products with photo in the account, a "client website" reads them and places an order via the
// public API (server prices), the order shows up and moves through statuses.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go } from "./nav.mjs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:8080";
const DOMAIN = "example.net";
const shot = fileURLToPath(new URL("./fixture-screenshot.png", import.meta.url));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `shop-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => go(pg, name);

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Магазин E2E");
await pg.getByLabel("Телефон").fill("+380670007788");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("shop e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо").waitFor();
await nav("Товари");
ok(await pg.getByText("потрібен сайт").waitFor({ timeout: 5000 }).then(() => true, () => false), "products need a site first");

execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await nav("Бізнеси");
const panel = pg.locator(".okp", { hasText: "Магазин E2E" }).first();
await panel.getByLabel("Домен").fill(DOMAIN);
await panel.getByRole("button", { name: "Додати" }).click();
await panel.getByText(DOMAIN).waitFor();

await nav("Товари");
await pg.getByRole("button", { name: "Додати товар" }).click();
await pg.locator(".app-photo input").setInputFiles(shot);
await pg.getByLabel("Назва").fill("Хлібниця «Маки»");
await pg.getByLabel("Ціна, грн").fill("1100");
await pg.getByLabel("Залишок").fill("3");
await pg.getByRole("button", { name: "Зберегти" }).click();
await pg.getByText("Хлібниця «Маки»").waitFor();
ok(await pg.locator(".app-thumb").count() === 1, "product with photo saved");

await nav("Сайт");
const key = (await pg.locator(".app-key").first().innerText()).trim();
ok(/^sk_[0-9a-f]{32}$/.test(key), "site key is shown");

// The client's website (server side, no browser origin): read catalogue, order with a fake price.
const cat = await (await fetch(`${BASE}/api/public/products`, { headers: { "x-site-key": key } })).json();
ok(cat.length === 1 && cat[0].price === 1100 && cat[0].photo, "public catalogue returns the product");
const res = await fetch(`${BASE}/api/public/orders`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-site-key": key },
  body: JSON.stringify({ customer: { name: "Олена Покупець", phone: "+380671112233" }, items: [{ productId: cat[0].id, qty: 2, price: 1 }], delivery: { method: "novaposhta", city: "Львів", branch: "5" }, payment: "cod" }),
});
const order = await res.json();
ok(res.status === 201 && order.total === 2200, `order total comes from the server (${order.total})`);

await nav("Замовлення");
await pg.locator(".ok-row", { hasText: "Олена Покупець" }).click();
await pg.getByRole("button", { name: "Оформити ТТН" }).click();
ok(await pg.getByText("Щоб оформлювати ТТН, підключіть модуль «Нова пошта».").waitFor({ timeout: 5000 }).then(() => true, () => false), "waybill button explains the missing module");
ok(await pg.getByRole("link", { name: "Перейти в Модулі" }).isVisible(), "link to Modules offered");
await pg.getByRole("button", { name: /Далі: Підтверджене/ }).click();
await pg.locator(".ok-detail .ok-pill", { hasText: "Підтверджене" }).first().waitFor();
await pg.getByLabel("Номер ТТН").fill("20450012345678");
await pg.getByRole("button", { name: "Зберегти" }).click();
await pg.getByText("Збережено").first().waitFor();
ok(true, "order status and waybill updated");
// Integrations: instructions, and a key the real Nova Poshta API rejects is not stored.
await nav("Інтеграції");
ok(await pg.getByText("Створити ключ").isVisible(), "Nova Poshta key instructions shown");
ok(await pg.getByText("OLX").isVisible() && (await pg.getByText("У розробці").count()) > 1, "other integrations honestly marked in development");
const npCard = pg.locator(".okp", { hasText: "API-ключ Нової пошти" });
await npCard.getByLabel("API-ключ Нової пошти").fill("f".repeat(32));
await npCard.getByRole("button", { name: "Перевірити й підключити" }).click();
ok(await pg.getByText("Нова пошта відхилила ключ").waitFor({ timeout: 15000 }).then(() => true, () => false), "invalid key rejected by Nova Poshta");
ok(await pg.locator(".okp", { hasText: "Нова пошта" }).getByText("Не підключено").isVisible(), "still not connected");
const promCard = pg.locator(".okp", { hasText: "API-токен Prom" });
await promCard.getByLabel("API-токен Prom").fill("0".repeat(40));
await promCard.getByRole("button", { name: "Перевірити й підключити" }).click();
ok(await promCard.getByText("Prom відхилив токен: unauthorized").waitFor({ timeout: 20000 }).then(() => true, () => false), "invalid Prom token rejected by the real Prom API");
// Ukrposhta: keys from the contract; wrong keys are refused by the real eCom API.
const upCard = pg.locator(".okp", { hasText: "PRODUCTION BEARER eCom" }).first();
ok(await upCard.getByText(/Укладіть договір з Укрпоштою/).isVisible(), "Ukrposhta connect steps shown");
await upCard.getByLabel("PRODUCTION BEARER eCom").fill("00000000-0000-0000-0000-000000000000");
await upCard.getByLabel("PROD_COUNTERPARTY TOKEN").fill("00000000-0000-0000-0000-000000000000");
await upCard.getByLabel("Телефон відправника").fill("+380671231234");
await upCard.getByLabel("Прізвище").fill("Майстер");
await upCard.getByLabel("Ім'я").fill("Іван");
await upCard.getByLabel("ІПН (10 цифр)").fill("1234567890");
await upCard.getByRole("button", { name: "Перевірити й підключити" }).click();
ok(await upCard.getByText(/Укрпошта не прийняла ключі: unauthorized/).waitFor({ timeout: 20000 }).then(() => true, () => false), "wrong Ukrposhta keys rejected by the real API");
const rzCard = pg.locator(".okp", { hasText: "Логін кабінету продавця Rozetka" });
await rzCard.getByLabel("Логін кабінету продавця Rozetka").fill(`nobody_e2e_${Date.now()}`);
await rzCard.getByLabel("Пароль").fill("not a real password");
await rzCard.getByRole("button", { name: "Перевірити й підключити" }).click();
ok(await rzCard.getByText(/Rozetka не прийняла логін або пароль: incorrect_username_password/).waitFor({ timeout: 20000 }).then(() => true, () => false), "wrong Rozetka login rejected by the real Seller API");
await nav("Товари");
ok(await pg.getByText("Залишок: 1").waitFor({ timeout: 5000 }).then(() => true, () => false), "stock decreased by the order");

cleanupTestData();
// Known, intermittent React #418 (hydration) seen only after a form sign-up + reloads; tracked in TODO.md.
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
