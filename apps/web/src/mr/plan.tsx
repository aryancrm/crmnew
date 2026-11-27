// SEFMED's Tour Plan Calendar (docs/PLAN.md 22): the month with marks (tour plan, pending leave,
// cancelled / rejected leave, approved leave, holiday, back-dated visit), a list view; a tap on a
// day opens that day's one sheet (where: the kind of day and the town from the country's list;
// whom: the day's visits and Add visits); three lines over the calendar say how it goes and how
// many working days are filled; the month is sent to the team lead, who approves or sends it
// back; revisions and deviations are kept. On the
// CRM's own visits and customers; the lead's pages follow the company tree (the team switch).

import type { ClientKind, ClientList, DeviationRow, MrHome, PlanMonth, PlanStatus, VisitList, WorkType } from "@2mg/api/mr";
import { DEVIATION_WORDS, PLAN_WORDS, WORK_HINTS, WORK_TYPES, WORK_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, List, Plus, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { manilaToday } from "../team/range";
import { useHqNames } from "../team/hq-name";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { Button, CARD, Dialog, PageState, Problem, useAction } from "../ui";
import { Ask, Choices, dayWords, FIELD, Label, MrHead, monthWords, shiftMonth, StatePill, useMrMe } from "./parts";
import { TownPicker } from "./towns";
import { EmptyState, NoInvoicesArt } from "../no-results";

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
  const action = useAction();
  // Whose plan, after their HQ (Aryan's phase 5, PLAN 269).
  const { named } = useHqNames();
  const query = useQuery({
    queryKey: ["mr", "plan", person, month],
    queryFn: () => api<PlanMonth>(`/api/mr/plan?${new URLSearchParams({ ...(person ? { person } : {}), ...(month ? { month } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const [list, setList] = useState(false);
  // The picked day is kept by its date, so its sheet shows the plan as it stands after each change.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
  const picked = data.days.find((one) => one.day === pickedDay) ?? null;
  const ahead = data.days.filter((one) => one.work && one.leave !== "approved" && one.day >= data.today);
  const filled = ahead.length - missing.filter((one) => one.leave !== "approved").length;
  return (
    <div className={`mx-auto flex max-w-3xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead
        title="Tour plan calendar"
        back="/field"
        sub={`${mine ? "" : `${named(data.person.id, data.person.name)} · `}${status ? `${PLAN_WORDS[status]}${data.plan.revision ? ` · revision ${data.plan.revision}` : ""}` : "Not made yet"}`}
        actions={
          <span className="flex items-center gap-1">
            {/* The same plan seen by customer: how many visits each one's class asks for, and "Make my plan". */}
            <Link
              to={`/visits/plan?${new URLSearchParams({ ...(person ? { person } : {}), month: data.month.slice(0, 7) })}`}
              className="rounded-lg px-2 py-1 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              By customer
            </Link>
            <Button small variant="quiet" onClick={() => setList(!list)}><List size={15} /> {list ? "Calendar view" : "List view"}</Button>
          </span>
        }
      />
      {mine && data.can.edit && status !== "approved" && (
        <ol className={`${CARD} flex flex-col gap-1 px-4 py-3 text-[13px] text-slate-700`}>
          <li><b className="text-slate-900">1.</b> Tap a day.</li>
          <li><b className="text-slate-900">2.</b> Say which town you work in that day and add whom you will visit.</li>
          <li>
            <b className="text-slate-900">3.</b> When every working day is filled, send the month to your team lead.{" "}
            <span className={`font-semibold ${filled === ahead.length ? "text-emerald-700" : "text-amber-700"}`}>
              {filled} of {ahead.length} working days filled.
            </span>
          </li>
        </ol>
      )}
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
                <button type="button" onClick={() => setPickedDay(one.day)} className="flex w-full justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
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
                onClick={() => setPickedDay(one.day)}
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
          Days still empty: {missing.map((one) => Number(one.day.slice(8))).join(", ")}. Tap one to fill it.
        </div>
      )}
      <Problem message={action.problem?.message} />
      {data.can.send && (
        <Button variant="primary" className="w-full" disabled={action.busy} onClick={send}>
          <Send size={15} /> Send the month to my team lead
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

      {picked && !adding && (
        <DaySheet data={data} day={picked} person={person} onAdd={() => setAdding(true)} onClose={() => setPickedDay(null)} />
      )}
      {picked && adding && (
        <AddVisitsDialog day={picked.day} cities={picked.plan?.cities} approved={status === "approved"} fixedDay onClose={() => setAdding(false)} />
      )}
      {deciding && <DecideDialog data={data} approve={deciding === "approve"} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function Dot({ tone }: { tone: string }) {
  return <span className={`inline-block size-1.5 rounded-full ${tone}`} />;
}

/** One day of the tour plan in one sheet (Aryan, 23 Nov): 1 where (the kind of day and the town,
 *  picked from the country's list), 2 whom (the day's visits, Add visits), then the day's page. */
function DaySheet({ data, day: one, person, onAdd, onClose }: { data: PlanMonth; day: PlanMonth["days"][number]; person: string | null; onAdd: () => void; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const day = one.day;
  const known = one.plan;
  const may = data.can.edit && day >= data.today;
  const [changing, setChanging] = useState(!known);
  const [workType, setWorkType] = useState<WorkType | null>(known?.workType ?? null);
  const [cities, setCities] = useState<string[]>(known?.cities ?? []);
  const [why, setWhy] = useState("");
  // Whom one may work with: their team lead, team-mates and those under them (the company tree).
  const home = useQuery({ queryKey: ["mr", "home"], queryFn: () => api<MrHome>("/api/mr/home"), enabled: may });
  const [withWhom, setWithWhom] = useState<number[]>(known?.workingWith.map((w) => w.id) ?? []);
  const others = home.data?.partners ?? [];
  const visitsOf = (kind: ClientKind) => ({
    queryKey: ["mr", "visits", kind, null, day, person],
    queryFn: () => api<VisitList>(`/api/mr/visits?${new URLSearchParams({ kind, day, ...(person ? { person } : {}) })}`),
  });
  const doctors = useQuery(visitsOf("doctor"));
  const hospitals = useQuery(visitsOf("hospital"));
  const firms = useQuery(visitsOf("firm"));
  const visits = [doctors, hospitals, firms].flatMap((q) => q.data?.rows ?? []);
  const ready = workType !== null && (workType === "transit" || cities.length > 0);
  const save = () =>
    action.run(async () => {
      await api("/api/mr/plan/day", { body: { day, workType, cities, workingWith: withWhom, why: why || null } });
      await queries.invalidateQueries({ queryKey: ["mr"] });
      setChanging(false);
    });
  const note = one.holiday ?? (one.leave ? `Leave (${one.leave})` : !one.work ? "Not a working day" : null);
  return (
    <Dialog title={dayWords(day)} sub={note ?? undefined} onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-5">
        <Ask n={1} text="Where do you work that day?" done={Boolean(known) && !changing}>
          {known && !changing ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
              <span>
                <b>{known.cities.join(", ") || WORK_WORDS[known.workType]}</b>
                <span className="block text-xs text-slate-500">
                  {WORK_HINTS[known.workType]}
                  {known.workingWith.length ? ` · with ${known.workingWith.map((w) => w.name).join(", ")}` : ""}
                </span>
              </span>
              {may && <Button small onClick={() => setChanging(true)}>Change</Button>}
            </div>
          ) : may ? (
            <div className="flex flex-col gap-3">
              <Choices options={WORK_TYPES.map((key) => ({ key, label: WORK_HINTS[key] }))} value={workType ? [workType] : []} onChange={(next) => setWorkType(next[0] ?? null)} />
              {workType !== null && workType !== "transit" && (
                <Label text="Which town or city? *" error={action.at("cities")}>
                  <TownPicker value={cities} onChange={setCities} suggested={data.cities} />
                </Label>
              )}
              {ready && others.length > 0 && (
                <Label text="Working with (skip if alone)">
                  <Choices options={others.map((w) => ({ key: String(w.id), label: w.name }))} value={withWhom.map(String)} onChange={(next) => setWithWhom(next.map(Number))} many />
                </Label>
              )}
              {data.plan.status === "approved" && (
                <Label text="Why the change? (the plan is approved) *" error={action.at("why")}>
                  <input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} />
                </Label>
              )}
              <Problem message={action.general(["cities", "why"])} />
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" disabled={action.busy || !ready} onClick={save}>{action.busy ? "Saving…" : "Save the day's place"}</Button>
                {known && <Button onClick={() => setChanging(false)}>Cancel</Button>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No place was planned for this day.</p>
          )}
        </Ask>

        <Ask n={2} text={`Whom will you visit? (${visits.length})`} done={visits.length > 0}>
          <ul className="flex flex-col gap-2">
            {visits.map((v) => (
              <li key={v.id}>
                <Link to={`/visits/${v.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-sky-300">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{v.client.name}</span>
                    <span className="block truncate text-xs text-slate-500">{[v.client.detail ?? v.client.specialty, v.client.city].filter(Boolean).join(", ")}</span>
                  </span>
                  <StatePill visit={v} />
                </Link>
              </li>
            ))}
            {visits.length === 0 && (
              <li>
                <EmptyState art={<NoInvoicesArt size={72} />} title="No visits on this day yet.">
                  The customers planned for this day show here.
                </EmptyState>
              </li>
            )}
          </ul>
          {may && (
            <Button variant={known && !changing && visits.length === 0 ? "primary" : "plain"} onClick={onAdd}>
              <Plus size={15} /> Add visits
            </Button>
          )}
          {visits.length > 0 && (
            <p className="text-xs text-slate-500">
              Tap a visit to move it to another day or skip it.{" "}
              <Link to={`/visits?day=${day}${person ? `&person=${person}` : ""}`} className="font-semibold text-sky-700">Open the day's visits</Link>
            </p>
          )}
        </Ask>
      </div>
    </Dialog>
  );
}

const KIND_ASK: Record<ClientKind, string> = { doctor: "Doctors (KOLs)", hospital: "Hospitals", firm: "Drugstores, distributors (KBLs)" };
const WHYS = ["They called me", "I was nearby", "Urgent order", "My team lead asked", "Follow-up due"];

/** Add a visit, asked in order (Aryan, 23 Nov): when, whom (search by name; the town only narrows
 *  the list), and why when the day has started or the month's plan is approved. From My day it is
 *  today's, and the visit opens straight after (`thenOpen`); from the tour plan the day is fixed. */
export function AddVisitsDialog({
  day: asked,
  kind: firstKind,
  cities: dayCities,
  preset,
  approved,
  today: forToday,
  fixedDay,
  thenOpen,
  onClose,
}: {
  day: string;
  /** The list to open on; left out, the kind this person has most of (a hospital rep's hospitals). */
  kind?: ClientKind;
  cities?: string[];
  preset?: number[];
  approved?: boolean;
  /** Today's visit, from My day: the day isn't asked. */
  today?: boolean;
  /** The tour plan's day: the day isn't asked. */
  fixedDay?: boolean;
  thenOpen?: boolean;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const today = manilaToday();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [day, setDay] = useState(asked < today ? today : asked);
  const [otherDay, setOtherDay] = useState(day !== today && day !== tomorrow);
  const [kindPicked, setKind] = useState<ClientKind | null>(firstKind ?? null);
  const [cities, setCities] = useState<string[]>(dayCities ?? []);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>(preset ?? []);
  const [why, setWhy] = useState("");
  const home = useQuery({ queryKey: ["mr", "home"], queryFn: () => api<MrHome>("/api/mr/home") });
  const t = home.data?.tiles;
  const kind: ClientKind = kindPicked ?? (t && t.hospitals > t.doctors && t.hospitals >= t.firms ? "hospital" : t && t.firms > t.doctors ? "firm" : "doctor");
  const list = useQuery({
    queryKey: ["mr", "pick", kind, cities.join("|"), q],
    queryFn: () => api<ClientList["rows"]>(`/api/mr/clients/pick?${new URLSearchParams({ kind, cities: cities.join("|"), ...(q ? { q } : {}) })}`),
    placeholderData: (previous) => previous,
  });
  const allCities = useQuery({ queryKey: ["mr", "cities"], queryFn: () => api<{ cities: string[] }>("/api/mr/cities"), staleTime: 5 * 60_000 });
  const presetOnly = Boolean(preset?.length);
  const dayAsked = !forToday && !fixedDay;
  // Why is asked once today's work has started, or once the month's plan is approved (the API says so too).
  const needWhy = Boolean(approved) || (day === today && Boolean(home.data?.day)) || Boolean(action.at("why"));
  const towns = [...new Set([...(dayCities ?? []), ...(allCities.data?.cities ?? [])])];
  const n = { whom: dayAsked ? 2 : 1, why: (dayAsked ? 2 : 1) + (presetOnly ? 0 : 1) };
  return (
    <Dialog
      title={forToday ? "Whom are you going to see?" : "Add a visit"}
      sub={dayAsked ? undefined : forToday ? "Added to today's visits" : `For ${dayWords(day)}`}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-5">
        {dayAsked && (
          <Ask n={1} text="When?" done>
            <Choices
              options={[{ key: "today", label: "Today" }, { key: "tomorrow", label: "Tomorrow" }, { key: "other", label: "Another day" }]}
              value={[otherDay ? "other" : day === today ? "today" : "tomorrow"]}
              onChange={(next) => {
                setOtherDay(next[0] === "other");
                if (next[0] === "today") setDay(today);
                if (next[0] === "tomorrow") setDay(tomorrow);
              }}
            />
            {otherDay && <input type="date" aria-label="The day" className={FIELD} min={today} value={day} onChange={(event) => event.target.value && setDay(event.target.value)} />}
            <Problem message={action.at("day")} />
          </Ask>
        )}
        {!presetOnly && (
          <Ask n={n.whom} text="Whom will you visit?" done={picked.length > 0}>
            <Choices options={(["doctor", "hospital", "firm"] as ClientKind[]).map((key) => ({ key, label: KIND_ASK[key] }))} value={[kind]} onChange={(next) => setKind(next[0] ?? "doctor")} />
            <input className={FIELD} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by name or code" aria-label="Search by name or code" />
            {towns.length > 1 && (
              <div className="flex max-h-20 flex-wrap items-center gap-1.5 overflow-y-auto text-xs">
                <span className="font-semibold text-slate-500">Only in:</span>
                <button type="button" onClick={() => setCities([])} className={`rounded-full border px-2.5 py-1 font-semibold ${cities.length === 0 ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 text-slate-700"}`}>
                  Any town
                </button>
                {towns.map((one) => (
                  <button key={one} type="button" onClick={() => setCities((all) => (all.includes(one) ? all.filter((c) => c !== one) : [...all, one]))} className={`rounded-full border px-2.5 py-1 font-semibold ${cities.includes(one) ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 text-slate-700"}`}>
                    {one}
                  </button>
                ))}
              </div>
            )}
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {(list.data ?? []).map((one) => (
                <li key={one.id}>
                  <label className="flex items-center gap-3 px-3 py-2.5 text-sm has-[:checked]:bg-sky-50">
                    <input type="checkbox" className="size-4" checked={picked.includes(one.id)} onChange={(event) => setPicked((all) => (event.target.checked ? [...all, one.id] : all.filter((id) => id !== one.id)))} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{one.name}</span>
                      <span className="block truncate text-xs text-slate-500">{[one.code, one.specialty ?? one.detail, one.city, one.assignedTo?.name].filter(Boolean).join(" · ")}</span>
                    </span>
                  </label>
                </li>
              ))}
              {list.data?.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-slate-500">
                  {q ? `No one of yours named "${q}" here.` : cities.length ? `None of yours in ${cities.join(", ")}.` : "None of yours here yet."}{" "}
                  {cities.length > 0 && <button type="button" className="font-semibold text-sky-700" onClick={() => setCities([])}>Look in any town</button>}
                </li>
              )}
            </ul>
            <Problem message={action.at("customerIds")} />
          </Ask>
        )}
        {needWhy && (
          <Ask n={n.why} text="Why isn't it in the plan?" done={why.trim() !== ""}>
            <Choices options={WHYS.map((one) => ({ key: one, label: one }))} value={WHYS.includes(why) ? [why] : []} onChange={(next) => setWhy(next[0] ?? "")} />
            <input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} placeholder="Or say it in your words" aria-label="Why isn't it in the plan" />
            <Problem message={action.at("why")} />
          </Ask>
        )}
        <Problem message={action.general(["day", "why", "customerIds"])} />
        <Button
          variant="primary"
          disabled={action.busy || picked.length === 0}
          onClick={() =>
            action.run(async () => {
              const made = await api<{ ids: number[] }>("/api/mr/visits", { body: { day, customerIds: picked, why: why || null } });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
              // From My day: the one just picked opens, so the next question (the call's objective, I'm here) follows.
              if (thenOpen && made.ids.length === 1) navigate(`/visits/${made.ids[0]}`);
            })
          }
        >
          {picked.length === 0 ? "Pick whom to visit" : `Add ${picked.length} visit${picked.length === 1 ? "" : "s"} · ${day === today ? "today" : dayWords(day)}`}
        </Button>
      </div>
    </Dialog>
  );
}

function DecideDialog({ data, approve, onClose }: { data: PlanMonth; approve: boolean; onClose: () => void }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const [note, setNote] = useState("");
  const { named } = useHqNames();
  return (
    <Dialog title={approve ? "Approve the tour plan" : "Send the tour plan back"} sub={`${named(data.person.id, data.person.name)} · ${monthWords(data.month)}`} onClose={onClose} busy={action.busy}>
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
              // Back to the team's plans: the next one waiting is there.
              navigate("/field/plan?view=team");
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
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["mr", "deviations", unit],
    queryFn: () => api<{ rows: DeviationRow[] }>(withUnit("/api/mr/deviations?status=all", unit)),
  });
  const mr = useMrMe();
  // The person's team lead decides; Management and the Admin stand in; the CEO reads.
  const role = useMe().data?.role;
  if (!query.data) return <PageState query={query} what="the deviations" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title="Tour plan changes (deviations)" sub={`${query.data.rows.filter((one) => one.status === "waiting").length} waiting`} />
      {mr.data?.access !== "mr" && <TeamSwitch />}
      <DeviationList rows={query.data.rows} decide={mr.data?.access === "lead" || role === "admin" || role === "management"} />
      {query.data.rows.length === 0 && (
        <div className={CARD}>
          <EmptyState title="No deviations.">Changes to the tour plan show here for the team lead to decide.</EmptyState>
        </div>
      )}
    </div>
  );
}

type TeamPlans = {
  month: string;
  people: { id: number; name: string; status: PlanStatus | null; revision: number; decidedBy: string | null; missing: string[] }[];
};

/** The lead's Approve Tour Plan: each MedRep's month under them (status, whole month planned,
 *  the working days still missing); the team switch narrows it to a box. */
function TeamPlans() {
  const unit = useTeamUnit();
  // Each MedRep after their HQ (Aryan's phase 5, PLAN 269).
  const { named } = useHqNames();
  const [month, setMonth] = useState(manilaToday().slice(0, 7));
  const query = useQuery({
    queryKey: ["mr", "plan", "team", month, unit],
    queryFn: () => api<TeamPlans>(withUnit(`/api/mr/plan/team?month=${month}`, unit)),
    placeholderData: (previous) => previous,
  });
  if (!query.data) return <PageState query={query} what="the team" />;
  return (
    <div className={`mx-auto flex max-w-4xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead title="Approve tour plan" sub={monthWords(month)} actions={
        <>
          <Button small variant="quiet" aria-label="Month before" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></Button>
          <Button small variant="quiet" aria-label="Month after" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></Button>
        </>
      } />
      <TeamSwitch />
      <ul className="flex flex-col gap-2">
        {query.data.people.map((one) => (
          <li key={one.id}>
            <Link to={`/field/plan?person=${one.id}&month=${month}`} className={`${CARD} flex flex-wrap items-center justify-between gap-2 p-4 hover:border-sky-300`}>
              <span className="min-w-0">
                <b>{named(one.id, one.name)}</b>
                <span className="block text-xs text-slate-500">
                  Whole month tour plan: {one.missing.length ? "No" : "Yes"}
                  {one.missing.length ? ` · missing ${one.missing.map((day) => Number(day.slice(8))).join(", ")}` : ""}
                  {one.decidedBy ? ` · by ${one.decidedBy}` : ""}
                </span>
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${one.status === "approved" ? "bg-emerald-600" : one.status === "sent" ? "bg-amber-500" : one.status === "sent_back" ? "bg-rose-600" : "bg-slate-400"}`}>
                {one.status ? `${PLAN_WORDS[one.status]}${one.revision > 1 ? ` · rev ${one.revision}` : ""}` : "Not submitted"}
              </span>
            </Link>
          </li>
        ))}
        {query.data.people.length === 0 && (
          <li className={CARD}>
            <EmptyState title="No MedReps under you.">Each MedRep's tour plan for the month shows here to approve.</EmptyState>
          </li>
        )}
      </ul>
    </div>
  );
}
