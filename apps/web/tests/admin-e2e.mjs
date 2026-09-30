// Admin: «Огляд» with to-do and numbers, the leads funnel board with notes, «Почати проєкт» with an invitation
// link, the client joins and approves a stage in «Послуги», Ivan launches the website.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard } from "./nav.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const SHOTS = process.env.SHOTS;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const errs = [];
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const seen = (loc, timeout = 6000) => loc.waitFor({ timeout }).then(() => true, () => false);
const stamp = Date.now();
const psql = (q) => execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -tAc "${q}"`).toString().trim();

async function signUp(pg, name, phone, email) {
  pg.on("pageerror", (e) => { if (!String(e).includes("#418")) errs.push(`${pg.url()} ${String(e).slice(0, 80)}`); });
  await pg.getByLabel("Ім'я").fill(name);
  await pg.getByLabel("Телефон").fill(phone);
  await pg.getByLabel("Електронна пошта").fill(email);
  await pg.getByLabel("Пароль").fill("admin e2e pass");
  await pg.getByRole("button", { name: "Створити акаунт" }).click();
  await onboard(pg);
}

// A lead from the public site, without an account.
const lead = await fetch(`${BASE}/api/leads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service: "website", siteType: "shop", business: `Свічки E2E ${stamp}`, about: "Продаю свічки в Instagram", name: "Олена E2E", phone: "+380671119900", locale: "uk" }) });
ok(lead.status === 201, "a lead from the site");
const leadNo = (await lead.json()).number;

const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
const adminEmail = `admin-e2e${stamp}@test.oneknight.local`;
await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await signUp(pg, "Адмін E2E", "+380670007793", adminEmail);
execSync(`npm run -s admin:grant -w @oneknight/api -- ${adminEmail}`);
await pg.reload({ waitUntil: "networkidle" });
await go(pg, "Огляд");
ok(await seen(pg.getByText(/Нові заявки: \d+|Заявки без відповіді понад 4 робочі години: \d+/)), "«Огляд»: leads in the to-do");
ok(await seen(pg.getByText("Списано за 30 днів")), "«Огляд»: the numbers");
ok(await seen(pg.getByText(/Ризик відтоку \(\d+\)/)), "«Огляд»: churn risk");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/admin-overview.png` });

// The funnel: open the lead, a note, «Зв'язались», «Почати проєкт».
await go(pg, "Заявки");
const card = pg.locator(".app-card", { hasText: "Олена E2E" });
await card.click();
const lc = pg.locator(".ok-detail");
ok(await seen(lc.getByText("Продаю свічки в Instagram")), "the brief in the card");
await lc.getByLabel("Нотатка").fill("Хоче каталог на 40 товарів");
await lc.getByRole("button", { name: "Додати", exact: true }).click();
ok(await seen(lc.getByText("Хоче каталог на 40 товарів")), "a note");
await lc.getByLabel("Етап").selectOption("contacted");
ok(await seen(pg.getByRole("listitem", { name: "Зв'язались" }).locator(".app-card", { hasText: "Олена E2E" })), "moved to «Зв'язались»");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/admin-leads.png` });
await lc.getByRole("button", { name: "Почати проєкт" }).click();
const inviteInput = lc.getByLabel("Посилання-запрошення в панель");
ok(await seen(inviteInput), "an invitation link for a client without an account");
const invite = await inviteInput.inputValue();
ok(psql(`select status from leads where number = ${leadNo}`) === "in_work", "the lead is «В роботі»");

// The project: domain, deadline, a payment mark, a checklist item, «На погодження».
await go(pg, "Проєкти");
await pg.locator(".app-card", { hasText: `Свічки E2E ${stamp}` }).click();
const pc = pg.locator(".ok-detail");
await pc.getByLabel("Домен сайту").fill(`svichky${stamp}.com.ua`);
await pc.getByLabel("Сума, грн").first().fill("12000");
await pc.getByRole("button", { name: "Додати оплату" }).click();
await pc.getByLabel("За що (напр. Передоплата 50%)").fill("Передоплата 50%");
await pc.locator(".app-pay-row input[inputmode=decimal]").fill("6000");
await pc.locator(".app-pay-row input[type=checkbox]").check();
await pc.getByRole("button", { name: "Зберегти", exact: true }).click();
ok(await seen(pg.getByText("Збережено").first()), "project details saved");
await pc.getByLabel("Новий пункт (напр. Логотип у PNG)").fill("Логотип у PNG");
await pc.getByRole("button", { name: "Додати", exact: true }).click();
ok(await seen(pc.getByText("Логотип у PNG")), "a checklist item");
await pc.getByRole("button", { name: "На погодження" }).click();
ok(await seen(pg.getByText("Клієнт отримав прохання погодити етап")), "«На погодження»");

// The client joins with the link and approves the brief in «Послуги».
const cctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const cp = await cctx.newPage();
await cp.goto(invite, { waitUntil: "networkidle" });
await signUp(cp, "Олена E2E", "+380670007794", `client-e2e${stamp}@test.oneknight.local`);
ok(await seen(cp.getByText("Проєкт додано в «Послуги»")), "the client joined the project by the link");
const proj = cp.locator(".okp", { hasText: `Свічки E2E ${stamp}` });
ok(await seen(proj.getByText("Етап «Бриф» готовий")), "the client sees the stage to approve");
ok(await seen(proj.getByText("Передоплата 50%")), "the client sees the payment marks (no payment details)");
if (SHOTS) {
  await cp.waitForTimeout(400);
  await cp.screenshot({ path: `${SHOTS}/client-project.png`, fullPage: true });
}
await proj.getByRole("button", { name: "Погодити" }).click();
ok(await seen(proj.getByText("Працюємо над етапом «Дизайн»")), "approved: the next stage");
await proj.getByRole("checkbox", { name: "Логотип у PNG" }).click();
ok(await seen(proj.getByRole("checkbox", { name: "Логотип у PNG", checked: true })), "the client marks a checklist item done");

// Ivan launches the website: it is in the client's «Сайт», ONEKNIGHT opens for 3 months.
await pg.reload({ waitUntil: "networkidle" });
await pg.locator(".app-card", { hasText: `Свічки E2E ${stamp}` }).click();
if (SHOTS) {
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${SHOTS}/admin-project.png` });
}
await pg.locator(".ok-detail").getByRole("button", { name: "Запустити сайт" }).click();
ok(await seen(pg.getByText("Сайт запущено: клієнту відкрито 3 місяці ONEKNIGHT")), "launched");
ok(psql(`select count(*) from sites where domain = 'svichky${stamp}.com.ua'`) === "1", "the website is in the client's «Сайт»");

ok(errs.length === 0, `no page errors ${errs.join(" | ")}`);
psql(`delete from projects where title = 'Свічки E2E ${stamp}'`);
psql(`delete from leads where number = ${leadNo}`);
cleanupTestData();
await b.close();
process.exit(failed ? 1 : 0);
