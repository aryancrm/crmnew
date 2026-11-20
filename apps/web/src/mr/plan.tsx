// SEFMED's Tour Plan Calendar (docs/PLAN.md 22): the month with marks (tour plan, pending leave,
// cancelled / rejected leave, approved leave, holiday, back-dated visit), a list view; a tap on a
// day opens "Select action" (your work city for the day; view / reschedule visits; add visits to
// KOLs, firms, hospitals by city; the day's work place; working with); Create tour plan sends the
// month to the team lead, who approves or sends it back; revisions and deviations are kept.

import type { ClientKind, ClientList, DeviationRow, PlanMonth, VisitList, WorkType } from "@2mg/api/mr";
import { DEVIATION_WORDS, KIND_TABS, PLAN_WORDS, WORK_TYPES, WORK_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, List, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { manilaToday } from "../team/range";
import { Button, CARD, Dialog, PageState, Problem, useAction } from "../ui";
import { ActionSheet, Choices, dayWords, FIELD, Label, MrHead, monthWords, shiftMonth, StatePill, useMrMe } from "./parts";

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MrPlanPage() {
  const [params, setParams] = useSearchParams();
  const mr = useMrMe();
  const view = params.get("view");
  if (view === "deviations") return <Deviations />;
  if (view === "team" && mr.data && mr.data.access !== "mr") return <TeamPlans />;
  return <PlanCalendar person={params.get("person")} month={params.get("month")} onMonth={(month) => { const out = new URLSearchParams(params); out.set("month", month); setParams(out, { replace: true }); }} />;
}

function PlanCalendar({ person, month, onMonth }: { person: string | null; month: string | null; onMonth: (month: string) => void }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const query = useQuery({
    queryKey: ["mr", "plan", person, month],
    queryFn: () => api<PlanMonth>(`/api/mr/plan?${new URLSearchParams({ ...(person ? { person } : {}), ...(month ? { month } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const [list, setList] = useState(false);
  const [picked, setPicked] = useState<PlanMonth["days"][number] | null>(null);
  const [open, setOpen] = useState<{ what: "place" | "add" | "view"; day: string; kind?: ClientKind } | null>(null);
  const [deciding, setDeciding] = useState<"approve" | "back" | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the tour plan" />;
  const blank = new Date(`${data.month}-01T00:00:00Z`).getUTCDay();
  const mine = !person;
  const send = () =>
    action.run(async () => {
      await api("/api/mr/plan/send", { body: { month: data.month } });
      await queries.invalidateQueries({ queryKey: ["mr"] });
    });
  const status = data.plan.status;
  const missing = data.days.filter((one) => one.work && !one.leave && !one.plan && one.planned === 0 && one.day >= data.today);
  return (
    <div className={`mx-auto flex max-w-3xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead
        title="Tour plan calendar"
        back="/mr"
        sub={`${mine ? "" : `${data.person.name} · `}${status ? `${PLAN_WORDS[status]}${data.plan.revision ? ` · revision ${data.plan.revision}` : ""}` : "Not made yet"}`}
        actions={<Button small variant="quiet" onClick={() => setList(!list)}><List size={15} /> {list ? "Calendar view" : "List view"}</Button>}
      />
      {data.plan.note && <div className={`rounded-xl px-3 py-2 text-sm ${status === "sent_back" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{data.plan.decidedBy}: {data.plan.note}</div>}
      <div className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between bg-sky-200/70 px-3 py-2">
          <Button small variant="quiet" aria-label="Month before" onClick={() => onMonth(shiftMonth(data.month, -1))}><ChevronLeft size={16} /></Button>
          <span className="font-semibold text-sky-900">{monthWords(data.month)}</span>
          <Button small variant="quiet" aria-label="Month after" onClick={() => onMonth(shiftMonth(data.month, 1))}><ChevronRight size={16} /></Button>
        </div>
        {list ? (
          <ul className="divide-y divide-slate-100">
            {data.days.filter((one) => one.plan || one.planned || one.holiday || one.leave).map((one) => (
              <li key={one.day}>
                <button type="button" onClick={() => setPicked(one)} className="flex w-full justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                  <span>
                    <b>{dayWords(one.day)}</b>{" "}
                    {one.plan ? `${WORK_WORDS[one.plan.workType]} · ${one.plan.cities.join(", ")}` : ""}
                    {one.holiday ? ` · ${one.holiday}` : ""}
                    {one.leave ? ` · leave ${one.leave}` : ""}
                  </span>
                  <span className="text-slate-500">{one.done}/{one.planned} visits</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-7 text-center">
            {WEEK.map((one) => (
              <div key={one} className="bg-sky-100/60 py-1.5 text-xs font-semibold text-sky-900">{one}</div>
            ))}
            {Array.from({ length: blank }, (_, at) => <div key={`b${at}`} />)}
            {data.days.map((one) => (
              <button
                key={one.day}
                type="button"
                onClick={() => setPicked(one)}
                className={`relative min-h-14 border-t border-l border-slate-100 p-1 text-sm hover:bg-sky-50 ${one.day === data.today ? "bg-sky-300/60 font-bold" : ""} ${!one.work ? "text-slate-400" : "text-slate-800"}`}
              >
                <span className="absolute top-1 left-1 flex gap-0.5">
                  {(one.plan || one.planned > 0) && <Dot tone="bg-emerald-500" />}
                  {one.leave === "asked" && <Dot tone="bg-yellow-400" />}
                  {one.leave === "refused" && <Dot tone="bg-rose-500" />}
                  {one.leave === "approved" && <Dot tone="bg-purple-500" />}
                  {one.holiday && <Dot tone="bg-indigo-800" />}
                  {one.backDated > 0 && <Dot tone="bg-cyan-400" />}
                </span>
                <span className="block pt-2">{Number(one.day.slice(8))}</span>
                {one.planned > 0 && <span className="block text-[10px] text-slate-500">{one.done}/{one.planned}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="grid grid-cols-2 gap-1 px-1 text-xs text-slate-700 sm:grid-cols-3">
        <li className="flex items-center gap-1.5"><Dot tone="bg-emerald-500" /> Tour plan</li>
        <li className="flex items-center gap-1.5"><Dot tone="bg-yellow-400" /> Pending leave</li>
        <li className="flex items-center gap-1.5"><Dot tone="bg-rose-500" /> Cancelled / rejected leave</li>
        <li className="flex items-center gap-1.5"><Dot tone="bg-purple-500" /> Approved leave</li>
        <li className="flex items-center gap-1.5"><Dot tone="bg-indigo-800" /> Holiday</li>
        <li className="flex items-center gap-1.5"><Dot tone="bg-cyan-400" /> Back-dated visit</li>
      </ul>
      {mine && missing.length > 0 && status !== "approved" && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Working days with no plan yet: {missing.map((one) => Number(one.day.slice(8))).join(", ")}
        </div>
      )}
      <Problem message={action.problem?.message} />
      {data.can.send && (
        <Button variant="primary" className="w-full" disabled={action.busy} onClick={send}>
          <Send size={15} /> CREATE TOUR PLAN (send to my team lead)
        </Button>
      )}
      {data.can.decide && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => setDeciding("approve")}>Approve</Button>
          <Button onClick={() => setDeciding("back")}>Send back</Button>
        </div>
      )}
      {data.revisions.length > 0 && (
        <section className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold">Revisions</h2>
          <ul className="text-[13px] text-slate-700">
            {data.revisions.map((one) => (
              <li key={one.revision}>Revision {one.revision}: {one.status === "approved" ? "approved" : "sent back"} by {one.by} · {one.visits} visits{one.note ? ` · ${one.note}` : ""}</li>
            ))}
          </ul>
        </section>
      )}
      {data.deviations.length > 0 && <DeviationList rows={data.deviations} />}

      {picked && (
        <ActionSheet
          title={dayWords(picked.day)}
          sub={
            picked.plan
              ? `Your work city for the day is ${picked.plan.cities.join(", ") || WORK_WORDS[picked.plan.workType]}`
              : picked.holiday ?? (picked.leave ? `Leave (${picked.leave})` : "No plan for this day yet")
          }
          onClose={() => setPicked(null)}
          actions={[
            { label: "View / reschedule visits", hint: `${picked.planned}`, onPick: () => setOpen({ what: "view", day: picked.day }) },
            { label: "Work place and city for the day", hidden: !data.can.edit || picked.day < data.today, onPick: () => setOpen({ what: "place", day: picked.day }) },
            { label: "Add new visits to KOLs", hidden: !data.can.edit || picked.day < data.today, onPick: () => setOpen({ what: "add", day: picked.day, kind: "doctor" }) },
            { label: "Add new visit to firm", hidden: !data.can.edit || picked.day < data.today, onPick: () => setOpen({ what: "add", day: picked.day, kind: "firm" }) },
            { label: "Add new visit to hospital", hidden: !data.can.edit || picked.day < data.today, onPick: () => setOpen({ what: "add", day: picked.day, kind: "hospital" }) },
            { label: "Add / update working with", hidden: !data.can.edit || picked.day < data.today, onPick: () => setOpen({ what: "place", day: picked.day }) },
            { label: "Open the day's visits", onPick: () => navigate(`/mr/visits?day=${picked.day}${person ? `&person=${person}` : ""}`) },
          ]}
        />
      )}
      {open?.what === "place" && <DayPlaceDialog data={data} day={open.day} onClose={() => setOpen(null)} />}
      {open?.what === "add" && (
        <AddVisitsDialog
          day={open.day}
          kind={open.kind ?? "doctor"}
          cities={data.days.find((one) => one.day === open.day)?.plan?.cities}
          approved={status === "approved"}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.what === "view" && <DayVisits day={open.day} person={person} onClose={() => setOpen(null)} />}
      {deciding && <DecideDialog data={data} approve={deciding === "approve"} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function Dot({ tone }: { tone: string }) {
  return <span className={`inline-block size-1.5 rounded-full ${tone}`} />;
}

function DayPlaceDialog({ data, day, onClose }: { data: PlanMonth; day: string; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const mr = useMrMe();
  const known = data.days.find((one) => one.day === day)?.plan;
  const [workType, setWorkType] = useState<WorkType>(known?.workType ?? "hq");
  const [cities, setCities] = useState<string[]>(known?.cities ?? []);
  const [typed, setTyped] = useState("");
  const [why, setWhy] = useState("");
  const partners = useQuery({ queryKey: ["mr", "members"], queryFn: () => api<{ members: { personId: number; name: string; active: boolean }[] }>("/api/mr/members") });
  const [withWhom, setWithWhom] = useState<number[]>(known?.workingWith.map((one) => one.id) ?? []);
  const others = (partners.data?.members ?? []).filter((one) => one.active && one.personId !== data.person.id);
  return (
    <Dialog title={`Plan ${dayWords(day)}`} sub="Please select the city to add visits" onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <Label text="Work place">
          <Choices options={WORK_TYPES.map((key) => ({ key, label: WORK_WORDS[key] }))} value={[workType]} onChange={(next) => setWorkType(next[0] ?? "hq")} />
        </Label>
        <Label text="Cities *" error={action.at("cities")}>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {data.cities.map((one) => (
              <label key={one} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" checked={cities.includes(one)} onChange={(event) => setCities((all) => (event.target.checked ? [...all, one] : all.filter((c) => c !== one)))} /> {one}
              </label>
            ))}
            {data.cities.length === 0 && <p className="text-xs text-slate-500">No clients with a city yet: type one below.</p>}
          </div>
          <input className={`${FIELD} mt-1.5`} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Another city" />
        </Label>
        {others.length > 0 && (
          <Label text="Working with">
            <Choices options={others.map((one) => ({ key: String(one.personId), label: one.name }))} value={withWhom.map(String)} onChange={(next) => setWithWhom(next.map(Number))} many />
          </Label>
        )}
        {data.plan.status === "approved" && (
          <Label text="Why the change (the plan is approved) *" error={action.at("why")}>
            <input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} />
          </Label>
        )}
        <Problem message={action.general(["cities", "why"])} />
        <Button
          variant="primary"
          disabled={action.busy || !mr.data}
          onClick={() =>
            action.run(async () => {
              await api("/api/mr/plan/day", { body: { day, workType, cities: typed.trim() ? [...cities, typed.trim()] : cities, workingWith: withWhom, why: why || null } });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
            })
          }
        >
          OK
        </Button>
      </div>
    </Dialog>
  );
}

/** Pick clients (by the day's cities) and put them on a day. Exported for the visits and
 *  clients pages; on the day itself, once working, it asks why (added on the day). */
export function AddVisitsDialog({
  day: asked,
  kind: firstKind,
  cities: dayCities,
  preset,
  approved,
  onTheDay,
  onClose,
}: {
  day: string;
  kind: ClientKind;
  cities?: string[];
  preset?: number[];
  approved?: boolean;
  onTheDay?: boolean;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const today = manilaToday();
  const [day, setDay] = useState(asked < today ? today : asked);
  const [kind, setKind] = useState<ClientKind>(firstKind);
  const [cities, setCities] = useState<string[]>(dayCities ?? []);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>(preset ?? []);
  const [why, setWhy] = useState("");
  const list = useQuery({
    queryKey: ["mr", "pick", kind, cities.join("|"), q],
    queryFn: () => api<ClientList["rows"]>(`/api/mr/clients/pick?${new URLSearchParams({ kind, cities: cities.join("|"), ...(q ? { q } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const allCities = useQuery({ queryKey: ["mr", "plan", null, null], queryFn: () => api<PlanMonth>("/api/mr/plan") });
  const presetOnly = Boolean(preset?.length);
  return (
    <Dialog title={presetOnly ? "Add visit" : `Add new visits to ${KIND_TABS[kind]}`} sub={cities.length ? `Cities: ${cities.join(", ")}` : undefined} onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <Label text="Day" error={action.at("day")}>
          <input type="date" className={FIELD} min={today} value={day} onChange={(event) => setDay(event.target.value)} />
        </Label>
        {!presetOnly && (
          <>
            <Choices options={(["doctor", "hospital", "firm"] as ClientKind[]).map((key) => ({ key, label: KIND_TABS[key] }))} value={[kind]} onChange={(next) => setKind(next[0] ?? "doctor")} />
            <Label text="Please select city to add visits">
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {(allCities.data?.cities ?? []).map((one) => (
                  <button key={one} type="button" onClick={() => setCities((all) => (all.includes(one) ? all.filter((c) => c !== one) : [...all, one]))} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${cities.includes(one) ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 text-slate-700"}`}>
                    {one}
                  </button>
                ))}
              </div>
            </Label>
            <input className={FIELD} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search a name or code" />
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {(list.data ?? []).map((one) => (
                <li key={one.id}>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm">
                    <input type="checkbox" checked={picked.includes(one.id)} onChange={(event) => setPicked((all) => (event.target.checked ? [...all, one.id] : all.filter((id) => id !== one.id)))} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{one.name}</span>
                      <span className="block truncate text-xs text-slate-500">{[one.code, one.specialty ?? one.detail, one.city, one.assignedTo?.name].filter(Boolean).join(" · ")}</span>
                    </span>
                  </label>
                </li>
              ))}
              {list.data?.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">No {KIND_TABS[kind]} in these cities.</li>}
            </ul>
          </>
        )}
        {(onTheDay || approved || day === today) && (
          <Label text={`Why isn't it in the plan?${approved || onTheDay ? " *" : " (needed once you've started working)"}`} error={action.at("why")}>
            <input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} placeholder="Doctor called me, met on the way…" />
          </Label>
        )}
        <Problem message={action.general(["day", "why"])} />
        <Button
          variant="primary"
          disabled={action.busy || picked.length === 0}
          onClick={() =>
            action.run(async () => {
              await api("/api/mr/visits", { body: { day, clientIds: picked, why: why || null } });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
            })
          }
        >
          Add {picked.length || ""} visit{picked.length === 1 ? "" : "s"}
        </Button>
      </div>
    </Dialog>
  );
}

function DayVisits({ day, person, onClose }: { day: string; person: string | null; onClose: () => void }) {
  const visitsOf = (kind: ClientKind) => ({
    queryKey: ["mr", "visits", kind, null, day, person],
    queryFn: () => api<VisitList>(`/api/mr/visits?${new URLSearchParams({ kind, day, ...(person ? { person } : {}) })}`),
  });
  const doctors = useQuery(visitsOf("doctor"));
  const hospitals = useQuery(visitsOf("hospital"));
  const firms = useQuery(visitsOf("firm"));
  const rows = [doctors, hospitals, firms].flatMap((one) => one.data?.rows ?? []);
  return (
    <Dialog title={`Visits on ${dayWords(day)}`} onClose={onClose}>
      <ul className="flex flex-col gap-2">
        {rows.map((one) => (
          <li key={one.id}>
            <Link to={`/mr/visits/${one.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-sky-300">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{one.client.name}</span>
                <span className="block text-xs text-slate-500">{[one.client.detail ?? one.client.specialty, one.client.city].filter(Boolean).join(", ")}</span>
              </span>
              <StatePill visit={one} />
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-slate-500">No visits on this day.</li>}
      </ul>
    </Dialog>
  );
}

function DecideDialog({ data, approve, onClose }: { data: PlanMonth; approve: boolean; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  return (
    <Dialog title={approve ? "Approve the tour plan" : "Send the tour plan back"} sub={`${data.person.name} · ${monthWords(data.month)}`} onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <Label text={approve ? "A word (optional)" : "What to change *"} error={action.at("note")}>
          <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} />
        </Label>
        <Problem message={action.general(["note"])} />
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api("/api/mr/plan/decide", { body: { person: data.person.id, month: data.month, approve, note: note || null } });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
            })
          }
        >
          {approve ? "Approve" : "Send back"}
        </Button>
      </div>
    </Dialog>
  );
}

function DeviationList({ rows, decide }: { rows: DeviationRow[]; decide?: boolean }) {
  const queries = useQueryClient();
  const action = useAction();
  const [notes, setNotes] = useState<Record<number, string>>({});
  return (
    <section className={`${CARD} p-4`}>
      <h2 className="mb-2 text-sm font-bold">Tour plan deviations</h2>
      <ul className="flex flex-col gap-2 text-[13px]">
        {rows.map((one) => (
          <li key={one.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <b>{DEVIATION_WORDS[one.kind]}{one.client ? ` · ${one.client}` : ""}</b>
              <span className={one.status === "waiting" ? "text-amber-700" : one.status === "approved" ? "text-emerald-700" : "text-rose-700"}>{one.status}</span>
            </div>
            <div className="text-slate-600">
              {one.person.name} · {dayWords(one.day)}
              {one.fromDay && one.toDay ? ` · ${dayWords(one.fromDay)} → ${dayWords(one.toDay)}` : ""}
            </div>
            <div>{one.note}</div>
            {one.decisionNote && <div className="text-slate-500">{one.decidedBy}: {one.decisionNote}</div>}
            {decide && one.status === "waiting" && (
              <div className="mt-2 flex gap-2">
                <Button small variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/deviations/${one.id}`, { body: { approve: true } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Approve</Button>
                <input className={`${FIELD} h-8 flex-1`} placeholder="Why not? (to reject)" value={notes[one.id] ?? ""} onChange={(event) => setNotes((all) => ({ ...all, [one.id]: event.target.value }))} />
                <Button
                  small
                  disabled={action.busy || !(notes[one.id] ?? "").trim()}
                  onClick={() => action.run(async () => { await api(`/api/mr/deviations/${one.id}`, { body: { approve: false, note: notes[one.id] } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}
                >
                  Reject
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Problem message={action.problem?.message} />
    </section>
  );
}

function Deviations() {
  const query = useQuery({ queryKey: ["mr", "deviations"], queryFn: () => api<{ rows: DeviationRow[] }>("/api/mr/deviations?status=all") });
  const mr = useMrMe();
  if (!query.data) return <PageState query={query} what="the deviations" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title="Deviation approval" back="/mr" sub={`${query.data.rows.filter((one) => one.status === "waiting").length} waiting`} />
      <DeviationList rows={query.data.rows} decide={mr.data?.access === "lead"} />
      {query.data.rows.length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>No deviations.</div>}
    </div>
  );
}

/** The lead's Approve Tour Plan: each MR's month (status, whole month planned, missing days). */
function TeamPlans() {
  const members = useQuery({ queryKey: ["mr", "members"], queryFn: () => api<{ members: { personId: number; name: string; active: boolean; role: string }[] }>("/api/mr/members") });
  const [month, setMonth] = useState(manilaToday().slice(0, 7));
  if (!members.data) return <PageState query={members} what="the team" />;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <MrHead title="Approve tour plan" back="/mr" sub={monthWords(month)} actions={
        <>
          <Button small variant="quiet" aria-label="Month before" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></Button>
          <Button small variant="quiet" aria-label="Month after" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></Button>
        </>
      } />
      <ul className="flex flex-col gap-2">
        {members.data.members.filter((one) => one.active && one.role === "mr").map((one) => (
          <TeamPlanRow key={one.personId} personId={one.personId} name={one.name} month={month} />
        ))}
      </ul>
    </div>
  );
}

function TeamPlanRow({ personId, name, month }: { personId: number; name: string; month: string }) {
  const query = useQuery({ queryKey: ["mr", "plan", String(personId), month], queryFn: () => api<PlanMonth>(`/api/mr/plan?person=${personId}&month=${month}`) });
  const data = query.data;
  const missing = data ? data.days.filter((one) => one.work && !one.leave && !one.plan && one.planned === 0) : [];
  return (
    <li>
      <Link to={`/mr/plan?person=${personId}&month=${month}`} className={`${CARD} flex flex-wrap items-center justify-between gap-2 p-4 hover:border-sky-300`}>
        <span className="min-w-0">
          <b>{name}</b>
          <span className="block text-xs text-slate-500">
            Whole month tour plan: {data ? (missing.length ? "No" : "Yes") : "…"}
            {missing.length ? ` · missing ${missing.map((one) => Number(one.day.slice(8))).join(", ")}` : ""}
          </span>
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${data?.plan.status === "approved" ? "bg-emerald-600" : data?.plan.status === "sent" ? "bg-amber-500" : data?.plan.status === "sent_back" ? "bg-rose-600" : "bg-slate-400"}`}>
          {data?.plan.status ? PLAN_WORDS[data.plan.status] : "Not submitted"}
        </span>
      </Link>
    </li>
  );
}
