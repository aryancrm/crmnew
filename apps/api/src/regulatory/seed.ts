// In-licensing & Regulatory's demo, as the 2026 chart draws it: Esther (In-licensing Mentor) and
// Dhebbie (In-licensing Executive); Ivy (Regulatory Affairs Mentor) and Alikka (Regulatory Affairs
// Pharmacist). A pipeline at different stages, and CPRs for medicines we sell: one running out in
// two months, one in five, one safe, one renewal filed. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

const DEPT = "In-licensing & Regulatory Department";
const PEOPLE = [
  ["In-licensing", "Esther", "esther", "In-licensing Mentor", true],
  ["In-licensing", "Dhebbie", "dhebbie", "In-licensing Executive", false],
  ["Regulatory Affairs", "Ivy", "ivy", "Regulatory Affairs Mentor", true],
  ["Regulatory Affairs", "Alikka", "alikka", "Regulatory Affairs Pharmacist", false],
] as const;

export async function seedRegulatory(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'esther@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [company] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where kind = 'company'`);
  if (!naresh || !company) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const unitOf = async (name: string, kind: string, parentId: number) => {
    const [have] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where parent_id = ${parentId} and lower(name) = lower(${name}) and active`);
    if (have) return have.id;
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into org_unit (name, kind, parent_id, sort) values (${name}, ${kind}, ${parentId}, 95) returning id::int as id`,
    );
    return made?.id as number;
  };
  const dept = await unitOf(DEPT, "department", company.id);
  const ids: Record<string, number> = {};
  for (const [team, name, login, title, lead] of PEOPLE) {
    const added = await addPerson(db, ceo, {
      name, email: `${login}@2mg.test`, password, unitId: await unitOf(team, "line", dept), title, module: "regulatory", lead, startsOn: "2025-06-01",
    });
    ids[login] = added.personId;
    await db.execute(sql`update person set must_change_password = false where id = ${added.personId}`);
  }
  await projectOrg(db);
  const today = todayManila();
  for (const [name, generic, strength, partner, country, stage, who, next, inDays] of [
    ["Bortezomib", "Bortezomib", "3.5 mg", "Hetero Labs", "India", "talks", "dhebbie", "Price offer back from the partner", 5],
    ["Pemetrexed", "Pemetrexed", "500 mg", "Dr. Reddy's", "India", "agreement", "esther", "Ask for the CTD dossier", -2],
    ["Azacitidine", "Azacitidine", "100 mg", "Natco Pharma", "India", "dossier", "dhebbie", "Dossier handed to Regulatory Affairs", 10],
    ["Fulvestrant", "Fulvestrant", "250 mg/5 mL", null, null, "identified", "dhebbie", "Find a partner", 14],
  ] as [string, string, string, string | null, string | null, string, string, string, number][]) {
    const [p] = await rows<{ id: number }>(
      db,
      sql`insert into pipeline_product (name, generic, strength, partner, country, stage, handled_by, next_step, next_on, added_by)
        values (${name}, ${generic}, ${strength}, ${partner}, ${country}, ${stage}, ${ids[who]}, ${next}, ${addDays(today, inDays)}::date, ${ids.esther})
        returning id::int as id`,
    );
    await db.execute(sql`insert into reg_event (pipeline_id, what, by_person) values (${p?.id}, 'Added', ${ids.esther})`);
    if (stage === "dossier") {
      const [r] = await rows<{ id: number }>(
        db,
        sql`insert into product_registration (pipeline_id, product, status, handled_by, added_by)
          values (${p?.id}, ${`${name} ${strength}`}, 'preparing', ${ids.alikka}, ${ids.esther}) returning id::int as id`,
      );
      await db.execute(sql`insert into reg_event (pipeline_id, registration_id, what, by_person) values (${p?.id}, ${r?.id}, 'Handed to Regulatory Affairs: registration opened', ${ids.esther})`);
    }
  }
  const medicines = await rows<{ id: number; name: string }>(
    db,
    sql`select id::int as id, name || coalesce(' ' || strength, '') as name from medicine where active order by id limit 4`,
  );
  for (const [k, m] of medicines.entries()) {
    const [status, validIn, filedAgo] = ([["approved", 60, null], ["approved", 150, null], ["approved", 900, null], ["renewal_filed", 40, 30]] as const)[k] ?? ["approved", 700, null];
    const [r] = await rows<{ id: number }>(
      db,
      sql`insert into product_registration (medicine_id, product, number, status, filed_on, valid_until, handled_by, added_by)
        values (${m.id}, ${m.name}, ${`DR-XY${48210 + k}`}, ${status}, ${filedAgo ? addDays(today, -filedAgo) : null}::date,
          ${addDays(today, validIn)}::date, ${k % 2 ? ids.alikka : ids.ivy}, ${ids.ivy}) returning id::int as id`,
    );
    await db.execute(sql`insert into reg_event (registration_id, what, by_person) values (${r?.id}, 'Added', ${ids.ivy})`);
  }
  return true;
}
