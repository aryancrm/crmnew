// Zoho Books' Accountant and Banking (docs/PLAN.md 17): the chart of accounts with each account's
// balance, one account's transactions, and the banks, cash and cards with what is in each. Every
// figure is read from the documents' own debits and credits (book_entry), so it agrees with them.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Runner } from "../inventory/service";
import type { BookAccountDetail, BookAccountList, BookAccountRow, Banking, Me, Role } from "../types";

/** Money in the banks and the books' accounts: Finance, the CEO and the Admin. */
export const LEDGER_ROLES: readonly Role[] = ["finance", "ceo", "admin"];
export const mayReadLedger = (me: Me) => allow(me, LEDGER_ROLES, "see the accounts");

/** Zoho's account types under the five heads Zoho's chart groups them by. */
export const ACCOUNT_HEADS: Record<string, string[]> = {
  asset: ["bank", "cash", "accounts_receivable", "other_current_asset", "fixed_asset", "other_asset", "stock", "payment_clearing", "input_tax", "intangible_asset", "non_current_asset", "deferred_tax_asset"],
  liability: ["credit_card", "accounts_payable", "other_current_liability", "long_term_liability", "other_liability", "output_tax", "non_current_liability", "deferred_tax_liability", "overseas_tax_payable"],
  equity: ["equity"],
  income: ["income", "other_income"],
  expense: ["expense", "cost_of_goods_sold", "other_expense"],
};
export const MONEY_TYPES = ["bank", "cash", "credit_card", "payment_clearing"];
/** Not a bank, but money goes "through" them: what the company owes a person, cash not yet banked. */
export const MONEY_LIKE = ["Employee Reimbursements", "Undeposited Funds"];

/** An account by name, as the chart has it; money accounts must be bank, cash or card. Every form
 *  that names an account asks here, so the books never post to a name the chart doesn't have
 *  (bills, payments and receipts too since 27 Nov, Aryan's yes). */
export async function accountNamed(tx: Runner, name: string | null | undefined, field: string, money = false): Promise<string> {
  const wanted = name?.trim();
  if (!wanted) throw new Refusal(400, "invalid", money ? "Pick the account the money went through." : "Pick an account.", field);
  const [found] = await rows<{ name: string; type: string; active: boolean }>(
    tx,
    sql`select name, type, active from book_account where lower(name) = lower(${wanted}) order by active desc limit 1`,
  );
  if (!found) throw new Refusal(400, "invalid", `"${wanted}" is not in the chart of accounts: pick one from the list, or add it to the chart first.`, field);
  if (!found.active) throw new Refusal(400, "invalid", `${found.name} is inactive.`, field);
  if (money && !MONEY_TYPES.includes(found.type) && !MONEY_LIKE.includes(found.name))
    throw new Refusal(400, "invalid", `${found.name} is not a bank, cash or card account.`, field);
  return found.name;
}

/** Each account's movements up to today, once: debits, credits, how many and the last day. A
 *  document dated ahead (next year's rent journals) counts on its day, as in Zoho. */
const totals = (asOf?: string) => sql`(select lower(account) as key, sum(debit)::bigint as debit, sum(credit)::bigint as credit, count(*)::int as n, max(on_date) as last
    from book_entry where account is not null and on_date <= ${asOf ?? todayManila()}::date group by 1)`;

const accountSelect = (asOf?: string) => sql`select a.id::int as id, a.name, a.code, a.type, p.name as parent, a.parent_id::int as "parentId", a.active,
    coalesce(t.debit - t.credit, 0)::float8 as balance, coalesce(t.debit, 0)::float8 as debits, coalesce(t.credit, 0)::float8 as credits,
    coalesce(t.n, 0)::int as moves, to_char(t.last, 'YYYY-MM-DD') as "lastOn"
  from book_account a left join book_account p on p.id = a.parent_id left join ${totals(asOf)} t on t.key = lower(a.name)`;

