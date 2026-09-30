import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { leads, notifications, projects, sites, subscriptions, users } from "../db/schema.ts";
import { runAdminReminders } from "./routes.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `proj${Date.now()}`;
const DAY = 86_400_000;
const madeLeads: string[] = [];

after(async () => {
  for (const id of madeLeads) await db.delete(leads).where(eq(leads.id, id));
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Proj ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, id: r.json().id as string, org: r.json().organizations[0].id as string };
}

test("leads funnel and a website project: invitation, stages approved by the client, changes, checklist, launch", async () => {
  const admin = await register("a", "+380500000061");
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
  const A = { cookie: admin.cookie, origin: ORIGIN };
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, cookie = admin.cookie) => app.inject({ method, url, payload, headers: { cookie, origin: ORIGIN } });

  // A lead from the public site (no account), 2 days old: late, reported once.
  const [lead] = await db.insert(leads).values({ name: `Олена ${tag}`, phone: "+380671230000", service: "website", siteType: "shop", brief: { business: "Свічки ручної роботи" }, source: "site", locale: "uk", createdAt: new Date(Date.now() - 5 * DAY) }).returning();
  madeLeads.push(lead!.id);
  const sent: string[] = [];
  const send = async (t: string) => (sent.push(t), true);
  await runAdminReminders(console, new Date(), send);
  await runAdminReminders(console, new Date(), send);
  assert.equal(sent.filter((t) => t.includes(`#${lead!.number}`)).length, 1, "late lead reported once");
  assert.ok((await call("GET", "/api/admin/leads")).json().find((l: { id: string }) => l.id === lead!.id).late);

  // Funnel, a note, a reminder that comes due.
  assert.equal((await call("PATCH", `/api/admin/leads/${lead!.id}`, { status: "contacted", remindAt: new Date(Date.now() - 1000).toISOString(), remindText: "Надіслати КП" })).json().status, "contacted");
  await call("POST", `/api/admin/leads/${lead!.id}/notes`, { text: "Хоче каталог на 40 товарів" });
  assert.equal((await call("GET", `/api/admin/leads/${lead!.id}/notes`)).json()[0].text, "Хоче каталог на 40 товарів");
  await runAdminReminders(console, new Date(), send);
  assert.ok(sent.some((t) => t.includes("Надіслати КП")));

  // «Почати проєкт»: the lead has no account → an invitation link.
  const started = (await call("POST", `/api/admin/leads/${lead!.id}/project`)).json();
  assert.ok(started.invite && started.number >= 101);
  assert.equal((await call("POST", `/api/admin/leads/${lead!.id}/project`)).statusCode, 409, "one project per lead");
  const pid = started.id as string;
  await call("PATCH", `/api/admin/projects/${pid}`, { domain: `https://${tag}.shop.com.ua/`, deadline: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10), amountKop: 1_200_000, payments: [{ label: "Передоплата 50%", amountKop: 600_000, paidAt: new Date().toISOString() }, { label: "Після запуску", amountKop: 600_000, paidAt: null }] });
  await call("POST", `/api/admin/projects/${pid}/items`, { text: "Логотип у PNG" });

  // The client registers and joins with the link; a second use fails.
  const client = await register("c", "+380500000062");
  const C = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) => call(method, url, payload, client.cookie);
  assert.equal((await C("POST", "/api/projects/claim", { token: started.invite })).statusCode, 200);
  assert.equal((await C("POST", "/api/projects/claim", { token: started.invite })).statusCode, 404);
  const mine = (await C("GET", "/api/projects")).json();
  assert.deepEqual([mine.length, mine[0].title, mine[0].paidKop, mine[0].inviteTokenHash], [1, "Свічки ручної роботи", 600_000, undefined]);
  const other = await register("x", "+380500000063");
  assert.equal((await call("POST", `/api/projects/${pid}/approve`, {}, other.cookie)).statusCode, 404, "another business does not see it");

  // A stage: ready → changes (counted) → ready → approved → next stage.
  assert.equal((await C("POST", `/api/projects/${pid}/approve`)).statusCode, 409, "nothing to approve yet");
  await call("POST", `/api/admin/projects/${pid}/ready`, { text: "Бриф готовий" });
  assert.ok((await db.select().from(notifications).where(eq(notifications.organizationId, client.org))).some((n) => n.key === "projectReady"));
  await C("POST", `/api/projects/${pid}/changes`, { text: "Додайте розділ доставки" });
  await call("POST", `/api/admin/projects/${pid}/ready`);
  const approved = (await C("POST", `/api/projects/${pid}/approve`)).json();
  assert.deepEqual([approved.stage, approved.awaiting, approved.approvals.brief.revisions, !!approved.approvals.brief.approvedAt], ["design", false, 1, true]);

  // Checklist: the client marks done.
  const item = approved.items[0];
  assert.equal((await C("PATCH", `/api/projects/${pid}/items/${item.id}`, { done: true })).json().items[0].done, true);
  await C("POST", `/api/projects/${pid}/comments`, { text: "Дякую!" });

  // Deadline in 2 days → one reminder.
  const before = sent.length;
  await runAdminReminders(console, new Date(), send);
  await runAdminReminders(console, new Date(), send);
  assert.equal(sent.slice(before).filter((t) => t.includes("дедлайн")).length, 1);

  // Launch: the website in «Сайт», 3 months of ONEKNIGHT, the lead done.
  const launched = (await call("POST", `/api/admin/projects/${pid}/launch`)).json();
  assert.equal(launched.stage, "done");
  assert.equal((await db.select().from(sites).where(eq(sites.organizationId, client.org)))[0]?.domain, `${tag}.shop.com.ua`);
  assert.equal((await db.select().from(subscriptions).where(eq(subscriptions.organizationId, client.org)))[0]?.status, "trial");
  assert.equal((await db.select().from(leads).where(eq(leads.id, lead!.id)))[0]?.status, "done");
  assert.equal((await call("POST", `/api/admin/projects/${pid}/launch`)).statusCode, 409);
  await db.delete(projects).where(eq(projects.id, pid));
});
