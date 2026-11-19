// B2B Telesales (docs/PLAN.md 16.4). NBD: calls due, papers missing, first orders this month and
// conversion, accounts ready to hand to CRR (3rd order or day 90) or flagged (no 2nd order by day
// 45). CRR: accounts due to reorder this week, late, down against their 3-month average, stopped
// (win back), and the month's retention. Coach and Mentor: the pipeline per NBD, the accounts per
// CRR, the hand-overs waiting. Every account row has Call (logs the outcome and the next call) and
// New order.

import type { B2bTeam, CrrDay, NbdDay } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileWarning, Phone, PhoneCall, Plus, ShoppingCart, UserCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, PageHead, PageState, Problem, Tabs, useAction } from "../ui";
import { withUnit } from "../team/switch";

type Prospect = NbdDay["prospects"][number];
type Account = CrrDay["accounts"][number];

const OUTCOMES = [
  ["reached", "Reached"],
  ["no_answer", "No answer"],
  ["call_back", "Call back"],
  ["ordered", "Ordered"],
  ["not_interested", "Not interested"],
  ["won_back", "Won back"],
] as const;
const OUTCOME = Object.fromEntries(OUTCOMES) as Record<string, string>;
const STAGE: Record<Prospect["stage"], string> = { prospect: "Not called yet", contacted: "Called", papers: "Papers in", ordered: "First order in" };
const tomorrow = () => new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

const useNbd = () => useQuery({ queryKey: ["b2b", "nbd"], queryFn: () => api<NbdDay>("/api/b2b/nbd") });
const useCrr = () => useQuery({ queryKey: ["b2b", "crr"], queryFn: () => api<CrrDay>("/api/b2b/crr") });

function CallDialog({ customerId, name, onClose }: { customerId: number; name: string; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [outcome, setOutcome] = useState("reached");
  const [note, setNote] = useState("");
  const [nextOn, setNextOn] = useState(tomorrow());
  return (
    <Dialog title={`Call: ${name}`} sub="What came of it, and when to call next" onClose={onClose} busy={action.busy}>
      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setOutcome(key)}
            className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold ring-1 ${outcome === key ? "bg-brand text-white ring-brand" : "text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea className="field mt-3 min-h-20 w-full" placeholder="What they said" value={note} onChange={(event) => setNote(event.target.value)} />
      <label className="mt-3 block text-[12.5px] font-semibold text-slate-600">
        Next call
        <input type="date" className="field h-10 w-full" value={nextOn} onChange={(event) => setNextOn(event.target.value)} />
      </label>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("/api/b2b/calls", { method: "POST", body: { customerId, outcome, note: note || null, nextOn: nextOn || null } });
              await queries.invalidateQueries({ queryKey: ["b2b"] });
              onClose();
            })
          }
        >
          Save the call
        </Button>
      </div>
    </Dialog>
  );
}

function PapersDialog({ prospect, onClose }: { prospect: Prospect; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({
    licenceNo: prospect.licenceNo ?? "",
    licenceExpires: prospect.licenceExpires ?? "",
    permitNo: prospect.permitNo ?? "",
    permitExpires: prospect.permitExpires ?? "",
    tin: prospect.tin ?? "",
  });
  const field = (key: keyof typeof form, label: string, type = "text") => (
    <label className="block text-[12.5px] font-semibold text-slate-600">
      {label}
      <input type={type} className="field h-10 w-full" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
    </label>
  );
  return (
    <Dialog title={`Papers: ${prospect.name}`} sub="FDA licence, business permit and BIR before the first order" onClose={onClose} busy={action.busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("licenceNo", "FDA licence (LTO) number")}
        {field("licenceExpires", "Licence valid until", "date")}
        {field("permitNo", "Business permit number")}
        {field("permitExpires", "Permit valid until", "date")}
        {field("tin", "BIR TIN")}
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("/api/b2b/papers", {
                method: "POST",
                body: {
                  customerId: prospect.customerId,
                  licenceNo: form.licenceNo || null,
                  licenceExpires: form.licenceExpires || null,
                  permitNo: form.permitNo || null,
                  permitExpires: form.permitExpires || null,
                  tin: form.tin || null,
                },
              });
              await queries.invalidateQueries({ queryKey: ["b2b"] });
              onClose();
            })
          }
        >
          Save the papers
        </Button>
      </div>
    </Dialog>
  );
}

