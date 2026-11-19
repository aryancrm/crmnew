// When the customer needs their medicines again (Aryan, 19 Nov: "who fills it, and where does it
// show?"). The one who took the order sets the day their medicines run out, on the case's step 4 or
// on the customer's page; until then the system suggests their last order plus their usual gap.
// The day counts until their next order, and Refills due in the person's menu lists them by it.

import type { Refill } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button, dayLabel, daysBetween, Problem, useAction } from "../ui";

const QUICK = [15, 30, 60, 90] as const;

const plusDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const todayManila = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

const fromNow = (day: string, today: string) => {
  const days = daysBetween(today, day);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days > 0 ? `in ${days} days` : `${-days} days ago`;
};

/** The next refill, and (for one who may) the day to set it. `post` is where it is saved. */
export function RefillCard({
  refill,
  post,
  onSaved,
  plain,
}: {
  refill: Refill;
  post: string;
  onSaved?: () => void | Promise<void>;
  /** Inside another panel: no card of its own. */
  plain?: boolean;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const today = todayManila();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(refill.setOn ?? refill.suggestedOn ?? plusDays(today, 30));
  const [note, setNote] = useState(refill.note ?? "");

  async function save(day: string | null) {
    const done = await action.run(async () => {
      await api(post, { method: "POST", body: { on: day, note: note.trim() || null } });
    });
    if (!done) return;
    setOpen(false);
    await Promise.all([
      queries.invalidateQueries({ queryKey: ["reorders"] }),
      queries.invalidateQueries({ queryKey: ["refills-waiting"] }),
      queries.invalidateQueries({ queryKey: ["customers"] }),
      onSaved?.(),
    ]);
  }

  const next = refill.nextOn;
  const late = next !== null && next < today;
  const body = (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-start gap-2.5">
        <CalendarClock className={`mt-0.5 size-4 shrink-0 ${late ? "text-rose-600" : "text-emerald-700"}`} />
        <div className="min-w-0 flex-1">
          {next ? (
            <div className={`font-semibold ${late ? "text-rose-700" : "text-slate-900"}`}>
              {dayLabel(next)} <span className="font-normal text-slate-500">· {fromNow(next, today)}</span>
            </div>
          ) : (
            <div className="font-semibold text-slate-500">No order yet</div>
          )}
          <div className="text-[12px] text-slate-500">
            {refill.setOn
              ? `Set by ${refill.setBy ?? "someone"}${refill.setAt ? ` on ${dayLabel(refill.setAt, today)}` : ""}${refill.note ? ` · ${refill.note}` : ""}`
              : refill.lastOn
                ? `Suggested: last order ${dayLabel(refill.lastOn, today)} + their usual ${refill.usual} days${refill.orders < 2 ? " (one order: a month)" : ""}`
                : "Set once they order."}
          </div>
        </div>
        {refill.canSet && refill.lastOn && !open && (
          <Button small onClick={() => setOpen(true)}>
            {refill.setOn ? "Change" : "Set the day"}
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="text-[12px] text-slate-600">When do their medicines run out? Ask them, or count the tablets.</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((days) => {
              const day = plusDays(today, days);
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => setOn(day)}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${on === day ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"}`}
                >
                  {days} days
                </button>
              );
            })}
          </div>
          <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
            Day
            <input
              type="date"
              className="field h-9 w-auto"
              min={today}
              value={on}
              onChange={(event) => setOn(event.target.value)}
            />
          </label>
          <input
            className="field h-9"
            placeholder="Note (optional), e.g. 30 tablets, 1 a day"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Problem message={action.problem?.message} />
          <div className="flex flex-wrap gap-2">
            <Button small variant="primary" disabled={action.busy || !on} onClick={() => void save(on)}>
              {action.busy ? "Saving…" : "Save"}
            </Button>
            {refill.setOn && (
              <Button small disabled={action.busy} onClick={() => void save(null)}>
                Use the usual gap
              </Button>
            )}
            <Button small disabled={action.busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
  if (plain) return body;
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <h2 className="border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">Next refill</h2>
      {body}
    </section>
  );
}
