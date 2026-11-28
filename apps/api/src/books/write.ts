// Writing the books here, as Zoho Books did (docs/BOOKS-PLAN.md A and B, 18 Nov 2026): an expense,
// a manual journal, a transfer between accounts, a deposit, a credit note and its refund; the
// chart of accounts grows; a period is locked. Each document is one row with its lines, and posts
// itself through the ledger view (book_entry_calc) the moment it exists: nothing is posted twice and
// nothing is posted by hand. Nothing is deleted: a document is voided with a reason.
//
// Who: Finance, the CEO and the Admin (Zoho's admins and accountants). Every write checks the lock
// of its module.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import type {
  AccountInput,
  BookLocks,
  CreditNoteInput,
  CreditRefundInput,
  DepositInput,
  BookExpenseInput,
  JournalInput,
  LedgerChoices,
  LockModule,
  Me,
  TransferInput,
} from "../types";
import { accountNamed, LEDGER_ROLES } from "./accounts";
import { saveDocBirTaxMeta } from "../bir/doc-tax";
import { ownCompanyCode, ownCompanyName } from "../companies/context";
import { day, insertLines, link, linesOf, nextNumber } from "./actions";

const clean = (text?: string | null) => text?.trim() || null;
const MONEY_TYPES = ["bank", "cash", "credit_card", "payment_clearing"];
const LOCK_MODULES: LockModule[] = ["all", "sales", "purchases", "banking", "accountant"];

/** Which module's lock a document falls under (Zoho's four). */
export function moduleOf(kind: string): Exclude<LockModule, "all"> {
  if (["invoice", "customer_payment", "credit_note", "refund", "sales_return", "sales_order"].includes(kind)) return "sales";
  if (["bill", "vendor_payment", "vendor_credit", "purchase_order", "purchase_receive", "expense", "recurring_bill", "recurring_expense"].includes(kind)) return "purchases";
  if (["transfer_fund", "deposit"].includes(kind)) return "banking";
  return "accountant";
}

/** Refuses a write dated on or before its module's lock day (or the whole books' lock). */
export async function assertOpen(tx: Runner, kind: string, date: string): Promise<void> {
  const module = moduleOf(kind);
  const [lock] = await rows<{ module: string; lockDate: string }>(
    tx,
    sql`select module, to_char(lock_date, 'YYYY-MM-DD') as "lockDate" from book_lock
      where module in ('all', ${module}) and lock_date >= ${date}::date order by lock_date desc limit 1`,
  );
  if (lock)
    throw new Refusal(
      409,
      "locked",
      `${lock.module === "all" ? "The books are" : `${module[0]?.toUpperCase()}${module.slice(1)} is`} locked up to ${lock.lockDate}: ask Finance to unlock it first.`,
      "date",
    );
}

async function optionOf(tx: Runner, field: string, value: string | null | undefined, key: string): Promise<string> {
  const wanted = clean(value);
  if (!wanted) throw new Refusal(400, "invalid", `Pick the ${field.toLowerCase()}.`, key);
  const [found] = await rows<{ value: string }>(tx, sql`select value from book_option where field = ${field} and lower(value) = lower(${wanted}) and active`);
  if (!found) throw new Refusal(400, "invalid", `Pick the ${field.toLowerCase()} from the list.`, key);
  return found.value;
}

type Tax = { id: number; name: string; pct: number };
async function taxOf(tx: Runner, id: number | null | undefined, field: string): Promise<Tax | null> {
  if (!id) return null;
  const [tax] = await rows<Tax>(tx, sql`select id::int as id, name, pct::float8 as pct from book_tax where id = ${id} and active`);
  if (!tax) throw new Refusal(400, "invalid", "Pick a tax from the list.", field);
  return tax;
}

/** The next "PREFIX-n" when Zoho's numbers have no padding (EXP-8884, EN-2405). */
async function nextPlain(tx: Runner, kind: string, prefix: string, column: "number" | "entry" = "number"): Promise<string> {
  const source = column === "number" ? sql`number` : sql`fields->>'CF.Entry Number'`;
  const [last] = await rows<{ n: number | null }>(
    tx,
    sql`select max(substring(${source} from ${`^${prefix}(\\d+)$`})::bigint)::float8 as n from book_doc where kind = ${kind} and ${source} ~ ${`^${prefix}\\d+$`}`,
  );
  return `${prefix}${(last?.n ?? 0) + 1}`;
}

