// Analytics end to end: a (simulated) client website loads /ok.js from ONEKNIGHT, visitors come from
// Instagram and Google, one sends a request and one buys; the account shows it in plain language.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8080";
// The simulated client site is fulfilled by the test, so Chromium treats it as public and would block calls to
// the loopback API (Local Network Access). Real sites on real domains are not affected.
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox", "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
let failed = false;
const ok = (c, msg) => { if (!c) failed = true; console.log(c ? "PASS" : "FAIL", msg); };
const email = `ana-e2e${Date.now()}@test.oneknight.local`;
const nav = (name) => pg.locator(".ok-side nav").getByRole("button", { name, exact: true }).click();

await pg.goto(`${BASE}/app/?start=register`, { waitUntil: "networkidle" });
await pg.getByLabel("Ім'я").fill("Аналітика E2E");
await pg.getByLabel("Телефон").fill("+380670001212");
await pg.getByLabel("Електронна пошта").fill(email);
await pg.getByLabel("Пароль").fill("analytics e2e pass");
await pg.getByRole("button", { name: "Створити акаунт" }).click();
await pg.getByText("Вітаємо").waitFor();
execSync(`npm run -s admin:grant -w @oneknight/api -- ${email}`);
await pg.reload({ waitUntil: "networkidle" });
await nav("Клієнти й сайти");
const panel = pg.locator(".okp", { hasText: "Аналітика E2E" }).first();
await panel.getByRole("button", { name: "Відкрити 3 місяці безкоштовно" }).click();
await pg.getByText("Безкоштовний період відкрито").waitFor();
await panel.getByLabel("Домен").fill("example.edu");
await panel.getByRole("button", { name: "Додати" }).click();
await panel.getByText("example.edu").waitFor();
await nav("Модулі");
await pg.locator(".ok-module", { hasText: "Аналітика" }).getByRole("button", { name: "Підключити" }).click();
await pg.locator(".ok-module", { hasText: "Аналітика" }).getByText("Підключено").waitFor();
await nav("Аналітика");
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
await pg.getByText(/Instagram → reel17 → 2 візити → 1 заявка → 0 продажів/).waitFor({ timeout: 10000 });
ok(true, "Instagram → reel17 → 2 visits → 1 request");
ok(await pg.getByText(/Google → 1 візит → 0 заявок/).count() === 1, "Google visit from the referrer");

execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -qc "delete from organizations where id in (select organization_id from memberships m join users u on u.id=m.user_id where u.email='${email}'); delete from users where email='${email}'; delete from login_events where email_attempted='${email}';"`);
console.log("errors:", errs.length ? errs : "none");
if (errs.length || failed) process.exitCode = 1;
await b.close();
