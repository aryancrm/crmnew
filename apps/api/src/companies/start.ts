// What a company's database needs when the server starts, and every quarter of an hour after: the
// same for every company on the server (before 26 Nov 2026 this was all in server.ts, for one).
// Run as the company's (companies/context.ts), so its login domain and its name are right.

import { runAutomations } from "../automations/daily";
import { seedB2bTeam } from "../b2b/seed";
import { seedB2cTeam } from "../b2c/seed";
import { seedClidp } from "../clidp/seed";
import { seedDemoCustomers } from "../customers/seed";
import { type Database, freshenPlanner } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoDispatch } from "../dispatch/seed";
import { seedDemoFinance } from "../finance/seed";
import { ensureCompanyTree, makeFirstAdmin } from "../first-admin";
import { seedDemoAttendance } from "../hr/seed";
import { seedDemoInventory } from "../inventory/seed";
import { seedModernTrade } from "../mt/seed";
import { seedDemoOnline } from "../online/seed";
import { seedDemoOrders } from "../orders/seed";
import { seedDemoTeam, seedPapRep } from "../orders/seed-team";
import { alignDemoMoneyDates } from "../orders/seed-times";
import { fillOrderSeats, projectOrg } from "../org/service";
import { seedRegulatory } from "../regulatory/seed";
import { seedRxTeam } from "../rx/seed";
import { lockDue } from "../scores/service";
import { seedDemo } from "../seed";
import { seedHospitalBoxes } from "../sellers/seed";
import { closeLocalAsks } from "../tenders/fetch-now";
import { seedBidding, seedFound } from "../tenders/seed";
import { seedDemoPast } from "../zoho/seed";
import { seedOfficeStaff } from "../worklog/seed";

export type CompanyStart = {
  /** The first company (the server's own database): the environment's first Admin, the demo, the
   *  tender robot's leftovers are its alone. */
  home: boolean;
  /** An embedded database (PGlite) learns its tables' sizes only when told. */
  embedded: boolean;
  /** Put before each line it writes when the server has several companies: "[GM]". */
  label?: string;
};

const sayer = (label?: string) => (text: string) => console.log(label ? `[${label}] ${text}` : text);

// The embedded database learns its tables' sizes (no autovacuum there); online Postgres does it.
const freshen = (db: Database, start: CompanyStart) =>
  start.embedded
    ? freshenPlanner(db)
        .then((names) => names.length && sayer(start.label)(`database: analysed ${names.length} tables`))
        .catch((error) => console.error("database: couldn't analyse the tables", error))
    : Promise.resolve();

// Last month's scorecards are locked on the 1st (and any month of the past year not yet locked).
const lockScores = (db: Database, start: CompanyStart) =>
  lockDue(db)
    .then((locked) => locked && sayer(start.label)(`scores: ${locked} monthly cards locked`))
    .catch((error) => console.error("scores: couldn't lock the month", error));

// The CRM tells the right person what needs them (stuck orders, expiring licences and stock, late
// customers, samples to count, the CEO's morning): only messages, each told once.
const automate = (db: Database, start: CompanyStart) =>
  runAutomations(db)
    .then((told) => {
      const sum = Object.values(told).reduce((total, n) => total + n, 0);
      if (sum) sayer(start.label)(`automations: ${JSON.stringify(told)}`);
    })
    .catch((error) => console.error("automations: couldn't run", error));

/** Brings a company's database up to date and readies what it needs before it answers. */
export async function readyCompany(db: Database, start: CompanyStart): Promise<void> {
  const say = sayer(start.label);
  const applied = await migrate(db);
  if (applied.length) say(`database: applied ${applied.join(", ")}`);
  await freshen(db, start);

  if (start.home && (await makeFirstAdmin(db))) say("database: the first System admin made");
  if (start.home) {
    const stopped = await closeLocalAsks(db);
    if (stopped) say(`tender finder: ${stopped} Fetch now press(es) closed (their robot ended with the last API)`);
  }
  if (await ensureCompanyTree(db)) say("database: the company's tree made (one box per channel)");

  if (start.home && process.env.SEED_DEMO === "1") {
    const password = process.env.SEED_PASSWORD;
    if (!password) throw new Error("SEED_DEMO=1 needs SEED_PASSWORD (the demo people's password).");
    if (await seedDemo(db, password)) say("database: demo people made");
    if (await seedDemoInventory(db)) say("database: demo stock made");
    if (await seedDemoCustomers(db)) say("database: demo customers made");
    if (await seedDemoOrders(db)) say("database: demo orders made");
    if (await seedDemoFinance(db)) say("database: demo invoices and payments made");
    if (await seedDemoDispatch(db)) say("database: demo deliveries made");
    if (await seedDemoPast(db)) say("database: demo history from Zoho made");
    if (await seedDemoOnline(db)) say("database: demo enquiries made");
    if (await seedDemoTeam(db, password)) say("database: more demo MedReps and their orders made");
    if (await seedPapRep(db, password)) say("database: a demo PAP MedRep made");
    if (await seedRxTeam(db, password)) say("database: the Prescription channel's demo people made");
    if (await seedB2cTeam(db, password)) say("database: the B2C channel's demo people made");
    if (await seedB2bTeam(db, password)) say("database: B2B Telesales' demo people made");
    if (await seedClidp(db, password)) say("database: CLIDP's demo made");
    if (await seedBidding(db, password)) say("database: Government Bidding's demo made");
    if (await seedFound(db)) say("database: the tender finder's demo notices made");
    if (await seedModernTrade(db, password)) say("database: Modern Trade's demo made");
    if (await seedOfficeStaff(db, password)) say("database: Digital Marketing's and IT's demo people made");
    if (await seedRegulatory(db, password)) say("database: In-licensing & Regulatory's demo made");
    if (await seedHospitalBoxes(db, password)) say("database: the Hospital Division's anesthesia telesales and government account made");
    if (await seedDemoAttendance(db)) say("database: two weeks of demo attendance made");
    // Older demo databases had invoices dated before their orders: put them right once.
    const aligned = await alignDemoMoneyDates(db);
    if (aligned) say(`database: ${aligned} demo invoices dated after their orders`);
  }

  // The tree writes each person's role, boss and area; a cover that ended yesterday stops today.
  await projectOrg(db);
  await fillOrderSeats(db);
  await lockScores(db, start);
  void automate(db, start);
}

/** Every quarter of an hour: the tree, the month's scorecards, the planner's sizes, the messages. */
export function companyTick(db: Database, start: CompanyStart): void {
  projectOrg(db).catch((error) => console.error("org: couldn't bring the tree up to date", error));
  void lockScores(db, start);
  void freshen(db, start);
  void automate(db, start);
}
