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

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { invoicesSql } from "../kpis/invoices";
import { doctorOrders } from "../rx/doctors";
import { sheetName } from "../sales/target-sheet";
import type { Headquarters, Me } from "../types";
import { teamSeats } from "./service";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** The HQ in a word: the territory's last part that isn't the person's own name ("RX | NCL" → NCL;
 *  "B2C | Rachelle Upao" → ON SITE). */
export function hqOf(area: string | null, person: string | null): string {
  const own = person ? plain(person) : null;
  const parts = (area ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && plain(part) !== own);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : "ON SITE";
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
  }>(
    db,
    sql`select s.id::int as "seatId", u.id::int as "unitId", u.name as unit, coalesce(u.sort, 0)::int as "unitSort", a.name as area, s.title,
        p.id::int as "personId", p.name as person, to_char(h.starts_on, 'YYYY-MM-DD') as since,
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
  const rankOf = (area: string) => rank.get(sheetName(area)) ?? Number.MAX_SAFE_INTEGER;

  const channels = new Map<number, Headquarters["channels"][number]>();
  for (const one of [...hqs].sort((a, b) => a.unitSort - b.unitSort || rankOf(a.area) - rankOf(b.area) || a.area.localeCompare(b.area))) {
    const channel = channels.get(one.unitId) ?? { unitId: one.unitId, name: one.unit, manager: one.manager, hqs: [], sold: 0, today: 0 };
    const figures = soldBy.get(one.seatId);
    channel.hqs.push({
      seatId: one.seatId,
      hq: hqOf(one.area, one.person),
      zoho: one.area,
      title: one.title,
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
