// Puts the 2026 chart's people into the CRM (docs/company-map.units.js, HR's chart of 10 Oct 2026):
// every unit, every seat and the person in it, with the seat's login ID and the company's common
// password (JOIN_PASSWORD, never in the code; nobody has to change it, Aryan 17 Nov 2026). Then
// Zoho's salespeople are tied to their seats (docs/ORG-CHART-2026.md), which moves the customers
// they last sold to under that seat. With --retire-demo, the demo company's people (…@2mg.test)
// leave first, the Admin's login stays; their seats close, their history stays.
//
// Safe to run again: a person already here by name is skipped, a unit already here is reused.
// Dry run by default (prints what it would do); --apply writes.
//
//   TEST_PGLITE_DIR=<a local database> JOIN_PASSWORD=… npx tsx scripts/onboard-company.ts [--apply] [--retire-demo] [--no-zoho]
//   (the live database only with --live and Aryan's word; 17 Nov: live with --no-zoho, no Zoho data yet)
//
// A fresh CRM's boxes (one per channel: "Hospitals", "Doctors"…) are taken over and renamed to the
// chart's, each box gets its channel, and a CEO's seat is made at the top when there is none. Then
// scripts/fix-chart-17nov.ts puts in what the chart file doesn't hold yet (Uro & Onco Care and
// Blood & Bone Care inside the Onco-Hema Division, Claire Gallana beside Jessa Domino).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { sql } from "drizzle-orm";
import { joinPassword } from "../src/auth/password";
import { type Database, rows } from "../src/db/index";
import { addPerson, addSeat, addUnit, fillSeat, fillSeatLogins, projectOrg, updateUnit } from "../src/org/service";
import type { Me, OrgUnitKind, Role } from "../src/types";
import { tieZohoSeller } from "../src/zoho/sellers";
import { openTarget, ROOT } from "./zoho-files";

const apply = process.argv.includes("--apply");
const retireDemo = process.argv.includes("--retire-demo");
// The live CRM gets no Zoho data yet (Aryan, 17 Nov): its people without Zoho's salespeople tied.
const noZoho = process.argv.includes("--no-zoho");
if (!process.env.TEST_PGLITE_DIR && !process.argv.includes("--live")) {
  console.log("Give TEST_PGLITE_DIR (a local database). The live one only with --live, on Aryan's word.");
  process.exit(1);
}
if (apply && !joinPassword()) {
  console.log("Set JOIN_PASSWORD (the company's common password, at least 8 characters).");
  process.exit(1);
}

type ChartSeat = { role: string; who: string; title?: string; places?: string; n?: number };
type ChartUnit = { id: string; parent?: string; name: string; seats?: ChartSeat[] };
const sandbox: { window: { COMPANY_UNITS?: ChartUnit[] } } = { window: {} };
runInNewContext(readFileSync(join(ROOT, "docs/company-map.units.js"), "utf8"), sandbox);
const chart = sandbox.window.COMPANY_UNITS ?? [];

