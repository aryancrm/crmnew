// Attendance, the HR app's first page. "Who's working": a day's people with when they came in and
// left, their hours and lateness, and their month so far (HR, the CEO and the Admin everyone; a
// team lead their team; anyone else goes to their own month). A person's month is their DTR, day
// by day, where HR puts a day right with a note, and the person asks for one of their days to be
// put right (their lead or HR decides). HR, the CEO and the Admin see the biometric sheet's times
// beside each day, flagged where they disagree; HR uses them for the day or dismisses the flag.

import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import type { AttendanceDay, AttendanceMonth, AttendanceToday, BiometricDay, LeaveKind } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarPlus, ChevronLeft, ChevronRight, Clock, Pencil, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { clock, hourOf, hours, IN_FROM, OUT_FROM } from "./parts";
import { Button, CARD, Dialog, Field, INPUT, PageHead, PageState, Problem, useAction } from "../ui";
import { LEAVE_WORDS } from "./attendance-report";
import { FixDialog, FixLineRow, fixable } from "./corrections";
import { BiometricDialog, sheetWords } from "./timekeeping";
import { EmptyState, NoResults } from "../no-results";

const LEAVE_SHORT: Record<LeaveKind, string> = { vl: "VL", sl: "SL", lwop: "LWOP", other: "Other" };
const leaveWord = (day: AttendanceDay) =>
  day.leave ? `${day.halfDay ? "Half-day " : ""}${LEAVE_SHORT[day.leave]}` : "";

const manilaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const shift = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekday = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

type Filter = "all" | "working" | "done" | "notIn" | "late" | "leave";

