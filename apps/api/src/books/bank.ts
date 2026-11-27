// A bank's statement and its reconciliation (docs/BOOKS-PLAN.md C): import the bank's lines, match
// each to what the books already hold or categorize it into a new expense, deposit or transfer, and
// reconcile: tick what cleared up to the statement's last day until the difference is nil.
//
// What the books hold on an account is read from the ledger itself (book_entry): a book document's
// entries are 'books:<doc>', the CRM's own 'crm:<kind>:<id>'. A line is matched to at most one of
// them, so nothing is counted twice.

import { createHash } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import type { BankEntry, BankLineRow, BankReconcileView, BankStatement, BookExpenseInput, Me } from "../types";
import { LEDGER_ROLES } from "./accounts";
import { day } from "./actions";
import { createDeposit, createExpense, createTransfer } from "./write";

const keyOf = sql`case when e.source = 'books' then 'books:' || e.doc_id else 'crm:' || e.kind || ':' || e.doc_id end`;

/** What the books hold on an account, one row per document, between two days. */
function entriesSql(account: string, from: string | null, to: string | null, extra: SQL = sql``): SQL {
  return sql`
    select x.key, x.kind, x."docId", to_char(x.on_date, 'YYYY-MM-DD') as date, x.net::float8 as amount,
      coalesce(d.number, x.number) as number,
      coalesce(d.party_name, c.name, d.notes, d.reference, cp.reference) as party,
      coalesce(d.reference, cp.reference) as reference
    from (
      select ${keyOf} as key, e.source, e.kind, e.doc_id::int as "docId", min(e.on_date) as on_date, sum(e.debit - e.credit) as net, max(e.number) as number, max(e.customer_id) as customer_id
      from book_entry e
      where lower(e.account) = lower(${account}) ${from ? sql`and e.on_date >= ${from}::date` : sql``} ${to ? sql`and e.on_date <= ${to}::date` : sql``}
      group by 1, 2, 3, 4
    ) x
    left join book_doc d on x.source = 'books' and d.id = x."docId"
    left join payment cp on x.source = 'crm' and x.kind = 'crm_payment' and cp.id = x."docId"
    left join customer c on c.id = x.customer_id
    where x.net <> 0 ${extra}`;
}

