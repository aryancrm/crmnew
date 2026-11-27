// Clears the test and demo data from the live CRM before the teams use it (27 Nov 2026, Aryan: "please
// do not remove lead and enquiry data, every other data can be deleted"). The Online desk's leads,
// enquiries, their conversations and the orders made from them stay as they are; so do the people and
// their accounts, the medicines, prices and stock, the targets, and the history brought from Zoho.
//
// What goes, closed the way each desk closes it (cancelled, voided, archived), with the reason:
// - Every order not made from a lead (the 20 Nov walkthrough's, placed through the app as the real
//   people, and any tried since): payments taken off, invoices and orders cancelled. A shipped or
//   delivered one gives its pieces back to the shelf they came from (a "return" move, so each shelf
//   still equals its log); an open one goes through the desk's own Cancel.
// - The Books documents made in the CRM (not Zoho's): voided.
// - The walkthrough's customers ("Demo · 20 Nov walkthrough") not tied to a lead: archived, with the
//   calls logged on them; its tenders ("Demo · …") dropped; its care groups closed.
// - The walkthrough's attendance rows: removed.
// Then the data checks.
//
// Check first (the default): it counts and says what it would do; nothing is written. --apply writes.
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/clear-test-data.ts [--apply]
//   Live (the API's terminal, after a database backup; Aryan's word given 27 Nov):
//     node --import tsx scripts/clear-test-data.ts --live [--apply]

import { sql } from "drizzle-orm";
import { voidDoc } from "../src/books/actions";
import { runChecks } from "../src/checks/integrity";
import { type Database, openDatabase, rows } from "../src/db/index";
import { cancelInvoiceOf } from "../src/finance/service";
import { logEvent, peso } from "../src/orders/events";
import { actOnOrder } from "../src/orders/service";
import type { Me } from "../src/types";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
if (live && !process.env.DATABASE_URL) throw new Error("--live needs DATABASE_URL (the API's, in Coolify).");
if (!live && !process.env.TEST_PGLITE_DIR) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live.");
const db: Database = live ? openDatabase({ url: process.env.DATABASE_URL as string }) : openDatabase({ dir: process.env.TEST_PGLITE_DIR as string });
const WHY = "Test data, cleared before going live (Aryan, 27 Nov)";
const MARK = "Demo · 20 Nov walkthrough";
console.log(`${live ? "LIVE" : process.env.TEST_PGLITE_DIR} · ${apply ? "APPLYING" : "checking only (nothing is written)"}`);

