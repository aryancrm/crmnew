import { sql } from "drizzle-orm";
import { LEDGER_ROLES, accountNamed } from "../books/accounts";
import { insertExpenseTx, insertJournalTx } from "../books/write";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, type Runner } from "../inventory/service";
import type { Me, Payslip } from "../types";

export type ReimbursementRow = {
  id: number;
  personId: number;
  personName: string;
  day: string;
  head: string;
  headName: string;
  amount: number;
  note: string | null;
  hasFile: boolean;
  suggestedAccount: string | null;
  reimbursedDocId: number | null;
  reimbursedNumber: string | null;
  reimbursedAt: string | null;
  reimbursedBy: string | null;
};

const DEFAULT_HEAD_ACCOUNTS: Record<string, string[]> = {
  er_per_diem: ["Meals and Entertainment", "Travel Expense", "Per Diem"],
  er_ta: ["Travel Expense", "Transportation Expense"],
  er_car_plan: ["Automobile Expense", "Transportation Expense"],
  er_lodging: ["Lodging", "Travel Expense"],
  er_fuel: ["Fuel and Oil", "Automobile Expense", "Travel Expense"],
  courier: ["Courier and Delivery", "Shipping and Delivery", "Delivery Expense"],
  er_parking: ["Parking and Tolls", "Travel Expense"],
  er_toll: ["Parking and Tolls", "Travel Expense"],
  load: ["Telephone Expense", "Communication Expense"],
};

async function suggestAccount(
  tx: Runner,
  headCode: string,
  headAccount: string | null,
  fallbackExpense: string | null,
): Promise<string | null> {
  if (headAccount) return headAccount;
  const candidates = DEFAULT_HEAD_ACCOUNTS[headCode] ?? [];
  for (const name of candidates) {
    const [found] = await rows<{ name: string }>(
      tx,
      sql`select name from book_account where active and lower(name) = lower(${name}) limit 1`,
    );
    if (found) return found.name;
  }
  return fallbackExpense;
}

export async function reimbursementsList(
  db: Database,
  me: Me,
  view: "open" | "paid" = "open",
): Promise<{
  rows: ReimbursementRow[];
  expenseAccounts: string[];
  paidThroughAccounts: string[];
  defaultExpenseAccount: string | null;
}> {
  allow(me, LEDGER_ROLES, "see reimbursements");
  const [accounts, paidThrough, raw] = await Promise.all([
    rows<{ name: string }>(
      db,
      sql`select name from book_account where active and type in ('expense', 'other_expense', 'cost_of_goods_sold') order by name`,
    ),
    rows<{ name: string }>(
      db,
      sql`select name from book_account where active and type in ('bank', 'cash', 'credit_card', 'payment_clearing', 'other_current_liability') order by name`,
    ),
    rows<Omit<ReimbursementRow, "suggestedAccount"> & { headAccount: string | null }>(
      db,
      sql`select x.id::int as id, p.id::int as "personId", p.name as "personName",
            to_char(x.day, 'YYYY-MM-DD') as day, coalesce(x.head, x.kind) as head,
            coalesce(h.name, initcap(x.kind)) as "headName",
            coalesce(x.approved_amount, x.amount)::float8 as amount,
            x.note, (x.receipt_data is not null or x.receipt_key is not null) as "hasFile",
            h.account_name as "headAccount",
            x.reimbursed_doc_id::int as "reimbursedDocId",
            d.number as "reimbursedNumber",
            to_char(x.reimbursed_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "reimbursedAt",
            rb.name as "reimbursedBy"
          from field_expense x
            join person p on p.id = x.person_id
            left join field_expense_head h on h.code = x.head
            left join book_doc d on d.id = x.reimbursed_doc_id
            left join person rb on rb.id = x.reimbursed_by
          where x.status = 'approved'
            and ${view === "paid" ? sql`x.reimbursed_doc_id is not null` : sql`x.reimbursed_doc_id is null`}
          order by x.day desc, p.name, x.id desc
          limit 500`,
    ),
  ]);
  const expenseAccounts = accounts.map((a) => a.name);
  const fallback = expenseAccounts[0] ?? null;
  const resolved: ReimbursementRow[] = [];
  for (const row of raw) {
    const { headAccount, ...rest } = row;
    resolved.push({
      ...rest,
      suggestedAccount: await suggestAccount(db, row.head, headAccount, fallback),
    });
  }
  return {
    rows: resolved,
    expenseAccounts,
    paidThroughAccounts: paidThrough.map((a) => a.name),
    defaultExpenseAccount: fallback,
  };
}

