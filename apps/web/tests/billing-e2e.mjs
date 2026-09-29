// Billing flow in the browser. Start the API with test requisites, e.g.
// PAYMENT_RECIPIENT="Test recipient" PAYMENT_IBAN="UA000000000000000000000000000" npm start -w @oneknight/api
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `bill-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => pg.locator(".ok-side nav").getByRole("button", { name, exact: true }).click();

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Оплата E2E");
await pg.getByLabel("Телефон").fill("+380670003344");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("billing e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо").waitFor();
await nav("Оплата");
ok(await pg.getByText("Підписка ще не активна").waitFor({ timeout: 5000 }).then(() => true, () => false), "no subscription before the website launch");

execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await nav("Клієнти й сайти");
await pg.locator(".okp", { hasText: "Оплата E2E" }).getByRole("button", { name: "Відкрити 3 місяці безкоштовно" }).click();
await pg.getByText("Безкоштовний період відкрито").waitFor();
await nav("Оплата");
ok(await pg.getByText("Безкоштовний період").first().waitFor({ timeout: 5000 }).then(() => true, () => false), "trial is active after the admin opens it");
ok((await pg.locator(".ok-stat", { hasText: "Після безкоштовного періоду" }).innerText()).includes("149"), "after-trial monthly price is 149");

await pg.getByLabel("Сума, грн").fill("20");
await pg.getByRole("button", { name: "Отримати реквізити" }).click();
ok(await pg.getByText("Вкажіть суму від 50").waitFor({ timeout: 3000 }).then(() => true, () => false), "top-up amount validation");
await pg.getByLabel("Сума, грн").fill("300");
await pg.getByRole("button", { name: "Отримати реквізити" }).click();
const purpose = await pg.getByText(/Поповнення балансу ONEKNIGHT OK-[0-9A-F]{8}/).first().innerText();
ok(/OK-[0-9A-F]{8}/.test(purpose), "top-up shows requisites and a unique payment reference");
ok((await pg.locator(".ok-stat", { hasText: "Баланс" }).innerText()).includes("0"), "balance does not change before the money arrives");

await nav("Поповнення (адмін)");
await pg.locator("li", { hasText: purpose.match(/OK-[0-9A-F]{8}/)[0] }).getByRole("button", { name: "Гроші надійшли" }).click();
await pg.getByText("Зараховано на баланс").waitFor();
await nav("Оплата");
await pg.locator(".ok-stat", { hasText: "Баланс" }).getByText(/300/).waitFor({ timeout: 5000 });
ok(true, "confirmed top-up is credited to the balance");
await nav("Модулі");
ok(await pg.getByText("У розробці").first().waitFor({ timeout: 5000 }).then(() => true, () => false) && (await pg.getByRole("button", { name: "Підключити" }).count()) === 0, "modules that do not work yet cannot be bought");

execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -qc "delete from organizations where id in (select organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'); delete from users where email='${email}'; delete from login_events where email_attempted='${email}';"`);
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
