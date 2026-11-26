// Books → Home, drawn as Zoho Books' Dashboard (seen 18 Nov 2026): "Hello, <name>" and the company,
// then Total Receivables and Total Payables (current in blue, overdue in orange), Cash Flow (the
// year's month-end cash, with cash at the start, money in, money out and cash at the end beside it),
// Income and Expense month by month, this month's Top Expenses as a ring, and Bank and Credit Cards
// with the statement lines still to do. Every figure is the books' own (Zoho's history and the CRM's).

import type { BooksDashboard } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, NoInvoicesArt } from "../no-results";
import { useMe } from "../auth";
import { LEDGER_ROLES, zMoney } from "./kinds";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (centavos: number) => {
  const pesos = Math.abs(centavos) / 100;
  const sign = centavos < 0 ? "-" : "";
  if (pesos >= 1e9) return `${sign}${(pesos / 1e9).toFixed(1)} B`;
  if (pesos >= 1e6) return `${sign}${(pesos / 1e6).toFixed(0)} M`;
  if (pesos >= 1e3) return `${sign}${(pesos / 1e3).toFixed(0)} K`;
  return `${sign}${pesos.toFixed(0)}`;
};

function Card({ title, right, children, className = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-lg border border-[#ebeaf2] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>
      <div className="flex h-[46px] items-center justify-between border-b border-[#ebeaf2] bg-[#f9f9fb] px-4">
        <h2 className="text-[15px] font-medium text-[#212529]">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Owed({ title, label, data, newTo }: { title: string; label: string; data: { current: number; overdue: number }; newTo: string }) {
  const total = data.current + data.overdue;
  const share = total ? (data.current / total) * 100 : 0;
  return (
    <Card
      title={title}
      right={
        <Link to={newTo} className="flex items-center gap-1 text-[13px] text-[#408dfb]">
          <span className="grid size-4 place-items-center rounded-full bg-[#408dfb] text-white">
            <Plus size={11} strokeWidth={3} />
          </span>
          New
        </Link>
      }
    >
      <div className="text-[12px] text-[#6c718a]">{label}</div>
      <div className="mt-1 text-[20px] text-[#212529]">{zMoney(total)}</div>
      <div className={`mt-3 flex h-[8px] overflow-hidden rounded-sm ${total ? "bg-[#f76831]" : "bg-[#ebeaf2]"}`}>
        <div className="h-full bg-[#408dfb]" style={{ width: `${share}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 bg-[#408dfb]" /> Current : {zMoney(data.current)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 bg-[#f76831]" /> Overdue : {zMoney(data.overdue)}
        </span>
      </div>
    </Card>
  );
}

function CashFlowChart({ flow, year }: { flow: BooksDashboard["cashFlow"]; year: number }) {
  const points = [{ closing: flow.opening, label: "" }, ...flow.months.map((m) => ({ closing: m.closing, label: MONTHS[Number(m.month.slice(5)) - 1] ?? "" }))];
  const W = 560;
  const H = 220;
  const pad = { l: 48, r: 12, t: 10, b: 28 };
  const values = points.map((p) => p.closing);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(points.length - 1, 1);
  const y = (v: number) => pad.t + ((max - v) * (H - pad.t - pad.b)) / span;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.closing).toFixed(1)}`).join(" ");
  const ticks = [0, 1, 2, 3, 4].map((k) => min + (span * k) / 4);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Cash at each month's end in ${year}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#f0f0f5" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#6c718a">
              {short(t)}
            </text>
          </g>
        ))}
        <path d={`${line} L${x(points.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill="#408dfb" fillOpacity="0.08" />
        <path d={line} fill="none" stroke="#408dfb" strokeWidth="1.6" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.closing)} r="3" fill="#408dfb">
              <title>{`${p.label || "Start"}: ${zMoney(p.closing)}`}</title>
            </circle>
            {p.label && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6c718a">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="space-y-4 text-right text-[13px]">
        <div>
          <div className="text-[#6c718a]">
            <span className="mr-1.5 inline-block size-2.5 bg-[#c4c4cf]" />
            Cash as on 01 Jan {year}
          </div>
          <div className="text-[15px]">{zMoney(flow.opening)}</div>
        </div>
        <div>
          <div className="text-[#6c718a]">
            <span className="mr-1.5 inline-block size-2.5 bg-[#22b378]" />
            Incoming
          </div>
          <div className="text-[15px]">{zMoney(flow.incoming)} ( + )</div>
        </div>
        <div>
          <div className="text-[#6c718a]">
            <span className="mr-1.5 inline-block size-2.5 bg-[#e5484d]" />
            Outgoing
          </div>
          <div className="text-[15px]">{zMoney(flow.outgoing)} ( - )</div>
        </div>
        <div>
          <div className="text-[#6c718a]">
            <span className="mr-1.5 inline-block size-2.5 bg-[#408dfb]" />
            Cash as on {flow.months.length ? `the last day of ${MONTHS[Number((flow.months[flow.months.length - 1]?.month ?? "").slice(5)) - 1] ?? ""}` : ""}
          </div>
          <div className="text-[15px]">{zMoney(flow.closing)} ( = )</div>
        </div>
      </div>
    </div>
  );
}

function IncomeExpense({ data }: { data: BooksDashboard["incomeExpense"] }) {
  const W = 520;
  const H = 200;
  const pad = { l: 44, r: 8, t: 8, b: 24 };
  const max = Math.max(...data.flatMap((d) => [d.income, d.expense]), 1);
  const band = (W - pad.l - pad.r) / Math.max(data.length, 1);
  const y = (v: number) => pad.t + ((max - Math.max(v, 0)) * (H - pad.t - pad.b)) / max;
  const income = data.reduce((sum, d) => sum + d.income, 0);
  const expense = data.reduce((sum, d) => sum + d.expense, 0);
  return (
    <div>
      <div className="flex flex-wrap gap-6 text-[13px]">
        <div>
          <span className="mr-1.5 inline-block size-2.5 bg-[#22b378]" />
          Total Income
          <div className="text-[17px]">{zMoney(income)}</div>
        </div>
        <div>
          <span className="mr-1.5 inline-block size-2.5 bg-[#e5484d]" />
          Total Expenses
          <div className="text-[17px]">{zMoney(expense)}</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Income and expense month by month">
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * k)} y2={y(max * k)} stroke="#f0f0f5" />
            <text x={pad.l - 6} y={y(max * k) + 3} textAnchor="end" fontSize="10" fill="#6c718a">
              {short(max * k)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pad.l + i * band + band * 0.18;
          const w = band * 0.3;
          return (
            <g key={d.month}>
              <rect x={x0} y={y(d.income)} width={w} height={H - pad.b - y(d.income)} fill="#22b378">
                <title>{`${d.month} income ${zMoney(d.income)}`}</title>
              </rect>
              <rect x={x0 + w + 2} y={y(d.expense)} width={w} height={H - pad.b - y(d.expense)} fill="#e5484d">
                <title>{`${d.month} expenses ${zMoney(d.expense)}`}</title>
              </rect>
              <text x={x0 + w} y={H - 8} textAnchor="middle" fontSize="10" fill="#6c718a">
                {MONTHS[Number(d.month.slice(5)) - 1]}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-[12px] text-[#6c718a]">* Income and expense values displayed are exclusive of taxes (accrual).</p>
    </div>
  );
}

const RING = ["#22b378", "#f76831", "#408dfb", "#f5a524", "#8b5cf6", "#5bc0de"];
function TopExpenses({ data }: { data: BooksDashboard["topExpenses"] }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  let at = 0;
  if (!data.total) return <EmptyState title="No expenses this month yet.">The accounts this month's expenses go to show here, the biggest first.</EmptyState>;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="size-[150px]" role="img" aria-label="This month's top expenses">
        {data.accounts.map((one, i) => {
          const part = (one.amount / data.total) * C;
          const circle = (
            <circle key={one.account} cx="70" cy="70" r={R} fill="none" stroke={RING[i % RING.length]} strokeWidth="18" strokeDasharray={`${part} ${C - part}`} strokeDashoffset={-at} transform="rotate(-90 70 70)">
              <title>{`${one.account}: ${zMoney(one.amount)}`}</title>
            </circle>
          );
          at += part;
          return circle;
        })}
        <text x="70" y="64" textAnchor="middle" fontSize="9" fill="#6c718a">
          All Expenses
        </text>
        <text x="70" y="80" textAnchor="middle" fontSize="11" fill="#212529">
          {short(data.total)}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2 text-[13px]">
        {data.accounts.map((one, i) => (
          <li key={one.account} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0" style={{ background: RING[i % RING.length] }} />
              <span className="truncate">{one.account}</span>
            </span>
            <span className="shrink-0">{zMoney(one.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BooksHome() {
  const me = useMe();
  const keeps = LEDGER_ROLES.includes(me.data?.role ?? "");
  const [params, setParams] = useSearchParams();
  const [tab] = useState("dashboard");
  const thisYear = new Date().getFullYear();
  const year = Number(params.get("year")) || thisYear;
  const query = useQuery({
    queryKey: ["books", "dashboard", year],
    queryFn: () => api<BooksDashboard>(`/api/books/dashboard?year=${year}`),
    placeholderData: keepPreviousData,
    enabled: keeps,
  });
  const d = query.data;
  // Books Home is Finance's, the CEO's and the Admin's; the stock desks open their purchases.
  if (me.data && !keeps) return <Navigate to="/books/purchaseorders" replace />;
  const uncategorized = d?.banks.reduce((sum, b) => sum + b.uncategorized, 0) ?? 0;
  return (
    <div className="h-full overflow-y-auto bg-[#fbfbfe]">
      <div className="border-b border-[#ebeaf2] bg-white px-6 pt-5">
        <div className="flex items-center gap-3">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10 rounded-md border border-[#ebeaf2] p-1" />
          <div>
            <h1 className="text-[20px] text-[#212529]">Hello, {me.data?.name ?? ""}</h1>
            <div className="text-[13px] text-[#6c718a]">2MG Inc. and GetMeds Philippines Inc.</div>
          </div>
        </div>
        <div className="mt-4 flex gap-6 text-[14px]">
          <span className={`border-b-2 pb-2 ${tab === "dashboard" ? "border-[#408dfb] text-[#212529]" : "border-transparent"}`}>Dashboard</span>
        </div>
      </div>
      {query.isError && <p className="p-6 text-[#f76831]">{query.error.message}</p>}
      {!d && query.isPending && <p className="p-6 text-[#6c718a]">Adding up the books…</p>}
      {d && (
        <div className="grid gap-5 p-5 xl:grid-cols-2">
          <Owed title="Total Receivables" label="Total Unpaid Invoices" data={d.receivables} newTo="/orders/new" />
          <Owed title="Total Payables" label="Total Unpaid Bills" data={d.payables} newTo="/books/bills/new" />
          <Card
            title="Cash Flow"
            className="xl:col-span-2"
            right={
              <select className="rounded border-0 bg-transparent py-0 text-[13px] text-[#4b4f63] focus:ring-0" value={year} onChange={(event) => setParams(Number(event.target.value) === thisYear ? {} : { year: event.target.value })}>
                <option value={thisYear}>This Fiscal Year</option>
                <option value={thisYear - 1}>Previous Fiscal Year</option>
              </select>
            }
          >
            <CashFlowChart flow={d.cashFlow} year={d.year} />
          </Card>
          <Card title="Income and Expense" right={<span className="text-[13px] text-[#4b4f63]">{d.year === thisYear ? "This Fiscal Year" : d.year}</span>}>
            <IncomeExpense data={d.incomeExpense} />
          </Card>
          <Card title="Top Expenses" right={<span className="text-[13px] text-[#4b4f63]">This Month</span>}>
            <TopExpenses data={d.topExpenses} />
          </Card>
          <Card title="Bank and Credit Cards" className="xl:col-span-2">
            {uncategorized > 0 && (
              <div className="-mx-4 -mt-4 mb-3 flex items-center justify-between bg-[#fff6ec] px-4 py-2.5 text-[13px]">
                <span className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-[#f76831]" /> {uncategorized} Uncategorized Transactions
                </span>
              </div>
            )}
            <ul className="divide-y divide-[#ebeaf2]">
              {d.banks.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/books/accounts/${b.id}`} className="truncate text-[14px] text-[#212529] hover:text-[#1c5bd9]">
                      {b.name}
                    </Link>
                    {b.uncategorized > 0 && (
                      <Link to={`/books/bankstatement?account=${encodeURIComponent(b.name)}`} className="flex items-center gap-0.5 text-[12px] text-[#1c5bd9]">
                        {b.uncategorized} Uncategorized Transactions <ChevronRight size={12} />
                      </Link>
                    )}
                  </div>
                  <span className="shrink-0 text-[14px]">{zMoney(b.balance)}</span>
                </li>
              ))}
            </ul>
            {!d.banks.length && (
              <EmptyState art={<NoInvoicesArt size={72} />} title="No bank, cash or card accounts in the chart yet.">
                Once they are in the chart of accounts, each shows here with its balance.
              </EmptyState>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
