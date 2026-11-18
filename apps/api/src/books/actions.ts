// Making Purchases documents in the books, as Zoho Inventory makes them (docs/PLAN.md 17):
// a purchase order (draft or issued), its receives (the goods go on the shelf in their batches),
// its bills (Convert to Bill) or a bill on its own (rent, a utility), payments made on bills (what
// is not put on a bill stays as the payment's unused amount), vendor credits put on bills, and a
// new vendor. Every change happens in one step; nothing is deleted: a bill, payment or credit is
// voided and stays.
//
// Who: purchase orders and receives — Inventory and the Admin; bills — Inventory, Finance and the
// Admin; payments and vendor credits — Finance and the Admin (interim, docs/PLAN.md 17).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { logMove, putIn, type Runner } from "../inventory/service";
import { todayManila } from "../inventory/rules";
import type { Role } from "../people/roles";
import type { BookChoices, Me } from "../types";
import { LEDGER_ROLES } from "./accounts";
import { landedCosts } from "../purchases/landed";
import { assertOpen } from "./write";
import { freeStatementLine, guardReconciled } from "./bank";

const PO_ROLES: Role[] = ["inventory", "admin"];
const BILL_ROLES: Role[] = ["inventory", "finance", "admin"];
const PAY_ROLES: Role[] = ["finance", "admin"];
const READ_ROLES: Role[] = ["inventory", "management", "finance", "ceo", "admin"];

const clean = (text?: string | null) => text?.trim() || null;
const centsOf = (pesos: number) => Math.round(pesos * 100);

/** The next number in a series as Zoho counts it: PO-04368 → PO-04369; payments are plain numbers. */
export async function nextNumber(tx: Runner, kind: string, prefix: string, width: number): Promise<string> {
  const [last] = await rows<{ n: number | null }>(
    tx,
    prefix
      ? sql`select max(substring(number from ${`^${prefix}(\\d+)$`})::bigint)::float8 as n from book_doc where kind = ${kind} and number ~ ${`^${prefix}\\d+$`}`
      : sql`select max(number::bigint)::float8 as n from book_doc where kind = ${kind} and number ~ '^\\d+$'`,
  );
  return `${prefix}${String((last?.n ?? 0) + 1).padStart(width, "0")}`;
}

export async function bookChoices(db: Database, me: Me): Promise<BookChoices> {
  allow(me, READ_ROLES, "see the purchases");
  const [vendors, warehouses, medicines, accounts, modes, paidThrough, po, receive, payment, credit, receivedOrders] = await Promise.all([
    rows<BookChoices["vendors"][number]>(db, sql`select id::int as id, name, currency, payment_terms as "paymentTerms" from supplier where active order by lower(name)`),
    rows<BookChoices["warehouses"][number]>(db, sql`select id::int as id, name from warehouse where active order by is_default desc, name`),
    rows<BookChoices["medicines"][number]>(
      db,
      sql`select m.id::int as id, m.name || coalesce(' ' || m.strength, '') as name,
          (select s.sku from medicine_sku s where s.medicine_id = m.id order by s.id limit 1) as sku, m.pack as unit
        from medicine m where m.active order by lower(m.name)`,
    ),
    rows<{ a: string }>(db, sql`select account as a from book_line where account is not null group by account order by count(*) desc limit 60`),
    rows<{ a: string }>(db, sql`select fields->>'Mode' as a from book_doc where kind = 'vendor_payment' and fields ? 'Mode' group by 1 order by count(*) desc`),
    rows<{ a: string }>(db, sql`select fields->>'Paid Through' as a from book_doc where kind = 'vendor_payment' and fields ? 'Paid Through' group by 1 order by count(*) desc limit 40`),
    nextNumber(db, "purchase_order", "PO-", 5),
    nextNumber(db, "purchase_receive", "PR-", 5),
    nextNumber(db, "vendor_payment", "", 0),
    nextNumber(db, "vendor_credit", "DN-", 5),
    rows<BookChoices["receivedOrders"][number]>(
      db,
      sql`select o.id::int as id, o.number, coalesce(s.name, o.party_name, '') as party, to_char(o.doc_date, 'YYYY-MM-DD') as date,
          round(o.total * o.fx_rate)::bigint::float8 as worth
        from book_doc o left join supplier s on s.id = o.supplier_id
        where o.kind = 'purchase_order' and o.status not in ('draft', 'cancelled', 'void')
          and exists (select 1 from book_line l where l.doc_id = o.id and l.medicine_id is not null)
        order by o.doc_date desc, o.id desc limit 300`,
    ),
  ]);
  return {
    today: todayManila(),
    vendors,
    warehouses,
    medicines,
    accounts: accounts.map((row) => row.a),
    modes: modes.map((row) => row.a),
    paidThrough: paidThrough.map((row) => row.a),
    next: { purchaseOrder: po, receive, payment, vendorCredit: credit },
    receivedOrders,
  };
}

type Vendor = { id: number; name: string; currency: string };
async function vendorOf(tx: Runner, id: number): Promise<Vendor> {
  const [vendor] = await rows<Vendor>(tx, sql`select id::int as id, name, currency from supplier where id = ${id}`);
  if (!vendor) throw new Refusal(400, "invalid", "Pick a vendor from the list.", "supplierId");
  return vendor;
}

export type LineInput = { medicineId?: number | null; itemName?: string | null; description?: string | null; account?: string | null; qty: number; rate: number; taxPct?: number | null };

export type MadeLine = { medicineId: number | null; itemName: string; sku: string | null; description: string | null; account: string | null; unit: string | null; qty: number; rate: number; taxPct: number | null; taxAmount: number; amount: number };

