// Removes every test account (@test.oneknight.local) with its organization, and test leads, from the local
// database. Called at the start and end of browser tests so a failed run never blocks the next one.
import { execSync } from "node:child_process";

export function cleanupTestData() {
  const q = [
    "delete from projects where title like '%E2E%'",
    "delete from leads where email like '%@test.oneknight.local' or name like '%E2E%'",
    "delete from access_keys where created_by in (select id from users where email like '%@test.oneknight.local')",
    "delete from promo_codes where created_by in (select id from users where email like '%@test.oneknight.local')",
    "delete from organizations where id in (select organization_id from memberships m join users u on u.id = m.user_id where u.email like '%@test.oneknight.local')",
    "delete from users where email like '%@test.oneknight.local'",
    "delete from login_events where email_attempted like '%@test.oneknight.local'",
  ].join("; ");
  execSync(`docker exec oneknight-db psql -U oneknight -d oneknight -qc "${q};"`);
}
