// Admin adds a real site to a client; the client sees live monitoring. Needs the API with network access.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const DOMAIN = process.env.SITE ?? "example.com"; // IANA test domain; must not be a domain already added to a client
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `site-e2e${Date.now()}@test.oneknight.local`;

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Сайт E2E");
await pg.getByLabel("Телефон").fill("+380670001122");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("site e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо").waitFor();
await pg.locator(".ok-side nav").getByRole("button", { name: "Сайт", exact: true }).click();
ok(await pg.getByText("Сайту поки немає").waitFor({ timeout: 5000 }).then(() => true, () => false), "empty site state before any site");

execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await pg.locator(".ok-side .ok-navbtn", { hasText: "Клієнти й сайти" }).click();
const panel = pg.locator(".okp", { hasText: "Сайт E2E" }).first();
await panel.getByLabel("Домен").fill("localhost");
await panel.getByRole("button", { name: "Додати" }).click();
ok(await panel.getByText("Вкажіть публічний домен").waitFor({ timeout: 5000 }).then(() => true, () => false), "local domains are refused");
await panel.getByLabel("Домен").fill(`https://${DOMAIN}/`);
await panel.getByRole("button", { name: "Додати" }).click();
await panel.getByText(DOMAIN).waitFor();
await panel.getByRole("button", { name: "Перевірити зараз" }).click();
await pg.getByText("Перевірено").waitFor({ timeout: 20000 });
ok(true, "admin adds a site and runs a check");

await pg.locator(".ok-side nav").getByRole("button", { name: "Сайт", exact: true }).click();
await pg.locator(".ok-stat", { hasText: "Доступність" }).waitFor();
const status = await pg.locator(".ok-stat").first().innerText();
ok(/Працює|Недоступний/.test(status), `site status is a real probe result (${status.split("\n")[1]})`);
const ssl = await pg.locator(".ok-stat", { hasText: "SSL" }).innerText();
ok(/\d+ дн\./.test(ssl), `SSL days left are shown (${ssl.split("\n")[1]})`);
await pg.screenshot({ path: process.env.SHOT ?? "/tmp/site-e2e.png" });

execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -qc "delete from organizations where id in (select organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'); delete from users where email='${email}'; delete from login_events where email_attempted='${email}';"`);
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
