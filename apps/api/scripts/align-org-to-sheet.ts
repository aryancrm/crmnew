// Puts the company's teams the way the November 2026 target sheet has them (Aryan, 19 Nov: "align
// our ERP completely to this sheet: every person, every team, in the Admin panel where teams are
// decided"). The sheet's columns map onto the tree: Head = the business's lead seat, Channel = a
// team box, Manager = that box's lead seat, Sales Person = a seat in it. One person leading two
// teams holds two lead seats (Honey: RX Business and MD Telesales; Subir: Sales & Marketing and
// BID); their first seat keeps deciding their screens.
//
//  Javed  · RX Business (was Onco-Hema Division): Honey leads it (a second seat); its Rx CHCs
//           under her through the box, not by hand.
//         · MD Telesales (was MD Telesales Oncology): beside RX Business, straight under Javed.
//  Subir  · BID: Subir leads it (a second seat); Jimmy stays its Government Bidding Admin (his
//           tenders desk), no longer its lead. CLIDP and B2B Telesales (Jessa) as they are.
//         · B2B: Claire's own seat (B2B | CLAIRE); vacant seats for Dhon, Pillow, Charle and Mani
//           Mishra, who are on the sheet but not yet in the ERP.
//  Vanessa· TeleSales (was MD Telesales Anesthesia): Reynan leads it (a second seat).
//         · Kris and Andy into Daniel's NCR 1, Jessa (Iloilo) into Jim Lord's NCR 2; Visayas closes.
//         · Mindanao: Claire leads it; Saurav stays in it as another team lead, under Vanessa.
//  Mhalou · MT: vacant seats for Arlene (MT | 1) and Jasper (MT | 2).
//
// Each step looks first and does only what is still to do, so it is safe to run again. People who
// are not on the sheet keep their seats. Dry run by default; --apply writes.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/align-org-to-sheet.ts [--apply]
//   (the live database: --live, only on Aryan's word)

import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { addSeat, addUnit, closeUnit, fillSeat, updateSeat, updateUnit } from "../src/org/service";
import type { Me, Role } from "../src/types";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });
await migrate(db);
const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' and active order by id limit 1`);
if (!admin) throw new Error("No active Admin.");
const me = { id: admin.id, name: "Admin", role: "admin", channel: null, area: null } as unknown as Me;
const REASON = "November 2026 target sheet";

let todo = 0;
const say = (line: string) => {
  todo++;
  console.log(`  ${line}`);
};
const step = (title: string) => console.log(`\n${title}`);
const missing: string[] = [];

type Unit = { id: number; name: string; parentId: number | null; sort: number };
/** The open box by one of its names (the sheet's new name first, so a second run finds it). */
async function unit(...names: string[]): Promise<Unit | null> {
  for (const name of names) {
    const found = await rows<Unit>(
      db,
      sql`select id::int as id, name, parent_id::int as "parentId", sort::int as sort from org_unit where active and name = ${name} order by id`,
    );
    if (found.length > 1) throw new Error(`More than one open box is called "${name}".`);
    if (found[0]) return found[0];
  }
  missing.push(`box ${names.join(" / ")}`);
  return null;
}
type Seat = { id: number; unitId: number; title: string; lead: boolean; module: Role; reportsTo: number | null; areaId: number | null };
const SEAT = sql`s.id::int as id, s.unit_id::int as "unitId", s.title, s.lead, s.module, s.reports_to_seat_id::int as "reportsTo", s.area_id::int as "areaId"`;
/** The seats a person holds today, their first one first. */
async function seatsOf(name: string): Promise<Seat[]> {
  const found = await rows<Seat>(
    db,
    sql`select ${SEAT} from person p join seat_holder h on h.person_id = p.id and h.kind = 'holder' and (h.ends_on is null or h.ends_on >= current_date)
      join seat s on s.id = h.seat_id and s.active where p.active and p.name = ${name} order by h.starts_on, h.id`,
  );
  if (!found.length) missing.push(name);
  return found;
}
const personId = async (name: string) =>
  (await rows<{ id: number }>(db, sql`select id::int as id from person where active and name = ${name} order by id limit 1`))[0]?.id ?? null;
