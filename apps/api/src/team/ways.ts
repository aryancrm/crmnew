// How the team's orders came, month by month (Aryan, 27 Nov: "doctors are of two kinds, Doctor
// dispense and Doctor referral. In referral the doctor tells the patient: buy your medicine from
// them. In dispense the doctor first buys medicine from us, and may pay then or later. This is the
// main thing: build everything on it", PLAN 252). Every order says where it came from: its Source,
// asked on the order form from the hub's list, as Zoho's orders said it. "Doctor order" is the
// doctor dispensing (the doctor is the buyer); "Patient order referred by doctor" is the doctor's
// referral (the patient buys, the doctor named). The other sources (a patient sent by a patient,
// a guarantee letter's agency, a hospital's PO…) as they are. This CRM's orders and Zoho's history,
// by the seats of the box in view (a lead's team; the CEO and the Admin any box).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Me, OrderWays } from "../types";
import { teamSeats } from "./service";

/** The order form's sources that are a doctor's (the hub's words, Zoho's too). */
export const DISPENSE = "Doctor order";
export const REFERRAL = "Patient order referred by doctor";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function orderWays(db: Database, me: Me, asked: { month?: string | null }): Promise<OrderWays> {
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "How the team's orders came is the leads' view.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) && asked.month <= today.slice(0, 7) ? asked.month : today.slice(0, 7);
  const from = `${month}-01`;
  const [year, number] = month.split("-").map(Number) as [number, number];
  const to = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  const empty: OrderWays = { month, from, to, lastOrderOn: null, orders: 0, value: 0, ways: [] };
  if (!seatIds.length) return empty;
  const seats = sql.join(seatIds.map((id) => sql`${id}`), sql`, `);
  const placed = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  const ways = await rows<OrderWays["ways"][number]>(
    db,
    sql`with x as (
        select coalesce(nullif(trim(o.source), ''), 'Not said') as source, o.total::float8 as total, o.customer_id as buyer,
          case when o.doctor_id is not null then 'c' || o.doctor_id::text end as doctor, ${placed} as day
        from sales_order o
        where o.seat_id in (${seats}) and o.status not in ('draft', 'cancelled') and ${placed} between ${from}::date and ${to}::date
        union all
        select coalesce(nullif(trim(p.source), ''), 'Not said'), p.total::float8, p.customer_id,
          case when nullif(trim(p.doctor), '') is not null then 'z' || lower(trim(p.doctor)) end, p.ordered_on
        from past_order p join zoho_seller zs on zs.name = p.seller
        where zs.seat_id in (${seats}) and p.status <> 'void' and p.ordered_on between ${from}::date and ${to}::date
      )
      select source, count(*)::int as orders, coalesce(sum(total), 0)::float8 as value,
        count(distinct buyer)::int as buyers, count(distinct doctor)::int as doctors, to_char(max(day), 'YYYY-MM-DD') as "lastOn"
      from x group by source order by value desc, source`,
  );
  const last = ways.reduce<string | null>((latest, one) => (one.lastOn && (!latest || one.lastOn > latest) ? one.lastOn : latest), null);
  return {
    month,
    from,
    to,
    lastOrderOn: last,
    orders: ways.reduce((sum, one) => sum + one.orders, 0),
    value: ways.reduce((sum, one) => sum + one.value, 0),
    ways,
  };
}
