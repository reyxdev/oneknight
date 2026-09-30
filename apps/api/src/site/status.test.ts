import { test, after } from "node:test";
import assert from "node:assert/strict";
import { lt } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { db, sql } from "../db/client.ts";
import { statusChecks, statusIncidents } from "../db/schema.ts";
import { runStatusChecks, statusSummary } from "./status.ts";

const app = await buildApp({ logger: false });
// Far in the past, so the real page never shows these rows; removed after the test.
const T0 = new Date("2020-01-10T09:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const cutoff = new Date("2020-02-01T00:00:00Z");

after(async () => {
  await db.delete(statusChecks).where(lt(statusChecks.at, cutoff));
  await db.delete(statusIncidents).where(lt(statusIncidents.startedAt, cutoff));
  await app.close();
  await sql.end();
});

test("status: checks every 5 minutes, an incident after 2 failures in a row, closed by a good check, daily uptime", async () => {
  let np = true;
  const probes = { api: async () => true, novaposhta: async () => np };
  await runStatusChecks(probes, at(0));
  np = false;
  await runStatusChecks(probes, at(5));
  let s = await statusSummary(at(6));
  assert.equal(s.services.find((x) => x.service === "novaposhta")!.state, "degraded", "one failure is not an incident yet");
  assert.equal(s.incidents.length, 0);
  await runStatusChecks(probes, at(10));
  s = await statusSummary(at(11));
  assert.equal(s.services.find((x) => x.service === "novaposhta")!.state, "down");
  assert.equal(s.incidents.length, 1);
  assert.deepEqual(new Date(s.incidents[0]!.startedAt).toISOString(), at(5).toISOString(), "the incident starts at the first failure");
  np = true;
  await runStatusChecks(probes, at(15));
  s = await statusSummary(at(16));
  assert.equal(s.services.find((x) => x.service === "novaposhta")!.state, "up");
  assert.ok(s.incidents[0]!.endedAt, "closed by the next good check");
  const day = s.services.find((x) => x.service === "novaposhta")!.days.at(-1)!;
  assert.deepEqual([day.day, day.uptime], ["2020-01-10", 50], "2 good of 4 checks that day");
  assert.equal(s.services.find((x) => x.service === "api")!.days.at(-2)!.uptime, null, "no checks that day");

  // A probe that throws counts as a failure, never breaks the round.
  await runStatusChecks({ ukrposhta: async () => { throw new Error("timeout"); } }, at(20));
  s = await statusSummary(at(21));
  assert.equal(s.services.find((x) => x.service === "ukrposhta")!.state, "degraded");
  assert.equal((await app.inject({ url: "/api/site/status" })).statusCode, 200);
});
