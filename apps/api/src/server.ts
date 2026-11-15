// Starts the API: opens the database, brings it up to date, then listens.

import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { seedDemoCustomers } from "./customers/seed";
import { openDatabase } from "./db/index";
import { migrate } from "./db/migrate";
import { seedDemoDispatch } from "./dispatch/seed";
import { seedDemoFinance } from "./finance/seed";
import { seedDemoInventory } from "./inventory/seed";
import { startChannelJobs } from "./online/inbox";
import { seedDemoOnline } from "./online/seed";
import { seedDemoOrders } from "./orders/seed";
import { seedDemoTeam } from "./orders/seed-team";
import { alignDemoMoneyDates } from "./orders/seed-times";
import { fillOrderSeats, projectOrg } from "./org/service";
import { seedDemo } from "./seed";

const port = Number(process.env.PORT ?? 4100);
const webUrl = process.env.WEB_URL ?? "http://localhost:5180";

const db = openDatabase({
  url: process.env.DATABASE_URL || undefined,
  dir: process.env.PGLITE_DIR ?? fileURLToPath(new URL("../../../.data/pg", import.meta.url)),
});

const applied = await migrate(db);
if (applied.length) console.log(`database: applied ${applied.join(", ")}`);

if (process.env.SEED_DEMO === "1") {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_DEMO=1 needs SEED_PASSWORD (the demo people's password).");
  if (await seedDemo(db, password)) console.log("database: demo people made");
  if (await seedDemoInventory(db)) console.log("database: demo stock made");
  if (await seedDemoCustomers(db)) console.log("database: demo customers made");
  if (await seedDemoOrders(db)) console.log("database: demo orders made");
  if (await seedDemoFinance(db)) console.log("database: demo invoices and payments made");
  if (await seedDemoDispatch(db)) console.log("database: demo deliveries made");
  if (await seedDemoOnline(db)) console.log("database: demo enquiries made");
  if (await seedDemoTeam(db, password))
    console.log("database: more demo MedReps and their orders made");
  // Older demo databases had invoices dated before their orders: put them right once.
  const aligned = await alignDemoMoneyDates(db);
  if (aligned) console.log(`database: ${aligned} demo invoices dated after their orders`);
}

// The tree writes each person's role, boss and area; a cover that ended yesterday stops today.
await projectOrg(db);
await fillOrderSeats(db);
setInterval(
  () => {
    projectOrg(db).catch((error) =>
      console.error("org: couldn't bring the tree up to date", error),
    );
  },
  15 * 60 * 1000,
).unref();

// Every connected Facebook page and mailbox is read on a timer, and the webhook's events worked.
if (process.env.CHANNEL_JOBS !== "off") startChannelJobs(db);

serve({ fetch: createApp(db, { webUrl }).fetch, port }, () => {
  console.log(`api: listening on http://localhost:${port}`);
});
