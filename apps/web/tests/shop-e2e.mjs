// Shop flow: products with photo in the account, a "client website" reads them and places an order via the
// public API (server prices), the order shows up and moves through statuses.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:8080";
const DOMAIN = "example.net";
const shot = fileURLToPath(new URL("./fixture-screenshot.png", import.meta.url));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `shop-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => pg.locator(".ok-side nav").getByRole("button", { name, exact: true }).click();

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
await nav("Клієнти й сайти");
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
await pg.getByRole("button", { name: /Далі: Підтверджене/ }).click();
await pg.locator(".ok-detail .ok-pill", { hasText: "Підтверджене" }).first().waitFor();
await pg.getByLabel("Номер ТТН").fill("20450012345678");
await pg.getByRole("button", { name: "Зберегти" }).click();
await pg.getByText("Збережено").first().waitFor();
ok(true, "order status and waybill updated");
await nav("Товари");
ok(await pg.getByText("Залишок: 1").waitFor({ timeout: 5000 }).then(() => true, () => false), "stock decreased by the order");

execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -qc "delete from organizations where id in (select organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'); delete from users where email='${email}'; delete from login_events where email_attempted='${email}';"`);
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
