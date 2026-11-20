// SEFMED's Reports (docs/PLAN.md 22): Call reports (a span of days, an MR or all, a status; each
// visit's details), Missed calls, Attendance report (the month with Present / Absent / Leave / Weekly
// off / Holiday and the totals), Day reports and Calls to judge for the team lead, Follow-ups, and
// the year's Holidays.

import type { FollowUpRow, LeadQueue } from "@2mg/api/mr";
import { FOLLOW_UP_WORDS, OBJECTIVE_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarCheck, ClipboardList, ListChecks, PhoneOff, Scale, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { manilaToday } from "../team/range";
import { Button, CARD, Dialog, PageState, Problem, useAction } from "../ui";
import { clockOf, dayWords, Initial, MrHead, monthWords, shiftMonth, StatePill, useMrMe } from "./parts";

type CallRow = {
  id: number;
  day: string;
  status: "planned" | "done" | "skipped" | "missed";
  checkedInAt: string | null;
  doneAt: string | null;
  person: { id: number; name: string };
  client: { id: number; name: string; code: string; city: string | null };
  objectives: string[];
  objectiveNote: string | null;
  feedback: string | null;
  workingWith: string[];
  lastVisit: string | null;
  followUpOn: string | null;
};

export function MrReportsPage() {
  const [params] = useSearchParams();
  const view = params.get("view");
  const mr = useMrMe();
  if (view === "calls" || view === "missed") return <CallReports missed={view === "missed"} />;
  if (view === "attendance") return <Attendance />;
  if (view === "day-reports" || view === "judge") return <LeadLists judge={view === "judge"} />;
  const lead = mr.data?.access === "lead" || mr.data?.access === "viewer";
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title="Reports" back="/mr" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile to="/mr/reports?view=calls" icon={BarChart3} label="Call reports" tone="bg-sky-50 text-sky-700" />
        <Tile to="/mr/reports?view=missed" icon={PhoneOff} label="Missed call report" tone="bg-rose-50 text-rose-700" />
        <Tile to="/mr/reports?view=attendance" icon={CalendarCheck} label="Attendance report" tone="bg-emerald-50 text-emerald-700" />
        <Tile to="/mr/orders" icon={ShoppingCart} label="Order booking report" tone="bg-orange-50 text-orange-700" />
        <Tile to="/mr/follow-ups" icon={ListChecks} label="Follow-ups" tone="bg-amber-50 text-amber-700" />
        {lead && <Tile to="/mr/reports?view=day-reports" icon={ClipboardList} label="Day reports" tone="bg-indigo-50 text-indigo-700" />}
        {lead && <Tile to="/mr/reports?view=judge" icon={Scale} label="Calls to judge" tone="bg-violet-50 text-violet-700" />}
      </div>
    </div>
  );
}

function Tile({ to, icon: Icon, label, tone }: { to: string; icon: typeof BarChart3; label: string; tone: string }) {
  return (
    <Link to={to} className={`flex aspect-[5/4] flex-col items-center justify-center gap-2 rounded-3xl ${tone} p-3 text-center hover:scale-[1.02]`}>
      <Icon size={28} strokeWidth={1.6} />
      <span className="text-xs font-bold uppercase">{label}</span>
    </Link>
  );
}

