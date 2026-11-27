// Phase 1 of Headquarters (Aryan, 27 Nov, PLAN 255-256): Javed's part of the tree as his November
// sheet photo has it, the HQ the main thing. Each salesperson's seat gets its HQ as its territory
// ("RX | NCL": the HQ's Zoho name too, so what Zoho sold under it counts for the HQ), every seat
// sits straight under its channel (RX Business, MD Telesales, both Honey's), the boxes Uro & Onco
// Care, Blood & Bone Care and B2C Sales Coaching are deleted with their history ("remove them
// completely"), and the people not on the photo whose place was asked about are deleted with their
// seats ("delete those who didn't get a seat"). Targets are not touched ("decided elsewhere").
// Done through the tree's own change step, so everyone's role, channel and boss are worked out
// again as when the Admin moves a seat. Each step looks first: safe to run again.
//
//   npx tsx scripts/hq-phase1.ts            what it would do (the local database; stop the API first)
//   npx tsx scripts/hq-phase1.ts --apply    does it (back up .data/pg first)
//   DATABASE_URL=… for another database (live only on Aryan's word)

import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";
import type { Runner } from "../src/inventory/service";
import { migrate } from "../src/db/migrate";
import { change } from "../src/org/service";
import { sheetName } from "../src/sales/target-sheet";

const apply = process.argv.includes("--apply");

/** The photo: each salesperson (as the CRM names them), their channel and their HQ's Zoho name. */
const PHOTO: { person: string; channel: "RX Business" | "MD Telesales"; zoho: string; hq: string }[] = [
  { person: "Gienel Carlos", channel: "RX Business", zoho: "RX | NCL", hq: "NCL" },
  { person: "Kevin Sean Apid", channel: "RX Business", zoho: "RX | SL NORTH", hq: "SL NORTH" },
  { person: "Allysa Mae Madera", channel: "RX Business", zoho: "RX | SL SOUTH", hq: "SL SOUTH" },
  { person: "Antonette Lawas", channel: "RX Business", zoho: "RX | CEBU NORTH", hq: "CEBU NORTH" },
  { person: "Jice Joyce Fajardo", channel: "RX Business", zoho: "RX | CEBU SOUTH", hq: "CEBU SOUTH" },
  { person: "Meryanie Arcangel", channel: "RX Business", zoho: "RX | DAVAO", hq: "DAVAO" },
  { person: "Marwin Dy", channel: "RX Business", zoho: "RX | TAFT", hq: "TAFT" },
  { person: "Merry Joyce Sebastian", channel: "RX Business", zoho: "RX | EAST AVE", hq: "EAST AVE" },
  { person: "Eloisa Villanda", channel: "RX Business", zoho: "RX | RODRIGUEZ", hq: "RODRIGUEZ" },
  { person: "Angelica Mae Saludes", channel: "RX Business", zoho: "RX | KALAW", hq: "KALAW" },
  { person: "Noel Valencia", channel: "RX Business", zoho: "RX | ORTIGAS/TMC", hq: "ORTIGAS/TMC" },
  // The B2C people work ON SITE; their Zoho names are their own.
  { person: "Rachelle Upao", channel: "MD Telesales", zoho: "B2C | Rachelle Upao", hq: "ON SITE" },
  { person: "Mary Jane Viñas", channel: "MD Telesales", zoho: "B2C | Mary Jane Vinas", hq: "ON SITE" },
];
// Aryan, 27 Nov (later): "delete Uro & Onco Care, Onco-Hema Division, Blood & Bone Care, MD Telesales
// Oncology: we work on Headquarters, not on these; forget the organisation chart; the Sales Admins
// came from it too". The photo's MD TELESALES channel (Rachelle, Jane) stays.
const GONE_BOXES = ["Uro & Onco Care", "Blood & Bone Care", "B2C Sales Coaching", "Onco-Hema Division", "MD Telesales Oncology", "Oncology"];
const GONE_PEOPLE = [
  "Mitzi Francisco",
  "Emmanuel Greg Escalona",
  "Ailyn Mancilla",
  "Khalygen Boayes",
  // The Sales Admins, from the organisation chart, not on the photo.
  "Kate Cagoyong",
  "Sheila Mae Bazar",
];

const say = (line: string) => console.log(`${apply ? "" : "would: "}${line}`);

