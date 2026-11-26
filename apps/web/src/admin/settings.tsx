// The company's details (the Admin and the CEO): what its papers print at the top and the foot.
// Each company on Bishnoi One sees and changes its own alone (Aryan, 26 Nov: "after the separation
// the Admin panel showed 2MG's and GetMeds's both"): its quotations, invoices and HR's papers.

import type { CompanyCode } from "@2mg/api/companies";
import type { CaseMailEvent, CaseMailSettings, CompanyInfo, DeskPasswordState, PointsProgram } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { Button, Field, INPUT, PageHead, PageState, Problem, useAction } from "../ui";

const FIELDS: { key: Exclude<keyof CompanyInfo, "vat">; label: string; wide?: boolean }[] = [
  { key: "name", label: "Company name" },
  { key: "tin", label: "TIN" },
  { key: "address", label: "Address", wide: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "licence", label: "FDA licence (LTO)" },
  { key: "footer", label: "Line at the foot of every page", wide: true },
  { key: "signatory", label: "Signs the quotations" },
  { key: "signatoryTitle", label: "Their title" },
  // Each company its own numbers (26 Nov night): 2MG keeps 2MG-SI-; another company sets its own
  // before its first invoice (none goes out without it).
  { key: "invoiceSeries", label: "Invoice series (printed before each invoice's number)" },
];

export function SettingsPage() {
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{
        company: CompanyInfo;
        companies: Record<CompanyCode, CompanyInfo>;
        points: PointsProgram;
        caseEmails: CaseMailSettings;
        deskPassword: DeskPasswordState;
      }>("/api/settings"),
  });
  if (!query.data) return <PageState query={query} what="the settings" />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead
        title="Company details"
        sub="Your company's name, address, TIN and foot line: on its quotations, invoices and HR's papers."
      />
      <CompanyForm code="2mg" start={query.data.company} />
      <CaseEmails start={query.data.caseEmails} />
      <DeskPassword state={query.data.deskPassword} />
    </div>
  );
}

const CASE_EMAILS: { key: CaseMailEvent; label: string }[] = [
  { key: "enquiry", label: "Thank you for contacting us (a new enquiry)" },
  { key: "quotation", label: "The quotation, its PDF attached (PCSO's three once all are there)" },
  { key: "gl_received", label: "Guarantee letter received" },
  { key: "gl_verified", label: "Guarantee letter verified" },
];

/** A case's own steps emailed to the customer by themselves (Aryan, 26 Nov, as the old CRM): off until
 *  switched on here. The order's steps (confirmed, on the way, delivered, paid) go as before. */
function CaseEmails({ start }: { start: CaseMailSettings }) {
  const [value, setValue] = useState(start);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (await action.run(async () => api("/api/settings/case-emails", { body: value }))) {
      setSaved(true);
      await queries.invalidateQueries({ queryKey: ["settings"] });
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Automatic emails on a case</h2>
      <p className="mt-1 text-[13px] text-slate-500">
        From the mailbox the case talks on, else this company's first one, to a customer whose email is on the case. Once
        each. The order's own steps (confirmed, on the way, delivered, paid) are emailed as before.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={value.enabled} onChange={(event) => setValue({ ...value, enabled: event.target.checked })} />
        Send them
      </label>
      <div className="mt-2 grid gap-1.5 pl-6">
        {CASE_EMAILS.map((one) => (
          <label key={one.key} className={`flex items-center gap-2 text-sm ${value.enabled ? "" : "text-slate-400"}`}>
            <input
              type="checkbox"
              disabled={!value.enabled}
              checked={value.events[one.key]}
              onChange={(event) => setValue({ ...value, events: { ...value.events, [one.key]: event.target.checked } })}
            />
            {one.label}
          </label>
        ))}
      </div>
      <div className="mt-3">
        <Problem message={action.problem?.message} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="primary" small disabled={action.busy}>
          {action.busy ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-[13px] font-medium text-emerald-700">Saved.</span>}
      </div>
    </form>
  );
}

function CompanyForm({ code, start }: { code: CompanyCode; start: CompanyInfo }) {
  const [value, setValue] = useState(start);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (await action.run(async () => api(`/api/settings/company?company=${code}`, { body: value }))) {
      setSaved(true);
      await queries.invalidateQueries({ queryKey: ["settings"] });
    }
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.wide ? "sm:col-span-2" : ""}>
            <Field label={field.label} error={action.at(field.key)}>
              {(props) => (
                <input
                  {...props}
                  className={INPUT}
                  value={value[field.key]}
                  onChange={(event) => setValue({ ...value, [field.key]: event.target.value })}
                />
              )}
            </Field>
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.vat}
            onChange={(event) => setValue({ ...value, vat: event.target.checked })}
          />{" "}
          VAT-registered
        </label>
      </div>
      <div className="mt-3">
        <Problem message={action.general(FIELDS.map((field) => field.key))} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="primary" small disabled={action.busy}>
          {action.busy ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-[13px] font-medium text-emerald-700">Saved.</span>}
      </div>
    </form>
  );
}

/** The desks' common password (Aryan, 19 Nov, back on 27 Nov): it opens Management's, Finance's and
 *  Dispatch's shared screen; each person's own login stays theirs. Typed here, kept only scrambled:
 *  nobody, not even here, can read it back. A new one, or none, signs out every desk screen open. */
function DeskPassword({ state }: { state: DeskPasswordState }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const action = useAction();
  const queries = useQueryClient();
  async function save(value: string | null) {
    setSaved(null);
    setMismatch(value !== null && value !== again);
    if (value !== null && value !== again) return;
    if (await action.run(async () => api("/api/settings/desk-password", { body: { password: value } }))) {
      setPassword("");
      setAgain("");
      setSaved(value === null ? "Desk password taken off." : "Desk password saved.");
      await queries.invalidateQueries({ queryKey: ["settings"] });
    }
  }
  const when = state.savedAt ? new Date(state.savedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save(password);
      }}
      className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-slate-900">Desk password: Management, Finance, Dispatch</h2>
      <p className="mt-1 text-[13px] text-slate-500">
        One password for the three desks' shared screen: on their sign-in page it opens the desk alone. Each person can still
        sign in with their own ID.{" "}
        {state.on ? (
          <span className="font-medium text-emerald-700">
            On{state.savedBy ? `, set by ${state.savedBy}` : ""}
            {when ? ` on ${when}` : ""}.
          </span>
        ) : (
          <span className="font-medium text-slate-700">Off: the desks open with each person's own ID only.</span>
        )}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={state.on ? "New desk password" : "Desk password"}>
          {(props) => (
            <input
              {...props}
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={INPUT}
            />
          )}
        </Field>
        <Field label="Type it again">
          {(props) => (
            <input
              {...props}
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              className={INPUT}
            />
          )}
        </Field>
      </div>
      <label className="mt-2 flex items-center gap-2 text-[13px] text-slate-600">
        <input type="checkbox" checked={shown} onChange={(event) => setShown(event.target.checked)} />
        Show what I type
      </label>
      <div className="mt-3">
        <Problem message={mismatch ? "The two passwords aren't the same." : action.problem?.message} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" small disabled={action.busy || !password}>
          {action.busy ? "Saving…" : "Save"}
        </Button>
        {state.on && (
          <Button small disabled={action.busy} onClick={() => void save(null)}>
            Take it off
          </Button>
        )}
        {saved && <span className="text-[13px] font-medium text-emerald-700">{saved}</span>}
      </div>
    </form>
  );
}

