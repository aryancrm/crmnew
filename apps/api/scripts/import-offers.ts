// Aryan's Christmas offers file (~/Desktop/GetMeds_Christmas_Offers_Team_Price_List_CORRECTED.xlsx)
// into offers (migration 0086): for each SKU and channel — Doctor, Hospital / drugstore,
// Distributor (B2B), Patient (B2C) — its offer: "Buy X Take Y" (free pieces added by the system)
// or "Special price", the customer paying the amount shown for the units shown. A price per piece
// bought that is the buyer's own list price is not kept (their own price runs); another one is.
// "Regular price (no promo)" is skipped. The file says a patient promo on a prescription medicine
// needs Regulatory clearance: those are skipped unless --patient-rx. An offer already running for
// that medicine and buyer in those days is left as it is.
//
// Dry run by default (counts only, dates not needed); --apply writes, with the promo's days.
// A local database with TEST_PGLITE_DIR; the live one needs --live (Aryan's word first).
//   TEST_PGLITE_DIR=../../.data/pg npx tsx scripts/import-offers.ts <file.xlsx> [--from 2026-12-01 --to 2026-12-31 --apply] [--patient-rx]

import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { readXlsx } from "./xlsx";
import { openTarget } from "./zoho-files";

const args = process.argv.slice(2);
const file = args.find((arg) => arg.endsWith(".xlsx"));
const valueOf = (flag: string) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};
const apply = args.includes("--apply");
const patientRx = args.includes("--patient-rx");
const from = valueOf("--from");
const to = valueOf("--to");
const isDay = (value: string | undefined) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
if (!file) throw new Error("Give the offers .xlsx file.");
if (apply && (!isDay(from) || !isDay(to) || (to as string) < (from as string)))
  throw new Error("--apply needs the promo's days: --from YYYY-MM-DD --to YYYY-MM-DD.");
if (!process.env.TEST_PGLITE_DIR && !args.includes("--live"))
  throw new Error("Give TEST_PGLITE_DIR (a local database), or --live for the live one.");

const CHANNELS: [string, string[]][] = [
  ["Doctor", ["doctor"]],
  ["Hospital / drugstore", ["hospital", "drugstore"]],
  ["Distributor (B2B)", ["distributor"]],
  ["Patient (B2C)", ["patient"]],
];

const sheet = readXlsx(file).find((one) => /offers/i.test(one.name)) ?? readXlsx(file)[0];
if (!sheet) throw new Error("No sheet in the file.");
const head = sheet.rows.find((row) => row.cells[0] === "SKU")?.cells ?? [];
const target = await openTarget(false);
if (!target) throw new Error("No database.");
const { db, where } = target;
const medicines = await rows<{ id: number; sku: string; name: string; rx: boolean }>(
  db,
  sql`select id::int as id, lower(sku) as sku, name || coalesce(' ' || strength, '') as name, rx from medicine where active and sku is not null`,
);
const bySku = new Map(medicines.map((one) => [one.sku, one]));
const prices = await rows<{ medicine: number; kind: string; amount: number }>(
  db,
  sql`select medicine_id::int as medicine, buyer_type as kind, amount::int as amount from medicine_price`,
);
const priceOf = (medicine: number, kind: string) =>
  prices.find((one) => one.medicine === medicine && one.kind === kind)?.amount;

const said = { offers: 0, ownPrice: 0, ownPriceDifferent: 0, special: 0, regular: 0, noSku: new Set<string>(), patientRx: 0 };
const toMake: { medicineId: number; kind: string; buy: number; take: number; price: number | null; name: string }[] = [];
for (const row of sheet.rows.filter((one) => /^GM-/i.test(one.cells[0] ?? ""))) {
  const sku = (row.cells[0] ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  const medicine = bySku.get(sku);
  for (const [label, kinds] of CHANNELS) {
    const at = head.indexOf(`${label}: Offer`);
    if (at < 0) continue;
    const offer = (row.cells[at] ?? "").trim();
    const pays = Number(row.cells[at + 1]);
    if (!offer) continue;
    if (/regular price/i.test(offer)) {
      said.regular += 1;
      continue;
    }
    if (!medicine) {
      said.noSku.add(row.cells[0] ?? sku);
      continue;
    }
    const deal = /Buy\s+(\d+)\s+Take\s+(\d+)/i.exec(offer);
    const buy = deal ? Number(deal[1]) : 1;
    const take = deal ? Number(deal[2]) : 0;
    if (!deal && !/special price/i.test(offer)) continue;
    if (kinds.includes("patient") && medicine.rx && !patientRx) {
      said.patientRx += 1;
      continue;
    }
    const perPiece = Number.isFinite(pays) ? Math.round((pays / buy) * 100) : null;
    for (const kind of kinds) {
      const own = priceOf(medicine.id, kind === "drugstore" ? "drugstore" : kind);
      const price = take > 0 && perPiece !== null && own === perPiece ? null : perPiece;
      if (take > 0 && price === null) said.ownPrice += 1;
      else if (take > 0) said.ownPriceDifferent += 1;
      else said.special += 1;
      said.offers += 1;
      toMake.push({
        medicineId: medicine.id,
        kind,
        buy,
        take,
        price,
        name: `Christmas: ${take > 0 ? `Buy ${buy} Take ${take}` : "Special price"}`,
      });
    }
  }
}
console.log(`In ${where}: ${said.offers} offers from ${file}`);
console.log(`  Buy X Take Y at the buyer's own price: ${said.ownPrice}; at the file's own price: ${said.ownPriceDifferent}; special prices: ${said.special}`);
console.log(`  skipped: ${said.regular} regular price, ${said.patientRx} patient offers on a prescription medicine (needs Regulatory clearance; --patient-rx to take them)`);
console.log(`  SKUs not in our list (${said.noSku.size}): ${[...said.noSku].join(", ")}`);
if (!apply) {
  console.log("Dry run: add --from, --to and --apply to write.");
  process.exit(0);
}
const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' order by id limit 1`);
let made = 0;
let kept = 0;
for (const one of toMake) {
  const [overlap] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from offer where medicine_id = ${one.medicineId} and buyer_kind = ${one.kind} and ended_at is null
      and starts_on <= ${to}::date and ends_on >= ${from}::date limit 1`,
  );
  if (overlap) {
    kept += 1;
    continue;
  }
  await db.execute(
    sql`insert into offer (medicine_id, buyer_kind, buy, take, price, name, note, starts_on, ends_on, created_by)
      values (${one.medicineId}, ${one.kind}, ${one.buy}, ${one.take}, ${one.price}, ${one.name}, 'From the Christmas offers file',
        ${from}::date, ${to}::date, ${admin?.id})`,
  );
  made += 1;
}
console.log(`Done: ${made} offers added, ${kept} left as they were (one already runs then).`);
process.exit(0);
