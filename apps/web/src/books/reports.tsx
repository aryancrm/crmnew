// Books → Reports (docs/ERP-PLAN.md phase 1): the statements, drawn as Zoho Books draws its own
// reports (a title, the company, the period, then the table), each with its days, an account that
// opens its transactions, Print and Export CSV. Read from the same debits and credits as the chart.

import type {
  BalanceSheet,
  Insight,
  CashFlow,
  GrossProfit,
  PayablesAging,
  ProfitAndLoss,
  StatementLine,
  TrialBalance,
  VatSummary,
} from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { EmptyState } from "../no-results";
import { zDate, zMoney } from "./kinds";

type Report = {
  key: string;
  title: string;
  about: string;
  group: string;
  days: "range" | "asOf" | "none";
  /** One of the old CRM's insight reports (its own API and the desks it serves). */
  insight?: boolean;
  /** Who opens it; none: the books' money desks (Finance, the CEO, the Admin). */
  roles?: string[];
  /** Ways to group it ("By supplier", "By item"…). */
  by?: { key: string; label: string }[];
};
const SALES = ["ceo", "admin", "management", "finance"];
const STOCK = [...SALES, "inventory"];
export const REPORTS: Report[] = [
  {
    key: "customers",
    title: "Customers",
    about: "Every customer who ever bought, every kind: channel, who looks after them, bought in the days, this year, all time, owes now, last bought.",
    group: "Customers & channels",
    days: "range",
    insight: true,
    roles: SALES,
    by: [
      { key: "all", label: "All kinds" },
      { key: "hospital", label: "Hospitals" },
      { key: "doctor", label: "Doctors" },
      { key: "patient", label: "Patients" },
      { key: "drugstore", label: "Drugstores" },
      { key: "distributor", label: "Distributors" },
      { key: "government", label: "Government" },
    ],
  },
  {
    key: "channels",
    title: "Channels",
    about: "How many channels, and each one's people, customers, sales in the days and this year, and what its customers owe.",
    group: "Customers & channels",
    days: "range",
    insight: true,
    roles: SALES,
  },
  { key: "profit-and-loss", title: "Profit and Loss", about: "Income, cost of goods, expenses and the profit, with the days before beside it.", group: "Business Overview", days: "range" },
  { key: "balance-sheet", title: "Balance Sheet", about: "What the business holds, owes and is worth on a day.", group: "Business Overview", days: "asOf" },
  { key: "cash-flow", title: "Cash Flow", about: "Money in and out of every bank, cash and e-wallet account, and what moved it.", group: "Business Overview", days: "range" },
  { key: "gross-profit", title: "Gross Profit", about: "The CRM's orders: sale less VAT, less the batches' cost, by medicine, channel, customer or order.", group: "Sales", days: "range" },
  { key: "payables-aging", title: "Payables Aging", about: "Unpaid bills by supplier and by how late they are.", group: "Payables", days: "none" },
  { key: "vat", title: "VAT Summary", about: "Output VAT on sales, input VAT on bills and expenses, tax withheld (2307), month by month.", group: "Taxes", days: "range" },
  { key: "trial-balance", title: "Trial Balance", about: "Every account's balance on a day; debits equal credits.", group: "Accountant", days: "asOf" },
  { key: "sales-trend", title: "Sales by Channel, Month by Month", about: "Six months of billing (the old system's and the CRM's) by channel, to the day picked.", group: "Sales", days: "range", insight: true, roles: SALES },
  { key: "sales-by-branch", title: "Sales by Branch, Month by Month", about: "Six months of billing by warehouse (Main, Cebu, Davao…).", group: "Sales", days: "range", insight: true, roles: SALES },
  { key: "top-medicines", title: "Top Medicines", about: "What sold most in these days, against the same number of days before.", group: "Sales", days: "range", insight: true, roles: SALES },
  { key: "sales-by-person-medicine", title: "Sales by Salesperson and Medicine", about: "Who sold which medicine, how many and for how much, with what came back (the old system's Sales Person item Sale).", group: "Sales", days: "range", insight: true, roles: SALES },
  { key: "sales-by-city", title: "Sales by City", about: "What was sold into each city, by the customer's city (the old system's City Sale).", group: "Sales", days: "range", insight: true, roles: SALES },
  { key: "abc", title: "ABC Classes", about: "The last 12 months' sales by medicine: A the first 80%, B the next 15%, C the rest.", group: "Sales", days: "none", insight: true, roles: SALES },
  { key: "senior-pwd", title: "Senior Citizen and PWD Sales", about: "Lines sold with the relief, the ID on file and the relief given: for the BIR.", group: "Taxes", days: "range", insight: true, roles: SALES },
  { key: "stock-aging", title: "Stock by Age and Expiry", about: "Every batch on a shelf: days held, expiry, value at cost.", group: "Inventory", days: "none", insight: true, roles: STOCK },
  { key: "stock-turnover", title: "Days of Stock Left", about: "On hand against the last 90 days' sales: how long each medicine lasts.", group: "Inventory", days: "none", insight: true, roles: STOCK },
  {
    key: "purchases",
    title: "Purchases",
    about: "Bills in these days, by supplier or by item.",
    group: "Payables",
    days: "range",
    insight: true,
    roles: ["ceo", "admin", "finance", "inventory"],
    by: [
      { key: "supplier", label: "By supplier" },
      { key: "item", label: "By item" },
    ],
  },
  {
    key: "cases",
    title: "Online Cases",
    about: "Cases opened, how many became an order, by source or by person.",
    group: "Sales",
    days: "range",
    insight: true,
    roles: [...SALES, "online"],
    by: [
      { key: "source", label: "By source" },
      { key: "person", label: "By person" },
    ],
  },
  // Zoho Books' own reports Finance used (docs/BOOKS-PLAN.md D).
  { key: "general-ledger", title: "General Ledger", about: "Every account's opening, debits, credits and closing for the days picked.", group: "Accountant", days: "range", insight: true },
  { key: "journal-report", title: "Journal Report", about: "Each document's debits and credits, account by account, in order.", group: "Accountant", days: "range", insight: true },
  { key: "ar-aging", title: "AR Aging Summary", about: "What each customer owes by how late it is: current, 1-15, 16-30, 31-45, over 45 days.", group: "Receivables", days: "asOf", insight: true },
  { key: "ar-aging-details", title: "AR Aging Details", about: "Every unpaid invoice with its age, the latest first.", group: "Receivables", days: "asOf", insight: true },
  { key: "customer-balances", title: "Customer Balance Summary", about: "What each customer owes and the credit they hold.", group: "Receivables", days: "asOf", insight: true },
  { key: "payments-received", title: "Payments Received", about: "Money received from customers, the CRM's and the old system's, with where it went.", group: "Receivables", days: "range", insight: true },
  { key: "credit-notes", title: "Credit Note Details", about: "Credit notes, what each credited and what is left of it.", group: "Receivables", days: "range", insight: true },
  { key: "sales-by-customer", title: "Sales by Customer", about: "What each customer was invoiced in these days.", group: "Sales", days: "range", insight: true, roles: SALES },
  { key: "vendor-balances", title: "Vendor Balance Summary", about: "What the company owes each vendor, and the credit it holds with them.", group: "Payables", days: "none", insight: true },
  { key: "payments-made", title: "Payments Made", about: "Money paid to vendors, with the bills it paid.", group: "Payables", days: "range", insight: true },
  {
    key: "expenses",
    title: "Expenses",
    about: "Expense details, or by account, department, PIC, cost centre or the account paid from.",
    group: "Purchases and Expenses",
    days: "range",
    insight: true,
    by: [
      { key: "details", label: "Details" },
      { key: "category", label: "By account" },
      { key: "department", label: "By department" },
      { key: "pic", label: "By PIC" },
      { key: "cost-centre", label: "By cost centre" },
      { key: "paid-through", label: "By paid through" },
    ],
  },
];
/** The reports this role opens. */
export const reportsFor = (role: string) => REPORTS.filter((one) => (one.roles ?? ["finance", "ceo", "admin"]).includes(role));

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
function presets(): { label: string; from: string; to: string }[] {
  const now = today();
  const y = Number(now.slice(0, 4));
  const m = Number(now.slice(5, 7));
  const monthStart = `${now.slice(0, 7)}-01`;
  const lastEnd = shift(monthStart, -1);
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return [
    { label: "This Month", from: monthStart, to: now },
    { label: "Last Month", from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd },
    { label: "This Quarter", from: `${y}-${String(q).padStart(2, "0")}-01`, to: now },
    { label: "This Year", from: `${y}-01-01`, to: now },
    { label: "Last Year", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

/** A table as numbers: the CSV a person opens in Excel. */
function downloadCsv(name: string, head: string[], body: (string | number)[][]) {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [head, ...body].map((row) => row.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
const pesos = (centavos: number) => (centavos / 100).toFixed(2);

export function ReportsPage() {
  const { report } = useParams();
  const found = REPORTS.find((one) => one.key === report);
  return found ? <ReportPage report={found} /> : <ReportsIndex />;
}

function ReportsIndex() {
  const me = useMe();
  const shown = reportsFor(me.data?.role ?? "");
  const groups = [...new Set(shown.map((one) => one.group))];
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-[#ebeaf2] px-6 py-4">
        <h1 className="text-[20px] font-normal">Reports</h1>
        <p className="text-[#6c718a]">Read live from the books: the old system's history and every invoice, payment, refund, return and delivery made in the CRM.</p>
      </div>
      <div className="grid gap-6 px-6 py-5 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <section key={group}>
            <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-[#6c718a] uppercase">{group}</h2>
            <ul className="space-y-1">
              {shown.filter((one) => one.group === group).map((one) => (
                <li key={one.key}>
                  <Link to={`/books/reports/${one.key}`} className="text-[14px] text-[#1c5bd9] hover:underline">
                    {one.title}
                  </Link>
                  <div className="text-[12px] text-[#6c718a]">{one.about}</div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ReportPage({ report }: { report: Report }) {
  const [params, setParams] = useSearchParams();
  const range = presets()[0] as { from: string; to: string };
  const from = params.get("from") ?? range.from;
  const to = params.get("to") ?? range.to;
  const asOf = params.get("asOf") ?? today();
  const by = params.get("by") ?? (report.by?.[0]?.key ?? "medicine");
  const qs = new URLSearchParams({
    ...(report.days === "range" ? { from, to } : report.days === "asOf" ? (report.insight ? { to: asOf } : { asOf }) : {}),
    ...(report.key === "gross-profit" || report.by ? { by } : {}),
  });
  const query = useQuery({
    queryKey: ["books", "reports", report.key, qs.toString()],
    queryFn: () => api<unknown>(`/api/books/${report.insight ? "insights" : "reports"}/${report.key}?${qs}`),
    placeholderData: keepPreviousData,
  });
  const set = (next: Record<string, string>) =>
    setParams((now) => {
      const out = new URLSearchParams(now);
      for (const [key, value] of Object.entries(next)) out.set(key, value);
      return out;
    });
  const period =
    report.days === "range" ? `From ${zDate(from)} To ${zDate(to)}` : report.days === "asOf" ? `As of ${zDate(asOf)}` : `As of ${zDate(today())}`;
  const table = query.data ? (report.insight ? insightTable(query.data as Insight) : tableOf(report.key, query.data)) : null;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#ebeaf2] px-5 py-3 print:hidden">
        <Link to="/books/reports" className="flex items-center gap-1 text-[#1c5bd9]">
          <ChevronLeft size={14} /> Reports
        </Link>
        {report.days === "range" && (
          <>
            <select
              className="h-8 rounded border border-[#d7d5e2] px-2"
              value={presets().find((one) => one.from === from && one.to === to)?.label ?? "Custom"}
              onChange={(event) => {
                const pick = presets().find((one) => one.label === event.target.value);
                if (pick) set({ from: pick.from, to: pick.to });
              }}
            >
              {presets().map((one) => (
                <option key={one.label}>{one.label}</option>
              ))}
              <option>Custom</option>
            </select>
            <input type="date" className="h-8 rounded border border-[#d7d5e2] px-2" value={from} max={to} onChange={(event) => event.target.value && set({ from: event.target.value })} aria-label="From" />
            <span>to</span>
            <input type="date" className="h-8 rounded border border-[#d7d5e2] px-2" value={to} min={from} onChange={(event) => event.target.value && set({ to: event.target.value })} aria-label="To" />
          </>
        )}
        {report.days === "asOf" && (
          <label className="flex items-center gap-2">
            As of
            <input type="date" className="h-8 rounded border border-[#d7d5e2] px-2" value={asOf} onChange={(event) => event.target.value && set({ asOf: event.target.value })} />
          </label>
        )}
        {report.by && (
          <div className="flex overflow-hidden rounded border border-[#d7d5e2]">
            {report.by.map((one) => (
              <button key={one.key} type="button" onClick={() => set({ by: one.key })} className={`px-3 py-1 ${by === one.key ? "bg-[#408dfb] text-white" : "hover:bg-[#f4f6fb]"}`}>
                {one.label}
              </button>
            ))}
          </div>
        )}
        {report.key === "gross-profit" && (
          <div className="flex overflow-hidden rounded border border-[#d7d5e2]">
            {(["medicine", "channel", "customer", "order", "branch"] as const).map((one) => (
              <button
                key={one}
                type="button"
                onClick={() => set({ by: one })}
                className={`px-3 py-1 capitalize ${by === one ? "bg-[#408dfb] text-white" : "hover:bg-[#f4f6fb]"}`}
              >
                By {one}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => window.print()} className="flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] px-3 hover:bg-[#f4f6fb]">
            <Printer size={14} /> Print
          </button>
          <button
            type="button"
            disabled={!table}
            onClick={() => table && downloadCsv(`${report.key}-${report.days === "asOf" ? asOf : `${from}-to-${to}`}`, table.csvHead, table.csv)}
            className="flex h-8 items-center gap-1.5 rounded border border-[#d7d5e2] px-3 hover:bg-[#f4f6fb] disabled:opacity-50"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>
      <div className={`flex-1 overflow-y-auto px-5 py-6 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
        <div className="mx-auto max-w-[960px]">
          <div className="mb-5 text-center">
            <div className="text-[#6c718a]">2MG Inc. · GetMeds Philippines Inc.</div>
            <h1 className="text-[22px] font-normal">{report.title}</h1>
            <div className="text-[#6c718a]">{period}</div>
          </div>
          {query.isError && <p className="text-center text-[#d9534f]">{(query.error as Error).message}</p>}
          {!query.data && !query.isError && <p className="text-center text-[#6c718a]">Adding up…</p>}
          {table?.view}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the tables

type Shown = { view: ReactNode; csvHead: string[]; csv: (string | number)[][] };
const TH = "px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-[#6c718a] uppercase";
const TD = "px-3 py-1.5";
const NUM = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";

const accountCell = (row: StatementLine) =>
  row.accountId ? (
    <Link to={`/books/accounts/${row.accountId}`} className="text-[#1c5bd9]">
      {row.account}
    </Link>
  ) : (
    <span title="Not in the chart of accounts">{row.account} *</span>
  );

function Section({ title, lines, total, totalLabel }: { title: string; lines: StatementLine[]; total: number; totalLabel: string }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="px-3 pt-4 pb-1 font-semibold">
          {title}
        </td>
      </tr>
      {lines.map((row) => (
        <tr key={row.account} className="border-t border-[#f2f1f7]">
          <td className={`${TD} pl-6`}>{accountCell(row)}</td>
          <td className={NUM}>{zMoney(row.amount)}</td>
        </tr>
      ))}
      <tr className="border-t border-[#d7d5e2] font-semibold">
        <td className={TD}>{totalLabel}</td>
        <td className={NUM}>{zMoney(total)}</td>
      </tr>
    </>
  );
}
const Strong = ({ label, value, extra }: { label: string; value: number; extra?: string }) => (
  <tr className="border-y-2 border-[#21263c] bg-[#f7f8fc] text-[15px] font-semibold">
    <td className={TD}>
      {label}
      {extra && <span className="ml-2 text-[12px] font-normal text-[#6c718a]">{extra}</span>}
    </td>
    <td className={NUM}>{zMoney(value)}</td>
  </tr>
);
const sum = (lines: StatementLine[]) => lines.reduce((total, row) => total + row.amount, 0);
const linesCsv = (part: string, lines: StatementLine[]) => lines.map((row) => [part, row.account, pesos(row.amount)]);

function tableOf(key: string, data: unknown): Shown {
  switch (key) {
    case "profit-and-loss": {
      const pl = data as ProfitAndLoss;
      const t = pl.totals;
      const change = (now: number, before: number) =>
        before ? `${now >= before ? "▲" : "▼"} ${Math.abs(Math.round(((now - before) / Math.abs(before)) * 100))}% vs ${zDate(pl.before.from)}–${zDate(pl.before.to)}` : "";
      return {
        view: (
          <>
            {pl.notes.map((note) => (
              <p key={note} className="mb-3 rounded border border-[#f0d38a] bg-[#fff8e6] px-3 py-2 text-[12.5px] text-[#7a5a00]">
                {note}
              </p>
            ))}
            <table className="w-full">
              <tbody>
                <Section title="Operating Income" lines={pl.parts.income} total={t.income} totalLabel="Total for Operating Income" />
                <Section title="Cost of Goods Sold" lines={pl.parts.costOfSales} total={t.costOfSales} totalLabel="Total for Cost of Goods Sold" />
                <Strong label="Gross Profit" value={t.grossProfit} extra={t.grossMargin === null ? "" : `margin ${t.grossMargin}%`} />
                <Section title="Operating Expense" lines={pl.parts.expenses} total={t.expenses} totalLabel="Total for Operating Expense" />
                <Strong label="Operating Profit" value={t.operatingProfit} />
                <Section title="Non Operating Income" lines={pl.parts.otherIncome} total={t.otherIncome} totalLabel="Total for Non Operating Income" />
                <Section title="Non Operating Expense" lines={pl.parts.otherExpenses} total={t.otherExpenses} totalLabel="Total for Non Operating Expense" />
                <Strong label="Net Profit/Loss" value={t.netProfit} extra={change(t.netProfit, pl.before.totals.netProfit)} />
              </tbody>
            </table>
          </>
        ),
        csvHead: ["Part", "Account", "Amount (PHP)"],
        csv: [
          ...linesCsv("Operating Income", pl.parts.income),
          ...linesCsv("Cost of Goods Sold", pl.parts.costOfSales),
          ["Gross Profit", "", pesos(t.grossProfit)],
          ...linesCsv("Operating Expense", pl.parts.expenses),
          ["Operating Profit", "", pesos(t.operatingProfit)],
          ...linesCsv("Non Operating Income", pl.parts.otherIncome),
          ...linesCsv("Non Operating Expense", pl.parts.otherExpenses),
          ["Net Profit/Loss", "", pesos(t.netProfit)],
        ],
      };
    }
    case "balance-sheet": {
      const bs = data as BalanceSheet;
      return {
        view: (
          <table className="w-full">
            <tbody>
              <Section title="Assets" lines={bs.assets} total={bs.totals.assets} totalLabel="Total for Assets" />
              <Section title="Liabilities" lines={bs.liabilities} total={bs.totals.liabilities} totalLabel="Total for Liabilities" />
              <Section
                title="Equities"
                lines={[...bs.equity, { account: "Profit to date (not yet closed)", accountId: null, type: null, amount: bs.profitToDate }]}
                total={bs.totals.equity}
                totalLabel="Total for Equities"
              />
              <Strong label="Total for Liabilities and Equities" value={bs.totals.liabilities + bs.totals.equity} />
              {bs.notInChart.length > 0 && <Section title="* Accounts the documents name that the chart doesn't have (debit less credit)" lines={bs.notInChart} total={sum(bs.notInChart)} totalLabel="Total" />}
              {bs.totals.difference !== 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-[#d9534f]">
                    Off by {zMoney(bs.totals.difference)}: look at the accounts the chart doesn't have.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ),
        csvHead: ["Part", "Account", "Amount (PHP)"],
        csv: [
          ...linesCsv("Assets", bs.assets),
          ...linesCsv("Liabilities", bs.liabilities),
          ...linesCsv("Equities", bs.equity),
          ["Equities", "Profit to date (not yet closed)", pesos(bs.profitToDate)],
          ...linesCsv("Not in the chart", bs.notInChart),
        ],
      };
    }
    case "trial-balance": {
      const tb = data as TrialBalance;
      return {
        view: (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#d7d5e2]">
                <th className={TH}>Account</th>
                <th className={TH}>Type</th>
                <th className={`${TH} text-right`}>Net Debit</th>
                <th className={`${TH} text-right`}>Net Credit</th>
              </tr>
            </thead>
            <tbody>
              {tb.lines.map((row) => (
                <tr key={row.account} className="border-t border-[#f2f1f7]">
                  <td className={TD}>{accountCell(row)}</td>
                  <td className={`${TD} text-[#6c718a] capitalize`}>{(row.type ?? "not in the chart").replace(/_/g, " ")}</td>
                  <td className={NUM}>{row.debit ? zMoney(row.debit) : ""}</td>
                  <td className={NUM}>{row.credit ? zMoney(row.credit) : ""}</td>
                </tr>
              ))}
              <tr className="border-y-2 border-[#21263c] font-semibold">
                <td className={TD} colSpan={2}>
                  Total {tb.totals.difference === 0 ? "" : `(off by ${zMoney(tb.totals.difference)})`}
                </td>
                <td className={NUM}>{zMoney(tb.totals.debit)}</td>
                <td className={NUM}>{zMoney(tb.totals.credit)}</td>
              </tr>
            </tbody>
          </table>
        ),
        csvHead: ["Account", "Type", "Net Debit", "Net Credit"],
        csv: tb.lines.map((row) => [row.account, row.type ?? "", pesos(row.debit), pesos(row.credit)]),
      };
    }
    case "cash-flow": {
      const cf = data as CashFlow;
      return {
        view: (
          <>
            <table className="mb-6 w-full">
              <thead>
                <tr className="border-b border-[#d7d5e2]">
                  <th className={TH}>What moved it</th>
                  <th className={`${TH} text-right`}>In</th>
                  <th className={`${TH} text-right`}>Out</th>
                  <th className={`${TH} text-right`}>Net</th>
                </tr>
              </thead>
              <tbody>
                {cf.what.map((row) => (
                  <tr key={row.what} className="border-t border-[#f2f1f7]">
                    <td className={TD}>{row.what}</td>
                    <td className={NUM}>{zMoney(row.in)}</td>
                    <td className={NUM}>{zMoney(row.out)}</td>
                    <td className={`${NUM} font-semibold ${row.net < 0 ? "text-[#d9534f]" : ""}`}>{zMoney(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#d7d5e2]">
                  <th className={TH}>Account</th>
                  <th className={`${TH} text-right`}>Opening</th>
                  <th className={`${TH} text-right`}>In</th>
                  <th className={`${TH} text-right`}>Out</th>
                  <th className={`${TH} text-right`}>Closing</th>
                </tr>
              </thead>
              <tbody>
                {cf.accounts.map((row) => (
                  <tr key={row.account} className="border-t border-[#f2f1f7]">
                    <td className={TD}>
                      <Link to={`/books/accounts/${row.accountId}`} className="text-[#1c5bd9]">
                        {row.account}
                      </Link>
                    </td>
                    <td className={NUM}>{zMoney(row.opening)}</td>
                    <td className={NUM}>{zMoney(row.in)}</td>
                    <td className={NUM}>{zMoney(row.out)}</td>
                    <td className={`${NUM} font-semibold`}>{zMoney(row.closing)}</td>
                  </tr>
                ))}
                <tr className="border-y-2 border-[#21263c] font-semibold">
                  <td className={TD}>Total</td>
                  <td className={NUM}>{zMoney(cf.totals.opening)}</td>
                  <td className={NUM}>{zMoney(cf.totals.in)}</td>
                  <td className={NUM}>{zMoney(cf.totals.out)}</td>
                  <td className={NUM}>{zMoney(cf.totals.closing)}</td>
                </tr>
              </tbody>
            </table>
          </>
        ),
        csvHead: ["Account", "Opening", "In", "Out", "Closing"],
        csv: cf.accounts.map((row) => [row.account, pesos(row.opening), pesos(row.in), pesos(row.out), pesos(row.closing)]),
      };
    }
    case "vat": {
      const vat = data as VatSummary;
      const head = ["Month", "Output VAT (sales)", "Input VAT (bills, expenses)", "Net VAT", "Other Tax Payable moves", "Withheld from us (2307)"];
      return {
        view: (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#d7d5e2]">
                {head.map((label, n) => (
                  <th key={label} className={`${TH} ${n ? "text-right" : ""}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vat.months.map((row) => (
                <tr key={row.month} className="border-t border-[#f2f1f7]">
                  <td className={TD}>{zDate(`${row.month}-01`).slice(3)}</td>
                  <td className={NUM}>{zMoney(row.output)}</td>
                  <td className={NUM}>{zMoney(row.input)}</td>
                  <td className={`${NUM} font-semibold`}>{zMoney(row.net)}</td>
                  <td className={NUM}>{zMoney(row.other)}</td>
                  <td className={NUM}>{zMoney(row.withheld)}</td>
                </tr>
              ))}
              <tr className="border-y-2 border-[#21263c] font-semibold">
                <td className={TD}>Total</td>
                <td className={NUM}>{zMoney(vat.totals.output)}</td>
                <td className={NUM}>{zMoney(vat.totals.input)}</td>
                <td className={NUM}>{zMoney(vat.totals.net)}</td>
                <td className={NUM}>{zMoney(vat.totals.other)}</td>
                <td className={NUM}>{zMoney(vat.totals.withheld)}</td>
              </tr>
            </tbody>
          </table>
        ),
        csvHead: head,
        csv: vat.months.map((row) => [row.month, pesos(row.output), pesos(row.input), pesos(row.net), pesos(row.other), pesos(row.withheld)]),
      };
    }
    case "payables-aging": {
      const ap = data as PayablesAging;
      const head = ["Supplier", "Bills", "Not due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days", "Total"];
      const keys = ["current", "d30", "d60", "d90", "older", "total"] as const;
      return {
        view: (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#d7d5e2]">
                {head.map((label, n) => (
                  <th key={label} className={`${TH} ${n ? "text-right" : ""}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ap.suppliers.map((row) => (
                <tr key={`${row.supplier}-${row.supplierId}`} className="border-t border-[#f2f1f7]">
                  <td className={TD}>
                    {row.supplierId ? (
                      <Link to={`/books/vendors/${row.supplierId}`} className="text-[#1c5bd9]">
                        {row.supplier}
                      </Link>
                    ) : (
                      row.supplier
                    )}
                  </td>
                  <td className={NUM}>{row.bills}</td>
                  {keys.map((key) => (
                    <td key={key} className={`${NUM} ${key === "total" ? "font-semibold" : ""} ${key === "older" && row.older ? "text-[#d9534f]" : ""}`}>
                      {row[key] ? zMoney(row[key]) : ""}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-y-2 border-[#21263c] font-semibold">
                <td className={TD}>Total</td>
                <td className={NUM}>{ap.totals.bills}</td>
                {keys.map((key) => (
                  <td key={key} className={NUM}>
                    {zMoney(ap.totals[key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        ),
        csvHead: head,
        csv: ap.suppliers.map((row) => [row.supplier, row.bills, ...keys.map((key) => pesos(row[key]))]),
      };
    }
    case "gross-profit": {
      const gp = data as GrossProfit;
      const head = [gp.by[0]?.toUpperCase() + gp.by.slice(1), "Qty", "Sales (less VAT)", "Cost", "Gross profit", "Margin"];
      return {
        view: (
          <>
            <p className="mb-3 text-[12.5px] text-[#6c718a]">
              Orders made in the CRM, billed in these days, whose goods have left: what they were billed less VAT and less credited returns, less the cost of the
              batches that went out (and came back).
              {gp.notOut.invoices > 0 && ` ${gp.notOut.invoices} invoice(s), ${zMoney(gp.notOut.total)}, wait for their goods to leave: not counted yet.`}
            </p>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#d7d5e2]">
                  {head.map((label, n) => (
                    <th key={label} className={`${TH} ${n ? "text-right" : ""}`}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gp.rows.map((row) => (
                  <tr key={row.key} className="border-t border-[#f2f1f7]">
                    <td className={TD}>
                      {row.link ? (
                        <Link to={row.link} className="text-[#1c5bd9]">
                          {row.label}
                        </Link>
                      ) : (
                        row.label
                      )}
                      {row.uncosted && <span className="ml-1 text-[11px] text-[#c27c00]" title="A batch it came from has no cost recorded">(a batch has no cost)</span>}
                    </td>
                    <td className={NUM}>{row.qty.toLocaleString("en-PH")}</td>
                    <td className={NUM}>{zMoney(row.revenue)}</td>
                    <td className={NUM}>{zMoney(row.cost)}</td>
                    <td className={`${NUM} font-semibold ${row.profit < 0 ? "text-[#d9534f]" : ""}`}>{zMoney(row.profit)}</td>
                    <td className={NUM}>{row.margin === null ? "" : `${row.margin}%`}</td>
                  </tr>
                ))}
                <tr className="border-y-2 border-[#21263c] font-semibold">
                  <td className={TD}>Total</td>
                  <td className={NUM} />
                  <td className={NUM}>{zMoney(gp.totals.revenue)}</td>
                  <td className={NUM}>{zMoney(gp.totals.cost)}</td>
                  <td className={NUM}>{zMoney(gp.totals.profit)}</td>
                  <td className={NUM}>{gp.totals.margin === null ? "" : `${gp.totals.margin}%`}</td>
                </tr>
              </tbody>
            </table>
            {!gp.rows.length && (
              <EmptyState title="No order made in the CRM has had its goods leave in these days.">
                Orders billed in these days show here once their goods have left. Try other days.
              </EmptyState>
            )}
          </>
        ),
        csvHead: head,
        csv: gp.rows.map((row) => [row.label, row.qty, pesos(row.revenue), pesos(row.cost), pesos(row.profit), row.margin ?? ""]),
      };
    }
    default:
      return { view: null, csvHead: [], csv: [] };
  }
}

/** An insight report as its columns say: money, numbers, percents, words. */
function insightTable(data: Insight): Shown {
  const show = (kind: string, value: string | number | null | undefined) =>
    value === null || value === undefined || value === ""
      ? ""
      : typeof value === "string"
        ? value
        : kind === "money"
          ? zMoney(value)
          : kind === "percent"
            ? `${value}%`
            : kind === "number"
              ? value.toLocaleString("en-PH")
              : String(value);
  const raw = (kind: string, value: string | number | null | undefined) =>
    value === null || value === undefined ? "" : kind === "money" && typeof value === "number" ? pesos(value) : value;
  return {
    view: (
      <>
        <p className="mb-3 text-[12.5px] text-[#6c718a]">{data.note}</p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#d7d5e2]">
                {data.columns.map((column) => (
                  <th key={column.key} className={`${TH} ${column.kind === "text" ? "" : "text-right"}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, n) => (
                <tr key={`${row[data.columns[0]?.key ?? ""]}-${n}`} className="border-t border-[#f2f1f7]">
                  {data.columns.map((column) => (
                    <td key={column.key} className={column.kind === "text" ? TD : NUM}>
                      {show(column.kind, row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-y-2 border-[#21263c] font-semibold">
                {data.columns.map((column) => (
                  <td key={column.key} className={column.kind === "text" ? TD : NUM}>
                    {show(column.kind, data.totals[column.key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {!data.rows.length && <EmptyState title="Nothing in these days.">Pick other days to see this report's figures.</EmptyState>}
      </>
    ),
    csvHead: data.columns.map((column) => column.label),
    csv: data.rows.map((row) => data.columns.map((column) => raw(column.kind, row[column.key]))),
  };
}
