// Prescription sales (Aryan, 19 Nov: "press RX: Honey, her whole team, what the team is doing and
// where, right now; the sales they made, A to Z"; renamed and made plain on 27 Nov, PLAN 250): the
// orders that came with a doctor's prescription, this month. Each person's prescriptions, the
// doctors who wrote them and how many for the first time, the value; their day (visits planned and
// done today, the last check-in and where); the doctors prescribing most; and the guarantee letters
// by agency (DSWD, PCSO, the Office of the President…) from received to delivered, billed and paid.
// A seller sees their own; a lead their team (the box picked); the CEO and the Admin any box.
//
// A doctor is the doctor on this CRM's order; Zoho's history has only the name typed on each order,
// read as typed. The business's totals count each doctor once, not once per seller.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { Me, RxBusiness } from "../types";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const ids = (list: number[]): SQL => (list.length ? sql.join(list.map((id) => sql`${id}`), sql`, `) : sql`0`);

export async function rxBusiness(db: Database, me: Me): Promise<RxBusiness> {
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  let seatIds: number[];
  if (me.role === "medrep") {
    seatIds = (
      await rows<{ id: number }>(
        db,
        sql`select h.seat_id::int as id from seat_holder h where h.person_id = ${me.id} and ${inForce("h", today)}`,
      )
    ).map((one) => one.id);
  } else {
    if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "The prescription business is the sellers' and their leads'.");
    seatIds = (await teamSeats(db, me, me.unit ?? null)).seatIds;
  }
  const empty: RxBusiness = {
    today,
    summary: {
      prescriptions: 0,
      prescribers: 0,
      newPrescribers: 0,
      value: 0,
      visitsToday: 0,
      visitsDoneToday: 0,
      glOpen: 0,
      glOpenAmount: 0,
      glPaid: 0,
      lastOrderOn: null,
    },
    people: [],
    doctors: [],
    letters: [],
  };
  if (!seatIds.length) return empty;
  const seats = ids(seatIds);
  const placed = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  // Every order written with a prescribing doctor: this CRM's (the doctor on the order) and Zoho's
  // history (the doctor's name on it, its salesperson tied to a seat), one doctor by their name.
  const rx = sql`(
      select o.seat_id as seat, d.name as doctor, lower(trim(d.name)) as dkey, ${placed} as day, o.total::float8 as total,
        o.doctor_id as doctor_id
      from sales_order o join customer d on d.id = o.doctor_id
      where o.seat_id in (${seats}) and o.status not in ('draft', 'cancelled')
      union all
      select zs.seat_id, trim(p.doctor), lower(trim(p.doctor)), p.ordered_on, p.total::float8, null::bigint
      from past_order p join zoho_seller zs on zs.name = p.seller
      where zs.seat_id in (${seats}) and p.doctor is not null and trim(p.doctor) <> '' and p.status <> 'void'
    )`;
  // The guarantee letters' programmes (the order's source, as the hub and Zoho wrote it).
  const PROGRAMMES = ["DSWD", "PCSO", "Office of the President", "IAPF", "Malasakit", "Other"];
  const programmeList = sql.join(PROGRAMMES.map((one) => sql`${one}`), sql`, `);
  const [people, totals, doctors, letters] = await Promise.all([
    // Each seat of the box: its seller (an empty seat with prescriptions this month too, so the
    // rows add up to the business's totals).
    rows<RxBusiness["people"][number]>(
      db,
      sql`with rx as materialized ${rx}, firsts as materialized (select seat, dkey, min(day) as since from rx group by seat, dkey)
        select s.id::int as "seatId", p.id::int as "personId", coalesce(p.name, 'Empty seat') as name, s.title, a.name as area,
          (select count(*) from visit v where v.seat_id = s.id and v.day = ${today}::date)::int as "visitsToday",
          (select count(*) from visit v where v.seat_id = s.id and v.day = ${today}::date and v.status = 'done')::int as "doneToday",
          (select c.name from visit v join customer c on c.id = v.customer_id where v.seat_id = s.id and v.checked_in_at is not null
            order by v.checked_in_at desc limit 1) as "lastCheckIn",
          (select to_char(max(v.checked_in_at) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') from visit v where v.seat_id = s.id) as "lastCheckInAt",
          (select count(*) from rx where rx.seat = s.id and rx.day >= ${first}::date)::int as prescriptions,
          (select count(distinct rx.dkey) from rx where rx.seat = s.id and rx.day >= ${first}::date)::int as prescribers,
          (select count(*) from firsts f where f.seat = s.id and f.since >= ${first}::date)::int as "newPrescribers",
          coalesce((select sum(rx.total) from rx where rx.seat = s.id and rx.day >= ${first}::date), 0)::float8 as value,
          ((select count(*) from sales_order o where o.seat_id = s.id and o.order_type = 'gl' and o.status not in ('draft', 'cancelled')
              and ${placed} >= ${first}::date)
            + (select count(*) from past_order po join zoho_seller zs on zs.name = po.seller
              where zs.seat_id = s.id and po.source in (${programmeList}) and po.status <> 'void' and po.ordered_on >= ${first}::date))::int as letters
        from seat s
          left join lateral (select h.person_id from seat_holder h where h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
            order by h.starts_on desc, h.id desc limit 1) held on true
          left join person p on p.id = held.person_id
          left join area a on a.id = s.area_id
        where s.id in (${seats}) and s.active
          and ((s.module = 'medrep' and p.id is not null) or exists (select 1 from rx where rx.seat = s.id and rx.day >= ${first}::date))
        order by 3`,
    ),
    // The business's own totals: each doctor once, however many sellers they wrote through.
    rows<{ prescriptions: number; value: number; prescribers: number; newPrescribers: number; lastOrderOn: string | null }>(
      db,
      sql`with rx as materialized ${rx}
        select (select count(*) from rx where day >= ${first}::date)::int as prescriptions,
          coalesce((select sum(total) from rx where day >= ${first}::date), 0)::float8 as value,
          (select count(distinct dkey) from rx where day >= ${first}::date)::int as prescribers,
          (select count(*) from (select dkey from rx group by dkey having min(day) >= ${first}::date) f)::int as "newPrescribers",
          (select to_char(max(day), 'YYYY-MM-DD') from rx) as "lastOrderOn"`,
    ),
    // The doctors prescribing most in the last 90 days.
    rows<RxBusiness["doctors"][number]>(
      db,
      sql`with rx as materialized ${rx}
        select max(rx.doctor_id)::int as "customerId", max(rx.doctor) as name,
          (select c.specialty from customer c where c.id = max(rx.doctor_id)) as specialty,
          (select c.city from customer c where c.id = max(rx.doctor_id)) as city,
          (select pe.name from seat_holder h join person pe on pe.id = h.person_id
            where h.seat_id = (array_agg(rx.seat order by rx.day desc))[1] and h.kind = 'holder' and h.ends_on is null
            order by h.starts_on desc limit 1) as seller,
          count(*) filter (where rx.day > ${addDays(today, -90)}::date)::int as orders,
          coalesce(sum(rx.total) filter (where rx.day > ${addDays(today, -90)}::date), 0)::float8 as value,
          to_char(max(rx.day), 'YYYY-MM-DD') as "lastOn", to_char(min(rx.day), 'YYYY-MM-DD') as "firstOn"
        from rx group by rx.dkey
        having count(*) filter (where rx.day > ${addDays(today, -90)}::date) > 0
        order by value desc limit 20`,
    ),
    // Guarantee letters by agency (the last 12 months): this CRM's from received to paid, Zoho's
    // history as served.
    rows<{ programme: string; stage: "received" | "serving" | "billed" | "paid" | "zoho"; count: number; amount: number }>(
      db,
      sql`select programme, stage, count(*)::int as count, sum(amount)::float8 as amount from (
          select coalesce(nullif(o.source, ''), 'Not said') as programme,
            case
              when o.status = 'completed' and not exists (select 1 from invoice i where i.order_id = o.id and i.status = 'open' and i.total > i.paid) then 'paid'
              when o.status = 'completed' then 'billed'
              when o.status in ('pending_approval', 'on_hold', 'exception') then 'received'
              else 'serving' end as stage,
            coalesce(o.gl_amount, o.total) as amount
          from sales_order o
          where o.seat_id in (${seats}) and o.order_type = 'gl' and o.status not in ('draft', 'cancelled')
            and ${placed} > ${addDays(today, -365)}::date
          union all
          select po.source, 'zoho', po.total from past_order po join zoho_seller zs on zs.name = po.seller
          where zs.seat_id in (${seats}) and po.source in (${programmeList}) and po.status <> 'void'
            and po.ordered_on > ${addDays(today, -365)}::date
        ) x group by 1, 2`,
    ),
  ]);
  const programmes = [...new Set(letters.map((one) => one.programme))];
  const byProgramme: RxBusiness["letters"] = programmes.map((programme) => {
    const of = (stage: "received" | "serving" | "billed" | "paid" | "zoho") =>
      letters.find((one) => one.programme === programme && one.stage === stage);
    const pair = (stage: "received" | "serving" | "billed" | "paid" | "zoho") => ({ count: of(stage)?.count ?? 0, amount: of(stage)?.amount ?? 0 });
    return { programme, received: pair("received"), serving: pair("serving"), billed: pair("billed"), paid: pair("paid"), zoho: pair("zoho") };
  });
  const open = letters.filter((one) => one.stage !== "paid" && one.stage !== "zoho");
  const total = totals[0];
  return {
    today,
    summary: {
      prescriptions: total?.prescriptions ?? 0,
      prescribers: total?.prescribers ?? 0,
      newPrescribers: total?.newPrescribers ?? 0,
      value: total?.value ?? 0,
      visitsToday: people.reduce((sum, one) => sum + one.visitsToday, 0),
      visitsDoneToday: people.reduce((sum, one) => sum + one.doneToday, 0),
      glOpen: open.reduce((sum, one) => sum + one.count, 0),
      glOpenAmount: open.reduce((sum, one) => sum + one.amount, 0),
      glPaid: letters.filter((one) => one.stage === "paid").reduce((sum, one) => sum + one.amount, 0),
      lastOrderOn: total?.lastOrderOn ?? null,
    },
    people,
    doctors,
    letters: byProgramme.sort(
      (a, b) => b.billed.amount + b.serving.amount + b.zoho.amount - (a.billed.amount + a.serving.amount + a.zoho.amount),
    ),
  };
}
