import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { moduleById } from "@oneknight/domain";
import { db, sql } from "../db/client.ts";
import { organizations, subscriptions, topups } from "../db/schema.ts";
import { addMonths, balanceKop, confirmTopup, createTopup, installModule, settle, startTrial } from "./service.ts";
import { env } from "../config.ts";

const DAY = 86_400_000;
const [org] = await db.insert(organizations).values({ name: "Billing Test" }).returning();
const orgId = org!.id;

after(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await sql.end();
});

const sub = async () => (await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)))[0]!;
const setPeriodEnd = (d: Date) => db.update(subscriptions).set({ periodEnd: d }).where(eq(subscriptions.organizationId, orgId));

test("addMonths clamps to the end of shorter months", () => {
  assert.equal(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(addMonths(new Date("2026-09-29T10:00:00Z"), 3).toISOString().slice(0, 10), "2026-12-29");
});

test("trial lasts 3 months and nothing is charged before it ends", async () => {
  const until = await startTrial(orgId);
  assert.ok(until.getTime() - Date.now() > 85 * DAY);
  assert.equal(await settle(orgId), "noop");
  assert.equal((await sub()).status, "trial");
});

test("modules: not-live modules cannot be installed; live ones are free in the trial up to the limit", async () => {
  assert.deepEqual(await installModule(orgId, "olx"), { ok: false, error: "module_not_available" });
  const m = moduleById("olx")!;
  m.live = true;
  try {
    assert.deepEqual(await installModule(orgId, "olx"), { ok: true, free: true });
    assert.equal(await balanceKop(orgId), 0);
  } finally {
    m.live = false;
  }
});

test("no money at renewal -> grace for GRACE_DAYS, then suspended", async () => {
  await setPeriodEnd(new Date(Date.now() - 1000));
  assert.equal(await settle(orgId), "grace");
  const s = await sub();
  assert.equal(s.status, "grace");
  assert.ok(Math.abs(s.graceUntil!.getTime() - (s.periodEnd.getTime() + env.GRACE_DAYS * DAY)) < 1000);
  assert.equal(await settle(orgId), "noop", "still inside the grace period");
  await db.update(subscriptions).set({ graceUntil: new Date(Date.now() - 1000) }).where(eq(subscriptions.organizationId, orgId));
  assert.equal(await settle(orgId), "suspended");
});

test("a confirmed IBAN top-up renews a suspended subscription: 149 + 99 for the module", async () => {
  const t = await createTopup(orgId, null as unknown as string, 500);
  assert.match(t.reference, /^OK-[0-9A-F]{8}$/);
  assert.equal(await balanceKop(orgId), 0, "pending top-up is not money yet");
  assert.equal(await confirmTopup(t.id, null as unknown as string), "confirmed");
  assert.equal(await confirmTopup(t.id, null as unknown as string), "not_pending", "cannot be confirmed twice");
  const s = await sub();
  assert.equal(s.status, "active");
  assert.equal(await balanceKop(orgId), (500 - 149 - 99) * 100);
  assert.ok(s.periodEnd.getTime() > Date.now() + 27 * DAY);
  assert.equal((await db.select().from(topups).where(eq(topups.id, t.id)))[0]!.status, "confirmed");
});
