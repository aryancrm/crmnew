// Closes what the demo company left behind once a database holds the real company: the demo
// people (…@2mg.test, already left) placed orders, added customers, opened enquiries, tenders,
// pipeline products and registrations, set promos and targets, and tried the Books forms (a purchase
// order, its receive, a bill and a payment). None of it is deleted: orders are
// cancelled (their invoices with them; a payment on a delivered demo order is taken off first, so
// no refund is owed for money that never came), customers and medicines archived, the rest closed
// the way its desk closes it, each with the reason. Real records (Zoho's, the real people's) are
// never touched.
//
// Dry run by default (prints what it would do); --apply writes.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/close-demo.ts [--apply]
//   (the live database only with --live and Aryan's word; it has no demo company)

import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { voidDoc } from "../src/books/actions";
import { cancelInvoiceOf } from "../src/finance/service";
import { logEvent, peso } from "../src/orders/events";
import { actOnOrder } from "../src/orders/service";
import type { Me } from "../src/types";
import { openTarget } from "./zoho-files";

const apply = process.argv.includes("--apply");
if (!process.env.TEST_PGLITE_DIR && !process.argv.includes("--live")) {
  console.log("Give TEST_PGLITE_DIR (a local database). The live one only with --live, on Aryan's word.");
  process.exit(1);
}
const WHY = "Demo, closed before going live";

const target = await openTarget(false);
if (!target) process.exit(1);
const { db, where } = target;
console.log(`${apply ? "Changing" : "Dry run on"} ${where}.`);

const [adminRow] = await rows<{ id: number; name: string }>(
  db,
  sql`select id::int as id, name from person where role = 'admin' and active order by id limit 1`,
);
if (!adminRow) throw new Error("No admin in this CRM.");
const admin = { id: adminRow.id, name: adminRow.name, role: "admin", area: null, channel: null } as unknown as Me;
const demo = sql`(select id from person where email like '%@2mg.test' and role <> 'admin')`;
const [people] = await rows<{ n: number; active: number }>(
  db,
  sql`select count(*)::int as n, count(*) filter (where active)::int as active from person where id in ${demo}`,
);
if (!people?.n) {
  console.log("No demo people here: nothing to close.");
  process.exit(0);
}
if (people.active)
  console.log(`Note: ${people.active} demo people are still active (onboard-company.ts --retire-demo makes them leave).`);

const said = (what: string, n: number) => {
  if (n) console.log(`${what}: ${n}`);
};

// 1. Orders the demo people placed.
const orders = await rows<{ id: number; code: string; status: string; points: number }>(
  db,
  sql`select o.id::int as id, o.code, o.status,
        (select count(*) from payment p join invoice i on i.id = p.invoice_id
          where i.order_id = o.id and p.active and p.method = 'points')::int as points
      from sales_order o where o.raised_by in ${demo} and o.status <> 'cancelled' order by o.id`,
);
let cancelled = 0;
let gone = 0;
let paymentsOff = 0;
for (const order of orders) {
  const open = !["shipped", "completed"].includes(order.status);
  // Points on a delivered order come back only by hand; on an open one, Cancel gives them back.
  if (!open && order.points) {
    console.log(`${order.code} kept: points were paid on it (cancel it by hand).`);
    continue;
  }
  // Money recorded on a demo order never came: it comes off first, so no refund is owed for it.
  const payments = await rows<{ id: number; amount: number; invoiceId: number }>(
    db,
    sql`select p.id::int as id, p.amount::int as amount, p.invoice_id::int as "invoiceId"
        from payment p join invoice i on i.id = p.invoice_id
        where i.order_id = ${order.id} and p.active and p.method <> 'points'`,
  );
  paymentsOff += payments.length;
  if (open) cancelled += 1;
  else gone += 1;
  if (!apply) continue;
  await db.transaction(async (tx) => {
    for (const payment of payments) {
      await tx.execute(
        sql`update payment set active = false, removed_reason = ${WHY}, removed_by = ${admin.id}, removed_at = now() where id = ${payment.id}`,
      );
      await tx.execute(
        sql`update invoice set paid = paid - ${payment.amount},
              status = case when status = 'cancelled' then status else 'open' end where id = ${payment.invoiceId}`,
      );
      await logEvent(tx, order.id, admin, "payment", `Payment of ${peso(payment.amount)} taken off: ${WHY}.`);
    }
    if (open) return;
    // Delivered or on its way, which Cancel doesn't take: its invoice and the order are cancelled.
    await cancelInvoiceOf(tx, admin, order.id, WHY);
    await tx.execute(
      sql`update sales_order set status = 'cancelled', flag_reason = ${WHY}, updated_at = now() where id = ${order.id}`,
    );
    await logEvent(tx, order.id, admin, "status", `Cancelled. Reason: ${WHY}`);
  });
  // Not gone yet: the desk's own Cancel (its invoice, any packed pieces and points go back).
  if (open) await actOnOrder(db, admin, order.id, "cancel", { reason: WHY });
}
said("Demo orders cancelled (not gone yet)", cancelled);
said("Demo orders cancelled (shipped or delivered)", gone);
said("Their payments taken off", paymentsOff);