/** Each chart unit: the CRM unit it is (by these names, first found), its kind when made here. */
// `channel`: the channel a box's orders are sold in (as the local database has them); `live`: the
// box a fresh CRM made for that channel ("one box per channel"), taken over and renamed to the chart's.
const UNITS: Record<string, { names: string[]; kind: Exclude<OrgUnitKind, "company">; channel?: string; live?: string[] }> = {
  hospital: { names: ["Hospital Division"], kind: "business", channel: "HOSP", live: ["Hospitals"] },
  "hos-ncr1": { names: ["NCR 1"], kind: "team" },
  "hos-ncr2": { names: ["NCR 2"], kind: "team" },
  "hos-ncl": { names: ["North & Central Luzon"], kind: "team" },
  "hos-sl": { names: ["South Luzon"], kind: "team" },
  "hos-vis": { names: ["Visayas"], kind: "team" },
  "hos-min": { names: ["Mindanao"], kind: "team" },
  "hos-gov": { names: ["Government Account"], kind: "team", channel: "HOSP" },
  "hos-mdts": { names: ["MD Telesales Anesthesia"], kind: "team", channel: "TS" },
  // The PAP desk works on the PAP channel's own box.
  "hos-pap": { names: ["Patient Assistance", "Patient Assistance Program"], kind: "team", channel: "PAP", live: ["Patient assistance"] },
  rx: { names: ["Prescription Business"], kind: "business", channel: "RX", live: ["Doctors"] },
  "rx-onco": { names: ["Onco-Hema Division"], kind: "line" },
  "rx-mdts": { names: ["MD Telesales Oncology", "MD Telesales"], kind: "line", channel: "TS", live: ["Telesales"] },
  "rx-b2c": { names: ["B2C Sales Coaching"], kind: "team", channel: "ONLINE" },
  sm: { names: ["Sales & Marketing", "Sales and Marketing"], kind: "business", channel: "B2B" },
  "sm-clidp": { names: ["CLIDP"], kind: "line", channel: "B2B" },
  "sm-bid": { names: ["Government Bidding"], kind: "line", channel: "BID", live: ["Government tenders"] },
  "sm-b2b": { names: ["B2B Telesales"], kind: "line", channel: "B2B", live: ["Distributors and drugstores"] },
  "sm-crr": { names: ["Client Retention & Reorder"], kind: "team", channel: "B2B" },
  "sm-nbd": { names: ["New Business Development"], kind: "team", channel: "B2B" },
  mt: { names: ["Modern Trade"], kind: "business", channel: "MT", live: ["Modern trade"] },
  exec: { names: ["Executive and Admin"], kind: "department" },
  dm: { names: ["Digital Marketing Coaching Department", "Digital Marketing"], kind: "department" },
  it: { names: ["IT Division"], kind: "department" },
  reg: { names: ["In-licensing & Regulatory Department"], kind: "department" },
  "reg-inl": { names: ["In-licensing"], kind: "line" },
  "reg-ra": { names: ["Regulatory Affairs"], kind: "line" },
  hr: { names: ["HR"], kind: "department" },
  ops: { names: ["Supply Chain, Ops & Finance"], kind: "department" },
  "ops-sc": { names: ["Supply Chain"], kind: "line" },
  "ops-pharm": { names: ["Pharmacy Operations"], kind: "line" },
  "ops-fin": { names: ["Finance Department"], kind: "line" },
};

/** Each chart role: the work it does here, its title, and whether it leads its unit. */
const ROLES: Record<string, { module: Role; title: string; lead?: boolean; area?: "zoho" | "places" }> = {
  "business-mentor": { module: "manager", title: "Business Mentor", lead: true },
  dsc: { module: "team_lead", title: "District Sales Coach", lead: true },
  "hospital-chc": { module: "medrep", title: "Hospital CHC", area: "zoho" },
  "gov-account": { module: "medrep", title: "Government Bidding Coachee", area: "zoho" },
  "md-telesales": { module: "medrep", title: "MD Telesales", area: "zoho" },
  "pap-officer": { module: "medrep", title: "Patient Assistance Program Officer", area: "zoho" },
  "country-mentor": { module: "manager", title: "PH Country Mentor", lead: true },
  "sales-admin": { module: "management", title: "Sales Admin" },
  "rx-chc": { module: "medrep", title: "Rx CHC", area: "places" },
  "telesales-coach": { module: "team_lead", title: "Sales Coach", lead: true },
  "b2c-chc": { module: "online", title: "B2C CHC", area: "zoho" },
  "sm-mentor": { module: "manager", title: "Sales and Marketing Mentor", lead: true },
  "clidp-coach": { module: "medrep", title: "CLIDP Sales Coach", area: "zoho" },
  "bidding-admin": { module: "team_lead", title: "Government Bidding Admin", lead: true },
  "bidding-coachee": { module: "medrep", title: "Government Bidding Coachee", area: "zoho" },
  "inside-coachee": { module: "medrep", title: "Customer Happiness Coachee – Government Bidding", area: "zoho" },
  "b2b-coach": { module: "team_lead", title: "B2B Sales Coach", lead: true },
  crr: { module: "medrep", title: "CRR", area: "zoho" },
  nbd: { module: "medrep", title: "NBD", area: "zoho" },
  coo: { module: "manager", title: "Chief Operating Officer – Modern Trade", lead: true },
  "exec-admin": { module: "staff", title: "Executive and Admin" },
  "digital-marketing": { module: "staff", title: "Digital Marketing" },
  it: { module: "staff", title: "Employee Happiness Coachee" },
  "in-licensing": { module: "regulatory", title: "In-Licensing" },
  regulatory: { module: "regulatory", title: "Regulatory Affairs" },
  hr: { module: "hr", title: "Talent Development & Growth" },
  "training-coach": { module: "hr", title: "Training Coach" },
  "finance-mentor": { module: "finance", title: "Finance Mentor", lead: true },
  "finance-coach": { module: "finance", title: "Finance Coach" },
  "supply-chain": { module: "inventory", title: "Supply Chain" },
  "pharmacy-coach": { module: "dispatch", title: "Pharmacy Happiness Coach", lead: true },
  pharmacist: { module: "dispatch", title: "Company Pharmacist" },
  "pharmacy-coachee": { module: "dispatch", title: "Pharmacy Happiness Coachee" },
  accounting: { module: "finance", title: "Accounting Coach" },
  "finance-coachee": { module: "finance", title: "Finance Coachee" },
};
/** The first person of a department's titles leads it (its Mentor or Coach). */
const LEADS_BY_TITLE = /\b(Mentor)\b|^Executive and Admin Coach$|^Digital Marketing Coach$/;

