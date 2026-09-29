// Real account flow through the browser: npm run build, API running, npm run serve. BASE defaults to :8080.
import { chromium } from "playwright-core";
import { generate } from "otplib";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const pg = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => { if (m.type() === "error" && !/40[14]/.test(m.text())) errs.push(m.text().slice(0, 200)); });
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `e2e${Date.now()}@test.oneknight.local`;

await pg.goto(`${BASE}/`, { waitUntil: "networkidle" });
await pg.locator("header a", { hasText: "Увійти" }).first().click();
await pg.waitForURL(/\/app\/$/);
ok(await pg.getByRole("heading", { name: "Вхід в ONEKNIGHT" }).count() === 1, "landing Увійти opens the account login");

await pg.getByRole("tab", { name: "Реєстрація" }).click();
await pg.getByRole("button", { name: "Створити акаунт" }).click();
ok(await pg.locator("[aria-invalid='true']").count() >= 3, "register validation");
await pg.getByLabel("Ім'я").fill("Тест E2E");
await pg.getByLabel("Телефон").fill("+380 67 111 22 33");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("super secret 1");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо, Тест E2E.").waitFor();
ok(true, "register lands in the account");
const cookies = await pg.context().cookies();
ok(cookies.find((c) => c.name === "ok_session")?.httpOnly === true, "session cookie is HttpOnly");

await pg.goto(`${BASE}/`, { waitUntil: "networkidle" });
ok(await pg.locator("header .btn", { hasText: "Відкрити ONEKNIGHT" }).count() === 1, "landing shows Відкрити ONEKNIGHT when signed in");
await pg.goto(`${BASE}/app/`, { waitUntil: "networkidle" });

await pg.locator(".ok-side .ok-navbtn", { hasText: "Безпека" }).click();
await pg.getByRole("button", { name: "Увімкнути" }).click();
const key = (await pg.locator(".app-key").innerText()).replace(/\s/g, "");
ok(key.length >= 16 && (await pg.locator(".app-qr svg").count()) === 1, "2FA setup shows QR and key");
const now = Math.floor(Date.now() / 1000);
await pg.locator(".app-code").fill(await generate({ secret: key, epoch: now }));
await pg.getByRole("button", { name: "Підтвердити й увімкнути" }).click();
await pg.getByText("Двофакторний вхід увімкнено.").first().waitFor();
ok(true, "2FA enabled");

await pg.locator(".ok-side .ok-navbtn", { hasText: "Вийти" }).click();
await pg.getByRole("heading", { name: "Вхід в ONEKNIGHT" }).waitFor();
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("wrong password");
await pg.getByRole("button", { name: "Увійти", exact: true }).click();
await pg.getByText("Невірна пошта або пароль.").waitFor();
ok(true, "wrong password is rejected with a clear message");
await pg.getByLabel("Пароль").fill("super secret 1");
await pg.getByRole("button", { name: "Увійти", exact: true }).click();
await pg.getByRole("heading", { name: "Код із застосунку" }).waitFor();
await pg.locator(".app-code").fill(await generate({ secret: key, epoch: now + 30 }));
await pg.getByRole("button", { name: "Підтвердити" }).click();
await pg.getByText("Вітаємо, Тест E2E.").waitFor();
ok(true, "login with password + fresh TOTP code");

await pg.locator(".ok-side .ok-navbtn", { hasText: "Безпека" }).click();
await pg.getByText("Пароль вірний, очікується код").first().waitFor();
ok((await pg.getByText("Невірний пароль").count()) >= 1, "login history lists the failed attempt");

console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
