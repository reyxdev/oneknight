import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.ts";
import { cleanupTestUsers } from "../test-utils.ts";
import { sql } from "../db/client.ts";

const app = await buildApp({ logger: false });
const ORIGIN = "http://localhost:3000";
const tag = `req${Date.now()}`;
// 1×1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

after(async () => {
  await cleanupTestUsers(tag);
  await app.close();
  await sql.end();
});

async function register(n: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: `Req ${n}`, phone: "+380500000014", email: `${tag}${n}@test.oneknight.local`, password: "long enough" }, headers: { origin: ORIGIN } });
  return { cookie: `ok_session=${r.cookies.find((c) => c.name === "ok_session")!.value}` };
}

test("requisites of the business: owner fills them with signature and stamp, the team reads them for documents", async () => {
  const owner = await register("o");
  const H = { cookie: owner.cookie, origin: ORIGIN };
  const get = async (cookie: string) => (await app.inject({ url: "/api/business/requisites", headers: { cookie } })).json();
  assert.deepEqual(await get(owner.cookie), { requisites: null, canEdit: true });
  const put = (body: object) => app.inject({ method: "PUT", url: "/api/business/requisites", payload: body, headers: H });
  const base = { kind: "fop", name: "ФОП Коваль Олена Петрівна", code: "3123456789", iban: "UA213223130000026007233566001", bank: "АТ «Приклад Банк»", address: "Львів, вул. Зелена, 1", vat: false, signer: "Коваль О. П." };
  assert.deepEqual((await put({ ...base, iban: "UA12" })).json(), { error: "invalid_input", fields: ["iban"] });
  assert.equal((await put({ ...base, signature: { data: PNG }, stamp: { data: PNG } })).statusCode, 200);
  const r = (await get(owner.cookie)).requisites;
  assert.equal(r.name, "ФОП Коваль Олена Петрівна");
  assert.match(r.signature, /^\/api\/files\//);
  assert.equal((await app.inject({ url: r.stamp, headers: { cookie: owner.cookie } })).headers["content-type"], "image/png");
  assert.equal((await app.inject({ url: r.stamp })).statusCode, 401, "the stamp is not public");
  // Keep images when omitted, remove with null.
  await put({ ...base, stamp: null });
  const r2 = (await get(owner.cookie)).requisites;
  assert.ok(r2.signature && r2.stamp === null);

  const other = await register("x");
  const inv = await app.inject({ method: "POST", url: "/api/team/invites", payload: { role: "packer", permissions: ["shipping"] }, headers: H });
  await app.inject({ method: "POST", url: "/api/team/accept", payload: { token: inv.json().token }, headers: { cookie: other.cookie, origin: ORIGIN } });
  const seen = await get(other.cookie);
  assert.equal(seen.requisites.name, base.name, "the packer prints documents too");
  assert.equal(seen.canEdit, false);
  assert.equal((await app.inject({ method: "PUT", url: "/api/business/requisites", payload: base, headers: { cookie: other.cookie, origin: ORIGIN } })).statusCode, 403);
});
