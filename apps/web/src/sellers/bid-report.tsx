// The bid report (Aryan, 19 Nov: "where they went to bid, how much the others quoted, was ours
// approved or not, why not, how low the price went"): for the days picked (this year so far), every
// tender bid with every price read and where ours stood; then by agency, why we lost, the
// securities still out, the awards late in delivery, and the bids coming up. Each person sees
// their own tenders, a lead their team's, the bidding line and the heads every one.

import type { BidReport, TenderReason } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { exactPeso, shortPeso } from "../ceo";
import { withUnit } from "../team/switch";
import { CARD, PageHead, PageState } from "../ui";
import { REASON } from "./tender-words";

const RESULT: Record<BidReport["rows"][number]["result"], { word: string; pill: string }> = {
  won: { word: "Won", pill: "bg-emerald-50 text-emerald-800" },
  lost: { word: "Lost", pill: "bg-rose-50 text-rose-800" },
  failed: { word: "Failed bidding", pill: "bg-slate-100 text-slate-700" },
  pending: { word: "Awaiting result", pill: "bg-amber-50 text-amber-800" },
};
const day = (value: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const when = (at: string | null) =>
  at ? new Date(at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }) : "no deadline yet";

function useReport(from: string, to: string, unit: number | null = null) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return useQuery({
    queryKey: ["tenders", "report", from, to, unit ?? ""],
    queryFn: () => api<BidReport>(withUnit(`/api/tenders/report${qs.size ? `?${qs}` : ""}`, unit ? String(unit) : null)),
  });
}

