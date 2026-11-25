// HR's holidays: the national ones (the company's calendar, what desks' clocks stop on) and the
// local ones of a province or one town (the 2026 proclamations, and any HR adds). A person's local
// holidays follow their work town (their record, else their seat's area's first city): attendance
// and payroll count them. HR and the Admin add and archive (never deleted); the CEO reads.

import type { HolidayRow, HolidayYear } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useTowns } from "../mr/towns";
import { FIELD } from "../org/dialogs";
import { Button, CARD, Dialog, PageHead, PageState, Pill, Problem, useAction } from "../ui";
import { type WorkTown, WorkTownPicker } from "./work-town";

const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const monthWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });

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

const where = (one: HolidayRow) =>
  one.scope === "national" ? "Nationwide" : one.town ? `${one.town}, ${one.province}` : `All of ${one.province}`;

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Date(Date.UTC(2026, index, 1)).toLocaleDateString("en-PH", { month: "short", timeZone: "UTC" }),
);
const two = (value: number) => String(value).padStart(2, "0");
/** Today in Manila, as yyyy-mm-dd. */
const todayDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const longDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

/** A holiday as a small bar in its day: a regular one solid green, a special day light blue, a local one violet. */
function chipTone(one: HolidayRow) {
  if (one.scope === "local") return "bg-violet-50 text-violet-800 ring-violet-200";
  return one.kind === "regular" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-sky-50 text-sky-900 ring-sky-200";
}