type DocRow = {
  kind: string;
  number: string;
  reference?: string | null;
  date: string;
  status: string;
  supplierId?: number | null;
  customerId?: number | null;
  party?: string | null;
  subTotal?: number | null;
  total: number;
  balance?: number;
  notes?: string | null;
  fields: Record<string, unknown>;
  reverseOn?: string | null;
  reversalOf?: number | null;
  by: number;
};
async function insertDoc(tx: Runner, doc: DocRow): Promise<number> {
  const [made] = await rows<{ id: number }>(
    tx,
    sql`insert into book_doc (kind, number, reference, doc_date, status, supplier_id, customer_id, party_name, sub_total, total, balance, notes, fields,
        reverse_on, reversal_of, created_by)
      values (${doc.kind}, ${doc.number}, ${clean(doc.reference)}, ${doc.date}::date, ${doc.status}, ${doc.supplierId ?? null}, ${doc.customerId ?? null},
        ${doc.party ?? null}, ${doc.subTotal ?? null}, ${doc.total}, ${doc.balance ?? 0}, ${clean(doc.notes)}, ${JSON.stringify(doc.fields)}::jsonb,
        ${doc.reverseOn ?? null}::date, ${doc.reversalOf ?? null}, ${doc.by})
      returning id::int as id`,
  );
  if (!made) throw new Error("book_doc insert");
  return made.id;
}

async function plainLine(
  tx: Runner,
  docId: number,
  n: number,
  line: { account: string; description?: string | null; amount: number; taxName?: string | null; taxPct?: number | null; taxAmount?: number; fields?: Record<string, unknown> },
) {
  await tx.execute(
    sql`insert into book_line (doc_id, n, item_name, description, account, tax_name, tax_pct, tax_amount, amount, fields)
      values (${docId}, ${n}, ${line.account}, ${clean(line.description)}, ${line.account}, ${line.taxName ?? null}, ${line.taxPct ?? null},
        ${line.taxAmount || null}, ${line.amount}, ${JSON.stringify(line.fields ?? {})}::jsonb)`,
  );
}

// ------------------------------------------------------------------ the forms' choices

/** Zoho's choices that name a company (Cost Centre GetMEDS0001 / 2MG0001 / Cenevo0001, Company
 *  Getmeds / 2MG) came into every company's database. Since the separation each database is one
 *  company, so its forms offer only its own (Aryan, 27 Nov). Earlier documents keep what they say. */
const OWN_COMPANY_FIELDS = ["Cost Centre", "Company"];
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
export function ownCompanysOnly(values: string[], names: string[] = [ownCompanyName(), ownCompanyCode()]): string[] {
  const own = names.map(plain).filter(Boolean);
  const mine = values.filter((value) => {
    // "2MG0001" → "2mg", "GetMEDS0001" → "getmeds", "Getmeds" → "getmeds".
    const head = plain(value).replace(/\d+$/, "");
    return head.length >= 2 && own.some((name) => name.startsWith(head));
  });
  // A company none of them names (a new one) keeps the list rather than an empty, unsaveable form.
  return mine.length ? mine : values;
}

