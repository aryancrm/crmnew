// This CRM's own money in the books (migration 0096, docs/ERP-PLAN.md phase 1): an order's invoice,
// the stock it took, the payment into the bank Finance names, a return's credit and a refund each
// give balanced debits and credits on Zoho's accounts, by themselves.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";
import type {
  BalanceSheet,
  BatchTrace,
  BookAccountDetail,
  BookAccountList,
  CashFlow,
  Catalogue,
  GrossProfit,
  MoneyAccounts,
  MoneySummary,
  PayablesAging,
  ProfitAndLoss,
  ReturnList,
  ReturnRow,
  TrialBalance,
  VatSummary,
} from "../types";

const PASSWORD = "test-password-1";
const BANK = "BDO - 2MG 6722";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine: { id: number; price: number };
let hospital = 0;

const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const ok = async (who: string, path: string, body: unknown = {}) => {
  const response = await post(who, path, body);
  expect(response.status, `${who} ${path}: ${await response.clone().text()}`).toBe(200);
  return response;
};
type Entry = { kind: string; account: string; debit: number; credit: number };
const entries = (where: ReturnType<typeof sql>) =>
  rows<Entry>(db, sql`select kind, account, debit::int as debit, credit::int as credit from book_entry where source = 'crm' and ${where} order by kind, account`);
const on = (list: Entry[], account: string) =>
  list.filter((one) => one.account === account).reduce((sum, one) => sum + one.debit - one.credit, 0);

async function delivered(qty: number): Promise<{ orderId: number; invoiceId: number; total: number }> {
  const placed = (await (
    await ok("ryan", "/api/orders", { customerId: hospital, items: [{ medicineId: medicine.id, qty, priceKind: "hospital" }] })
  ).json()) as { id: number };
  const id = placed.id;
  await ok("sarla", `/api/orders/${id}/approve`, { finance: true });
  await ok("fiona", `/api/finance/orders/${id}/invoice`);
  await ok("marco", `/api/dispatch/orders/${id}/pack`);
  await ok("marco", `/api/dispatch/orders/${id}/ship`, { method: "courier", addressChecked: true, courier: "LBC", tracking: "1" });
  expect(await attachReceipt(app, cookies.marco as string, id)).toBe(200);
  await ok("marco", `/api/dispatch/orders/${id}/deliver`, { receivedBy: "Nurse Ana", deliveredOn: todayManila() });
  const [invoice] = await rows<{ id: number; total: number }>(db, sql`select id::int as id, total::int as total from invoice where order_id = ${id}`);
  return { orderId: id, invoiceId: invoice?.id as number, total: invoice?.total as number };
}

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["ryan", "sarla", "fiona", "marco", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  // The books' chart: a bank, and the accounts Zoho posts sales to.
  await db.execute(
    sql`insert into book_account (name, type) values (${BANK}, 'bank'), ('Undeposited Funds', 'cash'), ('Petty Cash', 'cash'),
      ('Accounts Receivable', 'accounts_receivable'), ('Sales', 'income'), ('Tax Payable', 'other_current_liability'),
      ('Cost of Goods Sold', 'cost_of_goods_sold'), ('Inventory Asset', 'stock'), ('Advance Tax', 'other_current_asset')`,
  );
  hospital = ((await (
    await post("sarla", "/api/customers", { kind: "hospital", name: "Ledger General Hospital", city: "Pasay", paymentTerms: "days", paymentDays: 30 })
  ).json()) as { id: number }).id;
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find((item) => item.prices.hospital !== undefined && item.total >= 500);
  if (!row) throw new Error("no medicine with a hospital price and stock");
  medicine = { id: row.id, price: row.prices.hospital as number };
  // A 12% medicine, so the VAT shows.
  await db.execute(sql`update medicine set vat = 'vat12' where id = ${medicine.id}`);
});

