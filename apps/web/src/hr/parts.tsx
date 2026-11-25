// HR's shared pieces: the times and hours in words, the top bar's "My day" (when it started, Start
// or End my day, the hours so far), and the CEO Home's "At work today" card.

import type { MrHome } from "@2mg/api/mr";
import type { AttendanceDay, AttendanceToday, MyDay } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, LogIn, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { StartWorkingDialog } from "../mr/home";
import { useFieldRep, useMrMe } from "../mr/parts";
import { Donut } from "../team/charts";
import { GlanceCard, useSeeAll } from "../team/glance";
import { Problem, useAction } from "../ui";

/** "7:42 AM" in Manila. */
export const clock = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-PH", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Manila",
      }).format(new Date(iso))
    : "—";

/** "8h 05m", "45m", "—". */
export const hours = (minutes: number) => {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

/** A clock time "07:00" as "7:00 AM". */
export const hourOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  const suffix = (h ?? 0) < 12 ? "AM" : "PM";
  return `${(((h ?? 0) + 11) % 12) + 1}:${String(m ?? 0).padStart(2, "0")} ${suffix}`;
};

/** Where a day's time out came from, in words. */
export const OUT_FROM: Record<NonNullable<AttendanceDay["outFrom"]>, string> = {
  button: "Ended the day",
  last_seen: "Last seen (didn't end the day)",
  field: "Field day ended",
  hr: "Put right by HR",
};
export const IN_FROM: Record<NonNullable<AttendanceDay["inFrom"]>, string> = {
  sign_in: "First thing they did",
  button: "Started the day",
  field: "Field day started",
  hr: "Put right by HR",
};