function statusOf(day: AttendanceDay): { word: string; tone: string } {
  if (day.leave && !day.timeIn)
    return {
      word: `On leave · ${leaveWord(day)}`,
      tone: "bg-violet-50 text-violet-800 ring-violet-200",
    };
  if (day.working)
    return { word: "Working", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" };
  if (day.timeIn) return { word: "Done", tone: "bg-sky-50 text-sky-800 ring-sky-200" };
  if (day.kind === "holiday")
    return { word: "Holiday", tone: "bg-slate-50 text-slate-600 ring-slate-200" };
  if (day.kind === "rest")
    return { word: "Rest day", tone: "bg-slate-50 text-slate-600 ring-slate-200" };
  if (day.absent) return { word: "Absent", tone: "bg-rose-50 text-rose-700 ring-rose-200" };
  return { word: "Not in yet", tone: "bg-amber-50 text-amber-800 ring-amber-200" };
}

export function AttendancePage() {
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const today = manilaToday();
  const day = params.get("day") ?? today;
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["attendance", "day", day, unit],
    queryFn: () => api<AttendanceToday>(withUnit(`/api/hr/attendance?day=${day}`, unit)),
    placeholderData: (previous) => previous,
    refetchInterval: day === today ? 60_000 : false,
  });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const data = query.data;
  if (!me) return null;
  if (!data) return <PageState query={query} what="attendance" />;
  // Only themselves to see: their own month is the page.
  if (!unit && data.people.length === 1 && data.people[0]?.personId === me.id)
    return <Navigate to={`/hr/attendance/${me.id}`} replace />;
  const set = (next: string) => {
    const out = new URLSearchParams(params);
    if (next === today) out.delete("day");
    else out.set("day", next);
    setParams(out, { replace: true });
  };
  const words = q.trim().toLowerCase();
  const rows = data.people.filter((one) => {
    if (words && !`${one.name} ${one.team ?? ""} ${one.title ?? ""}`.toLowerCase().includes(words))
      return false;
    if (filter === "working") return one.today.working;
    if (filter === "done") return one.today.timeIn && !one.today.working;
    if (filter === "notIn")
      return (
        !one.today.timeIn && one.today.kind === "work" && (!one.today.leave || one.today.halfDay)
      );
    if (filter === "late") return one.today.lateMinutes > 0;
    if (filter === "leave") return Boolean(one.today.leave);
    return true;
  });
  const tiles: { key: Filter; label: string; value: number; tone: string }[] = [
    { key: "working", label: "Working now", value: data.counts.working, tone: "text-emerald-700" },
    { key: "done", label: "Done for the day", value: data.counts.done, tone: "text-sky-700" },
    {
      key: "notIn",
      label: day === today ? "Not in yet" : "Didn't come",
      value: data.counts.notIn,
      tone: "text-amber-700",
    },
    { key: "late", label: "Came late", value: data.counts.late, tone: "text-rose-700" },
    { key: "leave", label: "On leave", value: data.counts.onLeave, tone: "text-violet-700" },
  ];

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title="Who's working"
        sub={
          data.holiday
            ? `${weekday(day)} · Holiday: ${data.holiday}`
            : `${weekday(day)}${day === today ? " · today" : ""}`
        }
        actions={
          <div className="flex items-center gap-1">
            {data.people.length > 1 && (
              <Link
                to="/hr/report"
                className="mr-2 inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-hover"
              >
                <BarChart3 size={15} /> Report
              </Link>
            )}
            <Button
              small
              variant="quiet"
              aria-label="The day before"
              onClick={() => set(shift(day, -1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <input
              type="date"
              value={day}
              max={today}
              onChange={(event) => event.target.value && set(event.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
            />
            <Button
              small
              variant="quiet"
              aria-label="The day after"
              disabled={day >= today}
              onClick={() => set(shift(day, 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />
      <TeamSwitch />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => setFilter(filter === tile.key ? "all" : tile.key)}
            className={`${CARD} p-4 text-left transition-colors ${filter === tile.key ? "border-emerald-400 ring-2 ring-emerald-100" : "hover:border-slate-300"}`}
          >
            <div className="text-xs font-semibold text-slate-500">{tile.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${tile.tone}`}>
              {tile.value}
            </div>
          </button>
        ))}
      </div>

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <label className="relative flex items-center">
            <Search size={15} className="pointer-events-none absolute left-3 text-slate-400" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Find a person or team"
              className="h-9 w-64 max-w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm"
            />
          </label>
          <span className="text-xs text-slate-500">
            {rows.length} of {data.people.length} people
            {filter !== "all" && (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="ml-2 font-semibold text-emerald-700 hover:underline"
              >
                Show all
              </button>
            )}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Person</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">In</th>
                <th className="px-3 py-2">Out</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">This month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((one) => {
                const status = statusOf(one.today);
                return (
                  <tr key={one.personId} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/hr/attendance/${one.personId}${day !== today ? `?month=${day.slice(0, 7)}` : ""}`}
                        className="font-semibold text-slate-900 hover:text-emerald-700"
                      >
                        {one.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {[one.title, one.team].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${status.tone}`}
                      >
                        {status.word}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2.5 tabular-nums"
                      title={one.today.inFrom ? IN_FROM[one.today.inFrom] : undefined}
                    >
                      {clock(one.today.timeIn)}
                    </td>
                    <td
                      className={`px-3 py-2.5 tabular-nums ${one.today.outFrom === "last_seen" ? "text-slate-400 italic" : ""}`}
                      title={one.today.outFrom ? OUT_FROM[one.today.outFrom] : undefined}
                    >
                      {one.today.working ? "—" : clock(one.today.timeOut)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {hours(one.today.workedMinutes)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${one.today.lateMinutes ? "font-semibold text-amber-700" : "text-slate-400"}`}
                    >
                      {hours(one.today.lateMinutes)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-slate-600 tabular-nums">
                      {one.month.days} days · {hours(one.month.workedMinutes)}
                      {one.month.lateDays > 0 && (
                        <span className="text-amber-700"> · {one.month.lateDays} late</span>
                      )}
                      {one.month.absentDays > 0 && (
                        <span className="text-rose-700"> · {one.month.absentDays} absent</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    {words || filter !== "all" ? (
                      <NoResults title="Nobody here.">Try another tile, or clear the search.</NoResults>
                    ) : (
                      <EmptyState title="Nobody here.">The day's people show here with when they came in and left.</EmptyState>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-slate-500">
        A day starts with the first thing a person does in the app in working hours (or Start my
        day) and ends with End my day; a day nobody ended ends at the last thing they did (shown in
        grey).
      </p>
    </div>
  );
}

const nextMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + by, 1));
  return date.toISOString().slice(0, 7);
};
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export function AttendanceMonthPage() {
  const { id } = useParams();
  const me = useMe().data;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const thisMonth = manilaToday().slice(0, 7);
  const month = params.get("month") ?? thisMonth;
  const query = useQuery({
    queryKey: ["attendance", "month", id, month],
    queryFn: () => api<AttendanceMonth>(`/api/hr/attendance/${id}?month=${month}`),
    placeholderData: (previous) => previous,
  });
  const [fixing, setFixing] = useState<AttendanceDay | null>(null);
  const [addingLeave, setAddingLeave] = useState(false);
  // A day the person asks to be put right (an empty day: any day they pick).
  const [asking, setAsking] = useState<AttendanceDay | "any" | null>(null);
  const [reviewing, setReviewing] = useState<BiometricDay | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the attendance" />;
  const mine = me?.id === data.person.id;
  const go = (next: string) => {
    const out = new URLSearchParams(params);
    if (next === thisMonth) out.delete("month");
    else out.set("month", next);
    setParams(out, { replace: true });
  };
  const days = [...data.days].reverse();
  const biometric = data.biometric ? new Map(data.biometric.map((one) => [one.day, one])) : null;
  const totals: [string, string, string?][] = [
    ["Came in", `${data.totals.present} of ${data.totals.workDays} days`],
    ["Hours worked", hours(data.totals.workedMinutes)],
    ["Absent", String(data.totals.absent), data.totals.absent ? "text-rose-700" : undefined],
    [
      "Late",
      hours(data.totals.lateMinutes),
      data.totals.lateMinutes ? "text-amber-700" : undefined,
    ],
    [
      "Undertime",
      hours(data.totals.undertimeMinutes),
      data.totals.undertimeMinutes ? "text-amber-700" : undefined,
    ],
    [
      "On leave",
      data.totals.leaveDays ? `${data.totals.leaveDays} days` : "—",
      data.totals.leaveDays ? "text-violet-700" : undefined,
    ],
  ];

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <nav aria-label="Where you are" className="flex items-center gap-1.5 text-xs text-slate-500">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/hr/attendance"))}
          aria-label="Back"
          className="mr-1 grid size-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:text-emerald-700"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        {!mine && (
          <>
            <Link to="/hr/attendance" className="hover:text-slate-800">
              Who's working
            </Link>
            <span aria-hidden="true" className="text-slate-300">
              ›
            </span>
          </>
        )}
        <span className="font-medium text-slate-700">
          {mine ? "My attendance" : data.person.name}
        </span>
      </nav>
      <PageHead
        title={mine ? "My attendance" : data.person.name}
        sub={`${data.schedule.name}: ${hourOf(data.schedule.start)} – ${hourOf(data.schedule.end)}, ${data.schedule.days.length === 6 ? "Monday to Saturday" : `${data.schedule.days.length} days a week`}`}
        actions={
          <div className="flex items-center gap-1">
            {data.can.askFix && (
              <Button small className="mr-2" onClick={() => setAsking("any")}>
                <Clock size={15} /> Ask to fix a day
              </Button>
            )}
            {data.can.leave && (
              <Button small className="mr-2" onClick={() => setAddingLeave(true)}>
                <CalendarPlus size={15} /> Record leave
              </Button>
            )}
            <Button
              small
              variant="quiet"
              aria-label="The month before"
              onClick={() => go(nextMonth(month, -1))}
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
              disabled={month >= thisMonth}
              onClick={() => go(nextMonth(month, 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {totals.map(([label, value, tone]) => (
          <div key={label} className={`${CARD} p-3.5`}>
            <div className="text-xs font-semibold text-slate-500">{label}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>
              {value}
            </div>
          </div>
        ))}
      </div>
      <section className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Day</th>
                <th className="px-3 py-2">In</th>
                <th className="px-3 py-2">Out</th>
                {biometric && <th className="px-3 py-2">Biometrics</th>}
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">Undertime</th>
                <th className="px-3 py-2 text-right">After hours</th>
                <th className="px-3 py-2">Note</th>
                {(data.can.putRight || data.can.askFix) && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((one) => {
                const off = one.kind !== "work" && !one.timeIn;
                return (
                  <tr
                    key={one.day}
                    className={
                      off ? "bg-slate-50/60 text-slate-400" : one.absent ? "bg-rose-50/40" : ""
                    }
                  >
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={off ? "" : "font-medium text-slate-800"}>
                        {weekday(one.day)}
                      </span>
                      {one.holiday && (
                        <span className="ml-2 text-[11px] text-slate-500">{one.holiday}</span>
                      )}
                      {one.kind === "rest" && !one.timeIn && (
                        <span className="ml-2 text-[11px]">Rest day</span>
                      )}
                      {one.kind === "before" && (
                        <span className="ml-2 text-[11px]">Before joining</span>
                      )}
                      {one.absent && (
                        <span className="ml-2 text-[11px] font-semibold text-rose-700">Absent</span>
                      )}
                      {one.leave && (
                        <span className="ml-2 rounded bg-violet-50 px-1 text-[11px] font-semibold text-violet-700">
                          Leave · {leaveWord(one)}
                        </span>
                      )}
                      {one.form && (
                        <span className="ml-2 rounded bg-sky-50 px-1 text-[11px] font-semibold text-sky-700">
                          {one.form === "ob" ? "Official business" : "Work from home"}
                        </span>
                      )}
                      {one.overtimeMinutes > 0 && (
                        <span className="ml-2 rounded bg-emerald-50 px-1 text-[11px] font-semibold text-emerald-700">
                          Overtime {hours(one.overtimeMinutes)}
                        </span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 tabular-nums"
                      title={one.inFrom ? IN_FROM[one.inFrom] : undefined}
                    >
                      {clock(one.timeIn)}
                    </td>
                    <td
                      className={`px-3 py-2 tabular-nums ${one.outFrom === "last_seen" ? "text-slate-400 italic" : ""}`}
                      title={one.outFrom ? OUT_FROM[one.outFrom] : undefined}
                    >
                      {one.working ? "Working" : clock(one.timeOut)}
                    </td>
                    {biometric && <BiometricCell day={biometric.get(one.day)} onOpen={setReviewing} />}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {hours(one.workedMinutes)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${one.lateMinutes ? "text-amber-700" : ""}`}
                    >
                      {hours(one.lateMinutes)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${one.undertimeMinutes ? "text-amber-700" : ""}`}
                    >
                      {hours(one.undertimeMinutes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {hours(one.afterHoursMinutes)}
                    </td>
                    <td
                      className="max-w-48 truncate px-3 py-2 text-xs text-slate-500"
                      title={one.note ?? undefined}
                    >
                      {one.note}
                    </td>
                    {data.can.putRight ? (
                      <td className="px-3 py-2 text-right">
                        <Button
                          small
                          variant="quiet"
                          aria-label={`Put ${one.day} right`}
                          onClick={() => setFixing(one)}
                        >
                          <Pencil size={14} />
                        </Button>
                      </td>
                    ) : (
                      data.can.askFix && (
                        <td className="px-3 py-2 text-right">
                          {fixable(one.day) && one.kind !== "before" && !one.working && (
                            <Button
                              small
                              variant="quiet"
                              aria-label={`Ask to fix ${one.day}`}
                              title="Ask to fix this day"
                              onClick={() => setAsking(one)}
                            >
                              <Pencil size={14} />
                            </Button>
                          )}
                        </td>
                      )
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {data.leaves.length > 0 && (
        <section className={`${CARD} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
            Leave this month
          </h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.leaves.map((one) => (
              <LeaveLine key={one.id} leave={one} canCancel={data.can.leave} />
            ))}
          </ul>
        </section>
      )}
      {data.fixes.length > 0 && (
        <section className={`${CARD} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
            Days asked to put right
          </h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.fixes.map((one) => (
              <FixLineRow key={one.id} line={one} />
            ))}
          </ul>
        </section>
      )}
      {asking && (
        <FixDialog
          day={asking === "any" ? undefined : asking.day}
          timeIn={asking === "any" ? undefined : timeOf(asking.timeIn) || undefined}
          timeOut={asking === "any" ? undefined : timeOf(asking.timeOut) || undefined}
          onClose={() => setAsking(null)}
        />
      )}
      {addingLeave && (
        <LeaveDialog
          personId={data.person.id}
          name={data.person.name}
          onClose={() => setAddingLeave(false)}
        />
      )}
      {reviewing && (
        <BiometricDialog name={data.person.name} day={reviewing} onClose={() => setReviewing(null)} />
      )}
      {fixing && (
        <PutRightDialog
          personId={data.person.id}
          name={data.person.name}
          day={fixing}
          onClose={() => setFixing(null)}
        />
      )}
    </div>
  );
}

/** The biometric sheet's day beside the CRM's: its times or code, amber where it needs a look
 *  (HR opens it to use the times or dismiss the flag; answered flags show as answered). */
function BiometricCell({ day, onOpen }: { day: BiometricDay | undefined; onOpen: (day: BiometricDay) => void }) {
  if (!day) return <td className="px-3 py-2 text-slate-300">—</td>;
  const open = !day.resolution && Boolean(day.review || day.flag);
  const why = [day.review, day.flag].filter(Boolean).join(" · ");
  const answered = day.resolution
    ? `${day.resolution.kind === "applied" ? "Used" : "Dismissed"} by ${day.resolution.by}${day.resolution.note ? `: ${day.resolution.note}` : ""}`
    : "";
  return (
    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
      <button
        type="button"
        onClick={() => onOpen(day)}
        title={[`Cell ${day.column}: ${day.raw || "empty"}`, day.codeWords, why, answered].filter(Boolean).join(" · ")}
        className={`rounded px-1 text-xs ${
          open ? "bg-amber-50 font-semibold text-amber-900 ring-1 ring-amber-200" : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        {sheetWords(day)}
        {open && " ⚑"}
      </button>
    </td>
  );
}

const timeOf = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Manila",
      }).format(new Date(iso))
    : "";

function PutRightDialog({
  personId,
  name,
  day,
  onClose,
}: {
  personId: number;
  name: string;
  day: AttendanceDay;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [timeIn, setTimeIn] = useState(timeOf(day.timeIn) || "07:00");
  const [timeOut, setTimeOut] = useState(day.working ? "" : timeOf(day.timeOut));
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/hr/attendance/${personId}`, {
        body: { day: day.day, timeIn, timeOut: timeOut || null, note },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    }
  }
  return (
    <Dialog
      title={`${name} · ${weekday(day.day)}`}
      sub="The day as it really was, and why it is changed."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex gap-3">
          <Field label="Time in" error={action.at("timeIn")}>
            {(field) => (
              <input
                {...field}
                type="time"
                className={INPUT}
                value={timeIn}
                onChange={(event) => setTimeIn(event.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Time out" error={action.at("timeOut")}>
            {(field) => (
              <input
                {...field}
                type="time"
                className={INPUT}
                value={timeOut}
                onChange={(event) => setTimeOut(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Why *" error={action.at("note")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Forgot to sign in; was at Pasay General from 7:30"
              required
            />
          )}
        </Field>
        <Problem message={action.general(["timeIn", "timeOut", "note"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Save the day"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function LeaveLine({
  leave,
  canCancel,
}: {
  leave: AttendanceMonth["leaves"][number];
  canCancel: boolean;
}) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="min-w-0">
        <span className="font-semibold text-violet-800">{LEAVE_WORDS[leave.kind]} leave</span>
        <span className="text-slate-700">
          {" · "}
          {leave.from === leave.to
            ? weekday(leave.from)
            : `${weekday(leave.from)} – ${weekday(leave.to)}`}
          {" · "}
          {leave.halfDay ? "half a day" : `${leave.days} ${leave.days === 1 ? "day" : "days"}`}
        </span>
        <div className="text-xs text-slate-500">
          {leave.reason ? `${leave.reason} · ` : ""}recorded by {leave.madeBy}
        </div>
        <Problem message={action.problem?.message} />
      </div>
      {canCancel && (
        <Button
          small
          variant="quiet"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api(`/api/hr/leave/${leave.id}/cancel`, { body: {} });
              await queries.invalidateQueries({ queryKey: ["attendance"] });
            })
          }
        >
          Cancel it
        </Button>
      )}
    </li>
  );
}

function LeaveDialog({
  personId,
  name,
  onClose,
}: {
  personId: number;
  name: string;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [kind, setKind] = useState<LeaveKind>("vl");
  const [from, setFrom] = useState(manilaToday());
  const [to, setTo] = useState(manilaToday());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api("/api/hr/leave", {
        body: { personId, kind, from, to: halfDay ? from : to, halfDay, reason: reason || null },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["attendance"] });
      onClose();
    }
  }
  return (
    <Dialog
      title={`Leave for ${name}`}
      sub="As they asked for it (their form or message). Rest days and holidays don't count."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Kind" error={action.at("kind")}>
            {(props) => (
              <select
                {...props}
                value={kind}
                onChange={(event) => setKind(event.target.value as LeaveKind)}
                className={INPUT}
              >
                {(Object.keys(LEAVE_WORDS) as LeaveKind[]).map((key) => (
                  <option key={key} value={key}>
                    {LEAVE_WORDS[key]} ({LEAVE_SHORT[key]})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="From" error={action.at("from")}>
            {(props) => (
              <input
                {...props}
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={INPUT}
              />
            )}
          </Field>
          {!halfDay && (
            <Field label="To" error={action.at("to")}>
              {(props) => (
                <input
                  {...props}
                  type="date"
                  value={to}
                  min={from}
                  onChange={(event) => setTo(event.target.value)}
                  className={INPUT}
                />
              )}
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={halfDay}
            onChange={(event) => setHalfDay(event.target.checked)}
            className="size-4 accent-emerald-600"
          />
          Half a day
        </label>
        <Field label="Reason" error={action.at("reason")}>
          {(props) => (
            <input
              {...props}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT}
              placeholder="Family matter"
            />
          )}
        </Field>
        <Problem message={action.general(["kind", "from", "to", "reason"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Record leave"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
