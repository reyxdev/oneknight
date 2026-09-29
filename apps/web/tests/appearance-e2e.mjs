// Website appearance: change settings in the account, a client site with ok.js picks them up.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { cleanupTestData } from "./cleanup.mjs";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `look-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => pg.locator(".ok-side nav").getByRole("button", { name, exact: true }).click();

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Вигляд E2E");
await pg.getByLabel("Телефон").fill("+380670004545");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("look e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо").waitFor();
execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await nav("Клієнти й сайти");
const panel = pg.locator(".okp", { hasText: "Вигляд E2E" }).first();
await panel.getByLabel("Домен").fill("example.info");
await panel.getByRole("button", { name: "Додати" }).click();
await panel.getByText("example.info").waitFor();

await nav("Сайт");
const look = pg.locator(".okp", { hasText: "Вигляд сайту" });
await look.getByRole("button", { name: "Пульс" }).click();
await look.getByRole("button", { name: "Смуга" }).click();
ok(await look.locator(".ok-pbtn[data-anim=pulse]").count() === 1 && (await look.locator(".ok-pnotice[data-style=banner]").count()) === 1, "preview changes immediately");
await look.getByRole("button", { name: "Зберегти" }).click();
await pg.getByText("Збережено. На сайті").waitFor();
const key = (await pg.locator(".app-key").first().innerText()).trim();

const site = await b.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36" });
await site.route("http://localhost:9912/**", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Client</title><script src="${BASE}/ok.js" data-key="${key}" data-appearance></script><button data-ok-button>Купити</button>` }));
const sp = await site.newPage();
sp.on("console", (m) => { if (m.type() === "error") console.log("site console:", m.text().slice(0, 160)); });
await sp.goto("http://localhost:9912/", { waitUntil: "load" });
await sp.waitForFunction(() => document.documentElement.getAttribute("data-ok-anim") === "pulse", null, { timeout: 5000 }).then(() => ok(true, "client site applies the saved button animation"), () => ok(false, "client site applies the saved button animation"));
await sp.evaluate(() => window.oneknight.notify("Дякуємо!"));
ok(await sp.locator(".ok-notice[data-style=banner]").count() === 1, "oneknight.notify uses the chosen notice style");

cleanupTestData();
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
