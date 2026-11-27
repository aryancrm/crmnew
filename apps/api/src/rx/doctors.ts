// The orders that came through a doctor, one list for every screen that counts doctors (Aryan,
// 27 Nov: "doctors are of two kinds: Doctor dispense, the doctor buys from us and pays then or
// later; Doctor referral, the doctor tells the patient to buy from us. Build everything on it",
// PLAN 252 and 254). An order came through a doctor when a doctor bought it (the buyer is a doctor)
// or a doctor is named on it (the patient's prescription). This CRM's orders and Zoho's history.
// The doctor is the one named on the order, else the doctor who bought; one doctor by their name as
// written (capitals and spaces aside), as Zoho's orders keep only the typed name (Prescription
// sales, the Rx CHC's scorecard). Each order counts for its seat's holder on its day; an order from
// before the seat was filled, for its first holder after (as My KPIs counts sales).

import { type SQL, sql } from "drizzle-orm";
import { type Database, requestMemo, rows } from "../db/index";

/** The guarantee letters' agencies, as the order's Source says them. */
export const GL_SOURCES = ["DSWD", "PCSO", "Office of the President", "IAPF", "Malasakit"] as const;

/** Every order that came through a doctor (only those on `seats`, when given): seat, the doctor
 *  and their key, the day, the total (centavos), the CRM's doctor (when known), the Source and the
 *  buyer (the doctor dispensing, or the patient a doctor sent). */
export function doctorOrders(seats?: SQL): SQL {
  const crmSeats = seats ? sql`and o.seat_id in (${seats})` : sql``;
  const zohoSeats = seats ? sql`and zs.seat_id in (${seats})` : sql``;
  const placed = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  return sql`(
      select o.seat_id as seat, coalesce(d.name, c.name) as doctor, lower(trim(coalesce(d.name, c.name))) as dkey, ${placed} as day,
        o.total::float8 as total, coalesce(o.doctor_id, case when c.kind = 'doctor' then c.id end) as doctor_id, o.source as way,
        o.customer_id as buyer
      from sales_order o join customer c on c.id = o.customer_id left join customer d on d.id = o.doctor_id
      where o.status not in ('draft', 'cancelled') and (o.doctor_id is not null or c.kind = 'doctor') ${crmSeats}
      union all
      select zs.seat_id, coalesce(nullif(trim(p.doctor), ''), c.name), lower(trim(coalesce(nullif(trim(p.doctor), ''), c.name))), p.ordered_on,
        p.total::float8, case when nullif(trim(p.doctor), '') is null and c.kind = 'doctor' then c.id end, p.source,
        p.customer_id
      from past_order p join zoho_seller zs on zs.name = p.seller left join customer c on c.id = p.customer_id
      where p.status <> 'void' and (nullif(trim(p.doctor), '') is not null or c.kind = 'doctor') ${zohoSeats}
    )`;
}

/** The person an order on a seat counts for: the seat's holder on the day, else its first holder
 *  after (a sale from before the seat was filled), as My KPIs counts the sales. */
export const holderOn = (seat: SQL, day: SQL): SQL =>
  sql`coalesce(
    (select h.person_id from seat_holder h where h.seat_id = ${seat} and h.kind = 'holder' and h.starts_on <= ${day}
      and (h.ends_on is null or h.ends_on >= ${day}) order by h.starts_on desc limit 1),
    (select h.person_id from seat_holder h where h.seat_id = ${seat} and h.kind = 'holder' and h.starts_on > ${day}
      order by h.starts_on, h.id limit 1))`;

/** A person's doctors in a month, for the Rx CHC's scorecard. */
export type DoctorMonth = {
  /** Doctors whose first order with us (anywhere in the company) came this month, through them. */
  newDoctors: number;
  /** Doctors with an order through them last month, and of those, with an order again this month. */
  lastDoctors: number;
  doctorsBack: number;
  /** Guarantee-letter orders (DSWD, PCSO…) through them this month. */
  letters: number;
};

const monthBefore = (first: string) => {
  const [y, m] = first.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};

/** Everyone's doctors for the month (the 1st to `upTo`), worked out once in a reading request. */
export function doctorsByPerson(db: Database, first: string, upTo: string): Promise<Map<number, DoctorMonth>> {
  return requestMemo(`doctors-by-person:${first}:${upTo}`, async () => {
    const before = monthBefore(first);
    const glList = sql.join(
      GL_SOURCES.map((one) => sql`${one}`),
      sql`, `,
    );
    const found = await rows<DoctorMonth & { personId: number }>(
      db,
      sql`with d as materialized ${doctorOrders()},
        firsts as materialized (select dkey, min(day) as since from d group by dkey),
        m as materialized (select d.dkey, d.day, ${holderOn(sql`d.seat`, sql`d.day`)} as person from d
          where d.day between ${before}::date and ${upTo}::date),
        cur as materialized (select distinct person, dkey from m where day >= ${first}::date),
        last as materialized (select distinct person, dkey from m where day < ${first}::date),
        again as materialized (select distinct dkey from d where day between ${first}::date and ${upTo}::date),
        letters as materialized (
          select ${holderOn(sql`x.seat`, sql`x.day`)} as person, count(*)::int as n from (
            select zs.seat_id as seat, p.ordered_on as day from past_order p join zoho_seller zs on zs.name = p.seller
            where p.status <> 'void' and p.source in (${glList}) and p.ordered_on between ${first}::date and ${upTo}::date
          ) x group by 1),
        people as (select person from cur union select person from last union select person from letters)
      select pp.person::int as "personId",
        (select count(*) from cur n join firsts f on f.dkey = n.dkey where n.person = pp.person and f.since >= ${first}::date)::int as "newDoctors",
        (select count(*) from last l where l.person = pp.person)::int as "lastDoctors",
        (select count(*) from last l where l.person = pp.person and l.dkey in (select dkey from again))::int as "doctorsBack",
        coalesce((select sum(t.n) from letters t where t.person = pp.person), 0)::int as letters
      from people pp where pp.person is not null`,
    );
    return new Map(found.map(({ personId, ...month }) => [personId, month]));
  });
}
