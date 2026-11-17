// Readies the stock for going live: one warehouse becomes the default (the one Approve picks
// first; Getmeds Philippines Inc., where the stock is), and with --demo-out the stock the demo
// people (…@2mg.test) put on the shelves comes off again. Each piece comes off as a stock count
// with its reason, so the shelf and its log still agree; nothing is deleted. A warehouse left
// with no stock and nothing from Zoho is closed (it stays in the history).
//
// Zoho's stock is never touched: what came in as Zoho's opening stock (ref ZOHO) stays.
// Dry run by default (prints what it would do); --apply writes.
//
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/go-live-stock.ts [--default="Getmeds Philippines Inc."] [--demo-out] [--apply]
//   (the live database only with --live and Aryan's word)

import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { logMove, takeOut } from "../src/inventory/service";
import { openTarget } from "./zoho-files";

const apply = process.argv.includes("--apply");
const demoOut = process.argv.includes("--demo-out");
const defaultName =
  process.argv.find((arg) => arg.startsWith("--default="))?.slice("--default=".length) ??
  "Getmeds Philippines Inc.";
if (!process.env.TEST_PGLITE_DIR && !process.argv.includes("--live")) {
  console.log("Give TEST_PGLITE_DIR (a local database). The live one only with --live, on Aryan's word.");
  process.exit(1);
}

const target = await openTarget(false);
if (!target) process.exit(1);
const { db, where } = target;
console.log(`${apply ? "Changing" : "Dry run on"} ${where}.`);

// 1. The default warehouse.
const [wanted] = await rows<{ id: number; name: string; isDefault: boolean; active: boolean }>(
  db,
  sql`select id::int as id, name, is_default as "isDefault", active from warehouse where lower(name) = lower(${defaultName})`,
);
if (!wanted || !wanted.active) {
  console.log(`No open warehouse named "${defaultName}".`);
  process.exit(1);
}
const [before] = await rows<{ name: string }>(db, sql`select name from warehouse where is_default`);
if (wanted.isDefault) console.log(`Default warehouse: ${wanted.name} already.`);
else {
  console.log(`Default warehouse: ${before?.name ?? "none"} → ${wanted.name}`);
  if (apply)
    await db.transaction(async (tx) => {
      await tx.execute(sql`update warehouse set is_default = false where is_default`);
      await tx.execute(sql`update warehouse set is_default = true where id = ${wanted.id}`);
    });
}

// 2. The demo people's stock.
if (demoOut) {
  const [admin] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'admin' and active order by id limit 1`,
  );
  if (!admin) throw new Error("No admin in this CRM.");
  // What the demo people put on each shelf, net of what they took off it, and what is there now.
  const shelves = await rows<{
    batchId: number;
    medicineId: number;
    warehouseId: number;
    warehouse: string;
    medicine: string;
    demo: number;
    onShelf: number;
  }>(
    db,
    sql`select m.batch_id::int as "batchId", m.medicine_id::int as "medicineId", m.warehouse_id::int as "warehouseId",
          w.name as warehouse, md.name as medicine, sum(m.qty)::int as demo, coalesce(s.qty, 0)::int as "onShelf"
        from stock_move m join person p on p.id = m.by_person
        join warehouse w on w.id = m.warehouse_id join medicine md on md.id = m.medicine_id
        left join stock s on s.batch_id = m.batch_id and s.warehouse_id = m.warehouse_id
        where p.email like '%@2mg.test' and coalesce(m.ref, '') <> 'ZOHO'
        group by 1, 2, 3, 4, 5, s.qty
        having sum(m.qty) > 0 and coalesce(s.qty, 0) > 0
        order by w.name, md.name`,
  );
  const byWarehouse = new Map<string, { lines: number; pieces: number }>();
  for (const shelf of shelves) {
    const qty = Math.min(shelf.demo, shelf.onShelf);
    const sum = byWarehouse.get(shelf.warehouse) ?? { lines: 0, pieces: 0 };
    byWarehouse.set(shelf.warehouse, { lines: sum.lines + 1, pieces: sum.pieces + qty });
    if (!apply) continue;
    await db.transaction(async (tx) => {
      await takeOut(tx, shelf.batchId, shelf.warehouseId, qty);
      await logMove(tx, {
        medicineId: shelf.medicineId,
        batchId: shelf.batchId,
        warehouseId: shelf.warehouseId,
        qty: -qty,
        kind: "count",
        ref: "GO-LIVE",
        note: "Demo stock taken off before going live",
        by: admin.id,
      });
    });
  }
  if (!byWarehouse.size) console.log("Demo stock: none on the shelves.");
  for (const [name, sum] of byWarehouse)
    console.log(`Demo stock off ${name}: ${sum.pieces.toLocaleString("en")} pieces (${sum.lines} batches).`);

  // A warehouse with nothing on it and nothing from Zoho closes; the default never does.
  const empty = await rows<{ id: number; name: string; left: number }>(
    db,
    sql`select w.id::int as id, w.name,
          coalesce((select sum(s.qty) from stock s where s.warehouse_id = w.id), 0)::int as left
        from warehouse w
        where w.active and w.id <> ${wanted.id}
          and not exists (select 1 from stock_move m where m.warehouse_id = w.id and m.ref = 'ZOHO')
          and exists (select 1 from stock_move m join person p on p.id = m.by_person
                      where m.warehouse_id = w.id and p.email like '%@2mg.test')`,
  );
  for (const place of empty) {
    // A dry run hasn't taken the demo stock off yet.
    const remaining = apply ? place.left : place.left - (byWarehouse.get(place.name)?.pieces ?? 0);
    if (remaining > 0) {
      console.log(`${place.name} stays open: ${remaining} pieces on it that the demo people didn't put there.`);
      continue;
    }
    console.log(`${place.name} closes: only the demo people used it.`);
    if (apply) await db.execute(sql`update warehouse set active = false where id = ${place.id}`);
  }
}

if (!apply) console.log("Nothing written. Add --apply to do it.");
process.exit(0);
