// A person's own leave and forms: the vacation and sick leave left this year, asking for leave
// (with a paper such as a medical certificate), filing official business, work from home or
// overtime, and what they asked for with whoever decided it. Everything waits for whom they
// report to (HR when that is the CEO).

import type { FormKind, FormLine, LeaveKind, LeaveLine, MyLeave } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, CalendarPlus, Camera, FileText } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { FIELD } from "../org/dialogs";
import { smaller } from "../photo";
import { Ring } from "../team/charts";
import { manilaToday } from "../team/range";
import { Button, CARD, Dialog, PageHead, PageState, Problem, useAction } from "../ui";
import { LEAVE_WORDS } from "./attendance-report";
import { EmptyState } from "../no-results";

export const LEAVE_STATUS: Record<LeaveLine["status"], { word: string; tone: string }> = {
  asked: { word: "Waiting", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { word: "Approved", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  refused: { word: "Not approved", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  cancelled: { word: "Cancelled", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
};
export const spanWords = (from: string, to: string) => {
  const one = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  return from === to ? one(from) : `${one(from)} – ${one(to)}`;
};
export const daysWords = (line: LeaveLine) =>
  line.halfDay ? "half a day" : `${line.days} ${line.days === 1 ? "day" : "days"}`;

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

export function MyLeavePage() {
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ["leave", "mine"],
    queryFn: () => api<MyLeave>("/api/hr/leave/mine"),
  });
  const [asking, setAsking] = useState(params.get("new") === "1");
  const [filing, setFiling] = useState(false);
  const forms = useQuery({
    queryKey: ["leave", "forms", "mine"],
    queryFn: () => api<{ lines: FormLine[] }>("/api/hr/forms/mine"),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="your leave" />;
  const b = data.balances;
  const card = (label: string, balance: MyLeave["balances"]["vl"], color: string) => (
    <div className={`${CARD} flex items-center gap-4 p-4`}>
      <Ring share={balance.allotted ? balance.left / balance.allotted : 0} color={color} size={68}>
        <span className="text-sm font-semibold text-slate-900 tabular-nums">{balance.left}</span>
      </Ring>
      <div className="min-w-0 text-sm">
        <div className="font-semibold text-slate-900">{label} left</div>
        {balance.allotted ? (
          <div className="text-xs text-slate-500">
            of {balance.allotted} this year · {balance.used} taken
            {balance.asked ? ` · ${balance.asked} waiting` : ""}
          </div>
        ) : (
          <div className="text-xs text-slate-500">None while on probation</div>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="My leave & forms"
        sub={`${data.year} · your requests go to ${data.approver}`}
        actions={
          <>
            <Button onClick={() => setFiling(true)}>
              <BriefcaseBusiness size={16} /> File a form
            </Button>
            <Button variant="primary" onClick={() => setAsking(true)}>
              <CalendarPlus size={16} /> Ask for leave
            </Button>
          </>
        }
      />
      <div className="grid gap-3 md:grid-cols-3">
        {card("Vacation leave", b.vl, "#059669")}
        {card("Sick leave", b.sl, "#0284c7")}
        <div className={`${CARD} p-4`}>
          <div className="text-xs font-semibold text-slate-500">Leave without pay</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
            {b.lwop.used}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            days taken{b.lwop.asked ? ` · ${b.lwop.asked} waiting` : ""}
          </div>
        </div>
      </div>
      <section className={`${CARD} overflow-hidden`}>
        <ul className="divide-y divide-slate-100">
          {data.lines.map((line) => (
            <MyLine key={line.id} line={line} />
          ))}
          {data.lines.length === 0 && (
            <li>
              <EmptyState title="No leave asked for this year.">Leave you ask for with Ask for leave shows here with where it stands.</EmptyState>
            </li>
          )}
        </ul>
      </section>
      <section className={`${CARD} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
          Forms: official business, work from home, overtime
        </h2>
        <ul className="divide-y divide-slate-100">
          {(forms.data?.lines ?? []).map((line) => (
            <FormLineRow key={line.id} line={line} />
          ))}
          {forms.data && forms.data.lines.length === 0 && (
            <li>
              <EmptyState title="No forms filed this year.">Forms you file with File a form show here.</EmptyState>
            </li>
          )}
        </ul>
      </section>
      {asking && <AskDialog mine={data} onClose={() => setAsking(false)} />}
      {filing && <FormDialog approver={data.approver} onClose={() => setFiling(false)} />}
    </div>
  );
}

function MyLine({ line }: { line: LeaveLine }) {
  const queries = useQueryClient();
  const action = useAction();
  const status = LEAVE_STATUS[line.status];
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{LEAVE_WORDS[line.kind]} leave</span>
          <span className="text-slate-700">{spanWords(line.from, line.to)}</span>
          <span className="text-xs text-slate-500">{daysWords(line)}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${status.tone}`}
          >
            {status.word}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {[
            line.reason,
            line.status === "asked" ? `with ${line.approver ?? "HR"}` : null,
            line.decidedBy && line.status !== "asked" ? `by ${line.decidedBy}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {line.decisionNote && <div className="mt-1 text-xs text-rose-700">{line.decisionNote}</div>}
        {line.file && (
          <a
            href={`/api/hr/leave/${line.id}/file`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
          >
            <FileText size={12} /> {line.file.name}
          </a>
        )}
        <Problem message={action.problem?.message} />
      </div>
      {line.canCancel && (
        <Button
          small
          variant="quiet"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api(`/api/hr/leave/${line.id}/cancel`, { body: {} });
              await queries.invalidateQueries({ queryKey: ["leave"] });
            })
          }
        >
          Cancel it
        </Button>
      )}
    </li>
  );
}

function AskDialog({ mine, onClose }: { mine: MyLeave; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const paid = mine.balances.vl.allotted > 0;
  const [kind, setKind] = useState<LeaveKind>(paid ? "vl" : "lwop");
  const [from, setFrom] = useState(manilaToday());
  const [to, setTo] = useState(manilaToday());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      const body = new FormData();
      body.set("kind", kind);
      body.set("from", from);
      body.set("to", halfDay ? from : to);
      body.set("halfDay", String(halfDay));
      if (reason.trim()) body.set("reason", reason.trim());
      if (file) body.set("file", await smaller(file));
      await api("/api/hr/leave/request", { body });
    });
    if (done) {
      await queries.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    }
  }
  const left = (key: LeaveKind) =>
    key === "vl" ? mine.balances.vl.left : key === "sl" ? mine.balances.sl.left : null;
  return (
    <Dialog
      title="Ask for leave"
      sub={`It goes to ${mine.approver}. Rest days and holidays don't count.`}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Label text="Kind *" error={action.at("kind")}>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as LeaveKind)}
              className={FIELD}
            >
              {(Object.keys(LEAVE_WORDS) as LeaveKind[]).map((key) => {
                const days = left(key);
                return (
                  <option key={key} value={key} disabled={days === 0}>
                    {LEAVE_WORDS[key]}
                    {days !== null ? ` (${days} left)` : ""}
                  </option>
                );
              })}
            </select>
          </Label>
          <Label text="From *" error={action.at("from")}>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={FIELD}
            />
          </Label>
          {!halfDay && (
            <Label text="To *" error={action.at("to")}>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
                className={FIELD}
              />
            </Label>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={halfDay}
            onChange={(event) => setHalfDay(event.target.checked)}
            className="size-4 accent-emerald-600"
          />
          Half a day
        </label>
        <Label text={kind === "other" ? "What it is for *" : "Reason"} error={action.at("reason")}>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD}
            placeholder="Family matter"
          />
        </Label>
        <Label
          text={kind === "sl" ? "Medical certificate (if you have one)" : "A paper (if any)"}
          error={action.at("file")}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-hover">
              <Camera size={15} /> {file ? "Another photo" : "Take or pick a photo"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </span>
            <span className="truncate text-xs text-slate-600">{file ? file.name : "None"}</span>
          </span>
        </Label>
        <Problem message={action.general(["kind", "from", "to", "reason", "file"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Sending…" : "Ask for leave"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export const FORM_WORDS: Record<FormKind, string> = {
  ob: "Official business",
  wfh: "Work from home",
  ot: "Overtime",
};
const hoursWords = (minutes: number) =>
  minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
export const formWhen = (line: FormLine) =>
  `${spanWords(line.day, line.day)}${line.from ? ` · ${line.from}–${line.to} (${hoursWords(line.minutes)})` : ""}`;

/** A form as a line: what, when, where it stands, and who decided it. */
export function FormLineRow({
  line,
  showPerson = false,
}: {
  line: FormLine;
  showPerson?: boolean;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");
  const status = LEAVE_STATUS[line.status];
  const done = () => queries.invalidateQueries({ queryKey: ["leave"] });
  const decide = (approve: boolean) =>
    action.run(async () => {
      await api(`/api/hr/forms/${line.id}/decide`, { body: { approve, note: note || null } });
      await done();
    });
  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {showPerson && <span className="font-semibold text-slate-900">{line.person.name}</span>}
          <span className={showPerson ? "text-slate-700" : "font-semibold text-slate-900"}>
            {FORM_WORDS[line.kind]}
          </span>
          <span className="text-slate-700">{formWhen(line)}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${status.tone}`}
          >
            {status.word}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {[
            showPerson ? line.person.team : null,
            line.place,
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
                className="h-8 w-48 rounded-lg border border-slate-300 px-2 text-sm"
              />
              <Button small type="submit" disabled={action.busy}>
                Not approved
              </Button>
            </form>
          ) : (
            <>
              <Button small variant="primary" disabled={action.busy} onClick={() => decide(true)}>
                Approve
              </Button>
              <Button small onClick={() => setRefusing(true)}>
                Not approved
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
                await api(`/api/hr/forms/${line.id}/cancel`, { body: {} });
                await done();
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

function FormDialog({ approver, onClose }: { approver: string; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [kind, setKind] = useState<FormKind>("ob");
  const [day, setDay] = useState(manilaToday());
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("12:00");
  const [place, setPlace] = useState("");
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api("/api/hr/forms", {
        body: {
          kind,
          day,
          from: kind === "wfh" ? null : from,
          to: kind === "wfh" ? null : to,
          place: kind === "ob" ? place : null,
          reason,
        },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    }
  }
  return (
    <Dialog
      title="File a form"
      sub={`It goes to ${approver}.`}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Form *" error={action.at("kind")}>
            <select
              value={kind}
              onChange={(event) => {
                const next = event.target.value as FormKind;
                setKind(next);
                if (next === "ot") {
                  setFrom("16:00");
                  setTo("18:00");
                }
              }}
              className={FIELD}
            >
              {(Object.keys(FORM_WORDS) as FormKind[]).map((key) => (
                <option key={key} value={key}>
                  {FORM_WORDS[key]}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Day *" error={action.at("day")}>
            <input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className={FIELD}
            />
          </Label>
        </div>
        {kind !== "wfh" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="From *" error={action.at("from")}>
              <input
                type="time"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={FIELD}
              />
            </Label>
            <Label text="To *" error={action.at("to")}>
              <input
                type="time"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className={FIELD}
              />
            </Label>
          </div>
        )}
        {kind === "ob" && (
          <Label text="Where *" error={action.at("place")}>
            <input
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              className={FIELD}
              placeholder="Pasay General Hospital"
            />
          </Label>
        )}
        <Label text="What it was for *" error={action.at("reason")}>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD}
            placeholder={
              kind === "ot"
                ? "Stock count"
                : kind === "wfh"
                  ? "Monthly reports"
                  : "Meeting with the pharmacy head"
            }
          />
        </Label>
        <Problem message={action.general(["kind", "day", "from", "to", "place", "reason"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Sending…" : "File the form"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