/** Who sold under which Zoho name (docs/ORG-CHART-2026.md). Names nobody here holds are left for
 *  the heads (RX districts, MSA, people who left). */
const ZOHO: Record<string, string[]> = {
  "Ryan Aninon": ["HOS | PASAY", "HOS | MANILA VACANT"],
  "Luis Jasper Palingping": ["HOS | LAS PINAS"],
  "Ana Mae Otucan": ["HOS | PARANAQUE", "HOS | Ana Mae Otucan"],
  "Patrick Adion": ["HOS | PALAWAN"],
  "Princess Cuerdo": ["HOS | COMMONWEALTH"],
  "Den Jane Suarez": ["HOS | CAMANAVA"],
  "Jacob Cruz": ["HOS | MARIKINA"],
  "Nicole Anne Castillo": ["HOS | TUGUEGARAO"],
  "Paolo Paradero": ["HOS | CABANATUAN"],
  "Gabrielle Agripa": ["HOS | BAGUIO", "Gabby Agripa"],
  "vacant:Pampanga, Bataan, Zambales": ["HOS | PAMPANGA"],
  "Lalien G. Nunez": ["HOS | BICOL"],
  "Clarisse Deocareza": ["HOS | LAGUNA"],
  "Glenn Bernabe": ["HOS | CAVITE"],
  "John Michael Orig": ["HOS | QUEZON PROVINCE"],
  "Andrealyn Bermido": ["HOS | SOUTH CEBU"],
  "Kristofferson Conde": ["HOS | NORTH CEBU"],
  "Jessa Mae Teruel": ["HOS | ILOILO"],
  "Harley Queen Orani": ["HOS | GENSAN"],
  "Rubelyn Ramos": ["HOS | DAVAO NORTH"],
  "Melanie Diaz": ["HOS | CDO"],
  "Welmar Pancho": ["HOS | DAVAO SOUTH"],
  "Maycarl Degamo": ["HOS | ZAMBOANGA"],
  "Reynan Cuenca": ["BID | Reynan Cuenca"],
  "Micah Jimena": ["TeleSales | Micah Jimena"],
  "Aila Zaragoza": ["TeleSales | Aila Jane Zaragosa"],
  "Sheena Correa": ["TeleSales | Sheena Mae Correa"],
  "Paula Pentallana": ["TeleSales | Paula Bianca"],
  "Mary Rose Goron": ["TeleSales | Mary Rose Goron"],
  "Fhaye Norella": ["B2C | Fhaye Norella", "DSWD", "PCSO", "Office of the President"],
  "Mary Jane Viñas": ["B2C | Mary Jane Vinas"],
  "Rachelle Upao": ["B2C | Rachelle Upao"],
  "Ma. Anicia D. Maglatang": ["CLIDP | Annie Maglatang"],
  "Nicka Angelene Masusi": ["CLIDP | NICKA"],
  "Angelica Gollena": ["BID | ANGEL"],
  "Hazel Marie Balano": ["BID | HAZEL"],
  "Fritzie Mier": ["B2B | Fritzie Rosann Mier", "B2B | Fritzie Mier"],
  "Floremel Medina": ["B2B | FLOREMEL TAN MEDINA"],
  "Lonie Ann Neri": ["B2B | LONIE"],
  "Winbelle Faith Gomez": ["B2B | FAITH"],
  // Coaches who sold under their own name: their customers sit under their own seat.
  "Honey Cordero": ["Honey Cordero"],
  "Jimmy Boy Saturinas": ["BID | JIMMY", "B2B | Jimmy Saturinas"],
  "Jessa Domino": ["B2B | Jessa Domino"],
  "Claire Gallana": ["B2B | CLAIRE"],
};

