// The company at a glance, for the CEO's Home (Aryan, 19 Nov: "put on the Home everything you can
// about the company, useful or not; it used to be so colourful"): its people by department and who
// is working today, each channel's month against its target, the month's sales day by day, the top
// sellers, customers and medicines, the Online desk's enquiries by where they came from, the orders
// by step, the stock by warehouse and the customers by kind. Read in one call; each part is small.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import { todayManila } from "../inventory/rules";
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
          join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.starts_on <= current_date and (h.ends_on is null or h.ends_on >= current_date)
          join person p on p.id = h.person_id and p.active
        group by top.name order by 2 desc`,
    ),
    rows<{ in: number; all: number }>(
      db,
      sql`select (select count(distinct a.person_id) from attendance a join person p on p.id = a.person_id and p.active where a.day = ${today}::date and a.time_in is not null)::int as in,
          (select count(*) from person where active and role <> 'admin')::int as all`,
    ),
    rows<{ code: string; name: string; target: number; sold: number }>(
      db,
      sql`select ch.code, ch.name,
          coalesce((select sum(t.amount) from seat_target t where t.month = ${first}::date and seat_channel_id(t.seat_id) = ch.id), 0)::float8 as target,
          coalesce((select sum(s.total) from sale_invoice s where s.channel_id = ch.id and s.status <> 'cancelled' and s.issued_on between ${first}::date and ${today}::date), 0)::float8 as sold
        from channel ch where ch.active order by ch.sort, ch.id`,
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
