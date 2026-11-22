// HR's desk: People (everyone's employee record, HR's Home), one person's page, and New joiner.
// HR adds a joiner into a vacant seat with the login email and password HR made for them and
// hands them over; the system sends nothing. Leaving keeps the record.

import type {
  Classification,
  Company,
  HrPeople,
  HrPerson,
  HrPersonRow,
  HrRecordInput,
  JoinerForm,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  Copy,
  KeyRound,
  Pencil,
  Search,
  UserPlus,
} from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { FIELD } from "../org/dialogs";
import {
  Button,
  CARD,
  Dialog,
  PageHead,
  PageState,
  Problem,
  peso,
  Tabs,
  useAction,
} from "../ui";

const COMPANY: Record<Company, string> = {
  "2mg": "2MG Inc.",
  gpi: "Getmeds Philippines",
};
const CLASS: Record<Classification, string> = {
  probationary: "Probationary",
  regular: "Regular",
  part_time: "Part-time",
  intern: "Intern",
};
const manilaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
    new Date(),
  );
const dayWords = (day: string | null) =>
  day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-PH", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Manila",
      }).format(new Date(iso))
    : "Not yet";
/** Pesos typed on a form → whole centavos; empty stays empty. */
const centavos = (typed: string) => {
  const value = typed.replace(/[₱,\s]/g, "");
  return value === "" ? null : Math.round(Number(value) * 100);
};
const pesosOf = (value: number | null) =>
  value === null ? "" : String(value / 100);
/** A password HR can read out: 10 letters and digits, no look-alikes. */
function makePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => letters[byte % letters.length]).join("");
}