const NAME_FIX: Record<string, string> = { "Gilbert Ca…": "Gilbert Cabujat" };
const cleanName = (raw: string) => (NAME_FIX[raw.trim()] ?? raw.trim()).replace(/\s*\(.*\)\s*$/, "");

type Planned = {
  unit: string;
  role: string;
  module: Role;
  title: string;
  lead: boolean;
  who: string | null;
  places: string | null;
  zoho: string[];
};

/** The chart, seat by seat (a seat with n people is n seats). */
function plan(): Planned[] {
  const out: Planned[] = [];
  for (const unit of chart) {
    if (unit.id === "company") continue;
    for (const seat of unit.seats ?? []) {
      const role = ROLES[seat.role];
      if (!role) throw new Error(`No work for the chart's role ${seat.role}`);
      const names = (seat.n ?? 1) > 1 ? seat.who.split(",").map(cleanName) : [cleanName(seat.who)];
      names.forEach((name, index) => {
        const vacant = /^(vacant|to hire)$/i.test(name);
        const title = seat.title ?? role.title;
        const lead =
          index === 0 &&
          (role.lead === true || (role.lead === undefined && LEADS_BY_TITLE.test(title))) &&
          !(seat.role === "b2b-coach" && seat.places);
        const key = vacant ? `vacant:${seat.places ?? ""}` : name;
        out.push({
          unit: unit.id,
          role: seat.role,
          module: role.module,
          title: seat.places && role.module !== "medrep" && seat.role !== "rx-chc" ? `${title} – ${seat.places}` : title,
          lead,
          who: vacant ? null : name,
          places: seat.places ?? null,
          zoho: ZOHO[key] ?? [],
        });
      });
    }
  }
  return out;
}

const seats = plan();
console.log(`The chart: ${seats.length} seats, ${seats.filter((seat) => seat.who).length} people, ${seats.filter((seat) => !seat.who).length} vacant.`);

const target = await openTarget(false);
if (!target) throw new Error("No database.");
const db: Database = target.db;
console.log(`Into ${target.where}${apply ? "" : " (dry run)"}.`);

const [admin] = await rows<{ id: number; name: string }>(
  db,
  sql`select id::int as id, name from person where role = 'admin' and active order by id limit 1`,
);
if (!admin) throw new Error("No active Admin to do this as.");
const me = {
  id: admin.id,
  name: admin.name,
  email: null,
  title: null,
  role: "admin",
  roleLabel: "Admin",
  mustChangePassword: false,
  channel: null,
  area: null,
  reportsTo: null,
} as Me;

