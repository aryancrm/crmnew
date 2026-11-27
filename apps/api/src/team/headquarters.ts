// Headquarters (Aryan, 27 Nov: "the main thing is the Headquarter; Javed opens his screen and sees HQ
// NCL, who works in it, its data, in this hierarchy"; PLAN 255-257). Each HQ of the team in view, as
// his sheet photo lays them out: Channel → Manager → HQ · who works it · its Zoho name · what it sold
// this month · today. An HQ is a selling seat with its territory: it stays, the person in it changes,
// and its sales are the HQ's (this CRM's invoices from the seat and Zoho's under its name, without
// VAT, as My KPIs counts them). Targets are left out until it is decided where they come from.
//
// Each HQ's hospitals and doctors (Phase 3, PLAN 258): its hospitals are those in its territory and
// those its doctors work at; its doctors, over the last 12 months, are counted by the way they work
// with us, from the order's own Source (as How the orders came): **dispense**, a doctor who bought
// ("Doctor order"), and **referral**, a doctor who sent a patient ("Patient order referred by
// doctor"); the month's value of each, and the doctors bringing the most. A doctor is one by name.
//
// The head makes, renames and closes the HQs and decides who works each (phase 4, PLAN 264,
// team/hq-change.ts): each channel says whether the one looking may change it.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import { invoicesSql } from "../kpis/invoices";
import { ledUnits } from "../org/service";
import { doctorOrders } from "../rx/doctors";
import { sheetName } from "../sales/target-sheet";
import { STATUS_LABEL } from "../orders/rules";
import type { DoctorHistory, Headquarters, HqDoctors, Me, OrderStatus } from "../types";
import { hqOf } from "./hq-name";
import { teamSeats } from "./service";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export { hqOf, ON_SITE, plain } from "./hq-name";

/** The boxes whose HQs this person makes and changes (PLAN 264): null for all (the CEO, the Admin);
 *  a head's own boxes and those under them; none for anyone else (a team lead sees, the head
 *  decides). */
export async function hqBoxes(db: Runner, me: Me): Promise<number[] | null> {
  if (me.role === "ceo" || me.role === "admin") return null;
  if (me.role !== "manager") return [];
  return ledUnits(db, me);
}

