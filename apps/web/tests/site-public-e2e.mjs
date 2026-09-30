// Public site, stage 9 part 1: the request in two steps with «Що далі» and the account that takes the request,
// FAQ, the cookies note, «Написати» on phones, the invitation strip from a referral link.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";

const BASE = process.env.BASE ?? "http://localhost:8080";
const SHOTS = process.env.SHOTS ?? "/tmp";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1366, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 6000) => loc.waitFor({ timeout }).then(() => true, () => false);

await pg.goto(`${BASE}/`, { waitUntil: "networkidle" });
// Cookies: a note, «Зрозуміло» hides it for good.
ok(await seen(pg.getByText("Сайт використовує лише потрібні cookies")), "cookies note");
await pg.getByRole("button", { name: "Зрозуміло" }).click();
await pg.reload({ waitUntil: "networkidle" });
ok((await pg.getByText("Сайт використовує лише потрібні cookies").count()) === 0, "cookies note stays closed");

// FAQ with prices from the price list.
await pg.evaluate(() => document.querySelector("#faq").scrollIntoView());
await pg.getByText("Скільки коштує і що входить?").click();
ok(await seen(pg.getByText(/ONEKNIGHT\s—\s149\sгрн\sна\sмісяць/)), "FAQ answer with the real price");
ok((await pg.locator(".faq-item").count()) === 7, "7 FAQ topics on the home page");
const ld = await pg.locator("script[type='application/ld+json']").allInnerTexts();
ok(ld.some((x) => x.includes('"FAQPage"')), "FAQ data for search engines");
await pg.screenshot({ path: `${SHOTS}/site-faq.png` });

