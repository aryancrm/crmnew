// A person's own leave and forms: the vacation and sick leave left this year (with HR's
// adjustments), asking for leave (up to five papers, such as a medical certificate; vacation leave
// a week ahead), filing official business, work from home, overtime (with its type; a team lead
// files it for someone under them too), the daily accomplishment report or an incident report,
// asking for a day of their attendance to be put right, their signature for the printouts, and
// what they asked for with whoever decided it. Approved leave is revoked before it starts; a form
// is revoked until decided, and one HR returned is sent again fixed.

import type {
  AttendanceToday,
  EodActivity,
  FixLine,
  FormInput,
  FormKind,
  FormLine,
  FormStatus,
  IncidentType,
  LeaveKind,
  LeaveLine,
  MyLeave,
  OtType,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, CalendarPlus, Camera, Clock, FileText, Plus, Printer, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { FIELD } from "../org/dialogs";
import { smaller } from "../photo";
import { Ring } from "../team/charts";
import { manilaToday } from "../team/range";
import { Button, CARD, Dialog, PageHead, PageState, Problem, useAction } from "../ui";
import { LEAVE_WORDS } from "./attendance-report";
import { FixDialog, FixLineRow } from "./corrections";
import { MySignatureCard } from "./signature";

export const LEAVE_STATUS: Record<LeaveLine["status"], { word: string; tone: string }> = {
  asked: { word: "Waiting", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { word: "Approved", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  refused: { word: "Not approved", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  cancelled: { word: "Cancelled", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
  revoked: { word: "Revoked", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
};
export const FORM_STATUS: Record<FormStatus, { word: string; tone: string }> = {
  ...LEAVE_STATUS,
  returned: { word: "Returned to fix", tone: "bg-orange-50 text-orange-800 ring-orange-200" },
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
const LEAD_ROLES = ["team_lead", "manager"];

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

/** A leave's papers as links: its first one (older rows) or each proof file. */
export function LeavePapers({ line }: { line: LeaveLine }) {
  const papers = line.files.length
    ? line.files.map((one) => ({ key: one.id, name: one.name, href: `/api/hr/leave/${line.id}/files/${one.id}` }))
    : line.file
      ? [{ key: 0, name: line.file.name, href: `/api/hr/leave/${line.id}/file` }]
      : [];
  if (!papers.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {papers.map((one) => (
        <a
          key={one.key}
          href={one.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
        >
          <FileText size={12} /> {one.name}
        </a>
      ))}
    </div>
  );
}

export function PrintLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100"
    >
      <Printer size={14} /> Print
    </Link>
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
  const [fixing, setFixing] = useState(false);
  const fixes = useQuery({
    queryKey: ["leave", "fixes", "mine"],
    queryFn: () => api<{ lines: FixLine[] }>("/api/hr/fixes/mine"),
  });
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
            {balance.adjusted
              ? ` · ${balance.adjusted > 0 ? "+" : "−"}${Math.abs(balance.adjusted)} by HR`
              : ""}
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
        sub={`${data.year} · your requests go to ${data.approver}${data.secondApprover ? ` and ${data.secondApprover}` : ""}`}
        actions={
          <>
            <Button onClick={() => setFixing(true)}>
              <Clock size={16} /> Ask to fix a day
            </Button>
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
      {data.credits.length > 0 && (
        <section className={`${CARD} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
            HR's changes to your {data.year} credits
          </h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.credits.map((one) => (
              <li key={one.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-semibold tabular-nums">
                    {one.days > 0 ? "+" : ""}
                    {one.days} {one.kind.toUpperCase()}
                  </span>{" "}
                  <span className="text-slate-700">{one.reason}</span>
                  {one.reversedBy ? <span className="text-xs text-slate-500"> · reversed</span> : null}
                </span>
                <span className="text-xs text-slate-500">{one.by}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={`${CARD} overflow-hidden`}>
        <ul className="divide-y divide-slate-100">
          {data.lines.map((line) => (
            <MyLine key={line.id} line={line} />
          ))}
          {data.lines.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              No leave asked for this year.
            </li>
          )}
        </ul>
      </section>
      <section className={`${CARD} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
          Forms: official business, work from home, overtime, reports
        </h2>
        <ul className="divide-y divide-slate-100">
          {(forms.data?.lines ?? []).map((line) => (
            <FormLineRow key={line.id} line={line} approver={data.approver} />
          ))}
          {forms.data && forms.data.lines.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-500">
              No forms filed this year.
            </li>
          )}
        </ul>
      </section>
      <section className={`${CARD} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">
          Attendance days to put right
        </h2>
        <ul className="divide-y divide-slate-100">
          {(fixes.data?.lines ?? []).map((line) => (
            <FixLineRow key={line.id} line={line} />
          ))}
          {fixes.data && fixes.data.lines.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-500">
              None asked this year. Missed a time in or out? Ask to fix the day.
            </li>
          )}
        </ul>
      </section>
      <MySignatureCard />
      {asking && <AskDialog mine={data} onClose={() => setAsking(false)} />}
      {fixing && <FixDialog approver={data.approver} onClose={() => setFixing(false)} />}
      {filing && <FormDialog approver={data.approver} onClose={() => setFiling(false)} />}
    </div>
  );
}

function MyLine({ line }: { line: LeaveLine }) {
  const queries = useQueryClient();
  const action = useAction();
  const status = LEAVE_STATUS[line.status];
  const act = (path: string, body: unknown = {}) =>
    action.run(async () => {
      await api(`/api/hr/leave/${line.id}/${path}`, { body });
      await queries.invalidateQueries({ queryKey: ["leave"] });
    });
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
            line.status === "asked"
              ? `with ${line.approver ?? "HR"}${line.secondApprover ? ` or ${line.secondApprover}` : ""}`
              : null,
            line.decidedBy && line.status !== "asked" ? `by ${line.decidedBy}` : null,
            line.revokedBy ? `revoked by ${line.revokedBy}${line.revokeReason ? `: ${line.revokeReason}` : ""}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {line.decisionNote && <div className="mt-1 text-xs text-rose-700">{line.decisionNote}</div>}
        <LeavePapers line={line} />
        <Problem message={action.problem?.message} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {line.canPrint && <PrintLink to={`/hr/print/leave/${line.id}`} />}
        {line.canRevoke ? (
          <Button
            small
            variant="quiet"
            disabled={action.busy}
            onClick={() => {
              const reason = window.prompt("Why take it back? (optional)") ?? null;
              void act("revoke", { reason });
            }}
          >
            Revoke
          </Button>
        ) : (
          line.canCancel && (
            <Button small variant="quiet" disabled={action.busy} onClick={() => act("cancel")}>
              Cancel it
            </Button>
          )
        )}
      </div>
    </li>
  );
}

function AskDialog({ mine, onClose }: { mine: MyLeave; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const paid = mine.balances.vl.allotted > 0;
  const [kind, setKind] = useState<LeaveKind>(paid ? "vl" : "lwop");
  const [from, setFrom] = useState(paid ? mine.rules.earliestVl : manilaToday());
  const [to, setTo] = useState(paid ? mine.rules.earliestVl : manilaToday());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      const body = new FormData();
      body.set("kind", kind);
      body.set("from", from);
      body.set("to", halfDay ? from : to);
      body.set("halfDay", String(halfDay));
      if (reason.trim()) body.set("reason", reason.trim());
      for (const file of files) body.append("file", await smaller(file));
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
      sub={`It goes to ${mine.approver}${mine.secondApprover ? ` and ${mine.secondApprover}` : ""}. Rest days and holidays don't count. Vacation leave is asked ${mine.rules.vlNoticeDays} days ahead.`}
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
              min={kind === "vl" ? mine.rules.earliestVl : undefined}
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
          text={
            kind === "sl"
              ? `Medical certificate (needed for ${mine.rules.slProofFromDays} days or more)`
              : `Papers, if any (up to ${mine.rules.filesMax})`
          }
          error={action.at("file")}
        >
          <span className="flex flex-wrap items-center gap-2">
            {files.length < mine.rules.filesMax && (
              <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-hover">
                <Camera size={15} /> {files.length ? "Another photo" : "Take or pick a photo"}
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(event) =>
                    setFiles((now) =>
                      [...now, ...Array.from(event.target.files ?? [])].slice(0, mine.rules.filesMax),
                    )
                  }
                />
              </span>
            )}
            {files.length === 0 && <span className="text-xs text-slate-600">None</span>}
            {files.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
              >
                {file.name}
                <button
                  type="button"
                  aria-label={`Take off ${file.name}`}
                  onClick={() => setFiles((now) => now.filter((_, at) => at !== index))}
                  className="text-slate-400 hover:text-rose-700"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
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
  eod: "Daily accomplishment report",
  incident: "Incident report",
};
export const OT_WORDS: Record<OtType, string> = {
  regular: "Regular day",
  rest: "Rest day",
  legal: "Regular holiday",
  special: "Special non-working day",
  rest_legal: "Rest day on a regular holiday",
  rest_special: "Rest day on a special day",
  broken: "Broken time",
};
const INCIDENT_TYPES: IncidentType[] = ["Safety / Accident", "Misconduct", "Property Damage", "Security", "Other"];
const hoursWords = (minutes: number) =>
  minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
export const formWhen = (line: FormLine) =>
  `${spanWords(line.day, line.day)}${line.from ? ` · ${line.from}–${line.to} (${hoursWords(line.minutes)}${line.nightMinutes ? `, ${hoursWords(line.nightMinutes)} at night` : ""})` : ""}`;

/** A form as a line: what, when, where it stands, who decided it, and what can be done with it. */
export function FormLineRow({
  line,
  showPerson = false,
  approver = null,
}: {
  line: FormLine;
  showPerson?: boolean;
  /** Whom the person's own forms go to (to send a returned one again). */
  approver?: string | null;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [refusing, setRefusing] = useState<"refuse" | "return" | null>(null);
  const [resending, setResending] = useState(false);
  const [note, setNote] = useState("");
  const status =
    line.kind === "incident" && line.status === "approved"
      ? { word: "Taken in", tone: FORM_STATUS.approved.tone }
      : FORM_STATUS[line.status];
  const done = () => queries.invalidateQueries({ queryKey: ["leave"] });
  const post = (path: string, body: unknown = {}) =>
    action.run(async () => {
      await api(`/api/hr/forms/${line.id}/${path}`, { body });
      await done();
    });
  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {showPerson && <span className="font-semibold text-slate-900">{line.person.name}</span>}
          <span className={showPerson ? "text-slate-700" : "font-semibold text-slate-900"}>
            {FORM_WORDS[line.kind]}
            {line.otType ? ` (${OT_WORDS[line.otType].toLowerCase()})` : ""}
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
            !showPerson && line.person.name && line.headBy && line.headBy !== line.person.name
              ? `for ${line.person.name}`
              : null,
            line.headBy ? `filed by ${line.headBy}` : null,
            line.place,
            line.reason,
            line.status === "asked" ? `with ${line.approver ?? "HR"}` : null,
            line.decidedBy && line.status !== "asked" ? `by ${line.decidedBy}` : null,
            line.revoked
              ? `revoked by ${line.revoked.by} (was ${line.revoked.from === "returned" ? "returned" : "waiting"} at ${line.revoked.stage === "hr" ? "HR" : "the approver"})`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {line.details && "activities" in line.details && (
          <ul className="mt-1 text-xs text-slate-600">
            {line.details.activities.map((one, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the activities are fixed as filed.
              <li key={index}>
                {one.timeIn}–{one.timeOut} · {one.details}
                {one.location ? ` · ${one.location}` : ""}
              </li>
            ))}
          </ul>
        )}
        {line.details && "persons" in line.details && (
          <div className="mt-1 text-xs text-slate-600">
            {line.details.type}
            {line.details.otherText ? `: ${line.details.otherText}` : ""} · {line.details.time} at{" "}
            {line.details.location} · involved: {line.details.persons} · done: {line.details.action}
          </div>
        )}
        {line.status === "returned" && line.returnNote && (
          <div className="mt-1 text-xs text-orange-800">To fix: {line.returnNote}</div>
        )}
        {line.decisionNote && <div className="mt-1 text-xs text-rose-700">{line.decisionNote}</div>}
        <Problem message={action.problem?.message} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {refusing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void (refusing === "return"
                ? post("return", { note: note || null })
                : post("decide", { approve: false, note: note || null }));
            }}
            className="flex items-center gap-2"
          >
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={refusing === "return" ? "What to fix" : "Why not"}
              className="h-8 w-48 rounded-lg border border-slate-300 px-2 text-sm"
            />
            <Button small type="submit" disabled={action.busy}>
              {refusing === "return" ? "Return it" : "Not approved"}
            </Button>
            <Button small variant="quiet" onClick={() => setRefusing(null)}>
              <X size={14} />
            </Button>
          </form>
        ) : (
          <>
            {line.canDecide && (
              <>
                <Button
                  small
                  variant="primary"
                  disabled={action.busy}
                  onClick={() => post("decide", { approve: true, note: null })}
                >
                  {line.kind === "incident" ? "Mark taken in" : "Approve"}
                </Button>
                {line.kind !== "incident" && (
                  <Button small onClick={() => setRefusing("refuse")}>
                    Not approved
                  </Button>
                )}
              </>
            )}
            {line.canReturn && (
              <Button small variant="quiet" onClick={() => setRefusing("return")}>
                Return to fix
              </Button>
            )}
          </>
        )}
        {line.canPrint && <PrintLink to={`/hr/print/form/${line.id}`} />}
        {line.canResend && (
          <Button small variant="primary" onClick={() => setResending(true)}>
            Fix and send again
          </Button>
        )}
        {line.canRevoke && (
          <Button small variant="quiet" disabled={action.busy} onClick={() => post("revoke")}>
            Revoke
          </Button>
        )}
        {line.canCancel && !line.canDecide && !line.canRevoke && (
          <Button small variant="quiet" disabled={action.busy} onClick={() => post("cancel")}>
            Cancel it
          </Button>
        )}
      </div>
      {resending && (
        <FormDialog approver={approver ?? line.approver ?? "HR"} line={line} onClose={() => setResending(false)} />
      )}
    </li>
  );
}

const blankActivity = (): EodActivity => ({
  timeIn: "08:00",
  timeOut: "10:00",
  location: null,
  details: "",
  deadline: null,
  remarks: null,
});

/** Filing a form, or sending a returned one again fixed (its kind and person stay). */
function FormDialog({
  approver,
  line,
  onClose,
}: {
  approver: string;
  line?: FormLine;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const me = useMe().data;
  const lead = Boolean(me && LEAD_ROLES.includes(me.role));
  const incidentWas = line?.details && "persons" in line.details ? line.details : null;
  const [kind, setKind] = useState<FormKind>(line?.kind ?? "ob");
  const [day, setDay] = useState(line?.day ?? manilaToday());
  const [from, setFrom] = useState(line?.from ?? "09:00");
  const [to, setTo] = useState(line?.to ?? "12:00");
  const [place, setPlace] = useState(line?.place ?? "");
  const [reason, setReason] = useState(line?.reason ?? "");
  const [otType, setOtType] = useState<OtType | "">(line?.otType ?? "");
  const [forPerson, setForPerson] = useState("");
  const [activities, setActivities] = useState<EodActivity[]>(
    line?.details && "activities" in line.details ? line.details.activities : [blankActivity()],
  );
  const [incident, setIncident] = useState({
    time: incidentWas?.time ?? "09:00",
    location: incidentWas?.location ?? "",
    type: (incidentWas?.type ?? "Safety / Accident") as IncidentType,
    otherText: incidentWas?.otherText ?? "",
    persons: incidentWas?.persons ?? "",
    action: incidentWas?.action ?? "",
  });
  const team = useQuery({
    queryKey: ["attendance", "today", "team"],
    queryFn: () => api<AttendanceToday>("/api/hr/attendance"),
    enabled: lead && !line && kind === "ot",
  });
  const timed = kind === "ob" || kind === "ot";
  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: FormInput = {
      kind,
      day,
      from: timed ? from : null,
      to: timed ? to : null,
      place: kind === "ob" ? place : null,
      reason,
      otType: kind === "ot" && otType ? otType : null,
      forPersonId: kind === "ot" && forPerson ? Number(forPerson) : null,
      activities: kind === "eod" ? activities : null,
      incident: kind === "incident" ? incident : null,
    };
    const done = await action.run(() =>
      api(line ? `/api/hr/forms/${line.id}/resend` : "/api/hr/forms", { body }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    }
  }
  const toHr = kind === "eod" || kind === "incident" || (kind === "ot" && forPerson);
  const setActivity = (index: number, patch: Partial<EodActivity>) =>
    setActivities((now) => now.map((one, at) => (at === index ? { ...one, ...patch } : one)));
  return (
    <Dialog
      title={line ? "Fix and send again" : "File a form"}
      sub={`It goes to ${toHr ? "HR" : approver}.`}
      onClose={onClose}
      busy={action.busy}
      wide={kind === "eod"}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Form *" error={action.at("kind")}>
            <select
              value={kind}
              disabled={Boolean(line)}
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
        {kind === "ot" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Type of overtime" error={action.at("otType")}>
              <select
                value={otType}
                onChange={(event) => setOtType(event.target.value as OtType | "")}
                className={FIELD}
              >
                <option value="">The day's own kind</option>
                {(Object.keys(OT_WORDS) as OtType[]).map((key) => (
                  <option key={key} value={key}>
                    {OT_WORDS[key]}
                  </option>
                ))}
              </select>
            </Label>
            {lead && !line && (
              <Label text="For (Head Requisition: straight to HR)" error={action.at("forPersonId")}>
                <select value={forPerson} onChange={(event) => setForPerson(event.target.value)} className={FIELD}>
                  <option value="">Myself</option>
                  {(team.data?.people ?? [])
                    .filter((one) => one.personId !== me?.id)
                    .map((one) => (
                      <option key={one.personId} value={one.personId}>
                        {one.name}
                      </option>
                    ))}
                </select>
              </Label>
            )}
          </div>
        )}
        {timed && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="From *" error={action.at("from")}>
              <input
                type="time"
                step={kind === "ot" ? 1800 : undefined}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={FIELD}
              />
            </Label>
            <Label text="To *" error={action.at("to")}>
              <input
                type="time"
                step={kind === "ot" ? 1800 : undefined}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className={FIELD}
              />
            </Label>
          </div>
        )}
        {kind === "ot" && (
          <p className="-mt-2 text-xs text-slate-500">
            On the hour or half hour; past midnight is fine. Working hours don't count on a regular day; 10 PM to 6 AM is
            night differential.
          </p>
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
        {kind === "incident" && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Label text="Time *" error={action.at("time")}>
                <input
                  type="time"
                  value={incident.time}
                  onChange={(event) => setIncident({ ...incident, time: event.target.value })}
                  className={FIELD}
                />
              </Label>
              <Label text="Where *" error={action.at("location")}>
                <input
                  value={incident.location}
                  onChange={(event) => setIncident({ ...incident, location: event.target.value })}
                  className={FIELD}
                />
              </Label>
              <Label text="Kind *" error={action.at("type")}>
                <select
                  value={incident.type}
                  onChange={(event) => setIncident({ ...incident, type: event.target.value as IncidentType })}
                  className={FIELD}
                >
                  {INCIDENT_TYPES.map((one) => (
                    <option key={one}>{one}</option>
                  ))}
                </select>
              </Label>
            </div>
            {incident.type === "Other" && (
              <Label text="What kind *" error={action.at("otherText")}>
                <input
                  value={incident.otherText}
                  onChange={(event) => setIncident({ ...incident, otherText: event.target.value })}
                  className={FIELD}
                />
              </Label>
            )}
          </>
        )}
        <Label
          text={kind === "eod" ? "Purpose or project *" : kind === "incident" ? "What happened *" : "What it was for *"}
          error={action.at("reason")}
        >
          <textarea
            rows={kind === "incident" ? 3 : 1}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD}
            placeholder={
              kind === "ot"
                ? "Stock count"
                : kind === "wfh"
                  ? "Monthly reports"
                  : kind === "eod"
                    ? "Hospital accounts in Pasay"
                    : kind === "incident"
                      ? "Describe the incident"
                      : "Meeting with the pharmacy head"
            }
          />
        </Label>
        {kind === "incident" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text='Who was involved * ("None" if no one else)' error={action.at("persons")}>
              <textarea
                rows={2}
                value={incident.persons}
                onChange={(event) => setIncident({ ...incident, persons: event.target.value })}
                className={FIELD}
              />
            </Label>
            <Label text='What was done at once * ("None" if nothing)' error={action.at("action")}>
              <textarea
                rows={2}
                value={incident.action}
                onChange={(event) => setIncident({ ...incident, action: event.target.value })}
                className={FIELD}
              />
            </Label>
          </div>
        )}
        {kind === "eod" && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-slate-600">Activities *</div>
            {activities.map((one, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place.
              <div key={index} className="grid gap-2 sm:grid-cols-[6rem_6rem_1fr_8rem_auto]">
                <input
                  type="time"
                  aria-label="Time in"
                  value={one.timeIn}
                  onChange={(event) => setActivity(index, { timeIn: event.target.value })}
                  className={FIELD}
                />
                <input
                  type="time"
                  aria-label="Time out"
                  value={one.timeOut}
                  onChange={(event) => setActivity(index, { timeOut: event.target.value })}
                  className={FIELD}
                />
                <input
                  aria-label="What was done"
                  placeholder="What was done"
                  value={one.details}
                  onChange={(event) => setActivity(index, { details: event.target.value })}
                  className={FIELD}
                />
                <input
                  aria-label="Where"
                  placeholder="Where"
                  value={one.location ?? ""}
                  onChange={(event) => setActivity(index, { location: event.target.value || null })}
                  className={FIELD}
                />
                <Button
                  small
                  variant="quiet"
                  aria-label="Take this activity off"
                  disabled={activities.length === 1}
                  onClick={() => setActivities((now) => now.filter((_, at) => at !== index))}
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
            <div>
              <Button small onClick={() => setActivities((now) => [...now, blankActivity()])}>
                <Plus size={14} /> Another activity
              </Button>
            </div>
            {action.at("activities") && <span className="text-xs text-rose-700">{action.at("activities")}</span>}
          </div>
        )}
        <Problem
          message={action.general([
            "kind",
            "day",
            "from",
            "to",
            "place",
            "reason",
            "otType",
            "forPersonId",
            "activities",
            "time",
            "location",
            "type",
            "otherText",
            "persons",
            "action",
          ])}
        />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Sending…" : line ? "Send again" : "File the form"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
