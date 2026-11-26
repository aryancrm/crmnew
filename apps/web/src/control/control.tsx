// Bishnoi One's control panel (/control, Aryan 26 Nov 2026): the companies on Bishnoi One, each with
// its own data. Only for the people who run Bishnoi One, on logins of their own (a short ID, their
// password and the code from their phone, every time); no company's people or data are here.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Copy, KeyRound, LogOut, Pause, Pencil, Play, Plus, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../api";
import { QrCode } from "../account/qr";
import { Button, Card, Dialog, Field, PageHead, Pill, Problem, useAction } from "../ui";

type PanelMe = { loginId: string; name: string };
type Company = {
  orgId: string;
  name: string;
  code: string;
  loginDomain: string;
  home: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  createdAt: string;
  running: boolean;
  problem: string | null;
  people: number | null;
  /** Its login ID (its first System admin's): info@2mginc.com. */
  loginId: string | null;
};
type Event = { id: number; at: string; what: string; detail: Record<string, unknown>; by: string | null; company: string | null };

const ME_KEY = ["control-me"];
const COMPANIES_KEY = ["control-companies"];
const EVENTS_KEY = ["control-events"];

const WHAT: Record<string, string> = {
  added: "Added",
  changed: "Changed",
  paused: "Paused",
  resumed: "Resumed",
  admin_password: "New one-time password",
  panel_login_made: "Control panel login made",
  signed_in: "Signed in to the control panel",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

export default function ControlApp() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => api<{ me: PanelMe | null; setup: boolean }>("/api/control/me") });
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-white">
              <ShieldCheck size={18} />
            </span>
            <div className="leading-tight">
              <div className="font-semibold text-slate-900">Bishnoi One</div>
              <div className="text-xs text-slate-500">Control panel</div>
            </div>
          </div>
          {me.data?.me && <SignOut me={me.data.me} />}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {me.isPending ? (
          <div className="h-40 animate-pulse rounded-2xl bg-white" />
        ) : me.isError ? (
          <Problem message="The control panel can't be reached. Try again in a minute." />
        ) : me.data.me ? (
          <Companies />
        ) : me.data.setup ? (
          <Setup />
        ) : (
          <SignIn />
        )}
      </main>
    </div>
  );
}

function SignOut({ me }: { me: PanelMe }) {
  const client = useQueryClient();
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <span className="hidden sm:inline">
        {me.name} <span className="text-slate-400">({me.loginId})</span>
      </span>
      <Button
        small
        onClick={async () => {
          await api("/api/control/logout", { body: {} }).catch(() => undefined);
          client.setQueryData(ME_KEY, { me: null, setup: false });
          client.removeQueries({ queryKey: COMPANIES_KEY });
        }}
      >
        <LogOut size={15} /> Sign out
      </Button>
    </div>
  );
}

function Narrow({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-6">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 mb-5 text-sm text-slate-500">{sub}</p>
        {children}
      </Card>
    </div>
  );
}

function SignIn() {
  const client = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({ loginId: "", password: "", code: "" });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const done = await api<{ me: PanelMe }>("/api/control/login", { body: form });
      client.setQueryData(ME_KEY, { me: done.me, setup: false });
    });
  }
  return (
    <Narrow title="Sign in" sub="Your control panel login, your password, and the code your phone's authenticator app shows now.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Login ID" error={action.at("loginId")}>
          {(props) => <input {...props} className="field" autoComplete="username" value={form.loginId} onChange={set("loginId")} />}
        </Field>
        <Field label="Password" error={action.at("password")}>
          {(props) => <input {...props} className="field" type="password" autoComplete="current-password" value={form.password} onChange={set("password")} />}
        </Field>
        <Field label="Code from your phone" error={action.at("code")}>
          {(props) => (
            <input {...props} className="field tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.code} onChange={set("code")} />
          )}
        </Field>
        <Problem message={action.general(["loginId", "password", "code"])} />
        <Button type="submit" variant="primary" disabled={action.busy}>
          Sign in
        </Button>
      </form>
    </Narrow>
  );
}

