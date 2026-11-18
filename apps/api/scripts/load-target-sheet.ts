// Loads the company's November 2026 target sheet (src/sales/target-sheet-2026-11.ts; Aryan, 18 Nov:
// "take this sheet as the truth"):
//  1. its rows, each with the seat of the person it names (or the vacant seat of its area);
//  2. each Zoho name tied to that seat, so its customers and sales come under it;
//  3. the month's target on the seat and its holder, as the sheet says (Aryan, 19 Nov: "what is in
//     the sheet is right");
//  4. who reports to whom, as the sheet's managers say (a manager not in the ERP, or who left, is
//     left as it is and said).
// Dry run by default; --apply writes.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/load-target-sheet.ts [--apply]
//   (the live database: --live, only on Aryan's word)

import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { updateSeat } from "../src/org/service";
import { sheetName } from "../src/sales/target-sheet";
import { SHEET_2026_11 } from "../src/sales/target-sheet-2026-11";
import type { Me } from "../src/types";
import { tieZohoSeller } from "../src/zoho/sellers";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });

await migrate(db);
const MONTH = "2026-11-01";
const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' and active order by id limit 1`);
if (!admin) throw new Error("No active Admin.");
const me = { id: admin.id, name: "Admin", role: "admin", channel: null, area: null } as unknown as Me;

/** The seat a person holds today (the first, when more), or a seat by its area's name. */
const seatOfPerson = async (name: string) =>
  rows<{ seatId: number; personId: number; title: string }>(
    db,
    sql`select s.id::int as "seatId", p.id::int as "personId", s.title from person p
      join seat_holder h on h.person_id = p.id and h.kind = 'holder' and h.ends_on is null join seat s on s.id = h.seat_id and s.active
      where p.active and p.name = ${name} order by (s.area_id is not null) desc, s.id`,
  );
const seatOfArea = async (area: string) =>
  rows<{ seatId: number; personId: number | null; title: string }>(
    db,
    sql`select s.id::int as "seatId", (select h.person_id::int from seat_holder h where h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null limit 1) as "personId", s.title
      from seat s join area a on a.id = s.area_id where s.active and upper(a.name) = upper(${area}) order by s.id`,
  );

const total = SHEET_2026_11.reduce((sum, row) => sum + row.target, 0);
console.log(`${SHEET_2026_11.length} rows, targets ₱${total.toLocaleString("en-US")} (the sheet's grand total: ₱57,642,166)`);

const seats: (number | null)[] = [];
for (const row of SHEET_2026_11) {
  const found = row.person ? await seatOfPerson(row.person) : row.area ? await seatOfArea(row.area) : [];
  const seat = found[0] ?? null;
  seats.push(seat?.seatId ?? null);
  const who = row.person ?? (row.area ? `vacant seat ${row.area}` : "nobody in the ERP");
  console.log(`${row.salesperson.padEnd(28)} ${seat ? `→ ${who} (${seat.title})` : `— ${who}${row.person ? ": NOT FOUND" : ""}`}`);
}

if (apply) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from target_sheet_row where month = ${MONTH}::date`);
    for (const [at, row] of SHEET_2026_11.entries())
      await tx.execute(
        sql`insert into target_sheet_row (month, sort, head, channel, manager, salesperson, zoho_names, hq, target, seat_id, set_by)
          values (${MONTH}::date, ${at + 1}, ${row.head}, ${row.channel}, ${row.manager}, ${row.salesperson},
            ${sql`array[${sql.join(row.zoho.map((name) => sql`${name}`), sql`, `)}]::text[]`}, ${row.hq}, ${row.target * 100}, ${seats[at] ?? null}, ${admin.id})`,
      );
  });
  console.log("Rows written.");
}

// 2 · Zoho names onto the seats: each name as Zoho spells it ("B2B | Pillow" for the sheet's
// "B2B | PILLOW"), matched the way the sheet's figures are.
console.log("\nZoho names tied:");
const spelled = new Map<string, { name: string; tied: number | null }[]>();
for (const one of await rows<{ name: string; tied: number | null }>(
  db,
  sql`select z.seller as name, (select seat_id::int from zoho_seller where name = z.seller) as tied from (select distinct seller from zoho_contact where seller is not null) z`,
))
  spelled.set(sheetName(one.name), [...(spelled.get(sheetName(one.name)) ?? []), one]);
for (const [at, row] of SHEET_2026_11.entries()) {
  const seatId = seats[at];
  if (!seatId) continue;
  for (const known of row.zoho.flatMap((name) => spelled.get(sheetName(name)) ?? [])) {
    const name = known.name;
    if (known.tied === seatId) continue;
    console.log(`  ${name.padEnd(28)} → seat ${seatId}${known.tied ? ` (was seat ${known.tied})` : ""}`);
    if (apply) {
      try {
        const done = await tieZohoSeller(db, me, name, seatId);
        console.log(`    ${done.moved} customers moved`);
      } catch (error) {
        console.log(`    not tied: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