const normRef = (raw?: string | null) => (raw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const refMatches = (lineRef: string, lineDesc: string, candRef: string): boolean => {
  if (candRef.length < 5) return false;
  if (lineRef && lineRef === candRef) return true;
  if (lineRef.length >= 6 && candRef.length >= 6 && (lineRef.endsWith(candRef.slice(-6)) || candRef.endsWith(lineRef.slice(-6)))) {
    return true;
  }
  return lineDesc.includes(candRef);
};

async function bankAccount(tx: Runner, name: string): Promise<string> {
  const [found] = await rows<{ name: string; type: string }>(tx, sql`select name, type from book_account where lower(name) = lower(${name.trim()})`);
  if (!found || !["bank", "cash", "credit_card", "payment_clearing"].includes(found.type)) throw new Refusal(404, "not_found", "That is not a bank, cash or card account.");
  return found.name;
}

// ------------------------------------------------------------------ the statement

export async function bankStatement(db: Database, me: Me, account: string, asked: { view?: string | null }): Promise<BankStatement> {
  allow(me, LEDGER_ROLES, "see the bank statements");
  const name = await bankAccount(db, account);
  const view = ["matched", "categorized", "excluded", "all"].includes(asked.view ?? "") ? (asked.view as string) : "uncategorized";
  const lines = await rows<BankLineRow>(
    db,
    sql`select l.id::int as id, to_char(l.on_date, 'YYYY-MM-DD') as date, l.description, l.reference, l.amount::float8 as amount, l.status, l.entry_key as "entryKey",
        (select count(*) from bank_cleared c join bank_reconciliation r on r.id = c.reconciliation_id and r.status = 'done' where c.entry_key = l.entry_key)::int > 0 as reconciled,
        (select d.kind from book_doc d where l.entry_key = 'books:' || d.id) as "docKind"
      from bank_line l where lower(l.account) = lower(${name}) ${view === "all" ? sql`` : sql`and l.status = ${view}`}
      order by l.on_date desc, l.id desc limit 500`,
  );
  const counts = await rows<{ status: string; n: number }>(db, sql`select status, count(*)::int as n from bank_line where lower(account) = lower(${name}) group by status`);
  // For each line still to do: what in the books has the same amount, within ten days, not taken yet.
  const open = lines.filter((line) => line.status === "uncategorized");
  if (open.length) {
    const dates = open.map((line) => line.date).sort();
    const from = addDays(dates[0] as string, -10);
    const to = addDays(dates[dates.length - 1] as string, 10);
    const candidates = await rows<BankEntry>(
      db,
      sql`select * from (${entriesSql(name, from, to)}) c
        where not exists (select 1 from bank_line b where b.entry_key = c.key and b.status in ('matched', 'categorized'))`,
    );
    for (const line of open) {
      const lRef = normRef(line.reference);
      const lDesc = normRef(line.description);
      const scored: { entry: BankEntry; tier: number; dayGap: number; feeDiff: number }[] = [];
      for (const c of candidates) {
        if ((c.amount > 0) !== (line.amount > 0)) continue;
        const dayGap = Math.abs(Date.parse(c.date) - Date.parse(line.date));
        if (dayGap > 10 * 86_400_000) continue;
        const cRef = normRef(c.reference);
        const byRef = refMatches(lRef, lDesc, cRef);
        const diff = c.amount - line.amount;
        const maxRefFee = Math.max(50_00, Math.round(Math.abs(c.amount) * 0.1));
        const maxBlindFee = Math.max(50_00, Math.round(Math.abs(c.amount) * 0.05));

        if (byRef && (diff === 0 || (line.amount > 0 && diff > 0 && diff <= maxRefFee))) {
          scored.push({
            entry: { ...c, matchReason: "reference", ...(diff > 0 ? { feeDiff: diff } : {}) },
            tier: 0,
            dayGap,
            feeDiff: Math.abs(diff),
          });
        } else if (diff === 0) {
          scored.push({ entry: { ...c, matchReason: "exact" }, tier: 1, dayGap, feeDiff: 0 });
        } else if (line.amount > 0 && diff > 0 && diff <= maxBlindFee && dayGap <= 5 * 86_400_000) {
          scored.push({ entry: { ...c, matchReason: "fee", feeDiff: diff }, tier: 2, dayGap, feeDiff: diff });
        }
      }
      scored.sort((a, b) => a.tier - b.tier || a.dayGap - b.dayGap || a.feeDiff - b.feeDiff);
      line.suggestions = scored.slice(0, 5).map((s) => s.entry);
    }
  }
  const [booked] = await rows<{ balance: number }>(db, sql`select coalesce(sum(debit - credit), 0)::float8 as balance from book_entry where lower(account) = lower(${name}) and on_date <= ${todayManila()}::date`);
  return {
    account: name,
    view,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    booksBalance: booked?.balance ?? 0,
    lines,
  };
}

const addDays = (on: string, n: number) => new Date(Date.parse(`${on}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type StatementRow = { date: string; description?: string | null; reference?: string | null; amount: number; zohoId?: string | null };

/** A statement's lines into an account; a line already there (the same day, amount, words and
 *  reference) is left as it is, so importing the same file twice adds nothing. */
export async function importStatement(db: Database, me: Me, account: string, input: { fileName?: string | null; rows: StatementRow[] }): Promise<{ added: number; skipped: number }> {
  allow(me, LEDGER_ROLES, "import a bank statement");
  return db.transaction((tx) => addStatementLines(tx, account, input, me.id));
}

/** The lines themselves (also used by the import of Zoho's uncategorized lines). */
export async function addStatementLines(tx: Runner, account: string, input: { fileName?: string | null; rows: StatementRow[] }, by: number | null): Promise<{ added: number; skipped: number }> {
  {
    const name = await bankAccount(tx, account);
    if (!input.rows.length) throw new Refusal(400, "invalid", "The file has no lines.", "rows");
    const [made] = await rows<{ id: number }>(tx, sql`insert into bank_import (account, file_name, by_person) values (${name}, ${input.fileName ?? null}, ${by}) returning id::int as id`);
    let added = 0;
    for (const [at, row] of input.rows.entries()) {
      const date = day(row.date, `rows.${at}.date`) as string;
      if (!Number.isInteger(row.amount) || row.amount === 0) throw new Refusal(400, "invalid", `Line ${at + 1} has no amount.`, `rows.${at}.amount`);
      const fingerprint = createHash("sha1")
        .update([name.toLowerCase(), date, row.amount, (row.description ?? "").trim().toLowerCase(), (row.reference ?? "").trim().toLowerCase(), row.zohoId ?? ""].join("|"))
        .digest("hex");
      const inserted = await rows<{ id: number }>(
        tx,
        sql`insert into bank_line (account, on_date, description, reference, amount, fingerprint, import_id, zoho_id)
          values (${name}, ${date}::date, ${row.description?.trim() || null}, ${row.reference?.trim() || null}, ${row.amount}, ${fingerprint}, ${made?.id ?? null}, ${row.zohoId ?? null})
          on conflict do nothing returning id::int as id`,
      );
      added += inserted.length;
    }
    await tx.execute(sql`update bank_import set lines = ${added} where id = ${made?.id ?? 0}`);
    return { added, skipped: input.rows.length - added };
  }
}

async function openLine(tx: Runner, id: number): Promise<{ id: number; account: string; date: string; amount: number; description: string | null; reference: string | null; status: string }> {
  const [line] = await rows<{ id: number; account: string; date: string; amount: number; description: string | null; reference: string | null; status: string }>(
    tx,
    sql`select id::int as id, account, to_char(on_date, 'YYYY-MM-DD') as date, amount::float8 as amount, description, reference, status from bank_line where id = ${id} for update`,
  );
  if (!line) throw new Refusal(404, "not_found", "That statement line is not here.");
  return line;
}

/** A statement line is what the books already hold: one document's entries on this account, of
 *  the same amount. */
export async function matchLine(db: Database, me: Me, id: number, input: { entryKey: string; recordBankCharge?: boolean }): Promise<void> {
  allow(me, LEDGER_ROLES, "match a statement line");
  await db.transaction(async (tx) => {
    const line = await openLine(tx, id);
    if (line.status !== "uncategorized") throw new Refusal(409, "done", "That line is already done.");
    let [entry] = await rows<BankEntry>(tx, sql`select * from (${entriesSql(line.account, null, null)}) c where c.key = ${input.entryKey}`);
    if (!entry) throw new Refusal(400, "invalid", "That is not on this account.", "entryKey");
    if (entry.amount !== line.amount) {
      const diff = Math.round(entry.amount - line.amount);
      const maxFee = Math.max(50_00, Math.round(Math.abs(entry.amount) * 0.1));
      if (input.recordBankCharge && line.amount > 0 && diff > 0 && diff <= maxFee) {
        if (input.entryKey.startsWith("crm:crm_payment:")) {
          const payId = Number(input.entryKey.slice("crm:crm_payment:".length));
          await tx.execute(sql`update payment set bank_charges = bank_charges + ${diff} where id = ${payId} and active`);
        } else if (input.entryKey.startsWith("books:")) {
          const docId = Number(input.entryKey.slice(6));
          await tx.execute(
            sql`update book_doc set bank_charges = coalesce(bank_charges, 0) + ${diff},
                  fields = fields || jsonb_build_object('Bank Charges', ((coalesce(bank_charges, 0) + ${diff})::numeric / 100)::text)
                where id = ${docId} and kind = 'customer_payment'`,
          );
        }
        [entry] = await rows<BankEntry>(tx, sql`select * from (${entriesSql(line.account, null, null)}) c where c.key = ${input.entryKey}`);
      }
      if (!entry || entry.amount !== line.amount) {
        throw new Refusal(400, "invalid", "The amounts differ.", "entryKey");
      }
    }
    const [taken] = await rows<{ id: number }>(tx, sql`select id::int as id from bank_line where entry_key = ${input.entryKey} and status in ('matched', 'categorized')`);
    if (taken) throw new Refusal(409, "taken", "Another statement line is matched to it.", "entryKey");
    await tx.execute(sql`update bank_line set status = 'matched', entry_key = ${input.entryKey}, done_by = ${me.id}, done_at = now() where id = ${id}`);
  });
}

export type CategorizeInput =
  | { as: "expense"; expense: Omit<BookExpenseInput, "date" | "paidThrough" | "lines"> & { account: string; taxId?: number | null } }
  | { as: "deposit"; from: string; payer?: string | null }
  | { as: "transfer"; other: string };

/** A statement line the books don't hold yet becomes a new expense (money out), a deposit (money
 *  in from another account) or a transfer, on the line's day and amount. */
export async function categorizeLine(db: Database, me: Me, id: number, input: CategorizeInput): Promise<{ docId: number }> {
  allow(me, LEDGER_ROLES, "categorize a statement line");
  const line = await db.transaction((tx) => openLine(tx, id));
  if (line.status !== "uncategorized") throw new Refusal(409, "done", "That line is already done.");
  const words = [line.description, line.reference].filter(Boolean).join(" · ") || null;
  let docId: number;
  if (input.as === "expense") {
    if (line.amount > 0) throw new Refusal(400, "invalid", "Money came in: record it as a deposit, or match the customer's payment.", "as");
    docId = (
      await createExpense(db, me, {
        ...input.expense,
        date: line.date,
        paidThrough: line.account,
        lines: [{ account: input.expense.account, amount: -line.amount, taxId: input.expense.taxId ?? null }],
        reference: input.expense.reference ?? line.reference,
        notes: input.expense.notes ?? words,
      })
    ).id;
  } else if (input.as === "deposit") {
    if (line.amount < 0) throw new Refusal(400, "invalid", "Money went out: record it as an expense or a transfer.", "as");
    docId = (await createDeposit(db, me, { date: line.date, to: line.account, from: input.from, amount: line.amount, reference: line.reference, notes: words, payer: input.payer ?? null })).id;
  } else {
    const out = line.amount < 0;
    docId = (
      await createTransfer(db, me, { date: line.date, from: out ? line.account : input.other, to: out ? input.other : line.account, amount: Math.abs(line.amount), reference: line.reference, notes: words })
    ).id;
  }
  await db.execute(sql`update bank_line set status = 'categorized', entry_key = ${`books:${docId}`}, done_by = ${me.id}, done_at = now() where id = ${id}`);
  return { docId };
}

/** A line set aside (the bank's own duplicate, a line of another account), or put back to do. */
export async function setLineStatus(db: Database, me: Me, id: number, input: { to: "excluded" | "uncategorized" }): Promise<void> {
  allow(me, LEDGER_ROLES, "change a statement line");
  await db.transaction(async (tx) => {
    const line = await openLine(tx, id);
    const [cleared] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from bank_line l join bank_cleared c on c.entry_key = l.entry_key join bank_reconciliation r on r.id = c.reconciliation_id and r.status = 'done' where l.id = ${id}`,
    );
    if (cleared?.n) throw new Refusal(409, "reconciled", "It is in a reconciliation: undo that first.");
    if (input.to === "excluded" && line.status !== "uncategorized") throw new Refusal(409, "done", "Undo its match first.");
    // Undoing a categorized line leaves the document it made: void that document on its own page.
    await tx.execute(sql`update bank_line set status = ${input.to}, entry_key = null, done_by = ${me.id}, done_at = now() where id = ${id}`);
  });
}

