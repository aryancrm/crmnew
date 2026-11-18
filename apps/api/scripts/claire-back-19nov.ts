// Claire Gallana is in the company (Aryan, 19 Nov: "what is in the sheet is right": the November
// target sheet has her managing Mindanao's hospitals and selling as B2B | CLAIRE). Undoes
// scripts/claire-left-17nov.ts: she is active again and holds a District Sales Coach seat in
// Hospitals' Mindanao team, beside its lead (a team may have more than one team lead), reporting to
// Vanessa. The Mindanao MedReps are put under her by scripts/load-target-sheet.ts. Safe to run
// again. Dry run unless --apply.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/claire-back-19nov.ts [--apply]
//   (the live database: --live, only on Aryan's word)

import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";
import { addSeat, fillSeat, updateSeat } from "../src/org/service";
import type { Me } from "../src/types";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });
const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' and active order by id limit 1`);
const me = { id: admin?.id, name: "Admin", role: "admin", channel: null, area: null } as unknown as Me;

const [claire] = await rows<{ id: number; active: boolean }>(db, sql`select id::int as id, active from person where lower(name) = 'claire gallana' order by id limit 1`);
if (!claire) throw new Error("Claire Gallana is not in this database.");
const [held] = await rows<{ title: string }>(
  db,
  sql`select s.title from seat_holder h join seat s on s.id = h.seat_id and s.active where h.person_id = ${claire.id} and h.kind = 'holder' and h.ends_on is null limit 1`,
);
if (claire.active && held) {
  console.log(`Claire Gallana: already active, in "${held.title}".`);
  // Her seat reports to Vanessa (she coaches Hospitals' Mindanao).
  const [seat] = await rows<{ id: number; reportsTo: number | null }>(
    db,
    sql`select s.id::int as id, s.reports_to_seat_id::int as "reportsTo" from seat_holder h join seat s on s.id = h.seat_id and s.active
      where h.person_id = ${claire.id} and h.kind = 'holder' and h.ends_on is null and s.title = 'District Sales Coach – Mindanao' limit 1`,
  );
  const [boss] = await rows<{ seatId: number }>(
    db,
    sql`select s.id::int as "seatId" from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder' and h.ends_on is null
      join seat s on s.id = h.seat_id and s.active where p.name = 'Vanessa Escalderon' order by s.id limit 1`,
  );
  if (seat && boss && seat.reportsTo !== boss.seatId) {
    console.log("Her seat: reports to Vanessa again.");
    if (apply) await updateSeat(db, me, seat.id, { reportsToSeatId: boss.seatId });
  }
  process.exit(0);
}
const [team] = await rows<{ id: number }>(
  db,
  sql`select u.id::int as id from org_unit u join org_unit p on p.id = u.parent_id join channel c on c.id = p.channel_id
    where u.active and lower(u.name) = 'mindanao' and c.code = 'HOSP' limit 1`,
);
const [vanessa] = await rows<{ seatId: number }>(
  db,
  sql`select s.id::int as "seatId" from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder' and h.ends_on is null
    join seat s on s.id = h.seat_id and s.active where p.name = 'Vanessa Escalderon' order by s.id limit 1`,
);
if (!team || !vanessa) throw new Error("Hospitals' Mindanao team or Vanessa's seat not found.");
console.log(`Claire Gallana: active again, District Sales Coach in Hospitals' Mindanao team (${team.id}), reporting to Vanessa.`);
if (apply) {
  await db.execute(sql`update person set active = true where id = ${claire.id}`);
  const { seatId } = await addSeat(db, me, {
    unitId: team.id,
    title: "District Sales Coach – Mindanao",
    module: "team_lead",
    lead: false,
    reportsToSeatId: vanessa.seatId,
  });
  await fillSeat(db, me, seatId, { personId: claire.id, reason: "In the November 2026 target sheet (Aryan, 19 Nov)" });
  console.log(`Seat ${seatId} filled.`);
}
process.exit(0);