function Setup() {
  const client = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({ key: "", loginId: "", name: "", password: "", again: "" });
  const [ticket, setTicket] = useState<{ ticket: string; key: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  async function start(event: FormEvent) {
    event.preventDefault();
    setMismatch(form.password !== form.again);
    if (form.password !== form.again) return;
    await action.run(async () => {
      setTicket(await api("/api/control/setup", { body: { key: form.key, loginId: form.loginId, name: form.name, password: form.password } }));
    });
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!ticket) return;
    await action.run(async () => {
      const done = await api<{ me: PanelMe }>("/api/control/setup/code", { body: { ticket: ticket.ticket, code } });
      client.setQueryData(ME_KEY, { me: done.me, setup: false });
    });
  }

  if (ticket)
    return (
      <Narrow title="Add it to your phone" sub="Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), then type the code it shows.">
        <form onSubmit={finish} className="flex flex-col items-center gap-4">
          <QrCode text={ticket.uri} label="The control panel's code for your authenticator app" />
          <div className="w-full rounded-xl bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
            Or type this key in the app: <span className="font-mono text-slate-800 break-all">{ticket.key}</span>
          </div>
          <div className="w-full">
            <Field label="Code from your phone" error={action.at("code")}>
              {(props) => (
                <input {...props} className="field tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
              )}
            </Field>
          </div>
          <Problem message={action.general(["code"])} />
          <Button type="submit" variant="primary" className="w-full" disabled={action.busy}>
            Finish and sign in
          </Button>
        </form>
      </Narrow>
    );

  return (
    <Narrow
      title="Set up the control panel"
      sub="Nobody can sign in here yet. The setup key is in the server's log (the API's logs on the server). It works once."
    >
      <form onSubmit={start} className="flex flex-col gap-3">
        <Field label="Setup key from the server's log" error={action.at("key")}>
          {(props) => <input {...props} className="field font-mono" autoComplete="off" value={form.key} onChange={set("key")} />}
        </Field>
        <Field label="Your login ID (short, not an email)" error={action.at("loginId")}>
          {(props) => <input {...props} className="field" autoComplete="username" value={form.loginId} onChange={set("loginId")} />}
        </Field>
        <Field label="Your name" error={action.at("name")}>
          {(props) => <input {...props} className="field" value={form.name} onChange={set("name")} />}
        </Field>
        <Field label="Your password (at least 8 characters)" error={action.at("password")}>
          {(props) => <input {...props} className="field" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />}
        </Field>
        <Field label="The password again" error={mismatch ? "The two passwords aren't the same." : undefined}>
          {(props) => <input {...props} className="field" type="password" autoComplete="new-password" value={form.again} onChange={set("again")} />}
        </Field>
        <Problem message={action.general(["key", "loginId", "name", "password"])} />
        <Button type="submit" variant="primary" disabled={action.busy}>
          Next: the phone code
        </Button>
      </form>
    </Narrow>
  );
}

