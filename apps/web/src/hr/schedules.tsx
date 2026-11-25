// HR's work schedules: the company's default (Office hours) and the shifts HR gives some people
// (on a person's page, Job › Change schedule). Late, undertime and rest days count on each
// person's own schedule. HR and the Admin add one and archive one nobody is on (never deleted);
// the CEO reads.

import type { HrSchedules } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../api";
import { FIELD } from "../org/dialogs";
import { Button, CARD, PageHead, PageState, Problem, useAction } from "../ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The days a schedule works, in a few words: "Mon–Sat", "Mon, Wed, Fri". */
export function weekdaysWords(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const run = sorted.every((day, at) => at === 0 || day === (sorted[at - 1] as number) + 1);
  if (sorted.length > 2 && run)
    return `${WEEKDAYS[sorted[0] as number]}–${WEEKDAYS[sorted[sorted.length - 1] as number]}`;
  return sorted.map((day) => WEEKDAYS[day]).join(", ");
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

export function HrSchedulesPage() {
  const queries = useQueryClient();
  const query = useQuery({
    queryKey: ["hr", "schedules"],
    queryFn: () => api<HrSchedules>("/api/hr/schedules"),
  });
  const add = useAction();
  const archive = useAction();
  const [name, setName] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("16:00");
  const [breakMinutes, setBreakMinutes] = useState("60");
  const [grace, setGrace] = useState("0");
  const [showArchived, setShowArchived] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the schedules" />;
  const kept = data.schedules.filter((one) => !one.archived);
  const archived = data.schedules.filter((one) => one.archived);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await add.run(() =>
      api("/api/hr/schedules", {
        body: {
          name,
          days,
          start,
          end,
          breakMinutes: Number(breakMinutes) || 0,
          graceMinutes: Number(grace) || 0,
        },
      }),
    );
    if (done) {
      setName("");
      await queries.invalidateQueries({ queryKey: ["hr", "schedules"] });
    }
  }
  async function archiveOne(id: number) {
    if (await archive.run(() => api(`/api/hr/schedules/${id}/archive`, { body: {} })))
      await queries.invalidateQueries({ queryKey: ["hr", "schedules"] });
  }
  const row = (one: HrSchedules["schedules"][number]) => (
    <li key={one.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <div className={one.archived ? "text-slate-500" : "font-medium text-slate-900"}>
          {one.name}
          {one.isDefault && (
            <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
              Company default
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 tabular-nums">
          {one.start}–{one.end} · {weekdaysWords(one.days)} · {one.breakMinutes} min break
          {one.graceMinutes ? ` · ${one.graceMinutes} min grace` : ""}
        </div>
      </div>
      <span className="flex items-center gap-3">
        <span className="text-xs text-slate-500 tabular-nums">
          {one.people === 0 ? "Nobody" : one.people === 1 ? "1 person" : `${one.people} people`}
        </span>
        {data.can.change && !one.archived && !one.isDefault && (
          <Button
            small
            disabled={archive.busy || one.people > 0}
            title={one.people > 0 ? "Give its people another schedule first" : undefined}
            onClick={() => archiveOne(one.id)}
          >
            Archive
          </Button>
        )}
      </span>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Schedules"
        sub="Working hours: the company's default, and shifts given to some people on their page (Job › Change schedule). Late and undertime count on each person's own."
      />
      {data.can.change && (
        <form onSubmit={submit} className={`${CARD} flex flex-col gap-3 p-4`}>
          <h2 className="text-sm font-semibold text-slate-900">Add a schedule</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="sm:col-span-2 lg:col-span-1">
              <Label text="Name *" error={add.at("name")}>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={FIELD}
                  placeholder="Late shift"
                  maxLength={80}
                />
              </Label>
            </div>
            <Label text="Starts *" error={add.at("start")}>
              <input type="time" value={start} onChange={(event) => setStart(event.target.value)} className={FIELD} />
            </Label>
            <Label text="Ends *" error={add.at("end")}>
              <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className={FIELD} />
            </Label>
            <Label text="Break (minutes)" error={add.at("breakMinutes")}>
              <input
                type="number"
                min={0}
                max={240}
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
                className={FIELD}
              />
            </Label>
            <Label text="Grace (minutes)" error={add.at("graceMinutes")}>
              <input
                type="number"
                min={0}
                max={120}
                value={grace}
                onChange={(event) => setGrace(event.target.value)}
                className={FIELD}
              />
            </Label>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-semibold text-slate-600">Working days *</legend>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const on = days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDays(on ? days.filter((one) => one !== day) : [...days, day])}
                    className={`h-8 min-w-12 rounded-lg border px-2 text-xs font-semibold ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    {WEEKDAYS[day]}
                  </button>
                );
              })}
            </div>
            {add.at("days") && <span className="text-xs font-medium text-rose-700">{add.at("days")}</span>}
          </fieldset>
          <Problem message={add.general(["name", "start", "end", "breakMinutes", "graceMinutes", "days"])} />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={add.busy || !name.trim()}>
              <Plus size={15} /> Add
            </Button>
          </div>
        </form>
      )}
      <Problem message={archive.problem?.message} />
      <section className={`${CARD} overflow-hidden`}>
        <div className="flex min-h-11 items-center justify-between border-b border-slate-100 px-4 py-2">
          <h2 className="text-sm font-semibold text-slate-900">In use ({kept.length})</h2>
        </div>
        <ul className="divide-y divide-slate-100">{kept.map(row)}</ul>
        {archived.length > 0 && (
          <div className="border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              {showArchived ? "Hide" : "Show"} {archived.length} archived
            </button>
            {showArchived && <ul className="divide-y divide-slate-100 bg-slate-50/60">{archived.map(row)}</ul>}
          </div>
        )}
      </section>
    </div>
  );
}
