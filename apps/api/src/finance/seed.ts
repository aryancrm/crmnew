// Demo money for a developer's computer: the demo orders that are already past Finance get the
// invoice Finance would have made, a few payments, and one customer late enough to show in
// "Customers owe". Done through Finance's own actions, as Fiona. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { todayManila as today } from "../inventory/rules";
import type { Me, OrderStatus, PaymentTerms } from "../types";
import { addDays } from "./rules";
import { confirmPayment, makeInvoice, recordPayment } from "./service";

export async function seedDemoFinance(db: Database): Promise<boolean> {
  const [made] = await rows<{ count: number }>(db, sql`select count(*)::int as count from invoice`);
  if ((made?.count ?? 0) > 0) return false;
  const [fiona] = await rows<{ id: number; name: string }>(
    db,
    sql`select id::int as id, name from person where role = 'finance' and active order by id limit 1`,
  );
  if (!fiona) return false;
  const me = { id: fiona.id, name: fiona.name, role: "finance", area: null } as unknown as Me;
  const past = await rows<{ id: number; status: OrderStatus; terms: PaymentTerms; total: number }>(
    db,
    sql`select id::int as id, status, payment_terms as terms, total::int as total from sales_order
      where status in ('ready_for_dispatch', 'packing', 'shipped', 'completed') order by id`,
  );
  if (past.length === 0) return false;
  for (const [index, order] of past.entries()) {
    // Stand it where Finance found it, do Finance's step, then put it back where it was.
    await db.execute(
      sql`update sales_order set status = ${order.terms === "advance" ? "finance_check" : "ready_for_invoice"} where id = ${order.id}`,
    );
    const { invoiceId } =
      order.terms === "advance"
        ? await confirmPayment(db, me, order.id, {
            amount: order.total,
            method: "bank",
            reference: `BDO-${7140 + order.id}`,
            paidOn: today(),
            checked: true,
          })
        : await makeInvoice(db, me, order.id, {});
    await db.execute(sql`update sales_order set status = ${order.status} where id = ${order.id}`);
    if (order.terms === "days") {
      // Older invoices: one long overdue, one partly paid, the rest just made.
      const back = index % 3 === 0 ? 75 : index % 3 === 1 ? 20 : 2;
      await db.execute(
        sql`update invoice set issued_on = issued_on - ${back}::int, due_on = due_on - ${back}::int where id = ${invoiceId}`,
      );
      if (index % 3 === 1)
        await recordPayment(db, me, invoiceId, {
          amount: Math.round(order.total / 2),
          method: "check",
          reference: `CHK-${3300 + order.id}`,
          paidOn: addDays(today(), -3),
        });
    }
  }
  return true;
}
