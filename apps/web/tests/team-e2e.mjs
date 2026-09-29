// Team: the owner invites a manager by link; the invitee signs up from the link and sees only permitted sections.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";

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
await owner.getByText("Вітаємо").waitFor();
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

cleanupTestData();
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