/** Lines as typed: a medicine (its name and SKU come with it) or an item or account by name. */
export async function linesOf(tx: Runner, input: LineInput[]): Promise<MadeLine[]> {
  if (!input.length) throw new Refusal(400, "invalid", "Add at least one item.", "lines");
  const out: MadeLine[] = [];
  for (const [at, line] of input.entries()) {
    let itemName = clean(line.itemName);
    let sku: string | null = null;
    let unit: string | null = null;
    if (line.medicineId) {
      const [medicine] = await rows<{ name: string; sku: string | null; unit: string | null }>(
        tx,
        sql`select m.name || coalesce(' ' || m.strength, '') as name, (select s.sku from medicine_sku s where s.medicine_id = m.id order by s.id limit 1) as sku, 'pcs' as unit
          from medicine m where m.id = ${line.medicineId}`,
      );
      if (!medicine) throw new Refusal(400, "invalid", "Pick the item from the list.", `lines.${at}.medicineId`);
      itemName = medicine.name;
      sku = medicine.sku;
      unit = medicine.unit;
    }
    if (!itemName && !clean(line.account)) throw new Refusal(400, "invalid", "Pick an item or an account.", `lines.${at}.medicineId`);
    if (!(line.qty > 0)) throw new Refusal(400, "invalid", "Type how many.", `lines.${at}.qty`);
    if (!(line.rate >= 0)) throw new Refusal(400, "invalid", "Type the rate.", `lines.${at}.rate`);
    const amount = centsOf(line.qty * line.rate);
    const taxAmount = line.taxPct ? Math.round((amount * line.taxPct) / 100) : 0;
    out.push({
      medicineId: line.medicineId ?? null,
      itemName: itemName ?? (clean(line.account) as string),
      sku,
      description: clean(line.description),
      account: clean(line.account),
      unit,
      qty: line.qty,
      rate: line.rate,
      taxPct: line.taxPct ?? null,
      taxAmount,
      amount,
    });
  }
  return out;
}

async function insertDoc(
  tx: Runner,
  doc: {
    kind: string;
    number: string;
    reference?: string | null;
    date: string;
    dueDate?: string | null;
    status: string;
    vendor: Vendor;
    fxRate?: number;
    subTotal?: number | null;
    total: number;
    balance: number;
    paymentTerms?: string | null;
    notes?: string | null;
    fields?: Record<string, unknown>;
    warehouseId?: number | null;
    by: number;
  },
): Promise<number> {
  const [made] = await rows<{ id: number }>(
    tx,
    sql`insert into book_doc (kind, number, reference, doc_date, due_date, status, supplier_id, party_name, currency, fx_rate, sub_total, total, balance,
        payment_terms, notes, fields, warehouse_id, created_by)
      values (${doc.kind}, ${doc.number}, ${clean(doc.reference)}, ${doc.date}::date, ${doc.dueDate ?? null}::date, ${doc.status}, ${doc.vendor.id}, ${doc.vendor.name},
        ${doc.vendor.currency}, ${doc.fxRate ?? 1}, ${doc.subTotal ?? null}, ${doc.total}, ${doc.balance}, ${clean(doc.paymentTerms)}, ${clean(doc.notes)},
        ${JSON.stringify(doc.fields ?? {})}::jsonb, ${doc.warehouseId ?? null}, ${doc.by})
      returning id::int as id`,
  );
  if (!made) throw new Error("book_doc insert");
  return made.id;
}

export async function insertLines(tx: Runner, docId: number, lines: (MadeLine & { fromLine?: number | null; batchId?: number | null; batches?: unknown[]; warehouse?: string | null; qtyDone?: Record<string, number> })[]) {
  for (const [n, line] of lines.entries())
    await tx.execute(
      sql`insert into book_line (doc_id, n, medicine_id, item_name, sku, description, account, warehouse, unit, qty, rate, tax_pct, tax_amount, amount, qty_done, batches, from_line, batch_id)
        values (${docId}, ${n + 1}, ${line.medicineId}, ${line.itemName}, ${line.sku}, ${line.description}, ${line.account}, ${line.warehouse ?? null}, ${line.unit},
          ${line.qty}, ${line.rate}, ${line.taxPct}, ${line.taxAmount || null}, ${line.amount}, ${JSON.stringify(line.qtyDone ?? {})}::jsonb,
          ${JSON.stringify(line.batches ?? [])}::jsonb, ${line.fromLine ?? null}, ${line.batchId ?? null})`,
    );
}

export const link = (tx: Runner, from: number, to: number, amount: number | null, on: string | null) =>
  tx.execute(
    sql`insert into book_link (from_doc, to_doc, amount, on_date) values (${from}, ${to}, ${amount}, ${on}::date)
      on conflict (from_doc, to_doc) do update set amount = coalesce(book_link.amount, 0) + coalesce(excluded.amount, 0)`,
  );

