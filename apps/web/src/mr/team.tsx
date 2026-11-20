// The team lead's side of the MR App (SEFMED's manager app and web dashboard, docs/PLAN.md 22): the
// team today (Present / Absent, where and since when, visits closed of planned, at which client
// now, orders booked, the day report), what waits for the lead, SEFMED's dashboard figures
// (clients, closed visits today / week / month, Call Champion, the field's activity), and each
// MR's actions (visits, expenses, location on the map, tour plan, attendance, day report).

import type { LeadQueue, TeamToday } from "@2mg/api/mr";
import { WORK_WORDS } from "@2mg/api/mr";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CARD, PageState, Panel, peso } from "../ui";
import { ActionSheet, clockOf, dayWords, MrHead, useMrMe } from "./parts";

export function TeamHome() {
  const navigate = useNavigate();
  const mr = useMrMe();
  const query = useQuery({ queryKey: ["mr", "team"], queryFn: () => api<TeamToday>("/api/mr/team"), refetchInterval: 60_000 });
  const queue = useQuery({ queryKey: ["mr", "queue"], queryFn: () => api<LeadQueue>("/api/mr/team/queue") });
  const deletes = useQuery({
    queryKey: ["mr", "delete-requests"],
    queryFn: () => api<{ rows: unknown[] }>("/api/mr/delete-requests"),
    enabled: mr.data?.access === "lead" || mr.data?.access === "viewer",
  });
  const [picked, setPicked] = useState<TeamToday["people"][number] | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the team" />;
  const t = data.totals;
  const present = data.people.filter((one) => one.started).length;
  const lead = mr.data?.access === "lead";
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <MrHead
        title={lead ? "My team" : "MR App"}
        sub={`${dayWords(data.day)} · ${present} of ${t.people} at work`}
        actions={lead ? <Link to="/mr/my-day" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">My own day</Link> : undefined}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Field employees" value={t.people} />
        <Figure label="Doctors" value={data.clients.doctors} to="/mr/clients?kind=doctor&scope=team" />
        <Figure label="Firms" value={data.clients.firms} to="/mr/clients?kind=firm&scope=team" />
        <Figure label="Hospitals" value={data.clients.hospitals} to="/mr/clients?kind=hospital&scope=team" />
      </div>

      {(data.waiting.reports + data.waiting.judge + data.waiting.plans + data.waiting.deviations + data.waiting.expenses + (deletes.data?.rows.length ?? 0)) > 0 && (
        <Panel title="Waiting for you">
          <ul className="grid gap-2 p-3 sm:grid-cols-3">
            <Wait n={data.waiting.reports} label="Day reports to see" to="/mr/reports?view=day-reports" />
            <Wait n={data.waiting.judge} label="Calls to judge" to="/mr/reports?view=judge" />
            <Wait n={data.waiting.plans} label="Tour plans to approve" to="/mr/plan?view=team" />
            <Wait n={data.waiting.deviations} label="Plan changes (deviations)" to="/mr/plan?view=deviations" />
            <Wait n={data.waiting.expenses} label="Expenses to approve" to="/mr/expenses?person=all" />
            <Wait n={deletes.data?.rows.length ?? 0} label="Client delete requests" to="/mr/clients?view=deletes" />
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Today" count={data.people.length} actions={<Link to="/mr/map" className="text-xs font-semibold text-sky-700 hover:underline">View all on map</Link>}>
          <ul className="divide-y divide-slate-100">
            {data.people.map((one) => (
              <li key={one.id}>
                <button type="button" onClick={() => setPicked(one)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block font-semibold text-sky-800">{one.name}</span>
                    <span className="block text-xs text-slate-500">
                      {one.done} closed of {one.visits} visits{one.visits > one.planned ? ` (${one.visits - one.planned} added on the day)` : ""}
                      {one.missed ? ` · ${one.missed} missed` : ""}
                      {one.bookedAmount ? ` · ${peso(one.bookedAmount)} booked` : ""}
                      {one.at ? ` · at ${one.at}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-sm font-semibold ${one.started ? "text-sky-600" : "text-rose-600"}`}>
                      {one.started ? (one.ended ? "Day closed" : one.onBreak ? "On a break" : "Present") : "Absent"}
                    </span>
                    {one.started && (
                      <span className="block text-xs text-slate-600">
                        {one.workType ? WORK_WORDS[one.workType] : ""}
                        {one.cities.length ? `-${one.cities.join(", ")}` : ""} At: {clockOf(one.started)}
                      </span>
                    )}
                    {one.report === "sent" && <span className="block text-[11px] font-semibold text-amber-700">Report to see</span>}
                  </span>
                </button>
              </li>
            ))}
            {data.people.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                No MRs in the app yet. <Link to="/mr/people" className="font-semibold text-sky-700">Add them</Link>.
              </li>
            )}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Closed visits">
            <div className="grid grid-cols-3 gap-2 p-3 text-center">
              <Figure label="This month" value={data.closed.month} />
              <Figure label="This week" value={data.closed.week} />
              <Figure label="Today" value={data.closed.today} />
            </div>
            <div className="px-4 pb-3 text-xs text-slate-500">
              Attendance today: {t.people ? Math.round((present / t.people) * 1000) / 10 : 0}% present
            </div>
          </Panel>
          <Panel title="Call Champion (today)">
            <ol className="divide-y divide-slate-100">
              {data.champions.map((one, at) => (
                <li key={one.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    {at === 0 ? <Trophy size={14} className="text-amber-500" /> : <span className="w-3.5 text-center text-xs text-slate-400">{at + 1}</span>}
                    {one.name}
                  </span>
                  <span className="font-semibold text-slate-700">{one.closed}</span>
                </li>
              ))}
              {data.champions.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">No call closed yet today.</li>}
            </ol>
          </Panel>
          <Panel title="Field activities">
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {data.feed.map((one) => (
                <li key={`${one.visitId}-${one.what}`} className="px-4 py-2 text-[13px] text-slate-700">
                  <Link to={`/mr/visits/${one.visitId}`} className="hover:underline">
                    <b>{one.name}</b> has {one.what === "closed" ? "closed" : "checked in"} the visit of {one.client}
                  </Link>
                  <span className="ml-1 text-xs text-slate-400">{clockOf(one.at)}</span>
                </li>
              ))}
              {data.feed.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">Nothing yet today.</li>}
            </ul>
          </Panel>
        </div>
      </div>

      {queue.data && queue.data.judge.length > 0 && (
        <Panel title="Calls left “not sure yet”" count={queue.data.judge.length}>
          <ul className="divide-y divide-slate-100">
            {queue.data.judge.slice(0, 5).map((one) => (
              <li key={one.id}>
                <Link to={`/mr/visits/${one.id}`} className="block px-4 py-2.5 text-sm hover:bg-slate-50">
                  <b>{one.client.name}</b> · {one.person.name} · {dayWords(one.day)}
                  {one.feedback ? <span className="text-slate-500"> · “{one.feedback}”</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {picked && (
        <ActionSheet
          title={picked.name}
          sub={picked.started ? `${picked.workType ? WORK_WORDS[picked.workType] : ""} since ${clockOf(picked.started)}` : "Absent today"}
          onClose={() => setPicked(null)}
          actions={[
            { label: "View visits", onPick: () => navigate(`/mr/visits?person=${picked.id}`) },
            { label: "View expenses", onPick: () => navigate(`/mr/expenses?person=${picked.id}`) },
            { label: "View location on map", onPick: () => navigate(`/mr/map?person=${picked.id}`) },
            { label: "Manage tour plan", onPick: () => navigate(`/mr/plan?person=${picked.id}`) },
            { label: "View attendance", onPick: () => navigate(`/mr/reports?view=attendance&person=${picked.id}`) },
            { label: "Day report", onPick: () => navigate(`/mr/day-report?person=${picked.id}`) },
            { label: "Orders booked", onPick: () => navigate(`/mr/orders?person=${picked.id}`) },
          ]}
        />
      )}
    </div>
  );
}

function Figure({ label, value, to }: { label: string; value: number | string; to?: string }) {
  const body = (
    <>
      <div className="text-2xl leading-none font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{label}</div>
    </>
  );
  return to ? (
    <Link to={to} className={`${CARD} px-3 py-3 hover:border-sky-300`}>{body}</Link>
  ) : (
    <div className={`${CARD} px-3 py-3`}>{body}</div>
  );
}

function Wait({ n, label, to }: { n: number; label: string; to: string }) {
  if (!n) return null;
  return (
    <li>
      <Link to={to} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 hover:border-amber-300">
        {label}
        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">{n}</span>
      </Link>
    </li>
  );
}
