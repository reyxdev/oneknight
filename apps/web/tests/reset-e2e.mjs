// Password reset: the admin creates a one-time link, the person sets a new password with it and signs in.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
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
  await pg.getByLabel("Телефон").fill("+380670001133");
  await pg.getByLabel("Електронна пошта").fill(email);
  await pg.getByLabel("Пароль").fill("old e2e password");
  await pg.getByRole("button", { name: "Створити акаунт" }).click();
  await pg.getByText("Вітаємо").waitFor();
  return pg;
}

const stamp = Date.now();
const adminEmail = `reset-admin${stamp}@test.oneknight.local`;
const userEmail = `reset-user${stamp}@test.oneknight.local`;
const admin = await signup("Адмін E2E", adminEmail);
const user = await signup("Олена E2E", userEmail);
execSync(`npm run -s admin:grant -w @oneknight/api -- ${adminEmail}`);
await admin.reload({ waitUntil: "networkidle" });
await admin.locator(".ok-side nav").getByRole("button", { name: "Клієнти й сайти", exact: true }).click();
await admin.getByLabel("Пошта акаунта").fill(`nobody${stamp}@test.oneknight.local`);
await admin.getByRole("button", { name: "Створити посилання" }).click();
ok(await seen(admin.getByText("Акаунта з такою поштою немає")), "unknown email refused");
await admin.getByLabel("Пошта акаунта").fill(userEmail);
await admin.getByRole("button", { name: "Створити посилання" }).click();
const linkBox = admin.getByLabel("Посилання (діє 24 години)");
await linkBox.waitFor();
const link = await linkBox.inputValue();
ok(/\/app\/\?reset=[\w-]{40,}$/.test(link), "one-time link created");

const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
await pg.goto(link, { waitUntil: "networkidle" });
ok(await seen(pg.getByText(/Олена E2E, придумайте новий пароль/)), "reset screen greets the person");
ok(!pg.url().includes("reset="), "token removed from the address bar");
await pg.getByLabel("Новий пароль").fill("brand new e2e pass");
await pg.getByRole("button", { name: "Зберегти пароль" }).click();
ok(await seen(pg.getByText("Пароль змінено. Увійдіть з новим паролем.")), "password changed");
await pg.getByLabel("Електронна пошта").fill(userEmail);
await pg.getByLabel("Пароль").fill("brand new e2e pass");
await pg.getByRole("button", { name: "Увійти", exact: true }).click();
ok(await seen(pg.getByText("Вітаємо")), "signed in with the new password");

// Backups (owner): create a copy in the profile and download it.
await pg.locator(".ok-side nav").getByRole("button", { name: "Профіль", exact: true }).click();
await pg.getByRole("button", { name: "Створити копію зараз" }).click();
ok(await seen(pg.getByText(/Вручну · \d+ KB · товарів 0 · замовлень 0 · відгуків 0/)), "manual backup listed");
const [dl] = await Promise.all([pg.waitForEvent("download"), pg.getByRole("link", { name: "Завантажити" }).first().click()]);
ok(/^oneknight-backup-\d{4}-\d\d-\d\d\.json\.gz$/.test(dl.suggestedFilename()), `backup downloads (${dl.suggestedFilename()})`);

// Profile: edit own data and the business name, change the password.
await pg.getByLabel("Назва бізнесу").fill("Майстерня Олени");
await pg.getByRole("button", { name: "Зберегти", exact: true }).click();
ok(await seen(pg.locator(".app-org", { hasText: "Майстерня Олени" })), "business name changed");
await pg.getByLabel("Поточний пароль").fill("wrong one");
await pg.getByLabel("Новий пароль").fill("second new pass");
await pg.getByRole("button", { name: "Змінити пароль" }).click();
ok(await seen(pg.getByText("Поточний пароль невірний")), "wrong current password refused");
await pg.getByLabel("Поточний пароль").fill("brand new e2e pass");
await pg.getByRole("button", { name: "Змінити пароль" }).click();
ok(await seen(pg.getByText(/Пароль змінено. На інших пристроях/)), "password changed from the profile");

await user.reload({ waitUntil: "networkidle" });
ok(await seen(user.locator(".app-auth-card")), "the old session was signed out");
await pg.goto(link, { waitUntil: "networkidle" });
ok(await seen(pg.getByText(/Посилання недійсне, прострочене або вже використане/)), "link works once");

cleanupTestData();
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
await b.close();
process.exit(failed || errs.length ? 1 : 0);
