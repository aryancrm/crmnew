// CLIDP's demo, as the 2026 chart draws it: the CLIDP line under Sales and Marketing with Annie
// (CLIDP Sales Coach) and three distributors buying in bulk under their own listings (one listing
// expiring within 60 days). Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

export async function seedClidp(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'annie@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [business] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'Sales & Marketing' and active`);
  // The listings are distributors' own brands of our sugammadex (as Zoho shows); any medicine if none.
  const [medicine] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from medicine order by (coalesce(generic, name) ilike '%sugammadex%') desc, id limit 1`,
  );
  if (!naresh || !business || !medicine) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const [unit] = await rows<{ id: number }>(
    db,
    sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
      values ('CLIDP', 'line', ${business.id}, (select id from channel where code = 'B2B'), 0) returning id::int as id`,
  );
  const added = await addPerson(db, ceo, {
    name: "Annie",
    email: "annie@2mg.test",
    password,
    unitId: unit?.id,
    title: "CLIDP Sales Coach",
    module: "medrep",
    newArea: { name: "CLIDP", cities: [] },
    startsOn: "2025-06-01",
  });
  const annie = added.personId;
  await db.execute(sql`update person set must_change_password = false where id = ${annie}`);
  await projectOrg(db);
  const today = todayManila();
  const accounts: [string, number[], string, number][] = [
    ["Medserve Pharmaceutical Products Wholesaling", [25, 55, 86], "Aemadex 200", 40],
    ["Bansan Pharma Distributor", [50, 80, 112], "Godagamet 200", 400],
    ["Kaufmann Pharma Inc.", [20, 70, 120], "Sugamacen 200", 30],
  ];
  for (const [n, [name, ago, brand, validDays]] of accounts.entries()) {
    const [customer] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, phone, added_by, area_id, payment_terms, payment_days)
        values (${name}, 'distributor', 'Manila', '(02) 8555 0101', ${annie}, (select area_id from person where id = ${annie}), 'days', 30)
        returning id::int as id`,
    );
    for (const [k, days] of ago.entries())
      await db.execute(
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total)
          values (${`demo-clidp-${n}-${k}`}, ${`SO-CLIDP-${n}-${k}`}, ${customer?.id}, ${addDays(today, -days)}::date, 'closed', 680000000)`,
      );
    await db.execute(
      sql`insert into clidp_listing (customer_id, medicine_id, brand, certificate_no, valid_until, added_by)
        values (${customer?.id}, ${medicine.id}, ${brand}, ${`CLIDP-2025-00${n + 1}`}, ${addDays(today, validDays)}::date, ${annie})`,
    );
  }
  return true;
}
