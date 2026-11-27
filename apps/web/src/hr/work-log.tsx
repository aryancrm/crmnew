// The work log (Aryan, 17 Nov): the office staff (Digital Marketing, IT) write their day in their
// own words — what they did, what they are on today, what is next tomorrow. Optional: nothing is
// chased. The Founder and the Admin read everyone's day under Reports → Work logs.

import type { WorkLog, WorkLogDay } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, CARD, dayLabel, PageHead, PageState, Problem, useAction } from "../ui";
import { EmptyState } from "../no-results";

const PARTS = [
  ["done", "What I did"],
  ["today", "What I'm doing today"],
  ["tomorrow", "Tomorrow"],
] as const;

function Entry({ entry }: { entry: { done: string | null; today: string | null; tomorrow: string | null } }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-3">
      {PARTS.map(([key, label]) => (
        <div key={key} className="min-w-0">
          <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
          <dd className="text-[13px] whitespace-pre-wrap text-slate-800">{entry[key] ?? <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkLogPage() {
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({ queryKey: ["work-log"], queryFn: () => api<WorkLog>("/api/work-log") });
  const [form, setForm] = useState({ done: "", today: "", tomorrow: "" });
  const [saved, setSaved] = useState(false);
  const data = query.data;
  useEffect(() => {
    const entry = data?.todayEntry;
    if (entry) setForm({ done: entry.done ?? "", today: entry.today ?? "", tomorrow: entry.tomorrow ?? "" });
  }, [data?.todayEntry]);
  if (!data) return <PageState query={query} what="your work log" />;
  const past = data.entries.filter((e) => e.day !== data.today);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHead title="My work log" sub="Your day in your own words, if you want to write it. You can change today's until midnight." />
      <section className={`${CARD} space-y-3 p-4`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Today · {dayLabel(data.today)}</h3>
          {data.todayEntry && <span className="text-[12px] text-slate-500">Saved at {data.todayEntry.at}</span>}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {PARTS.map(([key, label]) => (
            <label key={key} className="block text-[12.5px] font-semibold text-slate-600">
              {label}
              <textarea
                className="field mt-1 min-h-28 w-full py-2 text-[13px] font-normal"
                maxLength={2000}
                value={form[key]}
                onChange={(event) => {
                  setSaved(false);
                  setForm({ ...form, [key]: event.target.value });
                }}
              />
            </label>
          ))}
        </div>
        <Problem message={action.problem?.message} />
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-[12.5px] font-semibold text-emerald-700">Saved</span>}
          <Button
            variant="primary"
            disabled={action.busy || !(form.done.trim() || form.today.trim() || form.tomorrow.trim())}
            onClick={() =>
              void action.run(async () => {
                await api("/api/work-log", { method: "POST", body: form });
                await queries.invalidateQueries({ queryKey: ["work-log"] });
                setSaved(true);
              })
            }
          >
            Save
          </Button>
        </div>
      </section>
      <section className={`${CARD} min-w-0`}>
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Earlier days</h3>
        {past.length === 0 ? (
          <EmptyState title="Nothing written before today.">The days you write show here, the latest first.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {past.map((e) => (
              <li key={e.day} className="space-y-1.5 px-4 py-3">
                <div className="text-[12px] font-bold text-slate-700">{dayLabel(e.day)}</div>
                <Entry entry={e} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Everyone's day, for the Founder and the Admin (a head: the people under them). */
export function WorkLogsPage() {
  const [params, setParams] = useSearchParams();
  const day = params.get("day") ?? "";
  const query = useQuery({
    queryKey: ["work-log", "day", day],
    queryFn: () => api<WorkLogDay>(`/api/work-log/day${day ? `?day=${day}` : ""}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the work logs" />;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHead
        title="Work logs"
        sub="What people wrote about their day (the Founder: everyone; a head: the people under them). Writing it is optional."
        actions={
          <input
            type="date"
            className="field h-10"
            max={data.today}
            value={data.day}
            onChange={(event) => setParams(event.target.value ? { day: event.target.value } : {})}
          />
        }
      />
      <section className={`${CARD} min-w-0`}>
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
          {dayLabel(data.day)} · {data.entries.length} {data.entries.length === 1 ? "person" : "people"} wrote
        </h3>
        {data.entries.length === 0 ? (
          <EmptyState title="Nobody wrote their day.">What people write about their day shows here. Writing it is optional.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.entries.map((e) => (
              <li key={e.personId} className="space-y-1.5 px-4 py-3">
                <div className="text-[13px]">
                  <b className="text-slate-900">{e.name}</b>{" "}
                  <span className="text-slate-500">
                    · {[e.title, e.unit].filter(Boolean).join(" · ")} · at {e.at}
                  </span>
                </div>
                <Entry entry={e} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