const leadSeat = async (unitId: number) =>
  (await rows<Seat>(db, sql`select ${SEAT} from seat s where s.unit_id = ${unitId} and s.active and s.lead limit 1`))[0] ?? null;
const holderOf = async (seatId: number) =>
  (
    await rows<{ name: string }>(
      db,
      sql`select p.name from seat_holder h join person p on p.id = h.person_id where h.seat_id = ${seatId} and h.kind = 'holder' and (h.ends_on is null or h.ends_on >= current_date) limit 1`,
    )
  )[0]?.name ?? null;

async function rename(box: Unit | null, name: string) {
  if (!box || box.name === name) return;
  say(`"${box.name}" is renamed "${name}"`);
  if (apply) await updateUnit(db, me, box.id, { name });
}

/** The box's lead seat, held by this person: made and filled as a second seat when not yet.
 *  `replacing`: a lead seat this run takes the lead off first (in a dry run it is still there). */
async function leadBy(box: Unit | null, person: string, title: string, module: Role, replacing?: number) {
  if (!box) return null;
  const lead = await leadSeat(box.id);
  if (lead && !(lead.id === replacing && !apply)) {
    const holder = await holderOf(lead.id);
    if (holder === person) return lead;
    throw new Error(`${box.name}'s lead seat "${lead.title}" is ${holder ?? "vacant"}, not ${person}: look first.`);
  }
  const id = await personId(person);
  if (!id) {
    missing.push(person);
    return null;
  }
  say(`${box.name}: a lead seat "${title}" for ${person} (a second seat; their first stays as it is)`);
  if (!apply) return null;
  const { seatId } = await addSeat(db, me, { unitId: box.id, title, module, lead: true });
  await fillSeat(db, me, seatId, { personId: id, keepOther: true, reason: `Second seat: ${REASON}` });
  return leadSeat(box.id);
}

/** Seats in these boxes that name another seat to report to by hand: back under their box's lead. */
async function underTheBox(boxes: (Unit | null)[], from: number[]) {
  const ids = boxes.flatMap((box) => (box ? [box.id] : []));
  if (!ids.length || !from.length) return;
  const named = await rows<Seat & { holder: string | null }>(
    db,
    sql`select ${SEAT}, (select p.name from seat_holder h join person p on p.id = h.person_id where h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null limit 1) as holder
      from seat s where s.active and not s.lead and s.unit_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        and s.reports_to_seat_id in (${sql.join(from.map((id) => sql`${id}`), sql`, `)}) order by s.id`,
  );
  for (const seat of named) {
    say(`${seat.holder ?? "vacant"} (${seat.title}): under the team's lead through the box, not named by hand`);
    if (apply) await updateSeat(db, me, seat.id, { reportsToSeatId: null });
  }
}

async function moveInto(person: string, box: Unit | null) {
  if (!box) return;
  const [seat] = (await seatsOf(person)).filter((one) => one.module === "medrep");
  if (!seat) return;
  if (seat.unitId === box.id && seat.reportsTo === null) return;
  say(`${person}: into ${box.name}${seat.reportsTo ? ", under its lead" : ""}`);
  if (apply) await updateSeat(db, me, seat.id, { unitId: box.id, reportsToSeatId: null });
}

/** A vacant MedRep seat with its own area, for someone on the sheet not yet in the ERP. */
async function vacantSeat(box: Unit | null, title: string, area: string, who: string) {
  if (!box) return;
  const [taken] = await rows<{ seat: string | null }>(
    db,
    sql`select (select s.title from seat s where s.area_id = a.id and s.active limit 1) as seat from area a where upper(a.name) = upper(${area}) limit 1`,
  );
  if (taken?.seat) return;
  if (taken) throw new Error(`The area ${area} is there with no seat: look first.`);
  say(`${box.name}: a vacant seat "${title}", area ${area} (${who}, not yet in the ERP)`);
  if (apply) await addSeat(db, me, { unitId: box.id, title, module: "medrep", newArea: { name: area, cities: [] } });
}

