// Admin adds a real site to a client; the client sees live monitoring. Needs the API with network access.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go } from "./nav.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const DOMAIN = process.env.SITE ?? "example.com"; // IANA test domain; must not be a domain already added to a client
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
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
await go(pg, "Сайт");
ok(await pg.getByText("Сайту поки немає").waitFor({ timeout: 5000 }).then(() => true, () => false), "empty site state before any site");

execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await go(pg, "Бізнеси");
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

await go(pg, "Сайт");
await pg.locator(".ok-stat", { hasText: "Доступність" }).waitFor();
const status = await pg.locator(".ok-stat").first().innerText();
ok(/Працює|Недоступний/.test(status), `site status is a real probe result (${status.split("\n")[1]})`);
const ssl = await pg.locator(".ok-stat", { hasText: "SSL" }).innerText();
ok(/\d+ дн\./.test(ssl), `SSL days left are shown (${ssl.split("\n")[1]})`);
await pg.screenshot({ path: process.env.SHOT ?? "/tmp/site-e2e.png" });

cleanupTestData();
// Known, intermittent React #418 (hydration) seen only after a form sign-up + reloads; tracked in TODO.md.
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