export function BidReportPage() {
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const query = useReport(from, to);
  const data = query.data;
  if (!data) return <PageState query={query} what="the bid report" />;
  const set = (key: "from" | "to", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHead
        title="Bid report"
        sub={`Where we bid, every price read, won or lost and why · ${day(data.from)} to ${day(data.to)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
            <label className="flex items-center gap-1.5">
              From
              <input type="date" className="field h-9" value={from || data.from} onChange={(event) => set("from", event.target.value)} />
            </label>
            <label className="flex items-center gap-1.5">
              to
              <input type="date" className="field h-9" value={to || data.to} onChange={(event) => set("to", event.target.value)} />
            </label>
          </div>
        }
      />
      <Summary data={data} />
      <ComingUp data={data} />
      <Results data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ByAgency data={data} />
        <Reasons data={data} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Securities data={data} />
        <Late data={data} />
      </div>
    </div>
  );
}

function Summary({ data }: { data: BidReport }) {
  const s = data.summary;
  const cells: [string, string, string][] = [
    ["Bids", String(s.joined), `${s.pending} awaiting the result`],
    ["Won", String(s.won), shortPeso(s.wonValue)],
    ["Lost", String(s.lost), shortPeso(s.lostValue)],
    ["Win rate", s.winRate === null ? "—" : `${s.winRate}%`, "of the bids decided"],
    ["Above the winner", s.avgGapPct === null ? "—" : `${s.avgGapPct}%`, "on average, on the bids lost"],
    ["Failed biddings", String(s.failed), "no award: bid again"],
  ];
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map(([label, value, hint]) => (
        <div key={label} className={`${CARD} p-3`}>
          <p className="text-[12px] text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
          <p className="text-[11.5px] text-slate-500">{hint}</p>
        </div>
      ))}
    </section>
  );
}

function ComingUp({ data, limit }: { data: BidReport; limit?: number }) {
  const rows = limit ? data.comingUp.slice(0, limit) : data.comingUp;
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        Coming up <span className="font-normal text-slate-400">· where we bid next, the nearest deadline first</span>
      </h3>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">No tender is being prepared. Each one found on PhilGEPS is recorded under Tenders.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
              <th className="px-4 py-2">Deadline</th>
              <th className="px-3 py-2">Agency</th>
              <th className="px-3 py-2">Tender</th>
              <th className="px-3 py-2 text-right">ABC</th>
              <th className="px-3 py-2">Pre-bid</th>
              <th className="px-3 py-2">Run by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2 whitespace-nowrap">{when(t.deadlineAt)}</td>
                <td className="px-3 py-2">
                  {t.agency}
                  {t.agencyCity && <span className="block text-[11px] text-slate-500">{t.agencyCity}</span>}
                </td>
                <td className="px-3 py-2">
                  <Link to={`/tenders/${t.id}`} className="font-semibold text-slate-900 hover:underline">
                    {t.code}
                  </Link>
                  <span className="block text-[11px] text-slate-500">{t.title}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{t.abc ? shortPeso(t.abc) : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{day(t.prebidOn)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{t.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Results({ data, limit }: { data: BidReport; limit?: number }) {
  const rows = limit ? data.rows.slice(0, limit) : data.rows;
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        The bids <span className="font-normal text-slate-400">· every price read at the opening, the lowest first</span>
      </h3>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">No bid opened in these days.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
              <th className="px-4 py-2">Result</th>
              <th className="px-3 py-2">Agency</th>
              <th className="px-3 py-2">Tender</th>
              <th className="px-3 py-2 text-right">ABC</th>
              <th className="px-3 py-2 text-right">Ours</th>
              <th className="px-3 py-2 text-right">Lowest</th>
              <th className="px-3 py-2 text-right">Our place</th>
              <th className="px-3 py-2">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="px-4 py-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${RESULT[row.result].pill}`}>
                    {RESULT[row.result].word}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{day(row.resultOn ?? row.openingOn)}</span>
                </td>
                <td className="px-3 py-2">
                  {row.agency}
                  {row.agencyCity && <span className="block text-[11px] text-slate-500">{row.agencyCity}</span>}
                </td>
                <td className="px-3 py-2">
                  <Link to={`/tenders/${row.id}`} className="font-semibold text-slate-900 hover:underline">
                    {row.code}
                  </Link>
                  <span className="block text-[11px] text-slate-500">
                    {row.title} · {row.owner}
                  </span>
                  {row.bids.length > 1 && (
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {row.bids
                        .map((bid) => `${bid.name} ${shortPeso(bid.price)}${bid.disqualified ? " (out)" : ""}`)
                        .join(" · ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.abc ? shortPeso(row.abc) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums" title={row.ourBid ? exactPeso(row.ourBid) : undefined}>
                  {row.ourBid ? shortPeso(row.ourBid) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.lowest ? shortPeso(row.lowest.price) : "—"}
                  {row.lowest && !row.lowest.us && <span className="block text-[11px] text-slate-500">{row.lowest.name}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.rank ? `#${row.rank} of ${row.bids.filter((bid) => !bid.disqualified).length}` : "—"}
                  {row.gap !== null && row.gap > 0 && (
                    <span className="block text-[11px] text-rose-700">
                      {shortPeso(row.gap)} ({row.gapPct}%) above
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-[12px]">
                  {row.resultReason ? REASON[row.resultReason] : row.result === "pending" ? "—" : ""}
                  {row.resultNote && <span className="block text-[11px] text-slate-500">{row.resultNote}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ByAgency({ data }: { data: BidReport }) {
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">By agency</h3>
      {data.byAgency.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">No bid yet.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
              <th className="px-4 py-2">Agency</th>
              <th className="px-3 py-2 text-right">Bids</th>
              <th className="px-3 py-2 text-right">Won</th>
              <th className="px-3 py-2 text-right">Lost</th>
              <th className="px-3 py-2 text-right">Won ₱</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.byAgency.map((one) => (
              <tr key={one.agency}>
                <td className="px-4 py-2">
                  {one.agency}
                  {one.city && <span className="block text-[11px] text-slate-500">{one.city}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{one.joined}</td>
                <td className="px-3 py-2 text-right text-emerald-700 tabular-nums">{one.won}</td>
                <td className="px-3 py-2 text-right text-rose-700 tabular-nums">{one.lost}</td>
                <td className="px-3 py-2 text-right tabular-nums">{one.wonValue ? shortPeso(one.wonValue) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Reasons({ data }: { data: BidReport }) {
  const total = data.byReason.reduce((sum, one) => sum + one.count, 0);
  return (
    <section className={`${CARD} p-4`}>
      <h3 className="text-sm font-bold text-slate-900">Why we lost</h3>
      {data.byReason.length === 0 ? (
        <p className="mt-1 text-[13px] text-slate-500">No bid lost in these days.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {data.byReason.map((one) => (
            <li key={one.reason}>
              <div className="flex justify-between text-[13px]">
                <span>{REASON[one.reason as TenderReason]}</span>
                <span className="font-semibold tabular-nums">{one.count}</span>
              </div>
              <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
                <span className="block h-1.5 rounded-full bg-rose-400" style={{ width: `${Math.round((one.count / total) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Securities({ data }: { data: BidReport }) {
  const word = { bid: "Bid security", performance: "Performance security", retention: "Retention (1%)" } as const;
  return (
    <section className={`${CARD} min-w-0`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        Securities still out <span className="font-normal text-slate-400">· {shortPeso(data.securities.reduce((sum, one) => sum + one.amount, 0))}</span>
      </h3>
      {data.securities.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">None waiting to come back.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-[12.5px]">
          {data.securities.map((one) => (
            <li key={`${one.id}-${one.kind}`} className="flex justify-between gap-3 px-4 py-2">
              <span>
                <Link to={`/tenders/${one.id}`} className="font-semibold text-slate-900 hover:underline">
                  {one.code}
                </Link>{" "}
                · {one.agency}
                <span className="block text-[11px] text-slate-500">
                  {word[one.kind]}
                  {one.dueBack ? ` · due back ${day(one.dueBack)}` : ""}
                </span>
              </span>
              <span className="font-semibold tabular-nums">{shortPeso(one.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Late({ data }: { data: BidReport }) {
  return (
    <section className={`${CARD} min-w-0`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        Late in delivery <span className="font-normal text-slate-400">· 0.1% of the late goods a day; cancellable at 10%</span>
      </h3>
      {data.late.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">Every award is on time.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-[12.5px]">
          {data.late.map((one) => (
            <li key={one.id} className="flex justify-between gap-3 px-4 py-2">
              <span>
                <Link to={`/tenders/${one.id}`} className="font-semibold text-slate-900 hover:underline">
                  {one.code}
                </Link>{" "}
                · {one.agency}
                <span className="block text-[11px] text-slate-500">
                  Due {day(one.deliverBy)} · {one.daysLate} {one.daysLate === 1 ? "day" : "days"} late
                </span>
              </span>
              <span className="font-semibold text-rose-700 tabular-nums">{shortPeso(one.penalty)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The bid report in short, for the head's BID channel on their Home: the year's results, the
 *  latest bids with every price, what is coming up; the whole report a press away. */
export function BidReportCard({ unit = null }: { unit?: number | null }) {
  const query = useReport("", "", unit);
  const data = query.data;
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold text-slate-900">Bid report · this year</h3>
        <Link to="/tenders/report" className="text-[12.5px] font-semibold text-emerald-700 hover:underline">
          The whole report
        </Link>
      </div>
      <Summary data={data} />
      <ComingUp data={data} limit={5} />
      <Results data={data} limit={6} />
    </div>
  );
}
