// The field (SEFMED's daily work, inside the MedRep's desk): a day's visits to doctors, hospitals
// and drugstores. The MedRep plans a visit, checks in on the spot (the phone's place kept),
// reports the call (medicines detailed and how the doctor took them, notes, the next visit) or
// skips it with a reason. A team lead and the CEO open a person's day to look, not to work.

import type { FieldDay, FieldForm, SkipReason, VisitReaction, VisitRow } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, MapPin, Plus, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { clock } from "../hr/parts";
import { FIELD } from "../org/dialogs";
import { Button, CARD, Dialog, PageHead, PageState, Problem, Tabs, useAction } from "../ui";

export const REACTION_WORDS: Record<VisitReaction, string> = {
  will_prescribe: "Will prescribe",
  prescribes: "Already prescribes",
  needs_info: "Wants more information",
  not_interested: "Not interested",
};
const REACTION_TONE: Record<VisitReaction, string> = {
  will_prescribe: "bg-emerald-50 text-emerald-800",
  prescribes: "bg-sky-50 text-sky-800",
  needs_info: "bg-amber-50 text-amber-800",
  not_interested: "bg-slate-100 text-slate-600",
};
const SKIP_WORDS: Record<SkipReason, string> = {
  not_available: "Doctor not available",
  busy: "Doctor busy",
  clinic_closed: "Clinic closed",
  out_of_town: "Out of town",
  rescheduled: "Moved to another day",
  other: "Other",
};
/** Farther than this from the clinic's pin is "away from the clinic" (as the API counts it). */
const NEAR_METRES = 300;
const distanceWords = (metres: number) =>
  metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`;
const KIND_WORDS: Record<string, string> = {
  doctor: "Doctor",
  hospital: "Hospital",
  drugstore: "Drugstore",
};

const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** The phone's place as "lat,lng", or null when it isn't shared within eight seconds. */
function whereAmI(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (at) => resolve(`${at.coords.latitude.toFixed(5)},${at.coords.longitude.toFixed(5)}`),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

function Label({ text, error, children }: { text: string; error?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control comes in as the children.
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{text}</span>
      {children}
      {error && <span className="text-xs font-medium text-rose-700">{error}</span>}
    </label>
  );
}

type View = "planned" | "done" | "skipped";

export function VisitsPage() {
  const me = useMe().data;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const person = params.get("person");
  const asked = params.get("day");
  const query = useQuery({
    queryKey: ["field", "day", person, asked],
    queryFn: () =>
      api<FieldDay>(
        `/api/field/day?${new URLSearchParams({ ...(person ? { person } : {}), ...(asked ? { day: asked } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const [view, setView] = useState<View>("planned");
  const [planning, setPlanning] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the visits" />;
  const mine = data.can.work;
  // A team lead (Management, the Admin) may move a wrong pin; the CEO only looks.
  const leadView =
    !mine && Boolean(me && ["team_lead", "manager", "management", "admin"].includes(me.role));
  const go = (next: string) => {
    const out = new URLSearchParams(params);
    if (next === data.today) out.delete("day");
    else out.set("day", next);
    setParams(out, { replace: true });
  };
  const shown = data.visits.filter((one) => one.status === view);

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      {!mine && (
        <nav
          aria-label="Where you are"
          className="flex items-center gap-1.5 text-xs text-slate-500"
        >
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/field/report"))}
            aria-label="Back"
            className="mr-1 grid size-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:text-emerald-700"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <Link to="/field/report" className="hover:text-slate-800">
            Visits report
          </Link>
          <span aria-hidden="true" className="text-slate-300">
            ›
          </span>
          <span className="font-medium text-slate-700">{data.person.name}</span>
        </nav>
      )}
      <PageHead
        title={mine ? "My visits" : `${data.person.name}'s visits`}
        sub={`${dayWords(data.day)}${data.day === data.today ? " · today" : ""}${data.person.area ? ` · ${data.person.area}` : ""}`}
        actions={
          <div className="flex items-center gap-1">
            {mine && (
              <Button variant="primary" small className="mr-2" onClick={() => setPlanning(true)}>
                <CalendarPlus size={15} /> Plan a visit
              </Button>
            )}
            <Button
              small
              variant="quiet"
              aria-label="The day before"
              onClick={() => go(shift(data.day, -1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <input
              type="date"
              value={data.day}
              onChange={(event) => event.target.value && go(event.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
            />
            <Button
              small
              variant="quiet"
              aria-label="The day after"
              onClick={() => go(shift(data.day, 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      >
        <Tabs<View>
          value={view}
          onChange={setView}
          tabs={[
            { key: "planned", label: "To visit", count: data.counts.planned },
            { key: "done", label: "Done", count: data.counts.done },
            { key: "skipped", label: "Skipped", count: data.counts.skipped },
          ]}
        />
      </PageHead>

      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((visit) => (
          <VisitCard
            key={visit.id}
            visit={visit}
            mine={mine}
            today={data.today}
            canPin={leadView}
          />
        ))}
      </div>
      {shown.length === 0 && (
        <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>
          {view === "planned"
            ? mine
              ? "Nothing planned this day. Plan a visit to a doctor, hospital or drugstore you look after."
              : "Nothing planned this day."
            : view === "done"
              ? "No visits done this day."
              : "Nothing skipped this day."}
        </div>
      )}
      {planning && (
        <PlanDialog
          day={data.day >= data.today ? data.day : data.today}
          onClose={() => setPlanning(false)}
        />
      )}
    </div>
  );
}

function VisitCard({
  visit,
  mine,
  today,
  canPin,
}: {
  visit: VisitRow;
  mine: boolean;
  today: string;
  canPin: boolean;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [open, setOpen] = useState<"report" | "skip" | "move" | null>(null);
  const planned = visit.status === "planned";
  const checkIn = () =>
    action.run(async () => {
      const place = await whereAmI();
      await api(`/api/field/visits/${visit.id}/check-in`, { body: { place } });
      await queries.invalidateQueries({ queryKey: ["field"] });
    });
  const c = visit.customer;
  return (
    <article className={`${CARD} flex flex-col gap-3 p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/customers/${c.id}`}
            className="font-semibold text-slate-900 hover:text-emerald-700"
          >
            {c.name}
          </Link>
          <div className="text-xs text-slate-500">
            {[
              c.visitClass ? `Class ${c.visitClass}` : null,
              KIND_WORDS[c.kind] ?? c.kind,
              c.specialty,
              c.city,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${
            visit.status === "done"
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : visit.status === "skipped"
                ? "bg-slate-100 text-slate-600 ring-slate-200"
                : visit.checkedInAt
                  ? "bg-sky-50 text-sky-800 ring-sky-200"
                  : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {visit.status === "done"
            ? "Done"
            : visit.status === "skipped"
              ? "Skipped"
              : visit.checkedInAt
                ? `At the doctor since ${clock(visit.checkedInAt)}`
                : "To visit"}
        </span>
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[13px]">
        {visit.objective && (
          <>
            <dt className="text-slate-500">Call objective</dt>
            <dd className="text-slate-800">{visit.objective}</dd>
          </>
        )}
        <dt className="text-slate-500">Last visit</dt>
        <dd className="text-slate-800">
          {visit.lastVisit ? dayWords(visit.lastVisit) : "First visit"}
        </dd>
        {visit.checkedInAt && (
          <>
            <dt className="text-slate-500">Checked in</dt>
            <dd className="text-slate-800">
              {clock(visit.checkedInAt)}
              {visit.checkInPlace ? (
                <a
                  href={`https://www.google.com/maps?q=${visit.checkInPlace}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-emerald-700 hover:underline"
                >
                  <MapPin size={12} /> Where
                </a>
              ) : (
                <span className="ml-2 text-slate-400">no location shared</span>
              )}
              {visit.distanceM !== null &&
                (visit.distanceM > NEAR_METRES ? (
                  <span className="ml-2 rounded bg-rose-50 px-1 text-[11px] font-semibold text-rose-700">
                    Away from the clinic · {distanceWords(visit.distanceM)}
                  </span>
                ) : (
                  <span className="ml-2 rounded bg-emerald-50 px-1 text-[11px] font-semibold text-emerald-700">
                    At the clinic
                  </span>
                ))}
              {!c.pinned && visit.checkInPlace && (
                <span className="ml-2 text-[11px] text-slate-400">clinic not pinned yet</span>
              )}
            </dd>
          </>
        )}
        {visit.skipReason && (
          <>
            <dt className="text-slate-500">Why skipped</dt>
            <dd className="text-slate-800">{visit.skipReason}</dd>
          </>
        )}
        {visit.notes && (
          <>
            <dt className="text-slate-500">Notes</dt>
            <dd className="text-slate-800">{visit.notes}</dd>
          </>
        )}
        {visit.nextDay && (
          <>
            <dt className="text-slate-500">Next visit</dt>
            <dd className="text-slate-800">{dayWords(visit.nextDay)}</dd>
          </>
        )}
      </dl>
      {visit.detailed.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {visit.detailed.map((line) => (
            <li
              key={line.medicineId}
              className={`rounded-lg px-2 py-1 text-xs ${REACTION_TONE[line.reaction]}`}
            >
              <span className="font-semibold">{line.name}</span> · {REACTION_WORDS[line.reaction]}
            </li>
          ))}
        </ul>
      )}
      <Problem message={action.problem?.message} />
      {visit.checkInPlace &&
        ((mine && !c.pinned) || (!mine && canPin && (visit.distanceM ?? 0) > NEAR_METRES)) && (
          <div>
            <Button
              small
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  await api(`/api/field/visits/${visit.id}/pin`, { body: {} });
                  await queries.invalidateQueries({ queryKey: ["field"] });
                })
              }
            >
              <MapPin size={14} /> {c.pinned ? "Move the clinic's pin here" : "Pin the clinic here"}
            </Button>
          </div>
        )}
      {mine && planned && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {visit.day === today && !visit.checkedInAt && (
            <Button small variant="primary" disabled={action.busy} onClick={checkIn}>
              <MapPin size={14} /> {action.busy ? "Checking in…" : "Check in"}
            </Button>
          )}
          {visit.checkedInAt && (
            <Button small variant="primary" onClick={() => setOpen("report")}>
              <Check size={14} /> Report the call
            </Button>
          )}
          {!visit.checkedInAt && (
            <Button small onClick={() => setOpen("move")}>
              Move
            </Button>
          )}
          <Button small variant="quiet" onClick={() => setOpen("skip")}>
            Skip
          </Button>
        </div>
      )}
      {open === "report" && <ReportDialog visit={visit} onClose={() => setOpen(null)} />}
      {open === "skip" && <SkipDialog visit={visit} onClose={() => setOpen(null)} />}
      {open === "move" && <MoveDialog visit={visit} today={today} onClose={() => setOpen(null)} />}
    </article>
  );
}

function useFieldForm(q = "") {
  return useQuery({
    queryKey: ["field", "form", q],
    queryFn: () => api<FieldForm>(`/api/field/form${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
}

function PlanDialog({ day, onClose }: { day: string; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [q, setQ] = useState("");
  const form = useFieldForm(q.trim());
  const [picked, setPicked] = useState<FieldForm["customers"][number] | null>(null);
  const [on, setOn] = useState(day);
  const [objective, setObjective] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api("/api/field/visits", {
        body: { customerId: picked?.id ?? 0, day: on, objective: objective || null },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["field"] });
      onClose();
    }
  }
  return (
    <Dialog title="Plan a visit" onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Label text="Whom you visit *" error={action.at("customerId")}>
          {picked ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-3 py-2">
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{picked.name}</span>
                <span className="block text-xs text-slate-500">
                  {[KIND_WORDS[picked.kind], picked.specialty, picked.city]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Button small variant="quiet" onClick={() => setPicked(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                className={FIELD}
                placeholder="Find a doctor, hospital or drugstore"
              />
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {(form.data?.customers ?? []).map((one) => (
                  <li key={one.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(one)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">
                          {one.name}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {[KIND_WORDS[one.kind], one.specialty, one.city]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {one.lastVisit ? `Last ${dayWords(one.lastVisit)}` : "Never visited"}
                      </span>
                    </button>
                  </li>
                ))}
                {form.data && form.data.customers.length === 0 && (
                  <li className="px-3 py-3 text-sm text-slate-500">Nobody found in your area.</li>
                )}
              </ul>
            </>
          )}
        </Label>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Label text="Day *" error={action.at("day")}>
            <input
              type="date"
              value={on}
              onChange={(event) => setOn(event.target.value)}
              className={FIELD}
            />
          </Label>
          <Label text="Call objective" error={action.at("objective")}>
            <input
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              className={FIELD}
              placeholder="Introduce the new pack"
            />
          </Label>
        </div>
        <Problem message={action.general(["customerId", "day", "objective"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy || !picked}>
            {action.busy ? "Planning…" : "Plan visit"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReportDialog({ visit, onClose }: { visit: VisitRow; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const form = useFieldForm();
  const [objective, setObjective] = useState(visit.objective ?? "");
  const [lines, setLines] = useState<
    { key: number; medicineId: string; reaction: VisitReaction }[]
  >([{ key: 1, medicineId: "", reaction: "will_prescribe" }]);
  const [notes, setNotes] = useState("");
  const [nextDay, setNextDay] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const detailed = lines
      .filter((line) => line.medicineId)
      .map((line) => ({ medicineId: Number(line.medicineId), reaction: line.reaction }));
    const done = await action.run(() =>
      api(`/api/field/visits/${visit.id}/report`, {
        body: {
          objective: objective || null,
          detailed,
          notes: notes || null,
          nextDay: nextDay || null,
        },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["field"] });
      onClose();
    }
  }
  const set = (index: number, next: Partial<(typeof lines)[number]>) =>
    setLines((now) => now.map((line, at) => (at === index ? { ...line, ...next } : line)));
  return (
    <Dialog
      title={`Call report · ${visit.customer.name}`}
      onClose={onClose}
      busy={action.busy}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Label text="Call objective" error={action.at("objective")}>
          <input
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            className={FIELD}
          />
        </Label>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-slate-600">Medicines detailed</span>
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid items-center gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[minmax(0,1fr)_13rem_auto]"
            >
              <select
                value={line.medicineId}
                onChange={(event) => set(index, { medicineId: event.target.value })}
                className={FIELD}
                aria-label="Medicine"
              >
                <option value="">Pick a medicine</option>
                {(form.data?.medicines ?? []).map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                    {one.strength ? ` ${one.strength}` : ""}
                  </option>
                ))}
              </select>
              <select
                value={line.reaction}
                onChange={(event) => set(index, { reaction: event.target.value as VisitReaction })}
                className={FIELD}
                aria-label="How the doctor took it"
              >
                {(Object.keys(REACTION_WORDS) as VisitReaction[]).map((key) => (
                  <option key={key} value={key}>
                    {REACTION_WORDS[key]}
                  </option>
                ))}
              </select>
              {lines.length > 1 && (
                <Button
                  small
                  variant="quiet"
                  aria-label="Take this line off"
                  onClick={() => setLines((now) => now.filter((_, at) => at !== index))}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          ))}
          <div>
            <Button
              small
              variant="quiet"
              onClick={() =>
                setLines((now) => [
                  ...now,
                  {
                    key: Math.max(0, ...now.map((one) => one.key)) + 1,
                    medicineId: "",
                    reaction: "will_prescribe",
                  },
                ])
              }
            >
              <Plus size={14} /> Another medicine
            </Button>
          </div>
          {action.at("detailed") && (
            <span className="text-xs font-medium text-rose-700">{action.at("detailed")}</span>
          )}
        </div>
        <Label text="Notes" error={action.at("notes")}>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={`${FIELD} min-h-20`}
            placeholder="What was said, what they asked for"
          />
        </Label>
        <Label text="Next visit" error={action.at("nextDay")}>
          <input
            type="date"
            value={nextDay}
            min={shift(visit.day, 1)}
            onChange={(event) => setNextDay(event.target.value)}
            className={`${FIELD} w-48`}
          />
        </Label>
        <Problem message={action.general(["objective", "detailed", "notes", "nextDay"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Save the call"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SkipDialog({ visit, onClose }: { visit: VisitRow; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [reason, setReason] = useState<SkipReason>("not_available");
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/field/visits/${visit.id}/skip`, { body: { reason, note: note || null } }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["field"] });
      onClose();
    }
  }
  return (
    <Dialog title={`Skip · ${visit.customer.name}`} onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Label text="Why it didn't happen *" error={action.at("reason")}>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as SkipReason)}
            className={FIELD}
          >
            {(Object.keys(SKIP_WORDS) as SkipReason[]).map((key) => (
              <option key={key} value={key}>
                {SKIP_WORDS[key]}
              </option>
            ))}
          </select>
        </Label>
        <Label text={reason === "other" ? "Say why *" : "Note"} error={action.at("note")}>
          <input value={note} onChange={(event) => setNote(event.target.value)} className={FIELD} />
        </Label>
        <Problem message={action.general(["reason", "note"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Skip visit"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MoveDialog({
  visit,
  today,
  onClose,
}: {
  visit: VisitRow;
  today: string;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [day, setDay] = useState(visit.day < today ? today : visit.day);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/field/visits/${visit.id}/move`, { body: { day } }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["field"] });
      onClose();
    }
  }
  return (
    <Dialog title={`Move · ${visit.customer.name}`} onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Label text="New day" error={action.at("day")}>
          <input
            type="date"
            value={day}
            min={today}
            onChange={(event) => setDay(event.target.value)}
            className={`${FIELD} w-48`}
          />
        </Label>
        <Problem message={action.general(["day"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Moving…" : "Move visit"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