// ------------------------------------------------------------------ reconcile

async function lastDone(tx: Runner, account: string): Promise<{ end: string; closing: number } | null> {
  const [last] = await rows<{ end: string; closing: number }>(
    tx,
    sql`select to_char(end_date, 'YYYY-MM-DD') as "end", closing::float8 as closing from bank_reconciliation where lower(account) = lower(${account}) and status = 'done' order by end_date desc, id desc limit 1`,
  );
  return last ?? null;
}

/** What is still to tick up to the statement's last day: every entry on the account not cleared in
 *  a standing reconciliation, the ones the statement matched ticked first. */
export async function reconcileView(db: Database, me: Me, account: string, asked: { end?: string | null }): Promise<BankReconcileView> {
  allow(me, LEDGER_ROLES, "reconcile an account");
  const name = await bankAccount(db, account);
  const end = day(asked.end ?? todayManila(), "end") as string;
  const last = await lastDone(db, name);
  const entries = await rows<BankEntry & { onStatement: boolean }>(
    db,
    sql`select c.*, exists (select 1 from bank_line b where b.entry_key = c.key and b.status in ('matched', 'categorized')) as "onStatement"
      from (${entriesSql(name, null, end)}) c
      where not exists (select 1 from bank_cleared k join bank_reconciliation r on r.id = k.reconciliation_id and r.status = 'done' where k.entry_key = c.key)
      order by c.date, c.key limit 5000`,
  );
  const history = await rows<BankReconcileView["history"][number]>(
    db,
    sql`select r.id::int as id, to_char(r.start_date, 'YYYY-MM-DD') as start, to_char(r.end_date, 'YYYY-MM-DD') as "end", r.opening::float8 as opening, r.closing::float8 as closing,
        r.status, p.name as by, r.at::text as at
      from bank_reconciliation r left join person p on p.id = r.by_person where lower(r.account) = lower(${name}) order by r.end_date desc, r.id desc limit 24`,
  );
  return { account: name, end, start: last ? addDays(last.end, 1) : null, opening: last?.closing ?? 0, entries, history };
}

