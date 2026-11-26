// The branch report's rules: each file in words, migration clashes, what deserves a careful look.
//   node --test "scripts/ci/*.test.ts"

import assert from "node:assert/strict";
import { test } from "node:test";
import { areaOf, byArea, migrationProblems, risks } from "./branch-report.ts";

test("each file is said as the part of the system it belongs to", () => {
  assert.equal(areaOf("apps/api/migrations/0159_company_codes.sql"), "Database changes (migrations)");
  assert.equal(areaOf("apps/api/src/auth/guard.ts"), "Sign-in, sessions and security");
  assert.equal(areaOf("apps/api/src/finance/service.ts"), "Finance, invoices and the books");
  assert.equal(areaOf("apps/web/src/hr/people.tsx"), "HR, attendance and payroll");
  assert.equal(areaOf("apps/api/package.json"), "Packages and the libraries the system uses");
  assert.equal(areaOf(".github/workflows/ci.yml"), "The automatic checks (CI)");
  assert.equal(areaOf("docs/PLAN.md"), "Documents");
  assert.equal(areaOf("something/else.txt"), "Other files");
});

test("changed files grouped by part, the largest first", () => {
  const groups = byArea(["apps/web/src/hr/a.tsx", "apps/api/src/hr/b.ts", "docs/PLAN.md"]);
  assert.deepEqual(groups.map((group) => [group.area, group.files.length]), [
    ["HR, attendance and payroll", 2],
    ["Documents", 1],
  ]);
});

test("a migration clashes when main already has its number or a later one", () => {
  const main = ["apps/api/migrations/0157_a.sql", "apps/api/migrations/0158_b.sql"];
  assert.deepEqual(migrationProblems(["apps/api/migrations/0159_new.sql"], main), []);
  assert.match(migrationProblems(["apps/api/migrations/0158_mine.sql"], main)[0] ?? "", /number 158, which main already has \(0158_b\.sql\)/);
  assert.match(migrationProblems(["apps/api/migrations/0150_old.sql"], main)[0] ?? "", /before main's last migration \(0158\)/);
  // The same file on both (already merged) is no clash.
  assert.deepEqual(migrationProblems(["apps/api/migrations/0158_b.sql"], main), []);
});

test("what deserves a careful look, in words", () => {
  assert.deepEqual(risks([{ status: "M", file: "docs/PLAN.md" }]), []);
  const said = risks([
    { status: "A", file: "apps/api/migrations/0159_x.sql" },
    { status: "M", file: "apps/api/src/auth/guard.ts" },
    { status: "M", file: "apps/api/src/finance/service.ts" },
    { status: "D", file: "apps/web/src/old.tsx" },
  ]);
  assert.equal(said.length, 4);
  assert.match(said[0] ?? "", /changes the database/);
  assert.match(said[1] ?? "", /sign-in/);
  assert.match(said[2] ?? "", /money/);
  assert.match(said[3] ?? "", /deletes 1 file \(old\.tsx\)/);
});
