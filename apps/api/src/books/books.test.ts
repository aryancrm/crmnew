import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { BookDoc, BookList, VendorList } from "../types";
import { CSV_SPECS, docsFromCsv, importVendors, linkDocs, type Row, saveDocs, vendorCreditFromJson } from "./zoho";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });

// Zoho's backup: one row per line (and per batch), the document's fields on every row.
const po = (line: Partial<Row>): Row => ({
  "Purchase Order ID": "po1", "Purchase Order Date": "2026-11-01", "Delivery Date": "2026-11-20", "Purchase Order Number": "PO-00001",
  "Reference#": "INHOUSE", "Purchase Order Status": "Partially Billed", "Vendor Name": "Venus Remedies", "Currency Code": "PHP",
  "Exchange Rate": "1.000000000000", Total: "1500.00", "Payment Terms Label": "Net 60", "Terms & Conditions": "Deliver by noon",
  "Item Name": "", SKU: "", "Item Desc": "", Account: "Inventory Asset", "Warehouse Name": "Main", "Usage unit": "pcs",
  QuantityOrdered: "", QuantityReceived: "", QuantityBilled: "", QuantityCancelled: "0.00", "Item Price": "", "Item Total": "",
  "Item Tax": "", "Item Tax %": "", "Item Tax Amount": "", "Item.CF.Strength": "", ...line,
} as Row);
const bill = (line: Partial<Row>): Row => ({
  "PayInvoice ID": "b1", "Bill Date": "2026-11-05", "Bill Number": "INV-778", PurchaseOrder: "PO-00001", "Bill Status": "Overdue",
  "Vendor Name": "Venus Remedies", "Due Date": "2026-11-10", "Currency Code": "PHP", "Exchange Rate": "1", SubTotal: "1000.00", Total: "1000.00",
  Balance: "400.00", "Vendor Notes": "", "Item Name": "Doxget 50mg", SKU: "GM-1", Description: "", Account: "Inventory Asset",
  Quantity: "10.00", Rate: "100.00", "Item Total": "1000.00", "Usage unit": "pcs", "Warehouse Name": "Main", "Purchase Order Number": "PO-00001",
  "Purchase Receive Number": "", "Batch Reference#": "", "Expiry Date": "", "Quantity In": "", ...line,
} as Row);

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["naresh", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("Zoho's documents into the books", () => {
  it("rows become documents with their lines and batches, every field kept, linked by number", async () => {
    await importVendors(db, [{ "Contact ID": "v1", "Display Name": "Venus Remedies", "Contact Name": "Venus Remedies", Status: "Active", "Currency Code": "PHP", "CF.TIN": "123-456", Notes: "" } as Row], true);
    const orders = docsFromCsv(CSV_SPECS["Purchase_Order.csv"]!, [
      po({ "Item Name": "Doxget 50mg", SKU: "GM-1", QuantityOrdered: "10.00", QuantityReceived: "10.00", QuantityBilled: "10.00", "Item Price": "100.00", "Item Total": "1000.00" }),
      po({ "Item Name": "Gemget 1g", SKU: "GM-2", QuantityOrdered: "5.00", QuantityReceived: "0.00", QuantityBilled: "0.00", "Item Price": "100.00", "Item Total": "500.00", "Item.CF.Strength": "1g" }),
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ number: "PO-00001", status: "partially_billed", total: 150000, dueDate: "2026-11-20", paymentTerms: "Net 60" });
    expect(orders[0]?.fields["Terms & Conditions"]).toBe("Deliver by noon");
    expect(orders[0]?.lines.map((l) => [l.itemName, l.qty, l.qtyDone])).toEqual([
      ["Doxget 50mg", 10, { received: 10, billed: 10 }],
      ["Gemget 1g", 5, {}],
    ]);
    expect(orders[0]?.lines[1]?.fields["Item.CF.Strength"]).toBe("1g");
    // One bill line from two batches stays one line with both batches.
    const bills = docsFromCsv(CSV_SPECS["Bill.csv"]!, [
      bill({ "Batch Reference#": "B-1", "Expiry Date": "2028-01-31", "Quantity In": "6.00" }),
      bill({ "Batch Reference#": "B-2", "Expiry Date": "2028-03-31", "Quantity In": "4.00" }),
    ]);
    expect(bills[0]?.lines).toHaveLength(1);
    expect(bills[0]?.lines[0]?.batches.map((b) => b["Batch Reference#"])).toEqual(["B-1", "B-2"]);
    expect(bills[0]?.links).toEqual([{ kind: "purchase_order", number: "PO-00001", amount: null, on: null }]);
    const credit = vendorCreditFromJson({
      vendor_credit_id: "vc1", vendor_credit_number: "DN-00001", vendor_name: "Venus Remedies", vendor_id: "v1", date: "2026-11-06", status: "open",
      total: 100, balance: 100, currency_code: "PHP", exchange_rate: 1, reference_number: "PO-00001", line_items: [{ name: "Doxget 50mg", quantity: 1, rate: 100, item_total: 100 }],
      bills_credited: [{ bill_number: "INV-778", amount: 0, date: "2026-11-06" }],
    });
    for (const docs of [orders, bills, [credit]]) await saveDocs(db, docs, true);
    for (const docs of [orders, bills, [credit]]) await linkDocs(db, docs, true);
    // Again: nothing doubles; Zoho's newer status comes over.
    const again = await saveDocs(db, docsFromCsv(CSV_SPECS["Bill.csv"]!, [bill({ Balance: "0.00", "Bill Status": "Paid" })]), true);
    expect(again).toMatchObject({ made: 0, updated: 1 });
  });

  it("lists as Zoho does, a bill past due reads overdue, a document shows what it hangs on; for the stock and money desks only", async () => {
    const pos = (await (await get("naresh", "/api/books/purchase_order")).json()) as BookList;
    expect(pos.rows[0]).toMatchObject({ number: "PO-00001", party: "Venus Remedies", received: "partial", billed: "partial", total: 150000 });
    const bills = (await (await get("naresh", "/api/books/bill")).json()) as BookList;
    expect(bills.rows[0]).toMatchObject({ number: "INV-778", status: "paid", balance: 0 });
    const doc = (await (await get("naresh", `/api/books/purchase_order/${pos.rows[0]?.id}`)).json()) as BookDoc;
    expect(doc.linkedDocs.map((d) => [d.kind, d.number])).toEqual([["bill", "INV-778"]]);
    expect(doc.vendor?.name).toBe("Venus Remedies");
    const vendors = (await (await get("naresh", "/api/books/vendors?q=Venus")).json()) as VendorList;
    expect(vendors.rows[0]?.name).toBe("Venus Remedies");
    expect((await get("ryan", "/api/books/bill")).status).toBe(403);
  });
});
