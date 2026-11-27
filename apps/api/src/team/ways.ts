// How the team's orders came, month by month (Aryan, 27 Nov: "doctors are of two kinds, Doctor
// dispense and Doctor referral. In referral the doctor tells the patient to buy from us; in dispense
// the doctor buys from us first and pays then or later. Build everything on it", PLAN 252; 28 Nov:
// "a guarantee letter is only a process of an order, for a patient who can't buy straight: don't
// treat it apart. Where is it whether the patient paid COD, prepaid, on how many days' terms? In
// referral the patients buy, some through a GL, some as seniors", PLAN 260).
//
// Each order's Source, asked on the order form as Zoho's orders said it, makes its way:
// - **Doctor dispense**: the doctor buys ("Doctor order"); how they pay.
// - **Doctor referral**: the patient buys ("Patient order referred by doctor", and a guarantee
//   letter's orders: DSWD, PCSO…, a patient's order paid by an agency); how they bought (regular,
//   Senior / PWD, guarantee letter) and how they pay.
// - **Others**: every other source.
// How they pay is the order's own terms (prepaid, COD, so many days); Zoho's older orders kept none,
// so the buyer's own terms stand for them. Each person's orders too (the seat's holder). This
// CRM's orders and Zoho's history, by the seats of the box in view; the leads' view.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { GL_SOURCES } from "../rx/doctors";
import type { Me, OrderWays } from "../types";
import { hqOf } from "./headquarters";
import { teamSeats } from "./service";

/** The order form's sources that are a doctor's (the hub's words, Zoho's too). */
export const DISPENSE = "Doctor order";
export const REFERRAL = "Patient order referred by doctor";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type Part = { orders: number; value: number };
const part = (): Part => ({ orders: 0, value: 0 });
const add = (into: Part, value: number) => {
  into.orders += 1;
  into.value += value;
};
const payment = () => ({ prepaid: part(), cod: part(), terms: { ...part(), byDays: [] as { days: number; orders: number; value: number }[] }, unknown: part() });

export async function orderWays(db: Database, me: Me, asked: { month?: string | null }): Promise<OrderWays> {
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "How the team's orders came is the leads' view.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) && asked.month <= today.slice(0, 7) ? asked.month : today.slice(0, 7);
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  return waysOf(db, seatIds, month);
}

/** The month's orders on these seats by way, one count for every screen that shows it (the Home's
 *  card, Prescription sales). */
