// A seller's one customer list (medrep branch, 25 Nov: it was two, "All my customers" and the
// field's KOLs, hospitals, KBLs, of the same customers): tabs All · Hospitals · KOLs · KBLs ·
// Patients, each card with the sales side (orders, the last one, what it owes) and the field side
// (last and next visit, the best day and time). Patients are never visited: their actions are
// the CRM's (open their page, add an order). The rest as SEFMED's:
// SEFMED's KOLs, Hospitals and KBLs (docs/PLAN.md 22) over the CRM's own customers: For me · Team
// with counts, search by name, city, hospital or code; each card with its code, city, specialty
// or type, best day / time; a tap opens the actions (open, directions, add visit, add order on the
// CRM's own form, last five visits, call history, ask to take it off the list); + adds a customer
// with the CRM's own form. A customer's field page holds the field's profile and its history; the
// customer itself (name, address, licence) stays the CRM's, edited on its own page.

import type { ClientKind, ClientList, ClientPage, ClientTab, FieldProfile, FirmType, VisitPage } from "@2mg/api/mr";
import {
  CATEGORIES,
  CLIENT_KINDS,
  CLIENT_TABS,
  DAYS,
  DAY_WORDS,
  FIRM_TYPES,
  FIRM_WORDS,
  KIND_ONE,
  MEETING_WORDS,
  OBJECTIVE_WORDS,
  TAB_WORDS,
} from "@2mg/api/mr";
import type { CustomerKind, CustomerList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, RefreshCw, Search } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CustomerDialog } from "../customers/dialog";
import { initials } from "../look";
import { manilaToday } from "../team/range";
import { useHqNames } from "../team/hq-name";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { Button, CARD, Dialog, PageState, Problem, peso, useAction } from "../ui";
import { AddVisitsDialog } from "./plan";
import { ActionSheet, Choices, clientLine, clockOf, dayWords, directions, FIELD, Label, MrHead, useMrMe } from "./parts";
import { EmptyState, NoInvoicesArt, NoResults } from "../no-results";

/** The CRM kind a new customer starts as, from the field's tab. */
const NEW_KIND: Record<ClientTab, CustomerKind | undefined> = {
  all: undefined,
  doctor: "doctor",
  hospital: "hospital",
  firm: "drugstore",
  patient: "patient",
};
const isFieldKind = (tab: ClientTab): tab is ClientKind => (CLIENT_KINDS as string[]).includes(tab);