export async function ledgerChoices(db: Database, me: Me): Promise<LedgerChoices> {
  allow(me, LEDGER_ROLES, "write the books");
  const [accounts, taxes, options, people, vendors, expense, journal, transfer, deposit, creditNote, refund, locks] = await Promise.all([
    rows<LedgerChoices["accounts"][number]>(
      db,
      sql`select a.id::int as id, a.name, a.code, a.type, p.name as parent from book_account a left join book_account p on p.id = a.parent_id
        where a.active order by a.type, lower(a.name)`,
    ),
    rows<LedgerChoices["taxes"][number]>(db, sql`select id::int as id, name, pct::float8 as pct, kind from book_tax where active order by kind, pct, name`),
    rows<{ field: string; value: string }>(db, sql`select field, value from book_option where active order by field, sort, value`),
    rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where active order by lower(name)`),
    rows<{ id: number; name: string }>(db, sql`select id::int as id, name from supplier where active order by lower(name)`),
    nextPlain(db, "expense", "EXP-"),
    nextPlain(db, "journal", "EN-", "entry"),
    nextNumber(db, "transfer_fund", "TRF-", 4),
    nextNumber(db, "deposit", "DEP-", 4),
    nextNumber(db, "credit_note", "CN-", 5),
    nextNumber(db, "refund", "RF-", 5),
    rows<{ module: LockModule; lockDate: string }>(db, sql`select module, to_char(lock_date, 'YYYY-MM-DD') as "lockDate" from book_lock order by module`),
  ]);
  const grouped: Record<string, string[]> = {};
  for (const { field, value } of options) (grouped[field] ??= []).push(value);
  for (const field of OWN_COMPANY_FIELDS) if (grouped[field]) grouped[field] = ownCompanysOnly(grouped[field]);
  return {
    today: todayManila(),
    accounts,
    moneyAccounts: accounts
      .filter((a) => MONEY_TYPES.includes(a.type) || ["Employee Reimbursements", "Undeposited Funds"].includes(a.name))
      .map((a) => ({ name: a.name, type: a.type })),
    taxes,
    options: grouped,
    people,
    vendors,
    next: { expense, journal, transfer, deposit, creditNote, refund },
    locks,
  };
}

// ------------------------------------------------------------------ expense

/** An expense (Zoho's Record Expense): one or more accounts, paid through a bank, cash, card or an
 *  employee (Employee Reimbursements), with Zoho's own fields. Its tax goes to Tax Payable. */
export async function createExpense(db: Database, me: Me, input: BookExpenseInput): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "record an expense");
  return db.transaction((tx) => insertExpenseTx(tx, me, input));
}

export async function insertExpenseTx(tx: Runner, me: Me, input: BookExpenseInput): Promise<{ id: number }> {
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "expense", date);
    if (!input.lines?.length) throw new Refusal(400, "invalid", "Add the expense account and amount.", "lines");
    const paidThrough = await accountNamed(tx, input.paidThrough, "paidThrough", true);
    const fields: Record<string, unknown> = {
      "Paid Through": paidThrough,
      "Is Inclusive Tax": input.taxInclusive ? "true" : "false",
      "CF.Cost Centre": await optionOf(tx, "Cost Centre", input.costCentre, "costCentre"),
      "CF.Type": await optionOf(tx, "Type", input.type, "type"),
      "CF.Department": await optionOf(tx, "Department", input.department, "department"),
    };
    const pic = clean(input.pic);
    if (!pic) throw new Refusal(400, "invalid", "Say who is in charge (PIC).", "pic");
    fields["CF.PIC"] = pic;
    if (clean(input.voucher)) fields["CF.Voucher"] = clean(input.voucher);
    if (clean(input.orNumber)) fields["CF.OR Number"] = clean(input.orNumber);
    let supplier: { id: number; name: string } | undefined;
    if (input.supplierId) {
      [supplier] = await rows<{ id: number; name: string }>(tx, sql`select id::int as id, name from supplier where id = ${input.supplierId}`);
      if (!supplier) throw new Refusal(400, "invalid", "Pick the vendor from the list.", "supplierId");
    }
    let customer: { id: number; name: string } | undefined;
    if (input.customerId) {
      [customer] = await rows<{ id: number; name: string }>(tx, sql`select id::int as id, name from customer where id = ${input.customerId}`);
      if (!customer) throw new Refusal(400, "invalid", "Pick the customer from the list.", "customerId");
      fields["Customer Name"] = customer.name;
    }
    const lines: { account: string; description: string | null; amount: number; tax: Tax | null; taxAmount: number }[] = [];
    for (const [at, line] of input.lines.entries()) {
      const account = await accountNamed(tx, line.account, `lines.${at}.account`);
      if (!Number.isInteger(line.amount) || line.amount <= 0) throw new Refusal(400, "invalid", "Type the amount.", `lines.${at}.amount`);
      const tax = await taxOf(tx, line.taxId, `lines.${at}.taxId`);
      // Inclusive: the tax is inside the amount (₱13,000 with RENT 5% holds ₱619.05); exclusive: on top.
      const taxAmount = tax ? Math.round(input.taxInclusive ? (line.amount * tax.pct) / (100 + tax.pct) : (line.amount * tax.pct) / 100) : 0;
      lines.push({ account, description: clean(line.description), amount: line.amount, tax, taxAmount });
    }
    const subTotal = lines.reduce((sum, line) => sum + line.amount - (input.taxInclusive ? line.taxAmount : 0), 0);
    const total = lines.reduce((sum, line) => sum + line.amount + (input.taxInclusive ? 0 : line.taxAmount), 0);
    fields["Expense Account"] = lines[0]?.account;
    if (lines[0]?.tax) fields["Tax Name"] = lines[0].tax.name;
    const number = await nextPlain(tx, "expense", "EXP-");
    fields["Entry Number"] = number.slice(4);
    const id = await insertDoc(tx, {
      kind: "expense",
      number,
      reference: input.reference,
      date,
      status: "nonbillable",
      supplierId: supplier?.id,
      customerId: customer?.id,
      party: supplier?.name ?? null,
      subTotal,
      total,
      notes: input.notes,
      fields,
      by: me.id,
    });
    for (const [n, line] of lines.entries())
      await plainLine(tx, id, n + 1, { account: line.account, description: line.description, amount: line.amount, taxName: line.tax?.name, taxPct: line.tax?.pct, taxAmount: line.taxAmount });
    await saveDocBirTaxMeta(tx, me, id, { kind: "expense", totalCentavos: total, subTotalCentavos: subTotal, fxRate: 1, partyName: supplier?.name ?? null }, input.birTax);
    return { id };
}

// ------------------------------------------------------------------ manual journal

/** A manual journal: debits equal credits, every line on an account of the chart; a draft posts
 *  nothing until it is published; a reverse date makes the opposite journal on that day. */
export async function createJournal(db: Database, me: Me, input: JournalInput): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "make a journal");
  return db.transaction((tx) => insertJournalTx(tx, me, input));
}

export async function insertJournalTx(tx: Runner, me: Me, input: JournalInput): Promise<{ id: number }> {
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "journal", date);
    const reverseOn = day(input.reverseOn, "reverseOn", false);
    if (reverseOn && reverseOn <= date) throw new Refusal(400, "invalid", "The reverse date comes after the journal's date.", "reverseOn");
    const notes = clean(input.notes);
    if (!notes) throw new Refusal(400, "invalid", "Say what the journal is for.", "notes");
    const fields: Record<string, unknown> = {
      "CF.Department": await optionOf(tx, "Department", input.department, "department"),
      "CF.Company": await optionOf(tx, "Company", input.company, "company"),
      "Journal Type": "Both",
    };
    if (clean(input.pic)) fields["CF.PIC"] = clean(input.pic);
    const lines = input.lines.filter((line) => line.debit || line.credit);
    const typedDebit = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
    const typedCredit = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
    if (typedDebit !== typedCredit)
      throw new Refusal(400, "invalid", `Debits (${(typedDebit / 100).toFixed(2)}) and credits (${(typedCredit / 100).toFixed(2)}) must be equal.`, "lines");
    if (lines.length < 2) throw new Refusal(400, "invalid", "A journal needs at least two lines.", "lines");
    const made: { account: string; description: string | null; contact: string | null; amount: number; tax: Tax | null; taxAmount: number }[] = [];
    for (const [at, line] of lines.entries()) {
      const account = await accountNamed(tx, line.account, `lines.${at}.account`);
      if (line.debit && line.credit) throw new Refusal(400, "invalid", "A line is either a debit or a credit.", `lines.${at}.debit`);
      const amount = line.debit ? line.debit : -line.credit;
      if (!Number.isInteger(amount) || amount === 0 || (line.debit ?? 0) < 0 || (line.credit ?? 0) < 0)
        throw new Refusal(400, "invalid", "Type the amount.", `lines.${at}.debit`);
      const tax = await taxOf(tx, line.taxId, `lines.${at}.taxId`);
      made.push({ account, description: clean(line.description), contact: clean(line.contact), amount, tax, taxAmount: tax ? Math.round((Math.abs(amount) * tax.pct) / 100) : 0 });
    }
    // Each side with its tax (a line's tax sits on Tax Payable on the line's side).
    const debit = made.reduce((sum, line) => sum + (line.amount > 0 ? line.amount + line.taxAmount : 0), 0);
    const credit = made.reduce((sum, line) => sum + (line.amount < 0 ? -line.amount + line.taxAmount : 0), 0);
    if (debit !== credit) throw new Refusal(400, "invalid", `Debits (${(debit / 100).toFixed(2)}) and credits (${(credit / 100).toFixed(2)}) must be equal.`, "lines");
    const entry = await nextPlain(tx, "journal", "EN-", "entry");
    fields["CF.Entry Number"] = entry;
    const number = clean(input.number) ?? entry;
    const [taken] = await rows<{ id: number }>(tx, sql`select id::int as id from book_doc where kind = 'journal' and number = ${number}`);
    if (taken) throw new Refusal(409, "taken", `Journal ${number} is already in the books.`, "number");
    fields["Journal Number"] = number;
    const status = input.publish ? "published" : "draft";
    const id = await insertDoc(tx, { kind: "journal", number, reference: input.reference, date, status, total: debit, notes, fields, reverseOn, by: me.id });
    for (const [n, line] of made.entries())
      await plainLine(tx, id, n + 1, {
        account: line.account,
        description: line.description,
        amount: line.amount,
        taxName: line.tax?.name,
        taxPct: line.tax?.pct,
        taxAmount: line.taxAmount,
        fields: line.contact ? { Contact: line.contact } : {},
      });
    if (input.publish && reverseOn) await reverseJournal(tx, me, id, reverseOn);
    return { id };
}

/** The opposite of a journal, on its reverse date, pointing back at it. */
async function reverseJournal(tx: Runner, me: Me, id: number, on: string): Promise<void> {
  const [doc] = await rows<{ number: string; total: number; fields: Record<string, unknown> }>(
    tx,
    sql`select number, total::bigint::float8 as total, fields from book_doc where id = ${id}`,
  );
  if (!doc) return;
  const entry = await nextPlain(tx, "journal", "EN-", "entry");
  const reversal = await insertDoc(tx, {
    kind: "journal",
    number: `${doc.number}-R`,
    reference: doc.number,
    date: on,
    status: "published",
    total: doc.total,
    notes: `Reversal of journal ${doc.number}`,
    fields: { ...doc.fields, "CF.Entry Number": entry, "Journal Number": `${doc.number}-R` },
    reversalOf: id,
    by: me.id,
  });
  await tx.execute(
    sql`insert into book_line (doc_id, n, item_name, description, account, tax_name, tax_pct, tax_amount, amount, fields)
      select ${reversal}, n, item_name, description, account, tax_name, tax_pct, tax_amount, -amount, fields from book_line where doc_id = ${id}`,
  );
}

/** A draft journal published: from now it counts (and its reversal is made, if it has a day). */
export async function publishJournal(db: Database, me: Me, id: number): Promise<void> {
  allow(me, LEDGER_ROLES, "publish a journal");
  await db.transaction(async (tx) => {
    const [doc] = await rows<{ status: string; date: string; reverseOn: string | null }>(
      tx,
      sql`select status, to_char(doc_date, 'YYYY-MM-DD') as date, to_char(reverse_on, 'YYYY-MM-DD') as "reverseOn" from book_doc where id = ${id} and kind = 'journal' for update`,
    );
    if (!doc) throw new Refusal(404, "not_found", "That journal is not in the books.");
    if (doc.status !== "draft") throw new Refusal(409, "not_draft", "Only a draft is published.");
    await assertOpen(tx, "journal", doc.date);
    await tx.execute(sql`update book_doc set status = 'published' where id = ${id}`);
    if (doc.reverseOn) await reverseJournal(tx, me, id, doc.reverseOn);
  });
}

// ------------------------------------------------------------------ transfer and deposit

/** Money moved from one bank, cash or card account to another. */
export async function createTransfer(db: Database, me: Me, input: TransferInput): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "move money between accounts");
  return db.transaction(async (tx) => {
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "transfer_fund", date);
    const from = await accountNamed(tx, input.from, "from", true);
    const to = await accountNamed(tx, input.to, "to", true);
    if (from === to) throw new Refusal(400, "invalid", "Pick two different accounts.", "to");
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Refusal(400, "invalid", "Type the amount.", "amount");
    const number = await nextNumber(tx, "transfer_fund", "TRF-", 4);
    const id = await insertDoc(tx, {
      kind: "transfer_fund",
      number,
      reference: input.reference,
      date,
      status: "posted",
      total: input.amount,
      notes: input.notes,
      fields: { "From Account": from, "To Account": to, "Transaction Type": "Transfer Fund" },
      by: me.id,
    });
    return { id };
  });
}

/** Money into a bank from somewhere that is not a customer: other income, interest, the owner's
 *  contribution (an income or equity account). */
export async function createDeposit(db: Database, me: Me, input: DepositInput): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "record a deposit");
  return db.transaction(async (tx) => {
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "deposit", date);
    const to = await accountNamed(tx, input.to, "to", true);
    const from = await accountNamed(tx, input.from, "from");
    if (from === to) throw new Refusal(400, "invalid", "Pick two different accounts.", "from");
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Refusal(400, "invalid", "Type the amount.", "amount");
    const number = await nextNumber(tx, "deposit", "DEP-", 4);
    const id = await insertDoc(tx, {
      kind: "deposit",
      number,
      reference: input.reference,
      date,
      status: "posted",
      party: clean(input.payer),
      total: input.amount,
      notes: input.notes,
      fields: { "From Account": from, "To Account": to, "Transaction Type": "Deposit" },
      by: me.id,
    });
    return { id };
  });
}

// ------------------------------------------------------------------ credit note and refund

/** A credit note for a customer (a price corrected, goods taken back outside the order line): what
 *  they no longer owe. It is put on their invoices, used on a CRM invoice as their credit, or
 *  refunded. */
export async function createCreditNote(db: Database, me: Me, input: CreditNoteInput): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "make a credit note");
  return db.transaction(async (tx) => {
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "credit_note", date);
    const [customer] = await rows<{ id: number; name: string }>(tx, sql`select id::int as id, name from customer where id = ${input.customerId}`);
    if (!customer) throw new Refusal(400, "invalid", "Pick the customer.", "customerId");
    const reason = clean(input.reason);
    if (!reason) throw new Refusal(400, "invalid", "Say why the customer is credited.", "reason");
    const typed = [];
    for (const [at, line] of input.lines.entries()) {
      const tax = await taxOf(tx, line.taxId, `lines.${at}.taxId`);
      typed.push({ ...line, account: line.account ? await accountNamed(tx, line.account, `lines.${at}.account`) : "Sales", taxPct: tax?.pct ?? null, tax });
    }
    const lines = await linesOf(tx, typed);
    for (const [at, line] of lines.entries()) line.account = typed[at]?.account ?? "Sales";
    const subTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const total = subTotal + lines.reduce((sum, line) => sum + line.taxAmount, 0);
    const number = await nextNumber(tx, "credit_note", "CN-", 5);
    const id = await insertDoc(tx, {
      kind: "credit_note",
      number,
      reference: input.reference,
      date,
      status: "open",
      customerId: customer.id,
      party: customer.name,
      subTotal,
      total,
      balance: total,
      notes: input.notes,
      fields: { Reason: reason, "Accounts Receivable": "Accounts Receivable" },
      by: me.id,
    });
    await insertLines(tx, id, lines);
    return { id };
  });
}

/** Money given back to a customer from a credit note's (or a payment's) unused amount, out of a bank. */
export async function refundCredit(db: Database, me: Me, id: number, input: CreditRefundInput): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "refund a customer");
  return db.transaction(async (tx) => {
    const [credit] = await rows<{ id: number; kind: string; number: string; customerId: number; party: string; balance: number; status: string }>(
      tx,
      sql`select id::int as id, kind, number, customer_id::int as "customerId", party_name as party, balance::bigint::float8 as balance, status
        from book_doc where id = ${id} and kind in ('credit_note', 'customer_payment') for update`,
    );
    if (!credit || credit.status === "void") throw new Refusal(404, "not_found", "That credit is not in the books.");
    const date = day(input.date, "date") as string;
    await assertOpen(tx, "refund", date);
    // What is left is also what the order line has not used of it (a Zoho credit note used on a CRM invoice).
    const [used] = await rows<{ used: number }>(tx, sql`select coalesce(sum(amount), 0)::float8 as used from payment where active and credit_doc_id = ${id}`);
    const left = credit.balance - (used?.used ?? 0);
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Refusal(400, "invalid", "Type the amount refunded.", "amount");
    if (input.amount > left) throw new Refusal(400, "invalid", `At most ${(left / 100).toFixed(2)} is left to refund.`, "amount");
    const from = await accountNamed(tx, input.from, "from", true);
    const number = await nextNumber(tx, "refund", "RF-", 5);
    const refund = await insertDoc(tx, {
      kind: "refund",
      number,
      reference: input.reference,
      date,
      status: "posted",
      customerId: credit.customerId,
      party: credit.party,
      total: input.amount,
      notes: input.notes,
      fields: {
        "Refund From Account": from,
        ...(clean(input.mode) ? { "Mode of Refund": clean(input.mode) } : {}),
        ...(credit.kind === "credit_note" ? { "Credit Note Number": credit.number } : { "Payment Number": credit.number }),
      },
      by: me.id,
    });
    await link(tx, refund, credit.id, input.amount, date);
    const balance = credit.balance - input.amount;
    await tx.execute(
      sql`update book_doc set balance = ${balance}, status = ${credit.kind === "credit_note" ? (balance <= 0 ? "closed" : "open") : credit.status} where id = ${credit.id}`,
    );
    return { id: refund };
  });
}

// ------------------------------------------------------------------ chart of accounts

const ACCOUNT_TYPES = [
  "bank", "cash", "credit_card", "payment_clearing", "accounts_receivable", "other_current_asset", "stock", "fixed_asset", "other_asset",
  "accounts_payable", "other_current_liability", "other_liability", "long_term_liability", "equity",
  "income", "other_income", "expense", "other_expense", "cost_of_goods_sold",
];

export async function createAccount(db: Database, me: Me, input: AccountInput): Promise<{ id: number }> {
  allow(me, LEDGER_ROLES, "add an account");
  const name = clean(input.name);
  if (!name) throw new Refusal(400, "invalid", "Type the account's name.", "name");
  if (!ACCOUNT_TYPES.includes(input.type)) throw new Refusal(400, "invalid", "Pick the account type.", "type");
  return db.transaction(async (tx) => {
    const [taken] = await rows<{ id: number }>(tx, sql`select id::int as id from book_account where lower(name) = lower(${name})`);
    if (taken) throw new Refusal(409, "taken", `${name} is already in the chart.`, "name");
    if (input.parentId) {
      const [parent] = await rows<{ type: string }>(tx, sql`select type from book_account where id = ${input.parentId}`);
      if (!parent) throw new Refusal(400, "invalid", "Pick the parent account from the chart.", "parentId");
      if (parent.type !== input.type) throw new Refusal(400, "invalid", "A sub-account has its parent's type.", "parentId");
    }
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into book_account (name, code, type, parent_id, description, created_by, created_at)
        values (${name}, ${clean(input.code)}, ${input.type}, ${input.parentId ?? null}, ${clean(input.description)}, ${me.id}, now())
        returning id::int as id`,
    );
    return { id: made?.id as number };
  });
}

