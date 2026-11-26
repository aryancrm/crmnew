// CI's real-Postgres check (the tests use PGlite, which forgives things Postgres doesn't): every
// migration on an empty Postgres, then again (nothing left to apply), the demo company in, and the
// data checks (src/checks/integrity.ts) all green. Then several companies (companies/, 26 Nov
// 2026) as the server runs them online: the list's own database and a second company's made on
// the same Postgres, with the first one's stock copied, and its data checks green too.
//
//   DATABASE_URL=postgres://… node --import tsx scripts/ci-database.ts

import { runChecks } from "../src/checks/integrity";
import { openDatabase } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { postgresPlaces, openCompanies } from "../src/companies/registry";
import { seedDemoInventory } from "../src/inventory/seed";
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

await seedDemoInventory(db);
const places = postgresPlaces(url);
const list = await openCompanies({
  control: await places.control(),
  places,
  home: { name: "2MG Inc.", code: "2MG", loginDomain: "2mg.test" },
  ready: async () => ({ fetch: () => new Response(null, { status: 204 }) }),
});
const made = await list.add(
  { name: "CI Pharma Inc.", code: "CI", loginId: "info@ci.test", copyStockFrom: list.home().ref.orgId },
  null,
);
console.log(`✓ A second company made on Postgres (${made.company.row.database}), ${made.stock?.pieces ?? 0} pieces copied.`);
const second = await runChecks(made.company.db);
for (const one of second.checks.filter((check) => !check.ok)) console.error(`✖ ${JSON.stringify(one).slice(0, 300)}`);
if (!second.ok) throw new Error("The second company's data checks failed on Postgres.");
console.log("✓ Its data checks green on Postgres.");
process.exit(0);
