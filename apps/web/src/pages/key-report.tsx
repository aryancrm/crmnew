// The CEO's key reports (Customers, Channels) in this CRM's own look (Aryan, 18 Nov: "these look
// like Zoho's"): the days picked, the kind of customer, a search, a table sorted by any column,
// the total, Print and Export CSV. Same figures as the books' report of the same name.

import type { Insight } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { SearchBox } from "../buying/shared";
import { Button, count, PageHead, PageState, peso, Tabs } from "../ui";

const KINDS = [
  { key: "all", label: "All kinds" },
  { key: "hospital", label: "Hospitals" },
  { key: "doctor", label: "Doctors" },
  { key: "patient", label: "Patients" },
  { key: "drugstore", label: "Drugstores" },
  { key: "distributor", label: "Distributors" },
  { key: "government", label: "Government" },
];
const manila = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
function ranges() {
  const today = manila();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const lastEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const back30 = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return [
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { key: "last", label: "Last month", from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd },
    { key: "30", label: "Last 30 days", from: back30, to: today },
    { key: "year", label: "This year", from: `${y}-01-01`, to: today },
  ];
}
const SHOWN = 300;

function cell(kind: Insight["columns"][number]["kind"], value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return peso(Number(value));
  if (kind === "number") return count(Number(value));
  if (kind === "percent") return `${Number(value).toFixed(1)}%`;
  return String(value);
}

export function KeyReportPage() {
  const key = useParams().report ?? "customers";
  const [params, setParams] = useSearchParams();
  const all = ranges();
  const range = all.find((one) => one.key === params.get("range")) ?? (all[0] as (typeof all)[number]);
  const by = params.get("by") ?? "all";
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; up: boolean } | null>(null);
  const [more, setMore] = useState(1);
  const query = useQuery({
    queryKey: ["key-report", key, range.from, range.to, by],
    queryFn: () => api<Insight>(`/api/books/insights/${key}?from=${range.from}&to=${range.to}${key === "customers" ? `&by=${by}` : ""}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const set = (next: Record<string, string>) => {
    const out = new URLSearchParams(params);
    for (const [name, value] of Object.entries(next)) out.set(name, value);
    setParams(out, { replace: true });
    setMore(1);
  };
  const rows = useMemo(() => {
    if (!data) return [];
    const text = q.trim().toLowerCase();
    const found = text
      ? data.rows.filter((row) => data.columns.some((column) => column.kind === "text" && String(row[column.key] ?? "").toLowerCase().includes(text)))
      : data.rows;
    if (!sort) return found;
    const kind = data.columns.find((column) => column.key === sort.key)?.kind;
    return [...found].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const diff = kind === "text" ? String(x ?? "").localeCompare(String(y ?? "")) : Number(x ?? 0) - Number(y ?? 0);
      return sort.up ? diff : -diff;
    });
  }, [data, q, sort]);
  const csv = () => {
    if (!data) return;
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [
      data.columns.map((column) => quote(column.label)).join(","),
      ...rows.map((row) =>
        data.columns.map((column) => quote(column.kind === "money" ? (Number(row[column.key] ?? 0) / 100).toFixed(2) : row[column.key])).join(","),
      ),
    ];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    link.download = `${key}-${range.from}-${range.to}.csv`;
    link.click();
  };
  const shown = rows.slice(0, SHOWN * more);
  const money = data?.columns.filter((column) => column.kind !== "text") ?? [];
  const firstMoney = money.find((column) => column.kind === "money");

  return (
    <div className="mx-auto flex max-w-[96rem] flex-col gap-4">
      <PageHead
        title={data?.title ?? (key === "channels" ? "Channels" : "Customers")}
        sub={data?.note}
        actions={
          <span className="flex gap-2 print:hidden">
            <Button onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" /> Print
            </Button>
            <Button onClick={csv} disabled={!data}>
              <Download size={16} aria-hidden="true" /> Export CSV
            </Button>
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <span className="flex rounded-xl border border-slate-200 bg-white p-1 text-[13px] font-semibold shadow-2xs">
            {all.map((one) => (
              <button
                key={one.key}
                type="button"
                aria-pressed={one.key === range.key}
                onClick={() => set({ range: one.key })}
                className={`rounded-lg px-3 py-1.5 ${one.key === range.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {one.label}
              </button>
            ))}
          </span>
          <span className="text-[12px] text-slate-500">
            {range.from} to {range.to}
          </span>
        </div>
        {key === "customers" && (
          <div className="print:hidden">
            <Tabs value={by} onChange={(next) => set({ by: next })} tabs={KINDS} />
          </div>
        )}
      </PageHead>

      {data && key === "customers" && firstMoney && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Customers who bought", count(data.rows.length)],
            ["Bought in the days", peso(Number(data.totals.period ?? 0))],
            ["This year", peso(Number(data.totals.year ?? 0))],
            ["Owe now", peso(Number(data.totals.owed ?? 0))],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
              <div className="text-[12px] font-semibold text-slate-500">{label}</div>
              <div className="mt-1 text-[20px] font-bold text-slate-900 tabular-nums">{value}</div>
            </div>
          ))}
        </section>
      )}

      {key === "customers" && (
        <div className="flex print:hidden">
          <SearchBox value={q} onChange={(text) => { setQ(text); setMore(1); }} placeholder="Search a customer, channel, person or city" />
        </div>
      )}

      <PageState query={query} what="the report" />
      {data && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr>
                  {data.columns.map((column) => {
                    const right = column.kind !== "text";
                    const on = sort?.key === column.key;
                    return (
                      <th key={column.key} className={`border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase first:pl-4 last:pr-4 ${right ? "text-right" : "text-left"}`}>
                        <button
                          type="button"
                          onClick={() => setSort(on ? { key: column.key, up: !sort?.up } : { key: column.key, up: column.kind === "text" })}
                          className={`inline-flex items-center gap-1 uppercase hover:text-slate-900 ${on ? "text-slate-900" : ""}`}
                        >
                          {column.label}
                          {on && (sort?.up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, n) => (
                  <tr key={`${row[data.columns[0]?.key ?? ""]}-${n}`} className={`hover:bg-slate-50/70 ${String(row.code ?? "x") === "" ? "bg-amber-50/50" : ""}`}>
                    {data.columns.map((column, at) => (
                      <td
                        key={column.key}
                        className={`border-b border-slate-100 px-3 py-2.5 first:pl-4 last:pr-4 ${column.kind !== "text" ? "text-right whitespace-nowrap tabular-nums" : ""} ${at === 0 ? "font-semibold text-slate-900" : "text-slate-700"} ${column.key === "owed" && Number(row.owed ?? 0) > 0 ? "font-semibold text-rose-700" : ""}`}
                      >
                        {cell(column.kind, row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  {data.columns.map((column, at) => (
                    <td key={column.key} className={`border-t-2 border-slate-200 px-3 py-2.5 first:pl-4 last:pr-4 ${column.kind !== "text" ? "text-right whitespace-nowrap tabular-nums" : ""}`}>
                      {at === 0 ? String(data.totals[column.key] ?? "Total") : data.totals[column.key] !== undefined ? cell(column.kind, data.totals[column.key]) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          {rows.length > shown.length && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-500 print:hidden">
              <span>
                Showing {count(shown.length)} of {count(rows.length)}
              </span>
              <Button small onClick={() => setMore(more + 1)}>
                Show {count(Math.min(SHOWN, rows.length - shown.length))} more
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
