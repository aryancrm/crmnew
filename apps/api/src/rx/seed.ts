// The Prescription channel's demo people, so each seat's screen can be checked: Rosa, the Country
// Mentor (the RX head seat); Lara, the Sales Coach of MD Telesales; Kim, an MD Telesales with a
// few patients (old orders, so refills come due) and two care groups Joy enrolled (one still
// waiting for first contact). Runs once; the demo password as given.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

export async function seedRxTeam(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'kim@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [joy] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'joy@2mg.test'`);
  const [headSeat] = await rows<{ id: number }>(
    db,
    sql`select s.id::int as id from seat s join org_unit u on u.id = s.unit_id
      where u.name = 'Prescription Business' and s.lead and s.active and not exists (select 1 from seat_holder h where h.seat_id = s.id and h.ends_on is null)`,
  );
  const [telesales] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'MD Telesales' and active`);
  if (!naresh || !joy || !telesales) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const demo = async (input: Parameters<typeof addPerson>[2]) => {
    const added = await addPerson(db, ceo, { ...input, password, startsOn: "2025-06-01" });
    await db.execute(sql`update person set must_change_password = false where id = ${added.personId}`);
    return added.personId;
  };
  if (headSeat) await demo({ name: "Rosa", email: "rosa@2mg.test", seatId: headSeat.id });
  await demo({ name: "Lara", email: "lara@2mg.test", unitId: telesales.id, title: "Sales Coach – MD Telesales", module: "team_lead", lead: true });
  const kim = await demo({
    name: "Kim",
    email: "kim@2mg.test",
    unitId: telesales.id,
    title: "MD Telesales – Oncology",
    module: "medrep",
    newArea: { name: "TS | Oncology", cities: [] },
  });
  await projectOrg(db);

  // Kim's patients with the old system's orders: one due tomorrow, one due today, one late.
  const today = todayManila();
  const patients: [string, number[]][] = [
    ["Lourdes Ramos", [29, 59, 89]],
    ["Ernesto Bautista", [31, 61, 91]],
    ["Cecilia Navarro", [50, 80, 110]],
  ];
  for (const [name, ago] of patients) {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, phone, added_by, area_id)
        values (${name}, 'patient', 'Quezon City', '0917 555 01' || lpad((floor(random() * 90) + 10)::text, 2, '0'), ${kim},
          (select area_id from person where id = ${kim})) returning id::int as id`,
    );
    for (const [n, days] of ago.entries()) {
      const [order] = await rows<{ id: number }>(
        db,
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total)
          values (${`demo-ts-${made?.id}-${n}`}, ${`SO-DEMO-${made?.id}-${n}`}, ${made?.id}, ${addDays(today, -days)}::date, 'closed', 1850000)
          returning id::int as id`,
      );
      await db.execute(
        sql`insert into past_order_item (past_order_id, name, qty, unit_price) values (${order?.id}, 'Letrozole 2.5 mg', 30, 61667)`,
      );
    }
  }
  // Joy's care groups: one enrolled five minutes ago (waiting), one Kim answered within ten.
  const doctors = await rows<{ id: number; name: string }>(
    db,
    sql`select id::int as id, name from customer where kind = 'doctor' and area_id = (select area_id from person where id = ${joy.id}) order by id limit 2`,
  );
  const [waiting, answered] = doctors;
  if (waiting)
    await db.execute(
      sql`insert into care_group (doctor_id, name, enrolled_by, consent, patients, enrolled_at)
        values (${waiting.id}, ${`${waiting.name} — GetMeds Prescription Care`}, ${joy.id}, true, 3, now() - interval '5 minutes')`,
    );
  if (answered)
    await db.execute(
      sql`insert into care_group (doctor_id, name, enrolled_by, consent, patients, enrolled_at, telesales_id, first_contact_at, last_activity_at)
        values (${answered.id}, ${`${answered.name} — GetMeds Prescription Care`}, ${joy.id}, true, 5, now() - interval '3 days',
          ${kim}, now() - interval '3 days' + interval '9 minutes', now() - interval '1 day')`,
    );
  return true;
}