export async function headquarters(db: Database, me: Me, asked: { month?: string | null }): Promise<Headquarters> {
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "Headquarters are the leads' view.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) && asked.month <= today.slice(0, 7) ? asked.month : today.slice(0, 7);
  const first = `${month}-01`;
  const [year, number] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const day = today < last ? today : last;
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  const empty: Headquarters = { month, day, channels: [], sold: 0, today: 0 };
  if (!seatIds.length) return empty;
  const seats: SQL = sql.join(seatIds.map((id) => sql`${id}`), sql`, `);

  // Every selling seat with a territory: an HQ.
  const hqs = await rows<{
    seatId: number;
    unitId: number;
    unit: string;
    unitSort: number;
    area: string;
    title: string;
    personId: number | null;
    person: string | null;
    since: string | null;
    customers: number;
    manager: string | null;
    login: string | null;
    sellers: string[] | null;
  }>(
    db,
    sql`select s.id::int as "seatId", u.id::int as "unitId", u.name as unit, coalesce(u.sort, 0)::int as "unitSort", a.name as area, s.title,
        p.id::int as "personId", p.name as person, to_char(h.starts_on, 'YYYY-MM-DD') as since, s.login,
        array(select z.name from zoho_seller z where z.seat_id = s.id) as sellers,
        (select count(*) from customer c where c.area_id = s.area_id and c.active)::int as customers,
        (select pe.name from seat l join seat_holder lh on lh.seat_id = l.id and lh.kind = 'holder' and lh.ends_on is null
          join person pe on pe.id = lh.person_id where l.unit_id = u.id and l.lead and l.active limit 1) as manager
      from seat s join org_unit u on u.id = s.unit_id join area a on a.id = s.area_id
        left join lateral (select x.person_id, x.starts_on from seat_holder x where x.seat_id = s.id and x.kind = 'holder'
          and x.starts_on <= ${today}::date and (x.ends_on is null or x.ends_on >= ${today}::date) order by x.starts_on desc limit 1) h on true
        left join person p on p.id = h.person_id
      where s.id in (${seats}) and s.active and not s.lead and s.module in ('medrep', 'online')`,
  );
  if (!hqs.length) return empty;
  const hqSeats = sql.join(hqs.map((one) => sql`${one.seatId}`), sql`, `);
  const changeable = await hqBoxes(db, me);
  const [sold, before, order] = await Promise.all([
    // What each HQ sold this month and on the day (the invoices My KPIs counts, by the seat).
    rows<{ seatId: number; sold: number; today: number }>(
      db,
      sql`select x.seat_id::int as "seatId", coalesce(sum(x.net), 0)::float8 as sold,
          coalesce(sum(x.net) filter (where x.day = ${day}::date), 0)::float8 as today
        from (${invoicesSql(first, day)}) x where x.seat_id in (${hqSeats}) group by 1`,
    ),
    // Who worked each HQ before.
    rows<{ seatId: number; name: string; from: string; to: string }>(
      db,
      sql`select h.seat_id::int as "seatId", p.name, to_char(h.starts_on, 'YYYY-MM-DD') as "from", to_char(h.ends_on, 'YYYY-MM-DD') as "to"
        from seat_holder h join person p on p.id = h.person_id
        where h.seat_id in (${hqSeats}) and h.kind = 'holder' and h.ends_on is not null and h.ends_on < ${today}::date
          and h.ends_on >= h.starts_on
        order by h.ends_on desc`,
    ),
    // The sheet's order of the HQs (the photo's), when the month has one.
    rows<{ zoho: string[]; sort: number }>(
      db,
      sql`select zoho_names as zoho, sort::int as sort from target_sheet_row
        where month = (select max(month) from target_sheet_row where month <= ${first}::date) order by sort`,
    ),
  ]);
  const soldBy = new Map(sold.map((one) => [one.seatId, one]));

  // The doctors' orders of the last 12 months, by the two ways; the HQ's hospitals and its doctors.
  const yearAgo = addDays(day, -364);
  const [doctorRows, areaHospitals, areaDoctors] = await Promise.all([
    rows<{ seatId: number; way: string; dkey: string; doctor: string; buyer: number | null; day: string; total: number; doctorId: number | null }>(
      db,
      sql`select x.seat::int as "seatId", x.way, x.dkey, x.doctor, x.buyer::int as buyer, to_char(x.day, 'YYYY-MM-DD') as day,
          x.total::float8 as total, x.doctor_id::int as "doctorId"
        from ${doctorOrders(hqSeats)} x
        where x.day between ${yearAgo}::date and ${day}::date and x.way in ('Doctor order', 'Patient order referred by doctor')`,
    ),
    rows<{ seatId: number; hospitalId: number }>(
      db,
      sql`select s.id::int as "seatId", h.id::int as "hospitalId" from seat s
        join lateral (select c.id from customer c where c.kind = 'hospital' and c.active and c.area_id = s.area_id
          union select d.works_at from customer d where d.kind = 'doctor' and d.active and d.works_at is not null and d.area_id = s.area_id) h(id) on true
        where s.id in (${hqSeats})`,
    ),
    rows<{ seatId: number; dkey: string }>(
      db,
      sql`select s.id::int as "seatId", lower(trim(c.name)) as dkey from seat s join customer c on c.area_id = s.area_id
        where s.id in (${hqSeats}) and c.kind = 'doctor' and c.active`,
    ),
  ]);
  // Where the doctors on the orders work: their hospitals are the HQ's too.
  const doctorIds = [...new Set(doctorRows.map((one) => one.doctorId).filter((id): id is number => id !== null))];
  const worksAt = doctorIds.length
    ? new Map(
        (
          await rows<{ id: number; hospitalId: number }>(
            db,
            sql`select id::int as id, works_at::int as "hospitalId" from customer
              where id in (${sql.join(doctorIds.map((id) => sql`${id}`), sql`, `)}) and works_at is not null`,
          )
        ).map((one) => [one.id, one.hospitalId]),
      )
    : new Map<number, number>();
  const top = (picked: typeof doctorRows) => {
    const byDoctor = new Map<string, { name: string; value: number }>();
    for (const one of picked) {
      const known = byDoctor.get(one.dkey) ?? { name: one.doctor, value: 0 };
      known.value += one.total;
      byDoctor.set(one.dkey, known);
    }
    return [...byDoctor.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  };
  const doctorsOf = (seatId: number) => {
    const mine = doctorRows.filter((one) => one.seatId === seatId);
    const dispense = mine.filter((one) => one.way === "Doctor order");
    const referral = mine.filter((one) => one.way === "Patient order referred by doctor");
    const month = (list: typeof mine) => list.filter((one) => one.day >= first);
    const hospitals = new Set(areaHospitals.filter((one) => one.seatId === seatId).map((one) => one.hospitalId));
    for (const one of mine) {
      const at = one.doctorId ? worksAt.get(one.doctorId) : undefined;
      if (at) hospitals.add(at);
    }
    const everyone = new Set([...mine.map((one) => one.dkey), ...areaDoctors.filter((one) => one.seatId === seatId).map((one) => one.dkey)]);
    return {
      hospitals: hospitals.size,
      doctors: everyone.size,
      dispense: {
        doctors: new Set(dispense.map((one) => one.dkey)).size,
        month: {
          doctors: new Set(month(dispense).map((one) => one.dkey)).size,
          value: month(dispense).reduce((sum, one) => sum + one.total, 0),
        },
        top: top(dispense),
      },
      referral: {
        doctors: new Set(referral.map((one) => one.dkey)).size,
        month: {
          doctors: new Set(month(referral).map((one) => one.dkey)).size,
          patients: new Set(month(referral).map((one) => one.buyer).filter((id) => id !== null)).size,
          value: month(referral).reduce((sum, one) => sum + one.total, 0),
        },
        top: top(referral),
      },
    };
  };
  const rank = new Map<string, number>();
  for (const row of order) for (const name of row.zoho) if (!rank.has(sheetName(name))) rank.set(sheetName(name), row.sort);
  // An HQ keeps its place by its sales name too, when it is renamed; a new one comes last.
  const rankOf = (one: (typeof hqs)[number]) =>
    Math.min(...[one.area, ...(one.sellers ?? [])].map((name) => rank.get(sheetName(name)) ?? Number.MAX_SAFE_INTEGER));

  const channels = new Map<number, Headquarters["channels"][number]>();
  for (const one of [...hqs].sort((a, b) => a.unitSort - b.unitSort || rankOf(a) - rankOf(b) || a.area.localeCompare(b.area))) {
    const channel = channels.get(one.unitId) ?? {
      unitId: one.unitId,
      name: one.unit,
      manager: one.manager,
      canChange: changeable === null || changeable.includes(one.unitId),
      hqs: [],
      sold: 0,
      today: 0,
    };
    const figures = soldBy.get(one.seatId);
    channel.hqs.push({
      seatId: one.seatId,
      hq: hqOf(one.area, one.person),
      zoho: one.area,
      title: one.title,
      login: one.login,
      personId: one.personId,
      person: one.person,
      since: one.since,
      customers: one.customers,
      sold: figures?.sold ?? 0,
      today: figures?.today ?? 0,
      before: before.filter((row) => row.seatId === one.seatId).map(({ name, from, to }) => ({ name, from, to })),
      ...doctorsOf(one.seatId),
    });
    channel.sold += figures?.sold ?? 0;
    channel.today += figures?.today ?? 0;
    channels.set(one.unitId, channel);
  }
  const list = [...channels.values()];
  return {
    month,
    day,
    channels: list,
    sold: list.reduce((sum, one) => sum + one.sold, 0),
    today: list.reduce((sum, one) => sum + one.today, 0),
  };
}

/** The ways a doctor's order counts as (Aryan, 28 Nov: a guarantee letter is a patient's order, a
 *  referral's). */
const LETTER_SOURCES = ["DSWD", "PCSO", "Office of the President", "IAPF", "Malasakit"];
const wayOfSource = (source: string | null): "dispense" | "referral" | null =>
  source === "Doctor order"
    ? "dispense"
    : source === "Patient order referred by doctor" || (source !== null && LETTER_SOURCES.includes(source))
      ? "referral"
      : null;

/** What Zoho's older statuses mean, in words. */
const ZOHO_STATUS: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  open: "Open",
  invoiced: "Invoiced",
  partially_invoiced: "Partly invoiced",
  closed: "Delivered",
  fulfilled: "Delivered",
  void: "Cancelled",
};