function HandOverDialog({ prospect, crrPeople, onClose }: { prospect: Prospect; crrPeople: B2bTeam["crrPeople"]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [crrId, setCrrId] = useState<number | "">(crrPeople[0]?.personId ?? "");
  return (
    <Dialog title={`Hand to CRR: ${prospect.name}`} sub={`${prospect.orders} order${prospect.orders === 1 ? "" : "s"} · NBD ${prospect.nbd ?? ""}`} onClose={onClose} busy={action.busy}>
      <select className="field h-10 w-full" value={crrId} onChange={(event) => setCrrId(event.target.value ? Number(event.target.value) : "")}>
        {crrPeople.map((person) => (
          <option key={person.personId} value={person.personId}>
            {person.name}
          </option>
        ))}
      </select>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !crrId}
          onClick={() =>
            void action.run(async () => {
              await api("/api/b2b/hand-over", { method: "POST", body: { customerId: prospect.customerId, crrId } });
              await queries.invalidateQueries({ queryKey: ["b2b"] });
              onClose();
            })
          }
        >
          Hand it over
        </Button>
      </div>
    </Dialog>
  );
}

function AddProspectDialog({ onClose }: { onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({ kind: "drugstore", name: "", phone: "", city: "" });
  return (
    <Dialog title="Add a prospect" sub="A drugstore, distributor or clinic that does not buy from us yet" onClose={onClose} busy={action.busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-slate-600">
          Kind
          <select className="field h-10 w-full" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            <option value="drugstore">Drugstore</option>
            <option value="distributor">Distributor</option>
            <option value="hospital">Clinic / hospital</option>
          </select>
        </label>
        {(
          [
            ["name", "Business name"],
            ["phone", "Phone"],
            ["city", "City"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block text-[12.5px] font-semibold text-slate-600">
            {label}
            <input className="field h-10 w-full" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
          </label>
        ))}
      </div>
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !form.name.trim()}
          onClick={() =>
            void action.run(async () => {
              await api("/api/b2b/prospects", {
                method: "POST",
                body: { customer: { kind: form.kind, name: form.name, phone: form.phone || null, city: form.city || null } },
              });
              await queries.invalidateQueries({ queryKey: ["b2b"] });
              onClose();
            })
          }
        >
          Add the prospect
        </Button>
      </div>
    </Dialog>
  );
}

function ProspectRow({ prospect, onCall, onPapers }: { prospect: Prospect; onCall: () => void; onPapers: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <Link to={`/customers/${prospect.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
          {prospect.name}
        </Link>
        <span className="block truncate text-[11.5px] text-slate-500">
          {STAGE[prospect.stage]}
          {prospect.lastOutcome ? ` · last call ${OUTCOME[prospect.lastOutcome] ?? prospect.lastOutcome}${prospect.lastCallOn ? ` ${dayLabel(prospect.lastCallOn)}` : ""}` : ""}
          {prospect.missing.length > 0 && prospect.stage !== "ordered" ? ` · missing: ${prospect.missing.join(", ")}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 gap-1.5">
        {prospect.missing.length > 0 && (
          <button type="button" onClick={onPapers} className="rounded-lg px-2 py-1 text-[12px] font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-50">
            Papers
          </button>
        )}
        <button type="button" onClick={onCall} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white">
          <PhoneCall className="size-3" /> Call
        </button>
      </span>
    </li>
  );
}

export function NbdHome() {
  const query = useNbd();
  const [calling, setCalling] = useState<Prospect | null>(null);
  const [papers, setPapers] = useState<Prospect | null>(null);
  const [adding, setAdding] = useState(false);
  const data = query.data;
  if (!data) return null;
  const due = data.prospects.filter((p) => p.callDue);
  const missing = data.prospects.filter((p) => p.missing.length > 0 && p.stage !== "ordered");
  const ready = data.prospects.filter((p) => p.ready || p.flagged);
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["Calls due today", due.length, due.length ? "text-amber-700" : "text-slate-900"],
            ["Papers missing", missing.length, missing.length ? "text-amber-700" : "text-slate-900"],
            ["First orders this month", data.month.firstOrders, "text-slate-900"],
            ["Conversion", data.month.conversion === null ? "—" : `${data.month.conversion}%`, "text-slate-900"],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className={`${CARD} px-4 py-3`}>
            <div className="text-[11px] font-semibold text-slate-500">{label}</div>
            <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}</div>
          </div>
        ))}
      </section>
      <section className={`${CARD} min-w-0`}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <PhoneCall className="size-4 text-slate-500" /> Calls today
          </h3>
          <Button small variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add a prospect
          </Button>
        </header>
        {due.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-slate-500">No call due today.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {due.map((p) => (
              <ProspectRow key={p.customerId} prospect={p} onCall={() => setCalling(p)} onPapers={() => setPapers(p)} />
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} min-w-0`}>
          <h3 className="inline-flex items-center gap-1.5 border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            <FileWarning className="size-4 text-amber-600" /> Papers missing
          </h3>
          {missing.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-slate-500">Every prospect's papers are in.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {missing.map((p) => (
                <li key={p.customerId} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                  <span className="min-w-0 truncate">
                    <b className="text-slate-900">{p.name}</b> <span className="text-slate-500">· {p.missing.join(", ")}</span>
                  </span>
                  <button type="button" onClick={() => setPapers(p)} className="shrink-0 text-[12px] font-semibold text-emerald-700 hover:underline">
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${CARD} min-w-0`}>
          <h3 className="inline-flex items-center gap-1.5 border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            <UserCheck className="size-4 text-emerald-600" /> Ready to hand to CRR
          </h3>
          {ready.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-slate-500">None yet: an account goes to CRR at its 3rd order or 90 days after the first.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ready.map((p) => (
                <li key={p.customerId} className="px-4 py-2 text-[13px]">
                  <b className="text-slate-900">{p.name}</b>{" "}
                  <span className={p.flagged ? "text-rose-700" : "text-emerald-700"}>
                    {p.flagged ? `· no 2nd order by day 45 (day ${p.sinceFirst})` : `· ${p.orders} orders, day ${p.sinceFirst}: ask your coach to hand it over`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {calling && <CallDialog customerId={calling.customerId} name={calling.name} onClose={() => setCalling(null)} />}
      {papers && <PapersDialog prospect={papers} onClose={() => setPapers(null)} />}
      {adding && <AddProspectDialog onClose={() => setAdding(false)} />}
    </>
  );
}

