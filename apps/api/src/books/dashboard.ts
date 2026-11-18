// Books → Home, as Zoho Books' Dashboard shows it (read 18 Nov 2026): Total Receivables and Total
// Payables (current and overdue), Cash Flow (cash at the year's start, money in and out month by
// month, cash at its end), Income and Expense month by month, this month's Top Expenses, and every
// bank, cash and card account with its statement lines still to do. All read from the ledger and the
// documents (Zoho's history and the CRM's own together), nothing kept apart.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { todayManila } from "../inventory/rules";
import { duesSql } from "../finance/dues";
import type { BooksDashboard, Me } from "../types";
import { mayReadLedger } from "./accounts";

const MONEY = ["bank", "cash", "credit_card"];

export async function booksDashboard(db: Database, me: Me, asked: { year?: string | null }): Promise<BooksDashboard> {
  mayReadLedger(me);
  const today = todayManila();
  const thisYear = Number(today.slice(0, 4));
  const year = Number(asked.year) >= 2020 && Number(asked.year) <= thisYear ? Number(asked.year) : thisYear;
  const from = `${year}-01-01`;
  const to = year === thisYear ? today : `${year}-12-31`;
  const monthStart = `${today.slice(0, 7)}-01`;

  const [receivable, payable, cashStart, cashMonths, pnl, top, banks] = await Promise.all([
    rows<{ current: number; overdue: number }>(
      db,
      sql`select coalesce(sum(balance) filter (where late <= 0 or on_delivery), 0)::float8 as current,
          coalesce(sum(balance) filter (where late > 0 and not on_delivery), 0)::float8 as overdue
        from ${duesSql(today)} d where d.balance > 0`,
    ),
    rows<{ current: number; overdue: number }>(
      db,
      sql`select coalesce(sum(round(balance * fx_rate)) filter (where coalesce(due_date, doc_date) >= ${today}::date), 0)::float8 as current,
          coalesce(sum(round(balance * fx_rate)) filter (where coalesce(due_date, doc_date) < ${today}::date), 0)::float8 as overdue
        from book_doc where kind = 'bill' and balance > 0 and status not in ('void', 'draft') and voided_at is null`,
    ),
    rows<{ cash: number }>(
      db,
      sql`select coalesce(sum(e.debit - e.credit), 0)::float8 as cash from book_entry e join book_account a on lower(a.name) = lower(e.account)
        where a.type in ('bank', 'cash') and e.on_date < ${from}::date`,
    ),
    rows<{ month: string; incoming: number; outgoing: number }>(
      db,
      sql`select to_char(e.on_date, 'YYYY-MM') as month, sum(e.debit)::float8 as incoming, sum(e.credit)::float8 as outgoing
        from book_entry e join book_account a on lower(a.name) = lower(e.account)
        where a.type in ('bank', 'cash') and e.on_date between ${from}::date and ${to}::date
          and e.kind <> 'transfer_fund'
        group by 1 order by 1`,
    ),
    rows<{ month: string; income: number; expense: number }>(
      db,
      sql`select to_char(e.on_date, 'YYYY-MM') as month,
          coalesce(sum(e.credit - e.debit) filter (where a.type in ('income', 'other_income')), 0)::float8 as income,
          coalesce(sum(e.debit - e.credit) filter (where a.type in ('expense', 'other_expense', 'cost_of_goods_sold')), 0)::float8 as expense
        from book_entry e join book_account a on lower(a.name) = lower(e.account)
        where e.on_date between ${from}::date and ${to}::date and a.type in ('income', 'other_income', 'expense', 'other_expense', 'cost_of_goods_sold')
        group by 1 order by 1`,
    ),
    rows<{ account: string; amount: number }>(
      db,
      sql`select e.account, sum(e.debit - e.credit)::float8 as amount
        from book_entry e join book_account a on lower(a.name) = lower(e.account)
        where a.type in ('expense', 'other_expense') and e.on_date between ${monthStart}::date and ${today}::date
        group by 1 having sum(e.debit - e.credit) > 0 order by 2 desc`,
    ),
    rows<{ id: number; name: string; type: string; balance: number; uncategorized: number }>(
      db,
      sql`select a.id::int as id, a.name, a.type,
          coalesce((select sum(e.debit - e.credit) from book_entry e where lower(e.account) = lower(a.name) and e.on_date <= ${today}::date), 0)::float8 as balance,
          (select count(*) from bank_line l where lower(l.account) = lower(a.name) and l.status = 'uncategorized')::int as uncategorized
        from book_account a where a.active and a.type in (${sql.join(MONEY.map((t) => sql`${t}`), sql`, `)})
        order by uncategorized desc, a.type, lower(a.name)`,
    ),
  ]);

  // Every month of the year, even an empty one.
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, "0")}`;
    if (`${month}-01` > to) break;
    months.push(month);
  }
  let cash = cashStart[0]?.cash ?? 0;
  const flow = months.map((month) => {
    const found = cashMonths.find((one) => one.month === month);
    cash += (found?.incoming ?? 0) - (found?.outgoing ?? 0);
    return { month, incoming: found?.incoming ?? 0, outgoing: found?.outgoing ?? 0, closing: cash };
  });
  const shown = top.slice(0, 5);
  const rest = top.slice(5).reduce((sum, one) => sum + one.amount, 0);
  return {
    today,
    year,
    receivables: { current: receivable[0]?.current ?? 0, overdue: receivable[0]?.overdue ?? 0 },
    payables: { current: payable[0]?.current ?? 0, overdue: payable[0]?.overdue ?? 0 },
    cashFlow: {
      opening: cashStart[0]?.cash ?? 0,
      incoming: flow.reduce((sum, one) => sum + one.incoming, 0),
      outgoing: flow.reduce((sum, one) => sum + one.outgoing, 0),
      closing: cash,
      months: flow,
    },
    incomeExpense: months.map((month) => {
      const found = pnl.find((one) => one.month === month);
      return { month, income: found?.income ?? 0, expense: found?.expense ?? 0 };
    }),
    topExpenses: {
      total: top.reduce((sum, one) => sum + one.amount, 0),
      accounts: [...shown, ...(rest > 0 ? [{ account: "Others", amount: rest }] : [])],
    },
    banks: banks.map((one) => ({ ...one, balance: one.type === "credit_card" ? -one.balance : one.balance })),
  };
}
