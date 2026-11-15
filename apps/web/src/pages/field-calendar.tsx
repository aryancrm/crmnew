// The field as a calendar: each day of the month with whom a person visited (done, planned,
// skipped) and their leave. A team lead (their team) and the CEO (everyone) see the whole team as
// counts by day with who was out, pick a day for its visits, or pick one person.

import type { FieldCalendar } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { manilaToday } from "../team/range";
import { Button, CARD, PageHead, PageState } from "../ui";
import { LEAVE_WORDS } from "./attendance-report";

const DOT: Record<string, string> = {
  done: "bg-emerald-500",
  planned: "bg-sky-400",
  skipped: "bg-slate-300",
};
const CHIP: Record<string, string> = {
  done: "bg-emerald-50 text-emerald-800",
  planned: "bg-sky-50 text-sky-800",
  skipped: "bg-slate-100 text-slate-500 line-through",
};
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const dayName = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

export function FieldCalendarPage() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? manilaToday().slice(0, 7);
  const person = params.get("person");
  const open = params.get("day");
  const query = useQuery({
    queryKey: ["field", "calendar", month, person],
    queryFn: () =>
      api<FieldCalendar>(
        `/api/field/calendar?${new URLSearchParams({ month, ...(person ? { person } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const set = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next))
      if (value === null) out.delete(key);
      else out.set(key, value);
    setParams(out, { replace: true });
  };
  const data = query.data;
  if (!data) return <PageState query={query} what="the calendar" />;
  const team = data.person === null;
  const lead = data.people.length > 1;
  const blank = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  // The days of the month before, drawn empty so the 1st falls on its weekday.
  const before = Array.from({ length: blank }, (_, at) =>
    new Date(Date.parse(`${month}-01T00:00:00Z`) - (blank - at) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
  const totals = data.days.reduce(
    (sum, one) => ({
      done: sum.done + one.done,
      planned: sum.planned + one.planned,
      skipped: sum.skipped + one.skipped,
    }),
    { done: 0, planned: 0, skipped: 0 },
  );

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title={team ? "Team calendar" : lead ? `${data.person?.name}'s calendar` : "My calendar"}
        sub={`${totals.done} visits done · ${totals.planned} planned · ${totals.skipped} skipped`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {lead && (
              <select
                value={person ?? ""}
                onChange={(event) => set({ person: event.target.value || null, day: null })}
                className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
                aria-label="Whose calendar"
              >
                <option value="">Whole team</option>
                {data.people.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                    {one.team ? ` · ${one.team}` : ""}
                  </option>
                ))}
              </select>
            )}
            <span className="flex items-center gap-1">
              <Button
                small
                variant="quiet"
                aria-label="The month before"
                onClick={() => set({ month: shiftMonth(month, -1), day: null })}
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="min-w-32 text-center text-sm font-semibold text-slate-800">
                {monthName(month)}
              </span>
              <Button
                small
                variant="quiet"
                aria-label="The month after"
                onClick={() => set({ month: shiftMonth(month, 1), day: null })}
              >
                <ChevronRight size={16} />
              </Button>
            </span>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={`${CARD} overflow-hidden`}>
          <div className="grid grid-cols-7 border-b border-slate-100 text-center text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {WEEK.map((name) => (
              <div key={name} className="py-2">
                {name}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {before.map((day) => (
              <div
                key={day}
                className="min-h-24 border-r border-b border-slate-100 bg-slate-50/50"
              />
            ))}
            {data.days.map((one) => {
              const isToday = one.day === data.today;
              const picked = open === one.day;
              const visits = one.visits.slice(0, 3);
              return (
                <button
                  key={one.day}
                  type="button"
                  onClick={() => set({ day: picked ? null : one.day })}
                  className={`flex min-h-24 flex-col gap-1 border-r border-b border-slate-100 p-1.5 text-left align-top transition-colors hover:bg-slate-50 ${
                    picked
                      ? "bg-emerald-50/70 ring-2 ring-emerald-300 ring-inset"
                      : !one.work
                        ? "bg-slate-50/60"
                        : ""
                  }`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span
                      className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${
                        isToday
                          ? "bg-brand text-white"
                          : one.work
                            ? "text-slate-800"
                            : "text-slate-400"
                      }`}
                    >
                      {Number(one.day.slice(8))}
                    </span>
                    {(one.leave || one.away > 0) && (
                      <span className="truncate rounded bg-violet-50 px-1 text-[10px] font-semibold text-violet-700">
                        {one.leave ? `${LEAVE_WORDS[one.leave]} leave` : `${one.away} out`}
                      </span>
                    )}
                  </span>
                  {one.holiday && (
                    <span className="truncate text-[10px] text-slate-500">{one.holiday}</span>
                  )}
                  {team ? (
                    (one.done > 0 || one.planned > 0 || one.skipped > 0) && (
                      <span className="flex flex-wrap gap-x-2 text-[11px] tabular-nums">
                        {one.done > 0 && (
                          <span className="font-semibold text-emerald-700">✓ {one.done}</span>
                        )}
                        {one.planned > 0 && <span className="text-sky-700">◷ {one.planned}</span>}
                        {one.skipped > 0 && <span className="text-slate-400">✕ {one.skipped}</span>}
                      </span>
                    )
                  ) : (
                    <>
                      {visits.map((visit) => (
                        <span
                          key={visit.id}
                          className={`truncate rounded px-1 text-[11px] ${CHIP[visit.status]}`}
                        >
                          {visit.customer}
                        </span>
                      ))}
                      {one.visits.length > 3 && (
                        <span className="text-[10px] text-slate-500">
                          +{one.visits.length - 3} more
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
            {(["done", "planned", "skipped"] as const).map((key) => (
              <span key={key} className="flex items-center gap-1">
                <span className={`size-2 rounded-full ${DOT[key]}`} />{" "}
                {key === "done" ? "Done" : key === "planned" ? "Planned" : "Skipped"}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-violet-400" /> Leave
            </span>
          </div>
        </section>
        {open && <DayPanel calendar={data} day={open} onClose={() => set({ day: null })} />}
      </div>
    </div>
  );
}

function DayPanel({
  calendar,
  day,
  onClose,
}: {
  calendar: FieldCalendar;
  day: string;
  onClose: () => void;
}) {
  const team = calendar.person === null;
  const query = useQuery({
    queryKey: ["field", "calendar-day", day],
    queryFn: () =>
      api<{ visits: FieldCalendar["days"][number]["visits"] }>(
        `/api/field/calendar/day?day=${day}`,
      ),
    enabled: team,
  });
  const visits = team
    ? (query.data?.visits ?? [])
    : (calendar.days.find((one) => one.day === day)?.visits ?? []);
  const byPerson = new Map<number, typeof visits>();
  for (const visit of visits)
    byPerson.set(visit.personId, [...(byPerson.get(visit.personId) ?? []), visit]);
  return (
    <aside className={`${CARD} flex flex-col self-start overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{dayName(day)}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
        >
          <X size={15} />
        </button>
      </div>
      {team && query.isLoading && <p className="px-4 py-4 text-sm text-slate-500">Loading…</p>}
      {!query.isLoading && visits.length === 0 && (
        <p className="px-4 py-4 text-sm text-slate-500">No visits this day.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {[...byPerson].map(([personId, list]) => (
          <li key={personId} className="px-4 py-3">
            <Link
              to={
                calendar.people.length > 1
                  ? `/visits?person=${personId}&day=${day}`
                  : `/visits?day=${day}`
              }
              className="text-sm font-semibold text-slate-900 hover:text-emerald-700"
            >
              {list[0]?.personName}
            </Link>
            <ul className="mt-1 flex flex-col gap-1">
              {list.map((visit) => (
                <li key={visit.id} className="flex items-center gap-2 text-[13px]">
                  <span className={`size-2 shrink-0 rounded-full ${DOT[visit.status]}`} />
                  <span
                    className={`min-w-0 flex-1 truncate ${visit.status === "skipped" ? "text-slate-400 line-through" : "text-slate-700"}`}
                  >
                    {visit.customer}
                  </span>
                  {visit.at && (
                    <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                      {new Intl.DateTimeFormat("en-PH", {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "Asia/Manila",
                      }).format(new Date(visit.at))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}
