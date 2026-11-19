// A Business Mentor's Home blocks (the Hospital Division's head): the division against its
// target team by team (each DSC's district: sales on the working-day pace, days to collect,
// lapsed hospitals, zero-sales days), the people at risk (below 60 this month, or two locked
// months under 60: the improvement plan), the money owed by age with the biggest owers, and the
// score questions waiting for an answer.

import type { CareGroups, Collections, District, RxField, TeamScores } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, MessageSquareWarning, UserRoundX } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { CARD } from "../ui";
import { B2cDeskCard } from "../online/b2c-home";
import { GroupsGlance, WaitingGroups } from "../sellers/care-groups";
import { RxFieldTable } from "../sellers/rx";
import { BiddingCard } from "../sellers/tenders";

type Row = District["rows"][number];

export function MentorHome() {
  const district = useQuery({ queryKey: ["team", "district"], queryFn: () => api<District>("/api/team/district"), refetchInterval: 120_000 });
  const scores = useQuery({ queryKey: ["scores", "team", ""], queryFn: () => api<TeamScores>("/api/scores/team") });
  const money = useQuery({ queryKey: ["my", "collections"], queryFn: () => api<Collections>("/api/my/collections") });
  return (
    <>
      {district.data && <Teams rows={district.data.rows} />}
      <div className="grid gap-3 lg:grid-cols-2">
        {scores.data && <AtRisk data={scores.data} />}
        {money.data && <Money data={money.data} />}
      </div>
      {scores.data && <Questions data={scores.data} />}
      {/* The Government Account's tenders (the division's own bidding coachee). */}
      <BiddingCard title="Government Account (tenders)" />
    </>
  );
}

