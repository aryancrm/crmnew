// Ties the books' history to Zoho Books' own figures, month by month (docs/BOOKS-PLAN.md E).
//
// Zoho's backup holds its documents but not every posting Zoho made by itself (cost of goods sold
// and stock on each invoice and bill, its own split of tax, discount and rounding, the advances it
// keeps on Unearned Revenue). Zoho's trial balance at every month's end since May 2020 (read from
// Zoho Books 18 Nov 2026, read only: .data/zoho-api/trial-balances.json) says what each account held.
// For each month this makes one journal, "ZOHO-TIE-YYYY-MM" on the month's last day, with what Zoho
// posted that the documents here don't: a balance-sheet account by the change in its gap, an income
// or expense account by the month's own difference. After it, every month-end balance and every
// month's profit and loss here are Zoho's to the centavo. The journals are Zoho history (Zoho's id),
// marked as ties; a rerun with newer balances rewrites them, nothing else changes.
//
// Dry run by default (prints the accounts that differ most); --apply writes.
//   TEST_PGLITE_DIR=<a local database>   (the API must be stopped)
//   npx tsx scripts/tie-to-zoho.ts [--apply] [--file .data/zoho-api/trial-balances.json]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";

const ROOT = join(import.meta.dirname, "../../..");
const apply = process.argv.includes("--apply");
const at = process.argv.indexOf("--file");
const file = at > 0 ? (process.argv[at + 1] as string) : join(ROOT, ".data/zoho-api/trial-balances.json");
if (!process.env.TEST_PGLITE_DIR) throw new Error("Give TEST_PGLITE_DIR (a local database); the live database needs Aryan's word.");

type Balances = { ends: string[]; out: Record<string, Record<string, number>>; types: Record<string, string> };
const tb = JSON.parse(readFileSync(file, "utf8")) as Balances;
const db = openDatabase({ dir: process.env.TEST_PGLITE_DIR });
await migrate(db);

const isPnl = (name: string) => ["income", "expense"].includes(tb.types[name] ?? "");
const key = (name: string) => name.trim().toLowerCase();

// Zoho's names as written, and this book's names for the same accounts.
const zohoName = new Map<string, string>();
for (const name of Object.keys(tb.types)) zohoName.set(key(name), name);

// What the documents here put on each account, month by month (the ties themselves left out).
const moved = await rows<{ account: string; month: string; net: number }>(
  db,
  sql`select l.account, to_char(l.on_date, 'YYYY-MM') as month, sum(l.debit - l.credit)::float8 as net
    from book_ledger l join book_doc d on d.id = l.doc_id
    where l.account is not null and coalesce(d.zoho_id, '') not like 'ZOHO-TIE-%' and l.on_date <= ${tb.ends[tb.ends.length - 1]}::date
    group by 1, 2`,
);
const ours = new Map<string, Map<string, number>>(); // account key → month → net
const ourName = new Map<string, string>();
for (const row of moved) {
  const k = key(row.account);
  ourName.set(k, ourName.get(k) ?? row.account);
  const months = ours.get(k) ?? new Map<string, number>();
  months.set(row.month, (months.get(row.month) ?? 0) + row.net);
  ours.set(k, months);
}
const accounts = new Set<string>([...zohoName.keys(), ...ours.keys()]);
const ourPnl = (k: string) => (zohoName.has(k) ? isPnl(zohoName.get(k) as string) : false);

/** Our net on an account over months up to (and including) a month, or just within a month. */
const ourUpTo = (k: string, month: string) => [...(ours.get(k) ?? new Map()).entries()].filter(([m]) => m <= month).reduce((sum, [, n]) => sum + n, 0);
const ourIn = (k: string, month: string) => ours.get(k)?.get(month) ?? 0;

