// Audit (docs/ERP-PLAN.md phase 2): who did what, when, across the CRM, in one list: orders, cases,
// tenders, registrations, stock, payments and refunds, seats, and Zoho's own log. Filter by kind,
// person, words and days; each line opens its record. For the CEO and the Admin.

import type { AuditTrail } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PageState } from "../ui";

const INPUT = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm";
const when = (at: string) =>
  new Date(at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const qs = new URLSearchParams();
  for (const key of ["kind", "who", "q", "from", "to", "page"]) {
    const value = params.get(key);
    if (value) qs.set(key, value);
  }
  const query = useQuery({
    queryKey: ["audit", qs.toString()],
    queryFn: () => api<AuditTrail>(`/api/audit?${qs}`),
    placeholderData: keepPreviousData,
  });
  const set = (key: string, value: string) =>
    setParams((now) => {
      const next = new URLSearchParams(now);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    });
  if (!query.data) return <PageState query={query} what="the audit" />;
  const data = query.data;
  return (
    <div className={`mx-auto w-full max-w-screen-xl space-y-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Audit</h1>
        <p className="mt-1 text-[13px] text-slate-500">Who did what, when: every order step, case, tender, registration, stock move, payment, refund and seat change, and the old system's own log.</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <select className={INPUT} value={params.get("kind") ?? ""} onChange={(event) => set("kind", event.target.value)} aria-label="Kind">
          <option value="">Everything</option>
          {data.kinds.map((kind) => (
            <option key={kind.key} value={kind.key}>
              {kind.label}
            </option>
          ))}
        </select>
        <input className={`${INPUT} w-44`} placeholder="Who (a name)" defaultValue={params.get("who") ?? ""} onBlur={(event) => set("who", event.target.value.trim())} onKeyDown={(event) => event.key === "Enter" && set("who", event.currentTarget.value.trim())} />
        <input className={`${INPUT} w-56`} placeholder="Words, an order or invoice number" defaultValue={params.get("q") ?? ""} onBlur={(event) => set("q", event.target.value.trim())} onKeyDown={(event) => event.key === "Enter" && set("q", event.currentTarget.value.trim())} />
        <input type="date" className={INPUT} value={params.get("from") ?? ""} onChange={(event) => set("from", event.target.value)} aria-label="From" />
        <span className="text-sm text-slate-500">to</span>
        <input type="date" className={INPUT} value={params.get("to") ?? ""} onChange={(event) => set("to", event.target.value)} aria-label="To" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">Record</th>
              <th className="px-3 py-2">What happened</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, n) => (
              <tr key={`${line.at}-${n}`} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{when(line.at)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-900">{line.who}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{data.kinds.find((kind) => kind.key === line.kind)?.label ?? line.kind}</span>
                  {line.link ? (
                    <Link to={line.link} className="font-semibold text-brand hover:underline">
                      {line.record ?? "Open"}
                    </Link>
                  ) : (
                    line.record
                  )}
                </td>
                <td className="px-3 py-2 text-slate-800">{line.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.lines.length && <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing matches.</p>}
      </div>
      <div className="flex items-center justify-end gap-2 text-sm">
        <button type="button" disabled={data.page <= 1} onClick={() => set("page", String(data.page - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">
          Newer
        </button>
        <span className="text-slate-500">Page {data.page}</span>
        <button type="button" disabled={!data.more} onClick={() => set("page", String(data.page + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">
          Older
        </button>
      </div>
    </div>
  );
}
