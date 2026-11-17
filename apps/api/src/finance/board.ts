// Finance's work board, in the order the money is worked: 1 Check payment (an advance order: the
// proof, the amount it should be), 2 Check dues (a credit or cash-on-delivery order, invoiced on approval: what the
// customer already owes and how late, against their credit limit), 3 Collect (open invoices, the
// latest past due first, cash on delivery once delivered). With the money in today and this month,
// what is owed and overdue. A few queries whatever the number of orders.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow } from "../http";
import { todayManila } from "../inventory/rules";
import { day, iso } from "../inventory/service";
import { POINT_CENTAVOS } from "../points/service";
import type { FinanceBoard, FinanceCollect, FinanceOrderCard, Me } from "../types";
import { FINANCE_READ_ROLES, FINANCE_ROLES } from "./rules";
import { duesSql, notDueSql } from "./dues";

const LANE_SIZE = 100;

export async function financeBoard(db: Database, me: Me): Promise<FinanceBoard> {
  allow(me, FINANCE_READ_ROLES, "see Finance's work");
  const today = todayManila();
  const balance = sql`(i.total - i.paid)`;
  // Cash on delivery isn't owed until the goods arrive, nor advance pay until Finance checks it.
  const notYetDue = notDueSql;
  const onDelivery = sql`(i.terms in ('cod', 'days') and o.status <> 'completed')`;
  // Owed: every open invoice but cash on delivery not yet delivered; late: only once it is due
  // (credit counts from delivery). Zoho's unpaid invoices and opening balances count too (Aryan,
  // 17 Nov: Finance checks what the customer already owes, wherever it was billed). The order's
  // own invoice (made when Management approved it) is not what they owed before it.
  const owedBy = (late: boolean) =>
    sql`(select coalesce(sum(dd.balance), 0)::float8 from ${duesSql(today)} dd
      where dd.customer_id = c.id and dd.order_id is distinct from o.id
        and ${late ? sql`not dd.on_delivery and dd.late > 0` : sql`not dd.cod_waiting`})`;
  const orderColumns = sql`o.id::int as id, o.code, o.customer_id::int as "customerId", c.name as customer, c.kind as "customerKind",
    rep.name as medrep, o.total::int as total, (o.total - o.points_used * ${POINT_CENTAVOS})::int as due,
    o.payment_terms as terms, o.payment_days::int as "paymentDays", o.payment_term as "paymentTerm",
    c.credit_limit::int as "creditLimit", ${owedBy(false)} as owed, ${owedBy(true)} as overdue,
    ${iso("o.status_since")} as "stepSince", o.note, o.customer_po as "customerPo",
    (select f.id::int from order_file f where f.order_id = o.id and f.active and f.kind = 'payment_proof'
      order by f.at desc, f.id desc limit 1) as "proofId",
    (select f.mime from order_file f where f.order_id = o.id and f.active and f.kind = 'payment_proof'
      order by f.at desc, f.id desc limit 1) as "proofMime"`;
  const orderFrom = sql`from sales_order o join customer c on c.id = o.customer_id join person rep on rep.id = o.medrep_id`;

  const [check, invoice, collect, money] = await Promise.all([
    rows<FinanceOrderCard>(
      db,
      sql`select ${orderColumns} ${orderFrom} where o.status = 'finance_check' order by o.status_since, o.id limit ${LANE_SIZE}`,
    ),
    rows<FinanceOrderCard>(
      db,
      sql`select ${orderColumns} ${orderFrom} where o.status = 'ready_for_invoice' order by o.status_since, o.id limit ${LANE_SIZE}`,
    ),
    rows<FinanceCollect>(
      db,
      sql`select i.id::int as "invoiceId", i.code, i.order_id::int as "orderId", o.code as "orderCode",
          c.id::int as "customerId", c.name as customer, rep.name as medrep, i.terms, i.total::int as total, ${balance}::int as balance,
          ${day("i.due_on")} as "dueOn", (${today}::date - i.due_on)::int as "daysLate",
          (o.status = 'completed') as delivered, o.delivery_method as "deliveryMethod", o.courier, o.rider,
          (select max(p.paid_on) from payment p where p.invoice_id = i.id and p.active)::text as "lastPaidOn"
        from invoice i join sales_order o on o.id = i.order_id join customer c on c.id = i.customer_id join person rep on rep.id = o.medrep_id
        where i.status = 'open' and ${balance} > 0 and not ${notYetDue}
        order by (${today}::date - i.due_on) desc, i.due_on, i.id limit ${LANE_SIZE}`,
    ),
    rows<FinanceBoard["money"]>(
      db,
      sql`select
          (select coalesce(sum(p.amount), 0) from payment p where p.active and p.method not in ('points', 'withholding') and p.paid_on = ${today}::date)::int as "inToday",
          (select coalesce(sum(p.amount), 0) from payment p where p.active and p.method not in ('points', 'withholding')
            and date_trunc('month', p.paid_on) = date_trunc('month', ${today}::date))::int as "inMonth",
          (select coalesce(sum(i.total), 0) from invoice i where i.status <> 'cancelled'
            and date_trunc('month', i.issued_on) = date_trunc('month', ${today}::date))::int as "invoicedMonth",
          (select coalesce(sum(dd.balance), 0) from ${duesSql(today)} dd where not dd.on_delivery)::float8 as owed,
          (select coalesce(sum(dd.balance), 0) from ${duesSql(today)} dd where not dd.on_delivery and dd.late > 0)::float8 as overdue,
          (select coalesce(sum(i.total - i.paid), 0) from invoice i join sales_order o on o.id = i.order_id
            where i.status = 'open' and ${onDelivery})::int as "onDelivery",
          (select count(*) from invoice i join sales_order o on o.id = i.order_id where i.status = 'cancelled' and o.status = 'cancelled' and i.paid - (select coalesce(sum(pp.amount), 0) from payment pp where pp.invoice_id = i.id and pp.active and pp.method in ('points', 'withholding')) > i.refunded)::int as refunds,
          (select count(*) from sales_order o where o.status in ('on_hold', 'exception')
            and (o.held_role = 'finance' or o.held_from in ('finance_check', 'ready_for_invoice')))::int as held,
          (select count(*) from sales_order o where o.status = 'pending_approval')::int as coming,
          (select count(*) from invoice i join sales_order o on o.id = i.order_id
            where i.status = 'open' and i.total > i.paid and not ${notYetDue})::int as "toCollect"`,
    ),
  ]);
  return {
    today,
    check,
    invoice,
    collect,
    money: money[0] ?? {
      inToday: 0,
      inMonth: 0,
      invoicedMonth: 0,
      owed: 0,
      overdue: 0,
      onDelivery: 0,
      refunds: 0,
      held: 0,
      coming: 0,
      toCollect: 0,
    },
    can: { work: FINANCE_ROLES.includes(me.role) },
  };
}
