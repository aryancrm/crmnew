// The company at a glance, for the CEO's Home (Aryan, 19 Nov: "put on the Home everything you can
// about the company, useful or not; it used to be so colourful"): its people by department and who
// is working today, each channel's month against its target, the month's sales day by day, the top
// sellers, customers and medicines, the Online desk's enquiries by where they came from, the orders
// by step, the stock by warehouse and the customers by kind. Read in one call; each part is small.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import { attendanceToday } from "../hr/attendance";
import { addDays, todayManila } from "../inventory/rules";
import { periodFacts } from "../sales/rules";
import { sheetChannelSales } from "../sales/service";
import type { CompanyGlance, Me } from "../types";

export async function companyGlance(db: Database, me: Me): Promise<CompanyGlance> {
  allow(me, ["ceo", "admin"], "see the company at a glance");
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  const [
    departments,
    working,
    channels,
    days,
    sellers,
    customers,
    medicines,
    enquiries,
    enquiryStates,
    orders,
    stock,
    kinds,
  ] = await Promise.all([
    rows<{ name: string; people: number }>(
      db,
      sql`with recursive tree as (
          select u.id, u.id as top from org_unit u join org_unit c on c.id = u.parent_id and c.kind = 'company' where u.active
          union all select u.id, t.top from org_unit u join tree t on u.parent_id = t.id where u.active)
        select top.name, count(distinct h.person_id)::int as people from tree t join org_unit top on top.id = t.top
          join seat s on s.unit_id = t.id and s.active
          join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
          join person p on p.id = h.person_id and p.active
        group by top.name order by 2 desc`,
    ),
    rows<{ in: number; all: number }>(
      db,
      sql`select (select count(distinct a.person_id) from attendance a join person p on p.id = a.person_id and p.active where a.day = ${today}::date and a.time_in is not null)::int as in,
          (select count(*) from person where active and role <> 'admin')::int as all`,
    ),
    // The target sheet's channels, the same list as "Sales this month" above it (22 Nov).
    sheetChannelSales(db, periodFacts({})).then((found) =>
      found.map((one) => ({ code: "", name: one.name, target: one.target ?? 0, sold: one.sold })),
    ),
    rows<{ day: string; amount: number }>(
      db,
      sql`select to_char(s.issued_on, 'YYYY-MM-DD') as day, sum(s.total)::float8 as amount from sale_invoice s
        where s.status <> 'cancelled' and s.issued_on between ${first}::date and ${today}::date group by 1 order by 1`,
    ),
    rows<{ name: string; amount: number }>(
      db,
      sql`select coalesce(p.name, 'Not tied to a seat') as name, sum(s.total)::float8 as amount from sale_invoice s
          left join lateral (select h.person_id from seat_holder h where h.seat_id = s.seat_id and h.kind = 'holder' order by h.ends_on desc nulls first, h.starts_on desc limit 1) h on true
          left join person p on p.id = coalesce(s.medrep_id, h.person_id)
        where s.status <> 'cancelled' and s.issued_on between ${first}::date and ${today}::date group by 1 order by 2 desc limit 5`,
    ),
    rows<{ name: string; amount: number }>(
      db,
      sql`select c.name, sum(s.total)::float8 as amount from sale_invoice s join customer c on c.id = s.customer_id
        where s.status <> 'cancelled' and s.issued_on between ${first}::date and ${today}::date group by c.name order by 2 desc limit 5`,
    ),
    rows<{ name: string; amount: number }>(
      db,
      sql`select m.name, sum(oi.qty * oi.unit_price)::float8 as amount from order_item oi join sales_order o on o.id = oi.order_id join medicine m on m.id = oi.medicine_id
        where o.status not in ('draft', 'cancelled') and (o.created_at at time zone 'Asia/Manila')::date >= ${first}::date and not oi.free
        group by m.name order by 2 desc limit 5`,
    ),
    rows<{ source: string; count: number }>(
      db,
      sql`select coalesce(nullif(chat_channel, ''), nullif(source, ''), 'Other') as source, count(*)::int as count from lead
        where (created_at at time zone 'Asia/Manila')::date >= ${first}::date group by 1 order by 2 desc limit 6`,
    ),
    rows<{ all: number; waiting: number; ordered: number; month: number }>(
      db,
      sql`select count(*)::int as all, count(*) filter (where awaiting_reply)::int as waiting, count(*) filter (where order_id is not null)::int as ordered,
          count(*) filter (where (created_at at time zone 'Asia/Manila')::date >= ${first}::date)::int as month from lead`,
    ),
    rows<{ status: string; count: number }>(
      db,
      sql`select status, count(*)::int as count from sales_order where status <> 'draft' and (created_at at time zone 'Asia/Manila')::date >= ${first}::date group by 1 order by 2 desc`,
    ),
    rows<{ name: string; value: number; pieces: number }>(
      db,
      sql`select w.name, coalesce(sum(st.qty * coalesce(b.unit_cost, 0)), 0)::float8 as value, coalesce(sum(st.qty), 0)::int as pieces
        from warehouse w join stock st on st.warehouse_id = w.id join batch b on b.id = st.batch_id
        where w.active and st.qty > 0 group by w.name order by 2 desc limit 6`,
    ),
    rows<{ kind: string; count: number }>(
      db,
      sql`select kind, count(*)::int as count from customer where active group by 1 order by 2 desc`,
    ),
  ]);
  return {
    today,
    attendance: await attendanceGlance(db, me, today),
    departments,
    working: working[0] ?? { in: 0, all: 0 },
    channels,
    days,
    sellers,
    customers,
    medicines,
    enquiries: { bySource: enquiries, ...(enquiryStates[0] ?? { all: 0, waiting: 0, ordered: 0, month: 0 }) },
    orders,
    stock,
    kinds,
  };
}

