// Calls (18 Nov 2026, in place of the B2B team's Google Form): whoever sells logs a call in a few
// taps on their own screen (the customer from the list, or the name as typed; what came of it;
// remarks; when to call next), and their name and channel come from their own login. A lead or
// head sees their team's calls, the CEO, Management and the Admin everyone's, by person and day.

import { TeamSwitch, useTeamUnit } from "../team/switch";
import type { CallList, SalesCallOutcome } from "@2mg/api/types";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { PhoneCall, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { useHqNames } from "../team/hq-name";
import { Button, CARD, PageHead, PageState, Problem, useAction, useOpenOnPress } from "../ui";
import { EmptyState } from "../no-results";

const OUTCOMES: { key: SalesCallOutcome; label: string; tone: string }[] = [
  { key: "reached", label: "Talked", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  { key: "ordered", label: "Ordered", tone: "bg-sky-50 text-sky-800 border-sky-200" },
  { key: "call_back", label: "Call back", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  { key: "no_answer", label: "No answer", tone: "bg-slate-50 text-slate-700 border-slate-200" },
  { key: "not_interested", label: "Not interested", tone: "bg-rose-50 text-rose-800 border-rose-200" },
  { key: "won_back", label: "Won back", tone: "bg-violet-50 text-violet-800 border-violet-200" },
];
const outcomeLabel = (key: string) => OUTCOMES.find((o) => o.key === key)?.label ?? key;
const todayIn = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/** Log a call. On a customer's own page (`customer`) it is that customer's, with no search, and
 *  closes once saved (25 Nov: what a seller does with a customer, on the customer's page). */
export function LogCall({ customer, onSaved }: { customer?: { id: number; name: string }; onSaved?: () => void } = {}) {
  const queries = useQueryClient();
  const action = useAction();
  const [text, setText] = useState(customer?.name ?? "");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(customer ?? null);
  const [outcome, setOutcome] = useState<SalesCallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [nextOn, setNextOn] = useState("");
  const found = useQuery({
    queryKey: ["calls", "customers", text],
    enabled: text.trim().length >= 2 && text !== picked?.name,
    queryFn: () => api<{ rows: { id: number; name: string; kind: string; city?: string | null }[] }>(`/api/customers?q=${encodeURIComponent(text.trim())}`),
  }).data;
  const save = () =>
    void action.run(async () => {
      await api("/api/calls", { body: { customerId: picked?.id ?? null, customerName: picked ? null : text, outcome: outcome ?? "", note: note || null, nextOn: nextOn || null } });
      setText("");
      setPicked(null);
      setOutcome(null);
      setNote("");
      setNextOn("");
      await queries.invalidateQueries({ queryKey: ["calls"] });
      await queries.invalidateQueries({ queryKey: ["sales-performance"] });
      onSaved?.();
    });
  return (
    <section className={customer ? "" : `${CARD} mb-4 p-4`}>
      {!customer && (
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-900">
          <PhoneCall className="size-4 text-brand" /> Log a call
        </h2>
      )}
      <Problem message={action.problem?.message} />
      <div className={customer ? "grid gap-3" : "grid gap-3 lg:grid-cols-[1.2fr_1fr]"}>
        <div className={customer ? "hidden" : "relative"}>
          <label className="text-[12px] font-medium text-slate-500" htmlFor="call-customer">
            Customer
          </label>
          <div className="relative">
            <input
              id="call-customer"
              className="field w-full"
              placeholder="Search the customer, or type a new one's name"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPicked(null);
              }}
            />
            {picked && (
              <button type="button" aria-label="Clear" className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400" onClick={() => { setPicked(null); setText(""); }}>
                <X className="size-4" />
              </button>
            )}
          </div>
          {found && text !== picked?.name && found.rows.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {found.rows.slice(0, 10).map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setPicked({ id: c.id, name: c.name }); setText(c.name); }}>
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 pl-2 text-[11px] text-slate-400">{c.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-slate-400">{picked ? "From the customer list." : text.trim().length >= 2 ? "Not in the list: kept as typed." : ""}</p>
        </div>
        <div>
          <div className="text-[12px] font-medium text-slate-500">What came of it</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => (
              <button key={o.key} type="button" onClick={() => setOutcome(o.key)} className={`rounded-full border px-3 py-1 text-[13px] ${outcome === o.key ? `${o.tone} font-semibold ring-2 ring-brand/30` : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <label className="lg:col-span-1">
          <span className="text-[12px] font-medium text-slate-500">Remarks</span>
          <input className="field w-full" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What they said" />
        </label>
        <div className="flex items-end gap-3">
          <label className="flex-1">
            <span className="text-[12px] font-medium text-slate-500">Call next on</span>
            <input type="date" className="field w-full" min={todayIn()} value={nextOn} onChange={(event) => setNextOn(event.target.value)} />
          </label>
          <Button variant="primary" disabled={action.busy} onClick={save}>
            Save call
          </Button>
        </div>
      </div>
    </section>
  );
}

export function Calls() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const today = todayIn();
  const from = params.get("from") ?? today;
  const to = params.get("to") ?? today;
  const person = params.get("person");
  const unit = useTeamUnit();
  // Each person after their HQ ("TAFT · Marwin Dy"; PLAN 269); a call opens its customer's page,
  // pressed anywhere on it.
  const { named } = useHqNames();
  const open = useOpenOnPress();
  const query = useQuery({
    queryKey: ["calls", from, to, person, unit],
    queryFn: () => api<CallList>(`/api/calls?${new URLSearchParams({ from, to, ...(person ? { person } : {}), ...(unit ? { unit } : {}) })}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const people = [...new Map((data?.perDay ?? []).map((p) => [p.personId, p.person])).entries()];
  const days = [...new Set((data?.perDay ?? []).map((p) => p.day))].sort();
  const many = people.length > 1 || (people.length === 1 && people[0]?.[0] !== me.data?.id);
  const picked = people.find(([id]) => String(id) === person);
  const set = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? out.set(k, v) : out.delete(k);
    setParams(out);
  };
  return (
    <div>
      <PageHead
        // "My calls" only for someone who logs calls themselves: a lead, Management or the CEO
        // reads the team's, also on a day with no call yet (it said "My calls" to them then).
        title={many || !(me.data?.role === "medrep" || me.data?.role === "online") ? "Calls" : "My calls"}
        sub={data ? `${data.rows.length} ${data.rows.length === 1 ? "call" : "calls"} ${from === to ? (from === today ? "today" : `on ${from}`) : `from ${from} to ${to}`}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="field !w-40" value={from} max={to} onChange={(event) => set({ from: event.target.value })} aria-label="From" />
            <span className="text-slate-400">to</span>
            <input type="date" className="field !w-40" value={to} min={from} max={today} onChange={(event) => set({ to: event.target.value })} aria-label="To" />
          </div>
        }
      />
      <div className="mb-4">
        <TeamSwitch />
      </div>
      {data?.can.log && <LogCall />}
      <PageState query={query} what="the calls" />
      {data && many && (
        <section className={`${CARD} mb-4 overflow-x-auto p-0`}>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-head text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Person</th>
                {days.map((d) => (
                  <th key={d} className="px-2 py-2 text-right font-semibold">
                    {d.slice(5)}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {people.map(([id, name]) => {
                const mine = data.perDay.filter((p) => p.personId === id);
                return (
                  <tr key={id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <button type="button" className="font-medium text-slate-900 hover:text-brand" onClick={() => set({ person: person === String(id) ? null : String(id) })}>
                        {named(id, name)}
                      </button>
                    </td>
                    {days.map((d) => (
                      <td key={d} className="px-2 py-2 text-right tabular-nums">
                        {mine.find((p) => p.day === d)?.n ?? ""}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{mine.reduce((s, p) => s + p.n, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {data && (
        <section className={`${CARD} overflow-hidden`}>
          {person && (
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm">
              <span>Showing {picked ? named(picked[0], picked[1]) : "one person"}'s calls</span>
              <Button small onClick={() => set({ person: null })}>
                Everyone
              </Button>
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {data.rows.map((call) => (
              <li
                key={call.id}
                onClick={call.customerId ? open(`/customers/${call.customerId}`) : undefined}
                className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 text-sm ${call.customerId ? "cursor-pointer hover:bg-slate-50" : ""}`}
              >
                <span className="w-24 shrink-0 text-slate-500 tabular-nums">{call.at.slice(from === to ? 11 : 5)}</span>
                <span className="min-w-0 flex-1">
                  {call.customerId ? (
                    <Link to={`/customers/${call.customerId}`} className="font-medium text-slate-900 hover:underline">
                      {call.customer}
                    </Link>
                  ) : (
                    // A name typed in, not in the customer list: no page behind it.
                    <span className="font-medium text-slate-900">{call.customer}</span>
                  )}
                  {many && call.person && <span className="text-slate-500"> · {named(call.personId, call.person)}</span>}
                  {call.note && <span className="block text-slate-600">{call.note}</span>}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-[12px] ${OUTCOMES.find((o) => o.key === call.outcome)?.tone ?? "border-slate-200"}`}>{outcomeLabel(call.outcome)}</span>
                {call.nextOn && <span className="text-[12px] text-slate-500">next {call.nextOn}</span>}
              </li>
            ))}
          </ul>
          {!data.rows.length && (
            <EmptyState title="No calls in these days.">Calls logged show here with what came of them. Try other days.</EmptyState>
          )}
        </section>
      )}
    </div>
  );
}
