// Stage 10: the site's server — the secret key (shown once, works with /v1, refused from a browser) and webhooks
// (a local listener receives a signed test from «Надіслати тест»).
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard } from "./nav.mjs";

const BASE = process.env.BASE ?? "http://localhost:8080";
const API = process.env.API ?? "http://localhost:4000";
const SHOTS = process.env.SHOTS ?? "/tmp";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1366, height: 950 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 6000) => loc.waitFor({ timeout }).then(() => true, () => false);

// A local «site server» that listens for webhooks.
const got = [];
const srv = createServer((req, res) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { got.push({ headers: req.headers, body }); res.writeHead(204).end(); }); }).listen(4999);

const email = `api-e2e${Date.now()}@test.oneknight.local`;
await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Вівчарик E2E");
await pg.getByLabel("Телефон").fill("+380670009922");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("api e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await onboard(pg);
await go(pg, "Сайт");
await pg.getByLabel("Домен").fill("vivcharyk-e2e.example.org");
await pg.getByRole("button", { name: "Додати" }).click();
await pg.getByText("vivcharyk-e2e.example.org").first().waitFor();
// Not confirmed yet (no ok.js): the key and webhooks are already there, under the setup steps.

// The secret key: created by the owner, shown once.
await pg.getByRole("button", { name: "Створити ключ" }).click();
const key = (await pg.locator(".app-once code").innerText()).trim();
ok(/^ok_sec_[A-Za-z0-9_-]{43}$/.test(key), "secret key shown once");
await pg.screenshot({ path: `${SHOTS}/site-api-key.png`, fullPage: true });
await pg.getByRole("button", { name: "Я зберіг" }).click();
ok(!(await pg.locator(".ok-screen").innerText()).includes(key), "after that only a hint is visible");
const site = await (await fetch(`${API}/api/v1/site`, { headers: { authorization: `Bearer ${key}` } })).json();
ok(site.domain === "vivcharyk-e2e.example.org" && site.business === "Вівчарик E2E", "/api/v1/site with the key from the site's server");
const fromBrowser = await pg.evaluate(async (k) => (await fetch("/api/v1/site", { headers: { authorization: `Bearer ${k}` } })).json(), key);
ok(fromBrowser.error === "secret_key_in_browser", "the key is refused from a browser");

// A webhook to the local listener; «Надіслати тест» delivers a signed ping.
await pg.getByRole("button", { name: "Додати адресу" }).click();
await pg.getByLabel("Адреса").fill("http://localhost:4999/hooks/oneknight");
await pg.getByRole("button", { name: "Додати", exact: true }).click();
const secret = (await pg.locator(".app-once code").innerText()).trim();
ok(/^whsec_/.test(secret), "webhook signing secret shown once");
await pg.getByRole("button", { name: "Я зберіг" }).click();
ok(await seen(pg.locator(".app-hook", { hasText: "localhost:4999" })), "webhook listed with its events");
await pg.getByRole("button", { name: "Надіслати тест" }).click();
ok(await seen(pg.getByText(/Сайт відповів 204/)), "test delivered, the site answered 204");
const ping = got.at(-1);
const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(ping?.headers["x-oneknight-signature"] ?? "") ?? [];
ok(!!v1 && createHmac("sha256", secret).update(`${t}.${ping.body}`).digest("hex") === v1 && JSON.parse(ping.body).type === "ping", "the signature checks out with the secret");
await pg.getByRole("button", { name: "Журнал" }).click();
ok(await seen(pg.getByText("Доставок ще не було.")), "delivery log (tests are not in it)");
await pg.getByText("Як перевірити підпис").click();
await pg.screenshot({ path: `${SHOTS}/site-api-hooks.png`, fullPage: true });

// Docs mention /v1 and webhooks.
await pg.goto(`${BASE}/docs/api/#webhooks`, { waitUntil: "networkidle" });
ok(await seen(pg.getByText("order.status_changed").first()), "docs: webhook events");
ok(await seen(pg.getByText("/api/v1/orders/{number}")), "docs: /v1 endpoints");

srv.close();
cleanupTestData();
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
