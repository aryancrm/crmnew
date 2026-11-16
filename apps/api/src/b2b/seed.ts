// B2B Telesales' demo, as the 2026 chart draws it, so each seat's screen can be checked: Sam the
// Sales and Marketing Mentor, Jess the B2B Sales Coach, the CRR and NBD teams under B2B
// Telesales with Fritz (CRR) and Flor (NBD). Flor has three prospects (one never called, one
// called with papers missing, one with all papers); Fritz has four accounts with old orders (one
// due this week, one late, one stopped, one buying less than before). Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

export async function seedB2bTeam(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'flor@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [business] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'Sales & Marketing' and active`);
  const [b2b] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'B2B Telesales' and active`);
  if (!naresh || !business || !b2b) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  // The chart's Sales and Marketing business sells business to business.
  await db.execute(sql`update org_unit set channel_id = (select id from channel where code = 'B2B') where id = ${business.id} and channel_id is null`);
  const unit = async (name: string) => {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
        values (${name}, 'team', ${b2b.id}, (select id from channel where code = 'B2B'), 1) returning id::int as id`,
    );
    return made?.id as number;
  };
  const crrUnit = await unit("Client Retention & Reorder");
  const nbdUnit = await unit("New Business Development");
  const demo = async (input: Parameters<typeof addPerson>[2]) => {
    const added = await addPerson(db, ceo, { ...input, password, startsOn: "2025-06-01" });
    await db.execute(sql`update person set must_change_password = false where id = ${added.personId}`);
    return added.personId;
  };
  await demo({ name: "Sam", email: "sam@2mg.test", unitId: business.id, title: "Sales and Marketing Mentor", module: "manager", lead: true });
  await demo({ name: "Jess", email: "jess@2mg.test", unitId: b2b.id, title: "B2B Sales Coach", module: "team_lead", lead: true });
  const fritz = await demo({ name: "Fritz", email: "fritz@2mg.test", unitId: crrUnit, title: "CRR", module: "medrep", newArea: { name: "B2B CRR", cities: [] } });
  const flor = await demo({ name: "Flor", email: "flor@2mg.test", unitId: nbdUnit, title: "NBD", module: "medrep", newArea: { name: "B2B NBD", cities: [] } });
  await projectOrg(db);

  const today = todayManila();
  const business_ = async (name: string, kind: string, by: number, papers: { licence?: boolean; permit?: boolean; tin?: boolean } = {}) => {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, phone, added_by, licence_no, licence_expires, permit_no, permit_expires, tin)
        values (${name}, ${kind}, 'Pasig', '(02) 8700 1234', ${by},
          ${papers.licence ? "CDRR-NCR-DS-12345" : null}, ${papers.licence ? addDays(today, 300) : null}::date,
          ${papers.permit ? "BP-2026-0042" : null}, ${papers.permit ? addDays(today, 200) : null}::date,
          ${papers.tin ? "123-456-789-000" : null})
        returning id::int as id`,
    );
    return made?.id as number;
  };
  // Flor's prospects.
  const fresh = await business_("Botika ng Bayan Marikina", "drugstore", flor);
  const called = await business_("Medcare Distributors Inc.", "distributor", flor, { licence: true });
  const ready = await business_("San Roque Pharmacy", "drugstore", flor, { licence: true, permit: true, tin: true });
  for (const id of [fresh, called, ready])
    await db.execute(sql`insert into b2b_account (customer_id, nbd_id, next_call_on) values (${id}, ${flor}, ${today}::date)`);
  await db.execute(
    sql`insert into account_call (customer_id, by_person, outcome, note, next_on, at)
      values (${called}, ${flor}, 'call_back', 'Owner asks for the price list first', ${today}::date, now() - interval '2 days'),
             (${ready}, ${flor}, 'reached', 'Papers sent by email; first order next week', ${addDays(today, 3)}::date, now() - interval '1 day')`,
  );
  await db.execute(sql`update b2b_account set next_call_on = ${addDays(today, 3)}::date where customer_id = ${ready}`);

  // Fritz's accounts (handed over), each with the old system's orders.
  const accounts: [string, number[], number][] = [
    ["Mercury Drug Pasig Branch", [27, 55, 83, 111], 4500000],
    ["Rose Pharmacy Ortigas", [45, 73, 101], 2800000],
    ["Generika Kapitolyo", [120, 148, 176], 1900000],
    ["Southstar Drug Libis", [14, 40, 70, 95, 125], 6200000],
  ];
  for (const [n, [name, ago, total]] of accounts.entries()) {
    const id = await business_(name, "drugstore", flor, { licence: true, permit: true, tin: true });
    await db.execute(
      sql`insert into b2b_account (customer_id, nbd_id, crr_id, handed_over_at, handed_over_by)
        values (${id}, ${flor}, ${fritz}, now() - interval '200 days', ${flor})`,
    );
    for (const [k, days] of ago.entries())
      await db.execute(
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total)
          values (${`demo-b2b-${n}-${k}`}, ${`SO-B2B-${n}-${k}`}, ${id}, ${addDays(today, -days)}::date, 'closed',
            ${n === 3 && k === 0 ? Math.round(total / 4) : total})`,
      );
  }
  return true;
}