// ---- Javed: RX Business and MD Telesales, both led by Honey ----
step("Javed · RX Business and MD Telesales (manager Honey)");
const rxBox = await unit("RX Business", "Onco-Hema Division");
await rename(rxBox, "RX Business");
const [honeyFirst] = await seatsOf("Honey Cordero");
const rxLead = await leadBy(rxBox, "Honey Cordero", "Sales Coach – RX Business", "team_lead");
const rxLines = await rows<Unit>(
  db,
  sql`select id::int as id, name, parent_id::int as "parentId", sort::int as sort from org_unit where active and parent_id = ${rxBox?.id ?? 0} and channel_id is null`,
);
if (honeyFirst && (rxLead || !apply)) await underTheBox([rxBox, ...rxLines], [honeyFirst.id]);

const rxBusiness = await unit("Prescription Business");
const mdBox = await unit("MD Telesales", "MD Telesales Oncology");
await rename(mdBox, "MD Telesales");
const tsBox = await unit("TeleSales", "MD Telesales Anesthesia");
if (mdBox && rxBusiness && mdBox.parentId !== rxBusiness.id) {
  say(`MD Telesales: straight under ${rxBusiness.name} (Javed), beside RX Business`);
  if (apply) await updateUnit(db, me, mdBox.id, { parentId: rxBusiness.id });
}
// Telesales has two boxes now at the same depth: Vanessa's TeleSales and Javed's MD Telesales. The
// channel's own box (its head, its page) is the first by order, so Vanessa's comes first.
if (mdBox && tsBox && mdBox.sort <= tsBox.sort) {
  say(`MD Telesales listed after TeleSales (Telesales's own box stays Vanessa's TeleSales)`);
  if (apply) await db.execute(sql`update org_unit set sort = ${tsBox.sort + 1} where id = ${mdBox.id}`);
}

// ---- Vanessa: TeleSales led by Reynan ----
step("Vanessa · TeleSales (manager Reynan)");
await rename(tsBox, "TeleSales");
const [reynanFirst] = await seatsOf("Reynan Cuenca");
const tsLead = await leadBy(tsBox, "Reynan Cuenca", "Sales Coach – TeleSales", "team_lead");
if (reynanFirst && (tsLead || !apply)) await underTheBox([tsBox], [reynanFirst.id]);

// ---- Vanessa: hospitals ----
step("Vanessa · HOSP (managers Julius, Daniel, Claire, Ken, Jim Lord)");
const ncr1 = await unit("NCR 1");
const ncr2 = await unit("NCR 2");
await moveInto("Kristofferson Conde", ncr1);
await moveInto("Andrealyn Bermido", ncr1);
await moveInto("Jessa Mae Teruel", ncr2);
const visayas = await rows<{ id: number; seats: number; units: number }>(
  db,
  sql`select u.id::int as id, (select count(*) from seat s where s.unit_id = u.id and s.active)::int as seats,
      (select count(*) from org_unit k where k.parent_id = u.id and k.active)::int as units
    from org_unit u where u.active and u.name = 'Visayas'`,
);
for (const box of visayas) {
  say("Visayas closes (its three MedReps are in NCR 1 and NCR 2 now)");
  if (apply) {
    if (box.seats || box.units) throw new Error("Visayas still has seats in it.");
    await closeUnit(db, me, box.id);
  }
}
const mindanao = await unit("Mindanao");
const claireSeats = await seatsOf("Claire Gallana");
const claireCoach = claireSeats.find((seat) => seat.unitId === mindanao?.id) ?? null;
const [sauravSeat] = (await seatsOf("Saurav Kumar")).filter((seat) => seat.unitId === mindanao?.id);
const [vanessaSeat] = await seatsOf("Vanessa Escalderon");
if (mindanao && claireCoach && !claireCoach.lead) {
  if (sauravSeat?.lead) {
    say("Mindanao: Saurav Kumar stays in it as another team lead, under Vanessa (no MedRep under him on the sheet)");
    if (apply) await updateSeat(db, me, sauravSeat.id, { lead: false, reportsToSeatId: vanessaSeat?.id ?? null });
  }
  say("Mindanao: Claire Gallana's seat is its lead (the sheet's manager)");
  if (apply) await updateSeat(db, me, claireCoach.id, { lead: true, reportsToSeatId: null });
}
if (claireCoach) await underTheBox([mindanao], [claireCoach.id]);