const [adminRow] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where role = 'admin' and active order by id limit 1`);
if (!adminRow) throw new Error("No admin in this CRM.");
const admin = { id: adminRow.id, name: adminRow.name, role: "admin", roleLabel: "Admin", area: null, channel: null } as unknown as Me;
const count = async (query: ReturnType<typeof sql>) => (await rows<{ n: number }>(db, query))[0]?.n ?? 0;
const checks = async (when: string) => {
  const result = await runChecks(db);
  const bad = result.checks.filter((one) => !one.ok);
  console.log(`  data checks ${when}: ${bad.length ? `${bad.length} of ${result.checks.length} with problems` : `all ${result.checks.length} fine`}`);
  for (const one of bad) console.log(`      ${one.label}: ${one.count}${one.problems[0] ? ` (e.g. ${one.problems[0]})` : ""}`);
};

console.log("\nKept:");
console.log(`  leads and enquiries: ${await count(sql`select count(*)::int as n from lead`)}`);
console.log(`  orders made from a lead: ${await count(sql`select count(*)::int as n from sales_order where lead_id is not null`)}`);
console.log(`  people: ${await count(sql`select count(*)::int as n from person where active`)} · medicines: ${await count(sql`select count(*)::int as n from medicine where active`)} · pieces on the shelves: ${await count(sql`select coalesce(sum(qty), 0)::int as n from stock`)}`);
console.log(`  the history from Zoho: ${await count(sql`select count(*)::int as n from past_order`)} old orders`);
await checks("before");

// ---- 1. Orders not made from a lead ----
const orders = await rows<{ id: number; code: string; status: string; points: number; customer: string; medrep: string }>(
  db,
  sql`select o.id::int as id, o.code, o.status, c.name as customer, m.name as medrep,
        (select count(*) from payment p join invoice i on i.id = p.invoice_id where i.order_id = o.id and p.active and p.method = 'points')::int as points
      from sales_order o join customer c on c.id = o.customer_id join person m on m.id = o.medrep_id
      where o.lead_id is null and o.status not in ('cancelled', 'draft') order by o.id`,
);
console.log(`\nOrders not made from a lead: ${orders.length}`);
const bySeller = new Map<string, number>();
for (const one of orders) bySeller.set(one.medrep, (bySeller.get(one.medrep) ?? 0) + 1);
console.log(`  by seller: ${[...bySeller].map(([name, n]) => `${name} ${n}`).join(", ")}`);
let cancelledOpen = 0;
let cancelledGone = 0;
let paymentsOff = 0;
let piecesBack = 0;
for (const order of orders) {
  const gone = ["shipped", "completed"].includes(order.status);
  const payments = await rows<{ id: number; amount: number; invoiceId: number }>(
    db,
    sql`select p.id::int as id, p.amount::int as amount, p.invoice_id::int as "invoiceId"
        from payment p join invoice i on i.id = p.invoice_id where i.order_id = ${order.id} and p.active and p.method <> 'points'`,
  );
  const picks = gone
    ? await rows<{ id: number; batchId: number; warehouseId: number; medicineId: number; qty: number }>(
        db,
        sql`select k.id::int as id, k.batch_id::int as "batchId", k.warehouse_id::int as "warehouseId", b.medicine_id::int as "medicineId", k.qty
          from order_pick k join batch b on b.id = k.batch_id where k.order_id = ${order.id} and k.active and k.returned_at is null`,
      )
    : [];
  paymentsOff += payments.length;
  piecesBack += picks.reduce((sum, one) => sum + one.qty, 0);
  if (gone) cancelledGone += 1;
  else cancelledOpen += 1;
  if (!apply) continue;
  await db.transaction(async (tx) => {
    for (const payment of payments) {
      await tx.execute(sql`update payment set active = false, removed_reason = ${WHY}, removed_by = ${admin.id}, removed_at = now() where id = ${payment.id}`);
      await tx.execute(
        sql`update invoice set paid = paid - ${payment.amount}, status = case when status = 'cancelled' then status else 'open' end where id = ${payment.invoiceId}`,
      );
      await logEvent(tx, order.id, admin, "payment", `Payment of ${peso(payment.amount)} taken off: ${WHY}.`);
    }
    if (!gone) return;
    // Shipped or delivered, which Cancel doesn't take: the pieces back on their shelf, then its
    // invoice and the order cancelled.
    for (const pick of picks) {
      await tx.execute(
        sql`insert into stock (batch_id, warehouse_id, qty) values (${pick.batchId}, ${pick.warehouseId}, ${pick.qty})
          on conflict (batch_id, warehouse_id) do update set qty = stock.qty + excluded.qty`,
      );
      await tx.execute(
        sql`insert into stock_move (medicine_id, batch_id, warehouse_id, qty, kind, ref, note, by_person)
          values (${pick.medicineId}, ${pick.batchId}, ${pick.warehouseId}, ${pick.qty}, 'return', ${order.code}, ${WHY}, ${admin.id})`,
      );
      await tx.execute(sql`update order_pick set returned_at = now() where id = ${pick.id}`);
    }
    await cancelInvoiceOf(tx, admin, order.id, WHY);
    await tx.execute(sql`update sales_order set status = 'cancelled', flag_reason = ${WHY}, updated_at = now() where id = ${order.id}`);
    await logEvent(tx, order.id, admin, "status", `Cancelled. Reason: ${WHY}`);
  });
  // Not gone yet: the desk's own Cancel (its invoice, any packed pieces and points go back).
  if (!gone) await actOnOrder(db, admin, order.id, "cancel", { reason: WHY });
}
const word = apply ? "" : "would be ";
console.log(`  ${word}cancelled: ${cancelledOpen} not gone yet, ${cancelledGone} shipped or delivered`);
console.log(`  payments ${word}taken off: ${paymentsOff} · pieces ${word}put back on their shelves: ${piecesBack}`);

// ---- 2. The Books documents made in the CRM (not Zoho's) ----
const bookDocs = await rows<{ id: number; kind: string }>(
  db,
  sql`select id::int as id, kind from book_doc where zoho_id is null and voided_at is null and status <> 'void'
      order by case kind when 'vendor_payment' then 0 when 'customer_payment' then 0 when 'vendor_credit' then 1 when 'credit_note' then 1 when 'bill' then 2 else 3 end, id`,
);
console.log(`\nBooks documents made in the CRM ${word}voided: ${bookDocs.length}`);
if (apply)
  for (const doc of bookDocs) {
    if (["bill", "vendor_payment", "vendor_credit", "customer_payment", "credit_note"].includes(doc.kind)) await voidDoc(db, admin, doc.id, WHY);
    else await db.execute(sql`update book_doc set status = 'void', voided_by = ${admin.id}, voided_at = now(), void_reason = ${WHY} where id = ${doc.id}`);
  }

// ---- 3. The walkthrough's customers and what sits on them ----
const demoCustomers = sql`(select c.id from customer c where c.note like ${`%${MARK}%`}
  and not exists (select 1 from lead l where l.customer_id = c.id))`;
const steps: { what: string; n: ReturnType<typeof sql>; change: ReturnType<typeof sql> }[] = [
  {
    what: "calls logged on the walkthrough's customers, removed",
    n: sql`select count(*)::int as n from account_call where customer_id in ${demoCustomers}`,
    change: sql`delete from account_call where customer_id in ${demoCustomers}`,
  },
  {
    what: "care groups on the walkthrough's doctors, closed",
    n: sql`select count(*)::int as n from care_group where doctor_id in ${demoCustomers} and closed_at is null`,
    change: sql`update care_group set closed_at = now(), closed_by = ${admin.id}, close_reason = ${WHY} where doctor_id in ${demoCustomers} and closed_at is null`,
  },
  {
    what: "the walkthrough's tenders (\"Demo · …\"), dropped",
    n: sql`select count(*)::int as n from tender where title like 'Demo · %' and step not in ('lost', 'dropped')`,
    change: sql`update tender set step = 'dropped' where title like 'Demo · %' and step not in ('lost', 'dropped')`,
  },
  {
    what: "the walkthrough's customers, archived",
    n: sql`select count(*)::int as n from customer where id in ${demoCustomers} and active`,
    change: sql`update customer set active = false where id in ${demoCustomers} and active`,
  },
  {
    what: "the walkthrough's attendance rows, removed",
    n: sql`select count(*)::int as n from attendance where note = ${MARK}`,
    change: sql`delete from attendance where note = ${MARK}`,
  },
];
console.log("");
for (const step of steps) {
  const n = await count(step.n);
  console.log(`${n} ${apply ? step.what : step.what.replace(/, (\w+)$/, ", would be $1")}`);
  if (apply && n) await db.execute(step.change);
}

if (apply) {
  console.log("\nAfter:");
  await checks("after");
  console.log(`  orders not made from a lead, still open: ${await count(sql`select count(*)::int as n from sales_order where lead_id is null and status not in ('cancelled', 'draft')`)}`);
}
process.exit(0);
