// An order printed as Zoho's Sales Order (GetMeds' "2MG Template"): the company on the left,
// "SALES ORDER" and its number on the right, Ship To, the order's dates and terms, the lines
// with strength, medicine form and the senior citizen / PWD discount, Zoho's tax lines and the
// total. Whoever may open the order may print it; nothing here changes the order.

import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { type Database, rows } from "../db/index";
import { vatSplit } from "../finance/rules";
import { type Env, idParam } from "../http";
import { day } from "../inventory/service";
import { SOURCE_LABEL } from "../online/rules";
import { companyInfo } from "../settings/service";
import type {
  InvoiceFrom,
  LeadSource,
  Me,
  OrderStatus,
  PaymentTerms,
  SalesOrderDoc,
  Vat,
} from "../types";
import { INVOICE_FROM_LABEL } from "./rules";
import { orderDetail } from "./service";

/** Zoho's names for an order's state on the ribbon. */
function ribbonOf(status: OrderStatus): string {
  if (status === "draft") return "Draft";
  if (status === "cancelled") return "Void";
  if (status === "completed") return "Closed";
  if (status === "on_hold" || status === "exception") return "On Hold";
  if (["pending_approval", "finance_check", "ready_for_invoice"].includes(status))
    return "Pending Approval";
  return "Confirmed";
}

/** Zoho's term names, unless the order carries the term as agreed ("PDC 30"). */
export function termsLabel(terms: PaymentTerms, days: number | null, agreed: string | null) {
  if (agreed?.trim()) return agreed.trim();
  if (terms === "advance") return "Advanced Payment";
  if (terms === "cod") return "Cash on Delivery";
  return `Net ${days ?? 30}`;
}

