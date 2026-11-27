// The prescription business at a glance (Aryan, 19 Nov: "press RX: Honey, her whole team, what the
// team is doing and where, right now; the sales they made, A to Z"): each person's day (visits
// today, the last check-in and where) and month (prescriptions, the doctors who wrote them, the
// first-time ones, the value, the guarantee letters), the doctors prescribing most, and the
// guarantee letters by agency from received to paid. A CHC sees their own; a lead their team.

import type { RxBusiness } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { exactPeso, shortPeso } from "../ceo";
import { withUnit } from "../team/switch";
import { CARD, PageHead, PageState } from "../ui";
import { EmptyState, NoInvoicesArt } from "../no-results";

const day = (value: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";

function useRx(unit: number | null = null) {
  return useQuery({
    queryKey: ["rx", "business", unit ?? ""],
    queryFn: () => api<RxBusiness>(withUnit("/api/rx/business", unit ? String(unit) : null)),
  });
}

export function RxBusinessPage() {
  const me = useMe().data;
  const query = useRx();
  if (!query.data) return <PageState query={query} what="the prescriptions" />;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHead
        title={me?.role === "medrep" ? "My prescriptions" : "Prescriptions and letters"}
        sub="The doctors writing for us, the first-time ones, and the guarantee letters by agency"
      />
      <Business data={query.data} />
    </div>
  );
}

/** On a Home: a CHC's own, or the head's RX channel for one box. */
export function RxBusinessCard({ unit = null }: { unit?: number | null }) {
  const query = useRx(unit);
  if (!query.data || (query.data.people.length === 0 && query.data.doctors.length === 0)) return null;
  return <Business data={query.data} compact />;
}

function Business({ data, compact }: { data: RxBusiness; compact?: boolean }) {
  const [allDoctors, setAllDoctors] = useState(!compact);
  const s = data.summary;
  const many = data.people.length > 1;
  const doctors = allDoctors ? data.doctors : data.doctors.slice(0, 8);
  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Prescriptions", String(s.prescriptions), "this month"],
            ["Doctors prescribing", String(s.prescribers), "this month"],
            ["New prescribers", String(s.newPrescribers), "first time this month"],
            ["Prescribed value", shortPeso(s.value), "this month"],
            ["Visits today", `${s.visitsDoneToday} of ${s.visitsToday}`, "done of planned"],
            ["Letters open", String(s.glOpen), s.glOpen ? shortPeso(s.glOpenAmount) : "none waiting"],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} className={`${CARD} p-3`}>
            <p className="text-[12px] text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
            <p className="truncate text-[11.5px] text-slate-500">{hint}</p>
          </div>
        ))}
      </section>

      {many && (
        <section className={`${CARD} min-w-0 overflow-x-auto`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            Each person <span className="font-normal text-slate-400">· today and this month</span>
          </h3>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                <th className="px-4 py-2">Person</th>
                <th className="px-3 py-2">Today</th>
                <th className="px-3 py-2 text-right">Prescriptions</th>
                <th className="px-3 py-2 text-right">Doctors</th>
                <th className="px-3 py-2 text-right">New</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-right">Letters</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...data.people]
                .sort((a, b) => b.value - a.value)
                .map((one) => (
                  <tr key={one.personId}>
                    <td className="px-4 py-2">
                      <span className="font-semibold text-slate-900">{one.name}</span>
                      <span className="block text-[11px] text-slate-500">
                        {[one.title, one.area?.split("|").slice(1, 2).join("").trim() || null].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      {one.visitsToday ? `${one.doneToday} of ${one.visitsToday} visits` : "No visit planned"}
                      {one.lastCheckIn && (
                        <span className="block text-[11px] text-slate-500">
                          last at {one.lastCheckIn} · {one.lastCheckInAt}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{one.prescriptions}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{one.prescribers}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{one.newPrescribers}</td>
                    <td className="px-3 py-2 text-right tabular-nums" title={exactPeso(one.value)}>
                      {one.value ? shortPeso(one.value) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{one.letters || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <section className={`${CARD} min-w-0 overflow-x-auto`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            Doctors prescribing most <span className="font-normal text-slate-400">· the last 90 days</span>
          </h3>
          {data.doctors.length === 0 ? (
            <EmptyState title="No order written with a doctor in 90 days.">The doctors prescribing most over the last 90 days show here.</EmptyState>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                  <th className="px-4 py-2">Doctor</th>
                  <th className="px-3 py-2">Seller</th>
                  <th className="px-3 py-2 text-right">Orders</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">Last</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {doctors.map((one) => (
                  <tr key={`${one.name}-${one.firstOn}`}>
                    <td className="px-4 py-2">
                      {one.customerId ? (
                        <Link to={`/customers/${one.customerId}`} className="font-semibold text-slate-900 hover:underline">
                          {one.name}
                        </Link>
                      ) : (
                        <span className="font-semibold text-slate-900">{one.name}</span>
                      )}
                      <span className="block text-[11px] text-slate-500">
                        {[one.specialty, one.city, `writing since ${day(one.firstOn)}`].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{one.seller ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{one.orders}</td>
                    <td className="px-3 py-2 text-right tabular-nums" title={exactPeso(one.value)}>
                      {shortPeso(one.value)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{day(one.lastOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.doctors.length > doctors.length && (
            <button
              type="button"
              onClick={() => setAllDoctors(true)}
              className="w-full border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50"
            >
              Show all {data.doctors.length}
            </button>
          )}
        </section>

        <section className={`${CARD} min-w-0 overflow-x-auto`}>
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            Guarantee letters <span className="font-normal text-slate-400">· by agency, the last 12 months</span>
          </h3>
          {data.letters.length === 0 ? (
            <EmptyState art={<NoInvoicesArt size={72} />} title="No guarantee letter in 12 months.">Guarantee letters over the last 12 months show here, by agency.</EmptyState>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
                  <th className="px-4 py-2">Agency</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Serving</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Before (Zoho)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.letters.map((one) => (
                  <tr key={one.programme}>
                    <td className="px-4 py-2 font-semibold text-slate-900">{one.programme}</td>
                    {([one.received, one.serving, one.billed, one.paid, one.zoho] as const).map((cell, index) => (
                      <td key={index} className="px-3 py-2 text-right tabular-nums">
                        {cell.count ? (
                          <>
                            {cell.count}
                            <span className="block text-[11px] text-slate-500">{shortPeso(cell.amount)}</span>
                          </>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {compact && (
            <Link to="/rx/business" className="block border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50">
              Every doctor and letter
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