/** Finishes a reconciliation: the opening plus what was ticked must be the statement's closing. */
export async function finishReconciliation(db: Database, me: Me, account: string, input: { end: string; closing: number; keys: string[] }): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "reconcile an account");
  return db.transaction(async (tx) => {
    const name = await bankAccount(tx, account);
    const end = day(input.end, "end") as string;
    if (end > todayManila()) throw new Refusal(400, "invalid", "The statement's last day can't be after today.", "end");
    const last = await lastDone(tx, name);
    if (last && end <= last.end) throw new Refusal(400, "invalid", `This account is reconciled up to ${last.end}: pick a later day.`, "end");
    const keys = [...new Set(input.keys)];
    const entries = keys.length
      ? await rows<BankEntry>(
          tx,
          sql`select * from (${entriesSql(name, null, end)}) c where c.key in (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
            and not exists (select 1 from bank_cleared k join bank_reconciliation r on r.id = k.reconciliation_id and r.status = 'done' where k.entry_key = c.key)`,
        )
      : [];
    if (entries.length !== keys.length) throw new Refusal(400, "invalid", "Some ticked entries are not on this account up to that day, or are already reconciled.", "keys");
    const opening = last?.closing ?? 0;
    const cleared = opening + entries.reduce((sum, entry) => sum + entry.amount, 0);
    if (cleared !== input.closing)
      throw new Refusal(400, "invalid", `The difference is ${((input.closing - cleared) / 100).toFixed(2)}: tick what cleared until it is 0.00.`, "closing");
    const start = last ? addDays(last.end, 1) : (entries.map((entry) => entry.date).sort()[0] ?? end);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into bank_reconciliation (account, start_date, end_date, opening, closing, by_person) values (${name}, ${start}::date, ${end}::date, ${opening}, ${input.closing}, ${me.id})
        returning id::int as id`,
    );
    for (const entry of entries) await tx.execute(sql`insert into bank_cleared (reconciliation_id, entry_key, amount) values (${made?.id ?? 0}, ${entry.key}, ${entry.amount})`);
    return { id: made?.id as number };
  });
}

/** Undoes an account's latest reconciliation: its entries are open again. */
export async function undoReconciliation(db: Database, me: Me, id: number): Promise<void> {
  allow(me, LEDGER_ROLES, "undo a reconciliation");
  await db.transaction(async (tx) => {
    const [found] = await rows<{ account: string; status: string; end: string }>(tx, sql`select account, status, to_char(end_date, 'YYYY-MM-DD') as "end" from bank_reconciliation where id = ${id} for update`);
    if (!found || found.status !== "done") throw new Refusal(404, "not_found", "That reconciliation is not standing.");
    const last = await lastDone(tx, found.account);
    if (last && last.end !== found.end) throw new Refusal(409, "not_last", "Undo the account's later reconciliations first.");
    await tx.execute(sql`update bank_reconciliation set status = 'undone', undone_by = ${me.id}, undone_at = now() where id = ${id}`);
  });
}

/** Refuses to void or change a book document whose entries are in a standing reconciliation, and
 *  frees the statement line it was matched to when it is voided. */
export async function guardReconciled(tx: Runner, docId: number): Promise<void> {
  const [cleared] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from bank_cleared c join bank_reconciliation r on r.id = c.reconciliation_id and r.status = 'done' where c.entry_key = ${`books:${docId}`}`,
  );
  if (cleared?.n) throw new Refusal(409, "reconciled", "It is in a bank reconciliation: undo that reconciliation first.");
}
export async function freeStatementLine(tx: Runner, docId: number): Promise<void> {
  await tx.execute(sql`update bank_line set status = 'uncategorized', entry_key = null where entry_key = ${`books:${docId}`} and status in ('matched', 'categorized')`);
}
