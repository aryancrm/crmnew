// Reads the Company tree beside the month's target sheet and says where they differ: the tree as
// Head → Channel → Manager → Sales person (each seat with who holds it and its row on the sheet),
// the sheet's rows that have no seat, and the selling seats that are on no row. Reads only.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/sheet-check.ts
//   (the live database: --live, only on Aryan's word)

import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";

const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });

type Unit = { id: number; name: string; kind: string; parentId: number | null; sort: number };
type Seat = { id: number; unitId: number; title: string; module: string; lead: boolean; login: string | null; holder: string | null; row: string | null; target: number | null };
const units = await rows<Unit>(db, sql`select id::int as id, name, kind, parent_id::int as "parentId", sort::int as sort from org_unit where active order by sort, id`);
const [month] = await rows<{ month: string }>(db, sql`select to_char(max(month), 'YYYY-MM-DD') as month from target_sheet_row`);
const seats = await rows<Seat>(
  db,
  sql`select s.id::int as id, s.unit_id::int as "unitId", s.title, s.module, s.lead, s.login,
      (select p.name from seat_holder h join person p on p.id = h.person_id where h.seat_id = s.id and h.kind = 'holder'
        and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
        order by h.starts_on desc limit 1) as holder,
      (select string_agg(r.salesperson, ' + ' order by r.sort) from target_sheet_row r where r.seat_id = s.id and r.month = ${month?.month ?? null}::date) as row,
      (select sum(r.target)::float8 from target_sheet_row r where r.seat_id = s.id and r.month = ${month?.month ?? null}::date) as target
    from seat s where s.active order by s.lead desc, s.sort, s.id`,
);
const SELLING = ["medrep", "team_lead", "manager", "online"];
const kids = (id: number | null) => units.filter((unit) => unit.parentId === id);
const peso = (centavos: number | null) => (centavos == null ? "" : ` · target ₱${Math.round(centavos / 100).toLocaleString("en-PH")}`);
function show(unit: Unit, depth: number): boolean {
  const own = seats.filter((seat) => seat.unitId === unit.id && SELLING.includes(seat.module));
  const below = kids(unit.id);
  const lines: string[] = [];
  for (const seat of own)
    lines.push(`${"  ".repeat(depth + 1)}${seat.lead ? "LEAD " : "     "}${seat.holder ?? "VACANT"} — ${seat.title} [${seat.module}${seat.login ? `, ${seat.login}` : ""}]${seat.row ? ` ⇐ sheet: ${seat.row}${peso(seat.target)}` : seat.lead ? "" : "   (on no row of the sheet)"}`);
  const out: string[] = [];
  const log = console.log;
  console.log = (line: string) => out.push(line);
  const any = below.map((child) => show(child, depth + 1)).some(Boolean);
  console.log = log;
  if (!own.length && !any) return false;
  console.log(`${"  ".repeat(depth)}▸ ${unit.name} (${unit.kind})`);
  for (const line of lines) console.log(line);
  for (const line of out) console.log(line);
  return true;
}
console.log(`The Company tree's selling side, beside the target sheet of ${month?.month ?? "(no sheet loaded)"}\n`);
for (const top of kids(null)) for (const business of kids(top.id)) show(business, 0);

const loose = await rows<{ head: string; channel: string; manager: string; salesperson: string; target: number }>(
  db,
  sql`select head, channel, manager, salesperson, target::float8 as target from target_sheet_row where month = ${month?.month ?? null}::date and seat_id is null order by sort`,
);
console.log(`\nSheet rows with no seat: ${loose.length}`);
for (const row of loose) console.log(`  ${row.head} · ${row.channel} · ${row.manager} · ${row.salesperson}${peso(row.target)}`);
const sheet = await rows<{ head: string; channel: string; manager: string; n: number; target: number }>(
  db,
  sql`select head, channel, manager, count(*)::int as n, sum(target)::float8 as target from target_sheet_row where month = ${month?.month ?? null}::date group by 1, 2, 3 order by min(sort)`,
);
console.log("\nThe sheet itself, by head, channel and manager:");
for (const row of sheet) console.log(`  ${row.head} · ${row.channel} · ${row.manager}: ${row.n} rows${peso(row.target)}`);
process.exit(0);
