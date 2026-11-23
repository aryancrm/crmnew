// My day in the field (SEFMED's Home, docs/PLAN.md 22), as one place that asks in order (Aryan,
// 23 Nov): 1 Start working (where do you work today, which town: picked from the country's list;
// starting also starts the CRM's attendance day), 2 "Where are you going now?" (today's visits,
// every kind together; someone not on the list is added right there), at the place I'm here and
// what happened, then the next one, 3 Stop working (the day report). The tiles stay under it. For
// a MedRep, and a team lead or head on their own calls; the CEO, Management and the Admin, who
// only look, go to the team's page.

import type { MrHome, VisitCard, WorkType } from "@2mg/api/mr";
import { KIND_ONE, MEETING_WORDS, WORK_HINTS, WORK_TYPES, WORK_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronRight,
  ClipboardList,
  Coffee,
  Gauge,
  ListChecks,
  MapPin,
  PartyPopper,
  Plus,
  Receipt,
  ShoppingCart,
  Stethoscope,
  Store,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Button, CARD, Dialog, PageState, Problem, peso, useAction } from "../ui";
import { ActionSheet, Ask, Choices, clockOf, FIELD, Initial, Label, StatePill, useMrMe, whereAmI } from "./parts";
import { AddVisitsDialog } from "./plan";
import { TownPicker } from "./towns";

export function MrHomePage() {
  const mr = useMrMe();
  if (!mr.data) return <PageState query={mr} what="your day" />;
  if (!mr.data.access) return <NotInField />;
  if (mr.data.access === "viewer") return <Navigate to="/field/team" replace />;
  return <MrDay />;
}

function NotInField() {
  return (
    <div className={`${CARD} mx-auto mt-10 max-w-md px-6 py-10 text-center`}>
      <h1 className="text-lg font-bold text-slate-900">The field</h1>
      <p className="mt-2 text-sm text-slate-600">The field's day is the MedReps' and their team leads'.</p>
    </div>
  );
}

