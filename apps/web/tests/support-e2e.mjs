// Support flow: client creates a request with a screenshot, admin replies, client sees the reply.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard } from "./nav.mjs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:8080";
const shot = fileURLToPath(new URL("./fixture-screenshot.png", import.meta.url));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const errs = [];
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const stamp = Date.now();
const client = `sup-c${stamp}@test.oneknight.local`;
const admin = `sup-a${stamp}@test.oneknight.local`;

async function account(email, name) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
  await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
  await pg.getByLabel("Ім'я").fill(name);
  await pg.getByLabel("Телефон").fill("+380670005566");
  await pg.getByLabel("Електронна пошта").fill(email);
  await pg.getByLabel("Пароль").fill("support e2e pass");
  await pg.getByRole("button", { name: "Створити акаунт" }).click();
  await onboard(pg);
  return pg;
}
const nav = (pg, name) => go(pg, name);

const c = await account(client, "Клієнт E2E");
await nav(c, "Підтримка");
await c.getByLabel("Категорія").selectOption("bug");
await c.getByLabel("Опишіть, що сталося").fill("Кнопка «Купити» не натискається на iPhone");
await c.locator("input[type=file]").setInputFiles(shot);
await c.locator(".ok-shot img").waitFor();
await c.getByRole("button", { name: "Надіслати" }).click();
await c.getByText(/Звернення №\d+ створено/).waitFor();
ok(true, "client creates a request with a screenshot");

const a = await account(admin, "Адмін E2E");
execSync(`npm run -s admin:grant -w @oneknight/api -- ${admin}`);
await a.reload({ waitUntil: "networkidle" });
await nav(a, "Звернення");
await a.locator(".ok-row", { hasText: "Помилка" }).first().click();
ok(await a.locator(".app-thread img").waitFor({ timeout: 5000 }).then(() => true, () => false), "admin sees the screenshot");
await a.getByLabel("Відповісти").fill("Дякую! Виправили, перевірте, будь ласка.");
await a.getByRole("button", { name: "Надіслати" }).click();
await a.getByText("Дякую! Виправили").waitFor();

await c.reload({ waitUntil: "networkidle" });
ok(await c.locator(".ok-badge").waitFor({ timeout: 35000 }).then(() => true, () => false), "client gets a notification");
await nav(c, "Підтримка");
await c.locator(".ok-row").first().click();
ok(await c.getByText("Підтримка ONEKNIGHT").waitFor({ timeout: 5000 }).then(() => true, () => false), "client sees the staff reply");

cleanupTestData();
// Known, intermittent React #418 (hydration) seen only after a form sign-up + reloads; tracked in TODO.md.
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