describe("this CRM's money in the books", () => {
  it("an invoice, its stock, a payment into the bank named, a return and a refund all balance", async () => {
    const { orderId, invoiceId, total } = await delivered(20);
    expect(total).toBe(20 * medicine.price);
    const vat = Math.round((total * 12) / 112);

    const sale = await entries(sql`kind = 'crm_invoice' and doc_id = ${invoiceId}`);
    expect(on(sale, "Accounts Receivable")).toBe(total);
    expect(on(sale, "Sales")).toBe(-(total - vat));
    expect(on(sale, "Tax Payable")).toBe(-vat);

    // The stock that left, at its batches' cost.
    const [cost] = await rows<{ cost: number }>(
      db,
      sql`select sum(-m.qty * b.unit_cost)::int as cost from stock_move m join batch b on b.id = m.batch_id
        where m.kind = 'deliver' and m.ref = (select code from sales_order where id = ${orderId})`,
    );
    expect(cost?.cost).toBeGreaterThan(0);
    const out = await entries(sql`kind = 'crm_stock' and link = ${`/orders/${orderId}`}`);
    expect(on(out, "Cost of Goods Sold")).toBe(cost?.cost);
    expect(on(out, "Inventory Asset")).toBe(-(cost?.cost ?? 0));

    // The form lists the money accounts; an account that isn't one is refused.
    const listed = await read<MoneyAccounts>("fiona", "/api/finance/money-accounts");
    expect(listed.accounts.map((one) => one.name)).toContain(BANK);
    expect(listed.accounts.map((one) => one.name)).not.toContain("Sales");
    const pay = { amount: 10 * medicine.price, method: "bank", reference: "BDO-1", paidOn: todayManila() };
    const wrong = await post("fiona", `/api/invoices/${invoiceId}/payments`, { ...pay, moneyAccount: "Sales" });
    expect(wrong.status).toBe(400);
    await ok("fiona", `/api/invoices/${invoiceId}/payments`, { ...pay, moneyAccount: BANK.toLowerCase() });
    // Paid with no account named: Undeposited Funds, as in Zoho, until Finance puts it right.
    await ok("fiona", `/api/invoices/${invoiceId}/payments`, { ...pay, amount: total - 10 * medicine.price, reference: "BDO-2" });
    let paid = await entries(sql`kind = 'crm_payment' and doc_id in (select id from payment where invoice_id = ${invoiceId})`);
    expect(on(paid, BANK)).toBe(10 * medicine.price);
    expect(on(paid, "Undeposited Funds")).toBe(total - 10 * medicine.price);
    expect(on(paid, "Accounts Receivable")).toBe(-total);
    const [second] = await rows<{ id: number }>(db, sql`select id::int as id from payment where invoice_id = ${invoiceId} and reference = 'BDO-2'`);
    expect((await post("ryan", `/api/payments/${second?.id}/account`, { moneyAccount: BANK })).status).toBe(403);
    await ok("fiona", `/api/payments/${second?.id}/account`, { moneyAccount: BANK });
    paid = await entries(sql`kind = 'crm_payment' and doc_id in (select id from payment where invoice_id = ${invoiceId})`);
    expect(on(paid, BANK)).toBe(total);
    expect(on(paid, "Undeposited Funds")).toBe(0);

    // 5 come back and are credited: Sales and its VAT back, off what is owed, on the day credited.
    const itemId = (await read<{ left: { orderItemId: number }[] }>("sarla", `/api/orders/${orderId}/returns`)).left[0]?.orderItemId;
    const returnId = ((await (await ok("sarla", `/api/orders/${orderId}/returns`, { reason: "not_needed", lines: [{ orderItemId: itemId, qty: 5 }] })).json()) as { id: number }).id;
    const line = (await read<ReturnList>("marco", "/api/returns")).rows.find((one) => one.id === returnId) as ReturnRow;
    await ok("marco", `/api/returns/${returnId}/receive`, { lines: [{ lineId: line.lines[0]?.id, outcome: "restocked" }] });
    await ok("sarla", `/api/returns/${returnId}/credit`, { credit: true });
    const credit = 5 * medicine.price;
    const creditVat = Math.round((credit * 12) / 112);
    const back = await entries(sql`kind = 'crm_return' and doc_id = ${returnId}`);
    expect(on(back, "Accounts Receivable")).toBe(-credit);
    expect(on(back, "Sales")).toBe(credit - creditVat);
    expect(on(back, "Tax Payable")).toBe(creditVat);
    // The invoice's own entries stay as first billed.
    expect(on(await entries(sql`kind = 'crm_invoice' and doc_id = ${invoiceId}`), "Accounts Receivable")).toBe(total);
    // The goods back on the shelf at their cost.
    const restocked = await entries(sql`kind = 'crm_stock' and doc_id in (select id from stock_move where kind = 'return')`);
    expect(on(restocked, "Inventory Asset")).toBeGreaterThan(0);

    // Paid beyond the new bill: Finance gives it back out of the bank.
    await ok("fiona", `/api/invoices/${invoiceId}/refunds`, { amount: credit, method: "bank", refundedOn: todayManila(), moneyAccount: BANK });
    const refund = await entries(sql`kind = 'crm_refund' and doc_id in (select id from refund where invoice_id = ${invoiceId})`);
    expect(on(refund, BANK)).toBe(-credit);
    expect(on(refund, "Accounts Receivable")).toBe(credit);

    // What the customer owes on the books: billed, credited, paid and refunded, nothing left.
    const all = await entries(sql`(link = ${`/invoices/${invoiceId}`} or link = ${`/orders/${orderId}`}) and kind <> 'crm_stock'`);
    expect(on(all, "Accounts Receivable")).toBe(0);
    // Every document of this CRM balances on its own.
    const unbalanced = await rows(
      db,
      sql`select kind, doc_id from book_entry where source = 'crm' group by kind, doc_id having sum(debit) <> sum(credit)`,
    );
    expect(unbalanced).toEqual([]);
  });

  it("shows on the chart and on the bank's own page, each entry opening its record", async () => {
    const chart = await read<BookAccountList>("fiona", "/api/books/accounts?view=all");
    const bank = chart.rows.find((one) => one.name === BANK);
    expect(bank?.balance).toBeGreaterThan(0);
    const detail = await read<BookAccountDetail>("fiona", `/api/books/accounts/${bank?.id}`);
    expect(detail.entries.length).toBe(3);
    expect(detail.entries.every((one) => one.link?.startsWith("/invoices/"))).toBe(true);
    expect(detail.entries[0]?.party).toBe("Ledger General Hospital");
    expect(detail.kinds.map((one) => one.kind).sort()).toEqual(["crm_payment", "crm_refund"]);
  });

  it("gives the statements, which agree with each other and with the entries", async () => {
    const today = todayManila();
    const tb = await read<TrialBalance>("fiona", "/api/books/reports/trial-balance");
    expect(tb.totals.difference).toBe(0);
    expect(tb.lines.find((one) => one.account === BANK)?.debit).toBeGreaterThan(0);

    // One order of 20, 5 credited back: the month's sale is 15 pieces less VAT; its cost the 15
    // that stayed out.
    const sold = 15 * medicine.price;
    const net = sold - (Math.round((20 * medicine.price * 12) / 112) - Math.round((5 * medicine.price * 12) / 112));
    const pl = await read<ProfitAndLoss>("fiona", `/api/books/reports/profit-and-loss?from=${today.slice(0, 7)}-01&to=${today}`);
    expect(pl.totals.income).toBe(net);
    expect(pl.totals.costOfSales).toBeGreaterThan(0);
    expect(pl.totals.grossProfit).toBe(pl.totals.income - pl.totals.costOfSales);
    expect(pl.notes).toEqual([]);

    const bs = await read<BalanceSheet>("fiona", "/api/books/reports/balance-sheet");
    expect(bs.totals.difference).toBe(0);
    expect(bs.profitToDate).toBe(pl.totals.netProfit);

    const cash = await read<CashFlow>("fiona", "/api/books/reports/cash-flow");
    const bank = cash.accounts.find((one) => one.account === BANK);
    expect(bank?.in).toBe(20 * medicine.price);
    expect(bank?.out).toBe(5 * medicine.price);
    expect(cash.what.find((one) => one.what === "From customers")?.in).toBe(20 * medicine.price);

    const vat = await read<VatSummary>("fiona", "/api/books/reports/vat");
    expect(vat.totals.output).toBe(Math.round((20 * medicine.price * 12) / 112) - Math.round((5 * medicine.price * 12) / 112));

    const gp = await read<GrossProfit>("fiona", "/api/books/reports/gross-profit?by=medicine");
    expect(gp.rows).toHaveLength(1);
    expect(gp.rows[0]?.revenue).toBe(net);
    expect(gp.rows[0]?.qty).toBe(20);
    expect(gp.totals.cost).toBe(pl.totals.costOfSales);
    expect(gp.totals.profit).toBe(pl.totals.grossProfit);
    const byOrder = await read<GrossProfit>("fiona", "/api/books/reports/gross-profit?by=order");
    expect(byOrder.rows[0]?.link).toMatch(/^\/orders\//);

    const summary = await read<MoneySummary>("naresh", "/api/books/reports/money-summary");
    expect(summary.profit.profit).toBe(gp.totals.profit);
    expect(summary.owed).toBe(0);

    const payables = await read<PayablesAging>("fiona", "/api/books/reports/payables-aging");
    expect(payables.totals.total).toBe(payables.suppliers.reduce((sum, one) => sum + one.total, 0));

    // A MedRep reads none of it.
    expect((await get("ryan", "/api/books/reports/profit-and-loss")).status).toBe(403);
    expect((await get("ryan", "/api/books/reports/gross-profit")).status).toBe(403);
  });
  it("traces a delivered batch to the customer it reached, with what came back", async () => {
    const [batch] = await rows<{ batchNo: string }>(
      db,
      sql`select b.batch_no as "batchNo" from stock_move m join batch b on b.id = m.batch_id where m.kind = 'deliver' order by m.id limit 1`,
    );
    const trace = await read<BatchTrace>("sarla", `/api/trace?batch=${encodeURIComponent(batch?.batchNo ?? "")}`);
    const hospitalRow = trace.customers.find((one) => one.name === "Ledger General Hospital");
    expect(hospitalRow?.pieces).toBeGreaterThan(0);
    expect(trace.moves.some((one) => one.kind === "deliver" && one.customer === "Ledger General Hospital")).toBe(true);
    expect((await get("ryan", `/api/trace?batch=${batch?.batchNo}`)).status).toBe(403);
    expect((await get("sarla", "/api/trace")).status).toBe(400);
  });
});
