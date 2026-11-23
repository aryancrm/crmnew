// Lists every box of the Company tree with the first eight channels' code it carries (its own, or
// the nearest one above it), beside the channel the month's target sheet gives its seats, and says
// where the two differ. Also the people and the open orders whose channel is not their seat's.
// Reads only.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/box-channels.ts
//   (the live database: --live, only on Aryan's word)

import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";

const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });

type Unit = { id: number; name: string; kind: string; parentId: number | null; sort: number; code: string | null };
const units = await rows<Unit>(
  db,
  sql`select u.id::int as id, u.name, u.kind, u.parent_id::int as "parentId", u.sort::int as sort, ch.code
    from org_unit u left join channel ch on ch.id = u.channel_id where u.active order by u.sort, u.id`,
);
const [month] = await rows<{ month: string | null }>(db, sql`select to_char(max(month), 'YYYY-MM-DD') as month from target_sheet_row`);
const seats = await rows<{ unitId: number; module: string; sheet: string | null }>(
  db,
  sql`select s.unit_id::int as "unitId", s.module,
      (select string_agg(distinct r.channel, ' + ') from target_sheet_row r where r.seat_id = s.id and r.month = ${month?.month ?? null}::date) as sheet
    from seat s where s.active`,
);
const byId = new Map(units.map((unit) => [unit.id, unit]));
const kids = (id: number | null) => units.filter((unit) => unit.parentId === id);
/** The code a box works under: its own, else the nearest box above that names one. */
function carried(unit: Unit): { code: string | null; from: string | null } {
  for (let at: Unit | undefined = unit; at; at = at.parentId ? byId.get(at.parentId) : undefined)
    if (at.code) return { code: at.code, from: at.id === unit.id ? null : at.name };
  return { code: null, from: null };
}
/** Every seat in a box and the boxes under it. */
const under = (unit: Unit): typeof seats => [...seats.filter((seat) => seat.unitId === unit.id), ...kids(unit.id).flatMap(under)];

const SELLING = ["medrep", "team_lead", "manager", "online"];
const notes: string[] = [];
function show(unit: Unit, depth: number) {
  const own = seats.filter((seat) => seat.unitId === unit.id);
  const { code, from } = carried(unit);
  const sheet = [...new Set(own.flatMap((seat) => (seat.sheet ? seat.sheet.split(" + ") : [])))];
  const selling = own.filter((seat) => SELLING.includes(seat.module)).length;
  const modules = [...new Set(own.map((seat) => seat.module))].join(", ");
  console.log(
    `${"  ".repeat(depth)}${unit.name} [${unit.kind}] — old channel: ${code ?? "NONE"}${from ? ` (from ${from})` : unit.code ? " (its own)" : ""}` +
      `${own.length ? ` · ${own.length} seats (${modules})` : ""}${sheet.length ? ` · sheet: ${sheet.join(" + ")}` : ""}`,
  );
  if (selling && !code) notes.push(`${unit.name}: ${selling} selling seats and no old channel at all`);
  if (sheet.length > 1) notes.push(`${unit.name}: its seats are on ${sheet.length} channels of the sheet (${sheet.join(", ")})`);
  for (const kid of kids(unit.id)) show(kid, depth + 1);
}
for (const top of kids(null)) show(top, 0);

// One old code carried by boxes that the sheet calls different channels, and the other way round.
const pairs = new Map<string, Set<string>>();
const back = new Map<string, Set<string>>();
for (const unit of units) {
  const { code } = carried(unit);
  for (const seat of seats.filter((one) => one.unitId === unit.id && one.sheet))
    for (const name of (seat.sheet as string).split(" + ")) {
      pairs.set(code ?? "NONE", (pairs.get(code ?? "NONE") ?? new Set()).add(name));
      back.set(name, (back.get(name) ?? new Set()).add(code ?? "NONE"));
    }
}
console.log(`\nThe sheet's channels (${month?.month?.slice(0, 7) ?? "no sheet"}) under each old code:`);
for (const [code, names] of [...pairs].sort()) console.log(`  ${code.padEnd(7)} → ${[...names].sort().join(", ")}${names.size > 1 ? "   ← one old code, several sheet channels" : ""}`);
for (const [name, codes] of [...back].sort()) if (codes.size > 1) console.log(`  sheet "${name}" is spread over old codes ${[...codes].sort().join(", ")}`);
const unused = await rows<{ code: string; name: string; people: number }>(
  db,
  sql`select ch.code, ch.name, (select count(*) from person p where p.channel_id = ch.id and p.active)::int as people
    from channel ch where not exists (select 1 from org_unit u where u.channel_id = ch.id and u.active) order by ch.sort`,
);
for (const one of unused) console.log(`  ${one.code} (${one.name}) is on no box of the tree · ${one.people} people still carry it`);

// People whose own channel is not their seat's, and orders still moving whose channel is not their seat's.
const people = await rows<{ name: string; has: string | null; seat: string | null; box: string }>(
  db,
  sql`select p.name, pc.code as has, sc.code as seat, u.name as box
    from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id join person p on p.id = h.person_id and p.active
      left join channel pc on pc.id = p.channel_id left join channel sc on sc.id = seat_channel_id(s.id)
    where h.kind = 'holder' and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
      and pc.id is distinct from sc.id order by p.name`,
);
console.log(`\nPeople whose channel is not their seat's: ${people.length}`);
for (const one of people) console.log(`  ${one.name}: has ${one.has ?? "none"}, seat in ${one.box} says ${one.seat ?? "none"}`);
const orders = await rows<{ has: string | null; seat: string | null; count: number }>(
  db,
  sql`select oc.code as has, sc.code as seat, count(*)::int as count
    from sales_order o left join channel oc on oc.id = o.channel_id left join channel sc on sc.id = seat_channel_id(o.seat_id)
    where o.seat_id is not null and o.status not in ('completed', 'cancelled', 'draft') and oc.id is distinct from sc.id group by 1, 2 order by 3 desc`,
);
console.log(`Open orders whose channel is not their seat's: ${orders.reduce((sum, one) => sum + one.count, 0)}`);
for (const one of orders) console.log(`  ${one.count} × order says ${one.has ?? "none"}, seat says ${one.seat ?? "none"}`);

console.log(`\nTo look at: ${notes.length}`);
for (const note of notes) console.log(`  ${note}`);
process.exit(0);
