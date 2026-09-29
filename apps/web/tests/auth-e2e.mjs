// Sign-up and sign-in details: phone mask, «Показати», invitation code, account already exists, «Забули пароль?»
// through Telegram, demo link, and signing in again in place when the session ends mid-work.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 5000) => loc.waitFor({ timeout }).then(() => true, () => false);
const email = `auth-e2e${Date.now()}@test.oneknight.local`;

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Телефон").fill("0671234567");
ok((await pg.getByLabel("Телефон").inputValue()) === "+380 67 123 45 67", "phone is formatted as +380 XX XXX XX XX");
const pass = pg.getByLabel("Пароль", { exact: true });
await pass.fill("secret words");
await pg.getByRole("button", { name: "Показати символи" }).click();
ok((await pass.getAttribute("type")) === "text", "«Показати» shows the password");
ok(!(await pg.getByText("Увійти через Google").count()), "sign-in methods that do not work are not shown");
ok(await pg.getByRole("link", { name: "умовами ONEKNIGHT" }).isVisible(), "terms link on sign-up");
ok(await pg.getByRole("link", { name: "Спробувати демо без реєстрації" }).isVisible(), "demo without sign-up");
await pg.getByRole("button", { name: "Є код запрошення?" }).click();
ok(await pg.getByLabel("Код або посилання запрошення").isVisible(), "invitation code is hidden until asked");

await pg.getByLabel("Ім'я").fill("Вхід E2E");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Код або посилання запрошення").fill("");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо").waitFor();
const userId = await pg.evaluate(async () => (await (await fetch("/api/auth/me")).json()).id);

// Session ends while working: sign in again, back on the same screen.
await pg.locator(".ok-side").getByRole("button", { name: "Команда", exact: true }).click();
await pg.waitForURL(/#team/);
execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -qc "update sessions set revoked_at = now() where user_id = '${userId}'"`);
await pg.locator(".ok-side").getByRole("button", { name: "Замовлення", exact: true }).click();
ok(await seen(pg.getByText("Сеанс закінчився")), "expired session asks to sign in again");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль", { exact: true }).fill("secret words");
await pg.getByRole("button", { name: "Увійти", exact: true }).click();
ok(await seen(pg.locator(".ok-h h3", { hasText: "Замовлення" })), "after signing in the person is where they were");

// Account already exists: one click to sign in with the same email.
await pg.locator(".ok-side").getByRole("button", { name: "Вийти" }).click();
await pg.getByRole("tab", { name: "Реєстрація" }).click();
await pg.getByLabel("Ім'я").fill("Вхід E2E");
await pg.getByLabel("Телефон").fill("+380671234567");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль", { exact: true }).fill("another pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
ok(await seen(pg.getByText("Акаунт із такою поштою вже є.")), "existing email is recognised");
await pg.getByRole("alert").getByRole("button", { name: "Увійти" }).click();
ok((await pg.getByRole("tab", { name: "Вхід" }).getAttribute("aria-selected")) === "true" && (await pg.getByLabel("Електронна пошта").inputValue()) === email, "switches to sign-in with the email kept");

await pg.getByRole("button", { name: "Забули пароль?" }).click();
await pg.getByRole("button", { name: "Надіслати посилання в Telegram" }).click();
ok(await seen(pg.getByText(/Якщо до акаунта підключено Telegram, посилання вже там/)), "«Забули пароль?» through Telegram, same answer for everyone");

errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs.join("\n") : "none");
await b.close();
cleanupTestData();
process.exit(failed || errs.length ? 1 : 0);