export const day = (value: string | null | undefined, field: string, required = true) => {
  if (!value) {
    if (required) throw new Refusal(400, "invalid", "Pick the day.", field);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Refusal(400, "invalid", "Pick the day.", field);
  return value;
};

// ------------------------------------------------------------------ vendors

export type VendorInput = {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  website?: string | null;
  currency?: string | null;
  paymentTerms?: string | null;
  tin?: string | null;
  country?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
};

export async function saveVendor(db: Database, me: Me, id: number | null, input: VendorInput): Promise<{ id: number }> {
  allow(me, BILL_ROLES, "add or change a vendor");
  const name = input.name.trim();
  if (!name) throw new Refusal(400, "invalid", "Type the vendor's name.", "name");
  const [twin] = await rows<{ id: number }>(db, sql`select id::int as id from supplier where lower(name) = lower(${name}) and id <> ${id ?? 0}`);
  if (twin) throw new Refusal(409, "duplicate", "A vendor with this name is already on the list.", "name");
  const currency = (clean(input.currency) ?? "PHP").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Refusal(400, "invalid", "Pick the currency.", "currency");
  const values = sql`${name}, ${clean(input.company)}, ${clean(input.email)}, ${clean(input.phone)}, ${clean(input.mobile)}, ${clean(input.website)}, ${currency},
    ${clean(input.paymentTerms)}, ${clean(input.tin)}, ${clean(input.country)}, ${clean(input.billingAddress)}, ${clean(input.shippingAddress)}`;
  if (id) {
    const done = await rows<{ id: number }>(
      db,
      sql`update supplier set (name, company_name, email, phone, mobile, website, currency, payment_terms, tin, country, billing_address, shipping_address)
        = (${values}) where id = ${id} returning id::int as id`,
    );
    if (!done.length) throw new Refusal(404, "not_found", "That vendor is not on the list.");
    return { id };
  }
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into supplier (name, company_name, email, phone, mobile, website, currency, payment_terms, tin, country, billing_address, shipping_address)
      values (${values}) returning id::int as id`,
  );
  return { id: made?.id as number };
}

// ------------------------------------------------------------------ purchase orders

export type PurchaseOrderInput = {
  supplierId: number;
  reference?: string | null;
  date: string;
  deliveryDate?: string | null;
  paymentTerms?: string | null;
  warehouseId: number;
  fxRate?: number | null;
  notes?: string | null;
  terms?: string | null;
  issue: boolean;
  lines: LineInput[];
};

export async function createPurchaseOrder(db: Database, me: Me, input: PurchaseOrderInput): Promise<{ id: number }> {
  allow(me, PO_ROLES, "make a purchase order");
  return db.transaction(async (tx) => {
    const vendor = await vendorOf(tx, input.supplierId);
    const date = day(input.date, "date") as string;
    const deliveryDate = day(input.deliveryDate, "deliveryDate", false);
    if (deliveryDate && deliveryDate < date) throw new Refusal(400, "invalid", "The delivery date comes after the order date.", "deliveryDate");
    const [warehouse] = await rows<{ id: number; name: string }>(tx, sql`select id::int as id, name from warehouse where id = ${input.warehouseId} and active`);
    if (!warehouse) throw new Refusal(400, "invalid", "Pick the warehouse it is delivered to.", "warehouseId");
    const fxRate = vendor.currency === "PHP" ? 1 : (input.fxRate ?? 0);
    if (!(fxRate > 0)) throw new Refusal(400, "invalid", `Type how many pesos one ${vendor.currency} is.`, "fxRate");
    const lines = await linesOf(tx, input.lines);
    const subTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const total = subTotal + lines.reduce((sum, line) => sum + line.taxAmount, 0);
    const number = await nextNumber(tx, "purchase_order", "PO-", 5);
    const id = await insertDoc(tx, {
      kind: "purchase_order",
      number,
      reference: input.reference,
      date,
      dueDate: deliveryDate,
      status: input.issue ? "issued" : "draft",
      vendor,
      fxRate,
      subTotal,
      total,
      balance: 0,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      fields: { ...(clean(input.terms) ? { "Terms & Conditions": clean(input.terms) } : {}), "Warehouse Name": warehouse.name },
      warehouseId: warehouse.id,
      by: me.id,
    });
    await insertLines(tx, id, lines.map((line) => ({ ...line, warehouse: warehouse.name })));
    return { id };
  });
}

type OrderLine = { id: number; medicineId: number | null; itemName: string | null; sku: string | null; description: string | null; account: string | null; unit: string | null; qty: number; rate: number; taxPct: number | null; done: Record<string, number> };

async function orderOf(tx: Runner, id: number) {
  const [order] = await rows<{ id: number; number: string; status: string; supplierId: number; party: string; currency: string; fxRate: number; warehouseId: number | null; paymentTerms: string | null }>(
    tx,
    sql`select id::int as id, number, status, supplier_id::int as "supplierId", party_name as party, currency, fx_rate::float8 as "fxRate",
        warehouse_id::int as "warehouseId", payment_terms as "paymentTerms"
      from book_doc where id = ${id} and kind = 'purchase_order' for update`,
  );
  if (!order) throw new Refusal(404, "not_found", "That purchase order is not in the books.");
  const lines = await rows<OrderLine>(
    tx,
    sql`select id::int as id, medicine_id::int as "medicineId", item_name as "itemName", sku, description, account, unit, qty::float8 as qty,
        rate::float8 as rate, tax_pct::float8 as "taxPct", qty_done as done from book_line where doc_id = ${id} order by n`,
  );
  return { order, lines };
}
const left = (line: OrderLine, what: "received" | "billed") => line.qty - (line.done.cancelled ?? 0) - (line.done[what] ?? 0);

export async function setOrderStatus(db: Database, me: Me, id: number, to: "issued" | "cancelled" | "closed" | "reopen"): Promise<void> {
  allow(me, PO_ROLES, "change a purchase order");
  await db.transaction(async (tx) => {
    const { order, lines } = await orderOf(tx, id);
    // Close: the rest is not coming (a Zoho order never received in full, a vendor short); it
    // stops counting as stock coming. Reopen undoes it.
    if (to === "closed") {
      if (["draft", "cancelled", "closed", "void"].includes(order.status)) throw new Refusal(409, "not_open", `A ${order.status} order is not closed.`);
      await tx.execute(sql`update book_doc set status = 'closed', fields = fields || ${JSON.stringify({ "Closed by": me.name, "Closed on": todayManila() })}::jsonb where id = ${id}`);
      return;
    }
    if (to === "reopen") {
      if (order.status !== "closed") throw new Refusal(409, "not_closed", "Only a closed order is reopened.");
      const billed = lines.some((line) => (line.done.billed ?? 0) > 0);
      await tx.execute(sql`update book_doc set status = ${billed ? "partially_billed" : "issued"} where id = ${id}`);
      return;
    }
    if (to === "issued" && order.status !== "draft") throw new Refusal(409, "not_draft", "Only a draft is marked as issued.");
    if (to === "cancelled") {
      if (["cancelled", "closed"].includes(order.status)) throw new Refusal(409, "done", `This order is already ${order.status}.`);
      if (lines.some((line) => (line.done.received ?? 0) > 0 || (line.done.billed ?? 0) > 0))
        throw new Refusal(409, "in_use", "Goods were received or billed on this order: it can't be cancelled.");
    }
    await tx.execute(sql`update book_doc set status = ${to} where id = ${id}`);
  });
}

export type ReceiveInput = { date: string; notes?: string | null; warehouseId?: number | null; lines: { lineId: number; qty: number; batchNo?: string | null; expiresOn?: string | null }[] };

/** The goods arrive: a receive is made, each medicine goes on the shelf in its batch. */
export async function receiveOrder(db: Database, me: Me, id: number, input: ReceiveInput): Promise<{ id: number }> {
  allow(me, PO_ROLES, "receive goods");
  const today = todayManila();
  return db.transaction(async (tx) => {
    const { order, lines } = await orderOf(tx, id);
    if (["draft", "cancelled", "closed"].includes(order.status)) throw new Refusal(409, "not_open", `A ${order.status} order is not received.`);
    // An order that came from Zoho names its warehouse by Zoho's name: the one picked here (or the
    // warehouse of that name) is kept on it.
    if (!order.warehouseId) {
      const [named] = await rows<{ id: number }>(
        tx,
        sql`select w.id::int as id from warehouse w where w.active and (w.id = ${input.warehouseId ?? 0}
            or lower(w.name) = (select lower(l.warehouse) from book_line l where l.doc_id = ${id} and l.warehouse is not null limit 1))
          order by (w.id = ${input.warehouseId ?? 0}) desc limit 1`,
      );
      if (!named) throw new Refusal(400, "invalid", "Pick the warehouse the goods came into.", "warehouseId");
      order.warehouseId = named.id;
      await tx.execute(sql`update book_doc set warehouse_id = ${named.id} where id = ${id}`);
    }
    const warehouseId = order.warehouseId;
    const date = day(input.date, "date") as string;
    const came = input.lines.filter((line) => line.qty > 0);
    if (!came.length) throw new Refusal(400, "invalid", "Type how many came of at least one item.", "lines");
    const vendor = await vendorOf(tx, order.supplierId);
    const number = await nextNumber(tx, "purchase_receive", "PR-", 5);
    const made: Parameters<typeof insertLines>[2] = [];
    for (const entry of came) {
      const at = input.lines.indexOf(entry);
      const line = lines.find((row) => row.id === entry.lineId);
      if (!line) throw new Refusal(400, "invalid", "That line is not on this order.", `lines.${at}.lineId`);
      if (entry.qty > left(line, "received") + 1e-9)
        throw new Refusal(400, "invalid", `Only ${left(line, "received")} of ${line.itemName} are still to come.`, `lines.${at}.qty`);
      let batchId: number | null = null;
      const batchNo = (entry.batchNo ?? "").trim().toUpperCase();
      if (line.medicineId) {
        if (!Number.isInteger(entry.qty)) throw new Refusal(400, "invalid", "Medicines come in whole pieces.", `lines.${at}.qty`);
        if (!batchNo) throw new Refusal(400, "invalid", "Type the batch number on the box.", `lines.${at}.batchNo`);
        if (!entry.expiresOn) throw new Refusal(400, "invalid", "Pick the expiry date.", `lines.${at}.expiresOn`);
        if (entry.expiresOn < today) throw new Refusal(400, "invalid", "This batch has already expired. Expired stock isn't received.", `lines.${at}.expiresOn`);
        const unitCost = Math.round(line.rate * order.fxRate * 100);
        const [batch] = await rows<{ id: number; expiresOn: string; unitCost: number | null; onShelf: number }>(
          tx,
          sql`select b.id::int as id, to_char(b.expires_on, 'YYYY-MM-DD') as "expiresOn", b.unit_cost::int as "unitCost",
              coalesce((select sum(qty) from stock where batch_id = b.id), 0)::int as "onShelf"
            from batch b where b.medicine_id = ${line.medicineId} and b.batch_no = ${batchNo}`,
        );
        if (batch && batch.expiresOn !== entry.expiresOn)
          throw new Refusal(409, "batch_differs", `Batch ${batchNo} is already on file with expiry ${batch.expiresOn}. Check the box.`, `lines.${at}.expiresOn`);
        if (batch) {
          batchId = batch.id;
          // More of a batch on the shelf: its cost becomes the average of what was there and what came.
          const cost = batch.unitCost === null || batch.onShelf <= 0 ? unitCost : Math.round((batch.onShelf * batch.unitCost + entry.qty * unitCost) / (batch.onShelf + entry.qty));
          await tx.execute(sql`update batch set unit_cost = ${cost} where id = ${batch.id}`);
        } else {
          const [fresh] = await rows<{ id: number }>(
            tx,
            sql`insert into batch (medicine_id, batch_no, expires_on, unit_cost) values (${line.medicineId}, ${batchNo}, ${entry.expiresOn}::date, ${unitCost}) returning id::int as id`,
          );
          batchId = fresh?.id as number;
        }
        await putIn(tx, batchId, warehouseId, entry.qty);
        await logMove(tx, { medicineId: line.medicineId, batchId, warehouseId, qty: entry.qty, kind: "receive", ref: `${number} · ${order.number}`, by: me.id });
      }
      const [warehouse] = await rows<{ name: string }>(tx, sql`select name from warehouse where id = ${warehouseId}`);
      const done = { ...line.done, received: (line.done.received ?? 0) + entry.qty };
      await tx.execute(sql`update book_line set qty_done = ${JSON.stringify(done)}::jsonb where id = ${line.id}`);
      made.push({
        medicineId: line.medicineId,
        itemName: line.itemName ?? "",
        sku: line.sku,
        description: line.description,
        account: null,
        unit: line.unit,
        qty: entry.qty,
        rate: line.rate,
        taxPct: null,
        taxAmount: 0,
        amount: 0,
        fromLine: line.id,
        batchId,
        warehouse: warehouse?.name ?? null,
        batches: batchNo ? [{ "Batch Reference#": batchNo, "Expiry Date": entry.expiresOn, "Quantity In": entry.qty }] : [],
      });
    }
    const receiveId = await insertDoc(tx, {
      kind: "purchase_receive",
      number,
      reference: order.number,
      date,
      status: "received",
      vendor,
      total: 0,
      balance: 0,
      notes: input.notes,
      warehouseId,
      by: me.id,
    });
    await insertLines(tx, receiveId, made);
    await link(tx, receiveId, id, null, date);
    // Freight, customs… entered before these goods came: their share for them goes on now.
    await landWaiting(
      tx,
      id,
      order.number,
      order.fxRate,
      made.filter((line) => line.batchId).map((line) => ({ batchId: line.batchId as number, qty: line.qty, rate: line.rate })),
    );
    return { id: receiveId };
  });
}

export type BillInput = {
  supplierId?: number;
  number: string;
  reference?: string | null;
  date: string;
  dueDate?: string | null;
  paymentTerms?: string | null;
  fxRate?: number | null;
  notes?: string | null;
  /** From a purchase order: its lines and how many of each are billed (at what rate). */
  orderLines?: { lineId: number; qty: number; rate: number }[];
  receiveId?: number | null;
  /** A bill on its own (rent, a utility, freight): its lines. */
  lines?: LineInput[];
  /** Landed cost: this bill (freight, customs, insurance…) is part of what the goods on this
   *  purchase order cost. */
  landedOn?: number | null;
};

async function billNumberFree(tx: Runner, supplierId: number, number: string) {
  const [twin] = await rows<{ id: number }>(tx, sql`select id::int as id from book_doc where kind = 'bill' and supplier_id = ${supplierId} and lower(number) = lower(${number}) and status <> 'void'`);
  if (twin) throw new Refusal(409, "duplicate", "This vendor already has a bill with this number.", "number");
}

/** Convert to Bill: a bill for what the order still has to be billed for. */
export async function billOrder(db: Database, me: Me, id: number, input: BillInput): Promise<{ id: number }> {
  allow(me, BILL_ROLES, "make a bill");
  return db.transaction(async (tx) => {
    const { order, lines } = await orderOf(tx, id);
    if (["draft", "cancelled"].includes(order.status)) throw new Refusal(409, "not_open", `A ${order.status} order is not billed.`);
    const number = clean(input.number);
    if (!number) throw new Refusal(400, "invalid", "Type the vendor's bill number.", "number");
    await billNumberFree(tx, order.supplierId, number);
    const date = day(input.date, "date") as string;
    const dueDate = day(input.dueDate, "dueDate", false) ?? date;
    if (dueDate < date) throw new Refusal(400, "invalid", "The due date comes after the bill date.", "dueDate");
    const vendor = await vendorOf(tx, order.supplierId);
    const billed = (input.orderLines ?? []).filter((line) => line.qty > 0);
    if (!billed.length) throw new Refusal(400, "invalid", "Bill at least one item.", "orderLines");
    const made: Parameters<typeof insertLines>[2] = [];
    for (const entry of billed) {
      const at = (input.orderLines ?? []).indexOf(entry);
      const line = lines.find((row) => row.id === entry.lineId);
      if (!line) throw new Refusal(400, "invalid", "That line is not on this order.", `orderLines.${at}.lineId`);
      if (entry.qty > left(line, "billed") + 1e-9)
        throw new Refusal(400, "invalid", `Only ${left(line, "billed")} of ${line.itemName} are still to be billed.`, `orderLines.${at}.qty`);
      if (!(entry.rate >= 0)) throw new Refusal(400, "invalid", "Type the rate.", `orderLines.${at}.rate`);
      const amount = centsOf(entry.qty * entry.rate);
      const taxAmount = line.taxPct ? Math.round((amount * line.taxPct) / 100) : 0;
      const done = { ...line.done, billed: (line.done.billed ?? 0) + entry.qty };
      line.done = done;
      await tx.execute(sql`update book_line set qty_done = ${JSON.stringify(done)}::jsonb where id = ${line.id}`);
      made.push({
        medicineId: line.medicineId,
        itemName: line.itemName ?? "",
        sku: line.sku,
        description: line.description,
        account: line.account,
        unit: line.unit,
        qty: entry.qty,
        rate: entry.rate,
        taxPct: line.taxPct,
        taxAmount,
        amount,
        fromLine: line.id,
      });
    }
    const subTotal = made.reduce((sum, line) => sum + line.amount, 0);
    const total = subTotal + made.reduce((sum, line) => sum + line.taxAmount, 0);
    const billId = await insertDoc(tx, {
      kind: "bill",
      number,
      reference: input.reference ?? order.number,
      date,
      dueDate,
      status: "open",
      vendor,
      fxRate: order.fxRate,
      subTotal,
      total,
      balance: total,
      paymentTerms: input.paymentTerms ?? order.paymentTerms,
      notes: input.notes,
      by: me.id,
    });
    await insertLines(tx, billId, made);
    await link(tx, billId, id, null, date);
    if (input.receiveId) {
      const [receive] = await rows<{ id: number }>(tx, sql`select k.from_doc::int as id from book_link k join book_doc r on r.id = k.from_doc and r.kind = 'purchase_receive' where k.to_doc = ${id} and k.from_doc = ${input.receiveId}`);
      if (receive) await link(tx, billId, receive.id, null, date);
    }
    const allBilled = lines.every((line) => left(line, "billed") <= 1e-9);
    await tx.execute(sql`update book_doc set status = ${allBilled ? "billed" : "partially_billed"} where id = ${id}`);
    return { id: billId };
  });
}

/** A bill on its own: rent, a utility, freight, anything not on a purchase order. */
export async function createBill(db: Database, me: Me, input: BillInput): Promise<{ id: number }> {
  allow(me, BILL_ROLES, "make a bill");
  return db.transaction(async (tx) => {
    if (!input.supplierId) throw new Refusal(400, "invalid", "Pick the vendor.", "supplierId");
    const vendor = await vendorOf(tx, input.supplierId);
    const number = clean(input.number);
    if (!number) throw new Refusal(400, "invalid", "Type the vendor's bill number.", "number");
    await billNumberFree(tx, vendor.id, number);
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "bill", date);
    const dueDate = day(input.dueDate, "dueDate", false) ?? date;
    if (dueDate < date) throw new Refusal(400, "invalid", "The due date comes after the bill date.", "dueDate");
    const fxRate = vendor.currency === "PHP" ? 1 : (input.fxRate ?? 0);
    if (!(fxRate > 0)) throw new Refusal(400, "invalid", `Type how many pesos one ${vendor.currency} is.`, "fxRate");
    const typed = await linesOf(tx, input.lines ?? []);
    const subTotal = typed.reduce((sum, line) => sum + line.amount, 0);
    const total = subTotal + typed.reduce((sum, line) => sum + line.taxAmount, 0);
    // Landed cost: the bill sits in the stock's value (Inventory Asset) and each piece of that
    // order's goods still on the shelf costs more, so the sale takes it to Cost of Goods Sold.
    const landed = input.landedOn ? await landOn(tx, input.landedOn, Math.round(subTotal * fxRate)) : null;
    const lines = landed ? typed.map((line) => ({ ...line, medicineId: null, account: "Inventory Asset" })) : typed;
    const id = await insertDoc(tx, {
      kind: "bill",
      number,
      reference: input.reference ?? landed?.order,
      date,
      dueDate,
      status: "open",
      vendor,
      fxRate,
      subTotal,
      total,
      balance: total,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      fields: landed ? { "Landed cost on": landed.order, _landed: landed.batches, _extras: landed.extras, _pending: landed.pending } : undefined,
      by: me.id,
    });
    await insertLines(tx, id, lines);
    return { id };
  });
}

/** What an order's medicines are worth at its own rates, in pesos' centavos (all ordered, less
 *  what was cancelled): the whole a landed cost is shared over. */
async function orderWorth(tx: Runner, orderId: number, fxRate: number): Promise<number> {
  const [worth] = await rows<{ value: number }>(
    tx,
    sql`select coalesce(sum((coalesce(qty, 0) - coalesce((qty_done->>'cancelled')::numeric, 0)) * coalesce(rate, 0)), 0)::float8 as value
      from book_line where doc_id = ${orderId} and medicine_id is not null`,
  );
  return Math.round((worth?.value ?? 0) * fxRate * 100);
}

type Came = { batchId: number; qty: number; rate: number; onShelf: number };
/** Puts an amount (pesos' centavos) on batches that came in, shared by their value and spread over
 *  each batch's pieces still on the shelf, so all of it reaches Cost of Goods Sold as they sell. */
async function putOnBatches(tx: Runner, came: Came[], fxRate: number, amount: number) {
  const shares = landedCosts(came.map((one) => ({ qty: one.qty, unitCost: one.rate })), fxRate, amount);
  const batches: { batchId: number; add: number }[] = [];
  for (const [at, one] of came.entries()) {
    const share = shares[at]?.extras ?? 0;
    if (share <= 0 || one.onShelf <= 0) continue;
    const add = Math.round(share / one.onShelf);
    if (add <= 0) continue;
    await tx.execute(sql`update batch set unit_cost = coalesce(unit_cost, 0) + ${add} where id = ${one.batchId}`);
    batches.push({ batchId: one.batchId, add });
  }
  return batches;
}

/** A landed-cost bill (freight, customs, airfare, travel for these goods, any extra; in pesos'
 *  centavos before tax) on a purchase order. It is shared over the order's goods by value: the part
 *  for what already came goes on those batches now; the part for what is still to come waits and
 *  goes on each delivery as it is received (all of it once the order is received in full or
 *  closed). What it added to each batch is kept, so a void takes it back. */
async function landOn(tx: Runner, orderId: number, extras: number) {
  const [order] = await rows<{ number: string; fxRate: number; status: string }>(
    tx,
    sql`select number, fx_rate::float8 as "fxRate", status from book_doc where id = ${orderId} and kind = 'purchase_order'`,
  );
  if (!order || ["draft", "cancelled", "void"].includes(order.status))
    throw new Refusal(400, "invalid", "Pick a purchase order that was sent to the vendor.", "landedOn");
  const came = await rows<Came>(
    tx,
    sql`select l.batch_id::int as "batchId", sum(l.qty)::float8 as qty, max(l.rate)::float8 as rate,
        coalesce((select sum(s.qty) from stock s where s.batch_id = l.batch_id), 0)::int as "onShelf"
      from book_link k join book_doc r on r.id = k.from_doc and r.kind = 'purchase_receive' and r.status <> 'void'
        join book_line l on l.doc_id = r.id and l.batch_id is not null
      where k.to_doc = ${orderId} group by l.batch_id order by l.batch_id`,
  );
  const worth = await orderWorth(tx, orderId, order.fxRate);
  const cameWorth = came.reduce((sum, one) => sum + Math.round(one.qty * one.rate * order.fxRate * 100), 0);
  const [left] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from book_line where doc_id = ${orderId} and medicine_id is not null
      and coalesce(qty, 0) - coalesce((qty_done->>'cancelled')::numeric, 0) - coalesce((qty_done->>'received')::numeric, 0) > 0`,
  );
  // All of it now when nothing more is coming; else the part for what came.
  const done = order.status === "closed" || (came.length > 0 && !left?.n);
  const now = !came.length ? 0 : done || worth <= 0 ? extras : Math.min(extras, Math.round((extras * cameWorth) / worth));
  if (now > 0 && came.every((one) => one.onShelf <= 0))
    throw new Refusal(
      409,
      "sold",
      `All the goods of ${order.number} that came are sold: record this bill on Cost of Goods Sold instead (no landed cost).`,
      "landedOn",
    );
  const batches = now > 0 ? await putOnBatches(tx, came, order.fxRate, now) : [];
  return { order: order.number, batches, extras, pending: extras - now };
}

