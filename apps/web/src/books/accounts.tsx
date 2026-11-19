// Zoho Books' Accountant → Chart of Accounts and Banking (docs/PLAN.md 17), in Zoho's frame: the
// accounts with Zoho's columns plus each one's balance, an account's transactions (what moved on
// it, document by document), and the banks, cash and cards with what is in each. Every figure is
// the documents' own debits and credits.

import type { BookAccountDetail, BookAccountList, BookAccountRow, BookKind, Banking } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Landmark, Plus, Wallet, CreditCard } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { kindInfo, zDate, zMoney } from "./kinds";
import { AccountActiveButton, NewAccountBox, useMayLedger } from "./ledger";

/** This CRM's own documents on an account (its invoices, payments… posted by themselves). */
const CRM_KIND: Record<string, string> = {
  crm_invoice: "Invoice (CRM)",
  crm_payment: "Payment (CRM)",
  crm_refund: "Refund (CRM)",
  crm_return: "Return credited (CRM)",
  crm_stock: "Stock out / back (CRM)",
  crm_sample: "Samples / gifts to reps (CRM)",
};
const CRM_PLURAL: Record<string, string> = {
  crm_invoice: "CRM invoices",
  crm_payment: "CRM payments",
  crm_refund: "CRM refunds",
  crm_return: "CRM returns",
  crm_stock: "CRM stock",
  crm_sample: "CRM samples and gifts",
};

/** "other_current_asset" → "Other Current Asset". */
export const typeLabel = (type: string) => type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const VIEW_LABEL: Record<string, string> = {
  active: "Active Accounts",
  inactive: "Inactive Accounts",
  all: "All Accounts",
  asset: "Asset Accounts",
  liability: "Liability Accounts",
  equity: "Equity Accounts",
  income: "Income Accounts",
  expense: "Expense Accounts",
};
/** A balance as Zoho writes it on an account: the amount and which side, "PHP1,200.00 (Dr)". */
export const sided = (balance: number) => (balance === 0 ? zMoney(0) : `${zMoney(Math.abs(balance))} (${balance > 0 ? "Dr" : "Cr"})`);

export function AccountsPage() {
  const { id } = useParams();
  return id ? <AccountPage id={Number(id)} /> : <ChartOfAccounts />;
}