// 2. Books documents the demo people made trying the Books forms: money first (a payment or a credit
// voided puts its amount back on the bill), then the bills, then the orders and receives behind them.
const bookDocs = await rows<{ id: number; kind: string; number: string }>(
  db,
  sql`select id::int as id, kind, number from book_doc where created_by in ${demo} and voided_at is null and status <> 'void'
      order by case kind when 'vendor_payment' then 0 when 'customer_payment' then 0 when 'vendor_credit' then 1 when 'credit_note' then 1
        when 'bill' then 2 else 3 end, id`,
);
let booksVoided = 0;
for (const doc of bookDocs) {
  booksVoided += 1;
  if (!apply) continue;
  if (["bill", "vendor_payment", "vendor_credit", "customer_payment", "credit_note"].includes(doc.kind)) await voidDoc(db, admin, doc.id, WHY);
  // An order or a receive has no void of its own here: it is marked so, with the reason.
  else
    await db.execute(
      sql`update book_doc set status = 'void', voided_by = ${admin.id}, voided_at = now(), void_reason = ${WHY} where id = ${doc.id}`,
    );
}
said("Demo books documents voided", booksVoided);

// 3. What each desk had open.
type Step = { what: string; count: ReturnType<typeof sql>; change: ReturnType<typeof sql>[] };
const steps: Step[] = [
  {
    what: "Demo customers archived",
    count: sql`select count(*)::int as n from customer where added_by in ${demo} and active`,
    change: [sql`update customer set active = false where added_by in ${demo} and active`],
  },
  {
    // Only a medicine Zoho never had, with nothing on the shelves, used by demo orders alone.
    what: "Demo medicines archived",
    count: sql`select count(*)::int as n from medicine m where m.active
      and not exists (select 1 from book_item b where b.medicine_id = m.id)
      and not exists (select 1 from stock s join batch b on b.id = s.batch_id where b.medicine_id = m.id and s.qty > 0)
      and not exists (select 1 from order_item oi join sales_order o on o.id = oi.order_id where oi.medicine_id = m.id and o.raised_by not in ${demo})
      and m.created_at < (select min(at) from stock_move where ref = 'ZOHO')`,
    change: [
      sql`update medicine m set active = false where m.active
        and not exists (select 1 from book_item b where b.medicine_id = m.id)
        and not exists (select 1 from stock s join batch b on b.id = s.batch_id where b.medicine_id = m.id and s.qty > 0)
        and not exists (select 1 from order_item oi join sales_order o on o.id = oi.order_id where oi.medicine_id = m.id and o.raised_by not in ${demo})
        and m.created_at < (select min(at) from stock_move where ref = 'ZOHO')`,
    ],
  },
  {
    what: "Demo enquiries closed as lost",
    count: sql`select count(*)::int as n from lead where (created_by in ${demo} or assigned_to in ${demo}) and state = 'open'`,
    change: [
      sql`insert into lead_event (lead_id, kind, message, by_person)
        select id, 'status', ${`Closed as lost: ${WHY}.`}, ${admin.id} from lead
        where (created_by in ${demo} or assigned_to in ${demo}) and state = 'open'`,
      sql`update lead set state = 'lost', lost_reason = ${WHY} where (created_by in ${demo} or assigned_to in ${demo}) and state = 'open'`,
    ],
  },
  {
    what: "Demo tenders dropped",
    count: sql`select count(*)::int as n from tender where created_by in ${demo} and step not in ('paid', 'lost', 'dropped')`,
    change: [
      sql`insert into tender_event (tender_id, step, note, by_person)
        select id, 'dropped', ${WHY}, ${admin.id} from tender where created_by in ${demo} and step not in ('paid', 'lost', 'dropped')`,
      sql`update tender set step = 'dropped' where created_by in ${demo} and step not in ('paid', 'lost', 'dropped')`,
    ],
  },
  {
    what: "Demo purchase orders cancelled",
    count: sql`select count(*)::int as n from purchase where created_by in ${demo} and state = 'ordered'`,
    change: [
      sql`update purchase set state = 'cancelled', note = trim(coalesce(note, '') || ' ' || ${WHY}) where created_by in ${demo} and state = 'ordered'`,
    ],
  },
  {
    what: "Demo pipeline products dropped",
    count: sql`select count(*)::int as n from pipeline_product where added_by in ${demo} and stage not in ('launched', 'dropped')`,
    change: [
      sql`insert into reg_event (pipeline_id, what, by_person)
        select id, ${`Dropped: ${WHY}`}, ${admin.id} from pipeline_product where added_by in ${demo} and stage not in ('launched', 'dropped')`,
      sql`update pipeline_product set stage = 'dropped', updated_at = now() where added_by in ${demo} and stage not in ('launched', 'dropped')`,
    ],
  },
  {
    what: "Demo product registrations withdrawn",
    count: sql`select count(*)::int as n from product_registration where added_by in ${demo} and status not in ('withdrawn', 'expired')`,
    change: [
      sql`insert into reg_event (registration_id, what, by_person)
        select id, ${`Withdrawn: ${WHY}`}, ${admin.id} from product_registration where added_by in ${demo} and status not in ('withdrawn', 'expired')`,
      sql`update product_registration set status = 'withdrawn', updated_at = now() where added_by in ${demo} and status not in ('withdrawn', 'expired')`,
    ],
  },
  {
    what: "Demo care groups closed",
    count: sql`select count(*)::int as n from care_group where enrolled_by in ${demo} and closed_at is null`,
    change: [
      sql`update care_group set closed_at = now(), closed_by = ${admin.id}, close_reason = ${WHY} where enrolled_by in ${demo} and closed_at is null`,
    ],
  },
  {
    what: "Demo B2B accounts dropped",
    count: sql`select count(*)::int as n from b2b_account where (nbd_id in ${demo} or crr_id in ${demo}) and dropped_at is null`,
    change: [
      sql`update b2b_account set dropped_at = now(), dropped_reason = ${WHY} where (nbd_id in ${demo} or crr_id in ${demo}) and dropped_at is null`,
    ],
  },
  {
    what: "Demo stock notices closed",
    count: sql`select count(*)::int as n from stock_news where by_person in ${demo} and closed_at is null`,
    change: [sql`update stock_news set closed_at = now() where by_person in ${demo} and closed_at is null`],
  },
  {
    // A promo changes a real medicine's price: it ends yesterday.
    what: "Demo promos ended",
    count: sql`select count(*)::int as n from promo where created_by in ${demo} and ends_on >= current_date`,
    change: [
      sql`update promo set starts_on = least(starts_on, current_date - 1), ends_on = current_date - 1
        where created_by in ${demo} and ends_on >= current_date`,
    ],
  },
  {
    // The seats are the real people's now; a demo target on them is cleared as Targets clears one.
    what: "Demo targets cleared from seats",
    count: sql`select count(*)::int as n from seat_target where set_by in ${demo}`,
    change: [sql`delete from seat_target where set_by in ${demo}`],
  },
];
for (const step of steps) {
  const [found] = await rows<{ n: number }>(db, step.count);
  said(step.what, found?.n ?? 0);
  if (apply && found?.n)
    await db.transaction(async (tx) => {
      for (const change of step.change) await tx.execute(change);
    });
}

// Kept, for a person to look at: no closed state to give them.
const papers = await rows<{ name: string }>(db, sql`select name from company_paper where added_by in ${demo} order by id`);
if (papers.length)
  console.log(
    `Kept: ${papers.length} company papers the demo people added (${papers.map((paper) => paper.name).join(", ")}); Bidding replaces each by adding the real one under the same name.`,
  );

if (!apply) console.log("Nothing written. Add --apply to do it.");
process.exit(0);
