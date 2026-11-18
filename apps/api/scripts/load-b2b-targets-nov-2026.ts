// November 2026 targets of the B2B team, from the team's own end-of-day report (Aryan, 18 Nov:
// "load them, but put each under the right person"). Each is checked twice before it is written:
// the person by their full name on the 2026 chart, and the seat they hold by its login. Khayzee
// and Darsh are on the team's report but not in the ERP (no seat): theirs wait until they are
// placed in the tree. Dry run by default; --apply writes.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/load-b2b-targets-nov-2026.ts [--apply]
//   (the live database: --live, only on Aryan's word)

import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });

const MONTH = "2026-11-01";
// As the team's sheet names them → the person on the chart and their seat's login.
const TARGETS = [
  { sheet: "B2B | Fritzie", person: "Fritzie Mier", login: "b2b3", amount: 6_016_856, tlb: 68, billed: 67 },
  { sheet: "B2B | FAITH", person: "Winbelle Faith Gomez", login: "b2b6", amount: 2_350_771, tlb: 45, billed: 31 },
  { sheet: "B2B | LONIE", person: "Lonie Ann Neri", login: "b2b5", amount: 2_454_860, tlb: 32, billed: 18 },
  { sheet: "B2B | FLORII", person: "Floremel Medina", login: "b2b4", amount: 1_415_319, tlb: 44, billed: 32 },
  { sheet: "B2B | KHAYZEE", person: null, login: null, amount: 500_000, tlb: 10, billed: 12 },
  { sheet: "B2B | DARSH", person: null, login: null, amount: 500_000, tlb: 20, billed: 20 },
];

const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' and active order by id limit 1`);
if (!admin) throw new Error("No active Admin to set the targets as.");
let written = 0;
for (const t of TARGETS) {
  if (!t.person || !t.login) {
    console.log(`${t.sheet.padEnd(16)} not in the ERP (no seat): left for when they are placed.`);
    continue;
  }
  const found = await rows<{ personId: number; seatId: number; was: number | null }>(
    db,
    sql`select p.id::int as "personId", s.id::int as "seatId",
        (select amount::float8 from sales_target where person_id = p.id and month = ${MONTH}::date) as was
      from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder' and h.ends_on is null
        join seat s on s.id = h.seat_id and s.active and lower(s.login) = ${t.login}
      where p.active and p.name = ${t.person}`,
  );
  if (found.length !== 1) {
    console.log(`${t.sheet.padEnd(16)} ${t.person} in ${t.login}: ${found.length} matches, nothing written.`);
    continue;
  }
  const one = found[0] as { personId: number; seatId: number; was: number | null };
  console.log(`${t.sheet.padEnd(16)} → ${t.person} (${t.login}): ₱${t.amount.toLocaleString("en-US")}, TLB ${t.tlb}, billing ${t.billed}${one.was !== null ? ` (was ₱${(one.was / 100).toLocaleString("en-US")})` : ""}`);
  if (!apply) continue;
  const cents = t.amount * 100;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into sales_target (person_id, month, amount, tlb, billed, set_by) values (${one.personId}, ${MONTH}::date, ${cents}, ${t.tlb}, ${t.billed}, ${admin.id})
        on conflict (person_id, month) do update set amount = excluded.amount, tlb = excluded.tlb, billed = excluded.billed, set_by = excluded.set_by, set_at = now()`,
    );
    await tx.execute(
      sql`insert into seat_target (seat_id, month, amount, tlb, billed, set_by) values (${one.seatId}, ${MONTH}::date, ${cents}, ${t.tlb}, ${t.billed}, ${admin.id})
        on conflict (seat_id, month) do update set amount = excluded.amount, tlb = excluded.tlb, billed = excluded.billed, set_by = excluded.set_by, set_at = now()`,
    );
  });
  written += 1;
}
console.log(apply ? `Written: ${written}.` : "Dry run: nothing written (--apply writes).");
process.exit(0);