// The sales tracker's HOSP (Aryan, 19 Nov: "the tracker is God: the company is exactly as it has it"):
// one channel box under Vanessa over the five hospital teams, beside TeleSales. Nobody moves seat;
// the teams' coaches still report to Vanessa (the box has no lead of its own).
step("Vanessa · one HOSP channel over Julius', Daniel's, Claire's, Ken's and Jim Lord's teams");
const hospital = await unit("Hospital Division");
let hospBox = await unit("HOSP");
if (hospital && !hospBox) {
  say("Hospital Division: a HOSP box (the tracker's channel) over its five hospital teams");
  if (apply) {
    const [channel] = await rows<{ id: number }>(db, sql`select id::int as id from channel where code = 'HOSP'`);
    const { unitId } = await addUnit(db, me, { name: "HOSP", kind: "line", parentId: hospital.id, channelId: channel?.id ?? null });
    hospBox = { id: unitId, name: "HOSP", parentId: hospital.id, sort: 0 };
  }
}
const HOSP_TEAMS = ["North & Central Luzon", "NCR 1", "Mindanao", "South Luzon", "NCR 2"];
for (const [index, name] of HOSP_TEAMS.entries()) {
  const team = await unit(name);
  if (team && (!hospBox || team.parentId !== hospBox.id)) {
    say(`${name} moves into HOSP`);
    if (apply && hospBox) await updateUnit(db, me, team.id, { parentId: hospBox.id });
  }
  // In the tracker's order: Julius, Daniel, Claire, Ken, Jim Lord.
  if (team && team.sort !== index + 1) {
    say(`${name} is the ${index + 1}${["st", "nd", "rd"][index] ?? "th"} team in HOSP`);
    if (apply) await db.execute(sql`update org_unit set sort = ${index + 1} where id = ${team.id}`);
  }
}

// ---- Subir: BID led by Subir, B2B under Jessa ----
step("Subir · BID (manager Subir), B2B (manager Jessa Domino), CLIDP (Subir)");
const bidBox = await unit("Government Bidding");
const bidLeadNow = bidBox ? await leadSeat(bidBox.id) : null;
const bidLead = bidLeadNow && (await holderOf(bidLeadNow.id)) !== "Subir Dey" ? bidLeadNow : null;
const subirSeats = await seatsOf("Subir Dey");
if (bidLead) {
  say(`Government Bidding: "${bidLead.title}" (${await holderOf(bidLead.id)}) is no longer its lead; the seat, its work and its tenders desk stay`);
  if (apply) await updateSeat(db, me, bidLead.id, { lead: false });
}
const bidSubir = await leadBy(bidBox, "Subir Dey", "Government Bidding Manager", "manager", bidLead?.id);
if (bidSubir || !apply) await underTheBox([bidBox], subirSeats.filter((seat) => seat.id !== bidSubir?.id).map((seat) => seat.id));

const b2bBox = await unit("B2B Telesales");
const [claireArea] = await rows<{ id: number; seat: number | null }>(
  db,
  sql`select a.id::int as id, (select s.id::int from seat s where s.area_id = a.id and s.active limit 1) as seat from area a where upper(a.name) = 'B2B | CLAIRE' limit 1`,
);
const claireId = await personId("Claire Gallana");
const claireHasB2b = claireId
  ? (await rows<{ n: number }>(db, sql`select count(*)::int as n from seat_holder h join seat s on s.id = h.seat_id and s.active and s.unit_id = ${b2bBox?.id ?? 0} where h.person_id = ${claireId} and h.ends_on is null`))[0]?.n
  : 1;
