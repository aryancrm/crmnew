// Starts the API: opens the database, brings it up to date, then listens.

import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { runAutomations } from "./automations/daily";
import { seedDemoCustomers } from "./customers/seed";
import { freshenPlanner, openDatabase } from "./db/index";
import { migrate } from "./db/migrate";
import { seedDemoDispatch } from "./dispatch/seed";
import { seedDemoFinance } from "./finance/seed";
import { seedDemoAttendance } from "./hr/seed";
import { seedDemoInventory } from "./inventory/seed";
import { ensureCompanyTree, makeFirstAdmin } from "./first-admin";
import { startKeepAwake } from "./keep-awake";
import { startChannelJobs } from "./online/inbox";
import { seedDemoOnline } from "./online/seed";
import { seedDemoOrders } from "./orders/seed";
import { seedDemoTeam, seedPapRep } from "./orders/seed-team";
import { alignDemoMoneyDates } from "./orders/seed-times";
import { fillOrderSeats, projectOrg } from "./org/service";
import { seedB2bTeam } from "./b2b/seed";
import { seedClidp } from "./clidp/seed";
import { seedB2cTeam } from "./b2c/seed";
import { seedModernTrade } from "./mt/seed";
import { seedOfficeStaff } from "./worklog/seed";
import { seedRegulatory } from "./regulatory/seed";
import { seedRxTeam } from "./rx/seed";
import { lockDue } from "./scores/service";
import { seedHospitalBoxes } from "./sellers/seed";
import { seedBidding, seedFound } from "./tenders/seed";
import { seedDemo } from "./seed";
import { seedDemoPast } from "./zoho/seed";

const port = Number(process.env.PORT ?? 4100);
const webUrl = process.env.WEB_URL ?? "http://localhost:5180";

const db = openDatabase({
  url: process.env.DATABASE_URL || undefined,
  dir: process.env.PGLITE_DIR ?? fileURLToPath(new URL("../../../.data/pg", import.meta.url)),
});

const applied = await migrate(db);
if (applied.length) console.log(`database: applied ${applied.join(", ")}`);

// The embedded database learns its tables' sizes (no autovacuum there); online Postgres does it.
const freshen = () =>
  process.env.DATABASE_URL
    ? Promise.resolve()
    : freshenPlanner(db)
        .then((names) => names.length && console.log(`database: analysed ${names.length} tables`))
        .catch((error) => console.error("database: couldn't analyse the tables", error));
await freshen();

if (await makeFirstAdmin(db)) console.log("database: the first System admin made");
if (await ensureCompanyTree(db)) console.log("database: the company's tree made (one box per channel)");

if (process.env.SEED_DEMO === "1") {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_DEMO=1 needs SEED_PASSWORD (the demo people's password).");
  if (await seedDemo(db, password)) console.log("database: demo people made");
  if (await seedDemoInventory(db)) console.log("database: demo stock made");
  if (await seedDemoCustomers(db)) console.log("database: demo customers made");
  if (await seedDemoOrders(db)) console.log("database: demo orders made");
  if (await seedDemoFinance(db)) console.log("database: demo invoices and payments made");
  if (await seedDemoDispatch(db)) console.log("database: demo deliveries made");
  if (await seedDemoPast(db)) console.log("database: demo history from Zoho made");
  if (await seedDemoOnline(db)) console.log("database: demo enquiries made");
  if (await seedDemoTeam(db, password))
    console.log("database: more demo MedReps and their orders made");
  if (await seedPapRep(db, password)) console.log("database: a demo PAP MedRep made");
  if (await seedRxTeam(db, password)) console.log("database: the Prescription channel's demo people made");
  if (await seedB2cTeam(db, password)) console.log("database: the B2C channel's demo people made");
  if (await seedB2bTeam(db, password)) console.log("database: B2B Telesales' demo people made");
  if (await seedClidp(db, password)) console.log("database: CLIDP's demo made");
  if (await seedBidding(db, password)) console.log("database: Government Bidding's demo made");
  if (await seedFound(db)) console.log("database: the tender finder's demo notices made");
  if (await seedModernTrade(db, password)) console.log("database: Modern Trade's demo made");
  if (await seedOfficeStaff(db, password)) console.log("database: Digital Marketing's and IT's demo people made");
  if (await seedRegulatory(db, password)) console.log("database: In-licensing & Regulatory's demo made");
  if (await seedHospitalBoxes(db, password)) console.log("database: the Hospital Division's anesthesia telesales and government account made");
  if (await seedDemoAttendance(db)) console.log("database: two weeks of demo attendance made");
  // Older demo databases had invoices dated before their orders: put them right once.
  const aligned = await alignDemoMoneyDates(db);
  if (aligned) console.log(`database: ${aligned} demo invoices dated after their orders`);
}

// The tree writes each person's role, boss and area; a cover that ended yesterday stops today.
await projectOrg(db);
await fillOrderSeats(db);
// Last month's scorecards are locked on the 1st (and any month of the past year not yet locked).
const lockScores = () =>
  lockDue(db)
    .then((locked) => locked && console.log(`scores: ${locked} monthly cards locked`))
    .catch((error) => console.error("scores: couldn't lock the month", error));
await lockScores();
// The CRM tells the right person what needs them (stuck orders, expiring licences and stock, late
// customers, samples to count, the CEO's morning): only messages, each told once.
const automate = () =>
  runAutomations(db)
    .then((told) => {
      const sum = Object.values(told).reduce((total, n) => total + n, 0);
      if (sum) console.log(`automations: ${JSON.stringify(told)}`);
    })
    .catch((error) => console.error("automations: couldn't run", error));
void automate();
setInterval(
  () => {
    projectOrg(db).catch((error) =>
      console.error("org: couldn't bring the tree up to date", error),
    );
    void lockScores();
    void freshen();
    void automate();
  },
  15 * 60 * 1000,
).unref();

// Every connected Facebook page and mailbox is read on a timer, and the webhook's events worked.
if (process.env.CHANNEL_JOBS !== "off") startChannelJobs(db);

serve({ fetch: createApp(db, { webUrl }).fetch, port }, () => {
  console.log(`api: listening on http://localhost:${port}`);
  startKeepAwake();
});