export async function waysOf(db: Database, seatIds: number[], month: string): Promise<OrderWays> {
  const today = todayManila();
  const from = `${month}-01`;
  const [year, number] = month.split("-").map(Number) as [number, number];
  const to = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const result: OrderWays = {
    month,
    from,
    to,
    lastOrderOn: null,
    orders: 0,
    value: 0,
    referral: { ...part(), patients: 0, doctors: 0, roads: { regular: part(), senior: part(), gl: part() }, pay: payment() },
    dispense: { ...part(), doctors: 0, pay: payment() },
    others: { ...part(), list: [] },
    people: [],
  };
  if (!seatIds.length) return result;
  const seats = sql.join(seatIds.map((id) => sql`${id}`), sql`, `);
  const placed = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  const [orders, holders] = await Promise.all([
    rows<{
      seat: number | null;
      source: string;
      total: number;
      buyer: number | null;
      doctor: string | null;
      type: string | null;
      terms: string | null;
      days: number | null;
      day: string;
    }>(
      db,
      sql`select o.seat_id::int as seat, coalesce(nullif(trim(o.source), ''), 'Not said') as source, o.total::float8 as total,
          o.customer_id::int as buyer, case when o.doctor_id is not null then 'c' || o.doctor_id::text end as doctor,
          o.order_type as type, o.payment_terms as terms, o.payment_days::int as days, to_char(${placed}, 'YYYY-MM-DD') as day
        from sales_order o
        where o.seat_id in (${seats}) and o.status not in ('draft', 'cancelled') and ${placed} between ${from}::date and ${to}::date
        union all
        select zs.seat_id::int, coalesce(nullif(trim(p.source), ''), 'Not said'), p.total::float8, p.customer_id::int,
          case when nullif(trim(p.doctor), '') is not null then 'z' || lower(trim(p.doctor)) end,
          null, c.payment_terms, c.payment_days::int, to_char(p.ordered_on, 'YYYY-MM-DD')
        from past_order p join zoho_seller zs on zs.name = p.seller left join customer c on c.id = p.customer_id
        where zs.seat_id in (${seats}) and p.status <> 'void' and p.ordered_on between ${from}::date and ${to}::date`,
    ),
    // Each selling seat with its HQ and who works it now, for the person's line.
    rows<{ seatId: number; area: string | null; person: string | null; personId: number | null }>(
      db,
      sql`select s.id::int as "seatId", a.name as area, p.name as person, p.id::int as "personId"
        from seat s left join area a on a.id = s.area_id
          left join lateral (select x.person_id from seat_holder x where x.seat_id = s.id and x.kind = 'holder'
            and x.starts_on <= ${today}::date and (x.ends_on is null or x.ends_on >= ${today}::date) order by x.starts_on desc limit 1) h on true
          left join person p on p.id = h.person_id
        where s.id in (${seats}) and s.active and not s.lead and s.module in ('medrep', 'online')`,
    ),
  ]);

  const patients = new Set<number>();
  const referralDoctors = new Set<string>();
  const dispenseDoctors = new Set<number>();
  const others = new Map<string, Part>();
  const byPerson = new Map<number, OrderWays["people"][number]>();
  for (const seat of holders)
    byPerson.set(seat.seatId, {
      seatId: seat.seatId,
      hq: hqOf(seat.area, seat.person),
      person: seat.person,
      personId: seat.personId,
      ...part(),
      referral: part(),
      dispense: part(),
      others: part(),
    });
  const pay = (into: ReturnType<typeof payment>, terms: string | null, days: number | null, value: number) => {
    if (terms === "advance") add(into.prepaid, value);
    else if (terms === "cod") add(into.cod, value);
    else if (terms === "days") {
      add(into.terms, value);
      const at = into.terms.byDays.find((one) => one.days === (days ?? 0));
      if (at) {
        at.orders += 1;
        at.value += value;
      } else into.terms.byDays.push({ days: days ?? 0, orders: 1, value });
    } else add(into.unknown, value);
  };

  for (const order of orders) {
    result.orders += 1;
    result.value += order.total;
    if (!result.lastOrderOn || order.day > result.lastOrderOn) result.lastOrderOn = order.day;
    const person = order.seat !== null ? byPerson.get(order.seat) : undefined;
    if (person) add(person, order.total);
    const gl = (GL_SOURCES as readonly string[]).includes(order.source) || order.type === "gl";
    if (order.source === DISPENSE) {
      add(result.dispense, order.total);
      if (order.buyer !== null) dispenseDoctors.add(order.buyer);
      pay(result.dispense.pay, order.terms, order.days, order.total);
      if (person) add(person.dispense, order.total);
    } else if (order.source === REFERRAL || gl) {
      add(result.referral, order.total);
      if (order.buyer !== null) patients.add(order.buyer);
      if (order.doctor) referralDoctors.add(order.doctor);
      add(gl ? result.referral.roads.gl : order.type === "senior_pwd" ? result.referral.roads.senior : result.referral.roads.regular, order.total);
      pay(result.referral.pay, order.terms, order.days, order.total);
      if (person) add(person.referral, order.total);
    } else {
      add(result.others, order.total);
      const known = others.get(order.source) ?? part();
      add(known, order.total);
      others.set(order.source, known);
      if (person) add(person.others, order.total);
    }
  }
  result.referral.patients = patients.size;
  result.referral.doctors = referralDoctors.size;
  result.dispense.doctors = dispenseDoctors.size;
  result.referral.pay.terms.byDays.sort((a, b) => a.days - b.days);
  result.dispense.pay.terms.byDays.sort((a, b) => a.days - b.days);
  result.others.list = [...others].map(([source, figures]) => ({ source, ...figures })).sort((a, b) => b.value - a.value);
  result.people = [...byPerson.values()].sort((a, b) => b.value - a.value || a.hq.localeCompare(b.hq));
  return result;
}
