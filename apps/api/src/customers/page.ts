// One customer's whole story on one page (a hospital, a doctor, a buyer or a patient): who looks
// after them up the line, every order with its medicines and money, what they buy, every
// invoice and payment, their enquiries at the Online desk and what happened lately. The
// customer is found the usual way (customerDetail: the same "may this person see it" rule), and
// a patient is also known by their mobile number, so their enquiries on that number come along.

import { may } from "../http";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { duesSql } from "../finance/dues";
import { invoiceState, METHOD_LABEL } from "../finance/rules";
import { todayManila } from "../inventory/rules";
import { day, iso } from "../inventory/service";
import { LEAD_READ_ROLES } from "../online/rules";
import { STATUS_LABEL } from "../orders/rules";
import { pointsByPhone } from "../points/service";
import type { CustomerPage, Me, OrderStatus, PaymentMethod, PaymentTerms } from "../types";
import { refillOf } from "./reorders";
import { customerDetail } from "./service";

const LIMIT = 100;

export async function customerPage(db: Database, me: Me, id: number): Promise<CustomerPage> {
  // The access check: refuses a customer this person may not see.
  const detail = await customerDetail(db, me, id);
  const today = todayManila();
  const [base] = await rows<{ phoneKey: string | null; areaId: number | null; addedBy: number }>(
    db,
    sql`select phone_key as "phoneKey", area_id::int as "areaId", added_by::int as "addedBy" from customer where id = ${id}`,
  );
  const phone = base?.phoneKey ?? null;
  const readsCases = may(me, LEAD_READ_ROLES);
  const sameCases = sql`(l.customer_id = ${id} or ${phone ? sql`l.phone_key = ${phone}` : sql`false`})`;

  const [orders, counted, medicines, invoices, payments, cases, events, starter] =
    await Promise.all([
      rows<{
        id: number;
        code: string;
        status: OrderStatus;
        total: number;
        at: string;
        medrep: string;
        raisedBy: string;
        terms: PaymentTerms;
        days: number | null;
        medicines: string | null;
        invoiceId: number | null;
        invoiceCode: string | null;
        invoiceStatus: "open" | "paid" | "cancelled" | null;
        invoiceTotal: number | null;
        invoicePaid: number | null;
        dueOn: string | null;
        leadId: number | null;
      }>(
        db,
        sql`select o.id::int as id, o.code, o.status, o.total::int as total, ${iso("coalesce(o.submitted_at, o.created_at)")} as at,
          m.name as medrep, r.name as "raisedBy", o.payment_terms as terms, o.payment_days::int as days,
          (select string_agg(md.name || coalesce(' ' || md.strength, '') || ' × ' || i.qty || case when i.free then ' (free)' else '' end, ', ' order by i.id)
             from order_item i join medicine md on md.id = i.medicine_id where i.order_id = o.id) as medicines,
          v.id::int as "invoiceId", v.code as "invoiceCode", v.status as "invoiceStatus", v.total::int as "invoiceTotal",
          v.paid::int as "invoicePaid", ${day("v.due_on")} as "dueOn", o.lead_id::int as "leadId"
        from sales_order o
        join person m on m.id = o.medrep_id
        join person r on r.id = o.raised_by
        left join invoice v on v.order_id = o.id and v.status <> 'cancelled'
        where o.customer_id = ${id} and o.status <> 'draft'
        order by o.created_at desc, o.id desc limit ${LIMIT}`,
      ),
      rows<{ orders: number; bought: number; firstAt: string | null; lastAt: string | null }>(
        db,
        sql`select count(*)::int as orders, coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::float8 as bought,
          ${iso("min(o.created_at)")} as "firstAt", ${iso("max(o.created_at)")} as "lastAt"
        from sales_order o where o.customer_id = ${id} and o.status not in ('draft', 'cancelled')`,
      ),
      rows<CustomerPage["medicines"][number]>(
        db,
        sql`select i.medicine_id::int as id, md.name, md.strength, md.unit,
          count(distinct o.id)::int as times, sum(i.qty)::int as qty,
          sum(i.qty) filter (where i.free)::int as "freeQty",
          sum(i.qty::bigint * i.unit_price)::float8 as amount, ${iso("max(o.created_at)")} as "lastAt",
          (array_agg(i.unit_price order by o.created_at desc) filter (where not i.free))[1]::int as "lastPrice"
        from order_item i
        join sales_order o on o.id = i.order_id
        join medicine md on md.id = i.medicine_id
        where o.customer_id = ${id} and o.status not in ('draft', 'cancelled')
        group by i.medicine_id, md.name, md.strength, md.unit
        order by max(o.created_at) desc limit ${LIMIT}`,
      ),
      rows<{
        id: number;
        code: string;
        orderId: number;
        orderCode: string;
        issuedOn: string;
        dueOn: string;
        total: number;
        paid: number;
        status: "open" | "paid" | "cancelled";
        terms: PaymentTerms;
        delivered: boolean;
      }>(
        db,
        sql`select v.id::int as id, v.code, v.order_id::int as "orderId", o.code as "orderCode",
          ${day("v.issued_on")} as "issuedOn", ${day("v.due_on")} as "dueOn", v.total::int as total, v.paid::int as paid,
          v.status, v.terms, (o.status = 'completed') as delivered
        from invoice v join sales_order o on o.id = v.order_id
        where v.customer_id = ${id}
        order by v.issued_on desc, v.id desc limit ${LIMIT}`,
      ),
      rows<{
        id: number;
        amount: number;
        method: PaymentMethod;
        reference: string | null;
        paidOn: string;
        invoiceId: number;
        invoiceCode: string;
        by: string;
      }>(
        db,
        sql`select p.id::int as id, p.amount::int as amount, p.method, p.reference, ${day("p.paid_on")} as "paidOn",
          v.id::int as "invoiceId", v.code as "invoiceCode", b.name as by
        from payment p join invoice v on v.id = p.invoice_id join person b on b.id = p.by_person
        where p.customer_id = ${id} and p.active
        order by p.paid_on desc, p.id desc limit ${LIMIT}`,
      ),
      readsCases
        ? rows<NonNullable<CustomerPage["cases"]>[number]>(
            db,
            sql`select l.id::int as id, l.code, l.state, ${iso("l.first_contact_at")} as at, l.request,
              o.code as "orderCode", a.name as owner
            from lead l
            left join sales_order o on o.id = l.order_id
            left join person a on a.id = l.assigned_to
            where ${sameCases}
            order by l.first_contact_at desc, l.id desc limit ${LIMIT}`,
          )
        : Promise.resolve(null),
      rows<CustomerPage["events"][number]>(
        db,
        sql`select e.id::int as id, e.message, coalesce(p.name, 'System') as by, ${iso("e.at")} as at,
          o.id::int as "orderId", o.code as "orderCode"
        from order_event e
        join sales_order o on o.id = e.order_id
        left join person p on p.id = e.by_person
        where o.customer_id = ${id}
        order by e.at desc, e.id desc limit 40`,
      ),
      // Who looks after them first: the MedRep holding their area, else whoever works their latest
      // enquiry, else the MedRep of their latest order, else whoever added them.
      rows<{ id: number }>(
        db,
        sql`select coalesce(
          (select p.id from person p where p.area_id = ${base?.areaId ?? null} and p.role = 'medrep' and p.active order by p.name limit 1),
          (select l.assigned_to from lead l where ${sameCases} and l.assigned_to is not null order by l.first_contact_at desc limit 1),
          (select o.medrep_id from sales_order o where o.customer_id = ${id} and o.status <> 'draft' order by o.created_at desc limit 1),
          ${base?.addedBy ?? null}::bigint
        )::int as id`,
      ),
    ]);

  // The line above them: the person, whom they report to, and so on (three people at most).
  const first = starter[0]?.id ?? null;
  const line = first
    ? await rows<{ id: number; name: string; title: string | null; role: string }>(
        db,
        sql`with recursive up as (
            select p.id, p.reports_to, 0 as depth from person p where p.id = ${first}
            union all
            select p.id, p.reports_to, up.depth + 1 from person p join up on p.id = up.reports_to where up.depth < 2
          )
          select p.id::int as id, p.name, p.title, p.role from up join person p on p.id = up.id
          where p.role not in ('admin') order by up.depth`,
      )
    : [];

  const invoiceRows = invoices.map((invoice) => {
    const state = invoiceState(invoice, today);
    return {
      id: invoice.id,
      code: invoice.code,
      orderId: invoice.orderId,
      orderCode: invoice.orderCode,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      total: invoice.total,
      paid: invoice.paid,
      balance: invoice.status === "cancelled" ? 0 : Math.max(0, invoice.total - invoice.paid),
      state,
    };
  });
  // What Zoho's invoices and opening balance still have them owing (their days late too).
  const [zoho] = await rows<{ owed: number; overdue: number; days: number }>(
    db,
    sql`select coalesce(sum(dd.balance), 0)::float8 as owed,
        coalesce(sum(dd.balance) filter (where dd.late > 0), 0)::float8 as overdue,
        coalesce(max(dd.late) filter (where dd.late > 0), 0)::int as days
      from ${duesSql(today)} dd where dd.customer_id = ${detail.customer.id} and dd.source <> 'crm'`,
  );
  const owed = invoiceRows.reduce((sum, invoice) => sum + invoice.balance, 0) + (zoho?.owed ?? 0);
  const overdue =
    invoiceRows.reduce((sum, invoice) => sum + (invoice.state.overdueDays > 0 ? invoice.balance : 0), 0) +
    (zoho?.overdue ?? 0);
  const [points, refill] = await Promise.all([
    detail.customer.kind === "patient" ? pointsByPhone(db, phone) : null,
    refillOf(db, me, id),
  ]);

  return {
    ...detail,
    line: line.map((person) => ({ name: person.name, title: person.title, role: person.role })),
    totals: {
      orders: counted[0]?.orders ?? 0,
      bought: counted[0]?.bought ?? 0,
      owed,
      overdue,
      zohoOwed: zoho?.owed ?? 0,
      zohoOverdue: zoho?.overdue ?? 0,
      zohoDays: zoho?.days ?? 0,
      firstOrderAt: counted[0]?.firstAt ?? null,
      lastOrderAt: counted[0]?.lastAt ?? null,
      paid: payments.reduce((sum, payment) => sum + payment.amount, 0),
    },
    orders: orders.map((order) => {
      const invoice =
        order.invoiceId && order.invoiceStatus
          ? invoiceState(
              {
                status: order.invoiceStatus,
                terms: order.terms,
                dueOn: order.dueOn ?? today,
                paid: order.invoicePaid ?? 0,
                total: order.invoiceTotal ?? 0,
                delivered: order.status === "completed",
              },
              today,
            )
          : null;
      return {
        id: order.id,
        code: order.code,
        status: order.status,
        statusLabel: STATUS_LABEL[order.status],
        total: order.total,
        at: order.at,
        medrep: order.medrep,
        raisedBy: order.raisedBy,
        medicines: order.medicines,
        leadId: order.leadId,
        invoice:
          order.invoiceId && order.invoiceCode && invoice
            ? {
                id: order.invoiceId,
                code: order.invoiceCode,
                balance: Math.max(0, (order.invoiceTotal ?? 0) - (order.invoicePaid ?? 0)),
                state: invoice,
              }
            : null,
      };
    }),
    medicines,
    invoices: invoiceRows,
    payments: payments.map((payment) => ({
      ...payment,
      methodLabel: METHOD_LABEL[payment.method],
    })),
    cases,
    events,
    points: points ? { balance: points.balance } : null,
    refill,
  };
}