type DoctorOrder = {
  seat: number;
  doctor: string;
  dkey: string;
  day: string;
  total: number;
  doctorId: number | null;
  way: string | null;
  buyer: number | null;
  origin: "crm" | "zoho";
  ref: number;
  code: string;
  status: string;
};

/** The orders through a doctor on these seats (the last `since` day on), with what is still owed on
 *  each: this CRM's invoices less what was paid; a Zoho order's invoices in the books (tied to it
 *  by its number) at their balance. */
async function doctorOrdersWithPending(db: Database, seats: SQL, where: SQL): Promise<(DoctorOrder & { pending: number })[]> {
  const found = await rows<DoctorOrder>(
    db,
    sql`select x.seat::int as seat, x.doctor, x.dkey, to_char(x.day, 'YYYY-MM-DD') as day, x.total::float8 as total,
        x.doctor_id::int as "doctorId", x.way, x.buyer::int as buyer, x.origin, x.ref::int as ref, x.code, x.status
      from ${doctorOrders(seats)} x where ${where} order by x.day desc`,
  );
  if (!found.length) return [];
  const crm = found.filter((one) => one.origin === "crm").map((one) => one.ref);
  const zoho = found.filter((one) => one.origin === "zoho").map((one) => one.ref);
  const list = (ids: number[]) => (ids.length ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : sql`0`);
  const owed = await rows<{ origin: string; ref: number; pending: number }>(
    db,
    sql`select 'crm' as origin, i.order_id::int as ref, sum(i.total - i.paid)::float8 as pending from invoice i
        where i.order_id in (${list(crm)}) and i.status = 'open' and i.total > i.paid group by i.order_id
      union all
      select 'zoho', p.id::int, sum(round(inv.balance * inv.fx_rate))::float8 from past_order p
        join book_doc so on so.kind = 'sales_order' and so.number = p.code
        join book_link l on l.to_doc = so.id or l.from_doc = so.id
        join book_doc inv on inv.id = (case when l.to_doc = so.id then l.from_doc else l.to_doc end) and inv.kind = 'invoice'
        where p.id in (${list(zoho)}) and inv.balance > 0 and inv.status not in ('void', 'draft') and inv.voided_at is null
        group by p.id`,
  );
  const pendingOf = new Map(owed.map((one) => [`${one.origin}:${one.ref}`, one.pending]));
  return found.map((one) => ({ ...one, pending: pendingOf.get(`${one.origin}:${one.ref}`) ?? 0 }));
}