const ties: { end: string; lines: { account: string; amount: number }[] }[] = [];
const totals = new Map<string, number>();
for (const [index, end] of tb.ends.entries()) {
  const month = end.slice(0, 7);
  const before = index > 0 ? (tb.ends[index - 1] as string) : null;
  const now = tb.out[end] ?? {};
  const prev = before ? (tb.out[before] ?? {}) : {};
  const sameYear = before?.slice(0, 4) === end.slice(0, 4);
  const lines: { account: string; amount: number }[] = [];
  for (const k of accounts) {
    const name = zohoName.get(k) ?? (ourName.get(k) as string);
    const zNow = now[zohoName.get(k) ?? ""] ?? 0;
    const zPrev = prev[zohoName.get(k) ?? ""] ?? 0;
    let adjust: number;
    if (ourPnl(k)) {
      // Zoho's income and expense accounts run from January: the month's own movement.
      const zohoMonth = before && sameYear ? zNow - zPrev : zNow;
      adjust = zohoMonth - ourIn(k, month);
    } else {
      const gapNow = zNow - ourUpTo(k, month);
      const gapPrev = before ? zPrev - ourUpTo(k, before.slice(0, 7)) : 0;
      adjust = gapNow - gapPrev;
    }
    adjust = Math.round(adjust);
    if (adjust) {
      lines.push({ account: name, amount: adjust });
      totals.set(name, (totals.get(name) ?? 0) + Math.abs(adjust));
    }
  }
  const rest = lines.reduce((sum, line) => sum + line.amount, 0);
  if (rest) lines.push({ account: "Opening Balance Adjustments", amount: -rest });
  if (lines.length) ties.push({ end, lines });
}

console.log(`${ties.length} months to tie, ${ties.reduce((n, t) => n + t.lines.length, 0)} lines.`);
console.log("Accounts that differ most (sum of the months' adjustments, pesos):");
for (const [name, cents] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${name.padEnd(48)} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

if (apply) {
  await db.transaction(async (tx) => {
    // Every account named exists in the chart.
    for (const name of new Set(ties.flatMap((t) => t.lines.map((l) => l.account)))) {
      const type = { asset: "other_current_asset", liability: "other_current_liability", income: "income", expense: "expense" }[tb.types[name] ?? ""] ?? "other_current_liability";
      await tx.execute(sql`insert into book_account (name, type) values (${name}, ${type}) on conflict (lower(name)) do nothing`);
    }
    for (const tie of ties) {
      const id = `ZOHO-TIE-${tie.end.slice(0, 7)}`;
      const debit = tie.lines.reduce((sum, line) => sum + Math.max(line.amount, 0), 0);
      const notes = `Ties the books to Zoho Books' trial balance on ${tie.end}: Zoho's own postings its backup does not hold (cost of goods sold and stock, its tax split and rounding, advances).`;
      const [doc] = await rows<{ id: number }>(
        tx,
        sql`insert into book_doc (kind, zoho_id, number, doc_date, status, total, notes, fields)
          values ('journal', ${id}, ${id}, ${tie.end}::date, 'published', ${debit}, ${notes}, ${JSON.stringify({ "Journal Type": "Both", "Zoho Tie": "true" })}::jsonb)
          on conflict (kind, zoho_id) where zoho_id is not null do update set doc_date = excluded.doc_date, total = excluded.total, notes = excluded.notes
          returning id::int as id`,
      );
      const docId = doc?.id as number;
      await tx.execute(sql`delete from book_line where doc_id = ${docId}`);
      for (const [n, line] of tie.lines.entries())
        await tx.execute(sql`insert into book_line (doc_id, n, item_name, account, amount) values (${docId}, ${n + 1}, ${line.account}, ${line.account}, ${line.amount})`);
    }
    const [written] = await rows<{ n: number }>(tx, sql`select refresh_book_ledger()::int as n`);
    console.log(`Applied: ${ties.length} tie journals; the ledger rewritten (${written?.n ?? 0} lines).`);
  });
}
process.exit(0);