function ChartOfAccounts() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "active";
  const q = params.get("q") ?? "";
  const query = useQuery({
    queryKey: ["books", "accounts", view, q],
    queryFn: () => api<BookAccountList>(`/api/books/accounts?${new URLSearchParams({ view, ...(q ? { q } : {}) })}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const mayLedger = useMayLedger();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-[#ebeaf2] px-5">
        <label className="mr-auto flex items-center gap-2">
          <span className="sr-only">View</span>
          <select
            value={view}
            onChange={(event) => setParams(event.target.value === "active" ? {} : { view: event.target.value })}
            className="rounded border-0 bg-transparent py-1 pr-7 pl-0 text-[20px] font-medium text-[#212529] focus:ring-0"
          >
            {(data?.views ?? [{ key: "active", count: 0 }]).map((v) => (
              <option key={v.key} value={v.key}>
                {VIEW_LABEL[v.key] ?? v.key} ({v.count})
              </option>
            ))}
          </select>
        </label>
        {mayLedger && (
          <button type="button" onClick={() => setAdding(true)} className="flex h-[32px] items-center gap-1 rounded-[5px] bg-[#408dfb] px-2.5 text-white hover:bg-[#2f7ef0]">
            <Plus size={15} aria-hidden="true" /> New
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {adding && <NewAccountBox onDone={() => setAdding(false)} />}
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-[#ebeaf2] text-[11px] text-[#6c718a] uppercase">
              <th className="py-3 pr-2 pl-5 text-left font-normal">Account Name</th>
              <th className="px-2 py-3 text-left font-normal">Account Code</th>
              <th className="px-2 py-3 text-left font-normal">Account Type</th>
              <th className="px-2 py-3 text-left font-normal">Parent Account Name</th>
              <th className="px-2 py-3 text-right font-normal">Transactions</th>
              <th className="py-3 pr-5 pl-2 text-right font-normal">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((a) => (
              <tr key={a.id} className="border-b border-[#ebeaf2] hover:bg-[#f9f9fb]">
                <td className="py-2.5 pr-2 pl-5">
                  <Link to={`/books/accounts/${a.id}`} className="font-medium text-[#1c5bd9]">
                    {a.name}
                  </Link>
                  {!a.active && <span className="ml-2 text-[11px] text-[#6c718a] uppercase">Inactive</span>}
                </td>
                <td className="px-2 py-2.5 text-[#4b4f63]">{a.code ?? ""}</td>
                <td className="px-2 py-2.5">{typeLabel(a.type)}</td>
                <td className="px-2 py-2.5 text-[#4b4f63]">{a.parent ?? ""}</td>
                <td className="px-2 py-2.5 text-right text-[#4b4f63]">{a.moves ? a.moves.toLocaleString("en-US") : ""}</td>
                <td className="py-2.5 pr-5 pl-2 text-right whitespace-nowrap">{a.moves ? sided(a.balance) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.rows.length && <p className="px-6 py-10 text-center text-[#6c718a]">No accounts in this view.</p>}
        {query.isError && <p className="px-6 py-10 text-center text-[#f76831]">{query.error.message}</p>}
        {query.isPending && <p className="px-6 py-10 text-center text-[#6c718a]">Adding up every account…</p>}
        <p className="px-5 py-4 text-[12px] text-[#6c718a]">
          Balances are what the documents put on each account up to today: payments, expenses, journals, transfers, deposits, refunds, bills and invoices. The old system's cost of goods sold and stock postings are not in its backup, so the stock and cost accounts don't show them.
        </p>
      </div>
    </div>
  );
}

function AccountPage({ id }: { id: number }) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page")) || 1;
  const kind = params.get("kind") ?? "";
  const query = useQuery({
    queryKey: ["books", "account", id, page, kind],
    queryFn: () => api<BookAccountDetail>(`/api/books/accounts/${id}?${new URLSearchParams({ page: String(page), ...(kind ? { kind } : {}) })}`),
    placeholderData: keepPreviousData,
  });
  const a = query.data;
  const mayLedger = useMayLedger();
  if (!a) return <p className="p-6 text-[#6c718a]">{query.isError ? query.error.message : "Loading…"}</p>;
  const last = Math.max(1, Math.ceil(a.total / a.perPage));
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex h-[60px] items-center justify-between border-b border-[#ebeaf2] px-5">
        <div>
          <div className="text-[12px] text-[#6c718a]">{typeLabel(a.type)}</div>
          <h1 className="text-[20px] font-medium text-[#212529]">{a.name}</h1>
        </div>
        <div className="flex items-center gap-3">
        {mayLedger && <AccountActiveButton id={a.id} active={a.active} />}
        <Link to={["bank", "cash", "credit_card", "payment_clearing"].includes(a.type) ? "/books/banking" : "/books/accounts"} className="text-[#1c5bd9]">
          ← {["bank", "cash", "credit_card", "payment_clearing"].includes(a.type) ? "Banking" : "Chart of Accounts"}
        </Link>
        </div>
      </div>
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-8">
          <div>
            <div className="text-[11px] text-[#6c718a] uppercase">Closing Balance</div>
            <div className="text-[22px] font-medium text-[#212529]">{sided(a.balance)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#6c718a] uppercase">Debits</div>
            <div className="text-[16px]">{zMoney(a.debits)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#6c718a] uppercase">Credits</div>
            <div className="text-[16px]">{zMoney(a.credits)}</div>
          </div>
          {a.code && (
            <div>
              <div className="text-[11px] text-[#6c718a] uppercase">Account Code</div>
              <div className="text-[16px]">{a.code}</div>
            </div>
          )}
          {a.parent && (
            <div>
              <div className="text-[11px] text-[#6c718a] uppercase">Parent Account</div>
              <Link to={`/books/accounts/${a.parentId}`} className="text-[16px] text-[#1c5bd9]">
                {a.parent}
              </Link>
            </div>
          )}
        </div>
        {a.description && <p className="text-[#4b4f63]">{a.description}</p>}
        {a.kinds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setParams({})} className={`rounded-full border px-3 py-1 text-[12px] ${!kind ? "border-[#408dfb] bg-[#408dfb] text-white" : "border-[#d7d5e2]"}`}>
              All ({a.kinds.reduce((sum, k) => sum + k.count, 0).toLocaleString("en-US")})
            </button>
            {a.kinds.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => setParams({ kind: k.kind })}
                className={`rounded-full border px-3 py-1 text-[12px] ${kind === k.kind ? "border-[#408dfb] bg-[#408dfb] text-white" : "border-[#d7d5e2]"}`}
              >
                {CRM_PLURAL[k.kind] ?? kindInfo(k.kind as BookKind)?.plural ?? k.kind} ({k.count.toLocaleString("en-US")})
              </button>
            ))}
          </div>
        )}
        <section className="rounded-md border border-[#ebeaf2]">
          <h2 className="border-b border-[#ebeaf2] px-4 py-2 font-medium">Recent Transactions</h2>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-[11px] text-[#6c718a] uppercase">
                <th className="px-4 py-2 text-left font-normal">Date</th>
                <th className="px-2 py-2 text-left font-normal">Transaction Details</th>
                <th className="px-2 py-2 text-left font-normal">Type</th>
                <th className="px-2 py-2 text-right font-normal">Debit</th>
                <th className="px-4 py-2 text-right font-normal">Credit</th>
              </tr>
            </thead>
            <tbody>
              {a.entries.map((e, i) => {
                const info = e.kind.startsWith("crm_") ? undefined : kindInfo(e.kind as BookKind);
                const crm = CRM_KIND[e.kind];
                return (
                  <tr key={`${e.docId}-${i}`} className="border-t border-[#ebeaf2] align-top">
                    <td className="px-4 py-2 whitespace-nowrap">{zDate(e.date)}</td>
                    <td className="px-2 py-2">
                      {info || e.link ? (
                        <Link to={e.link ?? `/books/${info?.path}/${e.docId}`} className="text-[#1c5bd9]">
                          {e.number}
                        </Link>
                      ) : (
                        e.number
                      )}
                      {e.party && <span className="text-[#4b4f63]"> · {e.party}</span>}
                      {e.reference && <div className="text-[11.5px] text-[#6c718a]">Ref: {e.reference}</div>}
                    </td>
                    <td className="px-2 py-2">{crm ?? info?.one ?? e.kind}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{e.debit ? zMoney(e.debit) : ""}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{e.credit ? zMoney(e.credit) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!a.entries.length && <p className="px-4 py-6 text-center text-[#6c718a]">Nothing has moved on this account.</p>}
          {a.total > a.perPage && (
            <div className="flex items-center justify-end gap-2 border-t border-[#ebeaf2] px-4 py-2 text-[12px] text-[#6c718a]">
              {(page - 1) * a.perPage + 1} – {Math.min(page * a.perPage, a.total)} of {a.total.toLocaleString("en-US")}
              <button type="button" aria-label="Newer" disabled={page <= 1} onClick={() => setParams({ ...(kind ? { kind } : {}), page: String(page - 1) })} className="rounded p-1 hover:bg-[#f1f1fa] disabled:opacity-40">
                <ChevronLeft size={16} />
              </button>
              <button type="button" aria-label="Older" disabled={page >= last} onClick={() => setParams({ ...(kind ? { kind } : {}), page: String(page + 1) })} className="rounded p-1 hover:bg-[#f1f1fa] disabled:opacity-40">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const MONEY_ICON = { bank: Landmark, cash: Wallet, card: CreditCard } as const;

export function BankingPage() {
  const query = useQuery({ queryKey: ["books", "banking"], queryFn: () => api<Banking>("/api/books/banking") });
  const data = query.data;
  const card = (label: string, value: number, icon: keyof typeof MONEY_ICON) => {
    const Icon = MONEY_ICON[icon];
    return (
      <div className="flex min-w-[200px] flex-1 items-center gap-3 rounded-md border border-[#ebeaf2] px-4 py-3">
        <Icon size={22} className="text-[#408dfb]" aria-hidden="true" />
        <div>
          <div className="text-[12px] text-[#6c718a]">{label}</div>
          <div className="text-[18px] font-medium text-[#212529]">{zMoney(value)}</div>
        </div>
      </div>
    );
  };
  const row = (a: BookAccountRow) => (
    <tr key={a.id} className="border-b border-[#ebeaf2] hover:bg-[#f9f9fb]">
      <td className="py-2.5 pr-2 pl-5">
        <Link to={`/books/accounts/${a.id}`} className="font-medium text-[#1c5bd9]">
          {a.name}
        </Link>
        {a.code && <div className="text-[11.5px] text-[#6c718a]">{a.code}</div>}
        <div className="mt-0.5 flex gap-3 text-[11.5px]">
          <Link to={`/books/bankstatement?account=${encodeURIComponent(a.name)}`} className="text-[#1c5bd9]">
            Statement
          </Link>
          <Link to={`/books/reconcile?account=${encodeURIComponent(a.name)}`} className="text-[#1c5bd9]">
            Reconcile
          </Link>
        </div>
      </td>
      <td className="px-2 py-2.5">{typeLabel(a.type)}</td>
      <td className="px-2 py-2.5 whitespace-nowrap text-[#4b4f63]">{zDate(a.lastOn)}</td>
      <td className="px-2 py-2.5 text-right text-[#4b4f63]">{a.moves ? a.moves.toLocaleString("en-US") : ""}</td>
      {/* A card shows what is owed on it, as Zoho does. */}
      <td className="py-2.5 pr-5 pl-2 text-right whitespace-nowrap">{zMoney(a.type === "credit_card" ? -a.balance : a.balance)}</td>
    </tr>
  );
  const accounts = data?.accounts ?? [];
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex h-[60px] items-center gap-3 border-b border-[#ebeaf2] px-5">
        <h1 className="text-[20px] font-medium text-[#212529]">Banking Overview</h1>
        <span className="ml-auto flex gap-3 text-[13px]">
          <Link to="/books/transfers" className="text-[#1c5bd9]">
            Transfers
          </Link>
          <Link to="/books/deposits" className="text-[#1c5bd9]">
            Deposits
          </Link>
        </span>
      </div>
      <div className="space-y-5 p-5">
        {query.isError && <p className="text-[#f76831]">{query.error.message}</p>}
        {query.isPending && <p className="text-[#6c718a]">Adding up the banks…</p>}
        {data && (
          <div className="flex flex-wrap gap-3">
            {card("Cash In Hand", data.totals.cash, "cash")}
            {data.totals.clearing !== 0 && card("Payment Clearing", data.totals.clearing, "cash")}
            {card("Bank Balance", data.totals.bank, "bank")}
            {card("Card Balance", data.totals.card, "card")}
          </div>
        )}
        {data && (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-[#ebeaf2] text-[11px] text-[#6c718a] uppercase">
                <th className="py-3 pr-2 pl-5 text-left font-normal">Account Details</th>
                <th className="px-2 py-3 text-left font-normal">Type</th>
                <th className="px-2 py-3 text-left font-normal">Last Transaction</th>
                <th className="px-2 py-3 text-right font-normal">Transactions</th>
                <th className="py-3 pr-5 pl-2 text-right font-normal">Amount in Books</th>
              </tr>
            </thead>
            <tbody>
              {accounts.filter((a) => a.active).map(row)}
              {accounts.some((a) => !a.active) && (
                <tr>
                  <td colSpan={5} className="pt-5 pb-1 pl-5 text-[11px] text-[#6c718a] uppercase">
                    Inactive accounts
                  </td>
                </tr>
              )}
              {accounts.filter((a) => !a.active).map(row)}
            </tbody>
          </table>
          </div>
        )}
        <p className="text-[12px] text-[#6c718a]">
          Amount in Books is what the documents put into and took out of each account up to today: payments (less their bank charges), expenses, transfers, deposits, refunds and journals. Checked on 17 Nov against Zoho Books' own Banking: every account the same to the centavo but for what was entered in Zoho after its backup.
        </p>
      </div>
    </div>
  );
}
