// The detection rules: each kind of change switches on the checks it needs, and only those.
//   node --test scripts/ci/

import assert from "node:assert/strict";
import { test } from "node:test";
import { detect, everything } from "./detect.ts";
import { migrationProblems } from "./migrations.ts";

test("docs only: nothing but the always-checks", () => {
  const groups = detect(["docs/PLAN.md", "README.md"]);
  assert.equal(groups.docsOnly, true);
  assert.equal(groups.api, false);
  assert.equal(groups.web, false);
  assert.equal(groups.docker, false);
});

test("a web screen: the web only", () => {
  const groups = detect(["apps/web/src/orders/list.tsx"]);
  assert.equal(groups.web, true);
  assert.equal(groups.webAuth, false);
  assert.equal(groups.api, false);
  assert.equal(groups.security, false);
});

test("the sign-in screen: the web and its sign-in checks", () => {
  const groups = detect(["apps/web/src/account/login.tsx"]);
  assert.equal(groups.web, true);
  assert.equal(groups.webAuth, true);
});

test("one API area: its related tests, not every test", () => {
  const groups = detect(["apps/api/src/hr/leave.ts"]);
  assert.equal(groups.api, true);
  assert.equal(groups.apiAll, false);
  assert.deepEqual(groups.apiRelated, ["src/hr/leave.ts"]);
  assert.equal(groups.web, false);
});

test("shared API code: every API test", () => {
  const groups = detect(["apps/api/src/http.ts"]);
  assert.equal(groups.apiAll, true);
  assert.deepEqual(groups.apiRelated, []);
  assert.equal(groups.security, true);
});

test("types shared with the web: the web is checked too", () => {
  const groups = detect(["apps/api/src/types.ts"]);
  assert.equal(groups.apiAll, true);
  assert.equal(groups.web, true);
});

test("a migration: the database checks and every test", () => {
  const groups = detect(["apps/api/migrations/0133_something.sql"]);
  assert.equal(groups.database, true);
  assert.equal(groups.apiAll, true);
});

test("dependencies: everything that installs or builds", () => {
  const groups = detect(["pnpm-lock.yaml"]);
  assert.equal(groups.deps, true);
  assert.equal(groups.apiAll, true);
  assert.equal(groups.web, true);
  assert.equal(groups.docker, true);
  assert.equal(groups.security, true);
});

test("a Dockerfile or nginx: the images, not the tests", () => {
  const groups = detect(["apps/web/docker/nginx.conf.template"]);
  assert.equal(groups.docker, true);
  assert.equal(groups.api, false);
});

test("what a change adds: raw SQL and new routes switch the security checks on", () => {
  const raw = detect(["apps/api/src/hr/people.ts"], '+  sets.push(sql`${sql.raw(column)} = ${value}`);');
  assert.equal(raw.rawSql, true);
  assert.equal(raw.security, true);
  const route = detect(["apps/api/src/hr/routes.ts"], '+  app.post("/api/hr/thing", signedIn, async (c) => {');
  assert.equal(route.security, true);
});

test("a file no rule knows, or the CI itself: everything", () => {
  for (const file of ["somewhere/new.txt", ".github/workflows/ci.yml"]) {
    const groups = detect([file]);
    assert.equal(groups.apiAll, true, file);
    assert.equal(groups.web, true, file);
    assert.equal(groups.docker, true, file);
  }
  assert.equal(everything("nightly").apiAll, true);
});

test("one-off scripts: type-checked only", () => {
  const groups = detect(["apps/api/scripts/close-demo.ts"]);
  assert.equal(groups.scripts, true);
  assert.equal(groups.api, false);
});


test("migrations: numbers once, new ones last, old ones never edited", () => {
  assert.deepEqual(migrationProblems(["0001_a.sql", "0002_b.sql"], ["0001_a.sql"], [{ status: "A", file: "0002_b.sql" }]), []);
  assert.equal(migrationProblems(["0001_a.sql", "0001_b.sql"]).length, 1);
  assert.equal(migrationProblems(["0001_a.sql", "0003_c.sql", "0002_b.sql"], ["0001_a.sql", "0003_c.sql"]).length, 1);
  assert.equal(migrationProblems(["0001_a.sql"], ["0001_a.sql"], [{ status: "M", file: "0001_a.sql" }]).length, 1);
  assert.equal(migrationProblems(["1_bad.SQL", "0001_ok.sql"]).length, 1);
});