/** Where each doctor works: their record's hospital (the CRM's doctor, else the one doctor of that
 *  name). */
async function hospitalsOf(db: Database, doctors: { dkey: string; doctorId: number | null }[]): Promise<Map<string, string>> {
  const keys = [...new Set(doctors.map((one) => one.dkey))];
  if (!keys.length) return new Map();
  const found = await rows<{ dkey: string; hospital: string }>(
    db,
    sql`select lower(trim(d.name)) as dkey, h.name as hospital from customer d join customer h on h.id = d.works_at
      where d.kind = 'doctor' and d.active and lower(trim(d.name)) in (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})`,
  );
  const byKey = new Map<string, Set<string>>();
  for (const one of found) byKey.set(one.dkey, (byKey.get(one.dkey) ?? new Set()).add(one.hospital));
  // A name two doctors share at two hospitals says nothing for sure: left blank.
  return new Map([...byKey].filter(([, set]) => set.size === 1).map(([key, set]) => [key, [...set][0] as string]));
}

async function seatsInView(db: Database, me: Me): Promise<number[]> {
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "Headquarters are the leads' view.");
  return (await teamSeats(db, me, me.unit ?? null)).seatIds;
}

/** One HQ's doctors (Aryan, 28 Nov: "press the person: the doctor referral's and the doctor
 *  dispense's data; the doctor's name on top, the hospital they work at a little under it"), over
 *  the last 12 months to the day, by way: each with the month's orders and value, the year's, the
 *  last order and what is still pending on their orders. */
