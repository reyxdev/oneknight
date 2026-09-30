import { test, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { notifications, sites } from "../db/schema.ts";
import { monthlyKop } from "../billing/service.ts";
import { auditPage, runAudit, verifySite } from "./audit.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `ver${Date.now()}`;

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

/** A fake website: path → [status, body, headers]; everything else is 404. */
function fakeSite(pages: Record<string, [number, string, Record<string, string>?]>) {
  return (async (url: string, opts: { method?: string }) => {
    const u = new URL(url);
    const key = u.protocol === "http:" ? "http" : u.pathname;
    const [status, body, headers] = pages[key] ?? [404, "not found"];
    return { status, headers: new Headers(headers ?? {}), body: Buffer.from(opts.method === "HEAD" ? "" : body), url: key === "http" ? `https://${u.host}/` : url, ms: 120, redirects: 0 };
  }) as unknown as Parameters<typeof verifySite>[1];
}

test("the client adds a website, ok.js confirms it, only confirmed ones are charged, the weekly quality check", async () => {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Ver", phone: "+380500000091", email: `${tag}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  const H = { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, origin: ORIGIN };
  const org = r.json().organizations[0].id as string;
  const add = (domain: string) => app.inject({ method: "POST", url: "/api/sites", payload: { domain }, headers: H });

  assert.equal((await add("localhost")).json().error, "invalid_domain");
  const a = await add(`https://${tag}.com.ua/`);
  assert.equal(a.statusCode, 201);
  assert.equal((await add(`${tag}.com.ua`)).json().error, "domain_taken");
  const b = (await add(`${tag}-2.com.ua`)).json();
  assert.equal((await monthlyKop(org)).parts.extraSites, 0, "unconfirmed sites are not charged");

  // ok.js with the key on the page → confirmed.
  const [s1] = await db.select().from(sites).where(eq(sites.id, a.json().id));
  assert.equal(await verifySite(s1!, fakeSite({ "/": [200, "<html><body>no script</body></html>"] })), false);
  assert.equal(await verifySite(s1!, fakeSite({ "/": [200, `<script src="https://oneknight.pro/ok.js" data-key="${s1!.publicKey}" defer></script>`] })), true);
  const [s2] = await db.select().from(sites).where(eq(sites.id, b.id));
  await verifySite(s2!, fakeSite({ "/": [200, `<script data-key="${s2!.publicKey}"></script>`] }));
  assert.equal((await monthlyKop(org)).parts.extraSites, 1, "the second confirmed site is +149");

  // A confirmed site stays (orders, products); an unconfirmed one can be removed.
  assert.equal((await app.inject({ method: "DELETE", url: `/api/sites/${a.json().id}`, headers: H })).json().error, "verified");
  const c = (await add(`${tag}-3.com.ua`)).json();
  assert.equal((await app.inject({ method: "DELETE", url: `/api/sites/${c.id}`, headers: H })).statusCode, 200);

  // Settings.
  const set = await app.inject({ method: "PATCH", url: `/api/sites/${a.json().id}`, payload: { settings: { socialProof: true, poweredBy: true } }, headers: H });
  assert.deepEqual(set.json().settings, { socialProof: true, poweredBy: true });

  // The quality check from the page itself.
  const good = `<!doctype html><html lang="uk"><head><title>Свічки ручної роботи — Карпати</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Соєві свічки ручної роботи з Карпат: лаванда, хвоя, мед. Доставка Новою поштою по Україні."><link rel="canonical" href="https://x/"><meta property="og:image" content="/og.jpg"></head>
    <body><h1>Свічки</h1><img src="/a.jpg" alt="Свічка"><img src="/b.jpg"><a href="/catalog">Каталог</a><a href="/old">Старе</a><a href="https://instagram.com/x">IG</a><a href="tel:+380">Дзвінок</a></body></html>`;
  const site = fakeSite({ "/": [200, good, { "content-encoding": "br" }], "/catalog": [200, "ok"], "/robots.txt": [200, "Sitemap: https://x/sitemap.xml"], "/sitemap.xml": [200, "<urlset/>"], http: [200, ""] });
  const checks = await auditPage(`${tag}.com.ua`, site);
  const byId = Object.fromEntries(checks.map((x) => [x.id, x]));
  assert.deepEqual(
    ["viewport", "title", "description", "h1", "lang", "canonical", "ogImage", "robots", "sitemap", "https", "compression"].map((k) => byId[k]!.ok),
    Array(11).fill(true),
  );
  assert.deepEqual([byId.alt!.ok, byId.alt!.value, byId.broken!.ok, byId.broken!.items], [false, 1, false, ["/old"]], "an image without alt, a broken link");

  // Unquoted attributes are valid HTML.
  const bare = await auditPage(`${tag}.com.ua`, fakeSite({ "/": [200, "<!doctype html><html lang=en><head><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Example Domain page</title></head><body><p>x</p></body></html>"] }));
  assert.deepEqual(["viewport", "lang", "h1"].map((k) => bare.find((x) => x.id === k)!.ok), [true, true, false]);

  const first = await runAudit({ id: a.json().id, domain: `${tag}.com.ua`, organizationId: org }, site);
  assert.equal(first.passed, first.total - 2);
  await runAudit({ id: a.json().id, domain: `${tag}.com.ua`, organizationId: org }, site);
  const bell = await db.select().from(notifications).where(and(eq(notifications.organizationId, org), eq(notifications.key, "auditDone")));
  assert.equal(bell.length, 1, "the bell only when there is something new to fix");
  const view = (await app.inject({ url: `/api/sites/${a.json().id}/audit`, headers: H })).json();
  assert.deepEqual([view.history.length, view.last.passed], [2, first.passed]);
});
