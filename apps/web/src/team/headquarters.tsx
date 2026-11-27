// Headquarters (Aryan, 27 Nov: "the main thing is the Headquarter; Javed opens his screen and sees HQ
// NCL, who works in it, its data, in this hierarchy"; PLAN 257). Laid out as his sheet photo: each
// channel with its manager, then each HQ: who works it, its Zoho name, what it sold this month and
// today, the channel's total and the whole. A press on an HQ opens who worked it before and its
// customers. Targets come in once it is decided where they are set.

import type { Headquarters } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { exactPeso, monthName, shiftMonth, shortPeso } from "../ceo";
import { CARD, PageHead, PageState } from "../ui";

const day = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const TH = "px-3 py-2 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase";

export function HeadquartersPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("month") ?? "";
  const query = useQuery({
    queryKey: ["headquarters", asked],
    queryFn: () => api<Headquarters>(`/api/headquarters${asked ? `?month=${asked}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const [open, setOpen] = useState<number | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the headquarters" />;
  const current = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 7);
  const goTo = (month: string) => setParams(month >= current ? {} : { month }, { replace: true });
  const arrow = "grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent";
  const count = data.channels.reduce((sum, one) => sum + one.hqs.length, 0);

  return (
    <div className={`mx-auto w-full max-w-6xl space-y-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title="Headquarters"
        sub={`Each HQ of your team: who works it, and what it sold in ${monthName(data.month)}. Counted to ${day(data.day)}.`}
        actions={
          <nav aria-label="Month" className={`${CARD} flex items-center p-0.5`}>
            <button type="button" aria-label="Month before" onClick={() => goTo(shiftMonth(data.month, -1))} className={arrow}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-32 px-1 text-center text-sm font-semibold text-slate-900">{monthName(data.month)}</span>
            <button
              type="button"
              aria-label="Month after"
              disabled={data.month >= current}
              onClick={() => goTo(shiftMonth(data.month, 1))}
              className={arrow}
            >
              <ChevronRight className="size-4" />
            </button>
          </nav>
        }
      />

      {count === 0 ? (
        <section className={`${CARD} px-5 py-8 text-center text-sm text-slate-500`}>No headquarters in your team yet.</section>
      ) : (
        <section className={`${CARD} min-w-0 overflow-x-auto`}>
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className={`${TH} pl-4`}>HQ</th>
                <th className={TH}>Works it</th>
                <th className={TH}>Zoho name</th>
                <th className={`${TH} text-right`}>Sold this month</th>
                <th className={`${TH} text-right`}>Today</th>
                <th className={`${TH} pr-4 text-right`}>Customers</th>
              </tr>
            </thead>
            {data.channels.map((channel) => (
              <tbody key={channel.unitId} className="divide-y divide-slate-100 border-b border-slate-200">
                <tr className="bg-slate-50/80">
                  <th colSpan={6} className="px-4 py-2 text-left text-[13px] font-semibold text-slate-900">
                    {channel.name}
                    {channel.manager && <span className="font-normal text-slate-500"> · Manager: {channel.manager}</span>}
                  </th>
                </tr>
                {channel.hqs.map((hq) => {
                  const shown = open === hq.seatId;
                  return (
                    <Fragment key={hq.seatId}>
                      <tr
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setOpen(shown ? null : hq.seatId)}
                        aria-expanded={shown}
                      >
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
                            <ChevronDown className={`size-3.5 text-slate-400 transition-transform ${shown ? "" : "-rotate-90"}`} aria-hidden="true" />
                            {hq.hq}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {hq.person ? (
                            <span className="text-slate-800">{hq.person}</span>
                          ) : (
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-600">EMPTY</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{hq.zoho}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums" title={exactPeso(hq.sold)}>
                          {hq.sold ? shortPeso(hq.sold) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums" title={exactPeso(hq.today)}>
                          {hq.today ? shortPeso(hq.today) : "—"}
                        </td>
                        <td className="px-3 py-2.5 pr-4 text-right tabular-nums">{hq.customers.toLocaleString("en-PH")}</td>
                      </tr>
                      {shown && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={6} className="px-4 pt-1 pb-3">
                            <div className="grid gap-3 pl-5 text-[12.5px] text-slate-600 sm:grid-cols-3">
                              <div>
                                <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Works it now</p>
                                <p className="mt-0.5 text-slate-900">
                                  {hq.person ? `${hq.person}${hq.since ? `, since ${day(hq.since)}` : ""}` : "Nobody: the HQ is empty"}
                                </p>
                                <p className="text-slate-500">{hq.title}</p>
                                {hq.personId && (
                                  <Link to={`/my/score?person=${hq.personId}`} className="font-semibold text-emerald-700 hover:underline">
                                    Their scorecard
                                  </Link>
                                )}
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Worked it before</p>
                                {hq.before.length ? (
                                  <ul className="mt-0.5 space-y-0.5">
                                    {hq.before.map((one) => (
                                      <li key={`${one.name}-${one.from}`} className="text-slate-800">
                                        {one.name} <span className="text-slate-500">· {day(one.from)} to {day(one.to)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mt-0.5 text-slate-500">Nobody else in this CRM</p>
                                )}
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">This month</p>
                                <p className="mt-0.5 text-slate-900">
                                  {shortPeso(hq.sold)} sold · {shortPeso(hq.today)} today
                                </p>
                                <p className="text-slate-500">{hq.customers.toLocaleString("en-PH")} customers in this HQ</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                <tr className="bg-slate-50/80 font-semibold text-slate-900">
                  <td colSpan={3} className="px-4 py-2 text-[12.5px]">
                    {channel.name} total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" title={exactPeso(channel.sold)}>
                    {shortPeso(channel.sold)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" title={exactPeso(channel.today)}>
                    {shortPeso(channel.today)}
                  </td>
                  <td className="px-3 py-2 pr-4 text-right tabular-nums">{channel.hqs.length} HQs</td>
                </tr>
              </tbody>
            ))}
            <tfoot>
              <tr className="bg-slate-100 font-bold text-slate-900">
                <td colSpan={3} className="px-4 py-2.5">
                  Total
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" title={exactPeso(data.sold)}>
                  {shortPeso(data.sold)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" title={exactPeso(data.today)}>
                  {shortPeso(data.today)}
                </td>
                <td className="px-3 py-2.5 pr-4 text-right tabular-nums">{count} HQs</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </div>
  );
}