export async function accountList(db: Database, me: Me, asked: { view?: string; q?: string; asOf?: string }): Promise<BookAccountList> {
  mayReadLedger(me);
  // Balances as they stood at the end of a day (Zoho's "as of"), today unless asked.
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asked.asOf ?? "") ? asked.asOf : undefined;
  const all = await rows<BookAccountRow>(db, sql`${accountSelect(asOf)} order by a.type, lower(a.name)`);
  const headOf = (type: string) => Object.entries(ACCOUNT_HEADS).find(([, types]) => types.includes(type))?.[0] ?? "asset";
  const views = [
    { key: "active", count: all.filter((a) => a.active).length },
    { key: "inactive", count: all.filter((a) => !a.active).length },
    { key: "all", count: all.length },
    ...Object.keys(ACCOUNT_HEADS).map((head) => ({ key: head, count: all.filter((a) => a.active && headOf(a.type) === head).length })),
  ];
  const view = views.some((v) => v.key === asked.view) ? (asked.view as string) : "active";
  const q = asked.q?.trim().toLowerCase();
  const shown = all.filter(
    (a) =>
      (view === "all" || (view === "inactive" ? !a.active : a.active && (view === "active" || headOf(a.type) === view))) &&
      (!q || a.name.toLowerCase().includes(q) || (a.code ?? "").toLowerCase().includes(q)),
  );
  return { views, view, rows: shown.map((a) => ({ ...a, head: headOf(a.type) })) };
}

export async function accountDetail(db: Database, me: Me, id: number, asked: { page?: number; perPage?: number; kind?: string }): Promise<BookAccountDetail> {
  mayReadLedger(me);
  const [account] = await rows<BookAccountRow & { description: string | null; currency: string; fields: Record<string, unknown> }>(
    db,
    sql`select x.*, a.description, a.currency, a.fields from (${accountSelect()} where a.id = ${id}) x join book_account a on a.id = x.id`,
  );
  if (!account) throw new Refusal(404, "not_found", "That account is not in the chart.");
  const perPage = [25, 50, 100, 200].includes(asked.perPage ?? 0) ? (asked.perPage as number) : 50;
  const page = Math.max(1, asked.page ?? 1);
  const kindFilter = asked.kind ? sql`and e.kind = ${asked.kind}` : sql``;
  const [kinds, counted, entries] = await Promise.all([
    rows<BookAccountDetail["kinds"][number]>(
      db,
      sql`select e.kind, count(*)::int as count, sum(e.debit)::float8 as debit, sum(e.credit)::float8 as credit
        from book_entry e where lower(e.account) = lower(${account.name}) group by 1 order by 2 desc`,
    ),
    rows<{ n: number }>(db, sql`select count(*)::int as n from book_entry e where lower(e.account) = lower(${account.name}) ${kindFilter}`),
    rows<BookAccountDetail["entries"][number]>(
      db,
      sql`select e.doc_id::int as "docId", e.kind, coalesce(d.number, e.number) as number, to_char(e.on_date, 'YYYY-MM-DD') as date, d.reference,
          coalesce(s.name, c.name, d.party_name) as party, e.debit::float8 as debit, e.credit::float8 as credit, e.link
        from book_entry e left join book_doc d on d.id = e.doc_id and e.source = 'books' left join supplier s on s.id = d.supplier_id
          left join customer c on c.id = coalesce(d.customer_id, e.customer_id)
        where lower(e.account) = lower(${account.name}) ${kindFilter}
        order by e.on_date desc, e.doc_id desc limit ${perPage} offset ${(page - 1) * perPage}`,
    ),
  ]);
  return { ...account, kinds, page, perPage, total: counted[0]?.n ?? 0, entries };
}

/** Banking, as Zoho's: every bank, cash and card account with what is in it now. */
export async function banking(db: Database, me: Me): Promise<Banking> {
  mayReadLedger(me);
  const accounts = await rows<BookAccountRow>(
    db,
    sql`${accountSelect()} where a.type in (${sql.join(MONEY_TYPES.map((t) => sql`${t}`), sql`, `)})
      order by a.active desc, case a.type when 'bank' then 0 when 'cash' then 1 when 'payment_clearing' then 2 else 3 end, lower(a.name)`,
  );
  const sum = (types: string[]) => accounts.filter((a) => a.active && types.includes(a.type)).reduce((total, a) => total + a.balance, 0);
  // A card is owed money: Zoho shows what was spent on it less what was paid, below zero.
  return { accounts, totals: { bank: sum(["bank"]), cash: sum(["cash"]), clearing: sum(["payment_clearing"]), card: -sum(["credit_card"]) } };
}
