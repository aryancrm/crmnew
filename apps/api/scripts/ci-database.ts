// CI's real-Postgres check (the tests use PGlite, which forgives things Postgres doesn't): every
// migration on an empty Postgres, then again (nothing left to apply), the demo company in, and the
// data checks (src/checks/integrity.ts) all green.
//
//   DATABASE_URL=postgres://… node --import tsx scripts/ci-database.ts

import { runChecks } from "../src/checks/integrity";
import { openDatabase } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { seedDemo } from "../src/seed";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL to an empty Postgres.");
const db = openDatabase({ url });

const applied = await migrate(db);
console.log(`✓ ${applied.length} migrations applied on Postgres.`);
const again = await migrate(db);
if (again.length) throw new Error(`Applied twice: ${again.join(", ")}`);
console.log("✓ Nothing applied the second time.");

await seedDemo(db, "ci-only-password-1");
const checks = await runChecks(db);
const failed = checks.checks.filter((one) => !one.ok);
for (const one of failed) console.error(`✖ ${JSON.stringify(one).slice(0, 300)}`);
if (!checks.ok) throw new Error(`${failed.length} data checks failed on Postgres.`);
console.log(`✓ ${checks.checks.length} data checks green on Postgres.`);
process.exit(0);
