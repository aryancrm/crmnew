// Claire Gallana is not on the 2026 chart (Aryan, 17 Nov: "Claire Gallana ko hata de, wo nahi
// hai"): marked as left on 16 Nov and her seat (B2B District Sales Coach – Mindanao, tl14) closed,
// as on the local database. Her record and her customers stay (nothing with history is deleted).
// Also says which migrations the database has last. Safe to run again. Dry run unless --apply.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/claire-left-17nov.ts [--apply]
//   npx tsx scripts/claire-left-17nov.ts --live [--apply]      (Aryan: "sab live krde", 17 Nov)

import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { closeSeat, personLeaves } from "../src/org/service";
import type { Me } from "../src/types";
import { openTarget } from "./zoho-files";

const apply = process.argv.includes("--apply");
if (!process.env.TEST_PGLITE_DIR && !process.argv.includes("--live")) {
  console.log("Give TEST_PGLITE_DIR (a local database), or --live.");
  process.exit(1);
}
const target = await openTarget(false);
if (!target) process.exit(1);
const { db } = target;
console.log(`${apply ? "Changing" : "Dry run on"} ${target.where}.`);

const last = await rows<{ name: string }>(
  db,
  sql`select name from schema_migration order by name desc limit 3`,
);
console.log(`Latest migrations: ${last.map((one) => one.name).join(", ")}`);

const [admin] = await rows<{ id: number }>(
  db,
  sql`select id::int as id from person where role = 'admin' and active order by id limit 1`,
);
const me = { id: admin?.id, name: "Admin", role: "admin", channel: null, area: null } as unknown as Me;

const [claire] = await rows<{ id: number; active: boolean }>(
  db,
  sql`select id::int as id, active from person where lower(name) = 'claire gallana' order by id limit 1`,
);
if (!claire) console.log("Claire Gallana: not in this database.");
else if (!claire.active) console.log("Claire Gallana: already marked as left.");
else {
  console.log("Claire Gallana: marked as left on 16 Nov (not on the 2026 chart).");
  if (apply)
    await personLeaves(db, me, claire.id, {
      lastDay: "2026-11-16",
      reason: "Not on the 2026 chart (Aryan, 17 Nov)",
    });
}

const seats = await rows<{ id: number; title: string; holder: string | null }>(
  db,
  sql`select s.id::int as id, s.title,
      (select p.name from seat_holder h join person p on p.id = h.person_id
        where h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null limit 1) as holder
    from seat s where s.active and s.title = 'B2B District Sales Coach – Mindanao'`,
);
for (const seat of seats) {
  if (seat.holder && seat.holder.toLowerCase() !== "claire gallana") {
    console.log(`Seat "${seat.title}" (${seat.id}) is ${seat.holder}'s: left as it is.`);
    continue;
  }
  console.log(`Seat "${seat.title}" (${seat.id}): closed.`);
  if (apply) await closeSeat(db, me, seat.id);
}
if (!seats.length) console.log('Seat "B2B District Sales Coach – Mindanao": already closed.');
process.exit(0);