/** Every column that points at `table`'s id, found in the database itself. */
async function referencesTo(db: Runner, table: string) {
  return rows<{ child: string; col: string; nullable: boolean }>(
    db,
    sql`select k.table_name as child, k.column_name as col, (c.is_nullable = 'YES') as nullable
      from information_schema.referential_constraints r
      join information_schema.key_column_usage k on k.constraint_name = r.constraint_name and k.constraint_schema = r.constraint_schema
      join information_schema.constraint_column_usage u on u.constraint_name = r.unique_constraint_name and u.constraint_schema = r.unique_constraint_schema
      join information_schema.columns c on c.table_name = k.table_name and c.column_name = k.column_name and c.table_schema = k.table_schema
      where u.table_name = ${table} and u.column_name = 'id' and k.table_schema = 'public'
      order by 1, 2`,
  );
}

/** Takes away what points at these ids, then the rows: what only describes them goes with them;
 *  a pointer that may be empty is emptied. Anything else stops the whole run, nothing written. */
async function remove(db: Runner, table: string, ids: number[], gone: Set<string>, keepPointer: Set<string>) {
  if (!ids.length) return;
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  for (const ref of await referencesTo(db, table)) {
    const [{ n } = { n: 0 }] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from ${sql.identifier(ref.child)} where ${sql.identifier(ref.col)} in (${list})`,
    );
    if (!n) continue;
    const name = `${ref.child}.${ref.col}`;
    if (gone.has(ref.child)) {
      say(`delete ${n} row(s) of ${ref.child} (by ${ref.col})`);
      await db.execute(sql`delete from ${sql.identifier(ref.child)} where ${sql.identifier(ref.col)} in (${list})`);
    } else if (ref.nullable && (keepPointer.has(name) || keepPointer.has("*"))) {
      say(`empty ${n} pointer(s) ${name}`);
      await db.execute(sql`update ${sql.identifier(ref.child)} set ${sql.identifier(ref.col)} = null where ${sql.identifier(ref.col)} in (${list})`);
    } else {
      throw new Error(`${n} row(s) of ${name} point at the ${table} to delete: left as it is, nothing written. Look at them first.`);
    }
  }
  say(`delete ${ids.length} ${table} row(s): ${ids.join(", ")}`);
  await db.execute(sql`delete from ${sql.identifier(table)} where id in (${list})`);
}

const url = process.env.DATABASE_URL || undefined;
const dir = process.env.PGLITE_DIR ?? fileURLToPath(new URL("../../../.data/pg", import.meta.url));
const db = openDatabase({ url, dir });
await migrate(db);

const run = async (tx: Runner) => {
  const units = await rows<{ id: number; name: string }>(tx, sql`select id::int as id, name from org_unit`);
  const unitOf = (name: string) => units.find((one) => one.name === name)?.id ?? null;
  const rxBusiness = unitOf("RX Business");
  const mdTelesales = unitOf("MD Telesales");
  if (!rxBusiness || !mdTelesales) throw new Error("RX Business or MD Telesales isn't on the tree.");

  // 1. Each salesperson's seat: under their channel, its territory named as their HQ's Zoho name.
  for (const one of PHOTO) {
    const [seat] = await rows<{ seatId: number; unitId: number; areaId: number | null; area: string | null }>(
      tx,
      sql`select s.id::int as "seatId", s.unit_id::int as "unitId", s.area_id::int as "areaId", a.name as area
        from seat_holder h join seat s on s.id = h.seat_id and s.active join person p on p.id = h.person_id
        left join area a on a.id = s.area_id
        where p.name = ${one.person} and p.active and h.kind = 'holder' and h.ends_on is null and not s.lead
        order by h.starts_on, h.id limit 1`,
    );
    if (!seat) {
      console.log(`! ${one.person} has no seat: ${one.hq} left for the Admin to fill`);
      continue;
    }
    const unit = one.channel === "RX Business" ? rxBusiness : mdTelesales;
    if (seat.unitId !== unit) {
      say(`${one.person}: seat ${seat.seatId} into ${one.channel}`);
      await tx.execute(sql`update seat set unit_id = ${unit} where id = ${seat.seatId}`);
    }
    if (seat.areaId && seat.area !== one.zoho) {
      say(`${one.person}: territory "${seat.area}" is now HQ "${one.zoho}"`);
      await tx.execute(sql`update area set name = ${one.zoho} where id = ${seat.areaId}`);
    }
    if (!seat.areaId) console.log(`! ${one.person}'s seat has no territory: HQ ${one.hq} not set`);
    // What Zoho sold under the HQ's name counts for the HQ's seat: the name as Zoho spells it
    // (compared as the Target sheet compares them: "ORTIGAS / TMC" is "ORTIGAS/TMC").
    const names = (await rows<{ name: string; seatId: number | null }>(tx, sql`select name, seat_id::int as "seatId" from zoho_seller`)).filter(
      (row) => sheetName(row.name) === sheetName(one.zoho),
    );
    if (!names.length) {
      say(`Zoho name "${one.zoho}" counts for ${one.person}'s seat`);
      await tx.execute(sql`insert into zoho_seller (name, seat_id) values (${one.zoho}, ${seat.seatId})`);
    }
    for (const known of names)
      if (known.seatId !== seat.seatId) {
        say(`Zoho name "${known.name}" moves to ${one.person}'s seat (was seat ${known.seatId ?? "none"})`);
        await tx.execute(sql`update zoho_seller set seat_id = ${seat.seatId} where name = ${known.name}`);
      }
  }

  // 2. The people not on the photo, with their seats and territories.
  const people = await rows<{ id: number; name: string }>(
    tx,
    sql`select id::int as id, name from person where name in (${sql.join(GONE_PEOPLE.map((one) => sql`${one}`), sql`, `)})`,
  );
  for (const name of GONE_PEOPLE) if (!people.some((one) => one.name === name)) console.log(`- ${name}: not in the CRM`);
  const personIds = people.map((one) => one.id);
  const seats = personIds.length
    ? await rows<{ id: number; areaId: number | null }>(
        tx,
        sql`select distinct s.id::int as id, s.area_id::int as "areaId" from seat s join seat_holder h on h.seat_id = s.id
          where h.person_id in (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
            and not exists (select 1 from seat_holder o where o.seat_id = s.id and o.person_id not in (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)}))`,
      )
    : [];
  const seatIds = seats.map((one) => one.id);
  const areaIds = [...new Set(seats.map((one) => one.areaId).filter((id): id is number => id !== null))];
  // A seat's pointers elsewhere (an order's seat, a Zoho name's, a sheet row's) are emptied; the
  // seat's own holders and lists go with it.
  await remove(tx, "seat", seatIds, new Set(["seat_holder", "doctor_list"]), new Set(["*"]));
  await remove(tx, "area", areaIds, new Set([]), new Set(["*"]));
  // What only describes the person (sign-ins, their HR trail, their own pages) goes with them;
  // anything they did that others keep (an order, a customer) keeps its row, the pointer emptied.
  await remove(
    tx,
    "person",
    personIds,
    new Set(["session", "seat_holder", "hr_event", "person_photo", "person_two_step", "person_device", "notification", "message_read", "attendance", "employee"]),
    new Set(["*"]),
  );

  // 3. The boxes and every box inside them (closed ones too), deleted with what was about them.
  //    Any seat in them (closed ones too: a past B2C CHC's, with its orders) goes up to its channel:
  //    the sales stay, only the boxes go.
  // Every box of these names (an older closed one of the same name too).
  const named = units.filter((one) => GONE_BOXES.includes(one.name));
  for (const missing of GONE_BOXES.filter((name) => !named.some((one) => one.name === name))) console.log(`- ${missing}: not on the tree`);
  for (const { id: top, name } of named) {
    const [still] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from org_unit where id = ${top}`);
    if (!still?.n) continue;
    const up = name === "B2C Sales Coaching" ? mdTelesales : rxBusiness;
    const tree = await rows<{ id: number; name: string; depth: number }>(
      tx,
      sql`with recursive down as (select id, name, 0 as depth from org_unit where id = ${top}
          union all select u.id, u.name, down.depth + 1 from org_unit u join down on u.parent_id = down.id)
        select id::int as id, name, depth from down order by depth desc`,
    );
    const ids = sql.join(tree.map((one) => sql`${one.id}`), sql`, `);
    const [seats] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from seat where unit_id in (${ids})`);
    if (seats?.n) {
      say(`${seats.n} other seat(s) in ${name} (closed ones too) up into ${up === mdTelesales ? "MD Telesales" : "RX Business"}`);
      await tx.execute(sql`update seat set unit_id = ${up} where unit_id in (${ids})`);
    }
    // Innermost first, so no box is left pointing at a deleted one.
    for (const one of tree)
      await remove(tx, "org_unit", [one.id], new Set(["org_request", "message", "unit_view"]), new Set(["*"]));
  }
};

// Looking first does it all in a transaction and takes it back: what it says is exactly what --apply does.
const LOOKED = new Error("looked only");
try {
  if (apply) await change(db, async (tx) => run(tx));
  else
    await db.transaction(async (tx) => {
      await run(tx);
      throw LOOKED;
    });
} catch (error) {
  if (error !== LOOKED) throw error;
}
console.log(apply ? "Done." : "Nothing written. Run with --apply (back up .data/pg first).");
process.exit(0);
