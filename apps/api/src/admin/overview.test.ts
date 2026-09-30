import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { db, sql } from "../db/client.ts";
import { ledgerEntries, platformState, sessions, subscriptions, users } from "../db/schema.ts";
import { addMonths } from "../billing/service.ts";
import { churnRisk, morningText, runMorningReport, workingHours } from "./overview.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `ovw${Date.now()}`;
const DAY = 86_400_000;
const [saved] = await db.select().from(platformState).where(eq(platformState.key, "morningReport"));

after(async () => {
  // The dev database keeps its own «sent today» mark.
  if (saved) await db.update(platformState).set({ value: saved.value }).where(eq(platformState.key, "morningReport"));
  else await db.delete(platformState).where(eq(platformState.key, "morningReport"));
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string, phone: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Ovw ${n}`, phone, email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}`, id: r.json().id as string, org: r.json().organizations[0].id as string };
}

test("working hours: Mon–Fri 10:00–18:00 Kyiv only", () => {
  // Friday 17:00 → Monday 11:00 (Kyiv, UTC+3 in October): 1 h on Friday + 1 h on Monday.
  assert.equal(workingHours(new Date("2026-10-02T14:00:00Z"), new Date("2026-10-05T08:00:00Z")), 2);
  assert.equal(workingHours(new Date("2026-10-03T08:00:00Z"), new Date("2026-10-03T15:00:00Z")), 0, "Saturday");
});

test("overview for the admin only; churn risk with reasons; the morning report once a day", async () => {
  const admin = await register("a", "+380500000051");
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
  const client = await register("c", "+380500000052");
  assert.equal((await app.inject({ url: "/api/admin/overview", headers: { cookie: client.cookie } })).statusCode, 403);

  // A paying business: not seen for 20 days, renewal in 3 days, empty balance.
  await db.insert(subscriptions).values({ organizationId: client.org, status: "active", periodEnd: new Date(Date.now() + 3 * DAY) });
  await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 20 * DAY) }).where(eq(sessions.userId, client.id));
  const risk = (await churnRisk()).find((r) => r.id === client.org);
  assert.deepEqual(risk?.reasons, ["noLogin", "payment"], "new business: no «no orders» yet");
  // Money on the balance: the payment is covered.
  await db.insert(ledgerEntries).values({ organizationId: client.org, kind: "topup", amountKop: 100_000, reason: "test" });
  assert.deepEqual((await churnRisk()).find((r) => r.id === client.org)?.reasons, ["noLogin"]);

  const o = (await app.inject({ url: "/api/admin/overview", headers: { cookie: admin.cookie } })).json();
  assert.ok(o.numbers.paying >= 1 && typeof o.numbers.monthlyKop === "number");
  assert.ok(o.risk.some((r: { id: string }) => r.id === client.org));
  assert.ok(Array.isArray(o.todo) && typeof o.funnel === "object");

  assert.match(await morningText(), /Ранковий звіт ONEKNIGHT[\s\S]*Ризик відтоку: \d+/);
  const sent: string[] = [];
  const send = async (t: string) => (sent.push(t), true);
  const morning = new Date("2031-03-03T07:30:00Z"); // 09:30 Kyiv
  assert.equal(await runMorningReport(send, new Date("2031-03-03T05:30:00Z")), false, "not before 09:00");
  assert.equal(await runMorningReport(send, morning), true);
  assert.equal(await runMorningReport(send, addMonths(morning, 0)), false, "once a day");
  assert.equal(sent.length, 1);
});
