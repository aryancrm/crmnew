// Two more boxes of the Hospital Division as the 2026 chart draws them, so their screens can be
// checked: MD Telesales Anesthesia (Ana; no coach on the chart: she reports to the Business Mentor)
// and Government Account (Rey, a Government Bidding Coachee for government hospitals). Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

export async function seedHospitalBoxes(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'ana@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [hospital] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'Hospital Division' and active`);
  if (!naresh || !hospital) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const unit = async (name: string, channel: string, sort: number) => {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
        values (${name}, 'team', ${hospital.id}, (select id from channel where code = ${channel}), ${sort}) returning id::int as id`,
    );
    return made?.id as number;
  };
  const anesthesia = await unit("MD Telesales Anesthesia", "TS", 8);
  const government = await unit("Government Account", "HOSP", 7);
  for (const [name, unitId, title, area] of [
    ["Ana", anesthesia, "MD Telesales – Anesthesia", "Telesales Anesthesia"],
    ["Rey", government, "Government Bidding Coachee", "Government Account"],
  ] as const) {
    const added = await addPerson(db, ceo, {
      name,
      email: `${name.toLowerCase()}@2mg.test`,
      password,
      unitId,
      title,
      module: "medrep",
      newArea: { name: area, cities: [] },
      startsOn: "2025-06-01",
    });
    await db.execute(sql`update person set must_change_password = false where id = ${added.personId}`);
  }
  await projectOrg(db);
  return true;
}