// ---- 1. The demo company leaves (its Admin's login stays) ----
const demo = await rows<{ id: number; name: string; role: Role }>(
  db,
  sql`select id::int as id, name, role from person where active and email like '%@2mg.test' and role <> 'admin' order by id`,
);
console.log(`Demo people to leave: ${retireDemo ? demo.length : 0}${retireDemo ? "" : " (not asked: --retire-demo)"}`);
if (apply && retireDemo && demo.length) {
  const ids = demo.map((person) => person.id);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  await db.transaction(async (tx) => {
    const list = sql.raw(ids.join(","));
    const seatIds = (
      await rows<{ id: number }>(
        tx,
        sql`select distinct seat_id::int as id from seat_holder where person_id in (${list}) and (ends_on is null or ends_on >= ${today}::date)`,
      )
    ).map((row) => row.id);
    await tx.execute(
      sql`update seat_holder set ends_on = greatest(${today}::date - 1, starts_on - 1), end_reason = 'Demo company replaced by the real one', ended_by = ${me.id}
        where person_id in (${list}) and (ends_on is null or ends_on >= ${today}::date)`,
    );
    await tx.execute(sql`update person set active = false where id in (${list})`);
    await tx.execute(sql`delete from session where person_id in (${list})`);
    await tx.execute(
      sql`update employee set status = 'left', left_on = ${today}::date - 1, left_reason = 'Demo company replaced by the real one'
        where person_id in (${list}) and status <> 'left'`,
    );
    // Their seats: the lead and office seats stay to be filled by the real people; the sellers'
    // seats close (the real sellers get their own areas), and the demo areas give up their cities.
    if (seatIds.length) {
      const seatList = sql.raw(seatIds.join(","));
      await tx.execute(
        sql`update area set cities = '{}' where id in (select area_id from seat where id in (${seatList}) and area_id is not null)`,
      );
      await tx.execute(
        sql`update seat set reports_to_seat_id = null where reports_to_seat_id in (select id from seat where id in (${seatList}) and module in ('medrep', 'online'))`,
      );
      await tx.execute(
        sql`update seat set active = false, closed_at = now() where id in (${seatList}) and module in ('medrep', 'online')`,
      );
    }
    await projectOrg(tx, today);
  });
  console.log(`  ${demo.length} demo people left; their sellers' seats closed.`);
}

// ---- 2. Units ----
const unitIds = new Map<string, number>();
const [company] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where kind = 'company' and active`);
unitIds.set("company", company?.id as number);
const madeUnits: string[] = [];
for (const unit of chart) {
  if (unit.id === "company") continue;
  const known = UNITS[unit.id];
  if (!known) throw new Error(`No unit for the chart's ${unit.id}`);
  const lower = known.names.map((name) => name.toLowerCase());
  const [channel] = known.channel ? await rows<{ id: number }>(db, sql`select id::int as id from channel where code = ${known.channel}`) : [];
  const parentId = unitIds.get(unit.parent ?? "company");
  const [found] = await rows<{ id: number; channelId: number | null; parentId: number | null }>(
    db,
    sql`select id::int as id, channel_id::int as "channelId", parent_id::int as "parentId" from org_unit where active and lower(name) in (${sql.join(lower.map((name) => sql`${name}`), sql`, `)}) order by id limit 1`,
  );
  if (found) {
    unitIds.set(unit.id, found.id);
    // A box made before it knew its channel gets it.
    if (apply && channel && !found.channelId) await db.execute(sql`update org_unit set channel_id = ${channel.id} where id = ${found.id}`);
    // A box found somewhere else than the chart has it goes where the chart has it.
    if (apply && parentId && parentId > 0 && found.parentId !== parentId && found.id !== parentId) {
      await updateUnit(db, me, found.id, { parentId });
      madeUnits.push(`${known.names[0]} (moved to its place on the chart)`);
    }
    continue;
  }
  // A fresh CRM's box for this channel ("Hospitals"): taken over, renamed, put in its place.
  const liveNames = (known.live ?? []).map((name) => name.toLowerCase());
  const [taken] = liveNames.length
    ? await rows<{ id: number }>(
        db,
        sql`select id::int as id from org_unit where active and lower(name) in (${sql.join(liveNames.map((name) => sql`${name}`), sql`, `)}) order by id limit 1`,
      )
    : [];
  if (taken) {
    madeUnits.push(`${known.names[0]} (was ${known.live?.join("/")})`);
    if (apply && parentId && parentId > 0)
      await db.execute(
        sql`update org_unit set name = ${known.names[0] as string}, kind = ${known.kind}, parent_id = ${parentId}, channel_id = coalesce(${channel?.id ?? null}, channel_id) where id = ${taken.id}`,
      );
    unitIds.set(unit.id, taken.id);
    continue;
  }
  if (!parentId) throw new Error(`No parent for ${unit.id}`);
  madeUnits.push(known.names[0] as string);
  if (apply) {
    const { unitId } = await addUnit(db, me, { name: known.names[0] as string, kind: known.kind, parentId, channelId: channel?.id ?? null });
    unitIds.set(unit.id, unitId);
  } else unitIds.set(unit.id, -1);
}
console.log(`Units made: ${madeUnits.length ? madeUnits.join(", ") : "none"}`);