export function MrClientsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mr = useMrMe();
  const unit = useTeamUnit();
  // Whose customer, after their HQ (Aryan's phase 5, PLAN 269).
  const { named } = useHqNames();
  const kind: ClientTab = (CLIENT_TABS as string[]).includes(params.get("kind") ?? "") ? (params.get("kind") as ClientTab) : "all";
  const scope = params.get("scope") ?? (mr.data?.access === "mr" ? "mine" : "team");
  const view = params.get("view");
  const [typed, setTyped] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(typed);
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const query = useQuery({
    queryKey: ["mr", "clients", kind, scope, q, unit],
    queryFn: () => api<ClientList>(withUnit(`/api/mr/clients?${new URLSearchParams({ kind, scope, ...(q ? { q } : {}) })}`, unit)),
    placeholderData: (previous) => previous,
    enabled: view !== "off",
  });
  const [picked, setPicked] = useState<ClientList["rows"][number] | null>(null);
  const [adding, setAdding] = useState(false);
  const [visiting, setVisiting] = useState<{ id: number; kind: ClientKind } | null>(null);
  const [lastFive, setLastFive] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const set = (next: Record<string, string | null>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) if (value === null) out.delete(key); else out.set(key, value);
    setParams(out, { replace: true });
  };
  if (view === "off") return <OffRequests />;
  const data = query.data;
  if (!data) return <PageState query={query} what="the list" />;
  const member = mr.data?.access === "mr" || mr.data?.access === "lead";
  return (
    <div className={`mx-auto flex max-w-screen-2xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead
        title={kind === "all" ? (scope === "mine" ? "All my customers" : "The team's customers") : TAB_WORDS[kind]}
        sub="Their orders and what they owe, their visits and the best time to go"
        actions={
          <>
            <Button small variant="quiet" aria-label="Refresh" onClick={() => void query.refetch()}><RefreshCw size={15} /></Button>
            {/* The sales table (filters by who owes, sorting) stays one tap away. */}
            <Link to="/my/area" className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark">
              Table
            </Link>
            {data.can.add && (
              // Black, as Create New Order (Aryan, 27 Nov).
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors hover:bg-black"
              >
                <Plus size={15} /> Add {isFieldKind(kind) ? KIND_ONE[kind].toLowerCase() : kind === "patient" ? "patient" : "customer"}
              </button>
            )}
          </>
        }
      />
      {/* The tabs in our style on the left, the search filling the rest of the line (Aryan, 27 Nov). */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Which customers" className="flex shrink-0 gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-1 [scrollbar-width:none]">
          {CLIENT_TABS.map((one) => (
            <button
              key={one}
              type="button"
              role="tab"
              aria-selected={kind === one}
              onClick={() => set({ kind: one })}
              className={`rounded-md px-3.5 py-1.5 text-[13px] whitespace-nowrap transition-colors ${
                kind === one ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {TAB_WORDS[one]}
            </button>
          ))}
        </div>
        {/* The bar's own line lights up: darker on hover, and while typing the top search's look: a blue line with a second one
            just outside it (Aryan, 27 Nov); no
            box around the words inside (in-bar, styles.css). */}
        <label className="flex min-w-[16rem] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 transition-colors hover:border-slate-300 focus-within:border-brand focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
          <Search size={16} className="text-slate-400" />
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Search by name, city, hospital name or code" className="in-bar h-10 flex-1 bg-transparent text-sm outline-none" />
        </label>
      </div>
      {member && data.can.team && (
        <div className="flex rounded-full bg-sky-600 p-1">
          {(["mine", "team"] as const).map((one) => (
            <button key={one} type="button" onClick={() => set({ scope: one })} className={`flex-1 rounded-full px-3 py-2 text-sm font-bold ${scope === one ? "bg-white text-sky-800" : "text-white"}`}>
              {one === "mine" ? `FOR ME (${data.counts.mine})` : `TEAM (${data.counts.team})`}
            </button>
          ))}
        </div>
      )}
      {scope === "team" && <TeamSwitch />}
      <div className="text-sm font-medium text-slate-900">All ({data.rows.length}{data.more ? "+" : ""})</div>
      {/* The customers as cards in the order cards' style, four to a row (Aryan, 27 Nov): a black
          initials circle, the name, its code, a solid pill for its kind with its city, the orders
          and what they owe, then under a thin line who visits and when. Pressing one opens the same
          actions as before. */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.rows.map((one) => {
          const kindWord = one.patient ? "Patient" : (one.customerKind || one.kind).replace(/^./, (c) => c.toUpperCase());
          const kindTone = one.patient
            ? "bg-teal-600"
            : one.kind === "hospital"
              ? "bg-[#1d9fda]"
              : one.kind === "doctor"
                ? "bg-indigo-600"
                : one.customerKind === "drugstore"
                  ? "bg-amber-600"
                  : "bg-slate-700";
          const details = [one.category ? `Category ${one.category}` : null, one.specialty, one.detail].filter(Boolean).join(" · ");
          return (
            <li key={one.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setPicked(one)}
                className="flex h-full w-full flex-col rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left shadow-2xs transition-[border-color,box-shadow] hover:border-[#7ccbee] hover:shadow-sm"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[13px] font-bold text-white">
                    {initials(one.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-tight text-slate-900">{one.name}</span>
                    {one.code && <span className="block truncate text-[12.5px] font-medium text-slate-500">{one.code}</span>}
                  </span>
                </span>
                <span className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium text-white ${kindTone}`}>
                    {kindWord}
                  </span>
                  {one.city && (
                    <span className="inline-flex min-w-0 items-center gap-0.5 truncate text-[11.5px] text-slate-500">
                      <MapPin className="size-3 shrink-0 text-slate-400" />
                      <span className="truncate">{one.city}</span>
                    </span>
                  )}
                </span>
                {details && <span className="mt-2 line-clamp-2 text-[12.5px] text-slate-600">{details}</span>}
                <span className="mt-2 text-[12.5px] text-slate-600">
                  <span className="font-semibold text-slate-700">Orders:</span>{" "}
                  {one.orders ? `${one.orders} order${one.orders === 1 ? "" : "s"}` : "no order yet"}
                  {one.lastOrderAt ? ` · last ${dayWords(one.lastOrderAt.slice(0, 10))}` : ""}
                </span>
                {one.owed > 0 && (
                  <span className="mt-1.5 inline-flex w-fit items-center gap-1.5 text-[12px] font-semibold text-amber-800">
                    <span className="size-1.5 rounded-full bg-amber-500" /> Owes {peso(one.owed)}
                  </span>
                )}
                {(!one.patient || one.prefDays.length > 0 || one.prefTime) && (
                  <span className="mt-auto block pt-3">
                    <span className="block border-t border-slate-100 pt-2.5 text-[12px] text-slate-600">
                      {!one.patient && (
                        <span className="block">
                          {one.assignedTo ? `${named(one.assignedTo.id, one.assignedTo.name)} · ` : ""}
                          {one.lastVisit ? `last visit ${dayWords(one.lastVisit)}` : "never visited"}
                          {one.nextVisit ? ` · next ${dayWords(one.nextVisit)}` : ""}
                        </span>
                      )}
                      {(one.prefDays.length > 0 || one.prefTime) && (
                        <span className="mt-0.5 block font-medium text-[#1784b5]">
                          Pref day/time: {[one.prefDays.map((d) => DAY_WORDS[d as keyof typeof DAY_WORDS] ?? d).join(", "), one.prefTime].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {data.rows.length === 0 && (
        <div className={CARD}>
          {q ? (
            <NoResults title={kind === "all" ? "No customers here yet." : `No ${TAB_WORDS[kind]} here yet.`}>
              Check the spelling, or clear the search.
            </NoResults>
          ) : (
            <EmptyState title={kind === "all" ? "No customers here yet." : `No ${TAB_WORDS[kind]} here yet.`}>
              The CRM's customers you look after show here, for the field.
            </EmptyState>
          )}
        </div>
      )}

      {picked && (
        <ActionSheet
          title={picked.name}
          sub={clientLine(picked)}
          onClose={() => setPicked(null)}
          actions={[
            // A patient opens on the CRM's own page (the field has none for them) and is never visited.
            { label: "Open", onPick: () => navigate(picked.patient ? `/customers/${picked.id}` : `/field/clients/${picked.id}`) },
            { label: "Get directions", hidden: picked.patient, onPick: () => window.open(directions(picked), "_blank") },
            { label: "Add visit", hidden: !member || picked.patient, onPick: () => setVisiting({ id: picked.id, kind: picked.kind }) },
            { label: "Add order", hidden: !member, onPick: () => navigate(`/orders/new?customer=${picked.id}`) },
            { label: "View last five visits", hidden: picked.patient, onPick: () => setLastFive(picked.id) },
            { label: "Call history", hidden: picked.patient, onPick: () => navigate(`/field/clients/${picked.id}?view=calls`) },
            {
              label: "Ask to take off the list",
              hidden: picked.patient || mr.data?.access !== "mr" || scope !== "mine",
              danger: true,
              onPick: () => setAsking(picked.id),
            },
          ]}
        />
      )}
      {adding && (
        <AddCustomer
          kind={kind}
          onClose={() => setAdding(false)}
          // A doctor, hospital or firm goes on to its field details; anyone else to the CRM's page.
          onSaved={(id) => navigate(isFieldKind(kind) ? `/field/clients/${id}?profile=1` : `/customers/${id}`)}
        />
      )}
      {visiting && <AddVisitsDialog day={manilaToday()} kind={visiting.kind} preset={[visiting.id]} onClose={() => setVisiting(null)} />}
      {lastFive && <LastFive clientId={lastFive} onClose={() => setLastFive(null)} />}
      {asking && <AskOff clientId={asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

/** The CRM's own Add customer (the same checks as everywhere: one per city, a hospital's papers). */
function AddCustomer({ kind, onClose, onSaved }: { kind: ClientTab; onClose: () => void; onSaved: (id: number) => void }) {
  const crm = useQuery({
    queryKey: ["customers", "field-add", NEW_KIND[kind] ?? "any"],
    // The CRM's list gives the form what it needs (who may set what, the kinds).
    queryFn: () => api<CustomerList>(NEW_KIND[kind] ? `/api/customers?kind=${NEW_KIND[kind]}` : "/api/customers"),
  });
  if (!crm.data)
    return (
      <Dialog title={`Add ${isFieldKind(kind) ? KIND_ONE[kind].toLowerCase() : kind === "patient" ? "patient" : "customer"}`} onClose={onClose}>
        <PageState query={crm} what="the form" />
      </Dialog>
    );
  return <CustomerDialog can={crm.data.can} kinds={crm.data.kinds} kind={NEW_KIND[kind]} onClose={onClose} onSaved={onSaved} onPick={onSaved} />;
}

/** SEFMED's View last five visits. */
function LastFive({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ["mr", "client", clientId], queryFn: () => api<ClientPage>(`/api/mr/clients/${clientId}`) });
  return (
    <Dialog title={query.data?.client.name ?? "Last five visits"} onClose={onClose}>
      {!query.data ? (
        <PageState query={query} what="the visits" />
      ) : query.data.history.length === 0 ? (
        <EmptyState art={<NoInvoicesArt size={72} />} title="Never visited yet.">
          The last five visits to this customer show here.
        </EmptyState>
      ) : (
        <VisitLines rows={query.data.history} />
      )}
    </Dialog>
  );
}

export function VisitLines({ rows }: { rows: VisitPage["history"] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((one) => (
        <li key={one.id} className="rounded-xl border border-slate-200 p-3 text-[13px] leading-relaxed">
          <Link to={`/visits/${one.id}`} className="block hover:text-sky-800">
            <div>Employee name: <b>{one.person}</b></div>
            <div>Visit date: {dayWords(one.day)}</div>
            <div>Check-in time: {one.checkedInAt ? clockOf(one.checkedInAt) : "—"}</div>
            <div>Check-out time: {one.doneAt ? clockOf(one.doneAt) : "—"}</div>
            <div>Call objective: {one.objectives.map((key) => OBJECTIVE_WORDS[key as keyof typeof OBJECTIVE_WORDS] ?? key).join(", ") || "—"}</div>
            <div>Call objective remark: {one.objectiveNote || ""}</div>
            {one.meeting && <div>Meeting: {MEETING_WORDS[one.meeting]}</div>}
            <div>Customer's feedback: {one.feedback || one.notes || ""}</div>
            {one.status !== "done" && one.status !== "planned" && <div className="font-semibold text-rose-700">{one.status === "missed" ? "Missed" : "Skipped"}</div>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** An MR asks their team lead to take a customer off the field's lists (nothing is erased). */
function AskOff({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [why, setWhy] = useState("");
  return (
    <Dialog title="Ask to take this customer off the list" sub="Nothing is erased: the customer, its orders and visits stay in the CRM." onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        <Label text="Why *" error={action.at("why")}>
          <input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} placeholder="Moved away, retired, not our customer…" />
        </Label>
        <Problem message={action.general(["why"])} />
        <Button
          variant="primary"
          disabled={action.busy || !why.trim()}
          onClick={() =>
            action.run(async () => {
              await api(`/api/mr/clients/${clientId}/ask-off`, { body: { why } });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
            })
          }
        >
          Send to my team lead
        </Button>
      </div>
    </Dialog>
  );
}

/** The team lead's off-list requests: take the customer off the field's lists, or keep it. */
function OffRequests() {
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({
    queryKey: ["mr", "off-requests"],
    queryFn: () =>
      api<{ rows: { id: number; code: string | null; name: string; kind: string; city: string | null; why: string; by: string; at: string }[] }>(
        "/api/mr/clients/off-requests",
      ),
  });
  if (!query.data) return <PageState query={query} what="the requests" />;
  const answer = (id: number, remove: boolean) =>
    action.run(async () => {
      await api(`/api/mr/clients/${id}/answer-off`, { body: { remove } });
      await queries.invalidateQueries({ queryKey: ["mr"] });
    });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title="Customers to take off the list" sub={`${query.data.rows.length} waiting · nothing is erased, only taken off the field's lists`} />
      {query.data.rows.map((one) => (
        <div key={one.id} className={`${CARD} flex flex-wrap items-center justify-between gap-3 p-4`}>
          <div className="min-w-0 text-sm">
            <Link to={`/field/clients/${one.id}`} className="font-bold hover:underline">{one.name}</Link>{" "}
            <span className="text-slate-500">{[one.code, one.kind, one.city].filter(Boolean).join(" · ")}</span>
            <div className="text-slate-600">{one.by}: {one.why}</div>
          </div>
          <div className="flex gap-2">
            <Button small variant="primary" disabled={action.busy} onClick={() => answer(one.id, true)}>Take off</Button>
            <Button small disabled={action.busy} onClick={() => answer(one.id, false)}>Keep</Button>
          </div>
        </div>
      ))}
      {query.data.rows.length === 0 && (
        <div className={CARD}>
          <EmptyState title="No requests waiting.">Requests to take a customer off the field's lists show here.</EmptyState>
        </div>
      )}
      <Problem message={action.problem?.message} />
    </div>
  );
}

/** The field's profile of a customer (SEFMED's KOL / hospital / firm fields); the category (the
 *  visit class) only by a team lead. */
function ProfileDialog({ data, onClose }: { data: ClientPage; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const c = data.client;
  const [input, setInput] = useState<FieldProfile>({
    category: c.category,
    dispensing: c.dispensing,
    qualification: c.qualification,
    gender: c.gender,
    hospitalType: c.hospitalType,
    hospitalClass: c.hospitalClass,
    firmType: c.firmType,
    contactPerson: c.contactPerson,
    zone: c.zone,
    prefDays: c.prefDays,
    prefTime: c.prefTime,
    firmId: c.firmId,
    visitsAMonth: c.visitsAMonth,
  });
  const firms = useQuery({
    queryKey: ["mr", "clients", "firm", "pick"],
    queryFn: () => api<ClientList["rows"]>("/api/mr/clients/pick?kind=firm"),
    enabled: c.kind === "doctor",
  });
  const patch = (next: Partial<FieldProfile>) => setInput((all) => ({ ...all, ...next }));
  const text = (key: "qualification" | "contactPerson" | "zone" | "prefTime", label: string, placeholder?: string) => (
    <Label text={label} error={action.at(key)}>
      <input className={FIELD} value={input[key] ?? ""} placeholder={placeholder} onChange={(event) => patch({ [key]: event.target.value } as Partial<FieldProfile>)} />
    </Label>
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    const { category, ...rest } = input;
    const done = await action.run(async () => {
      await api(`/api/mr/clients/${c.id}/profile`, { body: data.can.category ? { ...rest, category } : rest });
    });
    if (done) {
      await queries.invalidateQueries({ queryKey: ["mr"] });
      onClose();
    }
  }
  return (
    <Dialog title={`${c.name}: field details`} sub="The customer's name, address and papers are the CRM's: change them on its own page." onClose={onClose} busy={action.busy} wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {data.can.category && (
          <Label text="Category (visit class)" error={action.at("category")}>
            <Choices options={CATEGORIES.filter((key) => key !== "E").map((key) => ({ key, label: key }))} value={input.category ? [input.category as (typeof CATEGORIES)[number]] : []} onChange={(next) => patch({ category: next[0] ?? null })} />
          </Label>
        )}
        {c.kind === "doctor" && (
          <>
            <Label text="Firm (the pharmacy that serves them)" error={action.at("firmId")}>
              <select className={FIELD} value={input.firmId ?? ""} onChange={(event) => patch({ firmId: Number(event.target.value) || null })}>
                <option value="">—</option>
                {(firms.data ?? []).map((one) => (
                  <option key={one.id} value={one.id}>{one.name}</option>
                ))}
              </select>
            </Label>
            <Label text="Gender">
              <select className={FIELD} value={input.gender ?? ""} onChange={(event) => patch({ gender: (event.target.value || null) as FieldProfile["gender"] })}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Label>
            {text("qualification", "Qualification")}
            <Label text="Dispensing">
              <Choices options={[{ key: "yes", label: "Dispensing" }, { key: "no", label: "Non-dispensing" }]} value={input.dispensing === null ? [] : [input.dispensing ? "yes" : "no"]} onChange={(next) => patch({ dispensing: next[0] ? next[0] === "yes" : null })} />
            </Label>
          </>
        )}
        {c.kind === "hospital" && (
          <>
            <Label text="Category">
              <Choices options={[{ key: "government", label: "Government" }, { key: "private", label: "Private" }]} value={input.hospitalType ? [input.hospitalType] : []} onChange={(next) => patch({ hospitalType: (next[0] ?? null) as FieldProfile["hospitalType"] })} />
            </Label>
            <Label text="Class">
              <Choices options={[{ key: "general", label: "General" }, { key: "specialty", label: "Specialty" }]} value={input.hospitalClass ? [input.hospitalClass] : []} onChange={(next) => patch({ hospitalClass: (next[0] ?? null) as FieldProfile["hospitalClass"] })} />
            </Label>
          </>
        )}
        {c.kind === "firm" && (
          <Label text="Firm type" error={action.at("firmType")}>
            <select className={FIELD} value={input.firmType ?? ""} onChange={(event) => patch({ firmType: (event.target.value || null) as FirmType | null })}>
              <option value="">Pick</option>
              {FIRM_TYPES.map((key) => (
                <option key={key} value={key}>{FIRM_WORDS[key]}</option>
              ))}
            </select>
          </Label>
        )}
        {text("contactPerson", "Contact person")}
        {text("zone", "Zone (region)", "Region III")}
        <Label text="Preferred days">
          <Choices options={DAYS.map((key) => ({ key, label: DAY_WORDS[key] }))} value={input.prefDays as (typeof DAYS)[number][]} onChange={(next) => patch({ prefDays: next })} many />
        </Label>
        {text("prefTime", "Preferred time", "9–11 AM")}
        <Label text="Visits a month" error={action.at("visitsAMonth")}>
          <input type="number" min={0} max={31} className={FIELD} value={input.visitsAMonth ?? ""} onChange={(event) => patch({ visitsAMonth: event.target.value === "" ? null : Number(event.target.value) })} />
        </Label>
        <div className="sm:col-span-2">
          <Problem message={action.general(["category", "firmId", "qualification", "firmType", "contactPerson", "zone", "prefDays", "prefTime", "visitsAMonth"])} />
          <Button type="submit" variant="primary" className="mt-2 w-full" disabled={action.busy}>{action.busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A customer's field page: the CRM's details, the field's profile, last five visits (or all
 *  calls), its orders and what it owes; add a visit or an order. */
/** The field's side of a customer (doctor, hospital, firm), read once and shared by the customer
 *  page's action bar, What's next and field panel. Only for those with the field's pages. */
export function useFieldClient(customerId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["mr", "client", customerId],
    queryFn: () => api<ClientPage>(`/api/mr/clients/${customerId}`),
    enabled,
    retry: false,
  });
}

/** The old field page of a customer: the customer's own page now holds it all (25 Nov: one page
 *  per customer, with what the seller does there). Old links keep working. */
export function MrClientPage() {
  const id = Number(useParams().id);
  const { search } = useLocation();
  return <Navigate replace to={`/customers/${id}${search}`} />;
}

/** The field's side on the customer's page: the best day and time, visits a month and calls, the
 *  pinned place, a doctor's hospital and licence, the last five visits or the call history, and
 *  the off-the-list ask. Field details (?profile=1) opens from the page's More. */
export function FieldPanel({ data }: { data: ClientPage }) {
  const [params, setParams] = useSearchParams();
  const queries = useQueryClient();
  const action = useAction();
  const c = data.client;
  const [showCalls, setShowCalls] = useState(params.get("view") === "calls");
  const calls = useQuery({
    queryKey: ["mr", "client", c.id, "calls"],
    queryFn: () => api<{ rows: VisitPage["history"] }>(`/api/mr/clients/${c.id}/calls`),
    enabled: showCalls,
  });
  const [asking, setAsking] = useState(false);
  const editing = params.get("profile") === "1";
  const closeEditing = () => {
    const next = new URLSearchParams(params);
    next.delete("profile");
    setParams(next, { replace: true });
  };
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} aria-labelledby="field-panel">
      <h2 id="field-panel" className="text-sm font-bold text-slate-900">
        In the field{c.offList ? <span className="font-normal text-slate-500"> · off the field's list</span> : null}
      </h2>
      {c.offAsked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
          <span>{c.offAsked.by} asked to take it off the list: {c.offAsked.why}</span>
          {data.can.answerOff && (
            <span className="flex gap-2">
              <Button small variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/clients/${c.id}/answer-off`, { body: { remove: true } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Take off</Button>
              <Button small disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/clients/${c.id}/answer-off`, { body: { remove: false } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Keep</Button>
            </span>
          )}
        </div>
      )}
      <div className="grid gap-2 text-[13px] sm:grid-cols-2">
        <Info label="Best day / time">{[c.prefDays.map((d) => DAY_WORDS[d as keyof typeof DAY_WORDS] ?? d).join(", "), c.prefTime].filter(Boolean).join(" · ") || "Not set yet"}</Info>
        <Info label="Visits a month">{c.visitsAMonth ?? "—"} · {data.calls} calls in all</Info>
        <Info label="Place">{c.pin ? <a className="text-sky-700 hover:underline" href={directions(c)} target="_blank" rel="noreferrer">Pinned · directions</a> : "Not pinned yet (pinned from a check-in)"}</Info>
        {c.contactPerson && <Info label="Contact person">{c.contactPerson}</Info>}
        {c.kind === "doctor" && <Info label="Hospital / firm">{[c.worksAtName, c.firmName].filter(Boolean).join(" · ") || "—"}</Info>}
        {c.kind === "doctor" && <Info label="Licence · qualification">{[c.licenceNo, c.qualification, c.dispensing === null ? null : c.dispensing ? "Dispensing" : "Non-dispensing"].filter(Boolean).join(" · ") || "—"}</Info>}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-slate-900">{showCalls ? "Call history" : "Last five visits"}</h3>
          <button type="button" onClick={() => setShowCalls(!showCalls)} className="text-xs font-semibold text-sky-700 hover:underline">
            {showCalls ? "Last five visits" : "Call history"}
          </button>
        </div>
        {showCalls ? (calls.data ? <VisitLines rows={calls.data.rows} /> : <PageState query={calls} what="the calls" />) : <VisitLines rows={data.history} />}
        {!showCalls && data.history.length === 0 && (
          <EmptyState art={<NoInvoicesArt size={72} />} title="Never visited yet.">
            The last five visits to this customer show here.
          </EmptyState>
        )}
      </div>
      {data.can.askOff && (
        <button type="button" onClick={() => setAsking(true)} className="self-start text-xs font-semibold text-rose-700 hover:underline">
          Ask to take it off the list
        </button>
      )}
      {editing && data.can.profile && <ProfileDialog data={data} onClose={closeEditing} />}
      {asking && <AskOff clientId={c.id} onClose={() => setAsking(false)} />}
    </section>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase">{label}</div>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}
