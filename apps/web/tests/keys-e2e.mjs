// Access keys and promo codes: the admin creates a batch (codes shown once) and a bonus promo code, a client
// activates both in «Оплата», the admin sees the key as activated.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard } from "./nav.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const errs = [];
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 6000) => loc.waitFor({ timeout }).then(() => true, () => false);

async function signup(name, email) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
  await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
  await pg.getByLabel("Ім'я").fill(name);
  await pg.getByLabel("Телефон").fill("+380670001122");
  await pg.getByLabel("Електронна пошта").fill(email);
  await pg.getByLabel("Пароль").fill("keys e2e pass");
  await pg.getByRole("button", { name: "Створити акаунт" }).click();
  await onboard(pg);
  return pg;
}
const nav = (pg, name) => go(pg, name);

const adminEmail = `keys-admin${Date.now()}@test.oneknight.local`;
const admin = await signup("Адмін E2E", adminEmail);
execSync(`npm run -s admin:grant -w @oneknight/api -- ${adminEmail}`);
await admin.reload({ waitUntil: "networkidle" });
await nav(admin, "Ключі й промокоди");
await admin.getByLabel("Місяців").fill("3");
await admin.getByLabel("Кількість ключів").fill("2");
await admin.getByLabel("Нотатка для себе").fill("e2e партія");
await admin.getByRole("button", { name: "Створити ключі" }).click();
const box = admin.getByLabel("Нові ключі (показуються лише зараз)");
await box.waitFor();
const codes = (await box.inputValue()).split("\n");
ok(codes.length === 2 && codes.every((c) => /^OK-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), "two readable keys shown once");
await admin.getByRole("button", { name: "Зберіг, сховати" }).click();
ok(await seen(admin.getByText("Усього 2 · активовано 0 · вимкнено 0")), "batch listed with counts");
ok(!(await admin.content()).includes(codes[0]), "codes are not shown again");

const promo = `E2E${Date.now().toString(36).toUpperCase()}`;
await admin.getByLabel("Код (латиниця й цифри)").fill(promo);
await admin.getByLabel("Тип").selectOption("bonus");
await admin.getByLabel("Значення").fill("150");
await admin.getByRole("button", { name: "Створити промокод" }).click();
ok(await seen(admin.getByText(promo, { exact: true })), "promo code created");

const client = await signup("Клієнт ключа E2E", `keys-client${Date.now()}@test.oneknight.local`);
await nav(client, "Оплата");
await client.getByLabel("Код", { exact: true }).fill("OK-AAAA-BBBB-CCCC");
await client.getByRole("button", { name: "Активувати" }).click();
ok(await seen(client.getByText("Такого коду немає або його вимкнено")), "unknown code refused");
await client.getByLabel("Код", { exact: true }).fill(codes[0].toLowerCase().replaceAll("-", " "));
await client.getByRole("button", { name: "Активувати" }).click();
ok(await seen(client.getByText(/ONEKNIGHT оплачено ключем до/)), "key activated (case and dashes ignored)");
ok(await seen(client.getByText(/ONEKNIGHT за ключем до/)), "subscription shows key coverage");
await client.getByLabel("Код", { exact: true }).fill(promo.toLowerCase());
await client.getByRole("button", { name: "Активувати" }).click();
ok(await seen(client.getByText("На баланс додано 150 грн")), "bonus promo added to the balance");
ok(await seen(client.getByText(`Промокод ${promo}`)), "promo shown in the history");
await client.getByLabel("Код", { exact: true }).fill(codes[0]);
await client.getByRole("button", { name: "Активувати" }).click();
ok(await seen(client.getByText("Цей код уже використано")), "a key works once");

await admin.reload({ waitUntil: "networkidle" });
ok(await seen(admin.getByText("Усього 2 · активовано 1 · вимкнено 0")), "admin sees the activation");
await admin.getByRole("button", { name: "Показати ключі" }).click();
ok(await seen(admin.getByText("активовано: Клієнт ключа E2E")), "activated by the right business");

cleanupTestData();
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
await b.close();
process.exit(failed || errs.length ? 1 : 0);