/** Changes an account: code, description and parent any time; the name only while nothing is on
 *  it (documents name their accounts); inactive keeps its history but takes it out of the forms. */
export async function updateAccount(db: Database, me: Me, id: number, input: Partial<AccountInput> & { active?: boolean }): Promise<void> {
  allow(me, LEDGER_ROLES, "change an account");
  await db.transaction(async (tx) => {
    const [account] = await rows<{ name: string; type: string }>(tx, sql`select name, type from book_account where id = ${id} for update`);
    if (!account) throw new Refusal(404, "not_found", "That account is not in the chart.");
    const name = clean(input.name);
    if (name && name !== account.name) {
      const [used] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from book_entry where lower(account) = lower(${account.name})`);
      if (used?.n) throw new Refusal(409, "in_use", `${account.name} has ${used.n} entries: its name stays (make a new account instead).`, "name");
      const [taken] = await rows<{ id: number }>(tx, sql`select id::int as id from book_account where lower(name) = lower(${name}) and id <> ${id}`);
      if (taken) throw new Refusal(409, "taken", `${name} is already in the chart.`, "name");
      await tx.execute(sql`update book_account set name = ${name} where id = ${id}`);
    }
    if (input.code !== undefined) await tx.execute(sql`update book_account set code = ${clean(input.code)} where id = ${id}`);
    if (input.description !== undefined) await tx.execute(sql`update book_account set description = ${clean(input.description)} where id = ${id}`);
    if (input.parentId !== undefined) {
      if (input.parentId === id) throw new Refusal(400, "invalid", "An account is not its own parent.", "parentId");
      await tx.execute(sql`update book_account set parent_id = ${input.parentId ?? null} where id = ${id}`);
    }
    if (input.active !== undefined) await tx.execute(sql`update book_account set active = ${input.active} where id = ${id}`);
  });
}

// ------------------------------------------------------------------ transaction locking

export async function bookLocks(db: Database, me: Me): Promise<BookLocks> {
  allow(me, LEDGER_ROLES, "see the locks");
  const [locks, log] = await Promise.all([
    rows<BookLocks["locks"][number]>(
      db,
      sql`select l.module, to_char(l.lock_date, 'YYYY-MM-DD') as "lockDate", l.reason, p.name as by, l.locked_at::text as at
        from book_lock l left join person p on p.id = l.locked_by order by l.module`,
    ),
    rows<BookLocks["log"][number]>(
      db,
      sql`select e.module, e.action, to_char(e.lock_date, 'YYYY-MM-DD') as "lockDate", e.reason, p.name as by, e.at::text as at
        from book_lock_event e left join person p on p.id = e.by_person order by e.at desc limit 50`,
    ),
  ]);
  return { locks, log };
}

export async function setLock(db: Database, me: Me, module: string, input: { lockDate: string; reason?: string | null }): Promise<void> {
  allow(me, LEDGER_ROLES, "lock the books");
  if (!LOCK_MODULES.includes(module as LockModule)) throw new Refusal(404, "not_found", "No such module.");
  const date = day(input.lockDate, "lockDate") as string;
  if (date > todayManila()) throw new Refusal(400, "invalid", "Lock up to today at most.", "lockDate");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into book_lock (module, lock_date, reason, locked_by) values (${module}, ${date}::date, ${clean(input.reason)}, ${me.id})
        on conflict (module) do update set lock_date = excluded.lock_date, reason = excluded.reason, locked_by = excluded.locked_by, locked_at = now()`,
    );
    await tx.execute(sql`insert into book_lock_event (module, action, lock_date, reason, by_person) values (${module}, 'lock', ${date}::date, ${clean(input.reason)}, ${me.id})`);
  });
}

export async function unlock(db: Database, me: Me, module: string, input: { reason: string }): Promise<void> {
  allow(me, LEDGER_ROLES, "unlock the books");
  const reason = clean(input.reason);
  if (!reason) throw new Refusal(400, "invalid", "Say why it is unlocked.", "reason");
  await db.transaction(async (tx) => {
    const [gone] = await rows<{ module: string }>(tx, sql`delete from book_lock where module = ${module} returning module`);
    if (!gone) throw new Refusal(404, "not_found", "That module is not locked.");
    await tx.execute(sql`insert into book_lock_event (module, action, reason, by_person) values (${module}, 'unlock', ${reason}, ${me.id})`);
  });
}
