// Team: the owner invites a manager by link; the invitee signs up from the link and sees only permitted sections.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { onboard } from "./nav.mjs";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const errs = [];
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const stamp = Date.now();

async function signup(ctx, url, name, email) {
  const pg = await ctx.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
  await pg.goto(url, { waitUntil: "networkidle" });
  if (await pg.getByRole("tab", { name: "Реєстрація" }).count()) await pg.getByRole("tab", { name: "Реєстрація" }).click();
  await pg.getByLabel("Ім'я").fill(name);
  await pg.getByLabel("Телефон").fill("+380670002323");
  await pg.getByLabel("Електронна пошта").fill(email);
  await pg.getByLabel("Пароль").fill("team e2e pass");
  await pg.getByRole("button", { name: "Створити акаунт" }).click();
  return pg;
}
const navBtn = (pg, name) => pg.locator(".ok-side nav").getByRole("button", { name, exact: true });

const owner = await signup(await b.newContext(), `${BASE}/app/?start=register`, "Власник E2E", `team-o${stamp}@test.oneknight.local`);
await onboard(owner);
await navBtn(owner, "Команда").click();
await owner.getByLabel("Роль").selectOption("manager");
await owner.getByRole("group", { name: "Права" }).getByRole("button", { name: "Товари" }).click(); // remove products from the default set
await owner.getByRole("button", { name: "Створити посилання" }).click();
const link = (await owner.locator(".ok-topup code").innerText()).trim();
ok(/\/app\/\?invite=/.test(link), "owner creates an invitation link");

const mgrCtx = await b.newContext();
const mgr = await signup(mgrCtx, link, "Менеджер E2E", `team-m${stamp}@test.oneknight.local`);
ok(await mgr.getByText("Ви приєдналися до «Власник E2E»").waitFor({ timeout: 10000 }).then(() => true, () => false), "invitee joins the owner's business");
await mgr.reload({ waitUntil: "networkidle" });
ok(await navBtn(mgr, "Замовлення").isVisible() && !(await navBtn(mgr, "Товари").isVisible()) && !(await navBtn(mgr, "Оплата").isVisible()), "manager sees orders but not products or billing");
ok(await mgr.locator(".ok-top select").count() === 1, "business switcher appears for two businesses");

await owner.reload({ waitUntil: "networkidle" });
await navBtn(owner, "Команда").click();
await owner.getByRole("checkbox", { name: "Менеджер E2E: Товари" }).check();
await owner.getByText("Права оновлено").waitFor();
await mgr.reload({ waitUntil: "networkidle" });
ok(await navBtn(mgr, "Товари").isVisible(), "granted permission appears for the manager");

// «Комплектувальник»: shipping only, no money.
await navBtn(owner, "Команда").click();
await owner.getByLabel("Роль").selectOption("packer");
ok(await owner.getByRole("group", { name: "Права" }).getByRole("button", { name: "Відправка", pressed: true }).isVisible(), "the packer role preselects «Відправка»");
ok(await owner.getByRole("group", { name: "Права" }).getByRole("button", { name: "Бачить фінанси", pressed: false }).isVisible(), "finances are off by default");
await owner.getByRole("button", { name: "Створити посилання" }).click();
const packLink = (await owner.locator(".ok-topup code").innerText()).trim();
const pack = await signup(await b.newContext(), packLink, "Комплектувальник E2E", `team-p${stamp}@test.oneknight.local`);
await pack.getByText("Ви приєдналися до «Власник E2E»").waitFor({ timeout: 10000 });
await pack.reload({ waitUntil: "networkidle" });
ok(await navBtn(pack, "Замовлення").isVisible() && !(await navBtn(pack, "Товари").isVisible()) && !(await navBtn(pack, "Аналітика").isVisible()), "packer sees only orders");
ok(await pack.getByText("Відправити сьогодні").isVisible() && !(await pack.locator(".ok-home-stats").count()), "packer Home: sending, no sales numbers");
await navBtn(pack, "Замовлення").click();
ok(await pack.getByRole("button", { name: "Без ТТН" }).isVisible() && !(await pack.getByRole("button", { name: "Нові", exact: true }).count()), "packer filters: only orders to send");

// «Журнал дій»: the owner sees who did what. «Вимагати 2FA»: the owner needs it first; then a member without it
// is asked to turn it on before seeing anything.
await navBtn(owner, "Команда").click();
const log = owner.locator(".okp", { hasText: "Журнал дій" });
ok(await log.getByText(/Менеджер E2E\s+приєднався\(лася\) до команди/).waitFor({ timeout: 5000 }).then(() => true, () => false), "the activity log names who did what");
await owner.getByRole("switch", { name: "Вимагати 2FA від усієї команди" }).click();
ok(await owner.getByText("Спершу ввімкніть 2FA собі").waitFor({ timeout: 5000 }).then(() => true, () => false), "the owner needs 2FA before requiring it");
execFileSync("docker", ["exec", "oneknight-db", "psql", "-U", "oneknight", "-d", "oneknight", "-tAc", `update users set totp_enabled = true where email = 'team-o${stamp}@test.oneknight.local'`]);
await owner.getByRole("switch", { name: "Вимагати 2FA від усієї команди" }).click();
ok(await owner.getByText("Тепер 2FA обов'язкова для всіх").waitFor({ timeout: 5000 }).then(() => true, () => false), "2FA required for the team");
await mgr.reload({ waitUntil: "networkidle" });
ok(await mgr.getByRole("heading", { name: "Потрібна 2FA" }).or(mgr.getByText("Потрібна 2FA")).first().waitFor({ timeout: 8000 }).then(() => true, () => false), "a member without 2FA is asked to turn it on");
if (process.env.SHOTS) await mgr.screenshot({ path: `${process.env.SHOTS}/need-2fa.png` });
await mgr.getByRole("button", { name: "Увімкнути 2FA" }).click();
ok(await mgr.getByRole("tab", { name: "Безпека", selected: true }).waitFor({ timeout: 5000 }).then(() => true, () => false), "straight to «Безпека»");
if (process.env.SHOTS) {
  await navBtn(owner, "Команда").click();
  await owner.waitForTimeout(500);
  await owner.screenshot({ path: `${process.env.SHOTS}/team-log.png`, fullPage: true });
}

cleanupTestData();
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
