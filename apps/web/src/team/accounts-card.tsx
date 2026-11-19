// The customers of the box opened on a lead's Home (Aryan, 19 Nov: "B2B: what her team does and from
// where; BID: which hospitals they went to; CLIDP: which pharmacies, who agreed; HOSP: which
// hospitals each has, whom to call"): how many buy, where, which are due, late or stopped against
// their own gap, what each bought this month and in the year, what it owes, the last call to it.

import type { TeamAccounts } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { exactPeso, shortPeso } from "../ceo";
import { withUnit } from "./switch";

type Row = TeamAccounts["rows"][number];
type State = Row["state"];

/** What a channel calls its customers. */
const TITLE: Record<string, string> = {
  B2B: "Accounts, and where B2B sells",
  BID: "Hospitals and agencies",
  CLIDP: "Pharmacies and distributors",
  HOSP: "Hospitals",
  MT: "Chains and drugstores",
  "RX Business": "Doctors' accounts",
  "MD Telesales": "Accounts",
  TeleSales: "Hospitals and doctors",
};

const STATE: Record<State, { word: string; pill: string }> = {
  new: { word: "New this month", pill: "bg-sky-50 text-sky-800" },
  ok: { word: "Buying", pill: "bg-emerald-50 text-emerald-800" },
  due: { word: "Due this week", pill: "bg-amber-50 text-amber-800" },
  late: { word: "Late", pill: "bg-orange-50 text-orange-800" },
  stopped: { word: "Stopped 90+ days", pill: "bg-rose-50 text-rose-800" },
  lost: { word: "Lost 180+ days", pill: "bg-slate-100 text-slate-600" },
  never: { word: "Never ordered", pill: "bg-slate-100 text-slate-500" },
};

const TABS: { key: "all" | "buying" | State; label: string }[] = [
  { key: "all", label: "All" },
  { key: "buying", label: "Bought this month" },
  { key: "due", label: "Due" },
  { key: "late", label: "Late" },
  { key: "stopped", label: "Stopped" },
  { key: "lost", label: "Lost" },
  { key: "new", label: "New" },
  { key: "never", label: "Never ordered" },
];

const ago = (days: number | null) =>
  days === null ? "—" : days === 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`;

export function TeamAccountsCard({ unit = null, division }: { unit?: number | null; division: string | null }) {
  const query = useQuery({
    queryKey: ["team", "accounts", unit ?? ""],
    queryFn: () => api<TeamAccounts>(withUnit("/api/team/accounts", unit ? String(unit) : null)),
  });
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [all, setAll] = useState(false);
  const data = query.data;
  if (!data || data.rows.length === 0) return null;
  const { counts } = data;
  const shown = data.rows.filter((row) =>
    tab === "all" ? true : tab === "buying" ? row.soldMonth > 0 : row.state === tab,
  );
  const page = all ? shown : shown.slice(0, 25);
  const countOf = (key: (typeof TABS)[number]["key"]) =>
    key === "all" ? counts.accounts : key === "buying" ? counts.buying : key === "never" ? data.rows.filter((row) => row.state === "never").length : counts[key as Exclude<State, "never" | "ok">];
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-2 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-900">{TITLE[division ?? ""] ?? "Customers"}</h2>
        <span className="text-xs text-slate-500">
          {counts.accounts} accounts · {counts.buying} bought this month · {counts.called} called
        </span>
      </header>

      {/* Where they buy: the cities with the most sold in the last 12 months. */}
      {data.cities.some((one) => one.city !== "No city") && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3 sm:px-5">
          {data.cities
            .filter((one) => one.city !== "No city")
            .map((one) => (
              <span key={one.city} className="rounded-lg bg-slate-50 px-2 py-1 text-[11.5px] text-slate-700 ring-1 ring-slate-200">
                <b className="font-semibold">{one.city}</b> · {one.accounts} · {shortPeso(one.soldYear)} a year
              </span>
            ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-y border-slate-100 bg-slate-50/60 px-3 py-1.5 sm:px-4" role="tablist" aria-label="Which accounts">
        {TABS.map((one) => {
          const n = countOf(one.key);
          if (one.key !== "all" && n === 0) return null;
          return (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={tab === one.key}
              onClick={() => {
                setTab(one.key);
                setAll(false);
              }}
              className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${tab === one.key ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"}`}
            >
              {one.label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
              <th className="px-4 py-2 sm:px-5">Customer</th>
              <th className="px-3 py-2">Seller</th>
              <th className="px-3 py-2">Last order</th>
              <th className="px-3 py-2 text-right">This month</th>
              <th className="px-3 py-2 text-right">12 months</th>
              <th className="px-3 py-2 text-right">Owed</th>
              <th className="px-3 py-2">Last call</th>
              <th className="px-3 py-2">Now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {page.map((row) => (
              <tr key={row.customerId} className="hover:bg-slate-50/70">
                <td className="max-w-64 px-4 py-2 sm:px-5">
                  <Link to={`/customers/${row.customerId}`} className="block truncate font-semibold text-slate-900 hover:underline">
                    {row.name}
                  </Link>
                  <span className="block truncate text-[11px] text-slate-500">
                    {[row.kind, row.city].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{row.seller ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                  {ago(row.since)}
                  {row.usual && row.state !== "never" && <span className="block text-[11px] text-slate-400">every ~{row.usual} days</span>}
                </td>
                <td className="px-3 py-2 text-right text-slate-800 tabular-nums" title={exactPeso(row.soldMonth)}>
                  {row.soldMonth ? shortPeso(row.soldMonth) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-slate-800 tabular-nums" title={exactPeso(row.soldYear)}>
                  {row.soldYear ? shortPeso(row.soldYear) : "—"}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${row.overdue > 0 ? "text-rose-700" : "text-slate-800"}`} title={`Overdue ${exactPeso(row.overdue)}`}>
                  {row.owed ? shortPeso(row.owed) : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                  {row.lastCallOn ?? "—"}
                  {row.lastOutcome && <span className="block text-[11px] text-slate-400">{row.lastOutcome}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATE[row.state].pill}`}>
                    {STATE[row.state].word}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > page.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50"
        >
          Show all {shown.length}
        </button>
      )}
    </section>
  );
}
