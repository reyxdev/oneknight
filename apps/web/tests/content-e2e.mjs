// «Контент-план»: the admin opens the beta, the owner sees 3 real ideas, turns the module on, answers the setup,
// gets a week and a month of ideas from the products, opens an idea, marks it published, adds an own idea and a
// promotion; «Сьогодні запостити» on Home; the admin sees the templates and holidays.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard, openBusiness } from "./nav.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const SHOTS = process.env.SHOTS ?? "/tmp";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1440, height: 950 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 6000) => loc.waitFor({ timeout }).then(() => true, () => false);
const email = `content-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => go(pg, name);
const call = (path, method = "GET", body) => pg.evaluate(async ([p, m, bd]) => { const r = await fetch(`/api${p}`, { method: m, credentials: "same-origin", headers: bd ? { "content-type": "application/json" } : {}, body: bd ? JSON.stringify(bd) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; }, [path, method, body]);

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Свічкарня E2E");
await pg.getByLabel("Телефон").fill("+380670009911");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("content e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await onboard(pg);
execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });

// Products from the owner's catalogue (the plan is built from them).
const panel = await openBusiness(pg, "Свічкарня E2E");
await panel.getByRole("button", { name: "Відкрити 3 місяці безкоштовно" }).click();
await pg.getByText("Безкоштовний період відкрито").waitFor();
await panel.getByRole("tab", { name: "Сайти" }).click();
await panel.getByLabel("Домен").fill("svichkarnia.example.org");
await panel.getByRole("button", { name: "Додати" }).click();
await panel.getByText("svichkarnia.example.org").waitFor();
const sites = (await call("/sites")).data;
const siteId = (Array.isArray(sites) ? sites : sites.sites)[0].id;
for (const [name, price, oldPrice] of [["Свічка «Лаванда»", 250], ["Свічка «Ваніль»", 260], ["Свічка «Кедр»", 300], ["Набір із трьох свічок", 700], ["Свічка «Кориця»", 200, 260]])
  await call(`/shop/sites/${siteId}/products`, "POST", { name, price, ...(oldPrice ? { oldPrice } : {}) });

// Before the beta: the menu has no «Контент»; after the admin's switch it shows 3 ideas and the locked rest.
await nav("Головна");
ok((await pg.locator(".ok-side").getByRole("button", { name: "Контент", exact: true }).count()) === 0, "no «Контент» before the beta");
const card = await openBusiness(pg, "Свічкарня E2E");
const beta = card.getByRole("switch", { name: /Бета «Контент-план»/ });
await beta.click();
await pg.waitForFunction(() => [...document.querySelectorAll("[role=switch]")].some((x) => x.closest("label")?.textContent?.includes("Бета") && x.getAttribute("aria-checked") === "true"));
await pg.reload({ waitUntil: "networkidle" });
await nav("Контент");
ok(await seen(pg.getByText("Ось перші ідеї на цей тиждень")), "preview of the first ideas");
ok((await pg.locator(".app-idea").count()) <= 3 && (await pg.locator(".app-idea").count()) > 0, "no more than 3 ideas without the module");
ok(await seen(pg.getByText(/Ще \d+ ідей на тиждень/)), "the rest of the week is counted, locked");
await pg.screenshot({ path: `${SHOTS}/content-preview.png` });
await pg.getByRole("button", { name: "Увімкнути модуль" }).click();
await pg.locator(".ok-module", { hasText: "Контент-план" }).getByRole("button", { name: "Підключити" }).click();
await pg.locator(".ok-module", { hasText: "Контент-план" }).getByText("Підключено").waitFor();
ok(true, "module connected in the trial");

// Setup: channels, voice, rhythm.
await pg.reload({ waitUntil: "networkidle" });
await nav("Контент");
ok(await seen(pg.getByText("Кілька відповідей, і план складеться сам")), "first visit asks the setup");
for (const c of ["Facebook", "Telegram", "Сайт (стаття)"]) await pg.getByRole("switch", { name: c, exact: true }).click();
await pg.getByLabel("Що ви продаєте").fill("ароматичні свічки ручної роботи");
await pg.getByRole("radio", { name: "На «ти»" }).click();
await pg.getByRole("radio", { name: "Активний" }).click();
await pg.getByRole("button", { name: "Неділя", exact: true }).click();
await pg.getByLabel("Ваш хештег").fill("свічкарня");
await pg.screenshot({ path: `${SHOTS}/content-setup.png`, fullPage: true });
await pg.getByRole("button", { name: "Зберегти й скласти план" }).click();
await pg.getByText("Налаштування збережено").waitFor();

// The week: ideas from the products, no more than 3 a day, today marked.
await pg.locator(".app-day").first().waitFor();
const perDay = await pg.locator(".app-day").evaluateAll((els) => els.map((e) => e.querySelectorAll(".app-idea").length));
ok(perDay.every((n) => n <= 3) && perDay.reduce((a, n) => a + n, 0) >= 7, `a week of ideas (${perDay.join(",")})`);
ok(await seen(pg.locator(".app-day[data-today]")), "today is marked");
const noBraces = await pg.locator(".app-week").innerText();
ok(!/\{[a-zA-Z]+\}|\{\{/.test(noBraces), "every placeholder filled");
await pg.screenshot({ path: `${SHOTS}/content-week.png` });

// The idea card: why, texts, the tracked link, «Опубліковано».
const firstIdea = pg.locator(".app-day").filter({ has: pg.locator(".app-idea") }).first().locator(".app-idea").first();
const title = (await firstIdea.locator("b").innerText()).trim();
await firstIdea.click();
const detail = pg.locator(".ok-detail");
ok(await seen(detail.getByText("Чому саме це")), "the card explains why");
ok(await seen(detail.getByText("Посилання з міткою")), "the card has the tracked link");
ok(/utm_campaign=content/.test(await detail.locator(".app-idea-link code").innerText()), "UTM link");
const text = await detail.locator("textarea.app-idea-text").inputValue();
ok(text.length > 20 && !/\{\{/.test(text), "a ready text in «ти»");
await detail.getByRole("tab", { name: "Розгорнуто" }).click();
ok((await detail.locator("textarea.app-idea-text").inputValue()).length >= text.length, "a long variant");
await pg.screenshot({ path: `${SHOTS}/content-card.png` });
await detail.getByRole("button", { name: "Опубліковано" }).click();
await pg.getByText("Позначено як опубліковане").waitFor();
ok(await seen(pg.locator(".app-idea[data-status='published']", { hasText: title })), "marked as published");

// «Інша ідея» on another idea.
const second = pg.locator(".app-idea[data-status='todo']").first();
const before = (await second.locator("b").innerText()).trim();
await second.click();
await detail.getByRole("button", { name: "Інша ідея" }).click();
await pg.waitForTimeout(800);
ok((await detail.count()) === 0, `«Інша ідея» fills the slot of «${before}» and closes the card`);

// Part 2 on the card: assign, comment, own photo, repeat; export links.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await pg.locator(".app-idea[data-status='todo']").first().click();
await detail.getByLabel("Хто робить").selectOption({ label: "Свічкарня E2E" });
await pg.getByText("Призначено: людина отримає сповіщення").waitFor();
await detail.getByLabel("Коментар").fill("Зняти при денному світлі");
await detail.getByRole("button", { name: "Надіслати", exact: true }).click();
ok(await seen(detail.locator(".app-comments", { hasText: "Зняти при денному світлі" })), "comment on the idea");
await detail.locator("input[type=file]").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: png });
ok(await seen(detail.getByText("Ваші фото (1 з 10)")), "own photo on the idea");
await detail.getByRole("button", { name: "Повторити", exact: true }).click();
ok(await seen(pg.getByText(/Копію додано на/)), "repeat in 2 weeks");
await detail.getByRole("button", { name: "Собі в Telegram" }).click();
ok(await seen(pg.getByText("Спершу підключіть Telegram")), "Telegram to self asks to link first");
await pg.screenshot({ path: `${SHOTS}/content-team.png`, fullPage: true });
await pg.locator("body").click({ position: { x: 5, y: 500 } });
await pg.keyboard.press("Escape");
const xlsxHref = await pg.getByRole("link", { name: "Excel" }).getAttribute("href");
const xlsx = await pg.evaluate(async (h) => { const r = await fetch(h); const b = new Uint8Array(await r.arrayBuffer()); return [r.status, String.fromCharCode(b[0], b[1])]; }, xlsxHref);
ok(xlsx[0] === 200 && xlsx[1] === "PK", "Excel export");
const ics = await pg.evaluate(async (h) => (await fetch(h)).text(), await pg.getByRole("link", { name: "Календар (.ics)" }).getAttribute("href"));
ok(/BEGIN:VEVENT/.test(ics), "calendar export");
const [popup] = await Promise.all([pg.waitForEvent("popup"), pg.getByRole("button", { name: "Друк A4 / PDF" }).click()]);
ok(/Контент-план/.test(await popup.title()), "A4 print page");
await popup.close();

// Own idea.
await pg.locator(".app-day").last().getByRole("button", { name: "Своя ідея" }).click();
await pg.getByLabel("Про що допис").fill("Прямий ефір про нові аромати");
await pg.getByRole("button", { name: "Додати", exact: true }).click();
ok(await seen(pg.locator(".app-idea", { hasText: "Прямий ефір про нові аромати" })), "own idea added");

// Month.
await pg.getByRole("radio", { name: "Місяць" }).click();
ok(await seen(pg.locator(".app-month-day").first()) && (await pg.locator(".app-month-day").count()) === 42, "month grid");
ok(await pg.waitForFunction(() => document.querySelectorAll(".app-month-dots i").length > 10, null, { timeout: 6000 }).then(() => true, () => false), "ideas as dots in the month");
await pg.screenshot({ path: `${SHOTS}/content-month.png` });

// Promotion.
await pg.getByRole("button", { name: "Акції", exact: true }).click();
await pg.getByLabel("Назва акції").fill("Тиждень ароматів");
await pg.getByLabel("Знижка, %").fill("15");
await pg.getByRole("button", { name: "Додати акцію" }).click();
await pg.getByText("Акцію додано, план оновлено").waitFor();
ok(await seen(pg.getByText("Тиждень ароматів −15%")), "promotion listed");
await pg.getByRole("button", { name: "До плану" }).click();
ok(await seen(pg.locator(".app-marker[data-kind='promo']", { hasText: "Тиждень ароматів" }).first()), "promotion marker in the plan");

// Missed yesterday: «Перенести на сьогодні».
const y = new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
await call("/content/ideas", "POST", { day: y, channel: "instagram", title: "Вчорашній допис", text: "Текст" });
await pg.getByRole("radio", { name: "Тиждень" }).click();
await pg.reload({ waitUntil: "networkidle" });
await nav("Контент");
ok(await seen(pg.getByText(/Не опубліковано минулими днями: \d+/)), "missed ideas banner");
await pg.getByRole("button", { name: "Перенести на сьогодні" }).click();
ok(await seen(pg.locator(".app-day[data-today] .app-idea", { hasText: "Вчорашній допис" })), "moved to today");

// «Що дав контент» and «Як складається план».
await pg.getByRole("button", { name: "Що дав контент" }).click();
ok(await seen(pg.getByText("Чого навчився план")), "«Що дав контент»");
ok(await seen(pg.getByText(/План почне підлаштовуватись після 10/)), "learning waits for 10 published ideas");
await pg.screenshot({ path: `${SHOTS}/content-stats.png`, fullPage: true });
await pg.getByRole("button", { name: "Як складається план" }).click();
ok(await seen(pg.getByText("Що ми не робимо")), "«Як складається план»");
await pg.getByRole("button", { name: "До плану" }).click();

// Home: «Сьогодні запостити».
await nav("Головна");
ok(await seen(pg.getByRole("heading", { name: "Сьогодні запостити" })), "Home card «Сьогодні запостити»");

// Admin: templates and holidays.
await nav("Комунікації");
await pg.getByRole("tab", { name: "Контент-план" }).click();
const counts = await pg.getByText(/Увімкнено: \d+/).innerText();
ok(Number(counts.match(/\d+/)[0]) >= 190, `starter templates (${counts})`);
ok(await seen(pg.getByText("День захисників і захисниць України")), "holidays list");
ok(await seen(pg.getByText("Ритм каналів")), "channel rhythm in the admin");
await pg.screenshot({ path: `${SHOTS}/content-admin.png` });

// Phone: today first.
await pg.setViewportSize({ width: 390, height: 844 });
await nav("Контент").catch(async () => { await pg.getByRole("button", { name: "Ще", exact: true }).click(); await pg.getByRole("button", { name: "Контент", exact: true }).click(); });
await pg.waitForTimeout(500);
await pg.screenshot({ path: `${SHOTS}/content-phone.png` });

cleanupTestData();
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
