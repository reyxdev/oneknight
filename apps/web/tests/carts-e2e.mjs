// Unfinished carts: the real ok.js on a "client website" sends the cart once the phone is typed, 2 hours later
// the cart is on Home and in «Замовлення → Незавершені кошики», the team places the order from it.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard } from "./nav.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
const SHOTS = process.env.SHOTS;
const DOMAIN = "carts.example.net";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => { if (!String(e).includes("#418")) errs.push(`${pg.url()} ${String(e).slice(0, 80)}`); });
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `carts-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => go(pg, name);
const psql = (q) => execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -tAc "${q}"`).toString().trim();

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Кошики E2E");
await pg.getByLabel("Телефон").fill("+380670007791");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("carts e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await onboard(pg);

execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await nav("Бізнеси");
const panel = pg.locator(".okp", { hasText: "Кошики E2E" }).first();
await panel.getByLabel("Домен").fill(DOMAIN);
await panel.getByRole("button", { name: "Додати" }).click();
await panel.getByText(DOMAIN).waitFor();
await nav("Товари");
await pg.getByRole("button", { name: "Додати товар" }).click();
await pg.getByLabel("Назва", { exact: true }).fill("Свічка «Лаванда»");
await pg.getByLabel("Ціна, грн", { exact: true }).fill("350");
await pg.getByRole("button", { name: "Зберегти" }).click();
await pg.locator(".app-table tbody tr", { hasText: "Свічка «Лаванда»" }).waitFor();
await nav("Сайт");
const key = (await pg.locator(".app-key").first().innerText()).trim();
const [product] = await (await fetch(`${BASE}/api/public/products`, { headers: { "x-site-key": key } })).json();

// The client's checkout page with ok.js: a marked phone field and the cart in an attribute.
// A normal browser: headless ones are ignored as bots.
const shop = await b.newPage({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" });
await shop.route(`${BASE}/test-checkout.html`, (r) =>
  r.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><script src="${BASE}/ok.js" data-key="${key}" defer></script>
      <div data-ok-cart='[{"id":"${product.id}","qty":2}]'>Кошик</div>
      <input id="name" data-ok-name><input id="phone" type="tel" data-ok-phone>
      <small>Залишаючи номер, ви погоджуєтесь, що з вами зв'яжуться щодо замовлення.</small>`,
  }),
);
await shop.goto(`${BASE}/test-checkout.html`, { waitUntil: "networkidle" });
await shop.locator("#name").fill("Ірина");
await shop.locator("#phone").pressSequentially("067 555 44 33");
await shop.waitForTimeout(1500);
const stored = psql(`select phone || '|' || total_kop from carts c join sites s on s.id = c.site_id where s.domain = '${DOMAIN}'`);
ok(stored === "+380675554433|70000", `ok.js sent the cart with catalogue prices (${stored})`);

// 2 hours later without an order.
psql(`update carts set updated_at = now() - interval '3 hours' where phone = '+380675554433'`);
await nav("Головна");
const todo = pg.getByRole("button", { name: /Незавершених кошиків чекають дзвінка: 1/ });
ok(await todo.waitFor({ timeout: 8000 }).then(() => true, () => false), "Home: «Незавершених кошиків чекають дзвінка: 1»");
await todo.click();
await pg.getByRole("tab", { name: /Незавершені кошики/, selected: true }).waitFor();
const row = pg.locator("tr", { hasText: "Ірина" });
ok(await row.waitFor({ timeout: 5000 }).then(() => true, () => false), "the cart is in the list for a call");
await row.click();
const detail = pg.locator(".ok-detail");
ok(await detail.getByRole("link", { name: "Viber" }).isVisible(), "call / Viber / Telegram / WhatsApp next to the phone");
if (SHOTS) {
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${SHOTS}/carts-list.png` });
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: `${SHOTS}/carts-phone.png` });
  await pg.setViewportSize({ width: 1280, height: 900 });
}

await detail.getByRole("button", { name: "Не додзвонились" }).click();
await pg.getByText("Нагадаємо передзвонити через 2 години").waitFor();
ok(await row.getByText(/Передзвонити/).isVisible(), "«Не додзвонились» → call again in 2 hours");

await detail.getByRole("button", { name: "Оформити замовлення" }).click();
ok((await detail.getByLabel("Телефон").inputValue()).replace(/\D/g, "") === "380675554433", "the form starts with the buyer and the cart");
ok(await detail.getByText("Незавершений кошик").isVisible(), "source: «Незавершений кошик»");
await detail.getByLabel("Місто").fill("Київ");
await detail.getByRole("button", { name: "Створити замовлення" }).click();
await pg.getByText(/Замовлення №\d+ створено/).first().waitFor();
ok(await pg.getByRole("tab", { name: "Замовлення", selected: true }).isVisible(), "back in «Замовлення» with the new order open");
ok(psql(`select recovered from carts where phone = '+380675554433'`) === "t", "the cart counts as won back");

await pg.getByRole("tab", { name: /Незавершені кошики/ }).click();
await pg.getByRole("button", { name: "Оформлені" }).click();
ok(await pg.locator("tr", { hasText: "Ірина" }).getByText("Повернули дзвінком").waitFor({ timeout: 5000 }).then(() => true, () => false), "«Оформлені»: won back by a call");
await pg.waitForTimeout(300);
ok(await pg.getByText(/повернули дзвінком 1/).isVisible(), "stats: won back 1");
if (SHOTS) await pg.screenshot({ path: `${SHOTS}/carts-ordered.png` });

ok(errs.length === 0, `no page errors ${errs.join(" | ")}`);
cleanupTestData();
await b.close();
process.exit(failed ? 1 : 0);