// ---- 3. Seats and people ----
type Done = Planned & { status: string; login: string | null; personId: number | null; seatId: number | null; ties: string[] };
const done: Done[] = [];
const byName = new Map<string, number>();
for (const person of await rows<{ id: number; name: string }>(
  db,
  sql`select id::int as id, name from person where active and coalesce(email, '') not like '%@2mg.test'`,
))
  byName.set(person.name.toLowerCase(), person.id);

const freeVacant = async (unitId: number, module: Role, lead: boolean) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const [seat] = await rows<{ id: number }>(
    db,
    sql`select s.id::int as id from seat s where s.unit_id = ${unitId} and s.active and s.module = ${module} and s.lead = ${lead}
      and not exists (select 1 from seat_holder h where h.seat_id = s.id and (h.ends_on is null or h.ends_on >= ${today}::date))
      order by s.id limit 1`,
  );
  return seat?.id ?? null;
};
const areaName = (seat: Planned) =>
  seat.zoho[0] ?? (seat.role === "rx-chc" ? `RX | ${seat.places} | ${seat.who}` : seat.who ? `${seat.title} | ${seat.who}` : `${seat.title} | ${seat.places ?? "vacant"}`);
const citiesOf = (seat: Planned) =>
  seat.role === "hospital-chc" && seat.places ? seat.places.split(",").map((city) => city.trim()).filter(Boolean) : [];

/** Cities already in an area of the unit's channel: a city belongs to one area only. */
async function freeCities(unitId: number, cities: string[]): Promise<string[]> {
  if (!cities.length) return [];
  const taken = await rows<{ city: string }>(
    db,
    sql`with recursive up as (select id, parent_id, channel_id, 0 as depth from org_unit where id = ${unitId}
        union all select u.id, u.parent_id, u.channel_id, up.depth + 1 from org_unit u join up on u.id = up.parent_id where up.depth < 50),
      ch as (select channel_id from up where channel_id is not null order by depth limit 1)
      select lower(unnest(cities)) as city from area where channel_id = (select channel_id from ch)`,
  );
  const used = new Set(taken.map((row) => row.city));
  return cities.filter((city) => !used.has(city.toLowerCase()));
}

