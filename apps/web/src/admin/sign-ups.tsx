// Admin panel > Sign-ups: who asked for an account. Accepting is the confirmation: who they are,
// the seat (so the role), then the email saying they're in.

import type { OrgTree, OrgUnit, Role, SignUpList, SignUpRow, SignUpSent } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MailCheck, MailX, TriangleAlert, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { FIELD, freshJob, JobFields, jobBody } from "../org/dialogs";
import { Button, Dialog, Field, PageHead, PageState, Pill, Problem, Tabs, timeLabel, useAction } from "../ui";

export const SIGN_UPS = ["sign-ups"] as const;
type Status = SignUpRow["status"];

/** The work to start the job form from, by the department they said. The Admin changes it. */
const WORK_OF: Record<string, Role> = {
  sales: "medrep",
  leads: "team_lead",
  heads: "team_lead",
  management: "management",
  finance: "finance",
  dispatch: "dispatch",
  inventory: "inventory",
  online: "online",
  hr: "hr",
  regulatory: "regulatory",
  office: "staff",
};

const OUTLINE = "border border-slate-300 bg-white";

export function AdminSignUps() {
  const query = useQuery({ queryKey: SIGN_UPS, queryFn: () => api<SignUpList>("/api/sign-ups") });
  const queries = useQueryClient();
  const sending = useAction();
  const [status, setStatus] = useState<Status>("pending");
  const [accepting, setAccepting] = useState<SignUpRow | null>(null);
  const [declining, setDeclining] = useState<SignUpRow | null>(null);
  const [sent, setSent] = useState<{ name: string; result: SignUpSent } | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the sign-ups" />;
  const shown = data.rows.filter((row) => row.status === status);
  const count = (which: Status) => data.rows.filter((row) => row.status === which).length;
  const refresh = () =>
    Promise.all([
      queries.invalidateQueries({ queryKey: SIGN_UPS }),
      queries.invalidateQueries({ queryKey: ["org"] }),
    ]);

  async function sendAgain(row: SignUpRow) {
    await sending.run(async () => {
      const result = await api<SignUpSent>(`/api/sign-ups/${row.id}/resend`, { body: {} });
      setSent({ name: row.name, result });
      await refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Sign-ups" sub="Confirm who they are and give their seat. They're emailed when accepted." />
      {data.mailFrom ? (
        <p className="text-xs text-ink-2">Acceptance emails go from {data.mailFrom}.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
          <MailX className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 basis-56">
            <b className="font-semibold">No mailbox is connected, so emails can't be sent.</b> You can still accept, and pass
            the link on yourself.
          </span>
          <Link to="/channels" className="inline-flex min-h-11 items-center font-semibold text-brand-dark hover:underline">
            Connect a mailbox
          </Link>
        </div>
      )}
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { key: "pending", label: "Waiting", count: count("pending") },
          { key: "accepted", label: "Accepted", count: count("accepted") },
          { key: "declined", label: "Declined", count: count("declined") },
        ]}
      />
      <Problem message={sending.problem?.message} />
      {shown.length ? (
        <ul className="flex flex-col gap-3">
          {shown.map((row) => (
            <Request
              key={row.id}
              row={row}
              busy={sending.busy}
              onAccept={() => setAccepting(row)}
              onDecline={() => setDeclining(row)}
              onResend={() => void sendAgain(row)}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-ink-2">
          <UserPlus className="mx-auto mb-2 size-6" aria-hidden="true" />
          {status === "pending"
            ? "No one is waiting. New sign-ups from the sign-in page show here."
            : status === "accepted"
              ? "No one was accepted yet."
              : "No one was declined."}
        </div>
      )}

      {accepting && (
        <AcceptDialog
          row={accepting}
          canEmail={Boolean(data.mailFrom)}
          onClose={() => setAccepting(null)}
          onDone={(result) => {
            setSent({ name: accepting.name, result });
            setAccepting(null);
            void refresh();
          }}
        />
      )}
      {declining && (
        <DeclineDialog
          row={declining}
          onClose={() => {
            setDeclining(null);
            void refresh();
          }}
        />
      )}
      {sent && <SentDialog name={sent.name} sent={sent.result} onClose={() => setSent(null)} />}
    </div>
  );
}

function Request({
  row,
  busy,
  onAccept,
  onDecline,
  onResend,
}: {
  row: SignUpRow;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onResend: () => void;
}) {
  const facts = [
    ["Email", row.email],
    ["Mobile", row.phone],
    ["Department they picked", row.departmentLabel],
    ["Signed up", timeLabel(row.createdAt)],
  ] as const;
  const needsLink = row.account === "waiting" || row.account === "expired";
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold wrap-break-word text-ink">{row.name}</h2>
          {row.account === "ready" && <Pill tone="good">Active</Pill>}
          {row.account === "waiting" && (
            <Pill tone={row.emailedAt ? "info" : "warn"}>{row.emailedAt ? "Emailed, no password yet" : "Not emailed"}</Pill>
          )}
          {row.account === "expired" && <Pill tone="warn">Link expired</Pill>}
          {row.account === "left" && <Pill>Not active</Pill>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {row.status === "pending" && (
            <>
              <Button variant="danger" onClick={onDecline}>
                Decline
              </Button>
              {!row.knownAs && (
                <Button variant="primary" onClick={onAccept}>
                  Review and accept
                </Button>
              )}
            </>
          )}
          {needsLink && (
            <Button className={OUTLINE} disabled={busy} onClick={onResend}>
              {row.emailedAt ? "Send again" : "Send or get link"}
            </Button>
          )}
        </div>
      </div>
      <dl className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-8">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-ink-2">{label}</dt>
            <dd className="text-sm font-medium break-all text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {row.status === "pending" && (row.knownAs || row.sameName) && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {row.knownAs
            ? `${row.knownAs} already has an account with this email. Decline this; give a new password from Teams & people if needed.`
            : `${row.sameName} already has that name. Make sure this isn't someone passing for them, or a second account.`}
        </p>
      )}
      {row.decidedAt && (
        <p className="mt-3 text-xs text-ink-2">
          {row.status === "accepted" ? "Accepted" : "Declined"}
          {row.decidedBy ? ` by ${row.decidedBy}` : ""} · {timeLabel(row.decidedAt)}
          {row.emailedAt ? ` · emailed ${timeLabel(row.emailedAt)}` : ""}
          {row.reason ? ` · ${row.reason}` : ""}
        </p>
      )}
      {needsLink && row.emailProblem && <p className="mt-1 text-xs text-warn">{row.emailProblem}</p>}
    </li>
  );
}

