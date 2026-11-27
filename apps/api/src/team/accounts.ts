// The customers of a lead's team, or of one box of it (Aryan, 19 Nov: "B2B: what her team does and
// from where, how much B2B brings; BID: which hospitals they went to bid at; CLIDP: which pharmacies
// we went to, who agreed, how many; HOSP: which hospitals each has, whom to call"): every business
// customer of the box's areas and of the orders sold from its seats, with its buying (this CRM's
// invoices and Zoho's history), the usual gap between its orders and so whether it is due, late,
// stopped or lost, what it owes, and the last call to it; then the same counted by state and by
// city. Patients are left out (the prescription teams' are counted on their own desks).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import type { Me, TeamAccounts } from "../types";
import { teamSeats } from "./service";
import { hqOf } from "./hq-name";

const LEADS = ["team_lead", "manager", "ceo", "admin"];

export async function teamAccounts(db: Database, me: Me): Promise<TeamAccounts> {
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "A team's customers are for its leads.");
  const today = todayManila();
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  const empty: TeamAccounts = {
    today,
    counts: { accounts: 0, buying: 0, new: 0, due: 0, late: 0, stopped: 0, lost: 0, called: 0 },
    cities: [],
    rows: [],
  };
  if (!seatIds.length) return empty;
  const seats = sql.join(
    seatIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const first = `${today.slice(0, 7)}-01`;
  const yearAgo = addDays(today, -365);
  const found = await rows<Omit<TeamAccounts["rows"][number], "state" | "hq"> & { area: string | null }>(
    db,
    sql`with mine as (
        select c.id from customer c where c.active and c.kind <> 'patient' and (
          c.area_id in (select s.area_id from seat s where s.id in (${seats}) and s.area_id is not null)
          or c.id in (select o.customer_id from sales_order o where o.seat_id in (${seats}) and o.status not in ('draft', 'cancelled')))
      ),
      days as (
        select i.customer_id as cid, i.issued_on as d, i.total::float8 as total from invoice i
          where i.customer_id in (select id from mine) and i.status <> 'cancelled'
        union all
        select p.customer_id, p.ordered_on, p.total::float8 from past_order p
          where p.customer_id in (select id from mine) and p.status <> 'void'
      ),
      g as (select cid, d, total, d - lag(d) over (partition by cid order by d) as gap, row_number() over (partition by cid order by d desc) as rn
        from (select cid, d, sum(total) as total from days group by cid, d) x),
      s as (select cid, min(d) as first, max(d) as last,
          greatest(7, coalesce(percentile_cont(0.5) within group (order by gap) filter (where gap is not null and rn <= 7), 28))::float8 as usual,
          coalesce(sum(total) filter (where d >= ${first}::date), 0) as month,
          coalesce(sum(total) filter (where d > ${yearAgo}::date), 0) as year
        from g group by cid),
      owed as (
        select customer_id as cid, sum(amount)::float8 as owed, sum(amount) filter (where late)::float8 as overdue from (
          select i.customer_id, (i.total - i.paid) as amount, i.due_on < ${today}::date as late from invoice i
            where i.customer_id in (select id from mine) and i.status = 'open' and i.total > i.paid
          union all
          select d.customer_id, round(d.balance * d.fx_rate), d.due_date < ${today}::date from book_doc d
            where d.customer_id in (select id from mine) and d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0
              and d.status not in ('void', 'draft')) x group by customer_id
      )
      select c.id::int as "customerId", c.name, c.kind, c.city,
        (select p.name from seat st join seat_holder h on h.seat_id = st.id and h.kind = 'holder' and h.ends_on is null
           join person p on p.id = h.person_id where st.area_id = c.area_id and st.id in (${seats}) order by h.starts_on desc limit 1) as seller,
        -- The customer's HQ (its territory; none when a lead's own seat holds it), shown before the
        -- seller (28 Nov, PLAN 276).
        (select a.name from area a where a.id = c.area_id
          and not exists (select 1 from seat ls where ls.area_id = a.id and ls.active and ls.lead)) as area,
        to_char(s.first, 'YYYY-MM-DD') as "firstOn", to_char(s.last, 'YYYY-MM-DD') as "lastOrderOn",
        (${today}::date - s.last)::int as since, round(s.usual)::int as usual,
        coalesce(s.month, 0)::float8 as "soldMonth", coalesce(s.year, 0)::float8 as "soldYear",
        coalesce(owed.owed, 0)::float8 as owed, coalesce(owed.overdue, 0)::float8 as overdue,
        (select to_char(max(k.at) at time zone 'Asia/Manila', 'YYYY-MM-DD') from account_call k where k.customer_id = c.id) as "lastCallOn",
        (select k.outcome from account_call k where k.customer_id = c.id order by k.at desc limit 1) as "lastOutcome"
      from mine join customer c on c.id = mine.id left join s on s.cid = c.id left join owed on owed.cid = c.id
      order by coalesce(s.year, 0) desc, s.last desc nulls last, c.name
      limit 400`,
  );
  const weekAhead = addDays(today, 7);
  const stateOf = (one: (typeof found)[number]): TeamAccounts["rows"][number]["state"] => {
    if (one.lastOrderOn === null || one.since === null) return "never";
    if (one.firstOn && one.firstOn >= first) return "new";
    if (one.since > 180) return "lost";
    if (one.since > 90) return "stopped";
    if (one.since > 1.5 * (one.usual ?? 28)) return "late";
    if (one.lastOrderOn && addDays(one.lastOrderOn, one.usual ?? 28) <= weekAhead) return "due";
    return "ok";
  };
  const withState = found.map((row) => {
    const { area, ...one } = row;
    return { ...one, hq: area ? hqOf(area, one.seller) : null, state: stateOf(row) };
  });
  const count = (state: TeamAccounts["rows"][number]["state"]) => withState.filter((one) => one.state === state).length;
  // One city however it was typed ("MANILA", "Manila"), shown in title case.
  const byCity = new Map<string, { accounts: number; soldYear: number }>();
  for (const one of withState) {
    const typed = one.city?.trim().replace(/\s+/g, " ").toLowerCase();
    const city = typed ? typed.replace(/(^|[\s(-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()) : "No city";
    const known = byCity.get(city) ?? { accounts: 0, soldYear: 0 };
    known.accounts += 1;
    known.soldYear += one.soldYear;
    byCity.set(city, known);
  }
  return {
    today,
    counts: {
      accounts: withState.length,
      buying: withState.filter((one) => one.soldMonth > 0).length,
      new: count("new"),
      due: count("due"),
      late: count("late"),
      stopped: count("stopped"),
      lost: count("lost"),
      called: withState.filter((one) => one.lastCallOn !== null).length,
    },
    cities: [...byCity.entries()]
      .map(([city, one]) => ({ city, ...one }))
      .sort((a, b) => b.soldYear - a.soldYear || b.accounts - a.accounts)
      .slice(0, 10),
    rows: withState,
  };
}