/** Goods of an order just received: the landed costs waiting on that order put their share for
 *  these goods on them (all that waits, once nothing more is coming). */
async function landWaiting(tx: Runner, orderId: number, orderNumber: string, fxRate: number, came: { batchId: number; qty: number; rate: number }[]) {
  const waiting = await rows<{ id: number; extras: number; pending: number; landed: { batchId: number; add: number }[] | null }>(
    tx,
    sql`select id::int as id, coalesce((fields->>'_extras')::bigint, 0)::float8 as extras, (fields->>'_pending')::bigint::float8 as pending, fields->'_landed' as landed
      from book_doc where kind = 'bill' and status <> 'void' and fields->>'Landed cost on' = ${orderNumber}
        and coalesce((fields->>'_pending')::bigint, 0) > 0 for update`,
  );
  if (!waiting.length || !came.length) return;
  const worth = await orderWorth(tx, orderId, fxRate);
  const cameWorth = came.reduce((sum, one) => sum + Math.round(one.qty * one.rate * fxRate * 100), 0);
  const [left] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from book_line where doc_id = ${orderId} and medicine_id is not null
      and coalesce(qty, 0) - coalesce((qty_done->>'cancelled')::numeric, 0) - coalesce((qty_done->>'received')::numeric, 0) > 0`,
  );
  const shelf = await rows<{ batchId: number; onShelf: number }>(
    tx,
    sql`select b.id::int as "batchId", coalesce((select sum(s.qty) from stock s where s.batch_id = b.id), 0)::int as "onShelf"
      from batch b where b.id in (${sql.join(came.map((one) => sql`${one.batchId}`), sql`, `)})`,
  );
  const withShelf = came.map((one) => ({ ...one, onShelf: shelf.find((row) => row.batchId === one.batchId)?.onShelf ?? 0 }));
  for (const bill of waiting) {
    const share = !left?.n || worth <= 0 ? bill.pending : Math.min(bill.pending, Math.round((bill.extras * cameWorth) / worth));
    if (share <= 0) continue;
    const batches = await putOnBatches(tx, withShelf, fxRate, share);
    await tx.execute(
      sql`update book_doc set fields = fields || jsonb_build_object('_landed', ${JSON.stringify([...(bill.landed ?? []), ...batches])}::jsonb, '_pending', ${bill.pending - share}::bigint)
        where id = ${bill.id}`,
    );
  }
}

// ------------------------------------------------------------------ money on bills

type OpenBill = { id: number; number: string; balance: number; total: number; status: string };
/** The bills (a vendor's) or invoices (a customer's, from Zoho) money is put on, checked. */
async function billsFor(tx: Runner, partyId: number, applied: { billId: number; amount: number }[], kind: "bill" | "invoice" = "bill"): Promise<OpenBill[]> {
  const out: OpenBill[] = [];
  const word = kind === "bill" ? "bill" : "invoice";
  for (const [at, entry] of applied.entries()) {
    const [bill] = await rows<OpenBill>(
      tx,
      sql`select id::int as id, number, balance::bigint::float8 as balance, total::bigint::float8 as total, status from book_doc
        where id = ${entry.billId} and kind = ${kind} and ${kind === "bill" ? sql`supplier_id` : sql`customer_id`} = ${partyId} for update`,
    );
    if (!bill || ["void", "draft"].includes(bill.status)) throw new Refusal(400, "invalid", `That ${word} is not this ${kind === "bill" ? "vendor" : "customer"}'s open ${word}.`, `bills.${at}.billId`);
    if (entry.amount <= 0 || entry.amount > bill.balance) throw new Refusal(400, "invalid", `Put at most ${(bill.balance / 100).toFixed(2)} on ${word} ${bill.number}.`, `bills.${at}.amount`);
    out.push(bill);
  }
  return out;
}
const settle = (tx: Runner, bill: OpenBill, amount: number) =>
  tx.execute(sql`update book_doc set balance = ${bill.balance - amount}, status = ${bill.balance - amount <= 0 ? "paid" : "partially_paid"} where id = ${bill.id}`);

