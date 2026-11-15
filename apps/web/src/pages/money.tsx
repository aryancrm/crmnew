// Finance's money lists: payments received in a month, what each customer owes by how late,
// and money to give back for cancelled orders.

import type { OwedList, PaymentList, RefundList, RefundOwed } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { METHODS, RefundDialog } from "../finance/parts";
import { Bars } from "../team/charts";
import { Button, Card, count, dayLabel, PageHead, PageState, peso, Tile, timeLabel } from "../ui";

/** The address's own filters, with a box that types into `q`. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState(params.get("q") ?? "");
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts the timer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== (params.get("q") ?? "")) set({ q: typed.trim() });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  return { params, set, typed, setTyped };
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
      <input
        type="search"
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/70 pr-3 pl-9 text-sm focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/10 focus:outline-none"
      />
    </div>
  );
}

const shiftMonth = (month: string, by: number) => {
  const [year, number] = month.split("-").map(Number);
  const at = new Date(Date.UTC(year ?? 2026, (number ?? 1) - 1 + by, 1));
  return at.toISOString().slice(0, 7);
};

export function Payments() {
  const { params, set, typed, setTyped } = useFilters();
  const navigate = useNavigate();
  const search = ["month", "method", "q", "page"]
    .map((key) =>
      params.get(key) ? `${key}=${encodeURIComponent(params.get(key) as string)}` : "",
    )
    .filter(Boolean)
    .join("&");
  const query = useQuery({
    queryKey: ["finance", "payments", search],
    queryFn: () => api<PaymentList>(`/api/payments?${search}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the payments" />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" })
    .format(new Date())
    .slice(0, 7);

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title="Payments received"
        sub="Money that came in against invoices"
        actions={
          <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-card">
            <button
              type="button"
              aria-label="Month before"
              className="grid size-8 place-items-center rounded-lg hover:bg-head"
              onClick={() => set({ month: shiftMonth(data.month, -1) })}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="min-w-32 text-center text-sm font-semibold">{data.monthLabel}</span>
            <button
              type="button"
              aria-label="Month after"
              disabled={data.month >= thisMonth}
              className="grid size-8 place-items-center rounded-lg hover:bg-head disabled:opacity-30"
              onClick={() => set({ month: shiftMonth(data.month, 1) })}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        }
      />
      {/* The month at a glance: how much came in, day by day, and how it was paid. */}
      <section
        aria-label="The month"
        className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs text-slate-500">Collected in {data.monthLabel}</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-emerald-700 tabular-nums">
            {shortPeso(data.sum)}
          </div>
          <div className="text-xs text-slate-500">
            {data.total} {data.total === 1 ? "payment" : "payments"}
          </div>
          {data.byDay.length > 0 && (
            <div
              className="mt-4 flex h-20 items-end gap-1"
              role="img"
              aria-label="Collected day by day"
            >
              {data.byDay.map((one) => (
                <span
                  key={one.day}
                  className="min-w-1 max-w-6 flex-1 rounded-t bg-emerald-400/80"
                  style={{
                    height: `${Math.max(6, (one.amount / Math.max(1, ...data.byDay.map((d) => d.amount))) * 100)}%`,
                  }}
                  title={`${one.day}: ${shortPeso(one.amount)}`}
                />
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-900">How it was paid</div>
          {data.byMethod.length ? (
            <Bars
              rows={data.byMethod.map((one) => ({
                key: one.method,
                label: one.label,
                sub: `${one.count} ${one.count === 1 ? "payment" : "payments"}`,
                value: one.amount,
              }))}
              color="bg-emerald-500"
            />
          ) : (
            <p className="text-sm text-slate-500">Nothing came in this month.</p>
          )}
        </div>
      </section>
      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <SearchBox
              value={typed}
              onChange={setTyped}
              placeholder="Customer, invoice or reference"
            />
            <select
              aria-label="How it was paid"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm"
              value={params.get("method") ?? ""}
              onChange={(event) => set({ method: event.target.value })}
            >
              <option value="">Every way</option>
              {METHODS.map((method) => (
                <option key={method.key} value={method.key}>
                  {method.label}
                </option>
              ))}
            </select>
          </div>
          <div className="text-[13px] text-ink-2">
            {count(data.total)} {data.total === 1 ? "payment" : "payments"} ·{" "}
            <span className="font-semibold text-ink">{peso(data.sum)}</span>
          </div>
        </div>
        {data.rows.length === 0 ? (
          <div className="p-8 text-center text-ink-2">No payment in {data.monthLabel}.</div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Invoice</th>
                <th>Order</th>
                <th>How</th>
                <th>Reference</th>
                <th>Recorded by</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/invoices/${row.invoiceId}`)}
                >
                  <td className="whitespace-nowrap">{dayLabel(row.paidOn)}</td>
                  <td className="font-semibold">{row.customer}</td>
                  <td>
                    <Link
                      to={`/invoices/${row.invoiceId}`}
                      onClick={(event) => event.stopPropagation()}
                      className="whitespace-nowrap hover:underline"
                    >
                      {row.invoiceCode}
                    </Link>
                  </td>
                  <td>
                    <Link
                      to={`/orders/${row.orderId}`}
                      onClick={(event) => event.stopPropagation()}
                      className="whitespace-nowrap hover:underline"
                    >
                      {row.orderCode}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{row.methodLabel}</td>
                  <td className="whitespace-nowrap">{row.reference ?? "—"}</td>
                  <td className="whitespace-nowrap">
                    {row.by}
                    <div className="text-xs text-ink-2">{timeLabel(row.at)}</div>
                  </td>
                  <td className="num font-semibold whitespace-nowrap">{peso(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-line-soft px-4 py-3 text-[13px]">
            <span className="text-ink-2">
              Page {data.page} of {pages}
            </span>
            <Button
              small
              disabled={data.page <= 1}
              onClick={() => set({ page: String(data.page - 1) })}
            >
              Previous
            </Button>
            <Button
              small
              disabled={data.page >= pages}
              onClick={() => set({ page: String(data.page + 1) })}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

const KIND = {
  hospital: "Hospital",
  doctor: "Doctor",
  patient: "Patient",
  drugstore: "Drugstore",
  distributor: "Distributor",
  government: "Government",
} as const;

export function CustomersOwe() {
  const { params, typed, setTyped } = useFilters();
  const navigate = useNavigate();
  const q = params.get("q") ?? "";
  const query = useQuery({
    queryKey: ["finance", "owed", q],
    queryFn: () => api<OwedList>(`/api/finance/owed?q=${encodeURIComponent(q)}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="what customers owe" />;
  const { totals } = data;
  const cell = (value: number, late = false) => (
    <td
      className={`num whitespace-nowrap ${value === 0 ? "text-slate-300" : late ? "font-semibold text-bad" : ""}`}
    >
      {value === 0 ? "—" : peso(value)}
    </td>
  );

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title="Customers owe"
        sub={`Unpaid invoices by how late they are, as of ${dayLabel(data.today)}`}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Owed in all"
          value={peso(totals.total)}
          sub={`${count(totals.invoices)} unpaid invoices`}
        />
        <Tile
          label="Overdue"
          value={peso(totals.overdue)}
          tone={totals.overdue > 0 ? "bad" : "plain"}
          sub={(() => {
            const late = data.rows.filter((row) => row.overdue > 0).length;
            return late === 0
              ? "Nobody is late"
              : `${count(late)} ${late === 1 ? "customer" : "customers"} late`;
          })()}
        />
        <Tile label="Not due yet" value={peso(totals.current)} />
        <Tile
          label="Collect on delivery"
          value={peso(totals.onDelivery)}
          sub="Cash on delivery, not delivered yet"
        />
      </div>
      <Card className="overflow-x-auto">
        <div className="border-b border-line-soft px-4 py-3">
          <SearchBox value={typed} onChange={setTyped} placeholder="Customer or city" />
        </div>
        {data.rows.length === 0 ? (
          <div className="p-8 text-center text-ink-2">
            {q ? "No customer matches." : "Nobody owes anything."}
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Terms</th>
                <th>MedRep</th>
                <th className="num">Invoices</th>
                <th className="num">Not due yet</th>
                <th className="num">1–30 days</th>
                <th className="num">31–60 days</th>
                <th className="num">61–90 days</th>
                <th className="num">Over 90 days</th>
                <th className="num">On delivery</th>
                <th className="num">Total owed</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.customerId}
                  className="cursor-pointer"
                  onClick={() => navigate(`/invoices?customer=${row.customerId}&tab=unpaid`)}
                >
                  <td>
                    <div className="font-semibold">{row.customer}</div>
                    <div className="text-xs text-ink-2">
                      {KIND[row.kind]}
                      {row.city ? ` · ${row.city}` : ""}
                      {row.oldestDays > 0 ? ` · oldest ${row.oldestDays} days late` : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    {row.terms}
                    {row.creditLimit !== null && (
                      <div className="text-xs text-ink-2">Limit {peso(row.creditLimit)}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{row.medrep ?? "—"}</td>
                  <td className="num">{count(row.invoices)}</td>
                  {cell(row.current)}
                  {cell(row.d30, true)}
                  {cell(row.d60, true)}
                  {cell(row.d90, true)}
                  {cell(row.older, true)}
                  {cell(row.onDelivery)}
                  <td className="num font-semibold whitespace-nowrap">{peso(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={3}>Total</td>
                <td className="num">{count(totals.invoices)}</td>
                {cell(totals.current)}
                {cell(totals.d30, true)}
                {cell(totals.d60, true)}
                {cell(totals.d90, true)}
                {cell(totals.older, true)}
                {cell(totals.onDelivery)}
                <td className="num whitespace-nowrap">{peso(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </div>
  );
}

export function Refunds() {
  const query = useQuery({
    queryKey: ["finance", "refunds"],
    queryFn: () => api<RefundList>("/api/finance/refunds"),
  });
  const [giving, setGiving] = useState<RefundOwed | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the refunds" />;
  const owed = data.owed.reduce((sum, row) => sum + row.owed, 0);

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title="Refunds owed"
        sub={
          data.owed.length
            ? `${count(data.owed.length)} cancelled ${data.owed.length === 1 ? "order" : "orders"} · ${peso(owed)} to give back`
            : "Money for cancelled orders the customer had paid"
        }
      />
      <Card className="mb-4 overflow-x-auto">
        {data.owed.length === 0 ? (
          <div className="p-8 text-center text-ink-2">Nothing to give back.</div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Cancelled</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Why</th>
                <th className="num">Received</th>
                <th className="num">Given back</th>
                <th className="num">To give back</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.owed.map((row) => (
                <tr key={row.invoiceId}>
                  <td className="whitespace-nowrap">
                    {row.cancelledAt ? timeLabel(row.cancelledAt) : "—"}
                    <div
                      className={`text-xs ${row.days > 3 ? "font-semibold text-bad" : "text-ink-2"}`}
                    >
                      {row.days === 0 ? "Today" : `Waiting ${row.days} days`}
                    </div>
                  </td>
                  <td>
                    <Link
                      to={`/orders/${row.orderId}`}
                      className="font-semibold whitespace-nowrap hover:underline"
                    >
                      {row.orderCode}
                    </Link>
                    <div className="text-xs">
                      <Link
                        to={`/invoices/${row.invoiceId}`}
                        className="whitespace-nowrap text-ink-2 hover:underline"
                      >
                        {row.invoiceCode}
                      </Link>
                    </div>
                  </td>
                  <td className="font-semibold">{row.customer}</td>
                  <td className="min-w-48 text-ink-2">{row.reason ?? "—"}</td>
                  <td className="num whitespace-nowrap">{peso(row.received)}</td>
                  <td className="num whitespace-nowrap">
                    {row.refunded ? peso(row.refunded) : "—"}
                  </td>
                  <td className="num font-semibold whitespace-nowrap">{peso(row.owed)}</td>
                  <td className="text-right">
                    {data.can.refund && (
                      <Button small variant="primary" onClick={() => setGiving(row)}>
                        Give back
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {data.done.length > 0 && (
        <Card className="overflow-x-auto">
          <div className="border-b border-line-soft px-5 py-3 font-semibold">Given back</div>
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Customer</th>
                <th>How</th>
                <th>Reference</th>
                <th>By</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.done.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">{dayLabel(row.refundedOn)}</td>
                  <td>
                    <Link
                      to={`/orders/${row.orderId}`}
                      className="whitespace-nowrap hover:underline"
                    >
                      {row.orderCode}
                    </Link>
                  </td>
                  <td>{row.customer}</td>
                  <td className="whitespace-nowrap">{row.methodLabel}</td>
                  <td className="whitespace-nowrap">{row.reference ?? "—"}</td>
                  <td className="whitespace-nowrap">{row.by}</td>
                  <td className="num font-semibold whitespace-nowrap">{peso(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {giving && (
        <RefundDialog
          invoiceId={giving.invoiceId}
          code={giving.orderCode}
          owed={giving.owed}
          onClose={() => setGiving(null)}
        />
      )}
    </div>
  );
}
