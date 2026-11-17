// Three places the CRM's chart differed from HR's 2026 chart (checked against the PDF, 17 Nov):
// the Patient Assistance Program sits in the Hospital Division (under its Business Mentor); MD
// Telesales Oncology sits inside the Onco-Hema Division, beside its Uro & Onco Care and Blood &
// Bone Care; Claire Gallana (B2B District Sales Coach – Mindanao) sits beside Jessa Domino under
// B2B Telesales, not under her. Safe to run again. Dry run unless --apply.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/fix-chart-17nov.ts [--apply]
//   npx tsx scripts/fix-chart-17nov.ts --live [--apply]      (Aryan asked for it on live, 17 Nov)

import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { addUnit, updateSeat, updateUnit } from "../src/org/service";
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
const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' and active order by id limit 1`);
const me = { id: admin?.id, name: "Admin", role: "admin", channel: null, area: null } as unknown as Me;

const unit = async (names: string[], parentName?: string) =>
  (
    await rows<{ id: number; parentId: number | null; parent: string | null }>(
      db,
      sql`select u.id::int as id, u.parent_id::int as "parentId", p.name as parent from org_unit u left join org_unit p on p.id = u.parent_id
        where u.active and lower(u.name) in (${sql.join(names.map((n) => sql`${n.toLowerCase()}`), sql`, `)})
          ${parentName ? sql`and lower(p.name) = ${parentName.toLowerCase()}` : sql``}
        order by u.id limit 1`,
    )
  )[0];
const seatOf = async (name: string) =>
  (
    await rows<{ id: number; unitId: number; reportsTo: number | null }>(
      db,
      sql`select s.id::int as id, s.unit_id::int as "unitId", s.reports_to_seat_id::int as "reportsTo" from seat s
        join seat_holder h on h.seat_id = s.id and h.ends_on is null join person p on p.id = h.person_id and p.active
        where p.name = ${name} and s.active order by s.id limit 1`,
    )
  )[0];
const say = (what: string) => console.log(`${apply ? "" : "would: "}${what}`);

// 1. The Patient Assistance Program into the Hospital Division.
const hospital = await unit(["Hospital Division"]);
const pap = await unit(["Patient Assistance Program", "Patient Assistance", "Patient assistance"]);
if (hospital && pap && pap.parentId !== hospital.id) {
  say(`move ${pap.parent ? `out of ${pap.parent} ` : ""}into the Hospital Division: Patient Assistance Program`);
  if (apply) await updateUnit(db, me, pap.id, { parentId: hospital.id, name: "Patient Assistance Program" });
}

// 2. Inside the Onco-Hema Division: Uro & Onco Care, Blood & Bone Care, MD Telesales Oncology.
const onco = await unit(["Onco-Hema Division"]);
if (onco) {
  const lineIn = async (name: string) => {
    const have = await unit([name], "Onco-Hema Division");
    if (have) return have.id;
    say(`add ${name} inside the Onco-Hema Division`);
    return apply ? (await addUnit(db, me, { name, kind: "line", parentId: onco.id })).unitId : -1;
  };
  const uro = await lineIn("Uro & Onco Care");
  const blood = await lineIn("Blood & Bone Care");
  const people: [string, number][] = [
    ...["Angelica Mae Saludes", "Eloisa Villanda", "Noel Valencia", "Gienel Carlos", "Kevin Sean Apid", "Allysa Mae Madera", "Antonette Lawas", "Jice Joyce Fajardo", "Meryanie Arcangel"].map((n): [string, number] => [n, uro]),
    ...["Merry Joyce Sebastian", "Marwin Dy"].map((n): [string, number] => [n, blood]),
  ];
  for (const [name, to] of people) {
    const seat = await seatOf(name);
    if (!seat || seat.unitId === to) continue;
    say(`${name} into ${to === uro ? "Uro & Onco Care" : "Blood & Bone Care"}`);
    if (apply) await updateSeat(db, me, seat.id, { unitId: to });
  }
  const mdts = await unit(["MD Telesales Oncology", "MD Telesales"], "Prescription Business");
  if (mdts) {
    say("move MD Telesales into the Onco-Hema Division, as MD Telesales Oncology");
    if (apply) await updateUnit(db, me, mdts.id, { parentId: onco.id, name: "MD Telesales Oncology" });
  }
}

// 3. Claire Gallana beside Jessa Domino: both under the Sales and Marketing Mentor.
const claire = await seatOf("Claire Gallana");
const subir = await seatOf("Subir Dey");
if (claire && subir && claire.reportsTo !== subir.id) {
  say("Claire Gallana reports to Subir Dey (beside Jessa Domino)");
  if (apply) await updateSeat(db, me, claire.id, { reportsToSeatId: subir.id });
}
if (!apply) console.log("Nothing written. Add --apply to do it.");
process.exit(0);
