// The team today (SEFMED's manager app and web dashboard, docs/PLAN.md 22), for a team lead, the
// head above them and the CEO, from the company tree (the team switch narrows it to a box): each
// MedRep today (Present / Absent, where and since when, visits closed of planned, at which customer
// now, CRM orders placed at visits, the day report), what waits for the lead, SEFMED's dashboard
// figures (customers, closed visits today / week / month, Call Champion, the field's activity), and
// each MedRep's actions (visits, expenses, location on the map, tour plan, attendance, day report).

import type { LeadQueue, TeamToday } from "@2mg/api/mr";
import type { LivePeople } from "@2mg/api/types";
import { MEETING_WORDS, WORK_WORDS } from "@2mg/api/mr";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { allItems, spaceFor } from "../menus";
import { useHqNames } from "../team/hq-name";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { CARD, PageState, Panel, peso, useOpenOnPress } from "../ui";
import { ActionSheet, clockOf, dayWords, MrHead, mapLink, useMrMe } from "./parts";
import { EmptyState, NoInvoicesArt } from "../no-results";

/** The field on a lead's or head's Home (Aryan, 23 Nov: "how does what the MedReps do reach the
 *  lead?"): who is at work, the visits closed and what was ordered there, who hasn't started, and
 *  what waits for the lead, each a press away. Only for a seat whose menu has the team's field day
 *  (the hospital and Rx lines; a B2B, bidding or TeleSales lead has no field day to watch). */
