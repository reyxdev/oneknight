import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { announcements, users } from "../db/schema.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `ann${Date.now()}`;
const made: string[] = [];

after(async () => {
  if (made.length) await db.delete(announcements).where(inArray(announcements.id, made));
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Ann ${n}`, phone: "+380500000022", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, id: r.json().id as string };
}

test("banner and «Що нового»: the admin writes, everyone sees, a closed banner stays closed, news are marked read", async () => {
  const admin = await register("a");
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
  const user = await register("u");
  const post = (cookie: string, body: object) => app.inject({ method: "POST", url: "/api/announcements", payload: body, headers: { cookie, origin: ORIGIN } });
  assert.equal((await post(user.cookie, { kind: "banner", title: "Нечесно" })).statusCode, 403);
  const banner = await post(admin.cookie, { kind: "banner", title: `Знижка 20% ${tag}`, text: "До неділі", link: "#billing", endsAt: new Date(Date.now() + 86_400_000).toISOString() });
  assert.equal(banner.statusCode, 201);
  made.push(banner.json().id);
  const old = await post(admin.cookie, { kind: "banner", title: "Минула", startsAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), endsAt: new Date(Date.now() - 86_400_000).toISOString() });
  made.push(old.json().id);
  const news = await post(admin.cookie, { kind: "news", title: `Нове: дошка замовлень ${tag}`, text: "Перетягуйте картки" });
  made.push(news.json().id);
  const get = async () => (await app.inject({ url: "/api/announcements", headers: { cookie: user.cookie } })).json();
  const a = await get();
  assert.equal(a.banner.title, `Знижка 20% ${tag}`, "the active banner, not the finished one");
  assert.ok(a.news.some((n: { title: string }) => n.title.includes(tag)));
  assert.ok(a.unread >= 1);
  await app.inject({ method: "POST", url: `/api/announcements/${a.banner.id}/dismiss`, headers: { cookie: user.cookie, origin: ORIGIN } });
  await app.inject({ method: "POST", url: "/api/announcements/seen", headers: { cookie: user.cookie, origin: ORIGIN } });
  const b = await get();
  assert.notEqual(b.banner?.id, a.banner.id, "a closed banner does not come back");
  assert.equal(b.unread, 0);
  const all = (await app.inject({ url: "/api/announcements/all", headers: { cookie: admin.cookie } })).json();
  assert.equal(all.find((x: { id: string }) => x.id === banner.json().id).closed, 1, "the admin sees how many closed it");
});