export type PaymentInput = { supplierId: number; date: string; amount: number; mode?: string | null; paidThrough?: string | null; reference?: string | null; notes?: string | null; bills: { billId: number; amount: number }[] };

/** Money paid to a vendor (centavos), put on bills; what is not put on a bill stays unused. */
export async function payVendor(db: Database, me: Me, input: PaymentInput): Promise<{ id: number }> {
  allow(me, PAY_ROLES, "record a payment");
  return db.transaction(async (tx) => {
    const vendor = await vendorOf(tx, input.supplierId);
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "vendor_payment", date);
    if (!(input.amount > 0)) throw new Refusal(400, "invalid", "Type the amount paid.", "amount");
    const applied = input.bills.filter((entry) => entry.amount > 0);
    const bills = await billsFor(tx, vendor.id, applied);
    const used = applied.reduce((sum, entry) => sum + entry.amount, 0);
    if (used > input.amount) throw new Refusal(400, "invalid", "More is put on the bills than was paid.", "amount");
    const number = await nextNumber(tx, "vendor_payment", "", 0);
    const id = await insertDoc(tx, {
      kind: "vendor_payment",
      number,
      reference: input.reference,
      date,
      status: "paid",
      vendor,
      total: input.amount,
      balance: input.amount - used,
      notes: input.notes,
      fields: { ...(clean(input.mode) ? { Mode: clean(input.mode) } : {}), ...(clean(input.paidThrough) ? { "Paid Through": clean(input.paidThrough) } : {}) },
      by: me.id,
    });
    for (const [at, bill] of bills.entries()) {
      const amount = applied[at]?.amount as number;
      await settle(tx, bill, amount);
      await link(tx, id, bill.id, amount, date);
    }
    return { id };
  });
}