export async function hqDoctors(db: Database, me: Me, seatId: number, asked: { month?: string | null }): Promise<HqDoctors> {
  const seatIds = await seatsInView(db, me);
  if (!seatIds.includes(seatId)) throw new Refusal(404, "not_found", "That HQ isn't in your team.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) && asked.month <= today.slice(0, 7) ? asked.month : today.slice(0, 7);
  const first = `${month}-01`;
  const [year, number] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const day = today < last ? today : last;
  const yearAgo = addDays(day, -364);
  const orders = await doctorOrdersWithPending(db, sql`${seatId}`, sql`x.day between ${yearAgo}::date and ${day}::date`);
  const hospitals = await hospitalsOf(db, orders);
  const lists = { referral: new Map<string, HqDoctors["referral"][number]>(), dispense: new Map<string, HqDoctors["referral"][number]>() };
  for (const order of orders) {
    const way = wayOfSource(order.way);
    if (!way) continue;
    const doctor = lists[way].get(order.dkey) ?? {
      key: order.dkey,
      name: order.doctor,
      hospital: hospitals.get(order.dkey) ?? null,
      orders: 0,
      value: 0,
      month: { orders: 0, value: 0 },
      lastOn: order.day,
      pending: 0,
    };
    doctor.orders += 1;
    doctor.value += order.total;
    doctor.pending += order.pending;
    if (order.day >= first) {
      doctor.month.orders += 1;
      doctor.month.value += order.total;
    }
    if (order.day > doctor.lastOn) doctor.lastOn = order.day;
    lists[way].set(order.dkey, doctor);
  }
  const sorted = (map: Map<string, HqDoctors["referral"][number]>) =>
    [...map.values()].sort((a, b) => b.month.value - a.month.value || b.value - a.value);
  return { seatId, month, day, referral: sorted(lists.referral), dispense: sorted(lists.dispense) };
}

/** One doctor's whole history in the team (Aryan, 28 Nov: "press the doctor: all their past data,
 *  how many orders came from them, what happened, how much they took, how much money is pending"):
 *  every order through them, by either way, newest first. */
export async function doctorHistory(db: Database, me: Me, key: string): Promise<DoctorHistory> {
  const seatIds = await seatsInView(db, me);
  const dkey = key.trim().toLowerCase();
  if (!seatIds.length || !dkey) throw new Refusal(404, "not_found", "No such doctor in your team.");
  const seats = sql.join(seatIds.map((id) => sql`${id}`), sql`, `);
  const orders = await doctorOrdersWithPending(db, seats, sql`x.dkey = ${dkey}`);
  if (!orders.length) throw new Refusal(404, "not_found", "No order through this doctor in your team.");
  const [hospitals, buyers, places] = await Promise.all([
    hospitalsOf(db, orders),
    rows<{ id: number; name: string }>(
      db,
      sql`select id::int as id, name from customer where id in (${sql.join(
        [...new Set(orders.map((one) => one.buyer).filter((id): id is number => id !== null))].map((id) => sql`${id}`).concat(sql`0`),
        sql`, `,
      )})`,
    ),
    rows<{ seatId: number; area: string | null; person: string | null }>(
      db,
      sql`select s.id::int as "seatId", a.name as area, (select p.name from seat_holder h join person p on p.id = h.person_id
          where h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null order by h.starts_on desc limit 1) as person
        from seat s left join area a on a.id = s.area_id where s.id in (${seats})`,
    ),
  ]);
  const buyerName = new Map(buyers.map((one) => [one.id, one.name]));
  const placeOf = new Map(places.map((one) => [one.seatId, one.area ? hqOf(one.area, one.person) : null]));
  const list: DoctorHistory["orders"] = orders.map((order) => ({
    code: order.code,
    day: order.day,
    way: wayOfSource(order.way) ?? "other",
    buyer: order.buyer !== null ? (buyerName.get(order.buyer) ?? null) : null,
    hq: placeOf.get(order.seat) ?? null,
    value: order.total,
    status: order.origin === "crm" ? (STATUS_LABEL[order.status as OrderStatus] ?? order.status) : (ZOHO_STATUS[order.status] ?? order.status),
    pending: order.pending,
    orderId: order.origin === "crm" ? order.ref : null,
  }));
  const sum = (way: string) => {
    const mine = list.filter((one) => one.way === way);
    return { orders: mine.length, value: mine.reduce((total, one) => total + one.value, 0) };
  };
  return {
    key: dkey,
    name: orders[0]?.doctor ?? key,
    hospital: hospitals.get(dkey) ?? null,
    orders: list,
    total: { orders: list.length, value: list.reduce((total, one) => total + one.value, 0), pending: list.reduce((total, one) => total + one.pending, 0) },
    dispense: sum("dispense"),
    referral: sum("referral"),
  };
}