/** One's own field day (a MedRep's; a team lead's or head's own calls too). */
export function MrDay() {
  const query = useQuery({ queryKey: ["mr", "home"], queryFn: () => api<MrHome>("/api/mr/home") });
  const mr = useMrMe();
  const [placing, setPlacing] = useState<"start" | "menu" | "edit" | null>(null);
  const navigate = useNavigate();
  const queries = useQueryClient();
  const pause = useAction();
  const takeBreak = () =>
    pause.run(async () => {
      const { place } = await whereAmI();
      await api("/api/mr/day/break", { body: { on: true, place } });
      await queries.invalidateQueries({ queryKey: ["mr"] });
    });
  const data = query.data;
  if (!data) return <PageState query={query} what="your day" />;
  const day = data.day;
  const c = data.counts;
  const left = c.open;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-sky-200 to-sky-50 px-4 pt-5 pb-8 text-center">
        <div className="flex items-center justify-between text-left">
          <div>
            <div className="text-lg font-bold text-sky-900">My day</div>
            <div className="text-xs text-sky-800/80">
              {data.person.name}
              {mr.data?.lead && mr.data.lead.id !== data.person.id ? ` · Team lead ${mr.data.lead.name}` : ""}
            </div>
          </div>
          <div className="text-right text-xs font-semibold text-sky-900">
            {new Date(`${data.today}T00:00:00Z`).toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
          </div>
        </div>
        <Circle data={data} onStart={() => setPlacing("start")} onEdit={() => setPlacing("menu")} />
      </div>

      <Steps data={data} />

      {!day && data.can.work && (
        <div className={`${CARD} px-4 py-3 text-sm text-slate-600`}>
          Tap <b className="text-slate-900">Start working</b>. It asks where you work today, then shows whom to visit, one
          after another.
          {data.visits.length > 0 && ` ${data.visits.length} visit${data.visits.length === 1 ? " is" : "s are"} planned for today.`}
        </div>
      )}

      {day && !day.endedAt && data.can.work && <Now data={data} />}

      {day && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Figure label="Planned" value={c.planned} />
          <Figure label="Closed" value={c.done} tone="text-emerald-700" />
          <Figure label="Left" value={left} tone={left ? "text-amber-700" : undefined} />
          <Figure label="Ordered" value={c.bookedAmount ? peso(c.bookedAmount) : "—"} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile to="/visits" icon={MapPin} label="Visits" tone="bg-indigo-50 text-indigo-700" sub={`${data.visits.length} today`} />
        <Tile to="/field/clients?kind=doctor" icon={Stethoscope} label="KOLs" tone="bg-pink-50 text-pink-700" sub={`${data.tiles.doctors} doctor${data.tiles.doctors === 1 ? "" : "s"}`} />
        <Tile to="/field/clients?kind=firm" icon={Store} label="KBLs" tone="bg-emerald-50 text-emerald-700" sub={`${data.tiles.firms} firm${data.tiles.firms === 1 ? "" : "s"}`} />
        <Tile to="/field/clients?kind=hospital" icon={Building2} label="Hospitals" tone="bg-slate-100 text-slate-700" sub={`${data.tiles.hospitals}`} />
        <Tile to="/field/plan" icon={CalendarRange} label="Tour plan" tone="bg-cyan-50 text-cyan-700" />
        <Tile to="/orders" icon={ShoppingCart} label="My orders" tone="bg-orange-50 text-orange-700" />
        <Tile to="/visits/expenses" icon={Receipt} label="Expenses" tone="bg-violet-50 text-violet-700" sub={data.tiles.claimed ? `${peso(data.tiles.claimed)} this month` : undefined} />
        <Tile to="/me/leave" icon={CalendarDays} label="Leaves" tone="bg-fuchsia-50 text-fuchsia-700" />
        <Tile to="/field/holidays" icon={PartyPopper} label="Holidays" tone="bg-teal-50 text-teal-700" />
        <Tile to="/field/follow-ups" icon={ListChecks} label="Follow-ups" tone="bg-amber-50 text-amber-700" sub={data.tiles.followUpsDue ? `${data.tiles.followUpsDue} due` : undefined} />
        <Tile to="/field/day-report" icon={ClipboardList} label="Day report" tone="bg-sky-50 text-sky-700" />
        <Tile to="/field/reports" icon={BarChart3} label="Reports" tone="bg-lime-50 text-lime-700" />
        <Tile to="/my/score" icon={Gauge} label="My KPIs" tone="bg-rose-50 text-rose-700" />
      </div>

      <Problem message={pause.problem?.message} />
      {placing === "menu" && day && (
        <ActionSheet
          title="Your day"
          sub={`Working since ${clockOf(day.startedAt)} · ${WORK_WORDS[day.workType]}${day.cities.length ? ` · ${day.cities.join(", ")}` : ""}`}
          onClose={() => setPlacing(null)}
          actions={[
            { label: "I'm working somewhere else now", hint: "change the town", onPick: () => setPlacing("edit") },
            { label: "Take a break", onPick: takeBreak },
            { label: "Stop working for today", hint: "the day report", danger: true, onPick: () => navigate("/field/day-report") },
          ]}
        />
      )}
      {(placing === "start" || placing === "edit") && (
        <PlaceDialog home={data} mode={placing} onClose={() => setPlacing(null)} />
      )}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={`${CARD} px-2 py-2.5`}>
      <div className={`text-lg leading-none font-bold ${tone ?? "text-slate-900"}`}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold text-slate-500">{label}</div>
    </div>
  );
}

function Tile({ to, icon: Icon, label, tone, sub }: { to: string; icon: typeof Users; label: string; tone: string; sub?: string }) {
  return (
    <Link to={to} className={`flex aspect-[5/4] flex-col items-center justify-center gap-2 rounded-3xl ${tone} p-3 text-center transition-transform hover:scale-[1.02]`}>
      <Icon size={30} strokeWidth={1.6} />
      <span className="text-sm font-bold tracking-wide uppercase">{label}</span>
      {sub && <span className="text-[11px] font-medium opacity-80">{sub}</span>}
    </Link>
  );
}

/** SEFMED's circle: Start working, or since when, where, and Stop working. */
function Circle({ data, onStart, onEdit }: { data: MrHome; onStart: () => void; onEdit: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const day = data.day;
  const ring = "mx-auto mt-4 grid size-52 place-items-center rounded-full border-[14px] border-sky-400/80 bg-white shadow-lg";
  if (!day)
    return (
      <button type="button" disabled={!data.can.work} onClick={onStart} className={`${ring} text-sky-800 hover:border-sky-500`}>
        <span className="flex flex-col items-center gap-1">
          <MapPin size={22} className="text-sky-500" />
          <span className="text-lg font-bold">Start working</span>
          <span className="text-xs text-slate-500">{data.can.work ? "Tap to begin your day" : "Only the MR starts their day"}</span>
        </span>
      </button>
    );
  if (day.endedAt)
    return (
      <Link to="/field/day-report" className={`${ring} text-slate-700`}>
        <span className="flex flex-col items-center gap-1 px-4">
          <span className="text-sm font-semibold">Day closed {clockOf(day.endedAt)}</span>
          <span className="text-xs text-slate-500">
            {day.report.status === "seen" ? `Report seen by ${day.report.seenBy}` : "Day report sent"}
          </span>
        </span>
      </Link>
    );
  const resume = () =>
    action.run(async () => {
      const { place } = await whereAmI();
      await api("/api/mr/day/break", { body: { on: false, place } });
      await queries.invalidateQueries({ queryKey: ["mr"] });
    });
  return (
    <div>
      <button type="button" onClick={day.onBreak ? resume : onEdit} className={`${ring} text-sky-900 hover:border-sky-500`}>
        <span className="flex flex-col items-center gap-1 px-5">
          {day.onBreak ? (
            <>
              <Coffee size={20} className="text-amber-500" />
              <span className="text-sm font-semibold">On a break since {clockOf(day.breakSince)}</span>
              <span className="text-base font-bold text-sky-700">Back to work</span>
            </>
          ) : (
            <>
              <span className="text-base font-semibold">Since {clockOf(day.startedAt)}</span>
              <span className="flex items-center gap-1 text-sm">
                <MapPin size={13} className="text-sky-500" />
                {day.cities.length ? day.cities.join(", ") : WORK_WORDS[day.workType]}
              </span>
              {day.cities.length > 0 && <span className="text-xs text-slate-500">{WORK_WORDS[day.workType]}</span>}
              <span className="text-xs font-semibold text-sky-700">Tap: change place, break, stop</span>
            </>
          )}
        </span>
      </button>
      <Problem message={action.problem?.message} />
    </div>
  );
}

/** Start working from the top bar's Start or from a call's I'm here: the same dialog, the same
 *  start (the field day and the CRM's attendance day together). Aryan, 20 Nov: one Start. */
export function StartWorkingDialog({ onClose }: { onClose: () => void }) {
  const query = useQuery({ queryKey: ["mr", "home"], queryFn: () => api<MrHome>("/api/mr/home") });
  if (!query.data) return null;
  return <PlaceDialog home={query.data} mode="start" onClose={onClose} />;
}

/** Start working (asked in order: where do you work today, which town, with whom), or a change of
 *  place during the day. Nothing is picked beforehand unless the tour plan said it. */
function PlaceDialog({ home, mode, onClose }: { home: MrHome; mode: "start" | "edit"; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const day = home.day;
  const [workType, setWorkType] = useState<WorkType | null>(day?.workType ?? home.plannedWork ?? null);
  const [note, setNote] = useState(day?.workNote ?? "");
  const [cities, setCities] = useState<string[]>(day?.cities.length ? day.cities : home.plannedCities);
  const [partners, setPartners] = useState<number[]>([]);
  const needsTown = workType !== null && workType !== "transit";
  const ready = workType !== null && (!needsTown || cities.length > 0) && (workType !== "other" || note.trim() !== "");
  const submit = () =>
    action.run(async () => {
      const at = await whereAmI();
      await api(mode === "start" ? "/api/mr/day/start" : "/api/mr/day/place", {
        body: { workType, workNote: workType === "other" ? note : null, cities, workingWith: partners, place: at.place, accuracy: at.accuracy },
      });
      await queries.invalidateQueries({ queryKey: ["mr"] });
      // Starting the field day starts the CRM's attendance day too (the Start button up top).
      await queries.invalidateQueries({ queryKey: ["my-day"] });
      onClose();
    });
  return (
    <Dialog
      title={mode === "start" ? "Start working" : "Where are you working now?"}
      sub={home.plannedCities.length && mode === "start" ? `Your tour plan says ${home.plannedCities.join(", ")} today` : undefined}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-5">
        <Ask n={1} text="Where do you work today?" done={workType !== null}>
          <fieldset className="flex flex-col gap-1.5">
            {WORK_TYPES.map((one) => (
              <label key={one} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50">
                <input type="radio" name="work" checked={workType === one} onChange={() => setWorkType(one)} />
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">{WORK_HINTS[one]}</span>
                  <span className="block text-xs text-slate-500">{WORK_WORDS[one]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Problem message={action.at("workType")} />
        </Ask>
        {workType === "other" && (
          <Label text="What is it? *" error={action.at("workNote")}>
            <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Office meeting, product training…" />
          </Label>
        )}
        {needsTown && (
          <Ask n={2} text="Which town or city?" done={cities.length > 0}>
            <TownPicker value={cities} onChange={setCities} suggested={[...home.plannedCities, ...home.cities]} />
            <Problem message={action.at("cities")} />
          </Ask>
        )}
        {mode === "start" && ready && home.partners.length > 0 && (
          <Ask n={needsTown ? 3 : 2} text="Is anyone working with you? (skip if alone)" done={partners.length > 0}>
            <Choices
              options={home.partners.map((one) => ({ key: String(one.id), label: one.name }))}
              value={partners.map(String)}
              onChange={(next) => setPartners(next.map(Number))}
              many
            />
          </Ask>
        )}
        <Problem message={action.general(["workType", "workNote", "cities"])} />
        <div>
          <Button variant="primary" className="w-full" disabled={action.busy || !ready} onClick={submit}>
            {mode === "start" ? (action.busy ? "Starting…" : "Start working") : action.busy ? "Saving…" : "Save"}
          </Button>
          <p className="mt-2 text-center text-xs text-slate-500">
            {ready ? "Your phone's place and the time are kept when you press the button." : "Answer the questions above first."}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/** Where the day stands: 1 Start working, 2 the visits, 3 the day report. */
function Steps({ data }: { data: MrHome }) {
  const day = data.day;
  const closed = data.visits.filter((one) => one.status !== "planned").length;
  const at = !day ? 1 : day.endedAt ? 4 : 2;
  const steps = [
    { n: 1, label: day ? "Started" : "Start" },
    { n: 2, label: data.visits.length ? `Visits ${closed}/${data.visits.length}` : "Visits" },
    { n: 3, label: "Report" },
  ];
  return (
    <ol className="grid grid-cols-3 gap-1.5">
      {steps.map((one) => {
        const done = one.n < at || (one.n === 3 && at === 4);
        const now = one.n === at;
        return (
          <li
            key={one.n}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold ${done ? "bg-emerald-50 text-emerald-800" : now ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-500"}`}
          >
            <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${done ? "bg-emerald-600 text-white" : now ? "bg-white text-sky-700" : "bg-slate-300 text-white"}`}>
              {done ? <Check size={12} /> : one.n}
            </span>
            <span className="truncate">{one.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const whoLine = (visit: VisitCard) =>
  [KIND_ONE[visit.client.kind], visit.client.specialty ?? visit.client.detail, visit.client.city].filter(Boolean).join(" · ");

/** Step 2, the day's middle: the call being worked, else "Where are you going now?" with today's
 *  visits to pick from (or someone not on the list), then what is done, then Stop working. */
function Now({ data }: { data: MrHome }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const day = data.day;
  const at = data.visits.find((one) => one.status === "planned" && one.checkedInAt);
  const open = data.visits.filter((one) => one.status === "planned" && !one.checkedInAt);
  const over = data.visits.filter((one) => one.status !== "planned");
  return (
    <section className="flex flex-col gap-3">
      {day?.onBreak ? (
        <div className={`${CARD} px-4 py-3 text-sm text-amber-900`}>You are on a break. Tap the circle to get back to work.</div>
      ) : at ? (
        <div className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-bold text-amber-800 uppercase">You are here since {clockOf(at.checkedInAt)}</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{at.client.name}</div>
          <div className="text-xs text-slate-600">{whoLine(at)}</div>
          <Button variant="primary" className="mt-3 w-full" onClick={() => navigate(`/visits/${at.id}`)}>
            Say what happened and close the call <ChevronRight size={16} />
          </Button>
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="bg-sky-600 px-4 py-3 text-white">
            <h2 className="text-base font-bold">{over.length ? "Where are you going next?" : "Where are you going now?"}</h2>
            <p className="text-xs text-sky-100">
              {open.length ? "Tap the one you are going to. At the place, press I'm here." : over.length ? "Today's list is done." : "Nothing is planned for today yet. Pick whom you are going to see."}
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {open.map((one) => (
              <li key={one.id}>
                <Link to={`/visits/${one.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sky-50">
                  <Initial name={one.client.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{one.client.name}</span>
                    <span className="block truncate text-xs text-slate-500">{whoLine(one)}</span>
                  </span>
                  {one.priority === 1 && <span className="rounded bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700">High</span>}
                  <ChevronRight size={18} className="shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-3 px-4 py-3 text-left font-semibold text-sky-700 hover:bg-sky-50">
                <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-dashed border-sky-300"><Plus size={18} /></span>
                {open.length ? "Someone not on this list" : over.length ? "One more visit" : "Pick whom to visit"}
              </button>
            </li>
          </ul>
        </div>
      )}

      {over.length > 0 && (
        <div className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold text-slate-900">Done today ({over.length})</h2>
          <ul className="flex flex-col gap-2">
            {over.map((one) => (
              <li key={one.id}>
                <Link to={`/visits/${one.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-sky-700">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">
                      {one.doneAt ? `${clockOf(one.doneAt)} · ` : ""}
                      {one.client.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {[one.meeting ? MEETING_WORDS[one.meeting] : null, one.booked ? `${peso(one.booked)} ordered` : null, one.skipReason].filter(Boolean).join(" · ") || whoLine(one)}
                    </span>
                  </span>
                  <StatePill visit={one} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!at && !day?.onBreak && (
        <Button variant={!open.length && over.length ? "primary" : "plain"} className="w-full" onClick={() => navigate("/field/day-report")}>
          <ClipboardList size={16} /> {!open.length && over.length ? "Stop working: send the day report" : "Stop working for today (day report)"}
        </Button>
      )}

      {adding && <AddVisitsDialog day={data.today} today thenOpen onClose={() => setAdding(false)} />}
    </section>
  );
}
