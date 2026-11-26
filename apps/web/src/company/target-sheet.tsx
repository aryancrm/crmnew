// The company's target sheet in one click (Aryan, 18 Nov 2026), laid out as the Excel is: Head ·
// Channel · Manager · Sales Person · Zoho name · HQ · target · achieved · balance to do · the day's
// invoicing · %, a total under each manager, each channel and each head, and the grand total.
// Achieved is read from the invoices (VAT out), to the day picked.

import type { TargetSheet } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState } from "../no-results";
import { Button, PageHead, PageState } from "../ui";

type Row = TargetSheet["rows"][number];
const whole = (centavos: number) => Math.round(centavos / 100).toLocaleString("en-US");
const pctOf = (ach: number, target: number) => (target > 0 ? (ach / target) * 100 : null);
/** The sheet's own colours: red under 25%, orange under 50%, yellow under 75%, green from 75%. */
const tone = (pct: number | null) =>
  pct === null ? "bg-slate-100 text-slate-500" : pct < 25 ? "bg-rose-200 text-rose-900" : pct < 50 ? "bg-orange-200 text-orange-900" : pct < 75 ? "bg-amber-100 text-amber-900" : "bg-emerald-200 text-emerald-900";
const sum = (rows: Row[]) => ({
  target: rows.reduce((total, row) => total + row.target, 0),
  ach: rows.reduce((total, row) => total + row.ach, 0),
  today: rows.reduce((total, row) => total + row.today, 0),
});
/** Groups in the sheet's order, keeping the first time each key is met. */
function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return [...out];
}

const TH = "border border-slate-300 bg-slate-800 px-2 py-1.5 text-[11px] font-bold tracking-wide whitespace-nowrap text-white uppercase";
const TD = "border border-slate-200 px-2 py-1 whitespace-nowrap";
const NUM = `${TD} text-right tabular-nums`;

function Figures({ target, ach, today, strong }: { target: number; ach: number; today: number; strong?: boolean }) {
  const pct = pctOf(ach, target);
  return (
    <>
      <td className={`${NUM} ${strong ? "font-bold" : ""}`}>{whole(target)}</td>
      <td className={`${NUM} ${strong ? "font-bold" : ""}`}>{whole(ach)}</td>
      <td className={`${NUM} ${strong ? "font-bold" : ""} ${target - ach < 0 ? "text-emerald-700" : ""}`}>{whole(target - ach)}</td>
      <td className={`${NUM} ${strong ? "font-bold" : ""}`}>{whole(today)}</td>
      <td className={`${NUM} font-semibold ${tone(pct)}`}>{pct === null ? "—" : `${pct.toFixed(2)}%`}</td>
    </>
  );
}

