// Prescription sales (Aryan, 19 Nov: "press RX: Honey, her whole team, what the team is doing and
// where, right now; the sales they made, A to Z"; renamed and made plain on 27 Nov, PLAN 250): the
// orders that came with a doctor's prescription, this month. Each person's prescriptions, the
// doctors who wrote them and how many for the first time, the value; their day (visits planned and
// done today, the last check-in and where); the doctors prescribing most; and the guarantee letters
// by agency (DSWD, PCSO, the Office of the President…) from received to delivered, billed and paid.
// A seller sees their own; a lead their team (the box picked); the CEO and the Admin any box.
//
// The orders that came through a doctor (rx/doctors.ts, Aryan 27 Nov: a doctor who bought, or who
// sent a patient), one list with the Rx CHC's scorecard, so "New doctors" here and on the card are
// one figure: a doctor is new the month of their first order with us anywhere in the company. Zoho's
// history has only the name typed on each order, read as typed. The business's totals count each
// doctor once, not once per seller.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import { doctorOrders, GL_SOURCES } from "./doctors";
import { hqOf } from "../team/headquarters";
import { waysOf } from "../team/ways";
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
    ways: await waysOf(db, [], today.slice(0, 7)),
  };
  if (!seatIds.length) return empty;
  const seats = ids(seatIds);
  const placed = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  // Every order that came through a doctor on these seats (a doctor bought it, or is named on it).
  const rx = doctorOrders(seats);
  // When each doctor first ordered with us, anywhere in the company (a new doctor is new to us).
  const firstsAll = sql`(select dkey, min(day) as since from ${doctorOrders()} x group by dkey)`;
  // The guarantee letters' programmes (the order's source, as the hub and Zoho wrote it).
  const PROGRAMMES = ["DSWD", "PCSO", "Office of the President", "IAPF", "Malasakit", "Other"];
  const programmeList = sql.join(PROGRAMMES.map((one) => sql`${one}`), sql`, `);
  const [people, totals, doctors, letters] = await Promise.all([
    // Each seat of the box: its seller (an empty seat with prescriptions this month too, so the
    // rows add up to the business's totals).
    rows<RxBusiness["people"][number]>(
      db,
      sql`with rx as materialized ${rx}, firsts as materialized ${firstsAll}
        select s.id::int as "seatId", p.id::int as "personId", coalesce(p.name, 'Empty seat') as name, s.title, a.name as area,
          (select count(*) from visit v where v.seat_id = s.id and v.day = ${today}::date)::int as "visitsToday",
          (select count(*) from visit v where v.seat_id = s.id and v.day = ${today}::date and v.status = 'done')::int as "doneToday",
          (select c.name from visit v join customer c on c.id = v.customer_id where v.seat_id = s.id and v.checked_in_at is not null
            order by v.checked_in_at desc limit 1) as "lastCheckIn",
          (select to_char(max(v.checked_in_at) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') from visit v where v.seat_id = s.id) as "lastCheckInAt",
          (select count(*) from rx where rx.seat = s.id and rx.day >= ${first}::date)::int as prescriptions,
          (select count(distinct rx.dkey) from rx where rx.seat = s.id and rx.day >= ${first}::date)::int as prescribers,
          (select count(distinct rx.dkey) from rx join firsts f on f.dkey = rx.dkey
            where rx.seat = s.id and rx.day >= ${first}::date and f.since >= ${first}::date)::int as "newPrescribers",
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
      sql`with rx as materialized ${rx}, firsts as materialized ${firstsAll}
        select (select count(*) from rx where day >= ${first}::date)::int as prescriptions,
          coalesce((select sum(total) from rx where day >= ${first}::date), 0)::float8 as value,
          (select count(distinct dkey) from rx where day >= ${first}::date)::int as prescribers,
          (select count(distinct rx.dkey) from rx join firsts f on f.dkey = rx.dkey
            where rx.day >= ${first}::date and f.since >= ${first}::date)::int as "newPrescribers",
          (select to_char(max(day), 'YYYY-MM-DD') from rx) as "lastOrderOn"`,
    ),
    // The doctors prescribing most in the last 90 days: what came by each of their ways (a patient
    // they sent, a guarantee letter's among them; what they bought), through which HQ (28 Nov).
    rows<Omit<RxBusiness["doctors"][number], "hq"> & { area: string | null }>(
      db,
      sql`with rx as materialized ${rx}
        select rx.dkey as key, max(rx.doctor_id)::int as "customerId", max(rx.doctor) as name,
          coalesce(sum(rx.total) filter (where rx.day > ${addDays(today, -90)}::date
            and (rx.way = 'Patient order referred by doctor' or rx.way in (${sql.join(GL_SOURCES.map((one) => sql`${one}`), sql`, `)}))), 0)::float8 as referral,
          coalesce(sum(rx.total) filter (where rx.day > ${addDays(today, -90)}::date and rx.way = 'Doctor order'), 0)::float8 as dispense,
          (select a.name from seat s join area a on a.id = s.area_id where s.id = (array_agg(rx.seat order by rx.day desc))[1]) as area,
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
    // Each doctor's HQ in a word (NCL, TAFT), as everywhere: the HQ, not a Zoho name.
    doctors: doctors.map(({ area, ...one }) => ({ ...one, hq: area ? hqOf(area, one.seller) : null })),
    ways: await waysOf(db, seatIds, today.slice(0, 7)),
    letters: byProgramme.sort(
      (a, b) => b.billed.amount + b.serving.amount + b.zoho.amount - (a.billed.amount + a.serving.amount + a.zoho.amount),
    ),
  };
}