function AcceptDialog(props: { row: SignUpRow; canEmail: boolean; onClose: () => void; onDone: (sent: SignUpSent) => void }) {
  const query = useQuery({ queryKey: ["org"], queryFn: () => api<OrgTree>("/api/org") });
  if (!query.data)
    return (
      <Dialog title={`Accept ${props.row.name}`} onClose={props.onClose}>
        <PageState query={query} what="the teams" />
      </Dialog>
    );
  return <AcceptForm {...props} tree={query.data} />;
}

function AcceptForm({
  row,
  canEmail,
  tree,
  onClose,
  onDone,
}: {
  row: SignUpRow;
  canEmail: boolean;
  tree: OrgTree;
  onClose: () => void;
  onDone: (sent: SignUpSent) => void;
}) {
  const action = useAction();
  const wanted = WORK_OF[row.department] ?? "medrep";
  const [place, setPlace] = useState("");
  const [job, setJob] = useState(() => freshJob(wanted));
  const [employeeCode, setEmployeeCode] = useState("");
  const [startsOn, setStartsOn] = useState(tree.today);
  const [confirmed, setConfirmed] = useState(false);

  // Never a CEO's or an Admin's login this way (the API refuses it too).
  const allowed = { ...tree, modules: tree.modules.filter((one) => one.value !== "ceo" && one.value !== "admin") };
  const vacant = tree.units.flatMap((unit) =>
    unit.seats
      .filter((seat) => !seat.holder && seat.module !== "ceo" && seat.module !== "admin")
      .map((seat) => ({ seat, unit })),
  );
  const unit: OrgUnit | undefined = place.startsWith("unit:")
    ? tree.units.find((one) => `unit:${one.id}` === place)
    : undefined;
  const seat = vacant.find((one) => `seat:${one.seat.id}` === place);

  function pickPlace(value: string) {
    setPlace(value);
    const team = tree.units.find((one) => `unit:${one.id}` === value);
    if (!team) return;
    const lead = (row.department === "leads" || row.department === "heads") && !team.seats.some((one) => one.lead);
    setJob(freshJob(wanted, lead));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const body = {
        confirmed,
        startsOn,
        employeeCode: employeeCode || null,
        ...(seat ? { seatId: seat.seat.id } : { unitId: unit?.id ?? null, ...jobBody(job) }),
      };
      onDone(await api<SignUpSent>(`/api/sign-ups/${row.id}/accept`, { body }));
    });
  }

  return (
    <Dialog
      title={`Accept ${row.name}`}
      sub={`${row.email} · ${row.phone} · picked ${row.departmentLabel}`}
      onClose={onClose}
      busy={action.busy}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Their seat (it decides what they can open)" error={action.at("seatId") ?? action.at("unitId")}>
          {(props) => (
            <select {...props} required value={place} onChange={(event) => pickPlace(event.target.value)} className={FIELD}>
              <option value="">Pick a vacant seat or a team…</option>
              {vacant.length > 0 && (
                <optgroup label="Vacant seats">
                  {vacant.map(({ seat: one, unit: team }) => (
                    <option key={one.id} value={`seat:${one.id}`}>
                      {one.title}
                      {one.area ? ` · ${one.area.name}` : ""} ({team.name}, {one.moduleLabel})
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="A new seat in a team">
                {tree.units.map((team) => (
                  <option key={team.id} value={`unit:${team.id}`}>
                    {team.name}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
        </Field>
        {seat && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-ink">
            They'll work as <b className="font-semibold">{seat.seat.moduleLabel}</b> in {seat.unit.name}, reporting to{" "}
            {seat.seat.boss ?? "nobody above"}.
          </p>
        )}
        {unit && (
          <JobFields tree={allowed} unit={unit} job={job} setJob={(next) => setJob((now) => ({ ...now, ...next }))} at={action.at} />
        )}
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label="Employee ID (optional)" error={action.at("employeeCode")}>
            {(props) => (
              <input {...props} value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} className={FIELD} />
            )}
          </Field>
          <Field label="First day" error={action.at("startsOn")}>
            {(props) => (
              <input {...props} type="date" max={tree.today} value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className={FIELD} />
            )}
          </Field>
        </div>
        <label className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-emerald-600"
          />
          <span>
            I confirmed, in person, by a call or with HR, that <b className="font-semibold">{row.name}</b> works here and{" "}
            <b className="inline-block max-w-full align-bottom font-semibold break-all">{row.email}</b> is their email.
          </span>
        </label>
        <Problem
          message={action.general(["seatId", "unitId", "module", "title", "reportsToSeatId", "areaId", "newArea.name", "employeeCode", "startsOn"])}
        />
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button disabled={action.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy || !confirmed || !place}>
            {action.busy ? "Accepting…" : canEmail ? "Accept and email" : "Accept and get link"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeclineDialog({ row, onClose }: { row: SignUpRow; onClose: () => void }) {
  const action = useAction();
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(`/api/sign-ups/${row.id}/decline`, { body: { reason: reason || null } });
    });
    if (done) onClose();
  }
  return (
    <Dialog title={`Decline ${row.name}`} sub="No account is made and no email is sent." onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Reason (optional, seen by administrators)" error={action.at("reason")}>
          {(props) => <input {...props} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} className={FIELD} />}
        </Field>
        <Problem message={action.general(["reason"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button disabled={action.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={action.busy}>
            {action.busy ? "Declining…" : "Decline"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SentDialog({ name, sent, onClose }: { name: string; sent: SignUpSent; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title={sent.emailed ? `${name} was emailed` : `${name} is accepted, but wasn't emailed`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {sent.emailed ? (
          <p role="status" className="flex items-start gap-2 text-sm text-ink">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
            <span>
              We told <b className="font-semibold break-all">{sent.email}</b> the account is accepted, with a link to set their
              password.
            </span>
          </p>
        ) : (
          <>
            <p role="status" className="rounded-lg bg-warn-tint px-3 py-2.5 text-warn">
              {sent.problem}
            </p>
            <Field label="Send this link to them yourself. It works once, for three days.">
              {(props) => (
                <input {...props} readOnly value={sent.link ?? ""} onFocus={(event) => event.target.select()} className={`${FIELD} font-mono`} />
              )}
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          {sent.link && (
            <Button
              className={OUTLINE}
              onClick={() =>
                navigator.clipboard
                  ?.writeText(sent.link as string)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy link"}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