export type CreditInput = { supplierId: number; date: string; reference?: string | null; notes?: string | null; fxRate?: number | null; lines: LineInput[] };

export async function createVendorCredit(db: Database, me: Me, input: CreditInput): Promise<{ id: number }> {
  allow(me, PAY_ROLES, "record a vendor credit");
  return db.transaction(async (tx) => {
    const vendor = await vendorOf(tx, input.supplierId);
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "vendor_credit", date);
    const fxRate = vendor.currency === "PHP" ? 1 : (input.fxRate ?? 0);
    if (!(fxRate > 0)) throw new Refusal(400, "invalid", `Type how many pesos one ${vendor.currency} is.`, "fxRate");
    const lines = await linesOf(tx, input.lines);
    const subTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const total = subTotal + lines.reduce((sum, line) => sum + line.taxAmount, 0);
    const number = await nextNumber(tx, "vendor_credit", "DN-", 5);
    const id = await insertDoc(tx, { kind: "vendor_credit", number, reference: input.reference, date, status: "open", vendor, fxRate, subTotal, total, balance: total, notes: input.notes, by: me.id });
    await insertLines(tx, id, lines);
    return { id };
  });
}

/** Puts a vendor's unused credit (a vendor credit, or a payment's unused amount) on their bills. */
export async function applyCredit(db: Database, me: Me, id: number, input: { date: string; bills: { billId: number; amount: number }[] }): Promise<void> {
  allow(me, PAY_ROLES, "put credits on bills");
  await db.transaction(async (tx) => {
    const [credit] = await rows<{ id: number; kind: string; partyId: number; balance: number; status: string }>(
      tx,
      sql`select id::int as id, kind, coalesce(supplier_id, customer_id)::int as "partyId", balance::bigint::float8 as balance, status from book_doc
        where id = ${id} and kind in ('vendor_credit', 'vendor_payment', 'credit_note', 'customer_payment') for update`,
    );
    if (!credit || credit.status === "void") throw new Refusal(404, "not_found", "That credit is not in the books.");
    const date = day(input.date, "date") as string;
    await assertOpen(tx, credit.kind, date);
    const applied = input.bills.filter((entry) => entry.amount > 0);
    const sales = credit.kind === "credit_note" || credit.kind === "customer_payment";
    const bills = await billsFor(tx, credit.partyId, applied, sales ? "invoice" : "bill");
    const used = applied.reduce((sum, entry) => sum + entry.amount, 0);
    if (!used) throw new Refusal(400, "invalid", "Put an amount on at least one bill.", "bills");
    if (used > credit.balance) throw new Refusal(400, "invalid", "More is put on the bills than the credit has left.", "bills");
    for (const [at, bill] of bills.entries()) {
      const amount = applied[at]?.amount as number;
      await settle(tx, bill, amount);
      await link(tx, credit.id, bill.id, amount, date);
    }
    const balance = credit.balance - used;
    await tx.execute(
      sql`update book_doc set balance = ${balance}, status = ${credit.kind === "vendor_credit" || credit.kind === "credit_note" ? (balance <= 0 ? "closed" : "open") : "paid"} where id = ${credit.id}`,
    );
  });
}