export function TargetSheetPage() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? "";
  const day = params.get("day") ?? "";
  const query = useQuery({
    queryKey: ["target-sheet", month, day],
    queryFn: () => api<TargetSheet>(`/api/target-sheet?${new URLSearchParams({ ...(month ? { month } : {}), ...(day ? { day } : {}) })}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const monthName = data ? new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase() : "";
  const csv = () => {
    if (!data) return;
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Head", "Channel", "Manager", "Sales Person", "Sales code", "HQ", `${monthName} Target`, `${monthName} Ach`, `BTD ${monthName}`, "Today's invoicing", "%"].map(quote).join(","),
      ...data.rows.map((row) =>
        [row.head, row.channel, row.manager, row.salesperson, row.zoho, row.hq ?? "", whole(row.target), whole(row.ach), whole(row.target - row.ach), whole(row.today), pctOf(row.ach, row.target)?.toFixed(2) ?? ""]
          .map(quote)
          .join(","),
      ),
    ];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    link.download = `target-sheet-${data.month}-${data.day}.csv`;
    link.click();
  };
  const grand = data ? sum(data.rows) : null;

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-4">
      <PageHead
        title={data ? `Target sheet · ${monthName} ${data.month.slice(0, 4)}` : "Target sheet"}
        sub={data ? `Achieved to ${data.day}, from the invoices (VAT out). Today's invoicing: ${data.day}.` : undefined}
        actions={
          <span className="flex flex-wrap items-center gap-2 print:hidden">
            {data && data.months.length > 1 && (
              <select className="field h-10" value={data.month} onChange={(event) => setParams({ month: event.target.value }, { replace: true })}>
                {data.months.map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </select>
            )}
            {data && (
              <input
                type="date"
                className="field h-10"
                value={data.day}
                min={`${data.month}-01`}
                onChange={(event) => setParams({ month: data.month, day: event.target.value }, { replace: true })}
                aria-label="Achieved to this day"
              />
            )}
            <Button onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" /> Print
            </Button>
            <Button onClick={csv} disabled={!data}>
              <Download size={16} aria-hidden="true" /> Excel (CSV)
            </Button>
          </span>
        }
      />
      <PageState query={query} what="the target sheet" />
      {data && data.rows.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState title={`No target sheet for ${data.month} yet.`}>
            Once targets are set for the month, each person shows here with their target and what they achieved.
          </EmptyState>
        </div>
      )}
      {data && grand && data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className={TH}>Head</th>
                <th className={TH}>Channel</th>
                <th className={TH}>Manager</th>
                <th className={TH}>Sales Person</th>
                <th className={TH}>Sales code</th>
                <th className={TH}>HQ</th>
                <th className={TH}>{monthName} Target</th>
                <th className={TH}>{monthName} Ach</th>
                <th className={TH}>BTD {monthName}</th>
                <th className={TH}>Today's invoicing</th>
                <th className={TH}>% age</th>
              </tr>
            </thead>
            <tbody>
              {groupBy(data.rows, (row) => row.head).map(([head, headRows]) => {
                const channels = groupBy(headRows, (row) => row.channel);
                // Rows the head's cell spans: every person, each manager's total (when a channel has
                // more than one manager), each channel's total.
                const span = channels.reduce((total, [, channelRows]) => {
                  const managers = groupBy(channelRows, (row) => row.manager);
                  return total + channelRows.length + (managers.length > 1 ? managers.length : 0) + 1;
                }, 0);
                let firstOfHead = true;
                return (
                  <Fragment key={head}>
                    {channels.map(([channel, channelRows]) => {
                      const managers = groupBy(channelRows, (row) => row.manager);
                      const many = managers.length > 1;
                      const channelSpan = channelRows.length + (many ? managers.length : 0);
                      let firstOfChannel = true;
                      return (
                        <Fragment key={channel}>
                          {managers.map(([manager, rows]) => (
                            <Fragment key={manager}>
                              {rows.map((row, at) => {
                                const headCell = firstOfHead;
                                const channelCell = firstOfChannel;
                                firstOfHead = false;
                                firstOfChannel = false;
                                return (
                                  <tr key={row.id} className="hover:bg-sky-50/50">
                                    {headCell && (
                                      <td rowSpan={span} className={`${TD} bg-white text-center align-middle text-[13px] font-bold uppercase`}>
                                        {head}
                                      </td>
                                    )}
                                    {channelCell && (
                                      <td rowSpan={channelSpan} className={`${TD} bg-white text-center align-middle font-semibold uppercase`}>
                                        {channel}
                                      </td>
                                    )}
                                    {at === 0 && (
                                      <td rowSpan={rows.length} className={`${TD} bg-white text-center align-middle font-semibold uppercase`}>
                                        {manager}
                                      </td>
                                    )}
                                    <td className={`${TD} text-center ${/vacant/i.test(row.salesperson) ? "font-semibold text-rose-700" : ""}`} title={row.holder ? `In the ERP: ${row.holder}` : "Not tied to a seat in the ERP"}>
                                      {row.salesperson}
                                    </td>
                                    <td className={`${TD} text-center`}>{row.zoho}</td>
                                    <td className={`${TD} text-center`}>{row.hq}</td>
                                    <Figures target={row.target} ach={row.ach} today={row.today} />
                                  </tr>
                                );
                              })}
                              {many && (
                                <tr className="bg-slate-100">
                                  <td colSpan={4} className={`${TD} text-right text-[11.5px] font-bold uppercase`}>
                                    Total
                                  </td>
                                  <Figures {...sum(rows)} strong />
                                </tr>
                              )}
                            </Fragment>
                          ))}
                          <tr className="bg-slate-200">
                            <td colSpan={5} className={`${TD} font-bold uppercase`}>
                              {channel} Total
                            </td>
                            <Figures {...sum(channelRows)} strong />
                          </tr>
                        </Fragment>
                      );
                    })}
                    <tr className="bg-orange-100">
                      <td colSpan={6} className={`${TD} font-bold text-rose-700 uppercase`}>
                        {head} Total
                      </td>
                      <Figures {...sum(headRows)} strong />
                    </tr>
                  </Fragment>
                );
              })}
              <tr className="bg-sky-200">
                <td colSpan={6} className={`${TD} text-[13px] font-bold uppercase`}>
                  Grand Total
                </td>
                <Figures {...grand} strong />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {data && data.apart.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 print:hidden">
          <h2 className="text-[14px] font-semibold text-amber-950">Sold this month under names on no row of the sheet</h2>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            {data.apart.map((one) => (
              <li key={one.name} className="flex justify-between gap-3">
                <span className="truncate">{one.name}</span>
                <span className="tabular-nums">₱{whole(one.ach)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
