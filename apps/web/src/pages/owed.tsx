// What customers owe us, as a full report: every unpaid invoice with whose it is (the hospital or
// doctor, the MedRep, the team), the day it was made and the day we gave them to pay by, how late
// it is and what is left. Grouped by customer, MedRep or team, each group opening its invoices.
// Cash on delivery whose goods haven't arrived yet is money not owed yet: kept apart, at the end.

import type { OwedInvoices } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { dayLabel, PageHead, PageState, peso } from "../ui";

type Row = OwedInvoices["rows"][number];
type By = "customer" | "medrep" | "team";

const AGES = [
  {
    key: "due",
    label: "Not due yet",
    color: "bg-emerald-500",
    test: (row: Row) => row.state === "due",
  },
  {
    key: "d30",
    label: "1–30 days late",
    color: "bg-amber-400",
    test: (row: Row) => row.state === "late" && row.daysLate <= 30,
  },
  {
    key: "d60",
    label: "31–60 days",
    color: "bg-orange-500",
    test: (row: Row) => row.state === "late" && row.daysLate > 30 && row.daysLate <= 60,
  },
  {
    key: "d90",
    label: "61–90 days",
    color: "bg-rose-500",
    test: (row: Row) => row.state === "late" && row.daysLate > 60 && row.daysLate <= 90,
  },
  {
    key: "older",
    label: "Over 90 days",
    color: "bg-rose-700",
    test: (row: Row) => row.state === "late" && row.daysLate > 90,
  },
] as const;

const sum = (rows: Row[]) => rows.reduce((total, row) => total + row.balance, 0);