/** Voids a bill nothing was paid on, or a payment or vendor credit (its money goes back onto the
 *  bills it was put on). The document stays, marked void, with who and why. */
export async function voidDoc(db: Database, me: Me, id: number, reason: string): Promise<void> {
  const why = reason.trim();
  if (!why) throw new Refusal(400, "invalid", "Say why it is voided.", "reason");
  await db.transaction(async (tx) => {
    const [doc] = await rows<{ kind: string; status: string; total: number; balance: number; date: string }>(
      tx,
      sql`select kind, status, total::bigint::float8 as total, balance::bigint::float8 as balance, to_char(doc_date, 'YYYY-MM-DD') as date from book_doc where id = ${id} for update`,
    );
    const ledgerKinds = ["expense", "journal", "transfer_fund", "deposit", "refund"];
    if (!doc || ![...["bill", "vendor_payment", "vendor_credit", "customer_payment", "credit_note"], ...ledgerKinds].includes(doc.kind))
      throw new Refusal(404, "not_found", "That document is not voided here.");
    allow(me, doc.kind === "bill" ? BILL_ROLES : ledgerKinds.includes(doc.kind) || doc.kind === "credit_note" ? LEDGER_ROLES : PAY_ROLES, "void it");
    if (doc.status === "void") throw new Refusal(409, "void", "It is already void.");
    await assertOpen(tx, doc.kind, doc.date);
    await guardReconciled(tx, id);
    if (["credit_note", "customer_payment"].includes(doc.kind)) {
      const [used] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from payment where active and credit_doc_id = ${id}`);
      if (used?.n) throw new Refusal(409, "used", "Some of it was used on a CRM invoice: take that payment off first.");
      const [refunded] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from book_link k join book_doc r on r.id = k.from_doc and r.kind = 'refund' and r.status <> 'void' where k.to_doc = ${id}`);
      if (refunded?.n) throw new Refusal(409, "refunded", "Money was refunded from it: void the refund first.");
    }
    if (doc.kind === "refund") {
      // The credit it was refunded from has the money again.
      for (const back of await rows<{ creditId: number; amount: number; kind: string }>(
        tx,
        sql`select k.to_doc::int as "creditId", coalesce(k.amount, 0)::float8 as amount, c.kind from book_link k join book_doc c on c.id = k.to_doc where k.from_doc = ${id}`,
      ))
        await tx.execute(
          sql`update book_doc set balance = least(total, balance + ${back.amount}), status = case when ${back.kind} = 'credit_note' then 'open' else status end where id = ${back.creditId}`,
        );
    } else if (doc.kind === "journal") {
      // Its reversal goes with it.
      await tx.execute(sql`update book_doc set status = 'void', voided_by = ${me.id}, voided_at = now(), void_reason = ${`With journal it reverses: ${why}`} where reversal_of = ${id} and status <> 'void'`);
    } else if (ledgerKinds.includes(doc.kind)) {
      // Nothing else hangs on an expense, transfer or deposit.
    } else if (doc.kind === "bill") {
      if (doc.balance !== doc.total) throw new Refusal(409, "paid", "Money was put on this bill: void its payments or credits first.");
      // A landed-cost bill: what it added to each batch's cost comes off again.
      const [landed] = await rows<{ batches: { batchId: number; add: number }[] | null }>(tx, sql`select fields->'_landed' as batches from book_doc where id = ${id}`);
      for (const one of landed?.batches ?? [])
        await tx.execute(sql`update batch set unit_cost = greatest(0, unit_cost - ${one.add}) where id = ${one.batchId}`);
      // Its order's lines are billed less again.
      const lines = await rows<{ fromLine: number; qty: number }>(tx, sql`select from_line::int as "fromLine", qty::float8 as qty from book_line where doc_id = ${id} and from_line is not null`);
      for (const line of lines)
        await tx.execute(
          sql`update book_line set qty_done = jsonb_set(qty_done, '{billed}', to_jsonb(greatest(0, coalesce((qty_done->>'billed')::numeric, 0) - ${line.qty}))) where id = ${line.fromLine}`,
        );
      for (const order of await rows<{ id: number }>(tx, sql`select k.to_doc::int as id from book_link k join book_doc o on o.id = k.to_doc and o.kind = 'purchase_order' where k.from_doc = ${id}`)) {
        const [left] = await rows<{ billed: number }>(tx, sql`select coalesce(sum((qty_done->>'billed')::numeric), 0)::float8 as billed from book_line where doc_id = ${order.id}`);
        await tx.execute(sql`update book_doc set status = ${(left?.billed ?? 0) > 0 ? "partially_billed" : "issued"} where id = ${order.id}`);
      }
    } else {
      // The money it put on bills goes back onto them.
      const on = await rows<{ billId: number; amount: number }>(
        tx,
        sql`select k.to_doc::int as "billId", coalesce(k.amount, 0)::float8 as amount from book_link k join book_doc b on b.id = k.to_doc and b.kind in ('bill', 'invoice') where k.from_doc = ${id}`,
      );
      for (const entry of on)
        await tx.execute(
          sql`update book_doc set balance = least(total, balance + ${entry.amount}), status = case when least(total, balance + ${entry.amount}) >= total then 'open' else 'partially_paid' end
            where id = ${entry.billId} and status <> 'void'`,
        );
    }
    await tx.execute(sql`update book_doc set status = 'void', balance = 0, voided_by = ${me.id}, voided_at = now(), void_reason = ${why} where id = ${id}`);
    await freeStatementLine(tx, id);
    // A Zoho document's debits and credits were written down when it came in: they no longer count.
    await tx.execute(sql`delete from book_ledger where doc_id = ${id}`);
  });
}