function Label({
  text,
  error,
  children,
}: {
  text: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control comes in as the children.
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{text}</span>
      {children}
      {error && (
        <span className="text-xs font-medium text-rose-700">{error}</span>
      )}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

const STAGE: Record<HrPersonRow["stage"], { word: string; tone: string }> = {
  active: {
    word: "Working",
    tone: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  },
  joining: { word: "Joining", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  left: { word: "Left", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
};
function StagePill({
  stage,
  hireDate,
}: {
  stage: HrPersonRow["stage"];
  hireDate?: string;
}) {
  const one = STAGE[stage];
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${one.tone}`}
    >
      {one.word}
      {stage === "joining" && hireDate ? ` ${dayWords(hireDate)}` : ""}
    </span>
  );
}

type View = "working" | "joining" | "missing" | "left";

// ------------------------------------------------------------------ People (HR's Home)

export function HrPeoplePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View | null) ?? "working";
  const stage = view === "working" ? "" : view;
  const query = useQuery({
    queryKey: ["hr", "people", stage],
    queryFn: () =>
      api<HrPeople>(`/api/hr/people${stage ? `?stage=${stage}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(params.get("new") === "1");
  const data = query.data;
  if (!data) return <PageState query={query} what="people" />;
  const words = q.trim().toLowerCase();
  const rows = data.rows.filter(
    (one) =>
      !words ||
      `${one.name} ${one.employeeCode ?? ""} ${one.position ?? ""} ${one.team ?? ""} ${one.loginId ?? ""}`
        .toLowerCase()
        .includes(words),
  );
  const setView = (next: View) => {
    const out = new URLSearchParams(params);
    if (next === "working") out.delete("view");
    else out.set("view", next);
    setParams(out, { replace: true });
  };

  return (
    <div
      className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}
    >
      <PageHead
        title="People"
        sub={`${data.counts.active} working · 2MG Inc. and Getmeds Philippines`}
        actions={
          data.can.add && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <UserPlus size={16} /> New joiner
            </Button>
          )
        }
      >
        <Tabs<View>
          value={view}
          onChange={setView}
          tabs={[
            { key: "working", label: "Working", count: data.counts.active },
            { key: "joining", label: "Joining", count: data.counts.joining },
            {
              key: "missing",
              label: "Details missing",
              count: data.counts.missing,
            },
            { key: "left", label: "Left", count: data.counts.left },
          ]}
        />
      </PageHead>

      <section className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <label className="relative flex items-center">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 text-slate-400"
            />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Find a name, ID or team"
              className="h-9 w-64 max-w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm"
            />
          </label>
          <span className="text-xs text-slate-500">{rows.length} people</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Person</th>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Signs in with</th>
                <th className="px-3 py-2">Record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((one) => (
                <tr
                  key={one.personId}
                  onClick={() => navigate(`/hr/people/${one.personId}`)}
                  className="cursor-pointer hover:bg-slate-50/70"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/hr/people/${one.personId}`}
                      onClick={(event) => event.stopPropagation()}
                      className="font-semibold text-slate-900 hover:text-emerald-700"
                    >
                      {one.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {one.employeeCode ?? "No ID yet"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-slate-800">
                      {one.position ?? one.roleLabel}
                    </div>
                    <div className="text-xs text-slate-500">
                      {one.team ?? "No seat"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">
                    {COMPANY[one.company]}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {one.stage === "active" ? (
                      <span className="text-slate-700 tabular-nums">
                        {dayWords(one.hireDate)}
                      </span>
                    ) : (
                      <StagePill stage={one.stage} hireDate={one.hireDate} />
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-slate-700">{one.loginId ?? "—"}</div>
                    {one.login === "new" && (
                      <div className="text-xs text-amber-700">
                        Not signed in yet
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {one.missing.length ? (
                      <span
                        className="text-amber-700"
                        title={one.missing.join(", ")}
                      >
                        {one.missing.length} missing
                      </span>
                    ) : (
                      <span className="text-emerald-700">Complete</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-sm text-slate-500"
                  >
                    Nobody here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {adding && data.can.add && (
        <NewJoinerDialog
          onClose={() => {
            setAdding(false);
            if (params.get("new")) {
              const out = new URLSearchParams(params);
              out.delete("new");
              setParams(out, { replace: true });
            }
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ New joiner

function NewJoinerDialog({ onClose }: { onClose: () => void }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const form = useQuery({
    queryKey: ["hr", "joiner-form"],
    queryFn: () => api<JoinerForm>("/api/hr/joiners/form"),
  });
  const [values, setValues] = useState({
    name: "",
    mobile: "",
    company: "2mg" as Company,
    employeeCode: "",
    seatId: "",
    startsOn: manilaToday(),
    classification: "probationary" as Classification,
    position: "",
    salary: "",
    allowance: "",
    loginEmail: "",
    password: "",
  });
  const [added, setAdded] = useState<{
    personId: number;
    loginEmail: string;
  } | null>(null);
  const set = (next: Partial<typeof values>) =>
    setValues((now) => ({ ...now, ...next }));
  const teams = useMemo(() => {
    const byTeam = new Map<string, JoinerForm["seats"]>();
    for (const seat of form.data?.seats ?? [])
      byTeam.set(seat.team, [...(byTeam.get(seat.team) ?? []), seat]);
    return [...byTeam];
  }, [form.data]);
  const seat = form.data?.seats.find((one) => String(one.id) === values.seatId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const made = await api<{ personId: number; loginEmail: string }>(
        "/api/hr/joiners",
        {
          body: {
            ...values,
            seatId: Number(values.seatId) || 0,
            employeeCode: values.employeeCode || null,
            position: values.position || null,
            salary: centavos(values.salary),
            allowance: centavos(values.allowance),
          },
        },
      );
      setAdded(made);
      await queries.invalidateQueries({ queryKey: ["hr"] });
    });
  }

  if (added)
    return (
      <HandOver
        name={values.name}
        loginEmail={added.loginEmail}
        password={values.password}
        onClose={onClose}
        onOpen={() => {
          onClose();
          navigate(`/hr/people/${added.personId}`);
        }}
      />
    );

  const { at } = action;
  return (
    <Dialog
      title="New joiner"
      sub="Their seat, their first day and the login you give them."
      onClose={onClose}
      busy={action.busy}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Section title="Who">
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Full name *" error={at("name")}>
              <input
                value={values.name}
                onChange={(event) => set({ name: event.target.value })}
                className={FIELD}
                placeholder="Juan dela Cruz"
              />
            </Label>
            <Label text="Mobile *" error={at("mobile")}>
              <input
                value={values.mobile}
                onChange={(event) => set({ mobile: event.target.value })}
                className={FIELD}
                inputMode="tel"
                placeholder="0917 555 0101"
              />
            </Label>
          </div>
        </Section>
        <Section title="Job">
          <Label
            text="Seat *"
            error={
              at("seatId") ??
              (form.isError ? "The seats couldn't load." : undefined)
            }
          >
            <select
              value={values.seatId}
              onChange={(event) => set({ seatId: event.target.value })}
              className={FIELD}
            >
              <option value="">
                {form.data && !form.data.seats.length
                  ? "No vacant seat: the Admin makes one first"
                  : "Pick a vacant seat"}
              </option>
              {teams.map(([team, seats]) => (
                <optgroup key={team} label={team}>
                  {seats.map((one) => (
                    <option key={one.id} value={one.id}>
                      {[one.title, one.area].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Label>
          <div className="grid gap-3 sm:grid-cols-3">
            <Label text="First day *" error={at("startsOn")}>
              <input
                type="date"
                value={values.startsOn}
                onChange={(event) => set({ startsOn: event.target.value })}
                className={FIELD}
              />
            </Label>
            <Label text="Company *" error={at("company")}>
              <select
                value={values.company}
                onChange={(event) =>
                  set({ company: event.target.value as Company })
                }
                className={FIELD}
              >
                {Object.entries(COMPANY).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Employed as *" error={at("classification")}>
              <select
                value={values.classification}
                onChange={(event) =>
                  set({ classification: event.target.value as Classification })
                }
                className={FIELD}
              >
                {Object.entries(CLASS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Employee ID" error={at("employeeCode")}>
              <input
                value={values.employeeCode}
                onChange={(event) => set({ employeeCode: event.target.value })}
                className={FIELD}
                placeholder="2MG-0123"
              />
            </Label>
            <Label text="Position" error={at("position")}>
              <input
                value={values.position}
                onChange={(event) => set({ position: event.target.value })}
                className={FIELD}
                placeholder={seat?.title ?? "The seat's title"}
              />
            </Label>
          </div>
        </Section>
        <Section title="Pay (monthly, seen by HR and the CEO)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Salary (₱)" error={at("salary")}>
              <input
                value={values.salary}
                onChange={(event) => set({ salary: event.target.value })}
                className={FIELD}
                inputMode="decimal"
                placeholder="25,000"
              />
            </Label>
            <Label text="Allowance (₱)" error={at("allowance")}>
              <input
                value={values.allowance}
                onChange={(event) => set({ allowance: event.target.value })}
                className={FIELD}
                inputMode="decimal"
                placeholder="3,000"
              />
            </Label>
          </div>
        </Section>
        <Section title="Login you give them">
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Login email *" error={at("loginEmail")}>
              <input
                value={values.loginEmail}
                onChange={(event) => set({ loginEmail: event.target.value })}
                className={FIELD}
                type="email"
                autoComplete="off"
                placeholder="juan@2mginc.com"
              />
            </Label>
            <Label text="One-time password *" error={at("password")}>
              <div className="flex gap-2">
                <input
                  value={values.password}
                  onChange={(event) => set({ password: event.target.value })}
                  className={`${FIELD} min-w-0 flex-1 font-mono`}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
                <Button small onClick={() => set({ password: makePassword() })}>
                  Make one
                </Button>
              </div>
            </Label>
          </div>
        </Section>
        <Problem
          message={action.general([
            "name",
            "mobile",
            "seatId",
            "startsOn",
            "company",
            "classification",
            "employeeCode",
            "position",
            "salary",
            "allowance",
            "loginEmail",
            "password",
          ])}
        />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Adding…" : "Add joiner"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** What HR hands over: the login email and the password HR typed. */
function HandOver({
  name,
  loginEmail,
  password,
  onClose,
  onOpen,
}: {
  name: string;
  loginEmail: string;
  password: string | null;
  onClose: () => void;
  onOpen?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = [
    name,
    `Login email: ${loginEmail}`,
    password ? `Password: ${password}` : null,
    `Open: ${window.location.origin}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Dialog
      title={`${name}'s login`}
      sub="Hand these over to them yourself."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm">
          <dt className="text-slate-500">Login email</dt>
          <dd className="font-semibold text-slate-900 select-all">
            {loginEmail}
          </dd>
          {password && (
            <>
              <dt className="text-slate-500">Password</dt>
              <dd className="font-mono font-semibold tracking-wide text-slate-900 select-all">
                {password}
              </dd>
            </>
          )}
        </dl>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button
            onClick={async () => {
              await navigator.clipboard?.writeText(text).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="primary" onClick={onOpen ?? onClose}>
            {onOpen ? "Open their record" : "Done"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ One person

export function HrPersonPage() {
  const { id } = useParams();
  const me = useMe().data;
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["hr", "person", id],
    queryFn: () => api<HrPerson>(`/api/hr/people/${id}`),
  });
  const [open, setOpen] = useState<"edit" | "login" | "left" | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the record" />;
  const mine = me?.id === data.personId;
  const r = data.record;
  const facts = (rows: [string, ReactNode][]) => (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 px-4 py-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="min-w-0 break-words text-slate-900">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
  const box = (title: string, body: ReactNode, action?: ReactNode) => (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {body}
    </section>
  );
  const shown = (value: string | null) => value ?? null;

  return (
    <div className="flex flex-col gap-4">
      <nav
        aria-label="Where you are"
        className="flex items-center gap-1.5 text-xs text-slate-500"
      >
        <button
          type="button"
          onClick={() =>
            window.history.length > 1 ? navigate(-1) : navigate("/hr/people")
          }
          aria-label="Back"
          className="mr-1 grid size-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:text-emerald-700"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        {!mine && (
          <>
            <Link to="/hr/people" className="hover:text-slate-800">
              People
            </Link>
            <span aria-hidden="true" className="text-slate-300">
              ›
            </span>
          </>
        )}
        <span className="font-medium text-slate-700">
          {mine ? "My record" : data.name}
        </span>
      </nav>
      <PageHead
        title={data.name}
        tags={<StagePill stage={data.stage} hireDate={r.hireDate} />}
        sub={[r.position ?? data.roleLabel, data.seat?.team, COMPANY[r.company]]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {data.can.edit && (
              <Button onClick={() => setOpen("edit")}>
                <Pencil size={15} /> Edit record
              </Button>
            )}
            {data.can.leave && (
              <Button variant="danger" onClick={() => setOpen("left")}>
                Mark as left
              </Button>
            )}
            {data.can.back && <BackAtWork personId={data.personId} />}
          </>
        }
      />
      {data.missing.length > 0 && data.stage !== "left" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Missing on the record: {data.missing.join(", ")}.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {box(
          "Job",
          facts([
            [
              "Seat",
              data.seat ? `${data.seat.title} · ${data.seat.team}` : "No seat",
            ],
            ["Channel", data.seat?.channel ?? null],
            ["Area", data.seat?.area ?? null],
            ["Reports to", data.seat?.boss ?? null],
            ["Employee ID", r.employeeCode],
            ["Employed as", CLASS[r.classification]],
            ["Started", dayWords(r.hireDate)],
            [
              "Regular since",
              r.regularizedOn ? dayWords(r.regularizedOn) : null,
            ],
            ...(data.stage === "left"
              ? ([
                  ["Left", dayWords(r.leftOn)],
                  ["Why", r.leftReason],
                ] as [string, ReactNode][])
              : []),
          ]),
        )}
        {box(
          "Login",
          facts([
            ["Signs in with", data.loginId],
            [
              "Last signed in",
              data.login === "off" ? "Switched off" : when(data.lastSignIn),
            ],
          ]),
          data.can.login && (
            <Button small onClick={() => setOpen("login")}>
              <KeyRound size={14} /> Change login
            </Button>
          ),
        )}
        {box(
          "Contact",
          facts([
            ["Mobile", r.mobile],
            ["Personal email", r.personalEmail],
            ["Birthday", r.birthDate ? dayWords(r.birthDate) : null],
            ["Address", r.address],
            [
              "Emergency",
              r.emergencyName
                ? `${r.emergencyName}${r.emergencyRelation ? ` (${r.emergencyRelation})` : ""}${r.emergencyPhone ? ` · ${r.emergencyPhone}` : ""}`
                : null,
            ],
          ]),
        )}
        {(data.can.edit || mine) &&
          box(
            "Pay and IDs",
            facts([
              [
                "Salary",
                r.salary !== null ? `${peso(r.salary)} a month` : null,
              ],
              [
                "Allowance",
                r.allowance !== null ? `${peso(r.allowance)} a month` : null,
              ],
              [
                "Bank",
                [r.bankName, r.bankAccount].filter(Boolean).join(" · ") || null,
              ],
              ["SSS", shown(r.sss)],
              ["PhilHealth", shown(r.philhealth)],
              ["Pag-IBIG", shown(r.pagibig)],
              ["TIN", shown(r.tin)],
              [
                "Not covered",
                r.payExempt
                  ? (
                      [
                        ["sss", "SSS"],
                        ["philhealth", "PhilHealth"],
                        ["pagibig", "Pag-IBIG"],
                        ["tax", "Tax"],
                      ] as const
                    )
                      .filter(([key]) => r.payExempt?.[key])
                      .map(([, label]) => label)
                      .join(", ") || null
                  : null,
              ],
            ]),
          )}
      </div>
      {data.history.length > 0 &&
        box(
          "Seats held",
          <ul className="divide-y divide-slate-100 text-sm">
            {data.history.map((one) => (
              <li
                key={`${one.title}-${one.from}`}
                className="flex flex-wrap justify-between gap-2 px-4 py-2.5"
              >
                <span className="text-slate-900">
                  {one.title}{" "}
                  <span className="text-slate-500">· {one.team}</span>
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {dayWords(one.from)} – {one.to ? dayWords(one.to) : "now"}
                  {one.why && one.to ? ` · ${one.why}` : ""}
                </span>
              </li>
            ))}
          </ul>,
        )}
      {open === "edit" && (
        <RecordDialog person={data} onClose={() => setOpen(null)} />
      )}
      {open === "login" && (
        <LoginDialog person={data} onClose={() => setOpen(null)} />
      )}
      {open === "left" && (
        <LeftDialog person={data} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ HR's dialogs on a person

const RECORD_TEXT: [keyof HrRecordInput, string, string?][] = [
  ["employeeCode", "Employee ID"],
  ["position", "Position"],
  ["department", "Department"],
  ["mobile", "Mobile", "0917 555 0101"],
  ["personalEmail", "Personal email", "name@gmail.com"],
  ["address", "Address"],
  ["emergencyName", "Emergency contact"],
  ["emergencyRelation", "Their relation", "Mother"],
  ["emergencyPhone", "Emergency mobile"],
  ["bankName", "Bank"],
  ["bankAccount", "Account number"],
  ["sss", "SSS"],
  ["philhealth", "PhilHealth"],
  ["pagibig", "Pag-IBIG"],
  ["tin", "TIN"],
];

function RecordDialog({
  person,
  onClose,
}: {
  person: HrPerson;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const r = person.record;
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      RECORD_TEXT.map(([key]) => [
        key,
        (r[key as keyof typeof r] as string | null) ?? "",
      ]),
    ),
  );
  const [company, setCompany] = useState<Company>(r.company);
  const [classification, setClassification] = useState<Classification>(
    r.classification,
  );
  const [days, setDays] = useState({
    hireDate: r.hireDate,
    regularizedOn: r.regularizedOn ?? "",
    birthDate: r.birthDate ?? "",
  });
  const [pay, setPay] = useState({
    salary: pesosOf(r.salary),
    allowance: pesosOf(r.allowance),
  });
  const [exempt, setExempt] = useState(
    r.payExempt ?? {
      sss: false,
      philhealth: false,
      pagibig: false,
      tax: false,
    },
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: HrRecordInput = {
      company,
      classification,
      hireDate: days.hireDate,
      regularizedOn: days.regularizedOn || null,
      birthDate: days.birthDate || null,
      salary: centavos(pay.salary),
      allowance: centavos(pay.allowance),
      ...(r.payExempt
        ? {
            noSss: exempt.sss,
            noPhilhealth: exempt.philhealth,
            noPagibig: exempt.pagibig,
            noTax: exempt.tax,
          }
        : {}),
    };
    for (const [key] of RECORD_TEXT)
      (body as Record<string, string | null>)[key] = text[key]?.trim() || null;
    const done = await action.run(() =>
      api(`/api/hr/people/${person.personId}`, { method: "PATCH", body }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["hr"] });
      onClose();
    }
  }
  const input = (key: string, label: string, placeholder?: string) => (
    <Label key={key} text={label} error={action.at(key)}>
      <input
        value={text[key] ?? ""}
        onChange={(event) =>
          setText((now) => ({ ...now, [key]: event.target.value }))
        }
        className={FIELD}
        placeholder={placeholder}
      />
    </Label>
  );
  const pick = (from: number, to: number) =>
    RECORD_TEXT.slice(from, to).map(([key, label, placeholder]) =>
      input(key, label, placeholder),
    );

  return (
    <Dialog
      title={`${person.name}'s record`}
      onClose={onClose}
      busy={action.busy}
      wide
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Section title="Job">
          <div className="grid gap-3 sm:grid-cols-3">
            <Label text="Company" error={action.at("company")}>
              <select
                value={company}
                onChange={(event) => setCompany(event.target.value as Company)}
                className={FIELD}
              >
                {Object.entries(COMPANY).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Employed as" error={action.at("classification")}>
              <select
                value={classification}
                onChange={(event) =>
                  setClassification(event.target.value as Classification)
                }
                className={FIELD}
              >
                {Object.entries(CLASS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Label>
            {pick(0, 1)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">{pick(1, 3)}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Hired on" error={action.at("hireDate")}>
              <input
                type="date"
                value={days.hireDate}
                onChange={(event) =>
                  setDays((now) => ({ ...now, hireDate: event.target.value }))
                }
                className={FIELD}
              />
            </Label>
            <Label text="Regular since" error={action.at("regularizedOn")}>
              <input
                type="date"
                value={days.regularizedOn}
                onChange={(event) =>
                  setDays((now) => ({
                    ...now,
                    regularizedOn: event.target.value,
                  }))
                }
                className={FIELD}
              />
            </Label>
          </div>
        </Section>
        <Section title="Contact">
          <div className="grid gap-3 sm:grid-cols-2">
            {pick(3, 5)}
            <Label text="Birthday" error={action.at("birthDate")}>
              <input
                type="date"
                value={days.birthDate}
                onChange={(event) =>
                  setDays((now) => ({ ...now, birthDate: event.target.value }))
                }
                className={FIELD}
              />
            </Label>
            {pick(5, 6)}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">{pick(6, 9)}</div>
        </Section>
        <Section title="Pay and IDs">
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Salary (₱ a month)" error={action.at("salary")}>
              <input
                value={pay.salary}
                onChange={(event) =>
                  setPay((now) => ({ ...now, salary: event.target.value }))
                }
                className={FIELD}
                inputMode="decimal"
              />
            </Label>
            <Label text="Allowance (₱ a month)" error={action.at("allowance")}>
              <input
                value={pay.allowance}
                onChange={(event) =>
                  setPay((now) => ({ ...now, allowance: event.target.value }))
                }
                className={FIELD}
                inputMode="decimal"
              />
            </Label>
            {pick(9, 11)}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">{pick(11, 15)}</div>
          {r.payExempt && (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
              <legend className="mb-1 text-xs font-semibold text-slate-600">
                Not covered on payslips (a foreign national, Pag-IBIG waived)
              </legend>
              {(
                [
                  ["sss", "No SSS"],
                  ["philhealth", "No PhilHealth"],
                  ["pagibig", "No Pag-IBIG"],
                  ["tax", "No withholding tax"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={exempt[key]}
                    onChange={(event) =>
                      setExempt((now) => ({
                        ...now,
                        [key]: event.target.checked,
                      }))
                    }
                    className="size-4 accent-emerald-600"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
        </Section>
        <Problem
          message={action.general([
            "company",
            "classification",
            "hireDate",
            "regularizedOn",
            "birthDate",
            "salary",
            "allowance",
            ...RECORD_TEXT.map(([key]) => key),
          ])}
        />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function LoginDialog({
  person,
  onClose,
}: {
  person: HrPerson;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [email, setEmail] = useState(person.loginId ?? "");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<{
    loginEmail: string;
    password: string | null;
  } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const emailChanged = email.trim().toLowerCase() !== (person.loginId ?? "");
    await action.run(async () => {
      const answer = await api<{ loginEmail: string | null }>(
        `/api/hr/people/${person.personId}/login`,
        {
          body: {
            email: emailChanged ? email : null,
            password: password || null,
          },
        },
      );
      await queries.invalidateQueries({ queryKey: ["hr"] });
      setDone({
        loginEmail: answer.loginEmail ?? email,
        password: password || null,
      });
    });
  }
  if (done)
    return (
      <HandOver
        name={person.name}
        loginEmail={done.loginEmail}
        password={done.password}
        onClose={onClose}
      />
    );
  return (
    <Dialog
      title={`${person.name}'s login`}
      sub="A new password signs them out everywhere and works once: they then choose their own."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Label text="Login email" error={action.at("loginEmail")}>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD}
            type="email"
            autoComplete="off"
          />
        </Label>
        <Label text="New password" error={action.at("password")}>
          <div className="flex gap-2">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${FIELD} min-w-0 flex-1 font-mono`}
              autoComplete="new-password"
              placeholder="Leave empty to keep theirs"
            />
            <Button small onClick={() => setPassword(makePassword())}>
              Make one
            </Button>
          </div>
        </Label>
        <Problem message={action.general(["loginEmail", "password"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Save login"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function LeftDialog({
  person,
  onClose,
}: {
  person: HrPerson;
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [lastDay, setLastDay] = useState(manilaToday());
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/hr/people/${person.personId}/left`, {
        body: { lastDay, reason },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["hr"] });
      onClose();
    }
  }
  return (
    <Dialog
      title={`${person.name} is leaving`}
      sub="Their login stops and their seat falls vacant. The record is kept."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Last day" error={action.at("lastDay")}>
            <input
              type="date"
              value={lastDay}
              max={manilaToday()}
              onChange={(event) => setLastDay(event.target.value)}
              className={FIELD}
            />
          </Label>
          <Label text="Why *" error={action.at("reason")}>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={FIELD}
              placeholder="Resigned"
            />
          </Label>
        </div>
        <Problem message={action.general(["lastDay", "reason"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={action.busy}>
            {action.busy ? "Saving…" : "Mark as left"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Marked as left by mistake, or rehired: their login works again; a seat is given from Teams &
 *  people (they show there as "no seat"). */
function BackAtWork({ personId }: { personId: number }) {
  const action = useAction();
  const queries = useQueryClient();
  async function back() {
    if (
      await action.run(async () => {
        await api(`/api/hr/people/${personId}/back`, { body: {} });
      })
    )
      await queries.invalidateQueries();
  }
  return (
    <>
      <Button onClick={back} disabled={action.busy}>
        {action.busy ? "Saving…" : "Back at work"}
      </Button>
      {action.problem && <span className="text-xs text-rose-700">{action.problem.message}</span>}
    </>
  );
}
