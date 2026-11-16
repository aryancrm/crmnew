import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemoInventory } from "../inventory/seed";
import { seedDemo } from "../seed";
import type { BookDoc, BookItem, BookItemList, BookList } from "../types";
import { CSV_SPECS, docsFromCsv, importItems, linkDocs, type Row, saveDocs } from "./zoho";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const get = (who: string, path: string) => app.request(path, { headers: { cookie: cookies[who] as string } });
const json = async <T>(response: Response) => {
  if (response.status !== 200) throw new Error(`${response.status} ${await response.text()}`);
  return (await response.json()) as T;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedDemoInventory(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["irene", "ryan"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

describe("Items and Inventory in the books", () => {
  it("every Zoho item, the CRM's stock for its medicines, and Zoho's packages, shipments, adjustments and transfers", async () => {
    const [medicine] = await rows<{ id: number; sku: string }>(db, sql`select m.id::int as id, 'GM-T1' as sku from medicine m order by m.id limit 1`);
    await db.execute(sql`insert into medicine_sku (medicine_id, sku) values (${medicine?.id}, 'GM-T1')`);
    const item = (extra: Partial<Row>): Row => ({ "Item ID": "it1", "Item Name": "Doxget 50", SKU: "GM-T1", Status: "Active", "Item Type": "Inventory", Unit: "pcs", "Selling Price": "120.00",
      "Purchase Price": "40.00", "Reorder Level": "10", "CF.Molecule": "Doxorubicin", "Batch Reference#": "", "Expiry Date": "", "Quantity In": "", "Warehouse Name": "", ...extra } as Row);
    const made = await importItems(db, [item({}), { ...item({}), "Item ID": "it2", "Item Name": "Advil 200mg", SKU: "GM-T2", "CF.Molecule": "Ibuprofen" } as Row], [{ item_id: "it2", stock_on_hand: 35 }], true);
    expect(made).toMatchObject({ items: 2, medicines: 1 });
    const list = await json<BookItemList>(await get("irene", "/api/books/items?view=all&perPage=200"));
    const ours = list.rows.find((r) => r.sku === "GM-T1");
    const zohoOnly = list.rows.find((r) => r.sku === "GM-T2");
    expect(ours).toMatchObject({ medicineId: medicine?.id, rate: 12000, zoho: true });
    expect(zohoOnly).toMatchObject({ medicineId: null, stock: 35 });
    const detail = await json<BookItem>(await get("irene", `/api/books/items/${ours?.id}`));
    expect(detail.fields["CF.Molecule"]).toBe("Doxorubicin");
    expect(detail.medicine?.id).toBe(medicine?.id);

    const so = docsFromCsv(CSV_SPECS.Sales_Order!, [
      { "SalesOrder ID": "so9", "SalesOrder Number": "SO-9", "Order Date": "2026-11-01", Status: "confirmed", "Customer Name": "Walk-in", Total: "10.00", "Item Name": "Doxget 50", SKU: "GM-T1", QuantityOrdered: "1", "Item Price": "10", "Item Total": "10.00" } as Row,
    ]);
    const pkg = docsFromCsv(CSV_SPECS.Package!, [
      { "PackageItemID": "pi1", "Packing Number": "PKG-9", "Packing Date": "2026-11-02", "SO Number": "SO-9", "Customer Name": "Walk-in", Status: "shipped", "Item Name": "Doxget 50", SKU: "GM-T1", "Quantity Packed": "1.000000", "CF.Carrier": "Lalamove" } as Row,
    ]);
    const ship = docsFromCsv(CSV_SPECS.Shipment_Order!, [
      { "Shipment ID": "sh9", "Packing Number": "PKG-9", "Shipment Date": "2026-11-02", "Shipment Number": "77", Status: "shipped", "Carrier Name": "Lalamove", "Tracking Number": "LL-1", "Shipping Charge": "80.000", "SO Number": "SO-9", "Customer Name": "Walk-in" } as Row,
    ]);
    const transfer = docsFromCsv(CSV_SPECS["Transfer_Order.csv"]!, [
      { "InventoryAdjustment ID": "to9", Date: "2026-11-03", "Transfer Order#": "TO-9", Reason: "Restock Davao", Status: "Transferred", "Item Name": "Doxget 50", SKU: "GM-T1", "Quantity Transferred": "5.00", "From Warehouse Name": "Main", "To Warehouse Name": "Davao" } as Row,
    ]);
    for (const docs of [so, pkg, ship, transfer]) await saveDocs(db, docs, true);
    for (const docs of [pkg, ship]) await linkDocs(db, docs, true);
    const shipments = await json<BookList>(await get("irene", "/api/books/shipment"));
    expect(shipments.rows[0]).toMatchObject({ number: "77", status: "shipped", total: 8000 });
    expect(shipments.rows[0]?.extra).toMatchObject({ so: "SO-9", package: "PKG-9", carrier: "Lalamove", tracking: "LL-1" });
    const packages = await json<BookList>(await get("irene", "/api/books/package?view=shipped"));
    expect(packages.rows[0]?.extra).toMatchObject({ so: "SO-9", qty: 1, carrier: "Lalamove" });
    const shipment = await json<BookDoc>(await get("irene", `/api/books/shipment/${shipments.rows[0]?.id}`));
    expect(shipment.linkedDocs.map((d) => d.kind).sort()).toEqual(["package", "sales_order"]);
    const transfers = await json<BookList>(await get("irene", "/api/books/transfer_order"));
    expect(transfers.rows[0]?.extra).toMatchObject({ from: "Main", to: "Davao", qty: 5, reason: "Restock Davao" });
    // The item's Transactions: every document with it.
    const withIt = await json<BookItem>(await get("irene", `/api/books/items/${ours?.id}`));
    expect(withIt.recent.map((d) => d.kind).sort()).toEqual(["package", "sales_order", "transfer_order"]);
    expect((await get("ryan", "/api/books/items")).status).toBe(403);
  });
});
