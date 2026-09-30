// First login: four questions without skipping, advice from the answers, «Почати пробний період», the trial
// counter, and the «Приклад» orders that count nowhere and can be removed.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";

const BASE = process.env.BASE ?? "http://localhost:8080";
const SHOTS = process.env.SHOTS;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 5000) => loc.waitFor({ timeout }).then(() => true, () => false);

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Перший E2E");
await pg.getByLabel("Телефон").fill("+380670004455");
await pg.getByLabel("Електронна пошта").fill(`onb-e2e${Date.now()}@test.oneknight.local`);
await pg.getByLabel("Пароль", { exact: true }).fill("first login pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
ok(await seen(pg.getByRole("heading", { name: "Перший E2E, кілька питань про ваш бізнес" })), "questions come right after sign-up");
ok(!(await pg.getByRole("button", { name: /Пропустити/ }).count()), "no «Пропустити»");
const q = (legend) => pg.locator("fieldset", { hasText: legend });
await pg.getByRole("button", { name: "Далі", exact: true }).click();
ok(await seen(pg.getByText("Дайте відповідь: «Сайт уже є?»")), "an unanswered question is named");
await q("Сайт уже є?").getByRole("button", { name: "Так", exact: true }).click();
await q("Що продаєте?").getByRole("button", { name: "Інше" }).click();
await q("Як доставляєте?").getByRole("button", { name: "Нова пошта" }).click();
await q("Де ще продаєте?").getByRole("button", { name: "Prom" }).click();
await pg.getByRole("button", { name: "Далі", exact: true }).click();
ok(await seen(pg.getByText("Дайте відповідь: «Що саме?»")), "«Інше» asks what exactly");
await pg.getByLabel("Що саме?").fill("Свічки");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/onboarding-questions.png`, fullPage: true });
await pg.getByRole("button", { name: "Далі", exact: true }).click();

ok(await seen(pg.getByRole("heading", { name: "Що радимо" })), "advice after the answers");
const recs = await pg.locator(".app-recs li").allInnerTexts();
ok(recs.some((r) => r.includes("Нова пошта")) && recs.some((r) => r.includes("Prom")) && recs.some((r) => r.includes("Аналітика")), `modules follow the answers (${recs.length})`);
ok(await pg.getByRole("button", { name: "До розділу «Сайт»" }).isVisible(), "has a website: the way to connect it");
ok(await seen(pg.getByText("Пробний період почався: 30 днів.")), "the 30-day trial started by itself");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/onboarding-advice.png`, fullPage: true });
await pg.getByRole("button", { name: "Перейти в кабінет" }).click();
await pg.getByText("Вітаємо").waitFor();
ok(await seen(pg.getByRole("button", { name: /Пробний: (30|29) дн\./ })), "trial counter in the top bar");

await pg.locator(".ok-side").getByRole("button", { name: "Замовлення", exact: true }).click();
ok((await pg.locator(".app-example-pill").count()) === 3, "three orders marked «Приклад»");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/examples.png` });
await pg.getByRole("button", { name: "Прибрати приклад" }).click();
ok(await seen(pg.getByText("Замовлень поки немає", { exact: false })), "«Прибрати приклад» removes them");
await pg.reload({ waitUntil: "networkidle" });
ok(await seen(pg.getByText("Вітаємо")) || (await pg.locator(".ok-h h3").count()) > 0, "no questions again after answering");

// Referral link: another person signs up through it and appears in the list.
await pg.locator(".ok-side").getByRole("button", { name: "Мій профіль", exact: true }).click();
await pg.getByRole("tab", { name: "Реферали" }).click();
const refLink = (await pg.locator(".app-ref code").innerText()).trim();
ok(/\/app\/\?start=register&ref=[A-Z0-9]{8}$/.test(refLink), "personal referral link");
const other = await (await b.newContext()).newPage();
await other.goto(refLink, { waitUntil: "networkidle" });
await other.getByLabel("Ім'я").fill("Запрошена Людина");
await other.getByLabel("Телефон").fill("+380670004466");
await other.getByLabel("Електронна пошта").fill(`onb-ref${Date.now()}@test.oneknight.local`);
await other.getByLabel("Пароль", { exact: true }).fill("invited person pass");
await other.getByRole("button", { name: "Створити акаунт" }).click();
await other.getByRole("heading", { name: /кілька питань/ }).waitFor();
await pg.reload({ waitUntil: "networkidle" });
await pg.getByRole("tab", { name: "Реферали" }).click();
ok(await seen(pg.locator(".ok-list li", { hasText: "Запрошена" }).getByText("чекає першої оплати")), "the invited person is in the list, first name only");

errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs.join("\n") : "none");
await b.close();
cleanupTestData();
process.exit(failed || errs.length ? 1 : 0);
