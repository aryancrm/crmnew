// The field's visits (SEFMED's Visits, docs/PLAN.md 22), on the CRM's own visits: tabs KOLs ·
// Hospitals · KBLs, a day or a month, the state (New, At the place, Closed, Skipped, Missed) with
// counts; each card opens the visit. A MedRep adds visits (on the day itself with why); a team lead
// picks one of the team or everyone (the team switch narrows it), the head and the CEO the same.

import type { ClientKind, VisitList, VisitState } from "@2mg/api/mr";
import { CLIENT_KINDS, KIND_TABS, STATE_WORDS, stateOf } from "@2mg/api/mr";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useHqNames } from "../team/hq-name";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { Button, CARD, PageState, Tabs, peso } from "../ui";
import { AddVisitsDialog } from "./plan";
import { dayWords, Initial, MrHead, monthWords, shiftDay, shiftMonth, StatePill, useMrMe } from "./parts";
import { EmptyState } from "../no-results";

export function MrVisitsPage() {
  const [params, setParams] = useSearchParams();
  const mr = useMrMe();
  const kind = (params.get("kind") as ClientKind) ?? "doctor";
  const month = params.get("month");
  const day = params.get("day");
  const person = params.get("person");
  const [state, setState] = useState<VisitState | "all">("all");
  const [adding, setAdding] = useState(false);
  const unit = useTeamUnit();
  // Each person after their HQ (Aryan's phase 5, PLAN 269).
  const { named } = useHqNames();
  const query = useQuery({
    queryKey: ["mr", "visits", kind, month, day, person, unit],
    queryFn: () =>
      api<VisitList>(
        withUnit(`/api/mr/visits?${new URLSearchParams({ kind, ...(month ? { month } : {}), ...(day ? { day } : {}), ...(person ? { person } : {}) })}`, unit),
      ),
    placeholderData: (previous) => previous,
  });
  const set = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) if (value === null) out.delete(key); else out.set(key, value);
    setParams(out, { replace: true });
  };
  const data = query.data;
  if (!data) return <PageState query={query} what="the visits" />;
  const shown = data.rows.filter((one) => state === "all" || stateOf(one) === state);
  const lead = mr.data?.access === "lead" || mr.data?.access === "viewer";
  const thisDay = data.day ?? data.today;
  return (
    <div className={`mx-auto flex max-w-4xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead
        title="Visits"
        sub={`${data.person ? named(data.person.id, data.person.name) : "Everyone"} · ${data.month ? monthWords(data.month) : dayWords(thisDay)}`}
        actions={
          data.can.work && (
            <Button variant="primary" small onClick={() => setAdding(true)}>
              <Plus size={15} /> Add visit
            </Button>
          )
        }
      />
      <div className="flex rounded-full bg-sky-600 p-1">
        {CLIENT_KINDS.map((one) => (
          <button
            key={one}
            type="button"
            onClick={() => set({ kind: one })}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-bold ${kind === one ? "bg-white text-sky-800" : "text-white"}`}
          >
            {KIND_TABS[one]} <span className="text-xs opacity-70">({data.counts[one]})</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {data.month ? (
          <>
            <Button small variant="quiet" aria-label="Month before" onClick={() => set({ month: shiftMonth(data.month as string, -1) })}><ChevronLeft size={16} /></Button>
            <span className="text-sm font-semibold">{monthWords(data.month)}</span>
            <Button small variant="quiet" aria-label="Month after" onClick={() => set({ month: shiftMonth(data.month as string, 1) })}><ChevronRight size={16} /></Button>
            <Button small onClick={() => set({ month: null, day: null })}>Today</Button>
          </>
        ) : (
          <>
            <Button small variant="quiet" aria-label="Day before" onClick={() => set({ day: shiftDay(thisDay, -1) })}><ChevronLeft size={16} /></Button>
            <input type="date" value={thisDay} onChange={(event) => event.target.value && set({ day: event.target.value })} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
            <Button small variant="quiet" aria-label="Day after" onClick={() => set({ day: shiftDay(thisDay, 1) })}><ChevronRight size={16} /></Button>
            <Button small onClick={() => set({ month: thisDay.slice(0, 7), day: null })}>Whole month</Button>
          </>
        )}
        {lead && data.people.length > 0 && (
          <select
            aria-label="Whose visits"
            value={person ?? ""}
            onChange={(event) => set({ person: event.target.value || null })}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="">{mr.data?.access === "viewer" ? "Everyone" : "Mine"}</option>
            <option value="all">Everyone</option>
            {data.people.map((one) => (
              <option key={one.id} value={one.id}>{named(one.id, one.name)}</option>
            ))}
          </select>
        )}
      </div>
      {!data.person && <TeamSwitch />}
      <Tabs<VisitState | "all">
        value={state}
        onChange={setState}
        tabs={[
          { key: "all", label: "All", count: data.rows.length },
          ...(Object.keys(STATE_WORDS) as VisitState[]).map((key) => ({ key, label: STATE_WORDS[key], count: data.states[key] })),
        ]}
      />
      <div className="text-sm font-semibold text-sky-800">
        {state === "all" ? "All" : STATE_WORDS[state]} ({shown.length})
      </div>
      <ul className="flex flex-col gap-2">
        {shown.map((one) => (
          <li key={one.id}>
            <Link to={`/visits/${one.id}`} className={`${CARD} flex items-start gap-3 p-3.5 hover:border-sky-300`}>
              <Initial name={one.client.name} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-sky-900 uppercase">{one.client.name}</span>
                  <StatePill visit={one} />
                </span>
                <span className="mt-0.5 flex justify-between gap-2 text-xs text-slate-500">
                  <span>{[one.client.detail ?? one.client.specialty, one.client.city].filter(Boolean).join(", ")}</span>
                  <span className="shrink-0">{dayWords(one.day)}</span>
                </span>
                {(!data.person || data.person.id !== one.person.id) && (
                  <span className="block text-xs text-slate-500">Emp name: {named(one.person.id, one.person.name)}</span>
                )}
                {one.unplanned && <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">Added on the day</span>}
                {one.booked > 0 && <span className="mt-1 ml-1 inline-block rounded bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-800">{peso(one.booked)} ordered</span>}
                {one.skipReason && <span className="block text-xs text-rose-700">{one.skipReason}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <div className={CARD}>
          <EmptyState title={<>No {KIND_TABS[kind]} visits here.</>}>
            Visits on this day or month show here. Try another state or day.{" "}
            {data.can.work && (
              <button type="button" className="font-semibold text-sky-700" onClick={() => setAdding(true)}>Add a visit</button>
            )}
          </EmptyState>
        </div>
      )}
      {adding && <AddVisitsDialog day={data.day && data.day >= data.today ? data.day : data.today} kind={params.get("kind") ? kind : undefined} onClose={() => setAdding(false)} />}
    </div>
  );
}