for (const seat of seats) {
  const unitId = unitIds.get(seat.unit) as number;
  const row: Done = { ...seat, status: "", login: null, personId: null, seatId: null, ties: [] };
  done.push(row);
  const already = seat.who ? byName.get(seat.who.toLowerCase()) : undefined;
  const holdsIt =
    already &&
    (
      await rows<{ id: number }>(
        db,
        sql`select h.seat_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
          where h.person_id = ${already} and s.unit_id = ${unitId} and s.title = ${seat.title} and (h.ends_on is null or h.ends_on >= current_date) limit 1`,
      )
    ).length > 0;
  if (already && (seat.role !== "finance-mentor" || holdsIt)) {
    row.status = "already here";
    row.personId = already;
    continue;
  }
  if (!seat.who) {
    const [here] = await rows<{ id: number }>(
      db,
      sql`select s.id::int as id from seat s where s.unit_id = ${unitId} and s.active and s.title = ${seat.title}
        and not exists (select 1 from seat_holder h where h.seat_id = s.id and (h.ends_on is null or h.ends_on >= current_date)) limit 1`,
    );
    if (here) {
      Object.assign(row, { status: "vacant seat already here", seatId: here.id });
      continue;
    }
  }
  if (!apply) {
    row.status = seat.who ? "to add" : "vacant seat to add";
    continue;
  }
  const sells = seat.module === "medrep" || seat.module === "online";
  const reuse = sells ? null : await freeVacant(unitId, seat.module, seat.lead);
  // A unit has one lead: a vacant lead seat of other work (the demo's) stops leading.
  if (seat.lead && !reuse)
    await db.execute(
      sql`update seat s set lead = false where s.unit_id = ${unitId} and s.lead and s.active
        and not exists (select 1 from seat_holder h where h.seat_id = s.id and (h.ends_on is null or h.ends_on >= current_date))`,
    );
  if (reuse) await db.execute(sql`update seat set title = ${seat.title} where id = ${reuse}`);
  // An area of that name in the channel already (the demo's "HOS | Pasay"): it is reused, with
  // the chart's cities; else a new one.
  let areaId: number | null = null;
  if (sells) {
    const [same] = await rows<{ id: number }>(
      db,
      sql`with recursive up as (select id, parent_id, channel_id, 0 as depth from org_unit where id = ${unitId}
          union all select u.id, u.parent_id, u.channel_id, up.depth + 1 from org_unit u join up on u.id = up.parent_id where up.depth < 50),
        ch as (select channel_id from up where channel_id is not null order by depth limit 1)
        select a.id::int as id from area a where a.channel_id = (select channel_id from ch) and lower(a.name) = lower(${areaName(seat)})
          and not exists (select 1 from seat x where x.area_id = a.id and x.active)`,
    );
    if (same) {
      areaId = same.id;
      const cities = await freeCities(unitId, citiesOf(seat));
      await db.execute(sql`update area set name = ${areaName(seat)}, cities = string_to_array(${cities.join("|")}, '|') where id = ${same.id}`);
    }
  }
  const newArea = sells && !areaId ? { name: areaName(seat), cities: await freeCities(unitId, citiesOf(seat)) } : null;
  // The Finance Mentor is the COO too: a second seat for the same person.
  if (seat.role === "finance-mentor" && already) {
    const seatId = reuse ?? (await addSeat(db, me, { unitId, title: seat.title, module: seat.module, lead: seat.lead })).seatId;
    await fillSeat(db, me, seatId, { personId: already, keepOther: true, reason: "Also Finance Mentor" });
    Object.assign(row, { status: "second seat", personId: already, seatId });
    continue;
  }
  if (!seat.who) {
    const { seatId } = await addSeat(db, me, {
      unitId,
      title: seat.title,
      module: seat.module,
      lead: seat.lead,
      ...(newArea ? { newArea } : {}),
      ...(areaId ? { areaId } : {}),
    });
    Object.assign(row, { status: "vacant seat added", seatId });
  } else {
    const made = await addPerson(db, me, {
      name: seat.who,
      ...(reuse
        ? { seatId: reuse }
        : { unitId, title: seat.title, module: seat.module, lead: seat.lead, ...(newArea ? { newArea } : {}), ...(areaId ? { areaId } : {}) }),
    });
    byName.set(seat.who.toLowerCase(), made.personId);
    Object.assign(row, { status: reuse ? "added (seat reused)" : "added", personId: made.personId, seatId: made.seatId });
  }
}
// The CEO's seat: the Founder.
const [ceoSeat] = await rows<{ id: number; holder: string | null }>(
  db,
  sql`select s.id::int as id, (select p.name from seat_holder h join person p on p.id = h.person_id and p.active
      where h.seat_id = s.id and (h.ends_on is null or h.ends_on >= current_date) limit 1) as holder
    from seat s where s.active and s.module = 'ceo' order by s.id limit 1`,
);
if (apply && ceoSeat && !ceoSeat.holder && !byName.has("naresh bishnoi")) {
  const made = await addPerson(db, me, { name: "Naresh Bishnoi", seatId: ceoSeat.id });
  byName.set("naresh bishnoi", made.personId);
  console.log("  Naresh Bishnoi in the CEO's seat.");
}
// A fresh CRM has no CEO's seat yet: it is made at the top, leading the company.
if (apply && !ceoSeat && !byName.has("naresh bishnoi")) {
  const companyId = unitIds.get("company") as number;
  const [lead] = await rows<{ id: number }>(db, sql`select id::int as id from seat where unit_id = ${companyId} and active and lead limit 1`);
  const made = await addPerson(db, me, { name: "Naresh Bishnoi", unitId: companyId, module: "ceo", title: "CEO", lead: !lead });
  byName.set("naresh bishnoi", made.personId);
  console.log("  Naresh Bishnoi in a new CEO's seat at the top.");
}
if (apply) await fillSeatLogins(db);

