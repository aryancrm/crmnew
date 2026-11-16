// A little invented history for the demo: orders "from Zoho" for two demo hospitals and a patient,
// so the price history on an order and on a customer has something to show. It goes in the same
// way the real import does.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { importZohoCustomers, importZohoOrders, type ZohoOrder } from "./import";

const line = (sku: string, name: string, qty: number, rate: number) => ({
  sku,
  name,
  unit: "pcs",
  qty,
  rate,
  itemTotal: qty * rate,
  taxPercent: 0,
});
const ANA = (qty: number, rate: number) => line("GM-4410", "AnaGet 1", qty, rate);
const IMA = (qty: number, rate: number) => line("GM-4127", "ImaGet 400", qty, rate);
const LET = (qty: number, rate: number) => line("GM-4402", "LetroGet 2.5", qty, rate);
const CAP = (qty: number, rate: number) => line("GM-4219", "CapeGet 500", qty, rate);
// Not in this CRM's medicine list: it stands under Zoho's own name.
const PAZ = (qty: number, rate: number) => line("GM-4601", "PazoGet 200mg", qty, rate);

const order = (
  no: number,
  customerId: string,
  date: string,
  seller: string,
  lines: ZohoOrder["lines"],
  status = "closed",
): ZohoOrder => ({
  id: `demo-so-${no}`,
  code: `SO-${no}`,
  customerId,
  date,
  status,
  total: lines.reduce((sum, one) => sum + (one.itemTotal ?? 0), 0),
  seller,
  division: seller.split(" | ")[0],
  source: customerId === "demo-c-3" ? "Patient order referred by doctor" : "Hospital PO",
  invoicedFrom: "2mg Incorporated",
  inclusiveTax: true,
  lines,
});

export async function seedDemoPast(db: Database): Promise<boolean> {
  const [have] = await rows<{ n: number }>(db, sql`select count(*)::int as n from past_order`);
  if (have?.n) return false;
  await importZohoCustomers(
    db,
    [
      { id: "demo-c-1", name: "San Juan de Dios Hospital", business: true, city: "Pasay", hint: "hospital" },
      { id: "demo-c-2", name: "Olivarez General Hospital", business: true, city: "Parañaque", hint: "hospital" },
      { id: "demo-c-3", name: "Rosario Santos", business: false, mobile: "0917 555 0142" },
    ],
    true,
  );
  await importZohoOrders(
    db,
    [
      order(58210, "demo-c-1", "2025-03-18", "HOS | Ryan", [ANA(300, 46), IMA(60, 310)]),
      order(60944, "demo-c-1", "2025-09-02", "HOS | Ryan", [ANA(300, 45), LET(120, 82)]),
      order(63377, "demo-c-1", "2026-02-11", "HOS | Ryan", [ANA(600, 44.5), IMA(60, 305), PAZ(30, 445.33)]),
      order(65102, "demo-c-1", "2026-06-24", "HOS | Ryan", [ANA(300, 44.5), ANA(300, 0), CAP(120, 66.8)]),
      order(66480, "demo-c-1", "2026-08-30", "HOS | Ryan", [IMA(60, 305)], "void"),
      order(67227, "demo-c-1", "2026-10-12", "HOS | Ryan", [ANA(600, 44), CAP(36, 66.8), CAP(36, 0), PAZ(30, 445.33), PAZ(30, 0)]),
      order(64015, "demo-c-2", "2026-04-07", "HOS | Ryan", [LET(100, 80.16), LET(100, 0)]),
      order(67810, "demo-c-2", "2026-10-28", "HOS | Ryan", [LET(200, 80.16), ANA(90, 45)]),
      order(66931, "demo-c-3", "2026-09-19", "B2C | Jane", [ANA(30, 50)]),
    ],
    true,
  );
  return true;
}
