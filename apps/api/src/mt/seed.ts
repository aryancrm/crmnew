// Modern Trade's demo, as the 2026 chart draws it: Malou, the Chief Operating Officer heading
// Modern Trade with nobody under her, two pharmacy chains with old orders and a few listings. Runs
// once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

export async function seedModernTrade(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'malou@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [unit] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'Modern Trade' and active`);
  const medicines = await rows<{ id: number }>(db, sql`select id::int as id from medicine order by id limit 3`);
  if (!naresh || !unit) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const added = await addPerson(db, ceo, {
    name: "Malou",
    email: "malou@2mg.test",
    password,
    unitId: unit.id,
    title: "Chief Operating Officer – Modern Trade",
    module: "manager",
    lead: true,
    newArea: { name: "Modern Trade", cities: [] },
    startsOn: "2025-06-01",
  });
  const malou = added.personId;
  await db.execute(sql`update person set must_change_password = false where id = ${malou}`);
  await projectOrg(db);
  const today = todayManila();
  for (const [n, [name, ago]] of ([
    ["Mercury Drug Corporation (head office)", [20, 50, 80]],
    ["Watsons Personal Care Stores", [75, 105]],
  ] as [string, number[]][]).entries()) {
    const [chain] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, added_by, area_id, payment_terms, payment_days)
        values (${name}, 'drugstore', 'Quezon City', ${malou}, (select area_id from person where id = ${malou}), 'days', 60) returning id::int as id`,
    );
    for (const [k, days] of ago.entries())
      await db.execute(
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total)
          values (${`demo-mt-${n}-${k}`}, ${`SO-MT-${n}-${k}`}, ${chain?.id}, ${addDays(today, -days)}::date, 'closed', 95000000)`,
      );
    for (const [k, medicine] of medicines.entries())
      await db.execute(
        sql`insert into mt_listing (customer_id, medicine_id, branches, listed, added_by) values (${chain?.id}, ${medicine.id}, ${n === 0 ? 120 - k * 30 : 40}, true, ${malou})`,
      );
  }
  return true;
}
