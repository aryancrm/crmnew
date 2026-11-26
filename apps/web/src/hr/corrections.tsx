// Asking for a day of one's own attendance to be put right (a missed time in or out, a wrong time,
// forgot to sign in), and the request as a line wherever it shows: the person's own leave & forms
// page, their attendance month, and the Leave & forms list where their lead or HR decides it.

import type { FixLine } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Undo2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { manilaToday } from "../team/range";
import { Button, Dialog, Field, INPUT, Problem, useAction } from "../ui";
import { LEAVE_STATUS, spanWords } from "./my-leave";

/** How far back a day may be asked for (the API says the same). */
export const FIX_DAYS_BACK = 31;
const daysBack = (days: number) => {
  const date = new Date(`${manilaToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
/** Whether a day may still be asked for. */
export const fixable = (day: string) => day <= manilaToday() && day >= daysBack(FIX_DAYS_BACK);

/** Every query a request changes: the person's month, their leave & forms, the decision lists. */
async function refresh(queries: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queries.invalidateQueries({ queryKey: ["leave"] }),
    queries.invalidateQueries({ queryKey: ["attendance"] }),
    queries.invalidateQueries({ queryKey: ["decisions"] }),
  ]);
}

/** A request as a line: the day, the times asked, where it stands, who decided it. */
export function FixLineRow({ line, showPerson = false }: { line: FixLine; showPerson?: boolean }) {
  const queries = useQueryClient();
  const action = useAction();
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");
  const status = LEAVE_STATUS[line.status];
  const decide = (approve: boolean) =>
    action.run(async () => {
      await api(`/api/hr/fixes/${line.id}/decide`, { body: { approve, note: note || null } });
      await refresh(queries);
    });
  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {showPerson && (
            <Link
              to={`/hr/attendance/${line.person.id}?month=${line.day.slice(0, 7)}`}
              className="font-semibold text-slate-900 hover:text-emerald-700"
            >
              {line.person.name}
            </Link>
          )}
          <span className={showPerson ? "text-slate-700" : "font-semibold text-slate-900"}>
            {spanWords(line.day, line.day)}
          </span>
          <span className="text-slate-700 tabular-nums">
            {line.timeIn} – {line.timeOut ?? "no time out"}
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${status.tone}`}>
            {status.word}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {[
            showPerson ? line.person.team : null,
            line.reason,
            line.status === "asked" ? `with ${line.approver ?? "HR"}` : null,
            line.decidedBy && line.status !== "asked" ? `by ${line.decidedBy}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {line.decisionNote && <div className="mt-1 text-xs text-rose-700">{line.decisionNote}</div>}
        <Problem message={action.problem?.message} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {line.canDecide &&
          (refusing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void decide(false);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why not"
                aria-label="Why not"
                className="h-8 w-48 rounded-lg border border-slate-300 px-2 text-sm"
              />
              <Button small type="submit" disabled={action.busy}>
                Not approved
              </Button>
            </form>
          ) : (
            <>
              <Button small variant="primary" disabled={action.busy} onClick={() => decide(true)}>
                <Check size={14} /> Approve
              </Button>
              <Button small onClick={() => setRefusing(true)}>
                <Undo2 size={14} /> Not approved
              </Button>
            </>
          ))}
        {line.canCancel && !line.canDecide && (
          <Button
            small
            variant="quiet"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await api(`/api/hr/fixes/${line.id}/cancel`, { body: {} });
                await refresh(queries);
              })
            }
          >
            Cancel it
          </Button>
        )}
      </div>
    </li>
  );
}

/** "Ask to fix a day": the day, the times it really was, and what happened. */
export function FixDialog({
  approver,
  day: firstDay,
  timeIn: firstIn,
  timeOut: firstOut,
  onClose,
}: {
  approver?: string | null;
  day?: string;
  timeIn?: string;
  timeOut?: string;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [day, setDay] = useState(firstDay ?? manilaToday());
  const [timeIn, setTimeIn] = useState(firstIn || "07:00");
  const [timeOut, setTimeOut] = useState(firstOut ?? "16:00");
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api("/api/hr/fixes", { body: { day, timeIn, timeOut: timeOut || null, reason } }),
    );
    if (done) {
      await refresh(queries);
      onClose();
    }
  }
  return (
    <Dialog
      title="Ask to fix a day"
      sub={`The day as it really was. It goes to ${approver ?? "whom you report to, or HR"}.`}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Day *" error={action.at("day")}>
            {(field) => (
              <input
                {...field}
                type="date"
                className={INPUT}
                value={day}
                min={daysBack(FIX_DAYS_BACK)}
                max={manilaToday()}
                onChange={(event) => setDay(event.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Time in *" error={action.at("timeIn")}>
            {(field) => (
              <input
                {...field}
                type="time"
                className={INPUT}
                value={timeIn}
                onChange={(event) => setTimeIn(event.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Time out" error={action.at("timeOut")}>
            {(field) => (
              <input
                {...field}
                type="time"
                className={INPUT}
                value={timeOut}
                onChange={(event) => setTimeOut(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="What happened *" error={action.at("reason")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Forgot to sign in; came in at 7:30"
              required
            />
          )}
        </Field>
        <Problem message={action.general(["day", "timeIn", "timeOut", "reason"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Sending…" : "Ask to fix it"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
