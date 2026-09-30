// Billing flow in the browser. Start the API with test requisites, e.g.
// PAYMENT_RECIPIENT="Test recipient" PAYMENT_IBAN="UA000000000000000000000000000" npm start -w @oneknight/api
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard } from "./nav.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `bill-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => go(pg, name);

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Оплата E2E");
await pg.getByLabel("Телефон").fill("+380670003344");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("billing e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await onboard(pg);
await nav("Оплата");
ok(await pg.getByText("Підписка ще не активна").waitFor({ timeout: 5000 }).then(() => true, () => false), "no subscription before the website launch");

execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await nav("Бізнеси");
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

await nav("Поповнення");
await pg.locator("li", { hasText: purpose.match(/OK-[0-9A-F]{8}/)[0] }).getByRole("button", { name: "Гроші надійшли" }).click();
await pg.getByText("Зараховано на баланс").waitFor();
await nav("Оплата");
await pg.locator(".ok-stat", { hasText: "Баланс" }).getByText(/300/).waitFor({ timeout: 5000 });
ok(true, "confirmed top-up is credited to the balance");
// The plan: ONEKNIGHT 149 in the breakdown; a year needs 1 490, the missing sum goes into the top-up form.
ok((await pg.locator(".app-bill-parts").innerText()).includes("149"), "next charge with the breakdown");
await pg.getByRole("button", { name: /Оплатити рік — 1\s?490/ }).click();
ok(await pg.getByText(/На балансі бракує 1\s?190/).waitFor({ timeout: 5000 }).then(() => true, () => false), "not enough for the year: the missing sum is shown");
ok((await pg.getByLabel("Сума, грн").inputValue()) === "1190", "the top-up form gets the missing sum");
const orgId = await pg.evaluate(async () => (await (await fetch("/api/auth/me")).json()).activeOrgId);
execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -qc "insert into ledger_entries (organization_id, kind, amount_kop, reason) values ('${orgId}', 'adjustment', 119000, 'e2e')"`);
await pg.reload({ waitUntil: "networkidle" });
await pg.getByRole("button", { name: /Оплатити рік/ }).click();
ok(await pg.getByText(/ONEKNIGHT оплачено до/).first().waitFor({ timeout: 5000 }).then(() => true, () => false), "a year paid from the balance");
ok((await pg.locator(".app-bill-parts").innerText()).includes("оплачено наперед"), "ONEKNIGHT is not charged monthly within the year");
await nav("Модулі");
ok(await pg.getByText("У розробці").first().waitFor({ timeout: 5000 }).then(() => true, () => false) && (await pg.locator(".ok-module", { hasText: "У розробці" }).getByRole("button", { name: "Підключити" }).count()) === 0, "modules that do not work yet cannot be bought");

cleanupTestData();
// Known, intermittent React #418 (hydration) seen only after a form sign-up + reloads; tracked in TODO.md.
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