// The demo's seats nobody took, and its boxes left empty, close (their history stays).
if (apply && retireDemo) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`update seat s set active = false, closed_at = now() where s.active
        and exists (select 1 from seat_holder h join person p on p.id = h.person_id where h.seat_id = s.id and p.email like '%@2mg.test' and p.role <> 'admin')
        and not exists (select 1 from seat_holder h where h.seat_id = s.id and (h.ends_on is null or h.ends_on >= current_date))
        and not exists (select 1 from seat x where x.reports_to_seat_id = s.id and x.active)`,
    );
    for (let round = 0; round < 4; round++)
      await tx.execute(
        sql`update org_unit u set active = false where u.active and u.kind <> 'company'
          and not exists (select 1 from seat s where s.unit_id = u.id and s.active)
          and not exists (select 1 from org_unit c where c.parent_id = u.id and c.active)`,
      );
    await projectOrg(tx, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
  });
}

// ---- 4. Zoho's salespeople onto their seats ----
let moved = 0;
for (const row of done) {
  if (!apply || noZoho || !row.zoho.length) continue;
  const seatId =
    row.seatId ??
    (row.personId
      ? (
          await rows<{ id: number }>(
            db,
            sql`select h.seat_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
              where h.person_id = ${row.personId} and (h.ends_on is null or h.ends_on >= current_date) order by h.starts_on limit 1`,
          )
        )[0]?.id
      : null);
  if (!seatId) continue;
  // A seat with no area (a coach's) gets one of its own, named as Zoho named the salesperson.
  const [seatArea] = await rows<{ areaId: number | null; channelId: number | null }>(
    db,
    sql`with recursive up as (select u.id, u.parent_id, u.channel_id, 0 as depth from org_unit u where u.id = (select unit_id from seat where id = ${seatId})
        union all select u.id, u.parent_id, u.channel_id, up.depth + 1 from org_unit u join up on u.id = up.parent_id where up.depth < 50)
      select (select area_id::int from seat where id = ${seatId}) as "areaId",
        (select channel_id::int from up where channel_id is not null order by depth limit 1) as "channelId"`,
  );
  if (seatArea && !seatArea.areaId && seatArea.channelId) {
    const name = row.zoho[0] as string;
    const [area] = await rows<{ id: number }>(
      db,
      sql`insert into area (channel_id, name, cities) values (${seatArea.channelId}, ${name}, '{}')
        on conflict do nothing returning id::int as id`,
    );
    const areaId = area?.id ?? (await rows<{ id: number }>(db, sql`select id::int as id from area where channel_id = ${seatArea.channelId} and lower(name) = lower(${name})`))[0]?.id;
    if (areaId) {
      await db.execute(sql`update seat set area_id = ${areaId} where id = ${seatId}`);
      await db.transaction((tx) => projectOrg(tx, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })));
    }
  }
  for (const name of row.zoho) {
    const [known] = await rows<{ name: string }>(db, sql`select seller as name from zoho_contact where lower(seller) = lower(${name}) limit 1`);
    if (!known) {
      row.ties.push(`${name} (not in Zoho's orders)`);
      continue;
    }
    const result = await tieZohoSeller(db, me, known.name, seatId);
    moved += result.moved;
    row.ties.push(`${known.name} (${result.moved} customers)`);
  }
}

// ---- 5. What each one signs in with ----
if (apply)
  for (const row of done) {
    const [found] = await rows<{ login: string | null }>(
      db,
      sql`select s.login from seat s where s.id = coalesce(${row.seatId}::bigint,
          (select h.seat_id from seat_holder h join seat x on x.id = h.seat_id and x.active
            where h.person_id = ${row.personId}::bigint and (h.ends_on is null or h.ends_on >= current_date) order by h.starts_on limit 1))`,
    );
    row.login = found?.login ?? null;
  }

const counts = done.reduce<Record<string, number>>((all, row) => ({ ...all, [row.status]: (all[row.status] ?? 0) + 1 }), {});
console.log("Seats:", JSON.stringify(counts));
if (apply) console.log(`Zoho's customers moved under their seats: ${moved}`);
const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
if (out) writeFileSync(out, JSON.stringify(done, null, 1));
process.exit(0);
