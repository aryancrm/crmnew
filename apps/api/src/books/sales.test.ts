import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { seedDemoCustomers } from "../customers/seed";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoFinance } from "../finance/seed";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemoOrders } from "../orders/seed";
import { seedDemo } from "../seed";
import type { BookCustomer, BookCustomerList, BookDoc, BookList } from "../types";
import { CSV_SPECS, customerOpenings, docsFromCsv, linkDocs, type Row, saveDocs } from "./zoho";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const json = async <T>(response: Response) => {
  if (response.status !== 200) throw new Error(`${response.status} ${await response.text()}`);
  return (await response.json()) as T;
};
let customerId = 0;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  await seedDemoCustomers(db);
  await seedDemoOrders(db);
  await seedDemoFinance(db);
  // A hospital that came from Zoho.
  const [hospital] = await rows<{ id: number }>(db, sql`select id::int as id from customer where kind = 'hospital' order by id limit 1`);
  customerId = hospital?.id as number;
  await db.execute(sql`update customer set zoho_id = 'c-1' where id = ${customerId}`);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["fiona", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

const so = (line: Partial<Row>): Row => ({
  "SalesOrder ID": "so1", "Order Date": "2026-10-01", "Expected Shipment Date": "", "SalesOrder Number": "SO-00001", Status: "invoiced", "Customer ID": "c-1",
  "Customer Name": "Hospital", PurchaseOrder: "HPO-77", "Currency Code": "PHP", "Exchange Rate": "1", SubTotal: "1000.00", Total: "1000.00", "Payment Terms Label": "Net 30",
  Notes: "", "Delivery Method": "Lalamove", "CF.PX Name": "", "Item Name": "Doxget", SKU: "GM-1", "Item Desc": "", "Warehouse Name": "Main", "Usage unit": "pcs",
  QuantityOrdered: "10.00", QuantityInvoiced: "10.00", QuantityPacked: "10.00", QuantityCancelled: "0.00", "Item Price": "100.00", "Item Tax": "", "Item Tax %": "", "Item Tax Amount": "", "Item Total": "1000.00",
  ...line,
} as Row);
const inv = (line: Partial<Row>): Row => ({
  "Invoice ID": "i1", "Invoice Date": "2026-10-02", "Invoice Number": "INV-1", "Invoice Status": "PartiallyPaid", "Customer Name": "Hospital", "Customer ID": "c-1",
  "Due Date": "2026-11-01", PurchaseOrder: "HPO-77", "Currency Code": "PHP", "Exchange Rate": "1", SubTotal: "1000.00", Total: "1000.00", Balance: "400.00",
  "Payment Terms Label": "Net 30", Notes: "", "Item Name": "Doxget", SKU: "GM-1", "Item Desc": "", "Warehouse Name": "Main", "Usage unit": "pcs", Quantity: "10.00",
  "Item Price": "100.00", "Item Tax": "", "Item Tax %": "", "Item Tax Amount": "", "Item Total": "1000.00", "Sales Order Number": "SO-00001",
  "Batch Reference#": "B-9", "Expiry Date": "2028-01-31", "Quantity Out": "10.00",
  ...line,
} as Row);
const pay = (line: Partial<Row>): Row => ({
  "Payment Number Suffix": "501", "CustomerPayment ID": "p1", Date: "2026-10-05", CustomerID: "c-1", "Customer Name": "Hospital", Mode: "Bank Transfer", Description: "",
  "Exchange Rate": "1", Amount: "700.00", "Reference Number": "BDO-1", "Invoice Number": "INV-1", "Invoice Amount": "600.00", "Currency Code": "PHP", "Payment Status": "Paid",
  "Created Time": "2026-10-05 10:00:00",
  ...line,
} as Row);

describe("Sales in the books", () => {
  it("Zoho's order, invoice and payment come in linked, with the CRM's own beside them, for the money desks", async () => {
    const orders = docsFromCsv(CSV_SPECS.Sales_Order!, [so({})]);
    const invoices = docsFromCsv(CSV_SPECS.Invoice!, [inv({})]);
    const payments = docsFromCsv(CSV_SPECS.Customer_Payment!, [pay({})]);
    expect(invoices[0]).toMatchObject({ status: "partially_paid", balance: 40000 });
    expect(payments[0]).toMatchObject({ number: "501", total: 70000, balance: 10000 });
    for (const docs of [orders, invoices, payments]) await saveDocs(db, docs, true);
    for (const docs of [orders, invoices, payments]) await linkDocs(db, docs, true);

    const list = await json<BookList>(await get("fiona", "/api/books/sales_order?perPage=200"));
    const zoho = list.rows.find((r) => r.number === "SO-00001");
    expect(zoho).toMatchObject({ party: expect.any(String), invoiced: "full", packed: "full", paid: "partial", deliveryMethod: "Lalamove", reference: "HPO-77" });
    // The CRM's own orders are in the same list, opening on the order line.
    const crm = list.rows.filter((r) => r.id < 0);
    expect(crm.length).toBeGreaterThan(0);
    expect(crm[0]?.crm?.href).toMatch(/^\/orders\/\d+$/);
    const crmDoc = await json<BookDoc>(await get("fiona", `/api/books/sales_order/${crm[0]?.id}`));
    expect(crmDoc.lines.length).toBeGreaterThan(0);

    const invoiceList = await json<BookList>(await get("fiona", "/api/books/invoice?q=INV-1"));
    expect(invoiceList.rows[0]).toMatchObject({ number: "INV-1", linked: "SO-00001", status: "overdue", balance: 40000 });
    const invoice = await json<BookDoc>(await get("fiona", `/api/books/invoice/${invoiceList.rows[0]?.id}`));
    expect(invoice.linkedDocs.map((d) => [d.kind, d.number, d.amount])).toEqual([
      ["sales_order", "SO-00001", null],
      ["customer_payment", "501", 60000],
    ]);
    expect(invoice.lines[0]?.batches[0]).toMatchObject({ "Batch Reference#": "B-9", "Expiry Date": "2028-01-31" });

    // Zoho says the hospital owes 400 more than its invoices here explain: kept as an opening figure.
    await customerOpenings(db, [{ contact_id: "c-1", outstanding_receivable_amount: 800, unused_credits_receivable_amount: 100 }], true);
    const customer = await json<BookCustomer>(await get("fiona", `/api/books/customers/${customerId}`));
    expect(customer.receivables - 80000).toBeGreaterThanOrEqual(0);
    expect(customer.credits).toBe(10000);
    expect(customer.recent.some((d) => d.number === "SO-00001")).toBe(true);
    const hospitals = await json<BookCustomerList>(await get("fiona", "/api/books/customers?view=hospital"));
    expect(hospitals.rows.every((r) => r.kind === "hospital")).toBe(true);
    expect((await get("ryan", "/api/books/sales_order")).status).toBe(403);

    // Finance takes the rest of Zoho's invoice in the CRM; voiding the payment puts it back.
    const post = (who: string, path: string, body: unknown) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json", cookie: cookies[who] as string }, body: JSON.stringify(body) });
    const invoiceId = invoiceList.rows[0]?.id as number;
    expect((await post("fiona", "/api/books/customer_payment/new", { customerId, date: "2026-11-17", amount: 50000, invoices: [{ billId: invoiceId, amount: 50000 }] })).status).toBe(400);
    const receipt = await json<{ id: number }>(
      await post("fiona", "/api/books/customer_payment/new", { customerId, date: "2026-11-17", amount: 50000, mode: "Cash", invoices: [{ billId: invoiceId, amount: 40000 }] }),
    );
    let paidInvoice = await json<BookDoc>(await get("fiona", `/api/books/invoice/${invoiceId}`));
    expect(paidInvoice).toMatchObject({ status: "paid", balance: 0 });
    const made = await json<BookDoc>(await get("fiona", `/api/books/customer_payment/${receipt.id}`));
    expect(made).toMatchObject({ total: 50000, unused: 10000, mode: "Cash" });
    expect((await post("ryan", `/api/books/customer_payment/${receipt.id}/void`, { reason: "x" })).status).toBe(403);
    await json(await post("fiona", `/api/books/customer_payment/${receipt.id}/void`, { reason: "Bounced cheque" }));
    paidInvoice = await json<BookDoc>(await get("fiona", `/api/books/invoice/${invoiceId}`));
    expect(paidInvoice.balance).toBe(40000);
  });
});
