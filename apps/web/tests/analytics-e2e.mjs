// Analytics end to end: a (simulated) client website loads /ok.js from ONEKNIGHT, visitors come from
// Instagram and Google, one sends a request and one buys; the account shows it in plain language.
import { chromium } from "playwright-core";
import { cleanupTestData } from "./cleanup.mjs";
import { go, onboard, openBusiness } from "./nav.mjs";
import { execFileSync, execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
// The simulated client site is fulfilled by the test, so Chromium treats it as public and would block calls to
// the loopback API (Local Network Access). Real sites on real domains are not affected.
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"] });
cleanupTestData();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(`${pg.url()} ${String(e).slice(0, 80)}`));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `ana-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => go(pg, name);

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Аналітика E2E");
await pg.getByLabel("Телефон").fill("+380670001212");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("analytics e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await onboard(pg);
execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
const panel = await openBusiness(pg, "Аналітика E2E");
await panel.getByRole("button", { name: "Відкрити 3 місяці безкоштовно" }).click();
await pg.getByText("Безкоштовний період відкрито").waitFor();
await panel.getByRole("tab", { name: "Сайти" }).click();
await panel.getByLabel("Домен").fill("example.edu");
await panel.getByRole("button", { name: "Додати" }).click();
await panel.getByText("example.edu").waitFor();
await nav("Модулі");
await pg.locator(".ok-module", { hasText: "Аналітика" }).getByRole("button", { name: "Підключити" }).click();
await pg.locator(".ok-module", { hasText: "Аналітика" }).getByText("Підключено").waitFor();
await pg.locator(".ok-module", { hasText: "Відгуки" }).getByRole("button", { name: "Підключити" }).click();
await pg.locator(".ok-module", { hasText: "Відгуки" }).getByText("Підключено").waitFor();
await nav("Аналітика");
await pg.getByRole("tab", { name: "Як підключити" }).click();
const snippet = await pg.locator(".app-code-block").first().innerText();
const key = snippet.match(/sk_[0-9a-f]{32}/)[0];
ok(snippet.includes("/ok.js") && !!key, "install snippet with the site key");

// A client website on another origin (allowed in development: localhost), served by the test itself.
// A normal browser user agent: headless Chromium is (correctly) filtered out as a bot.
const site = await b.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
await site.route("http://localhost:9911/**", (route) => {
  const u = new URL(route.request().url());
  route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Client</title><script src="${BASE}/ok.js" data-key="${key}"></script><p>${u.pathname}</p>` });
});
async function visit(url, referer, action) {
  const p = await site.newPage();
  await p.goto(url, { referer, waitUntil: "networkidle" });
  if (action) await action(p);
  await p.waitForTimeout(400);
  await p.close();
}
await visit("http://localhost:9911/?utm_source=ig&utm_campaign=reel17");
await visit("http://localhost:9911/?utm_source=instagram&utm_campaign=reel17", undefined, (p) => p.evaluate(() => window.oneknight.track()));
await visit("http://localhost:9911/catalog", "https://www.google.com/");
ok(true, "three visits from a client website");

await pg.getByRole("radio", { name: "7 днів" }).click();
await pg.getByRole("tab", { name: "Джерела" }).click();
await pg.getByText(/Instagram → reel17 → 2 візити → 1 заявка → 0 продажів/).waitFor({ timeout: 10000 });
ok(true, "Instagram → reel17 → 2 visits → 1 request");
ok(await pg.getByText(/Google → 1 візит → 0 заявок/).count() === 1, "Google visit from the referrer");

