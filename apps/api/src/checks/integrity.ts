// The data checked against itself (Aryan: "andar kuch bigad toh nahi gaya"): every order's total
// is its lines, every bill is its order less what came back, every payment and refund adds up on
// its bill, the shelf is the sum of its moves and never below zero, every order has a MedRep and
// a channel, the reporting line has no loops, delivered goods were picked, returns credit what
// came back, points balances are their entries. Each check says what is wrong, by name.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import type { DataCheck, DataChecks, Me } from "../types";

const SHOWN = 20;

type Check = { key: string; label: string; query: SQL };

const CHECKS: Check[] = [
  {
    key: "order_total",
    label: "Every order's total is its lines plus its delivery fee",
    query: sql`select o.code || ': total ' || o.total || ', lines ' || coalesce(s.lines, 0) + o.delivery_fee as problem
      from sales_order o left join (select order_id, sum(qty * unit_price) as lines from order_item group by order_id) s on s.order_id = o.id
      where o.total <> coalesce(s.lines, 0) + o.delivery_fee`,
  },
  {
    key: "invoice_total",
    label: "Every bill is its order, less what came back",
    query: sql`select i.code || ' (' || o.code || '): bill ' || i.total || ' + returned ' || i.credited || ' <> order ' || o.total as problem
      from invoice i join sales_order o on o.id = i.order_id
      where i.status <> 'cancelled' and i.total + i.credited <> o.total`,
  },
  {
    key: "invoice_paid",
    label: "What a bill says was paid is its payments",
    query: sql`select i.code || ': paid ' || i.paid || ', payments ' || coalesce(p.sum, 0) as problem
      from invoice i left join (select invoice_id, sum(amount) as sum from payment where active group by invoice_id) p on p.invoice_id = i.id
      where i.paid <> coalesce(p.sum, 0)`,
  },
  {
    key: "invoice_refunded",
    label: "What a bill says was given back is its refunds",
    query: sql`select i.code || ': refunded ' || i.refunded || ', refunds ' || coalesce(r.sum, 0) as problem
      from invoice i left join (select invoice_id, sum(amount) as sum from refund group by invoice_id) r on r.invoice_id = i.id
      where i.refunded <> coalesce(r.sum, 0)`,
  },
  {
    key: "invoice_status",
    label: "A bill is paid exactly when its money is in",
    query: sql`select i.code || ': ' || i.status || ' with ' || i.paid || ' of ' || i.total as problem
      from invoice i
      where i.status <> 'cancelled' and i.total > 0
        and ((i.status = 'paid') <> (i.paid >= i.total))`,
  },
  {
    key: "overpaid",
    label: "No bill was paid beyond what it was made for",
    query: sql`select i.code || ': paid ' || (i.paid - i.refunded) || ' on a bill of ' || (i.total + i.credited) as problem
      from invoice i where i.status <> 'cancelled' and i.paid - i.refunded > i.total + i.credited`,
  },
  {
    key: "stock_negative",
    label: "No shelf is below zero",
    query: sql`select m.name || ' batch ' || b.batch_no || ' in ' || w.name || ': ' || s.qty as problem
      from stock s join batch b on b.id = s.batch_id join medicine m on m.id = b.medicine_id join warehouse w on w.id = s.warehouse_id
      where s.qty < 0`,
  },
  {
    key: "stock_moves",
    label: "Every shelf is the sum of its moves",
    query: sql`select m.name || ' batch ' || b.batch_no || ' in ' || w.name || ': shelf ' || coalesce(s.qty, 0) || ', moves ' || coalesce(mv.sum, 0) as problem
      from (select batch_id, warehouse_id from stock union select batch_id, warehouse_id from stock_move) k
      left join stock s on s.batch_id = k.batch_id and s.warehouse_id = k.warehouse_id
      left join (select batch_id, warehouse_id, sum(qty) as sum from stock_move group by 1, 2) mv on mv.batch_id = k.batch_id and mv.warehouse_id = k.warehouse_id
      join batch b on b.id = k.batch_id join medicine m on m.id = b.medicine_id join warehouse w on w.id = k.warehouse_id
      where coalesce(s.qty, 0) <> coalesce(mv.sum, 0)`,
  },
  {
    key: "order_people",
    label: "Every placed order has its MedRep and channel",
    query: sql`select o.code || ': ' || case when o.medrep_id is null then 'no MedRep' else 'no channel' end as problem
      from sales_order o where o.status <> 'draft' and (o.medrep_id is null or o.channel_id is null)`,
  },
  {
    key: "delivered_billed",
    label: "Every delivered order has its bill",
    query: sql`select o.code || ': delivered, no bill' as problem
      from sales_order o where o.status = 'completed'
        and not exists (select 1 from invoice i where i.order_id = o.id and i.status <> 'cancelled')`,
  },
  {
    key: "picked",
    label: "What went out was picked from a batch",
    query: sql`select o.code || ' ' || m.name || ': ' || i.qty || ' ordered, ' || coalesce(p.sum, 0) || ' picked' as problem
      from order_item i join sales_order o on o.id = i.order_id join medicine m on m.id = i.medicine_id
      left join (select order_item_id, sum(qty) as sum from order_pick where active group by 1) p on p.order_item_id = i.id
      where o.status in ('packing', 'shipped') and coalesce(p.sum, 0) <> i.qty`,
  },
  {
    key: "returns_credit",
    label: "Every return credited exactly what came back",
    query: sql`select r.code || ': credited ' || r.credit || ', came back ' || coalesce(l.sum, 0) as problem
      from sales_return r left join (select return_id, sum(qty * unit_price) as sum from sales_return_line where outcome <> 'missing' group by 1) l on l.return_id = r.id
      where r.status = 'received' and r.credit <> coalesce(l.sum, 0)`,
  },
  {
    key: "returns_qty",
    label: "Nothing came back beyond what was delivered",
    query: sql`select o.code || ' ' || m.name || ': ' || i.qty || ' delivered, ' || l.sum || ' back' as problem
      from order_item i join sales_order o on o.id = i.order_id join medicine m on m.id = i.medicine_id
      join (select l.order_item_id, sum(l.qty) as sum from sales_return_line l join sales_return r on r.id = l.return_id
        where r.status in ('requested', 'approved', 'checked', 'received') and coalesce(l.outcome, '') <> 'missing' group by 1) l on l.order_item_id = i.id
      where l.sum > i.qty`,
  },
  {
    key: "points",
    label: "Every points balance is its entries",
    query: sql`select a.name || ': balance ' || a.balance || ', entries ' || coalesce(e.sum, 0) as problem
      from points_account a left join (select account_id, sum(points) as sum from points_entry group by 1) e on e.account_id = a.id
      where a.balance <> coalesce(e.sum, 0)`,
  },
  {
    key: "reporting_loop",
    label: "No one reports to themself, up the line",
    query: sql`with recursive up (start, id, depth) as (
        select id, reports_to, 1 from person where active and reports_to is not null
        union all
        select up.start, p.reports_to, up.depth + 1 from up join person p on p.id = up.id where p.reports_to is not null and up.depth < 30
      )
      select distinct p.name || ' is in a reporting loop' as problem from up join person p on p.id = up.start where up.id = up.start`,
  },
  {
    key: "medrep_lead",
    label: "Every MedRep has someone they report to",
    query: sql`select p.name || ' (MedRep) reports to no one' as problem
      from person p where p.active and p.role = 'medrep' and p.reports_to is null`,
  },
  {
    // The chart decides who each person reports to, and every lead's and head's screens read that
    // (Aryan, 19 Nov: "is everyone's data going up to the right lead and head?"). Someone in one
    // seat whose boss isn't the one the chart gives them would be missed by their own lead.
    key: "chart_boss",
    label: "Everyone reports to the lead the chart gives them",
    query: sql`with one_seat as (
        select h.person_id, min(h.seat_id) as seat_id from seat_holder h join seat s on s.id = h.seat_id
        where h.kind = 'holder' and s.active and h.starts_on <= (now() at time zone 'Asia/Manila')::date
          and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
        group by h.person_id having count(*) = 1
      )
      select p.name || ' reports to ' || coalesce(b.name, 'no one') || '; the chart says ' || coalesce(sb.name, 'no one') as problem
      from one_seat o join seat s on s.id = o.seat_id join person p on p.id = o.person_id
      left join person b on b.id = p.reports_to left join person sb on sb.id = s.boss_id
      where p.active and coalesce(p.reports_to, 0) <> coalesce(s.boss_id, 0) and coalesce(s.boss_id, 0) <> p.id`,
  },
  {
    key: "inactive_boss",
    label: "No one reports to someone who has left",
    query: sql`select p.name || ' reports to ' || b.name || ', who has left' as problem
      from person p join person b on b.id = p.reports_to where p.active and not b.active`,
  },
  {
    key: "timekeeping_days",
    label: "Every timekeeping import's day count is the days it kept",
    query: sql`select 'Import ' || i.id || ' (' || to_char(i.from_day, 'YYYY-MM-DD') || ' to ' || to_char(i.to_day, 'YYYY-MM-DD')
        || '): says ' || i.days || ' days, kept ' || coalesce(b.days, 0) as problem
      from timekeeping_import i left join (select import_id, count(*)::int as days from biometric_day group by import_id) b
        on b.import_id = i.id
      where i.days <> coalesce(b.days, 0)`,
  },
];

/** Runs every check; each says how many things are wrong and names the first few. */
export async function dataChecks(db: Database, me: Me): Promise<DataChecks> {
  allow(me, ["admin", "ceo"], "check the data");
  return runChecks(db);
}

export async function runChecks(db: Database): Promise<DataChecks> {
  const results: DataCheck[] = [];
  for (const check of CHECKS) {
    const found = await rows<{ problem: string }>(db, check.query);
    results.push({
      key: check.key,
      label: check.label,
      ok: found.length === 0,
      count: found.length,
      problems: found.slice(0, SHOWN).map((row) => row.problem),
    });
  }
  return { at: new Date().toISOString(), checks: results, ok: results.every((one) => one.ok) };
}