export function FieldTodayCard() {
  const me = useMe().data;
  const mr = useMrMe();
  const watches =
    Boolean(me) &&
    (mr.data?.access === "lead" || mr.data?.access === "viewer") &&
    spaceFor(me as NonNullable<typeof me>, "/").groups.some((group) => allItems(group.items).some((item) => item.to === "/field/team"));
  const query = useQuery({
    queryKey: ["mr", "team", null],
    queryFn: () => api<TeamToday>("/api/mr/team"),
    enabled: watches,
    refetchInterval: 60_000,
  });
  // Each person after their HQ, as on Team today (PLAN 269): "TAFT · Marwin Dy".
  const { named } = useHqNames();
  const data = query.data;
  if (!watches || !data || data.totals.people === 0) return null;
  const t = data.totals;
  const w = data.waiting;
  // Named only when they have visits today and haven't started: a TeleSales or bidding seat under
  // the same head has no field day to start, and must not read as late.
  const idle = data.people.filter((one) => !one.started && one.visits > 0);
  const at = data.people.filter((one) => one.at && !one.ended);
  return (
    <section className={`${CARD} flex flex-col gap-3 border-sky-200 p-4`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-900">The field today</h2>
        <Link to="/field/team" className="text-xs font-semibold text-sky-700 hover:underline">Team today →</Link>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Figure label="Started the field day" value={t.started} />
        <Figure label="Visits closed" value={t.planned > 0 ? `${t.done} of ${Math.max(t.planned, t.done)}` : t.done} />
        <Figure label="Ordered at visits" value={t.bookedAmount ? peso(t.bookedAmount) : "—"} />
        <Figure label="Waiting for you" value={w.reports + w.judge + w.plans + w.deviations + w.expenses} />
      </div>
      {(idle.length > 0 || at.length > 0) && (
        <p className="text-[13px] text-slate-600">
          {at.length > 0 && <>Now at a customer: {at.map((one) => `${named(one.id, one.name)} (${one.at})`).join(", ")}. </>}
          {idle.length > 0 && <span className="text-amber-800">Visits today, not started yet: {idle.map((one) => named(one.id, one.name)).join(", ")}.</span>}
        </p>
      )}
      {w.reports + w.judge + w.plans + w.deviations + w.expenses > 0 && (
        <ul className="grid gap-2 sm:grid-cols-3">
          <Wait n={w.reports} label="Day reports to see" to="/field/reports?view=day-reports" />
          <Wait n={w.judge} label="Calls to judge" to="/field/reports?view=judge" />
          <Wait n={w.plans} label="Tour plans to approve" to={`/field/plan?view=team${w.plansMonth ? `&month=${w.plansMonth}` : ""}`} />
          <Wait n={w.deviations} label="Plan changes (deviations)" to="/field/plan?view=deviations" />
          <Wait n={w.expenses} label="Expenses to approve" to="/visits/expenses?waiting=1" />
        </ul>
      )}
    </section>
  );
}

export function TeamHome() {
  const navigate = useNavigate();
  const mr = useMrMe();
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["mr", "team", unit],
    queryFn: () => api<TeamToday>(withUnit("/api/mr/team", unit)),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  const queue = useQuery({ queryKey: ["mr", "queue", unit], queryFn: () => api<LeadQueue>(withUnit("/api/mr/team/queue", unit)) });
  const offList = useQuery({
    queryKey: ["mr", "off-requests"],
    queryFn: () => api<{ rows: unknown[] }>("/api/mr/clients/off-requests"),
    enabled: mr.data?.access === "lead" || mr.data?.access === "viewer",
  });
  const [picked, setPicked] = useState<TeamToday["people"][number] | null>(null);
  // Each person after their HQ (Aryan's phase 5, PLAN 269): "TAFT · Marwin Dy".
  const { named } = useHqNames();
  // A Call Champion row opens that person's visits when pressed anywhere on it (PLAN 271).
  const open = useOpenOnPress();
  // Where each one is now, from their phone (Aryan, 28 Nov: "what is the difference between Team
  // today and Where the team is?": none worth a page, PLAN 271): a person's row says they are
  // live, and pressing it opens where they are and their places today.
  const live = useQuery({ queryKey: ["field", "live"], queryFn: () => api<LivePeople>("/api/field/where"), refetchInterval: 60_000 });
  const placeOf = new Map((live.data?.people ?? []).filter((one) => one.place).map((one) => [one.personId, one]));
  const data = query.data;
  if (!data) return <PageState query={query} what="the team" />;
  const t = data.totals;
  const present = data.people.filter((one) => one.started).length;
  const lead = mr.data?.access === "lead";
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <MrHead
        title="Team today"
        sub={`${dayWords(data.day)} · ${present} of ${t.people} at work`}
        actions={lead ? <Link to="/field" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">My own day</Link> : undefined}
      />
      <TeamSwitch />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Field employees" value={t.people} />
        <Figure label="Doctors" value={data.clients.doctors} to="/field/clients?kind=doctor&scope=team" />
        <Figure label="Firms" value={data.clients.firms} to="/field/clients?kind=firm&scope=team" />
        <Figure label="Hospitals" value={data.clients.hospitals} to="/field/clients?kind=hospital&scope=team" />
      </div>

      {/* The Field visits pages off the menu, a press away (Aryan, 28 Nov: "are this many needed? how
          many repeat?", PLAN 270): nothing is lost. */}
      <nav aria-label="More of the field" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-sky-700">
        <Link to={withUnit("/visits?person=all", unit)} className="hover:underline">All visits</Link>
        <Link to={withUnit("/field/plan?view=team", unit)} className="hover:underline">Tour plans</Link>
        <Link to={withUnit("/visits/expenses?waiting=1", unit)} className="hover:underline">Expenses</Link>
        {/* The team's follow-ups, not the lead's own; the call list itself, not the page of tiles. */}
        <Link to="/field/follow-ups?person=all" className="hover:underline">Follow-ups</Link>
        <Link to={withUnit("/field/reports?view=calls", unit)} className="hover:underline">Call reports</Link>
        <Link to={withUnit("/field/clients?scope=team", unit)} className="hover:underline">Customers</Link>
      </nav>

      {(data.waiting.reports + data.waiting.judge + data.waiting.plans + data.waiting.deviations + data.waiting.expenses + (offList.data?.rows.length ?? 0)) > 0 && (
        <Panel title="Waiting for you">
          <ul className="grid gap-2 p-3 sm:grid-cols-3">
            <Wait n={data.waiting.reports} label="Day reports to see" to={withUnit("/field/reports?view=day-reports", unit)} />
            <Wait n={data.waiting.judge} label="Calls to judge" to={withUnit("/field/reports?view=judge", unit)} />
            <Wait
              n={data.waiting.plans}
              label="Tour plans to approve"
              // Opens on the month of the oldest plan waiting: a plan sent for next month is there.
              to={withUnit(`/field/plan?view=team${data.waiting.plansMonth ? `&month=${data.waiting.plansMonth}` : ""}`, unit)}
            />
            <Wait n={data.waiting.deviations} label="Plan changes (deviations)" to={withUnit("/field/plan?view=deviations", unit)} />
            <Wait n={data.waiting.expenses} label="Expenses to approve" to={withUnit("/visits/expenses?waiting=1", unit)} />
            <Wait n={offList.data?.rows.length ?? 0} label="Customers to take off the list" to="/field/clients?view=off" />
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Today" count={data.people.length} actions={<Link to="/field/live" className="text-xs font-semibold text-sky-700 hover:underline">Everyone on the map</Link>}>
          <ul className="divide-y divide-slate-100">
            {data.people.map((one) => (
              <li key={one.id}>
                <button type="button" onClick={() => setPicked(one)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block font-semibold text-sky-800">{named(one.id, one.name)}</span>
                    <span className="block text-xs text-slate-500">
                      {one.done} closed of {one.visits} visits{one.visits > one.planned ? ` (${one.visits - one.planned} added on the day)` : ""}
                      {one.missed ? ` · ${one.missed} missed` : ""}
                      {one.bookedAmount ? ` · ${peso(one.bookedAmount)} ordered` : ""}
                      {one.at ? ` · at ${one.at}` : ""}
                    </span>
                    {placeOf.has(one.id) && (
                      <span className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700">
                        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Live: their place now
                      </span>
                    )}
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
              <li>
                <EmptyState title="No MedReps under you here.">Your MedReps show here with where their day stands.</EmptyState>
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
                <li
                  key={one.id}
                  onClick={open(`/visits?person=${one.id}&day=${data.day}`)}
                  className="flex cursor-pointer items-center justify-between px-4 py-2 text-sm hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    {at === 0 ? <Trophy size={14} className="text-amber-500" /> : <span className="w-3.5 text-center text-xs text-slate-400">{at + 1}</span>}
                    <Link to={`/visits?person=${one.id}&day=${data.day}`} className="hover:underline">
                      {named(one.id, one.name)}
                    </Link>
                  </span>
                  <span className="font-semibold text-slate-700">{one.closed}</span>
                </li>
              ))}
              {data.champions.length === 0 && (
                <li>
                  <EmptyState art={<NoInvoicesArt size={72} />} title="No call closed yet today.">
                    Who closed the most visits today shows here.
                  </EmptyState>
                </li>
              )}
            </ol>
          </Panel>
          <Panel title="Field activities">
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {data.feed.map((one) => (
                <li key={`${one.visitId}-${one.what}`} className="px-4 py-2 text-[13px] text-slate-700">
                  <Link to={`/visits/${one.visitId}`} className="hover:underline">
                    <b>{named(one.personId, one.name)}</b> has {one.what === "closed" ? "closed" : "checked in"} the visit of {one.client}
                  </Link>
                  {one.what === "closed" && one.meeting && (
                    <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${one.meeting === "met" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                      {MEETING_WORDS[one.meeting]}
                      {one.booked > 0 ? ` · ${peso(one.booked)} ordered` : ""}
                    </span>
                  )}
                  <span className="ml-1 text-xs text-slate-400">{clockOf(one.at)}</span>
                </li>
              ))}
              {data.feed.length === 0 && (
                <li>
                  <EmptyState art={<NoInvoicesArt size={72} />} title="Nothing yet today.">
                    Visits checked in and closed today show here.
                  </EmptyState>
                </li>
              )}
            </ul>
          </Panel>
        </div>
      </div>

      {queue.data && queue.data.judge.length > 0 && (
        <Panel title="Calls left “not sure yet”" count={queue.data.judge.length}>
          <ul className="divide-y divide-slate-100">
            {queue.data.judge.slice(0, 5).map((one) => (
              <li key={one.id}>
                <Link to={`/visits/${one.id}`} className="block px-4 py-2.5 text-sm hover:bg-slate-50">
                  <b>{one.client.name}</b> · {named(one.person.id, one.person.name)} · {dayWords(one.day)}
                  {one.feedback ? <span className="text-slate-500"> · “{one.feedback}”</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {picked && (
        <ActionSheet
          title={named(picked.id, picked.name)}
          sub={picked.started ? `${picked.workType ? WORK_WORDS[picked.workType] : ""} since ${clockOf(picked.started)}` : "Absent today"}
          onClose={() => setPicked(null)}
          actions={[
            {
              label: "Where they are now",
              hint: placeOf.get(picked.id)?.atVisit ? `At ${placeOf.get(picked.id)?.atVisit}` : "From their phone",
              hidden: !placeOf.has(picked.id),
              onPick: () => window.open(mapLink(placeOf.get(picked.id)?.place ?? ""), "_blank", "noreferrer"),
            },
            { label: "Their places today", onPick: () => navigate(`/field/map?person=${picked.id}`) },
            { label: "View visits", onPick: () => navigate(`/visits?person=${picked.id}`) },
            { label: "View expenses", onPick: () => navigate(`/visits/expenses?person=${picked.id}`) },
            { label: "Manage tour plan", onPick: () => navigate(`/field/plan?person=${picked.id}`) },
            { label: "View attendance", onPick: () => navigate(`/field/reports?view=attendance&person=${picked.id}`) },
            { label: "Day report", onPick: () => navigate(`/field/day-report?person=${picked.id}`) },
            { label: "Team orders", onPick: () => navigate("/orders") },
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