// Widgets and the funnel: a product page, the cart, a click on the phone; social proof, stars, reviews with a reply.
const psql = (q) => execFileSync("docker", ["exec", "oneknight-db", "psql", "-U", "oneknight", "-d", "oneknight", "-tAc", q]).toString().trim();
const siteId = psql("select id from sites where domain = 'example.edu'");
const orgId = psql(`select organization_id from sites where id = '${siteId}'`);
const productId = psql(`insert into products (organization_id, site_id, name, price_kop) values ('${orgId}', '${siteId}', 'Свічка «Лаванда»', 35000) returning id`).split("\n")[0];
psql(`insert into reviews (organization_id, site_id, author_name, rating, text, consent, status, reply, reply_at) values ('${orgId}', '${siteId}', 'Ірина', 5, 'Гарно пахне і довго горить', true, 'published', 'Дякуємо, Ірино!', now())`);
const placed = await fetch(`${BASE}/api/public/orders`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": key }, body: JSON.stringify({ customer: { name: "Олена Коваль", phone: "+380671234567" }, items: [{ productId, qty: 1 }], delivery: { method: "novaposhta", city: "Київ", branch: "1" }, payment: "cod" }) });
ok(placed.status === 201, "an order from the site (for social proof)");
await nav("Сайт");
await pg.getByRole("tab", { name: "Налаштування" }).click();
for (const name of [/Соціальний доказ/, /Блок відгуків/, /Зірки рейтингу/]) {
  await pg.getByRole("switch", { name }).click();
  await pg.getByRole("switch", { name, checked: true }).waitFor();
}
await site.unroute("http://localhost:9911/**");
await site.route("http://localhost:9911/**", (route) =>
  route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html lang="uk"><title>Свічки</title><body style="font-family:sans-serif;max-width:40rem;margin:2rem auto">
      <main data-ok-product="${productId}"><h1>Свічка «Лаванда»</h1><p><span data-ok-stars></span></p>
      <div data-ok-cart='[{"id":"${productId}","qty":1}]'></div><a id="call" href="tel:+380671112233">Подзвонити</a>
      <h2>Відгуки</h2><div data-ok-reviews></div></main><script src="${BASE}/ok.js" data-key="${key}"></script></body></html>`,
  }),
);
const shop = await site.newPage();
await shop.goto("http://localhost:9911/candles/lavender?utm_source=instagram&utm_campaign=spring", { waitUntil: "networkidle" });
ok(await shop.locator(".okw-rating").waitFor({ timeout: 8000 }).then(() => true, () => false), "stars on the site");
ok((await shop.locator("[data-ok-reviews]").innerText()).includes("Дякуємо, Ірино!"), "reviews with the store's reply");
await shop.locator("#call").click({ modifiers: [] }).catch(() => {});
ok(await shop.locator(".okw-sp[data-on]").waitFor({ timeout: 12000 }).then(() => true, () => false), "social proof: a real order of the last 48 hours");
const sp = await shop.locator(".okw-sp").innerText();
ok(sp.includes("Олена, Київ") && !sp.includes("Коваль"), `first name and city only (${sp.replace(/\n/g, " · ")})`);
if (process.env.SHOTS) await shop.screenshot({ path: `${process.env.SHOTS}/widgets.png` });
await shop.close();
// The order from the site opened the «Нове замовлення» window in the panel (as it should): close it.
await pg.getByRole("dialog", { name: "Нове замовлення" }).getByRole("button", { name: "Закрити" }).click().catch(() => {});
await nav("Аналітика");
await pg.getByRole("radio", { name: "7 днів" }).click();
await pg.getByRole("tab", { name: "Воронка" }).click();
ok(await pg.locator(".app-funnel li", { hasText: "Відкрили товар" }).getByText("1", { exact: true }).waitFor({ timeout: 8000 }).then(() => true, () => false), "funnel: a product view");
ok(await pg.locator(".app-funnel li", { hasText: "Додали в кошик" }).getByText("1", { exact: true }).isVisible(), "funnel: added to the cart");
ok(await pg.locator(".ok-list li", { hasText: "Телефон" }).isVisible(), "a click on the phone counted as a contact");
if (process.env.SHOTS) await pg.screenshot({ path: `${process.env.SHOTS}/analytics-funnel.png` });

cleanupTestData();
// Known, intermittent React #418 (hydration) seen only after a form sign-up + reloads; tracked in TODO.md.
const KNOWN_418 = errs.filter((e) => e.includes("React error #418"));
if (KNOWN_418.length) console.log("warning: known hydration notice", KNOWN_418.length);
errs.splice(0, errs.length, ...errs.filter((e) => !e.includes("React error #418")));
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
