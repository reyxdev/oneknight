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

cleanupTestData();
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