/** The top bar's "My day": the day's start, Start / End my day, and a way to the month. */
export function MyDayButton() {
  const me = useMe().data;
  const queries = useQueryClient();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ["my-day"],
    queryFn: () => api<MyDay>("/api/hr/my-day"),
    refetchInterval: 60_000,
  });
  // A MedRep in the field has one Start (Aryan, 20 Nov): the top bar's Start is Start working
  // itself (the field day and attendance together), and while the field day runs, ending the day
  // is the day report (Stop working).
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const mr = useMrMe();
  // Only a MedRep whose own menu has My day (Hospital, Rx, PAP…; not TeleSales, B2B, Bidding or
  // the Online office): the others' Start stays attendance alone.
  const fieldRep = useFieldRep();
  const fieldDay = useQuery({
    queryKey: ["mr", "home"],
    queryFn: () => api<MrHome>("/api/mr/home"),
    enabled: fieldRep,
  });
  const fieldRunning = fieldRep && Boolean(fieldDay.data?.day && !fieldDay.data.day.endedAt);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const data = query.data;
  if (!me || !data) return null;
  const day = data.today;
  const looking = Boolean(me.viewedBy);
  const run = (path: string) =>
    action.run(async () => {
      await api(path, { body: {} });
      await queries.invalidateQueries({ queryKey: ["my-day"] });
      await queries.invalidateQueries({ queryKey: ["attendance"] });
      setOpen(false);
    });

  // A field rep who has signed in but not started the field day (Aryan, 23 Nov: "where does the day
  // start?"): signing in marks attendance by itself, so the button would read "In since" before any
  // work. Until Start working is pressed it stays Start, the same one as on Home and My day.
  const fieldWaiting = fieldRep && fieldDay.isSuccess && !fieldDay.data.day;
  // Not started (a rest day, before work, or never signed in today): one button.
  if (!day.timeIn || fieldWaiting)
    return looking ? null : (
      <>
        <button
          type="button"
          onClick={() => (fieldRep ? setStarting(true) : run("/api/hr/day/start"))}
          disabled={action.busy || mr.isPending}
          title={action.problem?.message ?? "Start your working day"}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#2563eb] px-2.5 text-xs font-semibold text-white hover:bg-[#1d4ed8] sm:px-3"
        >
          <LogIn size={14} aria-hidden="true" /> Start<span className="hidden sm:inline">{fieldRep ? " working" : " my day"}</span>
        </button>
        {starting && <StartWorkingDialog onClose={() => setStarting(false)} />}
      </>
    );

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((now) => !now)}
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
          day.working
            ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${day.working ? "bg-white" : "bg-slate-400"}`}
        />
        {day.working ? (
          <>
            <span className="hidden sm:inline">In since </span>
            {clock(fieldRunning && fieldDay.data?.day ? fieldDay.data.day.startedAt : day.timeIn)}
          </>
        ) : (
          `Done · ${hours(day.workedMinutes)}`
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="My day"
          className="absolute right-0 z-40 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="text-sm font-semibold text-slate-900">Today</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Working hours {hourOf(data.schedule.start)} – {hourOf(data.schedule.end)}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["In", clock(day.timeIn)],
                ["Out", day.working ? "—" : clock(day.timeOut)],
                ["Hours", hours(day.workedMinutes)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-1 py-1.5">
                <dt className="text-[10px] text-slate-500">{label}</dt>
                <dd className="text-sm font-semibold text-slate-900 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {day.lateMinutes > 0 && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Late {hours(day.lateMinutes)} today
            </p>
          )}
          <Problem message={action.problem?.message} />
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <Link
              to={`/hr/attendance/${me.id}`}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
            >
              <CalendarClock size={13} aria-hidden="true" /> My attendance
            </Link>
            {day.working && !looking && (
              <button
                type="button"
                onClick={() => {
                  if (!fieldRunning) return run("/api/hr/day/end");
                  setOpen(false);
                  navigate("/field/day-report");
                }}
                disabled={action.busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <LogOut size={13} aria-hidden="true" /> End my day
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The CEO Home's "At work today": who is working, done, not in yet, and who came late. */
export function AtWorkCard() {
  const query = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: () => api<AttendanceToday>("/api/hr/attendance"),
    refetchInterval: 120_000,
  });
  const data = query.data;
  const late = (data?.people ?? [])
    .filter((one) => one.today.lateMinutes > 0)
    .sort((a, b) => b.today.lateMinutes - a.today.lateMinutes);
  const notIn = (data?.people ?? []).filter(
    (one) => !one.today.timeIn && one.today.kind === "work" && !one.today.leave,
  );
  const lateList = useSeeAll(late, 4);
  if (!data) return null;
  const working = data.counts.working + data.counts.done;
  const expected = data.people.filter((one) => one.today.kind === "work").length;
  return (
    <GlanceCard
      title="At work today"
      note={data.holiday ? `Holiday: ${data.holiday}` : expected === 0 ? "Rest day" : undefined}
      to="/hr/report"
      seeAll={lateList.seeAll}
      head={
        expected === 0 ? (
          <div className="text-sm text-slate-500">
            No working day today{working ? ` · ${working} came in anyway` : ""}.
          </div>
        ) : (
          <div className="text-2xl font-semibold text-slate-900 tabular-nums">
            {working}
            <span className="text-sm font-medium text-slate-500"> of {expected} came in</span>
          </div>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
        <Donut
          label="Today at work"
          middle={String(data.counts.working)}
          slices={[
            { label: "Working now", value: data.counts.working, color: "#059669" },
            { label: "Done for the day", value: data.counts.done, color: "#0ea5e9" },
            { label: "Not in yet", value: data.counts.notIn, color: "#f59e0b" },
            { label: "On leave", value: data.counts.onLeave, color: "#8b5cf6" },
          ]}
        />
        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-xs font-semibold text-slate-500">
              Came late{late.length ? ` · ${late.length}` : ""}
            </div>
            {late.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">Nobody late today.</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100">
                {lateList.shown.map((one) => (
                  <li key={one.personId}>
                    <Link
                      to={`/hr/attendance/${one.personId}`}
                      className="flex items-center justify-between gap-2 py-1.5 text-[13px] hover:text-emerald-700"
                    >
                      <span className="truncate">{one.name}</span>
                      <span className="shrink-0 text-xs text-amber-700 tabular-nums">
                        in {clock(one.today.timeIn)} · {hours(one.today.lateMinutes)} late
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {notIn.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500">
                Not in yet · {notIn.length}
              </div>
              <p className="mt-1 truncate text-[13px] text-slate-600">
                {notIn
                  .slice(0, 6)
                  .map((one) => one.name)
                  .join(", ")}
                {notIn.length > 6 ? ` and ${notIn.length - 6} more` : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </GlanceCard>
  );
}
