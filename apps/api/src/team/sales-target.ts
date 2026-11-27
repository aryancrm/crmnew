// Sales vs target (Aryan, 28 Nov: "Team numbers: what repeats? one number everywhere"; "Yes, do
// it", PLAN 272): one page in place of Targets, Sales performance and Whole business's sales tables,
// laid out as his November sheet: each channel with its manager, each HQ with who works it, its
// target for the month, what it sold, the balance to do, today's sales and the share done, with the
// channel's and the whole team's totals. Sold is what My KPIs, Headquarters and Sales performance
// count: this CRM's invoices and Zoho's, without VAT. Whole business's own parts come with it: the
// team's sales day by day and the medicines sold. A target is the holder's for the month, else the
// seat's own (the sheet's), as My KPIs adds them up; targets themselves are set on Targets.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { invoicesSql } from "../kpis/invoices";
import { sheetName } from "../sales/target-sheet";
import type { Me, SalesVsTarget } from "../types";
import { hqOf } from "./hq-name";
import { teamSeats } from "./service";

const LEADS = ["team_lead", "manager", "ceo", "admin"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function salesVsTarget(db: Database, me: Me, asked: { month?: string | null }): Promise<SalesVsTarget> {
  if (!LEADS.includes(me.role)) throw new Refusal(403, "not_allowed", "Sales vs target is the leads' view.");
  const today = todayManila();
  const month = asked.month && MONTH.test(asked.month) && asked.month <= today.slice(0, 7) ? asked.month : today.slice(0, 7);
  const first = `${month}-01`;
  const [year, number] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const last = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const day = today < last ? today : last;
  const empty: SalesVsTarget = {
    month,
    day,
    daysInMonth,
    daysGone: Number(day.slice(8, 10)),
    channels: [],
    total: { target: null, sold: 0, today: 0 },
    daily: [],
    medicines: [],
  };
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  if (!seatIds.length) return empty;
  const seats: SQL = sql.join(seatIds.map((id) => sql`${id}`), sql`, `);

  // Every selling seat with a territory: an HQ, with who works it today and its target.
  const hqs = await rows<{
    seatId: number;
    unitId: number;
    unit: string;
    unitSort: number;
    manager: string | null;
    area: string;
    person: string | null;
    personId: number | null;
    target: number | null;
    sellers: string[] | null;
  }>(
    db,
    sql`select s.id::int as "seatId", u.id::int as "unitId", u.name as unit, coalesce(u.sort, 0)::int as "unitSort",
        (select pe.name from seat l join seat_holder lh on lh.seat_id = l.id and lh.kind = 'holder' and lh.ends_on is null
          join person pe on pe.id = lh.person_id where l.unit_id = u.id and l.lead and l.active limit 1) as manager,
        a.name as area, p.name as person, p.id::int as "personId",
        coalesce((select t.amount from sales_target t where t.person_id = p.id and t.month = ${first}::date),
          (select t.amount from seat_target t where t.seat_id = s.id and t.month = ${first}::date))::float8 as target,
        array(select z.name from zoho_seller z where z.seat_id = s.id) as sellers
      from seat s join org_unit u on u.id = s.unit_id join area a on a.id = s.area_id
        left join lateral (select x.person_id from seat_holder x where x.seat_id = s.id and x.kind = 'holder'
          and x.starts_on <= ${today}::date and (x.ends_on is null or x.ends_on >= ${today}::date) order by x.starts_on desc limit 1) h on true
        left join person p on p.id = h.person_id
      where s.id in (${seats}) and s.active and not s.lead and s.module in ('medrep', 'online')`,
  );
  if (!hqs.length) return empty;
  const hqSeats = sql.join(hqs.map((one) => sql`${one.seatId}`), sql`, `);
  const [sold, daily, medicines, order] = await Promise.all([
    // What each HQ sold in the month to the day, and on the day (My KPIs' invoices, without VAT).
    rows<{ seatId: number; sold: number; today: number }>(
      db,
      sql`select x.seat_id::int as "seatId", coalesce(sum(x.net), 0)::float8 as sold,
          coalesce(sum(x.net) filter (where x.day = ${day}::date), 0)::float8 as today
        from (${invoicesSql(first, day)}) x where x.seat_id in (${hqSeats}) group by 1`,
    ),
    rows<{ day: string; sold: number }>(
      db,
      sql`select to_char(x.day, 'YYYY-MM-DD') as day, coalesce(sum(x.net), 0)::float8 as sold
        from (${invoicesSql(first, day)}) x where x.seat_id in (${hqSeats}) group by 1 order by 1`,
    ),
    // The medicines sold, by value without VAT: this CRM's invoiced lines and Zoho's.
    rows<{ name: string; qty: number; value: number }>(
      db,
      sql`select name, sum(qty)::float8 as qty, sum(value)::float8 as value from (
          select m.name || coalesce(' ' || m.strength, '') as name, oi.qty::numeric as qty,
            round(oi.qty::numeric * oi.unit_price / case when coalesce(oi.vat_then, m.vat) = 'vat12' then 1.12 else 1 end) as value
          from invoice i join sales_order o on o.id = i.order_id join order_item oi on oi.order_id = o.id join medicine m on m.id = oi.medicine_id
          where i.status <> 'cancelled' and i.issued_on between ${first}::date and ${day}::date and o.seat_id in (${hqSeats})
          union all
          select coalesce(m.name || coalesce(' ' || m.strength, ''), nullif(trim(l.item_name), ''), 'Not named'), coalesce(l.qty, 0), round(coalesce(l.amount, 0) * d.fx_rate)
          from book_doc d join book_line l on l.doc_id = d.id left join medicine m on m.id = l.medicine_id
            join zoho_seller zs on zs.name = coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name')
          where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('draft', 'void') and d.voided_at is null
            and d.doc_date between ${first}::date and ${day}::date and coalesce(l.qty, 1) > 0 and zs.seat_id in (${hqSeats})
        ) x group by name order by value desc limit 10`,
    ),
    // The sheet's order of the HQs (the photo's), when the month has one.
    rows<{ zoho: string[]; sort: number }>(
      db,
      sql`select zoho_names as zoho, sort::int as sort from target_sheet_row
        where month = (select max(month) from target_sheet_row where month <= ${first}::date) order by sort`,
    ),
  ]);
  const soldBy = new Map(sold.map((one) => [one.seatId, one]));
  const rank = new Map<string, number>();
  for (const row of order) for (const name of row.zoho) if (!rank.has(sheetName(name))) rank.set(sheetName(name), row.sort);
  const rankOf = (one: (typeof hqs)[number]) =>
    Math.min(...[one.area, ...(one.sellers ?? [])].map((name) => rank.get(sheetName(name)) ?? Number.MAX_SAFE_INTEGER));

  const channels = new Map<number, SalesVsTarget["channels"][number]>();
  for (const one of [...hqs].sort((a, b) => a.unitSort - b.unitSort || rankOf(a) - rankOf(b) || a.area.localeCompare(b.area))) {
    const channel = channels.get(one.unitId) ?? { unitId: one.unitId, name: one.unit, manager: one.manager, hqs: [], target: null, sold: 0, today: 0 };
    const figures = soldBy.get(one.seatId);
    channel.hqs.push({
      seatId: one.seatId,
      hq: hqOf(one.area, one.person),
      person: one.person,
      personId: one.personId,
      target: one.target,
      sold: figures?.sold ?? 0,
      today: figures?.today ?? 0,
    });
    channel.sold += figures?.sold ?? 0;
    channel.today += figures?.today ?? 0;
    if (one.target !== null) channel.target = (channel.target ?? 0) + one.target;
    channels.set(one.unitId, channel);
  }
  const list = [...channels.values()];
  const targets = list.filter((one) => one.target !== null);
  return {
    month,
    day,
    daysInMonth,
    daysGone: Number(day.slice(8, 10)),
    channels: list,
    total: {
      target: targets.length ? targets.reduce((sum, one) => sum + (one.target ?? 0), 0) : null,
      sold: list.reduce((sum, one) => sum + one.sold, 0),
      today: list.reduce((sum, one) => sum + one.today, 0),
    },
    daily,
    medicines,
  };
}
