// Fills a business customer's licence as Zoho kept it — who holds it (CF.License Owner), what it
// is for (CF.LTO Type), the day it was issued (CF.License Issuance Date) — on customers brought
// from Zoho before those were kept (migration 0085). Only empty fields are filled; nothing typed
// in this CRM is changed. Patients are left alone.
//
// Dry run by default; --apply writes. A local database only with TEST_PGLITE_DIR; the live one
// needs --live as well (Aryan's word first).
//   TEST_PGLITE_DIR=../../.data/pg npx tsx scripts/backfill-licence.ts [--apply]

import { sql } from "drizzle-orm";
import { rows } from "../src/db/index";
import { cut, isDay, openTarget, rowsOf, said } from "./zoho-files";

const apply = process.argv.includes("--apply");
if (!process.env.TEST_PGLITE_DIR && !process.argv.includes("--live"))
  throw new Error("Give TEST_PGLITE_DIR (a local database), or --live for the live one.");

const found: { zohoId: string; owner: string | null; type: string | null; issued: string | null }[] = [];
for (const row of rowsOf("Contacts")) {
  if (said(row["Contact Type"]) !== "customer") continue;
  const owner = cut(said(row["CF.License Owner"]), 120) || null;
  const type = cut(said(row["CF.LTO Type"]), 80) || null;
  const issued = said(row["CF.License Issuance Date"]);
  if (!owner && !type && !isDay(issued)) continue;
  found.push({ zohoId: said(row["Contact ID"]), owner, type, issued: isDay(issued) ? issued : null });
}
console.log(`Zoho customers with a licence owner, type or issue day: ${found.length}`);

const target = await openTarget(false);
if (!target) throw new Error("No database.");
const { db, where } = target;
const [would] = await rows<{ customers: number }>(
  db,
  sql`select count(*)::int as customers from customer c
    join jsonb_to_recordset(${JSON.stringify(found)}::jsonb) as x("zohoId" text, owner text, type text, issued text)
      on c.zoho_id = x."zohoId"
    where c.kind <> 'patient' and (
      (c.licence_owner is null and x.owner is not null) or (c.lto_type is null and x.type is not null)
      or (c.licence_issued is null and x.issued is not null))`,
);
console.log(`In ${where}: ${would?.customers ?? 0} customers get a field filled.`);
if (apply) {
  await db.execute(
    sql`update customer c set licence_owner = coalesce(c.licence_owner, x.owner),
        lto_type = coalesce(c.lto_type, x.type), licence_issued = coalesce(c.licence_issued, x.issued::date)
      from jsonb_to_recordset(${JSON.stringify(found)}::jsonb) as x("zohoId" text, owner text, type text, issued text)
      where c.zoho_id = x."zohoId" and c.kind <> 'patient'`,
  );
  console.log("Done.");
} else console.log("Dry run: add --apply to write.");
process.exit(0);