function Companies() {
  const companies = useQuery({ queryKey: COMPANIES_KEY, queryFn: () => api<{ companies: Company[] }>("/api/control/companies") });
  const events = useQuery({ queryKey: EVENTS_KEY, queryFn: () => api<{ events: Event[] }>("/api/control/events") });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [pausing, setPausing] = useState<Company | null>(null);
  const [resetting, setResetting] = useState<Company | null>(null);
  const [given, setGiven] = useState<{ title: string; rows: [string, string][]; note: string } | null>(null);
  const all = companies.data?.companies ?? [];

  return (
    <>
      <PageHead
        title="Companies"
        sub="Each company's people, stock, orders and money are in a database of its own."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add a company
          </Button>
        }
      />
      {companies.isError && <Problem message="The companies didn't load. Try again." />}
      <div className="flex flex-col gap-3">
        {all.map((one) => (
          <Card key={one.orgId} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
                  <Building2 size={18} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{one.name}</span>
                    <Pill>{one.code}</Pill>
                    {one.home && <Pill tone="info">The server's own</Pill>}
                    {one.pausedAt ? <Pill tone="warn">Paused</Pill> : one.running ? <Pill tone="good">Working</Pill> : <Pill tone="bad">Can't be reached</Pill>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-600">
                    <span>
                      Org ID <span className="font-mono font-semibold text-slate-900">{one.orgId}</span>
                    </span>
                    {one.loginId && (
                      <span>
                        Login ID <span className="font-semibold text-slate-900">{one.loginId}</span>
                      </span>
                    )}
                    {one.people !== null && <span>{one.people} people</span>}
                    <span>Added {when(one.createdAt)}</span>
                  </div>
                  {one.pausedAt && (
                    <div className="mt-1 text-[13px] text-amber-700">
                      Paused {when(one.pausedAt)}
                      {one.pausedReason ? `: ${one.pausedReason}` : ""}
                    </div>
                  )}
                  {one.problem && <div className="mt-1 text-[13px] text-bad">{one.problem}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button small onClick={() => setEditing(one)}>
                  <Pencil size={14} /> Change
                </Button>
                {one.loginId && (
                  <Button small onClick={() => setResetting(one)}>
                    <KeyRound size={14} /> New one-time password
                  </Button>
                )}
                {!one.home &&
                  (one.pausedAt ? (
                    <ResumeButton company={one} />
                  ) : (
                    <Button small variant="danger" onClick={() => setPausing(one)}>
                      <Pause size={14} /> Pause
                    </Button>
                  ))}
              </div>
            </div>
          </Card>
        ))}
        {companies.isPending && <div className="h-24 animate-pulse rounded-2xl bg-white" />}
      </div>

      <h2 className="mt-8 mb-2 text-sm font-semibold text-slate-700">What was done here</h2>
      <Card className="divide-y divide-slate-100">
        {(events.data?.events ?? []).slice(0, 30).map((one) => (
          <div key={one.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-[13px]">
            <span className="text-slate-800">
              {WHAT[one.what] ?? one.what}
              {one.company ? `: ${one.company}` : ""}
            </span>
            <span className="text-slate-500">
              {one.by ?? "The server"} · {when(one.at)}
            </span>
          </div>
        ))}
        {events.data && events.data.events.length === 0 && <div className="px-4 py-3 text-[13px] text-slate-500">Nothing yet.</div>}
      </Card>

      {adding && <AddCompany companies={all} onClose={() => setAdding(false)} onDone={(shown) => { setAdding(false); setGiven(shown); }} />}
      {editing && <EditCompany company={editing} onClose={() => setEditing(null)} />}
      {pausing && <PauseCompany company={pausing} onClose={() => setPausing(null)} />}
      {resetting && <NewAdminPassword company={resetting} onClose={() => setResetting(null)} onDone={(shown) => { setResetting(null); setGiven(shown); }} />}
      {given && <Shown {...given} onClose={() => setGiven(null)} />}
    </>
  );
}

function useRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: COMPANIES_KEY });
    void client.invalidateQueries({ queryKey: EVENTS_KEY });
  };
}

type ShownProps = { title: string; rows: [string, string][]; note: string };

