// The CEO's custom report (Aryan, 22 Nov): pick a person (those who left too), the days and the
// parts to see: orders, invoices, money received, visits, attendance, leave, the old system's
// invoices and everything they did. Each part is a table with its totals; each downloads as CSV.

import type { PersonReport } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { dayLabel, PageState, peso } from "../ui";

const INPUT = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm";
type Section = PersonReport["sections"][number];

function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** A cell as the screen writes it; the CSV keeps pesos as plain numbers. */
const shown = (value: string | number | null, kind: Section["columns"][number]["kind"]) =>
  value === null || value === ""
    ? "—"
    : kind === "money"
      ? peso(Number(value))
      : kind === "day"
        ? dayLabel(String(value))
        : String(value);
const forCsv = (section: Section) => [
  section.columns.map((column) => column.label),
  ...section.rows.map((row) => row.map((value, at) => (section.columns[at]?.kind === "money" && value !== null ? Number(value) / 100 : value))),
];

export function CustomReportPage() {
  const [params, setParams] = useSearchParams();
  const qs = new URLSearchParams();
  for (const key of ["person", "from", "to", "parts"]) {
    const value = params.get(key);
    if (value) qs.set(key, value);
  }
  const query = useQuery({
    queryKey: ["custom-report", qs.toString()],
    queryFn: () => api<PersonReport>(`/api/reports/person?${qs}`),
    placeholderData: keepPreviousData,
  });
  const set = (key: string, value: string) =>
    setParams((now) => {
      const next = new URLSearchParams(now);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  if (!query.data) return <PageState query={query} what="the custom report" />;
  const data = query.data;
  const ticked = (params.get("parts") ?? "").split(",").filter(Boolean);
  const on = (key: string) => !ticked.length || ticked.includes(key);
  const toggle = (key: string) => {
    const all = data.parts.map((part) => part.key);
    const now = ticked.length ? ticked : all;
    const next = now.includes(key) ? now.filter((one) => one !== key) : [...now, key];
    set("parts", next.length === all.length || !next.length ? "" : all.filter((one) => next.includes(one)).join(","));
  };
  const person = data.person;
  const file = (key: string) => `${person?.name ?? "person"}-${key}-${data.from}-to-${data.to}`.replaceAll(" ", "-").toLowerCase();
  return (
    <div className={`mx-auto w-full max-w-screen-xl space-y-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Custom report</h1>
        <p className="mt-1 text-[13px] text-slate-500">Pick a person, the days and what to see. People who left are in the list too.</p>
      </header>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${INPUT} min-w-64`} value={params.get("person") ?? ""} onChange={(event) => set("person", event.target.value)} aria-label="Person">
            <option value="">Pick a person…</option>
            {data.people.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
                {one.title ? ` · ${one.title}` : ""}
                {one.active ? "" : " (left)"}
              </option>
            ))}
          </select>
          <input type="date" className={INPUT} value={data.from} onChange={(event) => set("from", event.target.value)} aria-label="From" />
          <span className="text-sm text-slate-500">to</span>
          <input type="date" className={INPUT} value={data.to} onChange={(event) => set("to", event.target.value)} aria-label="To" />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {data.parts.map((part) => (
            <label key={part.key} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4 accent-emerald-600" checked={on(part.key)} onChange={() => toggle(part.key)} />
              {part.label}
            </label>
          ))}
        </div>
      </div>
      {!person ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Pick a person to see their report.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <p className="text-lg font-semibold text-slate-900">
                {person.name}
                {person.active ? "" : " (left)"}
              </p>
              <p className="text-[13px] text-slate-500">
                {[person.title, person.roleLabel, person.reportsTo ? `reports to ${person.reportsTo}` : null].filter(Boolean).join(" · ")} · {dayLabel(data.from)} to {dayLabel(data.to)}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => downloadCsv(file("all"), data.sections.flatMap((section) => [[section.label], ...forCsv(section), []]))}
            >
              <Download className="size-4" /> Download all (CSV)
            </button>
          </div>
          {data.sections.map((section) => (
            <section key={section.key} className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{section.label}</h2>
                  <p className="mt-0.5 text-[13px] text-slate-600">
                    {section.totals.map((total) => `${total.label}: ${total.money ? peso(total.value) : total.value.toLocaleString("en-PH")}`).join(" · ")}
                    {section.more ? " · only the newest 500 shown: pick fewer days" : ""}
                  </p>
                </div>
                {section.rows.length > 0 && (
                  <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[13px] text-slate-700 hover:bg-slate-50" onClick={() => downloadCsv(file(section.key), forCsv(section))}>
                    <Download className="size-3.5" /> CSV
                  </button>
                )}
              </div>
              {section.rows.length === 0 ? (
                <p className="px-4 py-5 text-sm text-slate-500">Nothing in these days.</p>
              ) : (
                <div className="max-h-[28rem] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                        {section.columns.map((column) => (
                          <th key={column.label} className={`px-3 py-2 ${column.kind === "money" ? "text-right" : ""}`}>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, n) => {
                        const link = section.links[n];
                        return (
                          <tr key={n} className="border-t border-slate-100 align-top">
                            {row.map((value, at) => {
                              const kind = section.columns[at]?.kind ?? "text";
                              const words = shown(value, kind);
                              return (
                                <td key={at} className={`px-3 py-2 ${kind === "money" ? "text-right tabular-nums" : ""} ${kind === "text" && at === row.length - 1 ? "" : "whitespace-nowrap"} text-slate-700`}>
                                  {link && at === 1 ? (
                                    <Link to={link} className="font-medium text-emerald-700 hover:underline">
                                      {words}
                                    </Link>
                                  ) : (
                                    words
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