// The request: step 1, «Що далі», step 2, «Створити кабінет».
await pg.evaluate(() => scrollTo(0, 0));
await pg.locator("header .btn", { hasText: "Замовити сайт" }).click();
const D = pg.locator("dialog[open]");
await D.getByLabel("Ім'я").fill("Сайт E2E");
await D.getByLabel("Телефон").fill("+380 93 000 22 33");
await D.getByLabel("Який сайт потрібен?").selectOption("shop");
await pg.screenshot({ path: `${SHOTS}/site-order-1.png` });
await D.getByRole("button", { name: "Надіслати заявку" }).click();
ok(await seen(D.getByText(/Заявку №\d+ отримано/)), "step 1 accepted with a number");
ok(await seen(D.getByText("Зв'яжемося з вами")), "«Що далі»");
await D.getByLabel("Чим займається бізнес?").fill("Свічки ручної роботи");
await D.getByLabel("Що продаєте або які послуги надаєте?").fill("Ароматичні свічки й набори");
await pg.screenshot({ path: `${SHOTS}/site-order-2.png` });
await D.getByRole("button", { name: "Додати до заявки" }).click();
ok(await seen(D.getByText("Дякуємо, бриф додано до заявки.")), "step 2: the brief is added");
const href = await D.getByRole("link", { name: "Створити кабінет" }).getAttribute("href");
await pg.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
const email = `site-e2e${Date.now()}@test.oneknight.local`;
await pg.getByLabel("Ім'я").fill("Сайт E2E");
await pg.getByLabel("Телефон").fill("+380930002233");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("site e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByRole("heading", { name: /кілька питань/ }).waitFor();
const mine = await pg.evaluate(async () => (await fetch("/api/leads/mine")).json());
ok(mine.length === 1 && mine[0].business === "Свічки ручної роботи" && mine[0].siteType === "shop", "the new account took the request with its brief");

// The invitation strip from this account's referral link, on a fresh visit.
const { code } = await pg.evaluate(async () => (await fetch("/api/referrals")).json());
const guest = await b.newPage({ viewport: { width: 390, height: 844 } });
await guest.goto(`${BASE}/?ref=${code}`, { waitUntil: "networkidle" });
ok(await seen(guest.getByText("Вас запросив «Сайт E2E».")), "invitation strip with the business name");
ok((await guest.getByRole("link", { name: "Створити кабінет" }).first().getAttribute("href")).includes(`ref=${code}`), "the strip carries the referral code");
// «Написати» on a phone.
await guest.getByRole("button", { name: "Зрозуміло" }).click();
await guest.getByRole("button", { name: "Написати" }).click();
ok((await guest.getByRole("link", { name: "Telegram" }).last().getAttribute("href")).startsWith("https://t.me/"), "«Написати» opens the owner's channels");
await guest.screenshot({ path: `${SHOTS}/site-phone.png` });
await guest.close();
const desk = await b.newPage({ viewport: { width: 1366, height: 900 } });
await desk.goto(`${BASE}/`, { waitUntil: "networkidle" });
ok(!(await desk.getByRole("button", { name: "Написати" }).isVisible()), "no «Написати» button on desktop");
await desk.close();

// Calculator → «Замовити з цим розрахунком»: the lead gets the estimate.
const calc = await b.newPage({ viewport: { width: 1366, height: 900 } });
await calc.goto(`${BASE}/`, { waitUntil: "networkidle" });
await calc.evaluate(() => document.querySelector("#pricing").scrollIntoView());
await calc.getByRole("radio", { name: /Інтернет-магазин/ }).click();
await calc.locator("#calculator").waitFor();
await calc.locator("#calculator select").selectOption("300");
await calc.locator("#calculator").getByText("З нуля").click();
await calc.locator("#calculator").getByText("2", { exact: true }).click();
const sum = (await calc.locator(".calc-sum").innerText()).replace(/\s/g, "");
// 14 000 + 3 000 = 17 000; +30% design = 5 100; +20% language = 3 400 → 25 500; «до» +30% = 33 150 → 33 200.
ok(sum === "25500грн—33200грн", `calculator range (${sum})`);
await calc.locator("#calculator").screenshot({ path: `${SHOTS}/site-calculator.png` });
await calc.getByRole("button", { name: "Замовити з цим розрахунком" }).click();
const C = calc.locator("dialog[open]");
ok(await seen(C.getByText(/З розрахунком калькулятора: Інтернет-магазин, 25\s500\sгрн/)), "the request shows the estimate");
await C.getByLabel("Ім'я").fill("Калькулятор E2E");
await C.getByLabel("Телефон").fill("+380 93 000 44 55");
await C.getByRole("button", { name: "Надіслати заявку" }).click();
ok(await seen(C.getByText(/Заявку №\d+ отримано/)), "request with the estimate sent");
await calc.close();

// /panel: headline, the day, comparison, price, sample week, FAQ; the menu and the ONEKNIGHT block lead here.
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
ok((await p.locator("header nav").getByRole("link", { name: "ONEKNIGHT" }).getAttribute("href")) === "/panel/", "menu «ONEKNIGHT» leads to /panel");
await p.goto(`${BASE}/panel/`, { waitUntil: "networkidle" });
ok(await seen(p.getByRole("heading", { level: 1, name: "Замовлення, клієнти й доставка в одному місці" })), "/panel headline");
ok((await p.getByRole("link", { name: "Спробувати 30 днів" }).first().getAttribute("href")).includes("start=register"), "«Спробувати 30 днів» leads to sign-up");
ok((await p.getByRole("link", { name: "Запитати в Telegram" }).first().getAttribute("href")).startsWith("https://t.me/"), "«Запитати в Telegram»");
ok((await p.locator(".panel-timeline li").count()) === 6, "a day with ONEKNIGHT");
ok((await p.locator(".compare-table [role=row]").count()) === 7, "comparison without names");
ok(await seen(p.getByRole("heading", { name: "149 грн на місяць" })), "price from the price list");
ok((await p.locator(".faq-item").count()) === 6, "FAQ for /panel");
ok((await p.locator(".ok-rail").count()) === 0, "no home chapters rail on /panel");
ok((await p.title()).includes("CRM для інтернет-магазину"), "SEO title of /panel");
await p.screenshot({ path: `${SHOTS}/panel-top.png` });
await p.evaluate(() => document.querySelector(".panel-compare").scrollIntoView());
await p.waitForTimeout(600);
await p.screenshot({ path: `${SHOTS}/panel-compare.png` });
await p.goto(`${BASE}/en/panel/`, { waitUntil: "networkidle" });
ok(await seen(p.getByRole("heading", { level: 1, name: "Orders, customers and delivery in one place" })), "/en/panel");
await p.close();

// /status, /cases, the footer, 404, /docs/api.
const q = await b.newPage({ viewport: { width: 1366, height: 900 } });
await q.goto(`${BASE}/status/`, { waitUntil: "networkidle" });
ok(await seen(q.getByRole("heading", { level: 1, name: "Статус сервісів" })), "/status page");
ok(await seen(q.locator(".status-list li").first()), "services with their state");
ok((await q.locator(".status-list li").first().locator(".status-bars i").count()) === 90, "90 days of bars");
ok(await seen(q.getByText("Панель ONEKNIGHT")), "the panel is checked");
await q.screenshot({ path: `${SHOTS}/site-status.png` });
await q.goto(`${BASE}/cases/`, { waitUntil: "networkidle" });
ok(await seen(q.getByRole("heading", { level: 1, name: "Що ми вже зробили" })), "/cases page");
const foot = q.locator("footer");
for (const [name, href] of [["Статус сервісів", "/status/"], ["Документація API", "/docs/api/"], ["Увійти в кабінет", "/app/"], ["ONEKNIGHT для бізнесу", "/panel/"]])
  ok((await foot.getByRole("link", { name }).getAttribute("href")) === href, `footer: ${name}`);
await q.goto(`${BASE}/docs/api/`, { waitUntil: "networkidle" });
ok(await seen(q.getByRole("heading", { level: 1, name: "Документація API" })), "/docs/api page");
ok((await q.locator(".docs-body > section").count()) === 9, "9 documentation sections");
await q.locator(".docs-tabs").first().getByRole("tab", { name: "PHP" }).click();
ok((await q.locator(".docs-examples pre").first().innerText()).includes("<?php") || (await q.locator(".docs-examples pre").first().innerText()).includes("$"), "PHP example");
await q.screenshot({ path: `${SHOTS}/site-docs.png` });
await q.goto(`${BASE}/en/docs/api/`, { waitUntil: "networkidle" });
ok(await seen(q.getByRole("heading", { level: 1, name: "API documentation" })), "/en/docs/api");
const nf = await q.goto(`${BASE}/nope-page/`, { waitUntil: "networkidle" });
ok(nf.status() === 404 && (await q.getByRole("link", { name: "ONEKNIGHT для бізнесу" }).getAttribute("href")) === "/panel/", "404 with links");
await q.close();

cleanupTestData();
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