// 3 · November's targets.
console.log("\nTargets:");
for (const [at, row] of SHEET_2026_11.entries()) {
  const seatId = seats[at];
  if (!seatId) continue;
  const [now] = await rows<{ amount: number | null }>(db, sql`select amount::float8 as amount from seat_target where seat_id = ${seatId} and month = ${MONTH}::date`);
  if ((now?.amount ?? null) === row.target * 100) continue;
  console.log(`  ${row.salesperson.padEnd(28)} ₱${row.target.toLocaleString("en-US")}${now?.amount ? ` (was ₱${(now.amount / 100).toLocaleString("en-US")})` : ""}`);
  if (!apply) continue;
  await db.execute(
    sql`insert into seat_target (seat_id, month, amount, set_by) values (${seatId}, ${MONTH}::date, ${row.target * 100}, ${admin.id})
      on conflict (seat_id, month) do update set amount = excluded.amount, set_by = excluded.set_by, set_at = now()`,
  );
  const [holder] = await rows<{ id: number }>(db, sql`select person_id::int as id from seat_holder where seat_id = ${seatId} and kind = 'holder' and ends_on is null limit 1`);
  if (holder)
    await db.execute(
      sql`insert into sales_target (person_id, month, amount, set_by) values (${holder.id}, ${MONTH}::date, ${row.target * 100}, ${admin.id})
        on conflict (person_id, month) do update set amount = excluded.amount, set_by = excluded.set_by, set_at = now()`,
    );
}

// 4 · Who reports to whom, as the sheet's managers say.
const MANAGERS: Record<string, string | null> = {
  Honey: "Honey Cordero",
  Reynan: "Reynan Cuenca",
  Daniel: "Daniel Cruz",
  Jimlord: "Jim Lord Palomares",
  Julius: "Julius S. Abucay",
  Ken: "Kindred Malauan",
  Subir: "Subir Dey",
  "Jessa Domino": "Jessa Domino",
  // Back in the company (scripts/claire-back-19nov.ts).
  Claire: "Claire Gallana",
  Mhalou: null,
};
console.log("\nReports to:");
for (const [at, row] of SHEET_2026_11.entries()) {
  const seatId = seats[at];
  if (!seatId) continue;
  const manager = MANAGERS[row.manager];
  if (manager === undefined || manager === null) {
    if (row.manager === "Claire") console.log(`  ${row.salesperson.padEnd(28)} manager Claire on the sheet: left as it is (Claire Gallana left on 17 Nov)`);
    continue;
  }
  // A manager's own sales row (Claire's B2B | CLAIRE) doesn't move whom the manager reports to.
  if (row.person && Object.values(MANAGERS).includes(row.person)) {
    console.log(`  ${row.salesperson.padEnd(28)} ${row.person} manages others: their own line is left as it is`);
    continue;
  }
  // The manager's lead seat (Claire also sells under B2B | CLAIRE from a seat of her own).
  const [boss] = await rows<{ seatId: number }>(
    db,
    sql`select s.id::int as "seatId" from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder' and h.ends_on is null
      join seat s on s.id = h.seat_id and s.active where p.active and p.name = ${manager} order by s.lead desc, h.starts_on, h.id limit 1`,
  );
  if (!boss) {
    console.log(`  ${row.salesperson.padEnd(28)} manager ${manager}: not in the ERP, left as it is`);
    continue;
  }
  if (boss.seatId === seatId) continue;
  const [now] = await rows<{ boss: string | null; reportsTo: number | null }>(
    db,
    sql`select b.name as boss, s.reports_to_seat_id::int as "reportsTo" from seat s left join person b on b.id = s.boss_id where s.id = ${seatId}`,
  );
  if (now?.boss === manager) continue;
  console.log(`  ${row.salesperson.padEnd(28)} → ${manager} (was ${now?.boss ?? "nobody"})`);
  if (apply) await updateSeat(db, me, seatId, { reportsToSeatId: boss.seatId });
}

console.log(apply ? "\nApplied." : "\nDry run: nothing written (--apply writes).");
process.exit(0);