/** One line per team (each DSC's district), worst pace first. */
function Teams({ rows }: { rows: Row[] }) {
  const teams = [...new Set(rows.map((row) => row.unit))].map((unit) => {
    const people = rows.filter((row) => row.unit === unit);
    const target = people.reduce((sum, row) => sum + (row.target ?? 0), 0);
    const sales = people.reduce((sum, row) => sum + row.sales, 0);
    const onPace = people.reduce((sum, row) => sum + (row.ist !== null && row.target ? (row.ist * row.target) / 100 : 0), 0);
    const dsos = people.filter((row) => row.dso !== null).map((row) => row.dso as number);
    return {
      unit,
      coach: people[0]?.coach ?? null,
      people: people.length,
      sales,
      target,
      pace: target ? Math.round((onPace / target) * 100) : null,
      dso: dsos.length ? Math.round(dsos.reduce((a, b) => a + b, 0) / dsos.length) : null,
      lapsed: people.reduce((sum, row) => sum + row.lapsed, 0),
      zeroDays: people.length ? Math.round(people.reduce((sum, row) => sum + row.zeroDays, 0) / people.length) : 0,
      rescue: people.filter((row) => row.rescue.length).length,
    };
  });
  teams.sort((a, b) => (a.pace ?? 999) - (b.pace ?? 999));
  const target = teams.reduce((sum, team) => sum + team.target, 0);
  const sales = teams.reduce((sum, team) => sum + team.sales, 0);
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-900">Division vs target, team by team</h2>
        <span className="text-xs text-slate-500">
          {shortPeso(sales)} of {shortPeso(target)} · worst pace first
        </span>
      </header>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            <th className="px-4 py-2 sm:px-5">Team · coach</th>
            <th className="px-3 py-2 text-right">Sales</th>
            <th className="px-3 py-2 text-right">On pace</th>
            <th className="px-3 py-2 text-right">Days to collect</th>
            <th className="px-3 py-2 text-right">Lapsed</th>
            <th className="px-3 py-2 text-right">Zero-sales days</th>
            <th className="px-4 py-2 text-right">In rescue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {teams.map((team) => (
            <tr key={team.unit} className="hover:bg-slate-50/60">
              <td className="px-4 py-2.5 sm:px-5">
                <div className="font-semibold text-slate-900">{team.unit}</div>
                <div className="text-[11.5px] text-slate-500">
                  {team.coach ?? "No coach"} · {team.people} CHC{team.people === 1 ? "" : "s"}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {shortPeso(team.sales)}
                <div className="text-[11px] text-slate-400">{team.target ? `of ${shortPeso(team.target)}` : "no target"}</div>
              </td>
              <td
                className={`px-3 py-2.5 text-right font-semibold tabular-nums ${team.pace === null ? "text-slate-400" : team.pace >= 91 ? "text-emerald-700" : team.pace >= 71 ? "text-amber-700" : "text-rose-700"}`}
              >
                {team.pace === null ? "—" : `${team.pace}%`}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{team.dso ?? "—"}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{team.lapsed}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{team.zeroDays}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums ${team.rescue ? "font-semibold text-rose-700" : "text-slate-400"}`}>{team.rescue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AtRisk({ data }: { data: TeamScores }) {
  const risky = data.rows.filter((row) => row.card?.recipe !== "team" && row.personId && (row.pip || (row.card && row.card.max > 0 && row.card.percent < 60)));
  return (
    <section className={`${CARD} min-w-0 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <UserRoundX className="size-4 text-rose-600" /> People at risk
        </h2>
        <Link to="/team-scores" className="text-[12px] font-semibold text-emerald-700 hover:underline">
          Scorecards
        </Link>
      </div>
      {risky.length === 0 ? (
        <p className="mt-1 text-[13px] text-slate-500">No one below 60 this month or on an improvement plan.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {risky.map((row) => (
            <li key={row.seatId} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
              <span className="min-w-0">
                <Link to={`/my/score?person=${row.personId}`} className="font-semibold text-slate-900 hover:underline">
                  {row.name}
                </Link>
                <span className="text-[11.5px] text-slate-500"> · {row.area ?? row.title} · {row.unit}</span>
              </span>
              <span className="shrink-0 text-right text-[12px]">
                {row.card && (
                  <span className="font-semibold text-rose-700 tabular-nums">
                    {row.card.total}/{row.card.max}
                  </span>
                )}
                {row.pip && <span className="ml-1.5 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800">Improvement plan</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const AGE_BAR: Record<Collections["buckets"][number]["key"], string> = {
  ok: "bg-emerald-500",
  d60: "bg-amber-400",
  d75: "bg-orange-500",
  d90: "bg-rose-500",
};

function Money({ data }: { data: Collections }) {
  const biggest = [...data.rows].sort((a, b) => b.owed - a.owed).slice(0, 5);
  return (
    <section className={`${CARD} min-w-0 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <HandCoins className="size-4 text-amber-600" /> Money owed · {shortPeso(data.total)}
        </h2>
        <Link to="/collections" className="text-[12px] font-semibold text-emerald-700 hover:underline">
          Collections
        </Link>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {data.buckets
          .filter((one) => one.amount > 0)
          .map((one) => (
            <span key={one.key} className={AGE_BAR[one.key]} style={{ width: `${(one.amount / Math.max(1, data.total)) * 100}%` }} title={`${one.label}: ${shortPeso(one.amount)}`} />
          ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {data.buckets.map((one) => (
          <span key={one.key} className="inline-flex items-center gap-1">
            <span className={`size-2 rounded-full ${AGE_BAR[one.key]}`} /> {one.label} {shortPeso(one.amount)}
          </span>
        ))}
      </div>
      <h3 className="mt-3 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Biggest owers</h3>
      <ul className="mt-1 divide-y divide-slate-100">
        {biggest.map((row) => (
          <li key={row.customerId} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
            <span className="min-w-0 truncate">
              <Link to={`/customers/${row.customerId}`} className="font-medium text-slate-900 hover:underline">
                {row.customer}
              </Link>
              <span className="text-[11.5px] text-slate-500"> · {row.seller ?? "no seller"}</span>
            </span>
            <span className="shrink-0 text-right font-semibold tabular-nums">
              {shortPeso(row.owed)}
              <span className="ml-1 text-[11px] font-normal text-slate-400">{row.age}d</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Questions({ data }: { data: TeamScores }) {
  const open = data.disputes.filter((one) => one.state === "open");
  return (
    <section className={`${CARD} min-w-0 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <MessageSquareWarning className="size-4 text-slate-500" /> Score questions
        </h2>
        <Link to="/team-scores" className="text-[12px] font-semibold text-emerald-700 hover:underline">
          Answer
        </Link>
      </div>
      <p className="mt-1 text-[13px] text-slate-600">
        {open.length
          ? `${open.length} waiting for an answer: ${open.map((one) => `${one.person} (${one.kpi.toUpperCase()})`).join(", ")}`
          : "No question waiting. A locked month's figure can be questioned within 10 days."}
      </p>
    </section>
  );
}

/** The Sales Coach of MD Telesales: the groups waiting and the 15 minutes kept (the team's
 *  people against their targets follow on the Home). */
export function TelesalesCoachHome() {
  const groups = useQuery({ queryKey: ["care-groups"], queryFn: () => api<CareGroups>("/api/care-groups"), refetchInterval: 30_000 });
  return (
    <>
      <B2cDeskCard />
      {groups.data && <GroupsGlance data={groups.data} />}
      {groups.data && <WaitingGroups data={groups.data} />}
    </>
  );
}

/** The Country Mentor (Prescription business): the field team, the care groups, people at risk
 *  and money (telesales' people against their targets follow on the Home). */
export function RxMentorHome() {
  const field = useQuery({ queryKey: ["rx", "field"], queryFn: () => api<RxField>("/api/rx/field") });
  const groups = useQuery({ queryKey: ["care-groups"], queryFn: () => api<CareGroups>("/api/care-groups"), refetchInterval: 60_000 });
  const scores = useQuery({ queryKey: ["scores", "team", ""], queryFn: () => api<TeamScores>("/api/scores/team") });
  const money = useQuery({ queryKey: ["my", "collections"], queryFn: () => api<Collections>("/api/my/collections") });
  return (
    <>
      {field.data && <RxFieldTable data={field.data} />}
      {groups.data && <GroupsGlance data={groups.data} />}
      <B2cDeskCard />
      <div className="grid gap-3 lg:grid-cols-2">
        {scores.data && <AtRisk data={scores.data} />}
        {money.data && <Money data={money.data} />}
      </div>
      {scores.data && <Questions data={scores.data} />}
    </>
  );
}

/** A head's people at risk, money owed and score questions, for any division's Mentor. */
export function HeadRisks() {
  const scores = useQuery({ queryKey: ["scores", "team", ""], queryFn: () => api<TeamScores>("/api/scores/team") });
  const money = useQuery({ queryKey: ["my", "collections"], queryFn: () => api<Collections>("/api/my/collections") });
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {scores.data && <AtRisk data={scores.data} />}
        {money.data && <Money data={money.data} />}
      </div>
      {scores.data && <Questions data={scores.data} />}
    </>
  );
}