export type ReceiptInput = { customerId: number; date: string; amount: number; mode?: string | null; depositTo?: string | null; reference?: string | null; notes?: string | null; invoices: { billId: number; amount: number }[] };

/** Money received from a customer (centavos) on their invoices that came from Zoho; what is not
 *  put on an invoice stays as the payment's unused amount. The CRM's own invoices take payments
 *  on the order line, as before. */
export async function receivePayment(db: Database, me: Me, input: ReceiptInput): Promise<{ id: number }> {
  allow(me, PAY_ROLES, "record a payment");
  return db.transaction(async (tx) => {
    const [customer] = await rows<{ id: number; name: string }>(tx, sql`select id::int as id, name from customer where id = ${input.customerId}`);
    if (!customer) throw new Refusal(400, "invalid", "Pick the customer.", "customerId");
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "customer_payment", date);
    if (!(input.amount > 0)) throw new Refusal(400, "invalid", "Type the amount received.", "amount");
    const applied = input.invoices.filter((entry) => entry.amount > 0);
    const invoices = await billsFor(tx, customer.id, applied, "invoice");
    const used = applied.reduce((sum, entry) => sum + entry.amount, 0);
    if (used > input.amount) throw new Refusal(400, "invalid", "More is put on the invoices than was received.", "amount");
    const number = await nextNumber(tx, "customer_payment", "", 0);
    const fields = { ...(clean(input.mode) ? { Mode: clean(input.mode) } : {}), ...(clean(input.depositTo) ? { "Deposit To": clean(input.depositTo) } : {}) };
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into book_doc (kind, number, reference, doc_date, status, customer_id, party_name, total, balance, notes, fields, created_by)
        values ('customer_payment', ${number}, ${clean(input.reference)}, ${date}::date, 'paid', ${customer.id}, ${customer.name}, ${input.amount}, ${input.amount - used},
          ${clean(input.notes)}, ${JSON.stringify(fields)}::jsonb, ${me.id})
        returning id::int as id`,
    );
    const id = made?.id as number;
    for (const [at, invoice] of invoices.entries()) {
      const amount = applied[at]?.amount as number;
      await settle(tx, invoice, amount);
      await link(tx, id, invoice.id, amount, date);
    }
    return { id };
  });
}