export function ProspectsPage() {
  const query = useNbd();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "handed" ? "handed" : "open";
  const [calling, setCalling] = useState<Prospect | null>(null);
  const [papers, setPapers] = useState<Prospect | null>(null);
  const [adding, setAdding] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="your prospects" />;
  const list = view === "handed" ? data.handedOver : data.prospects;
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead
        title={view === "handed" ? "Handed over" : "Prospects"}
        sub={view === "handed" ? "Accounts you brought in, now with CRR" : "Not called → called → papers in → first order → to CRR at the 3rd order or day 90"}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a prospect
          </Button>
        }
      />
      <Tabs
        tabs={[
          { key: "open" as const, label: "Working", count: data.prospects.length },
          { key: "handed" as const, label: "Handed over", count: data.handedOver.length },
        ]}
        value={view}
        onChange={(key) => setParams(key === "handed" ? { view: "handed" } : {}, { replace: true })}
      />
      <section className={CARD}>
        {list.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-slate-500">{view === "handed" ? "Nothing handed over yet." : "No prospect yet: add the first one."}</p>
        ) : view === "handed" ? (
          <ul className="divide-y divide-slate-100">
            {list.map((p) => (
              <li key={p.customerId} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <Link to={`/customers/${p.customerId}`} className="font-semibold text-slate-900 hover:underline">
                  {p.name}
                </Link>
                <span className="text-slate-500">
                  to {p.crr ?? "CRR"} {p.handedOverOn ? `on ${dayLabel(p.handedOverOn)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((p) => (
              <ProspectRow key={p.customerId} prospect={p} onCall={() => setCalling(p)} onPapers={() => setPapers(p)} />
            ))}
          </ul>
        )}
      </section>
      {calling && <CallDialog customerId={calling.customerId} name={calling.name} onClose={() => setCalling(null)} />}
      {papers && <PapersDialog prospect={papers} onClose={() => setPapers(null)} />}
      {adding && <AddProspectDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

const ACCOUNT_STATE: Record<Account["state"], { word: string; tone: string }> = {
  due: { word: "Due to reorder", tone: "text-sky-700" },
  late: { word: "Late: call today", tone: "text-amber-700" },
  stopped: { word: "Stopped: win back", tone: "text-rose-700" },
  lost: { word: "Lost", tone: "text-slate-500" },
  ok: { word: "On track", tone: "text-emerald-700" },
};

function AccountRow({ account, onCall }: { account: Account; onCall: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <Link to={`/customers/${account.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
          {account.name}
        </Link>
        <span className="block truncate text-[11.5px] text-slate-500">
          <span className={ACCOUNT_STATE[account.state].tone}>{ACCOUNT_STATE[account.state].word}</span> · every {account.usual} days · last{" "}
          {dayLabel(account.lastOrderOn)} ({account.since} days)
          {account.trend === "down" ? ` · 30 days ${shortPeso(account.last30)} vs ${shortPeso(account.avg3)} a month` : ""}
          {account.lastOutcome ? ` · last call ${OUTCOME[account.lastOutcome] ?? account.lastOutcome}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 gap-1.5">
        {account.phone && account.phone.replace(/\D/g, "").length >= 7 && (
          <a href={`tel:${account.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            <Phone className="size-3" />
          </a>
        )}
        <button type="button" onClick={onCall} className="rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
          Log a call
        </button>
        <Link to={`/orders/new?customer=${account.customerId}`} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white">
          <ShoppingCart className="size-3" /> Order
        </Link>
      </span>
    </li>
  );
}

function AccountList({ title, accounts, empty, onCall }: { title: string; accounts: Account[]; empty: string; onCall: (account: Account) => void }) {
  return (
    <section className={`${CARD} min-w-0`}>
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
        {title} <span className="font-normal text-slate-400">· {accounts.length}</span>
      </h3>
      {accounts.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <AccountRow key={account.customerId} account={account} onCall={() => onCall(account)} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function CrrHome() {
  const query = useCrr();
  const [calling, setCalling] = useState<Account | null>(null);
  const data = query.data;
  if (!data) return null;
  const live = data.accounts.filter((a) => a.state !== "lost");
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["Retention this month", data.month.retention === null ? "—" : `${data.month.retention}%`],
            ["Buying more", data.month.up],
            ["Steady", data.month.flat],
            ["Buying less", data.month.down],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className={`${CARD} px-4 py-3`}>
            <div className="text-[11px] font-semibold text-slate-500">{label}</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
          </div>
        ))}
      </section>
      <AccountList title="Late: call today" accounts={live.filter((a) => a.state === "late")} empty="No account is late." onCall={setCalling} />
      <AccountList title="Due to reorder this week" accounts={live.filter((a) => a.state === "due")} empty="No account due this week." onCall={setCalling} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AccountList
          title="Buying less than their 3-month average"
          accounts={live.filter((a) => a.trend === "down" && (a.state === "ok" || a.state === "due"))}
          empty="No account buying less."
          onCall={setCalling}
        />
        <AccountList title="Stopped 90 days: win back" accounts={live.filter((a) => a.state === "stopped")} empty="No account stopped." onCall={setCalling} />
      </div>
      {calling && <CallDialog customerId={calling.customerId} name={calling.name} onClose={() => setCalling(null)} />}
    </>
  );
}

export function AccountsPage() {
  const query = useCrr();
  const [state, setState] = useState<Account["state"] | "all">("all");
  const [calling, setCalling] = useState<Account | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="your accounts" />;
  const shown = data.accounts.filter((a) => state === "all" || a.state === state);
  const count = (key: Account["state"]) => data.accounts.filter((a) => a.state === key).length;
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <PageHead title="Accounts" sub="Every account handed to you, each against its own usual gap between orders" />
      <Tabs
        tabs={[
          { key: "all" as const, label: "All", count: data.accounts.length },
          { key: "late" as const, label: "Late", count: count("late") },
          { key: "due" as const, label: "Due this week", count: count("due") },
          { key: "stopped" as const, label: "Stopped", count: count("stopped") },
          { key: "ok" as const, label: "On track", count: count("ok") },
          { key: "lost" as const, label: "Lost", count: count("lost") },
        ]}
        value={state}
        onChange={setState}
      />
      <AccountList title="Accounts" accounts={shown} empty="No account here." onCall={setCalling} />
      {calling && <CallDialog customerId={calling.customerId} name={calling.name} onClose={() => setCalling(null)} />}
    </div>
  );
}

/** The coach's and the Mentor's B2B team: the pipeline per NBD, the accounts per CRR, hand-overs. */
export function B2bTeamCard({ unit = null }: { unit?: number | null } = {}) {
  // One box of the lead's (a press on the Home's tree): only its people.
  const query = useQuery({
    queryKey: ["b2b", "team", unit ?? ""],
    queryFn: () => api<B2bTeam>(withUnit("/api/b2b/team", unit ? String(unit) : null)),
  });
  const [handing, setHanding] = useState<Prospect | null>(null);
  const data = query.data;
  if (!data || (data.nbd.length === 0 && data.crr.length === 0)) return null;
  return (
    <>
      <section className={`${CARD} min-w-0 overflow-x-auto`}>
        <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">New business (NBD)</h2>
          <span className="text-xs text-slate-500">Prospects to first order to CRR</span>
        </header>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2 sm:px-5">NBD</th>
              <th className="px-3 py-2 text-right">Prospects</th>
              <th className="px-3 py-2 text-right">Calls due</th>
              <th className="px-3 py-2 text-right">Papers missing</th>
              <th className="px-3 py-2 text-right">Calls this month</th>
              <th className="px-4 py-2 text-right">First orders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.nbd.map((row) => (
              <tr key={row.personId}>
                <td className="px-4 py-2.5 font-semibold text-slate-900 sm:px-5">{row.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.open}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${row.callsDue ? "text-amber-700" : ""}`}>{row.callsDue}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.papersMissing}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.callsThisMonth}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{row.firstOrdersThisMonth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={`${CARD} min-w-0 overflow-x-auto`}>
        <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Keeping accounts (CRR)</h2>
          <span className="text-xs text-slate-500">Each account against its own usual gap</span>
        </header>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2 sm:px-5">CRR</th>
              <th className="px-3 py-2 text-right">Accounts</th>
              <th className="px-3 py-2 text-right">Late</th>
              <th className="px-3 py-2 text-right">Buying less</th>
              <th className="px-3 py-2 text-right">Stopped</th>
              <th className="px-4 py-2 text-right">Retention</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.crr.map((row) => (
              <tr key={row.personId}>
                <td className="px-4 py-2.5 font-semibold text-slate-900 sm:px-5">{row.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.accounts}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${row.late ? "text-amber-700" : ""}`}>{row.late}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.down}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${row.stopped ? "text-rose-700" : ""}`}>{row.stopped}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{row.retention === null ? "—" : `${row.retention}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={`${CARD} min-w-0`}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Hand-overs waiting</h2>
        {data.handOvers.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-slate-500">No account ready for CRR (3rd order or day 90) and none flagged.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.handOvers.map((p) => (
              <li key={p.customerId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[13px]">
                <span>
                  <b className="text-slate-900">{p.name}</b> <span className="text-slate-500">· {p.nbd}</span>{" "}
                  <span className={p.flagged ? "text-rose-700" : "text-emerald-700"}>
                    {p.flagged ? `· no 2nd order by day 45` : `· ${p.orders} orders, day ${p.sinceFirst}`}
                  </span>
                </span>
                {data.crrPeople.length > 0 && (
                  <button type="button" onClick={() => setHanding(p)} className="rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white">
                    Hand to CRR
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {handing && <HandOverDialog prospect={handing} crrPeople={data.crrPeople} onClose={() => setHanding(null)} />}
    </>
  );
}

export function B2bTeamPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHead title="B2B team" sub="New business per NBD, accounts per CRR, hand-overs waiting" />
      <B2bTeamCard />
    </div>
  );
}