// Her area from Zoho's names when the database has it; else made with the seat (the live CRM, no Zoho yet).
if (b2bBox && claireId && !claireHasB2b && !claireArea?.seat) {
  say("B2B Telesales: Claire Gallana's own seat (B2B | CLAIRE), a second seat beside her Mindanao one");
  if (apply) {
    const { seatId } = await addSeat(db, me, {
      unitId: b2bBox.id,
      title: "B2B District Sales Coach – Mindanao",
      module: "medrep",
      ...(claireArea ? { areaId: claireArea.id } : { newArea: { name: "B2B | CLAIRE", cities: [] } }),
    });
    await fillSeat(db, me, seatId, { personId: claireId, keepOther: true, reason: `Second seat: ${REASON}` });
  }
}
await vacantSeat(b2bBox, "B2B Sales Person", "B2B | DHON", "Dhon");
await vacantSeat(b2bBox, "B2B Sales Person", "B2B | PILLOW", "Pillow");
await vacantSeat(b2bBox, "B2B Sales Person", "B2B | CHARLE", "Charle");
await vacantSeat(b2bBox, "B2B Sales Person", "B2B | MANI MISHRA", "Mani Mishra");

// Every B2B seller on a side, CRR or NBD (Aryan, 19 Nov: "B2B is CRR and NBD: NBD brings new
// customers, CRR watches that they buy every month and tells NBD when one stops; I don't know yet
// who is which: put one or two in CRR, the rest in NBD, we decide later"). Fritzie is CRR and four
// are NBD on the chart; Claire's B2B seat joins CRR (her Mindanao accounts), the four new seats NBD.
step("Subir · B2B: each seller in CRR or NBD");
const crrBox = await unit("Client Retention & Reorder");
const nbdBox = await unit("New Business Development");
async function side(area: string, box: Unit | null, title: string) {
  if (!box) return;
  const [seat] = await rows<{ id: number; unitId: number; title: string }>(
    db,
    sql`select s.id::int as id, s.unit_id::int as "unitId", s.title from seat s join area a on a.id = s.area_id
      where s.active and upper(a.name) = upper(${area}) limit 1`,
  );
  if (!seat) {
    missing.push(`seat ${area}`);
    return;
  }
  if (seat.unitId === box.id && seat.title === title) return;
  say(`${area}: into ${box.name}, "${title}"`);
  if (apply) await updateSeat(db, me, seat.id, { unitId: box.id, title });
}
await side("B2B | CLAIRE", crrBox, "CRR – Mindanao");
for (const who of ["DHON", "PILLOW", "CHARLE", "MANI MISHRA"]) await side(`B2B | ${who}`, nbdBox, "NBD");

// The sheet's BID rows are Hazel, Angel and Jimmy, their manager Subir (Aryan, 20 Nov: "the sheet
// is the master: who is under whom and what work they do"). Jimmy's seat worked as a team lead
// though it leads nobody: a sales person's now (the bid price is approved by BID's lead, Subir).
step("Subir · BID: Jimmy a sales person, as the sheet's row");
{
  const [seat] = await rows<{ id: number; module: string; lead: boolean }>(
    db,
    sql`select s.id::int as id, s.module, s.lead from seat s join area a on a.id = s.area_id
      where s.active and upper(a.name) = 'BID | JIMMY' limit 1`,
  );
  if (!seat) missing.push("seat BID | JIMMY");
  else if (seat.module !== "medrep" && !seat.lead) {
    say("BID | JIMMY: works as a MedRep of Government Bidding (was a team lead's work, leading nobody)");
    if (apply) await updateSeat(db, me, seat.id, { module: "medrep" });
  }
}

// ---- Mhalou: MT ----
step("Mhalou · MT");
const mtBox = await unit("Modern Trade", "Modern trade");
await vacantSeat(mtBox, "Modern Trade Sales Person", "MT | ARLENE", "Arlene, Zoho's MT | 1");
await vacantSeat(mtBox, "Modern Trade Sales Person", "MT | JASPER", "Jasper, Zoho's MT | 2");

if (missing.length) console.log(`\nNot found (left as it is): ${[...new Set(missing)].join(", ")}`);
console.log(todo ? (apply ? "\nApplied." : `\nDry run: ${todo} changes, nothing written (--apply writes).`) : "\nNothing to change: the tree is as the sheet has it.");
process.exit(0);