/** The month as a wall calendar, Sunday first; a press on a day shows its holidays below. */
function MonthGrid({
  year,
  month,
  byDay,
  picked,
  onPick,
}: {
  year: number;
  month: number;
  byDay: Map<string, HolidayRow[]>;
  picked: string;
  onPick: (day: string) => void;
}) {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = todayDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, index) => `${year}-${two(month)}-${two(index + 1)}`),
  ];
  while (cells.length % 7) cells.push(null);
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">
        {WEEK.map((name, index) => (
          <div
            key={name}
            className={`px-2 py-2 text-center text-xs font-semibold sm:text-left ${index === 0 || index === 6 ? "text-slate-400" : "text-slate-600"}`}
          >
            {name}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, index) => {
          const column = index % 7;
          const edge = `${column ? "border-l" : ""} ${index >= 7 ? "border-t" : ""} border-slate-100`;
          if (!day) return <div key={`blank-${index}`} className={`min-h-16 bg-slate-50/60 sm:min-h-28 ${edge}`} />;
          const list = byDay.get(day) ?? [];
          const national = list.filter((one) => one.scope === "national");
          const local = list.filter((one) => one.scope === "local");
          const regular = national.some((one) => one.kind === "regular");
          const weekend = column === 0 || column === 6;
          const isPicked = day === picked;
          const isToday = day === today;
          const named = local.length <= 2 ? [...national, ...local] : national;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              aria-pressed={isPicked}
              aria-label={`${longDay(day)}${list.length ? `: ${list.map((one) => one.name).join(", ")}` : ""}`}
              className={`relative flex min-h-16 min-w-0 flex-col items-stretch gap-1 p-1.5 text-left transition-colors sm:min-h-28 sm:p-2 ${edge} ${
                regular ? "bg-emerald-50/70" : weekend ? "bg-slate-50/60" : "bg-white"
              } hover:bg-emerald-50 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 ${
                isPicked ? "z-[1] shadow-[inset_0_0_0_2px_var(--color-emerald-600)]" : ""
              }`}
            >
              <span
                className={`grid size-6 place-items-center rounded-full text-xs tabular-nums ${
                  isToday ? "bg-emerald-600 font-bold text-white" : weekend ? "text-slate-400" : "font-medium text-slate-700"
                }`}
              >
                {Number(day.slice(8))}
              </span>
              <span className="hidden min-w-0 flex-col gap-1 sm:flex">
                {named.slice(0, 3).map((one) => (
                  <span
                    key={`${one.scope}-${one.id}`}
                    className={`truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight font-semibold ring-1 ${chipTone(one)}`}
                    title={`${one.name} · ${where(one)}`}
                  >
                    {one.name}
                  </span>
                ))}
                {named.length > 3 && (
                  <span className="px-1 text-[11px] font-medium text-slate-500">+{named.length - 3} more</span>
                )}
                {local.length > 2 && (
                  <span className="truncate rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] leading-tight font-semibold text-violet-800 ring-1 ring-violet-200">
                    {local.length} local
                  </span>
                )}
              </span>
              {list.length > 0 && (
                <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                  {national.map((one) => (
                    <span
                      key={`${one.scope}-${one.id}`}
                      className={`size-1.5 rounded-full ${one.kind === "regular" ? "bg-emerald-600" : "bg-sky-500"}`}
                    />
                  ))}
                  {local.length > 0 && <span className="size-1.5 rounded-full bg-violet-500" />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HrHolidaysPage() {
  const [params, setParams] = useSearchParams();
  const year = Number(params.get("year")) || new Date().getFullYear();
  const province = params.get("province") ?? "";
  const town = params.get("town") ?? "";
  const towns = useTowns();
  const provinces = useMemo(
    () => [...new Set((towns.data ?? []).map((one) => one[1]))].sort((a, b) => a.localeCompare(b)),
    [towns.data],
  );
  const townsOf = useMemo(
    () => (towns.data ?? []).filter((one) => one[1] === province).map((one) => one[0]),
    [towns.data, province],
  );
  const query = useQuery({
    queryKey: ["hr", "holidays", year, province, town],
    queryFn: () =>
      api<HolidayYear>(
        `/api/hr/holidays?${new URLSearchParams({ year: String(year), province, town }).toString()}`,
      ),
    placeholderData: (previous) => previous,
  });
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<HolidayRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const view = params.get("view") === "list" ? "list" : "calendar";
  const today = todayDay();
  const month =
    Number(params.get("month")) || (Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) : 1);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const set = (next: Record<string, string>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next))
      if (value) out.set(key, value);
      else out.delete(key);
    setParams(out, { replace: true });
  };
  const data = query.data;
  if (!data) return <PageState query={query} what="the holidays" />;
  const inForce = data.holidays.filter((one) => !one.archived);
  const archived = data.holidays.filter((one) => one.archived);
  const months = new Map<string, HolidayRow[]>();
  for (const one of inForce) months.set(one.day.slice(0, 7), [...(months.get(one.day.slice(0, 7)) ?? []), one]);
  const byDay = new Map<string, HolidayRow[]>();
  for (const one of inForce) byDay.set(one.day, [...(byDay.get(one.day) ?? []), one]);
  const monthKey = `${year}-${two(month)}`;
  const inMonth = months.get(monthKey) ?? [];
  const picked = pickedDay?.startsWith(monthKey)
    ? pickedDay
    : today.startsWith(monthKey)
      ? today
      : (inMonth[0]?.day ?? `${monthKey}-01`);
  const pickedList = byDay.get(picked) ?? [];
  const goMonth = (step: number) => {
    const at = new Date(Date.UTC(year, month - 1 + step, 1));
    setPickedDay(null);
    set({ year: String(at.getUTCFullYear()), month: String(at.getUTCMonth() + 1) });
  };

  const row = (one: HolidayRow) => (
    <li key={`${one.scope}-${one.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span className="w-24 shrink-0 text-slate-600 tabular-nums">{dayWords(one.day)}</span>
        <div className="min-w-0">
          <div className={one.archived ? "text-slate-500 line-through" : "font-medium text-slate-900"}>{one.name}</div>
          <div className="text-xs text-slate-500">
            {where(one)}
            {one.proclamation ? ` · ${one.proclamation}` : ""}
            {one.madeBy ? ` · added by ${one.madeBy}` : ""}
            {one.archived
              ? ` · archived by ${one.archived.by ?? "—"}${one.archived.note ? `: ${one.archived.note}` : ""}`
              : ""}
          </div>
        </div>
      </div>
      <span className="flex items-center gap-2">
        <Pill tone={one.kind === "regular" ? "brand" : "info"}>{one.kind === "regular" ? "Regular holiday" : "Special day"}</Pill>
        {one.scope === "local" && <Pill tone="violet">Local</Pill>}
        {data.can.change && !one.archived && (
          <Button small onClick={() => setArchiving(one)}>
            Archive
          </Button>
        )}
      </span>
    </li>
  );

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title={`Holidays · ${data.year}`}
        sub="National holidays for everyone; local ones for the people of that province or town (their work town, else their seat's area's first city). Attendance and payroll count each person's own."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Show as">
              {(
                [
                  ["calendar", "Calendar", CalendarDays],
                  ["list", "List", List],
                ] as const
              ).map(([key, words, Icon]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => set({ view: key === "list" ? "list" : "" })}
                  className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                    view === key ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon size={14} /> {words}
                </button>
              ))}
            </div>
            {data.can.change && (
              <Button small variant="primary" onClick={() => setAdding(true)}>
                <Plus size={14} /> Add a holiday
              </Button>
            )}
          </div>
        }
      />
      <section className={`${CARD} flex flex-wrap items-end gap-3 p-4`}>
        <Label text="Province">
          <select value={province} onChange={(event) => set({ province: event.target.value, town: "" })} className={FIELD}>
            <option value="">Every province</option>
            {provinces.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Town or city">
          <select value={town} onChange={(event) => set({ town: event.target.value })} className={FIELD} disabled={!province}>
            <option value="">{province ? "The whole province" : "Pick a province first"}</option>
            {townsOf.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </Label>
        <p className="text-xs text-slate-500">
          {inForce.length} in force
          {data.town ? `: the national ones and ${data.town}'s` : data.province ? `: the national ones and ${data.province}'s` : ""}
        </p>
      </section>
      {view === "calendar" ? (
        <>
          <section className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-1">
                <Button small variant="quiet" aria-label="The month before" onClick={() => goMonth(-1)}>
                  <ChevronLeft size={16} />
                </Button>
                <h2 className="min-w-40 text-center text-lg font-bold tracking-tight text-slate-900 tabular-nums">
                  {monthWords(`${monthKey}-01`)} {year}
                </h2>
                <Button small variant="quiet" aria-label="The month after" onClick={() => goMonth(1)}>
                  <ChevronRight size={16} />
                </Button>
                {!today.startsWith(monthKey) && (
                  <Button
                    small
                    onClick={() => {
                      setPickedDay(today);
                      set({ year: today.slice(0, 4), month: String(Number(today.slice(5, 7))) });
                    }}
                  >
                    Today
                  </Button>
                )}
              </div>
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="What the colours mean">
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-emerald-600" /> Regular holiday
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-sky-100 ring-1 ring-sky-300" /> Special day
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-violet-100 ring-1 ring-violet-300" /> Local
                </li>
              </ul>
            </div>
            <div
              className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2 [scrollbar-width:none]"
              role="group"
              aria-label="Months"
            >
              {MONTHS.map((name, index) => {
                const count = months.get(`${year}-${two(index + 1)}`)?.length ?? 0;
                const on = index + 1 === month;
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setPickedDay(null);
                      set({ month: String(index + 1) });
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      on ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {name}
                    {count > 0 && <span className={`tabular-nums ${on ? "text-slate-300" : "text-slate-400"}`}>{count}</span>}
                  </button>
                );
              })}
            </div>
            <MonthGrid year={year} month={month} byDay={byDay} picked={picked} onPick={setPickedDay} />
          </section>
          <section className={`${CARD} overflow-hidden`} aria-live="polite">
            <h2 className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <span className="text-base font-semibold text-slate-900">{longDay(picked)}</span>
              <span className="text-xs text-slate-500">
                {pickedList.length === 0
                  ? "No holiday"
                  : `${pickedList.length} holiday${pickedList.length === 1 ? "" : "s"}`}
              </span>
            </h2>
            {pickedList.length > 0 ? (
              <ul className="divide-y divide-slate-100">{pickedList.map(row)}</ul>
            ) : (
              <p className="px-4 py-5 text-sm text-slate-500">
                A working day{data.town ? ` in ${data.town}` : data.province ? ` in ${data.province}` : ""}. Press a day with a
                coloured mark to see its holidays.
              </p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <Button small variant="quiet" aria-label="The year before" onClick={() => set({ year: String(year - 1), month: "" })}>
              <ChevronLeft size={16} />
            </Button>
            <span className="text-sm font-semibold text-slate-900 tabular-nums">{year}</span>
            <Button small variant="quiet" aria-label="The year after" onClick={() => set({ year: String(year + 1), month: "" })}>
              <ChevronRight size={16} />
            </Button>
          </div>
        {[...months].map(([key, list]) => (
          <section key={key} className={`${CARD} overflow-hidden`}>
            <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-900">
              {monthWords(`${key}-01`)} ({list.length})
            </h2>
            <ul className="divide-y divide-slate-100">{list.map(row)}</ul>
          </section>
        ))}
        </>
      )}
      {inForce.length === 0 && (
        <p className={`${CARD} px-4 py-6 text-center text-sm text-slate-500`}>No holidays this year yet.</p>
      )}
      {archived.length > 0 && (
        <section className={`${CARD} overflow-hidden`}>
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            {showArchived ? "Hide" : "Show"} {archived.length} archived
          </button>
          {showArchived && <ul className="divide-y divide-slate-100 bg-slate-50/60">{archived.map(row)}</ul>}
        </section>
      )}
      {adding && <AddHoliday year={year} onClose={() => setAdding(false)} />}
      {archiving && <ArchiveHoliday holiday={archiving} onClose={() => setArchiving(null)} />}
    </div>
  );
}

function AddHoliday({ year, onClose }: { year: number; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const towns = useTowns();
  const provinces = useMemo(
    () => [...new Set((towns.data ?? []).map((one) => one[1]))].sort((a, b) => a.localeCompare(b)),
    [towns.data],
  );
  const [day, setDay] = useState(`${year}-`);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"regular" | "special">("special");
  const [scope, setScope] = useState<"national" | "province" | "town">("town");
  const [province, setProvince] = useState("");
  const [town, setTown] = useState<WorkTown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api("/api/hr/holidays", {
        body: {
          day,
          name,
          kind,
          province: scope === "national" ? null : scope === "town" ? (town?.province ?? null) : province || null,
          town: scope === "town" ? (town?.town ?? null) : null,
        },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["hr", "holidays"] });
      onClose();
    }
  }
  return (
    <Dialog title="Add a holiday" onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Day *" error={action.at("day")}>
            <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={FIELD} />
          </Label>
          <Label text="Kind *" error={action.at("kind")}>
            <select value={kind} onChange={(event) => setKind(event.target.value as "regular" | "special")} className={FIELD}>
              <option value="special">Special (non-working) day</option>
              <option value="regular">Regular holiday</option>
            </select>
          </Label>
        </div>
        <Label text="Name *" error={action.at("name")}>
          <input value={name} onChange={(event) => setName(event.target.value)} className={FIELD} maxLength={160} placeholder="Founding anniversary" />
        </Label>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-semibold text-slate-600">For whom *</legend>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["town", "One town or city"],
                ["province", "A whole province"],
                ["national", "Nationwide"],
              ] as const
            ).map(([value, words]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`h-8 rounded-lg border px-3 text-xs font-semibold ${scope === value ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {words}
              </button>
            ))}
          </div>
        </fieldset>
        {scope === "town" && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Town or city *</span>
            <WorkTownPicker value={town} onChange={setTown} />
            {(action.at("town") || action.at("province")) && (
              <span className="text-xs font-medium text-rose-700">{action.at("town") ?? action.at("province")}</span>
            )}
          </div>
        )}
        {scope === "province" && (
          <Label text="Province *" error={action.at("province")}>
            <select value={province} onChange={(event) => setProvince(event.target.value)} className={FIELD}>
              <option value="">Pick the province</option>
              {provinces.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          </Label>
        )}
        {scope === "national" && (
          <p className="text-xs text-amber-800">
            A national holiday stops everyone's day and every desk's clock.
          </p>
        )}
        <Problem message={action.general(["day", "name", "kind", "province", "town"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              action.busy ||
              !name.trim() ||
              (scope === "town" && !town) ||
              (scope === "province" && !province)
            }
          >
            {action.busy ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ArchiveHoliday({ holiday, onClose }: { holiday: HolidayRow; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  return (
    <Dialog title={`Archive ${holiday.name}?`} sub={`${dayWords(holiday.day)} · ${where(holiday)}`} onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>It stops counting from now on and stays on the list as archived. Released payslips stay as they were.</p>
        <Label text="Why (optional)">
          <input value={note} onChange={(event) => setNote(event.target.value)} className={FIELD} maxLength={300} />
        </Label>
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={action.busy}
            onClick={async () => {
              const done = await action.run(() =>
                api(`/api/hr/holidays/${holiday.scope}/${holiday.id}/archive`, { body: { note: note.trim() || null } }),
              );
              if (done) {
                await queries.invalidateQueries({ queryKey: ["hr", "holidays"] });
                onClose();
              }
            }}
          >
            {action.busy ? "Archiving…" : "Archive"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