function CallReports({ missed }: { missed: boolean }) {
  const today = manilaToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState(missed ? "missed" : "");
  const [open, setOpen] = useState<CallRow | null>(null);
  const query = useQuery({
    queryKey: ["mr", "report", "calls", from, to, person, status],
    queryFn: () => api<{ from: string; to: string; rows: CallRow[]; people: { id: number; name: string }[] }>(`/api/mr/reports/calls?${new URLSearchParams({ from, to, ...(person ? { person } : {}), ...(status ? { status } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the call report" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title={missed ? "Missed call report" : "Call reports"} back="/mr/reports" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input type="date" aria-label="From" className="h-9 rounded-lg border border-slate-300 px-2 text-sm" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input type="date" aria-label="To" className="h-9 rounded-lg border border-slate-300 px-2 text-sm" value={to} onChange={(event) => setTo(event.target.value)} />
        {data.people.length > 0 ? (
          <select aria-label="Employee" className="h-9 rounded-lg border border-slate-300 px-2 text-sm" value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="">All</option>
            {data.people.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
          </select>
        ) : <span />}
        <select aria-label="Status" className="h-9 rounded-lg border border-slate-300 px-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All</option>
          <option value="done">Closed</option>
          <option value="planned">Open</option>
          <option value="skipped">Skipped</option>
          <option value="missed">Missed</option>
        </select>
      </div>
      <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-sky-800">Total visits ({data.rows.length})</div>
      <ul className="flex flex-col gap-2">
        {data.rows.map((one) => (
          <li key={one.id}>
            <button type="button" onClick={() => setOpen(one)} className={`${CARD} flex w-full items-start gap-3 p-3 text-left hover:border-sky-300`}>
              <Initial name={one.client.name} />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-2"><b className="truncate">{one.client.name}</b><StatePill visit={one} /></span>
                <span className="flex justify-between gap-2 text-xs text-slate-500"><span>{one.client.city}</span><span>{dayWords(one.day)}</span></span>
                <span className="block text-xs text-slate-600">Emp name: {one.person.name}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Dialog title="Visit details" onClose={() => setOpen(null)}>
          <dl className="grid gap-1.5 text-sm">
            <Line label="Employee name" value={open.person.name} />
            <Line label="Client name" value={open.client.name} />
            <Line label="Client no" value={open.client.code} />
            <Line label="Visit date" value={dayWords(open.day)} />
            <Line label="Last visit date" value={open.lastVisit ? dayWords(open.lastVisit) : "NA"} />
            <Line label="Check-in time" value={open.checkedInAt ? clockOf(open.checkedInAt) : "—"} />
            <Line label="Check-out time" value={open.doneAt ? clockOf(open.doneAt) : "—"} />
            <Line label="Call objective" value={open.objectives.map((key) => OBJECTIVE_WORDS[key as keyof typeof OBJECTIVE_WORDS] ?? key).join(", ")} />
            <Line label="Call objective remark" value={open.objectiveNote ?? ""} />
            <Line label="Working with" value={open.workingWith.join(", ")} />
            <Line label="Client's feedback" value={open.feedback ?? ""} />
            <Line label="Follow up date" value={open.followUpOn ? dayWords(open.followUpOn) : "NA"} />
          </dl>
          <Link to={`/mr/visits/${open.id}`} className="mt-3 inline-block text-sm font-semibold text-sky-700">Open the visit</Link>
        </Dialog>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-500">{label}:</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

const MARKS = {
  present: { label: "Present", tone: "bg-emerald-500" },
  absent: { label: "Absent", tone: "bg-rose-500" },
  leave: { label: "Leave", tone: "bg-amber-500" },
  weekly_off: { label: "Weekly off", tone: "bg-slate-900" },
  holiday: { label: "Holiday", tone: "bg-indigo-800" },
} as const;

function Attendance() {
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(manilaToday().slice(0, 7));
  const person = params.get("person");
  const query = useQuery({
    queryKey: ["mr", "report", "attendance", month, person],
    queryFn: () =>
      api<{
        month: string;
        person: { id: number; name: string };
        days: { day: string; mark: keyof typeof MARKS | "ahead"; startedAt: string | null; workType: string | null }[];
        totals: { present: number; absent: number; leave: number; weeklyOff: number; holiday: number };
        people: { id: number; name: string }[];
      }>(`/api/mr/reports/attendance?${new URLSearchParams({ month, ...(person ? { person } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the attendance" />;
  const blank = new Date(`${data.month}-01T00:00:00Z`).getUTCDay();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <MrHead title="Attendance report" back="/mr/reports" sub={data.person.name} />
      <div className="flex flex-wrap items-center gap-2">
        <Button small variant="quiet" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
        <span className="text-sm font-semibold">{monthWords(data.month)}</span>
        <Button small variant="quiet" onClick={() => setMonth(shiftMonth(month, 1))}>›</Button>
        {data.people.length > 0 && (
          <select aria-label="Whose" className="h-9 rounded-lg border border-slate-300 px-2 text-sm" value={person ?? ""} onChange={(event) => { const out = new URLSearchParams(params); if (event.target.value) out.set("person", event.target.value); else out.delete("person"); setParams(out, { replace: true }); }}>
            <option value="">Mine</option>
            {data.people.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
          </select>
        )}
      </div>
      <div className="grid grid-cols-5 overflow-hidden rounded-lg text-center text-[11px] font-bold text-white">
        {Object.values(MARKS).map((one) => <div key={one.label} className={`${one.tone} py-1.5`}>{one.label.toUpperCase()}</div>)}
      </div>
      <div className={`${CARD} grid grid-cols-7 p-2 text-center text-sm`}>
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((one) => <div key={one} className="py-1 text-xs font-semibold text-slate-600">{one}</div>)}
        {Array.from({ length: blank }, (_, at) => <div key={`b${at}`} />)}
        {data.days.map((one) => (
          <div key={one.day} className="border border-slate-100 py-2" title={one.startedAt ? `Started ${clockOf(one.startedAt)}` : undefined}>
            {one.mark !== "ahead" && <span className={`mx-auto mb-0.5 block size-1.5 rounded-full ${MARKS[one.mark].tone}`} />}
            {Number(one.day.slice(8))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 overflow-hidden rounded-lg text-center text-[11px] font-bold text-white">
        <div className="bg-emerald-500 py-1.5">{data.totals.present}<br />PRESENT</div>
        <div className="bg-rose-500 py-1.5">{data.totals.absent}<br />ABSENT</div>
        <div className="bg-amber-500 py-1.5">{data.totals.leave}<br />LEAVE</div>
        <div className="bg-slate-900 py-1.5">{data.totals.weeklyOff}<br />WEEKLY OFF</div>
        <div className="bg-indigo-800 py-1.5">{data.totals.holiday}<br />HOLIDAY</div>
      </div>
    </div>
  );
}

function LeadLists({ judge }: { judge: boolean }) {
  const query = useQuery({ queryKey: ["mr", "queue"], queryFn: () => api<LeadQueue>("/api/mr/team/queue") });
  if (!query.data) return <PageState query={query} what="the list" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title={judge ? "Calls to judge" : "Day reports to see"} back="/mr" />
      <ul className="flex flex-col gap-2">
        {judge
          ? query.data.judge.map((one) => (
              <li key={one.id}>
                <Link to={`/mr/visits/${one.id}`} className={`${CARD} block p-3 text-sm hover:border-sky-300`}>
                  <b>{one.client.name}</b> · {one.person.name} · {dayWords(one.day)}
                  {one.feedback && <div className="text-slate-500">“{one.feedback}”</div>}
                </Link>
              </li>
            ))
          : query.data.reports.map((one) => (
              <li key={`${one.personId}-${one.day}`}>
                <Link to={`/mr/day-report?person=${one.personId}&day=${one.day}`} className={`${CARD} block p-3 text-sm hover:border-sky-300`}>
                  <b>{one.name}</b> · {dayWords(one.day)} · {one.done} closed{one.missed ? ` · ${one.missed} missed` : ""}
                </Link>
              </li>
            ))}
      </ul>
      {(judge ? query.data.judge : query.data.reports).length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>Nothing waiting.</div>}
    </div>
  );
}

export function MrFollowUpsPage() {
  const [done, setDone] = useState(false);
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({ queryKey: ["mr", "follow-ups", done], queryFn: () => api<{ rows: FollowUpRow[] }>(`/api/mr/follow-ups${done ? "?status=done" : ""}`) });
  const today = manilaToday();
  if (!query.data) return <PageState query={query} what="the follow-ups" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title="Follow-ups" back="/mr" actions={<Button small variant="quiet" onClick={() => setDone(!done)}>{done ? "Open ones" : "Done ones"}</Button>} />
      <ul className="flex flex-col gap-2">
        {query.data.rows.map((one) => (
          <li key={one.id} className={`${CARD} flex flex-wrap items-center justify-between gap-2 p-3 text-sm`}>
            <span className="min-w-0">
              <b className={one.status === "open" && one.dueOn < today ? "text-rose-700" : ""}>{dayWords(one.dueOn)}</b> · {FOLLOW_UP_WORDS[one.kind]}: {one.what}
              <span className="block text-xs text-slate-500">
                <Link to={`/mr/clients/${one.client.id}`} className="hover:underline">{one.client.name}</Link> · {one.person.name}
                {one.doneNote ? ` · ${one.doneNote}` : ""}
              </span>
            </span>
            {one.status === "open" && (
              <Button small disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/follow-ups/${one.id}`, { body: { drop: false } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Done</Button>
            )}
          </li>
        ))}
      </ul>
      {query.data.rows.length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>{done ? "Nothing done yet." : "No follow-ups open."}</div>}
      <Problem message={action.problem?.message} />
    </div>
  );
}

export function MrHolidaysPage() {
  const year = manilaToday().slice(0, 4);
  const query = useQuery({ queryKey: ["mr", "holidays", year], queryFn: () => api<{ rows: { day: string; name: string; kind: string }[] }>(`/api/mr/holidays?year=${year}`) });
  if (!query.data) return <PageState query={query} what="the holidays" />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <MrHead title="Holidays" back="/mr" sub={year} />
      <ul className={`${CARD} divide-y divide-slate-100`}>
        {query.data.rows.map((one) => (
          <li key={one.day} className="flex justify-between gap-2 px-4 py-2.5 text-sm">
            <span>{one.name}</span>
            <span className="text-slate-500">{dayWords(one.day)}{one.kind === "special" ? " · special" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
