// A telesales team at a glance (Aryan, 19 Nov: "MD Telesales: Honey, what she and each under her
// does, how much each sells, A to Z"; "Reynan's page shows nothing I understand";
// docs/CHANNEL-WORK.md, MD Telesales and TeleSales): each person's calls today and this month and
// what came of them, the callbacks due, the orders and what share of calls became orders, new
// customers against repeat ones, what they sold (this CRM's invoices and Zoho's, as the board
// counts), what their customers owe, and the orders stopped (on hold or sent back). A seller sees
// their own row; a lead their team (the box picked).

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { teamSeats } from "../team/service";
import type { Me, TelesalesTeam } from "../types";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const ids = (list: number[]): SQL => (list.length ? sql.join(list.map((id) => sql`${id}`), sql`, `) : sql`0`);

export async function telesalesTeam(db: Database, me: Me): Promise<TelesalesTeam> {
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  let seatIds: number[];
  if (me.role === "medrep" || me.role === "online") {
    seatIds = (
      await rows<{ id: number }>(db, sql`select h.seat_id::int as id from seat_holder h where h.person_id = ${me.id} and ${inForce("h", today)}`)
    ).map((one) => one.id);
  } else {
    if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "The telesales view is the sellers' and their leads'.");
    seatIds = (await teamSeats(db, me, me.unit ?? null)).seatIds;
  }
  const empty: TelesalesTeam = {
    today,
    summary: { callsToday: 0, callsMonth: 0, reached: 0, ordered: 0, callbacksDue: 0, orders: 0, conversion: null, newCustomers: 0, repeatCustomers: 0, sold: 0, owed: 0, stopped: 0 },
    rows: [],
  };
  if (!seatIds.length) return empty;
  const seats = ids(seatIds);
  const placed = sql`(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')::date`;
  // Every order a seat wrote: this CRM's and Zoho's (its salesperson tied to the seat), as the
  // money below counts both.
  const ord = sql`(
      select o.seat_id as seat, o.customer_id as customer, ${placed} as day from sales_order o
      where o.seat_id in (${seats}) and o.status not in ('draft', 'cancelled')
      union all
      select zs.seat_id, po.customer_id, po.ordered_on from past_order po join zoho_seller zs on zs.name = po.seller
      where zs.seat_id in (${seats}) and po.status <> 'void'
    )`;
  const calls = sql`account_call k where (k.seat_id = s.id or (k.seat_id is null and k.by_person = p.id))`;
  const callDay = sql`(k.at at time zone 'Asia/Manila')::date`;
  const found = await rows<TelesalesTeam["rows"][number]>(
    db,
    sql`with ord as ${ord},
        month as (select distinct seat, customer from ord where day between ${first}::date and ${today}::date)
      select p.id::int as "personId", s.id::int as "seatId", p.name, s.title, a.name as area,
        (select count(*) from ${calls} and ${callDay} = ${today}::date)::int as "callsToday",
        (select count(*) from ${calls} and ${callDay} >= ${first}::date)::int as "callsMonth",
        -- Reached: every call answered (all but "no answer").
        (select count(*) from ${calls} and ${callDay} >= ${first}::date and k.outcome <> 'no_answer')::int as reached,
        (select count(*) from ${calls} and ${callDay} >= ${first}::date and k.outcome in ('ordered', 'won_back'))::int as ordered,
        -- A callback promised for today or before, with no call to that customer since.
        (select count(*) from ${calls}
          and k.next_on is not null and k.next_on <= ${today}::date
          and not exists (select 1 from account_call n where n.id <> k.id and n.at > k.at
            and (n.customer_id = k.customer_id or (k.customer_id is null and n.customer_text = k.customer_text))))::int as "callbacksDue",
        (select count(*) from ord where ord.seat = s.id and ord.day between ${first}::date and ${today}::date)::int as orders,
        (select count(*) from month m where m.seat = s.id)::int as customers,
        -- New: the customer's first order or invoice with the company, by anyone, is this month.
        (select count(*) from month m where m.seat = s.id
          and not exists (select 1 from sales_order o where o.customer_id = m.customer and o.status not in ('draft', 'cancelled') and ${placed} < ${first}::date)
          and not exists (select 1 from past_order po where po.customer_id = m.customer and po.status <> 'void' and po.ordered_on < ${first}::date)
          -- The sales view's two halves asked one by one (this CRM's invoices, Zoho's), each by its
          -- own index on the customer: the same answer as "no sale_invoice before", which read every
          -- Zoho invoice for every customer (13 seconds of this screen's 16, 22 Nov).
          and not exists (select 1 from invoice i where i.customer_id = m.customer and i.status <> 'cancelled' and i.issued_on < ${first}::date)
          and not exists (select 1 from book_doc d where d.customer_id = m.customer and d.kind = 'invoice' and d.zoho_id is not null
            and d.status not in ('draft', 'void') and d.doc_date < ${first}::date))::int as "newCustomers",
        coalesce((select sum(i.total) from sale_invoice i where i.seat_id = s.id and i.status <> 'cancelled'
          and i.issued_on between ${first}::date and ${today}::date), 0)::float8 as sold,
        coalesce((select sum(i.total - i.paid) from sale_invoice i where i.seat_id = s.id and i.status = 'open' and i.total > i.paid), 0)::float8 as owed,
        (select count(*) from sales_order o where o.seat_id = s.id and o.status in ('on_hold', 'exception'))::int as stopped
      from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
        join person p on p.id = h.person_id left join area a on a.id = s.area_id
      where s.id in (${seats}) and s.active and s.module in ('medrep', 'online') and not s.lead
      order by p.name`,
  );
  const sum = (key: keyof TelesalesTeam["rows"][number]) => found.reduce((total, one) => total + Number(one[key] ?? 0), 0);
  const callsMonth = sum("callsMonth");
  return {
    today,
    summary: {
      callsToday: sum("callsToday"),
      callsMonth,
      reached: sum("reached"),
      ordered: sum("ordered"),
      callbacksDue: sum("callbacksDue"),
      orders: sum("orders"),
      conversion: callsMonth ? Math.round((sum("ordered") / callsMonth) * 100) : null,
      newCustomers: sum("newCustomers"),
      repeatCustomers: sum("customers") - sum("newCustomers"),
      sold: sum("sold"),
      owed: sum("owed"),
      stopped: sum("stopped"),
    },
    rows: found,
  };
}