function AddCompany({ companies, onClose, onDone }: { companies: Company[]; onClose: () => void; onDone: (shown: ShownProps) => void }) {
  const refresh = useRefresh();
  const action = useAction();
  const [form, setForm] = useState({ name: "", code: "", loginId: "", copyStockFrom: "" });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const made = await api<{ orgId: string; name: string; loginId: string; password: string; stock: { medicines: number; pieces: number } | null }>(
        "/api/control/companies",
        { body: { ...form, copyStockFrom: form.copyStockFrom || null } },
      );
      refresh();
      onDone({
        title: `${made.name} is on Bishnoi One`,
        rows: [
          ["Org ID", made.orgId],
          ["Login ID", made.loginId],
          ["One-time password", made.password],
          ...(made.stock ? ([["Stock copied", `${made.stock.medicines} medicines, ${made.stock.pieces.toLocaleString("en-PH")} pieces`]] as [string, string][]) : []),
        ],
        note: "Give them the login ID and the one-time password now: the password is shown only this once. They choose their own password when they first sign in, then add their people.",
      });
    });
  }
  return (
    <Dialog title="Add a company" sub="It gets its own database: its own people, stock, orders and money." onClose={onClose} busy={action.busy} wide>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Company name" error={action.at("name")}>
          {(props) => <input {...props} className="field" placeholder="GetMeds Philippines Inc." value={form.name} onChange={set("name")} />}
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field label="Short code, for documents" error={action.at("code")}>
            {(props) => <input {...props} className="field uppercase" placeholder="GM" maxLength={8} value={form.code} onChange={set("code")} />}
          </Field>
          <Field label="Login ID (an email on its own domain)" error={action.at("loginId")}>
            {(props) => <input {...props} className="field lowercase" placeholder="info@getmeds.ph" autoComplete="off" value={form.loginId} onChange={set("loginId")} />}
          </Field>
        </div>
        <Field label="Start with" error={action.at("copyStockFrom")}>
          {(props) => (
            <select {...props} className="field" value={form.copyStockFrom} onChange={set("copyStockFrom")}>
              <option value="">Nothing: an empty company</option>
              {companies
                .filter((one) => one.running)
                .map((one) => (
                  <option key={one.orgId} value={one.orgId}>
                    A copy of {one.name}'s medicines, prices and stock
                  </option>
                ))}
            </select>
          )}
        </Field>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
          This login ID opens all the company's apps with a one-time password, shown once; they change it at their first sign-in.
        </div>
        <Problem message={action.general(["name", "code", "loginId", "copyStockFrom"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Making its database…" : "Add the company"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditCompany({ company, onClose }: { company: Company; onClose: () => void }) {
  const refresh = useRefresh();
  const action = useAction();
  const [form, setForm] = useState({ name: company.name, code: company.code, loginId: company.loginId ?? "" });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      await api(`/api/control/companies/${company.orgId}`, { method: "PATCH", body: { ...form, loginId: typed || undefined } });
    });
    if (ok) {
      refresh();
      onClose();
    }
  }
  const typed = form.loginId.trim().toLowerCase();
  const domainChanged = typed.includes("@") && typed.slice(typed.lastIndexOf("@") + 1) !== company.loginDomain;
  return (
    <Dialog title={`Change ${company.name}`} sub={`Org ID ${company.orgId} never changes.`} onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Company name" error={action.at("name")}>
          {(props) => <input {...props} className="field" value={form.name} onChange={set("name")} />}
        </Field>
        <Field label="Short code, for documents" error={action.at("code")}>
          {(props) => <input {...props} className="field uppercase" maxLength={8} value={form.code} onChange={set("code")} />}
        </Field>
        <Field label="Login ID" error={action.at("loginId")}>
          {(props) => <input {...props} className="field lowercase" autoComplete="off" value={form.loginId} onChange={set("loginId")} />}
        </Field>
        {domainChanged && (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            Everyone at {company.name} will sign in with @{typed.slice(typed.lastIndexOf("@") + 1)} instead of @{company.loginDomain}. Tell them first.
          </div>
        )}
        <Problem message={action.general(["name", "code", "loginId"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PauseCompany({ company, onClose }: { company: Company; onClose: () => void }) {
  const refresh = useRefresh();
  const action = useAction();
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      await api(`/api/control/companies/${company.orgId}/pause`, { body: { reason } });
    });
    if (ok) {
      refresh();
      onClose();
    }
  }
  return (
    <Dialog
      title={`Pause ${company.name}?`}
      sub="Nobody of it can sign in or work until it is resumed. Nothing of its data is deleted."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Why (they see this only as 'paused')" error={action.at("reason")}>
          {(props) => <input {...props} className="field" placeholder="Not paid since October" value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <Problem message={action.general(["reason"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="bg-rose-600 hover:bg-rose-700" disabled={action.busy}>
            Pause it
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ResumeButton({ company }: { company: Company }) {
  const refresh = useRefresh();
  const action = useAction();
  return (
    <Button
      small
      disabled={action.busy}
      onClick={() => action.run(async () => {
        await api(`/api/control/companies/${company.orgId}/resume`, { body: {} });
        refresh();
      })}
    >
      <Play size={14} /> Resume
    </Button>
  );
}

function NewAdminPassword({ company, onClose, onDone }: { company: Company; onClose: () => void; onDone: (shown: ShownProps) => void }) {
  const refresh = useRefresh();
  const action = useAction();
  return (
    <Dialog
      title={`A new one-time password for ${company.name}?`}
      sub={`${company.loginId} is signed out everywhere and chooses their own password at the next sign-in. Their phone code, if they use one, stays on.`}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-3">
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                const given = await api<{ loginId: string; password: string }>(`/api/control/companies/${company.orgId}/admin-password`, { body: {} });
                refresh();
                onDone({
                  title: company.name,
                  rows: [
                    ["Login ID", given.loginId],
                    ["One-time password", given.password],
                  ],
                  note: "Shown only this once: give it to them now.",
                });
              })
            }
          >
            Give a new one-time password
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Shown({ title, rows, note, onClose }: ShownProps & { onClose: () => void }) {
  return (
    <Dialog title={title} sub={note} onClose={onClose}>
      <div className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
            <div>
              <div className="text-xs text-slate-500">{label}</div>
              <div className="font-mono text-[15px] font-semibold break-all text-slate-900">{value}</div>
            </div>
            <Button small aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard?.writeText(value)}>
              <Copy size={14} />
            </Button>
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