export async function salesOrderDoc(db: Database, me: Me, id: number): Promise<SalesOrderDoc> {
  // Opening it checks who may see the order, as the order page does.
  await orderDetail(db, me, id);
  const [o] = await rows<{
    id: number;
    code: string;
    status: OrderStatus;
    customerId: number;
    customer: string;
    customerAddress: string | null;
    customerCity: string | null;
    deliveryAddress: string | null;
    receiver: string | null;
    orderDate: string;
    terms: PaymentTerms;
    days: number | null;
    agreed: string | null;
    expectedOn: string | null;
    customerPo: string | null;
    method: "courier" | "rider" | "pickup" | null;
    courier: string | null;
    medrep: string;
    channel: string | null;
    note: string | null;
    division: string | null;
    subDivision: string | null;
    invoiceFrom: InvoiceFrom;
    doctor: string | null;
    leadCode: string | null;
    leadSource: LeadSource | null;
    deliveryFee: number;
    total: number;
    invoiceId: number | null;
    invoiceCode: string | null;
    invoiceStatus: string | null;
  }>(
    db,
    sql`select o.id::int as id, o.code, o.status, o.customer_id::int as "customerId", c.name as customer,
        c.address as "customerAddress", c.city as "customerCity", o.delivery_address as "deliveryAddress", o.receiver,
        ${day("(coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Manila')")} as "orderDate", o.payment_terms as terms,
        o.payment_days::int as days, o.payment_term as agreed, ${day("o.expected_on")} as "expectedOn",
        o.customer_po as "customerPo", o.delivery_method as method, o.courier, rep.name as medrep, ch.code as channel,
        o.note, o.division, o.sub_division as "subDivision", o.invoice_from as "invoiceFrom", doc.name as doctor,
        l.code as "leadCode", l.source as "leadSource", o.delivery_fee::int as "deliveryFee", o.total::int as total,
        i.id::int as "invoiceId", i.code as "invoiceCode", i.status as "invoiceStatus"
      from sales_order o join customer c on c.id = o.customer_id join person rep on rep.id = o.medrep_id
        left join channel ch on ch.id = o.channel_id left join customer doc on doc.id = o.doctor_id
        left join lead l on l.id = o.lead_id
        left join invoice i on i.order_id = o.id and i.status <> 'cancelled'
      where o.id = ${id}`,
  );
  if (!o) throw new Error("order vanished");
  const [items, company] = await Promise.all([
    rows<{
      id: number;
      name: string;
      strength: string | null;
      form: string | null;
      qty: number;
      unitPrice: number;
      amount: number;
      vat: Vat;
      free: boolean;
      relief: boolean;
    }>(
      db,
      sql`select i.id::int as id, m.name, m.strength, m.form, i.qty::int as qty, i.unit_price::int as "unitPrice",
          (i.qty * i.unit_price)::int as amount, m.vat, i.free, i.relief
        from order_item i join medicine m on m.id = i.medicine_id where i.order_id = ${id} order by i.id`,
    ),
    companyInfo(db),
  ]);
  const taxed = items.map((line) => ({ amount: line.amount, vat: line.vat }));
  if (o.deliveryFee > 0) taxed.push({ amount: o.deliveryFee, vat: "vat12" });
  const split = vatSplit(taxed);
  const address =
    o.deliveryAddress ?? [o.customerAddress, o.customerCity].filter(Boolean).join(", ");
  const shipTo = [
    ...(o.receiver && o.receiver !== o.customer ? [o.receiver] : []),
    ...(address ? [address] : []),
    "Philippines",
  ];
  const method =
    o.method === "courier"
      ? (o.courier ?? "Courier")
      : o.method === "rider"
        ? "Rider"
        : o.method === "pickup"
          ? "Pick-up"
          : null;
  const notes = [
    ...(o.leadCode ? [`Enquiry No.: ${o.leadCode}`] : []),
    ...(o.note ? [o.note] : []),
  ];
  const custom: [string, string][] = [
    ["Division", o.division ?? ""],
    ["Sub-division", o.subDivision ?? ""],
    ["Payment Terms", o.agreed ?? ""],
    ["Doctor Name", o.doctor ?? ""],
    ["Invoicing From", INVOICE_FROM_LABEL[o.invoiceFrom]],
    ["Source", o.leadSource ? `${SOURCE_LABEL[o.leadSource]} enquiry` : "MedRep order"],
  ];
  return {
    order: {
      id: o.id,
      code: o.code,
      status: o.status,
      ribbon: ribbonOf(o.status),
      customerId: o.customerId,
      customer: o.customer,
      shipTo,
      orderDate: o.orderDate,
      terms: termsLabel(o.terms, o.days, o.agreed),
      expectedOn: o.expectedOn,
      ref: o.customerPo,
      deliveryMethod: method,
      salesperson: `${o.channel ?? "—"} | ${o.medrep}`,
      invoiceStatus:
        o.invoiceStatus === "paid" ? "PAID" : o.invoiceCode ? "INVOICED" : "NOT INVOICED",
      shipment:
        o.status === "cancelled"
          ? "VOID"
          : o.status === "completed"
            ? "FULFILLED"
            : o.status === "shipped"
              ? "SHIPPED"
              : "PENDING",
      notes,
      customFields: custom.filter(([, value]) => value),
      deliveryFee: o.deliveryFee,
      total: o.total,
      invoiceFrom: o.invoiceFrom,
      invoiceFromLabel: INVOICE_FROM_LABEL[o.invoiceFrom],
      invoiceId: o.invoiceId,
      invoiceCode: o.invoiceCode,
    },
    company,
    items: items.map((line) => ({
      id: line.id,
      item: [line.name, line.strength].filter(Boolean).join(" "),
      strength: line.strength,
      form: line.form,
      discount: line.relief ? "20%" : null,
      qty: line.qty,
      unitPrice: line.unitPrice,
      amount: line.amount,
      vat: line.vat,
      free: line.free,
    })),
    tax: {
      vat: split.vat,
      vatLines: split.vatable + split.vat > 0,
      exempt: split.exempt > 0,
      zeroRated: split.zeroRated > 0,
    },
  };
}

export function salesOrderRoutes(app: Hono<Env>, db: Database): void {
  app.get("/api/orders/:id/sales-order", async (c) =>
    c.json(await salesOrderDoc(db, c.get("me"), idParam(c))),
  );
}