const timeOf = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));

/** Today's attendance at a glance: HR's own reading of each day (start, grace, leave, rest days),
 *  counted for the company and each department, with the first in, the late ones, the desks'
 *  people started, and this week day by day. */
async function attendanceGlance(db: Database, me: Me, today: string): Promise<CompanyGlance["attendance"]> {
  const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const [day, homes, desks, week] = await Promise.all([
    attendanceToday(db, me),
    // Each person's department: the chart's top box their seat sits under.
    rows<{ personId: number; name: string }>(
      db,
      sql`with recursive tree as (
          select u.id, u.id as top from org_unit u join org_unit c on c.id = u.parent_id and c.kind = 'company' where u.active
          union all select u.id, t.top from org_unit u join tree t on u.parent_id = t.id where u.active)
        select distinct on (h.person_id) h.person_id::int as "personId", top.name from tree t join org_unit top on top.id = t.top
          join seat s on s.unit_id = t.id and s.active
          join seat_holder h on h.seat_id = s.id and h.starts_on <= (now() at time zone 'Asia/Manila')::date and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
        order by h.person_id, (h.kind = 'holder') desc, s.lead desc, h.starts_on, h.id`,
    ),
    rows<{ desk: string; seats: number; name: string | null; since: string | null }>(
      db,
      sql`select d.desk, (select count(*) from person p where p.active and p.role = d.desk)::int as seats, p.name,
          to_char(ds.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as since
        from (values ('management'), ('finance'), ('dispatch')) as d(desk)
          left join desk_shift ds on ds.desk = d.desk and ds.ended_at is null
          left join person p on p.id = ds.person_id
        order by d.desk, ds.started_at`,
    ),
    // This week's working days so far: in on time, late (past the start and its grace), not in.
    rows<{ day: string; onTime: number; late: number; people: number }>(
      db,
      sql`with d as (select starts, grace_minutes from work_schedule where is_default and active limit 1)
        select to_char(g.day, 'YYYY-MM-DD') as day,
          count(a.id) filter (where (a.time_in at time zone 'Asia/Manila')::time <= coalesce(ws.starts, d.starts) + make_interval(mins => coalesce(ws.grace_minutes, d.grace_minutes)))::int as "onTime",
          count(a.id) filter (where (a.time_in at time zone 'Asia/Manila')::time > coalesce(ws.starts, d.starts) + make_interval(mins => coalesce(ws.grace_minutes, d.grace_minutes)))::int as late,
          (select count(*) from person p2 where p2.active and p2.role not in ('admin', 'ceo'))::int as people
        from generate_series(${monday}::date, ${today}::date, interval '1 day') as g(day)
          cross join d
          left join attendance a on a.day = g.day::date
          left join person p on p.id = a.person_id and p.active
          left join work_schedule ws on ws.id = p.schedule_id
        where extract(isodow from g.day) <= 5
        group by g.day order by g.day`,
    ),
  ]);
  const homeOf = new Map(homes.map((one) => [one.personId, one.name]));
  const working = day.people.filter((one) => one.role !== "admin" && one.role !== "ceo");
  const stateOf = (one: (typeof working)[number]) =>
    one.today.leave && !one.today.halfDay
      ? "onLeave"
      : one.today.timeIn
        ? one.today.lateMinutes > 0
          ? "late"
          : "onTime"
        : one.today.kind === "work"
          ? "notIn"
          : "off";
  const tally = (list: typeof working) => ({
    onTime: list.filter((one) => stateOf(one) === "onTime").length,
    late: list.filter((one) => stateOf(one) === "late").length,
    notIn: list.filter((one) => stateOf(one) === "notIn").length,
    onLeave: list.filter((one) => stateOf(one) === "onLeave").length,
  });
  const byDepartment = new Map<string, typeof working>();
  for (const one of working) {
    const name = homeOf.get(one.personId) ?? "Others";
    byDepartment.set(name, [...(byDepartment.get(name) ?? []), one]);
  }
  const came = working.filter((one) => one.today.timeIn).sort((a, b) => (a.today.timeIn ?? "").localeCompare(b.today.timeIn ?? ""));
  const deskNames: Record<string, string> = { management: "Management", finance: "Finance", dispatch: "Dispatch" };
  return {
    ...tally(working),
    departments: [...byDepartment.entries()]
      .map(([name, list]) => ({ name, ...tally(list) }))
      .sort((a, b) => b.onTime + b.late + b.notIn + b.onLeave - (a.onTime + a.late + a.notIn + a.onLeave)),
    first: came.slice(0, 5).map((one) => ({ name: one.name, title: one.title, at: timeOf(one.today.timeIn as string) })),
    lateList: came
      .filter((one) => one.today.lateMinutes > 0)
      .sort((a, b) => b.today.lateMinutes - a.today.lateMinutes)
      .slice(0, 8)
      .map((one) => ({ name: one.name, title: one.title, at: timeOf(one.today.timeIn as string), minutes: one.today.lateMinutes })),
    desks: ["management", "finance", "dispatch"].map((desk) => {
      const list = desks.filter((one) => one.desk === desk);
      return {
        desk: deskNames[desk] as string,
        seats: list[0]?.seats ?? 0,
        people: list
          .filter((one) => one.name && one.since)
          .map((one) => {
            const at = new Date(one.since as string);
            const minutes = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" }).format(at).replace(":", ""));
            return { name: one.name as string, since: timeOf(one.since as string), late: minutes > 815 };
          }),
      };
    }),
    week: week.map((one) => ({ day: one.day, onTime: one.onTime, late: one.late, notIn: Math.max(0, one.people - one.onTime - one.late) })),
  };
}
