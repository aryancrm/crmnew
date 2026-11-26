// HR's reports (docs/HR-PLAN.md, "Documents, imports and reports", 26 Nov): the list by group, and
// one report with its filters, headline figures and table, downloaded as Excel or printed (saved as
// PDF) on the letterhead with who prepared it, remarks and the signatories (remembered on this
// computer).

import { COMPANIES, COMPANY_CODES } from "@2mg/api/companies";
import type { HrReport, HrReportColumn, HrReportList, HrReportValue } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, Printer } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, Card, count, INPUT, PageHead, PageState } from "../ui";
import { LetterheadBlock, PaperFoot } from "./paper";

/** Every report, by group. */
export function ReportsPage() {
  const query = useQuery({ queryKey: ["hr", "reports"], queryFn: () => api<HrReportList>("/api/hr/reports") });
  const data = query.data;
  if (!data) return <PageState query={query} what="the reports" />;
  const groups = [...new Set(data.reports.map((one) => one.group))];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHead title="Reports" sub="Each report on the screen, in Excel, or printed on the letterhead with who prepared it and the signatories." />
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.reports
              .filter((one) => one.group === group)
              .map((one) => (
                <Link key={one.key} to={`/hr/reports/${one.key}`} className="group">
                  <Card className="flex h-full flex-col gap-1 p-4 transition-colors group-hover:border-brand">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <BarChart3 size={15} aria-hidden="true" /> {one.title}
                    </div>
                    <p className="text-sm text-slate-600">{one.what}</p>
                  </Card>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const show = (value: HrReportValue, type: HrReportColumn["type"]) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number") return value;
  if (type === "percent") return `${value.toLocaleString("en-PH", { maximumFractionDigits: 1 })}%`;
  if (type === "hours") return value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return count(value);
};
const RIGHT = new Set<HrReportColumn["type"]>(["number", "hours", "percent", "money"]);

type Signatories = { checkedBy: string; checkedTitle: string; approvedBy: string; approvedTitle: string };
const SIGNERS_KEY = "hr-report-signatories";
const savedSigners = (): Signatories => {
  try {
    return { checkedBy: "", checkedTitle: "", approvedBy: "", approvedTitle: "", ...JSON.parse(localStorage.getItem(SIGNERS_KEY) ?? "{}") };
  } catch {
    return { checkedBy: "", checkedTitle: "", approvedBy: "", approvedTitle: "" };
  }
};

/** One report: filters, figures, the table; Excel and print. */
export function ReportPage() {
  const { key = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const asked = new URLSearchParams(params);
  const query = useQuery({
    queryKey: ["hr", "report", key, asked.toString()],
    queryFn: () => api<HrReport>(`/api/hr/reports/${key}?${asked}`),
    placeholderData: (previous) => (previous?.key === key ? previous : undefined),
  });
  const [remarks, setRemarks] = useState("");
  const [signers, setSigners] = useState<Signatories>(savedSigners);
  const report = query.data;
  if (!report) return <PageState query={query} what="the report" />;
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const sign = (name: keyof Signatories, value: string) => {
    const next = { ...signers, [name]: value };
    setSigners(next);
    localStorage.setItem(SIGNERS_KEY, JSON.stringify(next));
  };
  const excel = `/api/hr/reports/${report.key}.xlsx?${asked}`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="print:hidden">
        <PageHead
          title={report.title}
          sub={report.what}
          actions={
            <>
              <Link to="/hr/reports" className="inline-flex h-8 items-center rounded-[10px] px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-100">
                All reports
              </Link>
              <a href={excel} download>
                <Button small>
                  <Download size={14} /> Excel
                </Button>
              </a>
              <Button small variant="primary" onClick={() => window.print()}>
                <Printer size={14} /> Print or save as PDF
              </Button>
            </>
          }
        >
          <div className="flex flex-wrap items-end gap-3 text-xs">
            {report.period === "range" && (
              <>
                <label className="flex flex-col gap-1 font-semibold text-slate-600">
                  From
                  <input type="date" className={`${INPUT} h-9 w-40`} value={report.asked.from} onChange={(event) => set("from", event.target.value)} />
                </label>
                <label className="flex flex-col gap-1 font-semibold text-slate-600">
                  To
                  <input type="date" className={`${INPUT} h-9 w-40`} value={report.asked.to} onChange={(event) => set("to", event.target.value)} />
                </label>
              </>
            )}
            {report.period === "day" && (
              <label className="flex flex-col gap-1 font-semibold text-slate-600">
                As of
                <input type="date" className={`${INPUT} h-9 w-40`} value={report.asked.to} onChange={(event) => set("to", event.target.value)} />
              </label>
            )}
            {report.period === "year" && (
              <label className="flex flex-col gap-1 font-semibold text-slate-600">
                Year
                <input
                  type="number"
                  className={`${INPUT} h-9 w-28`}
                  min={2020}
                  max={2100}
                  value={report.asked.year}
                  onChange={(event) => set("year", event.target.value)}
                />
              </label>
            )}
            {report.period === "ahead" && (
              <label className="flex flex-col gap-1 font-semibold text-slate-600">
                Days ahead
                <select className={`${INPUT} h-9 w-32`} value={report.asked.days} onChange={(event) => set("days", event.target.value)}>
                  {[7, 14, 30, 60, 90].map((days) => (
                    <option key={days} value={days}>
                      {days} days
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 font-semibold text-slate-600">
              Company
              <select className={`${INPUT} h-9 w-64`} value={report.asked.company ?? ""} onChange={(event) => set("company", event.target.value)}>
                <option value="">Both companies</option>
                {COMPANY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {COMPANIES[code].name}
                  </option>
                ))}
              </select>
            </label>
            {query.isFetching && <span className="pb-2 text-slate-500">Updating…</span>}
          </div>
        </PageHead>
      </div>

      <article className="flex flex-col gap-4 text-[13px] text-slate-900">
        <div className="hidden print:block">
          <LetterheadBlock letterhead={report.letterhead} title={report.title} sub={report.periodWords} />
        </div>
        <div className="text-sm font-semibold text-slate-700 print:hidden">{report.periodWords}</div>
        <div className="flex flex-wrap gap-3">
          {report.figures.map((figure) => (
            <div key={figure.label} className="min-w-36 rounded-xl border border-slate-200 px-4 py-2.5 print:rounded-none print:border-slate-400">
              <div className="text-xs text-slate-500">{figure.label}</div>
              <div className="text-xl font-semibold tabular-nums">{figure.value}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 print:overflow-visible print:rounded-none print:border-0">
          <table className="w-full text-sm print:text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
                {report.columns.map((column) => (
                  <th key={column.key} className={`px-3 py-2 ${RIGHT.has(column.type) ? "text-right" : ""}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a report's rows have no id; their order is fixed.
                <tr key={index} className="break-inside-avoid">
                  {report.columns.map((column) => (
                    <td key={column.key} className={`px-3 py-1.5 ${RIGHT.has(column.type) ? "text-right tabular-nums" : ""}`}>
                      {show(row[column.key] ?? null, column.type)}
                    </td>
                  ))}
                </tr>
              ))}
              {!report.rows.length && (
                <tr>
                  <td colSpan={report.columns.length} className="px-3 py-6 text-center text-slate-500">
                    Nothing in this period.
                  </td>
                </tr>
              )}
            </tbody>
            {report.totals && report.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  {report.columns.map((column) => (
                    <td key={column.key} className={`px-3 py-2 ${RIGHT.has(column.type) ? "text-right tabular-nums" : ""}`}>
                      {report.totals?.[column.key] === "" ? "" : show(report.totals?.[column.key] ?? null, column.type)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <section className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-600 print:hidden" htmlFor="report-remarks">
            Remarks (printed under the table)
          </label>
          <textarea
            id="report-remarks"
            className={`${INPUT} min-h-16 print:hidden`}
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
          />
          {remarks && (
            <p className="hidden whitespace-pre-wrap print:block">
              <span className="font-semibold">Remarks: </span>
              {remarks}
            </p>
          )}
        </section>

        <section className="grid gap-6 sm:grid-cols-3 print:mt-8 print:grid-cols-3">
          <div className="flex flex-col items-center text-center">
            <div className="h-10" />
            <div className="w-full border-t border-slate-900 pt-1 font-semibold">{report.preparedBy}</div>
            <div className="text-xs text-slate-600">Prepared by</div>
          </div>
          {(
            [
              ["checkedBy", "checkedTitle", "Checked by"],
              ["approvedBy", "approvedTitle", "Approved by"],
            ] as const
          ).map(([name, title, box]) => (
            <div key={box} className="flex flex-col items-center text-center">
              <div className="h-10" />
              <input
                aria-label={`${box}: name`}
                placeholder="Name"
                className="w-full border-0 border-t border-slate-900 bg-transparent pt-1 text-center font-semibold outline-none"
                value={signers[name]}
                onChange={(event) => sign(name, event.target.value)}
              />
              <input
                aria-label={`${box}: title`}
                placeholder="Title"
                className="w-full border-0 bg-transparent text-center text-xs text-slate-600 outline-none"
                value={signers[title]}
                onChange={(event) => sign(title, event.target.value)}
              />
              <div className="text-xs text-slate-600">{box}</div>
            </div>
          ))}
        </section>
        <div className="hidden print:block">
          <PaperFoot letterhead={report.letterhead} />
        </div>
      </article>
    </div>
  );
}
