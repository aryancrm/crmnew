// My day in the field (SEFMED's Home, docs/PLAN.md 22): the big circle (Start working → "Since 8:10
// AM · Head quarter · Angeles City · Stop working"; starting also starts the CRM's attendance day),
// today's numbers, the next visit and the tiles. For a MedRep, and a team lead or head on their own
// calls; the CEO, Management and the Admin, who only look, go to the team's page.

import type { MrHome, WorkType } from "@2mg/api/mr";
import { WORK_TYPES, WORK_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Coffee,
  ListChecks,
  MapPin,
  PartyPopper,
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
import { Choices, clockOf, FIELD, Label, StatePill, useMrMe, whereAmI } from "./parts";

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
  const [placing, setPlacing] = useState<"start" | "edit" | null>(null);
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
        <Circle data={data} onStart={() => setPlacing("start")} onEdit={() => setPlacing("edit")} />
      </div>

      {day && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Figure label="Planned" value={c.planned} />
          <Figure label="Closed" value={c.done} tone="text-emerald-700" />
          <Figure label="Left" value={left} tone={left ? "text-amber-700" : undefined} />
          <Figure label="Ordered" value={c.bookedAmount ? peso(c.bookedAmount) : "—"} />
        </div>
      )}

      {data.next && (
        <Link to={`/visits/${data.next.id}`} className={`${CARD} flex items-center justify-between gap-3 p-4 hover:border-sky-300`}>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-500 uppercase">Next visit</div>
            <div className="truncate font-semibold text-slate-900">{data.next.client.name}</div>
            <div className="truncate text-xs text-slate-500">
              {[data.next.client.specialty ?? data.next.client.detail, data.next.client.city].filter(Boolean).join(" · ")}
            </div>
          </div>
          <StatePill visit={data.next} />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile to="/visits" icon={MapPin} label="Visits" tone="bg-indigo-50 text-indigo-700" sub={`${c.planned} today`} />
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
      </div>

      {placing && (
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
                {WORK_WORDS[day.workType]}
                {day.cities.length ? `-${day.cities.join(", ")}` : ""}
              </span>
              <span className="text-base font-bold text-rose-600">Stop working</span>
            </>
          )}
        </span>
      </button>
      <Problem message={action.problem?.message} />
    </div>
  );
}

/** Start working, or "Edit work location or Stop working for the day". */
function PlaceDialog({ home, mode, onClose }: { home: MrHome; mode: "start" | "edit"; onClose: () => void }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const day = home.day;
  const [workType, setWorkType] = useState<WorkType>(day?.workType ?? home.plannedWork ?? "hq");
  const [note, setNote] = useState(day?.workNote ?? "");
  const [cities, setCities] = useState<string[]>(day?.cities.length ? day.cities : home.plannedCities);
  const [typed, setTyped] = useState("");
  const [partners, setPartners] = useState<number[]>([]);
  const [stopping, setStopping] = useState(false);
  const options = [...new Set([...cities, ...home.plannedCities, ...home.cities])];
  const submit = (path: "/api/mr/day/start" | "/api/mr/day/place") =>
    action.run(async () => {
      const at = await whereAmI();
      await api(path, {
        body: {
          workType,
          workNote: workType === "other" ? note : null,
          cities: typed.trim() ? [...cities, typed.trim()] : cities,
          workingWith: partners,
          place: at.place,
          accuracy: at.accuracy,
        },
      });
      await queries.invalidateQueries({ queryKey: ["mr"] });
      // Starting the field day starts the CRM's attendance day too (the Start button up top).
      await queries.invalidateQueries({ queryKey: ["my-day"] });
      onClose();
    });
  return (
    <Dialog
      title={mode === "start" ? "Start working" : "Edit work location or stop working for the day"}
      sub={home.plannedCities.length ? `Your work city for the day is ${home.plannedCities.join(", ")}` : undefined}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1.5">
          {WORK_TYPES.map((one) => (
            <label key={one} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50">
              <input type="radio" name="work" checked={workType === one} onChange={() => setWorkType(one)} />
              <span className="font-medium text-slate-800">{one === "hq" && mode === "edit" ? "Return to HQ (Head quarter)" : WORK_WORDS[one]}</span>
            </label>
          ))}
        </fieldset>
        {workType === "other" && (
          <Label text="Where *" error={action.at("workNote")}>
            <input className={FIELD} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Bacoor, Dasmariñas, Trece Martires" />
          </Label>
        )}
        {workType !== "transit" && (
          <Label text="The day's city *" error={action.at("cities")}>
            <Choices options={options.map((one) => ({ key: one, label: one }))} value={cities} onChange={setCities} many />
            <input className={`${FIELD} mt-1.5`} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Another city" />
          </Label>
        )}
        {mode === "start" && home.partners.length > 0 && (
          <Label text="Working with (optional)">
            <Choices
              options={home.partners.map((one) => ({ key: String(one.id), label: one.name }))}
              value={partners.map(String)}
              onChange={(next) => setPartners(next.map(Number))}
              many
            />
          </Label>
        )}
        <Problem message={action.general(["workNote", "cities"])} />
        <p className="text-xs text-slate-500">Your phone's place and the time are kept when you press the button.</p>
        {mode === "start" ? (
          <Button variant="primary" disabled={action.busy} onClick={() => submit("/api/mr/day/start")}>
            {action.busy ? "Starting…" : "Start working"}
          </Button>
        ) : stopping ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            The day report opens next: give the reason for any visit not done, add your remarks, and send it. That ends
            today's work.
            <div className="mt-3 flex justify-end gap-2">
              <Button small onClick={() => setStopping(false)}>Cancel</Button>
              <Button small variant="primary" onClick={() => { onClose(); navigate("/field/day-report"); }}>OK</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={action.busy} onClick={() => submit("/api/mr/day/place")}>Update</Button>
            <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => setStopping(true)}>Stop</Button>
          </div>
        )}
        {mode === "edit" && !stopping && (
          <BreakButton onDone={onClose} />
        )}
      </div>
    </Dialog>
  );
}

function BreakButton({ onDone }: { onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <div>
      <Button
        small
        variant="quiet"
        disabled={action.busy}
        onClick={() =>
          action.run(async () => {
            const { place } = await whereAmI();
            await api("/api/mr/day/break", { body: { on: true, place } });
            await queries.invalidateQueries({ queryKey: ["mr"] });
            onDone();
          })
        }
      >
        <Coffee size={14} /> Take a break
      </Button>
      <Problem message={action.problem?.message} />
    </div>
  );
}