export async function payReimbursements(
  db: Database,
  me: Me,
  input: {
    ids: number[];
    paidThrough: string;
    accountName: string;
    paidOn?: string | null;
    reference?: string | null;
    note?: string | null;
  },
): Promise<{ docId: number; count: number; total: number }> {
  allow(me, LEDGER_ROLES, "pay reimbursements");
  const ids = [...new Set(input.ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Refusal(400, "invalid", "Pick at least one approved expense to pay.", "ids");
  const paidOn = clean(input.paidOn) ?? todayManila();

  return db.transaction(async (tx) => {
    const paidThrough = await accountNamed(tx, input.paidThrough, "paidThrough", true);
    const expenseAccount = await accountNamed(tx, input.accountName, "accountName");
    const claims = await rows<{
      id: number;
      personName: string;
      day: string;
      head: string;
      headName: string;
      amount: number;
      note: string | null;
      reimbursedDocId: number | null;
    }>(
      tx,
      sql`select x.id::int as id, p.name as "personName", to_char(x.day, 'YYYY-MM-DD') as day,
            coalesce(x.head, x.kind) as head, coalesce(h.name, initcap(x.kind)) as "headName",
            coalesce(x.approved_amount, x.amount)::float8 as amount,
            x.note, x.reimbursed_doc_id::int as "reimbursedDocId"
          from field_expense x
            join person p on p.id = x.person_id
            left join field_expense_head h on h.code = x.head
          where x.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and x.status = 'approved'
          for update of x`,
    );
    if (claims.length !== ids.length)
      throw new Refusal(409, "not_now", "Some of those expenses aren't approved anymore.");
    if (claims.some((c) => c.reimbursedDocId !== null))
      throw new Refusal(409, "already_paid", "Some of those expenses are already reimbursed.");

    const people = [...new Set(claims.map((c) => c.personName))];
    const pic = people.length === 1 ? (people[0] as string) : `${people.length} MedReps`;
    const total = claims.reduce((sum, c) => sum + c.amount, 0);

    const opts = await rows<{ field: string; value: string }>(
      tx,
      sql`select field, value from book_option where active and field in ('Cost Centre', 'Type', 'Department') order by value`,
    );
    const pickOpt = (field: string) => opts.find((o) => o.field === field)?.value ?? "";

    const { id: docId } = await insertExpenseTx(tx, me, {
      date: paidOn,
      paidThrough,
      reference: clean(input.reference),
      pic,
      costCentre: pickOpt("Cost Centre"),
      type: pickOpt("Type"),
      department: pickOpt("Department"),
      notes: clean(input.note) ?? `MedRep field reimbursement (${claims.length} claims)`,
      taxInclusive: false,
      lines: claims.map((c) => ({
        account: expenseAccount,
        description: `${c.personName} · ${c.day} · ${c.headName}${c.note ? ` (${c.note})` : ""}`,
        amount: c.amount,
      })),
      birTax: {
        supplierOrigin: "local",
        vatKind: "exempt",
        purchaseType: "services",
        noWithholdingReason: "exempt_charge",
      },
    });

    await tx.execute(
      sql`update field_expense
          set reimbursed_doc_id = ${docId}, reimbursed_at = now(), reimbursed_by = ${me.id}
          where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
    );
    return { docId, count: claims.length, total };
  });
}

// ------------------------------------------------------------------ HR Payroll -> Books GL

export type PayrollGlRun = {
  month: string;
  releasedAt: string;
  slips: number;
  gross: number;
  employerTotal: number;
  tax: number;
  contributions: number;
  net: number;
  journalDocId: number | null;
  journalNumber: string | null;
};

function summarizeSlips(slips: Payslip[]) {
  let gross = 0;
  let employerTotal = 0;
  let tax = 0;
  let contrib = 0;
  let otherDed = 0;
  let net = 0;
  for (const s of slips) {
    gross += Math.round(s.gross || 0);
    const emp = Math.round(s.employer?.total || 0);
    employerTotal += emp;
    contrib += emp;
    net += Math.round(s.net || 0);
    let slipDed = 0;
    for (const d of s.deductions ?? []) {
      const amt = Math.round(d.amount || 0);
      slipDed += amt;
      if (d.key === "tax") tax += amt;
      else if (["sss", "philhealth", "pagibig"].includes(d.key)) contrib += amt;
      else otherDed += amt;
    }
    const diff = Math.round(s.totalDeductions || 0) - slipDed;
    if (diff !== 0) otherDed += diff;
  }
  return { gross, employerTotal, tax, contributions: contrib, otherDeductions: otherDed, net };
}

export async function payrollGlList(
  db: Database,
  me: Me,
): Promise<{ runs: PayrollGlRun[]; accounts: string[] }> {
  allow(me, LEDGER_ROLES, "see payroll journals");
  const [runsRaw, accts] = await Promise.all([
    rows<{
      id: number;
      month: string;
      releasedAt: string;
      journalDocId: number | null;
      journalNumber: string | null;
    }>(
      db,
      sql`select r.id::int as id, r.month, to_char(r.released_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "releasedAt",
            r.journal_doc_id::int as "journalDocId", d.number as "journalNumber"
          from pay_run r left join book_doc d on d.id = r.journal_doc_id
          order by r.month desc limit 24`,
    ),
    rows<{ name: string }>(db, sql`select name from book_account where active order by name`),
  ]);

  const runs: PayrollGlRun[] = [];
  for (const r of runsRaw) {
    const slipsRaw = await rows<{ slip: Payslip | string }>(
      db,
      sql`select slip from payslip where run_id = ${r.id}`,
    );
    const slips = slipsRaw.map((s) => (typeof s.slip === "string" ? (JSON.parse(s.slip) as Payslip) : s.slip));
    const sum = summarizeSlips(slips);
    runs.push({
      month: r.month,
      releasedAt: r.releasedAt,
      slips: slips.length,
      gross: sum.gross,
      employerTotal: sum.employerTotal,
      tax: sum.tax,
      contributions: sum.contributions,
      net: sum.net,
      journalDocId: r.journalDocId,
      journalNumber: r.journalNumber,
    });
  }
  return { runs, accounts: accts.map((a) => a.name) };
}

export async function postPayrollGl(
  db: Database,
  me: Me,
  month: string,
  input: {
    expenseAccount: string;
    payableAccount: string;
    taxAccount: string;
    contribAccount: string;
    date?: string | null;
  },
): Promise<{ docId: number }> {
  allow(me, LEDGER_ROLES, "post payroll to Books");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Refusal(400, "invalid", "Pick a valid payroll month (YYYY-MM).");

  return db.transaction(async (tx) => {
    const [run] = await rows<{ id: number; journalDocId: number | null; releasedAt: string }>(
      tx,
      sql`select id::int as id, journal_doc_id::int as "journalDocId",
            to_char(released_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as "releasedAt"
          from pay_run where month = ${month} for update`,
    );
    if (!run) throw new Refusal(404, "not_found", `Payroll for ${month} has not been released yet.`);
    if (run.journalDocId !== null)
      throw new Refusal(409, "already_posted", `Payroll for ${month} is already posted to Books.`);

    const slipsRaw = await rows<{ slip: Payslip | string }>(tx, sql`select slip from payslip where run_id = ${run.id}`);
    const slips = slipsRaw.map((s) => (typeof s.slip === "string" ? (JSON.parse(s.slip) as Payslip) : s.slip));
    if (!slips.length) throw new Refusal(409, "empty", `No payslips found for ${month}.`);

    const sum = summarizeSlips(slips);
    const totalDebit = sum.gross + sum.employerTotal;
    if (totalDebit <= 0) throw new Refusal(400, "invalid", "Payroll total must be above zero.");

    const expenseAccount = await accountNamed(tx, input.expenseAccount, "expenseAccount");
    const payableAccount = await accountNamed(tx, input.payableAccount, "payableAccount");
    const taxAccount = await accountNamed(tx, input.taxAccount, "taxAccount");
    const contribAccount = await accountNamed(tx, input.contribAccount, "contribAccount");

    const lines: { account: string; description: string; debit: number; credit: number }[] = [
      { account: expenseAccount, description: `Salaries, allowances & employer share (${month})`, debit: totalDebit, credit: 0 },
    ];
    if (sum.tax > 0) {
      lines.push({ account: taxAccount, description: `Withholding tax 1601-C (${month})`, debit: 0, credit: sum.tax });
    }
    if (sum.contributions > 0) {
      lines.push({ account: contribAccount, description: `SSS, PhilHealth & Pag-IBIG (${month})`, debit: 0, credit: sum.contributions });
    }
    const netPayable = sum.net + sum.otherDeductions;
    if (netPayable > 0) {
      lines.push({ account: payableAccount, description: `Net payroll & deductions (${month})`, debit: 0, credit: netPayable });
    }

    const opts = await rows<{ field: string; value: string }>(
      tx,
      sql`select field, value from book_option where active and field in ('Department', 'Company') order by value`,
    );
    const pickOpt = (field: string) => opts.find((o) => o.field === field)?.value ?? "";

    const { id: docId } = await insertJournalTx(tx, me, {
      date: clean(input.date) ?? run.releasedAt,
      reference: `PAYROLL-${month}`,
      department: pickOpt("Department"),
      company: pickOpt("Company"),
      notes: `Auto-posted payroll for ${month} (${slips.length} payslips)`,
      publish: true,
      lines,
    });
    await tx.execute(sql`update pay_run set journal_doc_id = ${docId} where id = ${run.id}`);
    return { docId };
  });
}