export function OwedReport() {
  const [params, setParams] = useSearchParams();
  const by = (["customer", "medrep", "team"].find((one) => one === params.get("by")) ??
    "customer") as By;
  const only = params.get("only") ?? "";
  const [find, setFind] = useState("");
  const query = useQuery({
    queryKey: ["finance", "owed", "invoices"],
    queryFn: () => api<OwedInvoices>("/api/finance/owed/invoices"),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="what customers owe" />;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const words = find.trim().toLowerCase();
  const owed = data.rows.filter((row) => row.state !== "on_delivery");
  const onDelivery = data.rows.filter((row) => row.state === "on_delivery");
  const shown = owed.filter(
    (row) =>
      (!only || (only === "late" ? row.state === "late" : row.state === "due")) &&
      (!words ||
        `${row.customer} ${row.medrep} ${row.team ?? ""} ${row.invoiceCode} ${row.orderCode}`
          .toLowerCase()
          .includes(words)),
  );
  const keyOf = (row: Row) =>
    by === "customer"
      ? `c${row.customerId}`
      : by === "medrep"
        ? `m${row.medrepId}`
        : `t${row.team ?? "-"}`;
  const groups = [
    ...shown
      .reduce(
        (map, row) => map.set(keyOf(row), [...(map.get(keyOf(row)) ?? []), row]),
        new Map<string, Row[]>(),
      )
      .values(),
  ]
    .map((rows) => ({
      rows,
      owed: sum(rows),
      late: sum(rows.filter((row) => row.state === "late")),
      oldest: Math.max(0, ...rows.map((row) => row.daysLate)),
    }))
    .sort((a, b) => b.late - a.late || b.owed - a.owed);
  const total = data.totals.owed;

  return (
    <div className="mx-auto max-w-[88rem] space-y-4">
      <PageHead
        title="Customers owe us"
        sub={`${data.totals.customers} customers · ${data.totals.invoices} unpaid invoices · as of ${dayLabel(data.today)}`}
      />

      {/* The money at a glance: owed, how late, and cash on delivery kept apart. */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-slate-500">Owed to us</div>
              <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {shortPeso(total)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Past due</div>
              <div
                className={`text-2xl font-semibold tabular-nums ${data.totals.overdue ? "text-rose-600" : "text-slate-400"}`}
              >
                {shortPeso(data.totals.overdue)}
              </div>
            </div>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
            {AGES.map((age) => {
              const amount = sum(owed.filter(age.test));
              return amount > 0 ? (
                <span
                  key={age.key}
                  className={age.color}
                  style={{ width: `${(amount / Math.max(1, total)) * 100}%` }}
                  title={`${age.label}: ${shortPeso(amount)}`}
                />
              ) : null;
            })}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-5">
            {AGES.map((age) => {
              const amount = sum(owed.filter(age.test));
              return (
                <li key={age.key} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <span className={`size-2 rounded-full ${age.color}`} /> {age.label}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${amount ? "text-slate-800" : "text-slate-300"}`}
                  >
                    {shortPeso(amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-5 shadow-sm">
          <div className="text-xs text-sky-800">Cash on delivery, not delivered yet</div>
          <div className="text-2xl font-semibold text-sky-900 tabular-nums">
            {shortPeso(data.totals.onDelivery)}
          </div>
          <div className="text-xs text-sky-800/80">
            {onDelivery.length} {onDelivery.length === 1 ? "order" : "orders"}: owed once delivered,
            not counted above
          </div>
        </div>
      </section>

      {/* How to look at it: by customer, MedRep or team; late only; a search. */}
      <section className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
          {(
            [
              ["customer", "By customer"],
              ["medrep", "By MedRep"],
              ["team", "By team"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => set("by", key === "customer" ? "" : key)}
              className={`h-8 rounded-lg px-3 text-xs font-semibold ${by === key ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
          {(
            [
              ["", "All"],
              ["late", "Past due"],
              ["due", "Not due yet"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => set("only", key)}
              className={`h-8 rounded-lg px-3 text-xs font-semibold ${only === key ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative ml-auto flex min-w-64 items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-slate-400" />
          <input
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Customer, MedRep, team or invoice"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-emerald-600 focus:outline-none"
          />
        </label>
      </section>

      <section className="space-y-2">
        {groups.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Nothing owed here.
          </p>
        )}
        {groups.map((group) => (
          <Group key={keyOf(group.rows[0] as Row)} by={by} {...group} />
        ))}
      </section>

      {onDelivery.length > 0 && (
        <section className="space-y-2">
          <h2 className="pt-2 text-sm font-semibold text-slate-900">
            Cash on delivery, not delivered yet
          </h2>
          <Invoices rows={onDelivery} />
        </section>
      )}
    </div>
  );
}

function Group({
  by,
  rows,
  owed,
  late,
  oldest,
}: {
  by: By;
  rows: Row[];
  owed: number;
  late: number;
  oldest: number;
}) {
  const [open, setOpen] = useState(false);
  const first = rows[0] as Row;
  const name =
    by === "customer" ? first.customer : by === "medrep" ? first.medrep : (first.team ?? "No team");
  const sub =
    by === "customer"
      ? [first.kind[0]?.toUpperCase() + first.kind.slice(1), first.city, first.medrep, first.team]
          .filter(Boolean)
          .join(" · ")
      : by === "medrep"
        ? [first.team, `${new Set(rows.map((row) => row.customerId)).size} customers`]
            .filter(Boolean)
            .join(" · ")
        : `${new Set(rows.map((row) => row.medrepId)).size} MedReps · ${new Set(rows.map((row) => row.customerId)).size} customers`;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-slate-400" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
          <span className="block truncate text-xs text-slate-500">{sub}</span>
        </span>
        <span className="hidden w-28 text-right text-xs text-slate-500 sm:block">
          {rows.length} {rows.length === 1 ? "invoice" : "invoices"}
        </span>
        <span className="w-32 text-right">
          <span
            className={`block text-sm font-semibold tabular-nums ${late ? "text-rose-600" : "text-slate-400"}`}
          >
            {late ? shortPeso(late) : "—"}
          </span>
          <span className="block text-[11px] text-slate-500">
            {late ? `past due · ${oldest}d` : "nothing late"}
          </span>
        </span>
        <span className="w-28 text-right text-sm font-semibold text-slate-900 tabular-nums">
          {shortPeso(owed)}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          <Invoices rows={rows} />
        </div>
      )}
    </div>
  );
}

/** One line per invoice: whose, the days we gave them, how late, what is left. */
function Invoices({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
            <th className="px-4 py-2 font-medium">Invoice</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">MedRep · team</th>
            <th className="px-3 py-2 font-medium">Made</th>
            <th className="px-3 py-2 font-medium">To pay by</th>
            <th className="px-3 py-2 font-medium">Terms</th>
            <th className="px-3 py-2 text-right font-medium">Late</th>
            <th className="px-4 py-2 text-right font-medium">Left to pay</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.invoiceId} className="hover:bg-slate-50">
              <td className="px-4 py-2">
                <Link
                  to={`/invoices/${row.invoiceId}`}
                  className="font-semibold text-slate-800 hover:underline"
                >
                  {row.invoiceCode}
                </Link>
                <Link
                  to={`/orders/${row.orderId}`}
                  className="block text-[11px] text-slate-400 hover:underline"
                >
                  {row.orderCode}
                </Link>
              </td>
              <td className="px-3 py-2">
                <Link to={`/customers/${row.customerId}`} className="hover:underline">
                  {row.customer}
                </Link>
              </td>
              <td className="px-3 py-2 text-slate-600">
                {row.medrep}
                {row.team && <span className="block text-[11px] text-slate-400">{row.team}</span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                {dayLabel(row.issuedOn)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                {row.state === "on_delivery"
                  ? "On delivery"
                  : row.dueOn
                    ? dayLabel(row.dueOn)
                    : "After delivery"}
              </td>
              <td className="px-3 py-2 text-slate-600">{row.terms}</td>
              <td className="px-3 py-2 text-right">
                {row.state === "late" ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.daysLate > 60 ? "bg-rose-100 text-rose-700" : row.daysLate > 30 ? "bg-orange-100 text-orange-700" : "bg-amber-100 text-amber-800"}`}
                  >
                    {row.daysLate}d
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">
                {peso(row.balance)}
                {row.paid > 0 && (
                  <span className="block text-[11px] font-normal text-slate-400">
                    of {peso(row.total)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
