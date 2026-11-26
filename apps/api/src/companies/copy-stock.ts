// A new company can start with another's stock (Aryan, 26 Nov 2026: GetMeds and 2MG share one
// stock for now, "just keep the inventory"): its warehouses, medicines with their SKUs and prices,
// and every batch with what is on the shelf today. Nothing else comes across: no orders, invoices,
// money, customers or people. Each piece goes on the new shelf as opening stock (one receipt per
// batch and warehouse, by the new company's Admin), so the shelf and its log agree from day one.
//
// From then on each company's stock is its own: a sale in one never takes a piece off the other's.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { Runner } from "../inventory/service";

/** Copied with their ids, in this order (each after what it points to). */
const TABLES = ["warehouse", "medicine", "medicine_sku", "medicine_price", "batch"] as const;
type Table = (typeof TABLES)[number];

/** What a row may not bring along: the purchase it came in on stays in the other company's books. */
const LEFT_OUT: Partial<Record<Table, string[]>> = { batch: ["purchase_line_id"] };

export type StockCopied = { warehouses: number; medicines: number; batches: number; shelves: number; pieces: number };

/** The columns a row is written with: the table's own, less the computed ones and those left out. */
async function columnsOf(db: Runner, table: Table): Promise<string[]> {
  const found = await rows<{ name: string }>(
    db,
    sql`select column_name as name from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER'
      order by ordinal_position`,
  );
  const out = new Set(LEFT_OUT[table] ?? []);
  return found.map((one) => one.name).filter((name) => !out.has(name));
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** A table's rows, one JSON object each, as Postgres writes them (dates, arrays and all). */
async function rowsOf(db: Runner, table: Table, columns: string[]): Promise<Record<string, unknown>[]> {
  const list = columns.map(quoted).join(", ");
  // The table name comes from TABLES above and the columns from the database itself, never from a
  // request.
  const found = await rows<{ row: Record<string, unknown> }>(
    db,
    sql.raw(`select to_jsonb(t) as row from (select ${list} from ${quoted(table)}) t`), // nosemgrep
  );
  return found.map((one) => (typeof one.row === "string" ? JSON.parse(one.row) : one.row) as Record<string, unknown>);
}

/** Writes rows with their own ids; Postgres turns each JSON value back into the column's type. */
async function write(tx: Runner, table: Table, columns: string[], all: Record<string, unknown>[]): Promise<void> {
  const list = columns.map(quoted).join(", ");
  for (let at = 0; at < all.length; at += 500) {
    const part = JSON.stringify(all.slice(at, at + 500));
    // Table and columns as above; the rows go in as one parameter.
    await tx.execute(
      sql`${sql.raw(`insert into ${quoted(table)} (${list}) overriding system value select ${list} from json_populate_recordset(null::${quoted(table)}, `)}${part}::json)`, // nosemgrep
    );
  }
  // The next id made here comes after the ones copied.
  if (columns.includes("id"))
    await tx.execute(
      sql.raw(`select setval(pg_get_serial_sequence('${table}', 'id'), coalesce((select max(id) from ${quoted(table)}), 0) + 1, false)`), // nosemgrep
    );
}

/**
 * Copies `from`'s stock into `to`, a new company's database with nothing in it yet but its Admin
 * (`by`, who the opening stock is put on the shelf by). Refused if `to` has any medicine already.
 */
export async function copyStock(from: Database, to: Database, by: number, fromName: string): Promise<StockCopied> {
  const [already] = await rows<{ n: number }>(to, sql`select count(*)::int as n from medicine`);
  if ((already?.n ?? 0) > 0) throw new Error("This company has medicines already: its stock isn't copied over them.");

  const copied: Record<Table, Record<string, unknown>[]> = {} as Record<Table, Record<string, unknown>[]>;
  const columns: Record<Table, string[]> = {} as Record<Table, string[]>;
  for (const table of TABLES) {
    columns[table] = await columnsOf(from, table);
    copied[table] = await rowsOf(from, table, columns[table]);
  }
  // Only what is on a shelf today: a shelf at nought or below brings nothing.
  const shelves = await rows<{ batchId: number; warehouseId: number; qty: number }>(
    from,
    sql`select batch_id::int as "batchId", warehouse_id::int as "warehouseId", qty::int as qty
      from stock where qty > 0 order by batch_id, warehouse_id`,
  );
  const medicineOf = new Map(copied.batch.map((one) => [Number(one.id), Number(one.medicine_id)]));
  const today = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" }).format(new Date());

  await to.transaction(async (tx) => {
    for (const table of TABLES) await write(tx, table, columns[table], copied[table]);
    for (const shelf of shelves) {
      await tx.execute(
        sql`insert into stock (batch_id, warehouse_id, qty) values (${shelf.batchId}, ${shelf.warehouseId}, ${shelf.qty})`,
      );
      await tx.execute(
        sql`insert into stock_move (medicine_id, batch_id, warehouse_id, qty, kind, ref, note, by_person)
          values (${medicineOf.get(shelf.batchId) as number}, ${shelf.batchId}, ${shelf.warehouseId}, ${shelf.qty},
            'receive', 'OPENING', ${`Opening stock, copied from ${fromName} on ${today}`}, ${by})`,
      );
    }
  });
  return {
    warehouses: copied.warehouse.length,
    medicines: copied.medicine.length,
    batches: copied.batch.length,
    shelves: shelves.length,
    pieces: shelves.reduce((sum, one) => sum + one.qty, 0),
  };
}
