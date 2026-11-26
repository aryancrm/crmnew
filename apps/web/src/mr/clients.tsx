// SEFMED's KOLs, Hospitals and KBLs (docs/PLAN.md 22) over the CRM's own customers: For me · Team
// with counts, search by name, city, hospital or code; each card with its code, city, specialty
// or type, best day / time; a tap opens the actions (open, directions, add visit, add order on the
// CRM's own form, last five visits, call history, ask to take it off the list); + adds a customer
// with the CRM's own form. A customer's field page holds the field's profile and its history; the
// customer itself (name, address, licence) stays the CRM's, edited on its own page.

import type { ClientKind, ClientList, ClientPage, FieldProfile, FirmType, VisitPage } from "@2mg/api/mr";
import { CATEGORIES, CLIENT_KINDS, DAYS, DAY_WORDS, FIRM_TYPES, FIRM_WORDS, KIND_ONE, KIND_TABS, MEETING_WORDS, OBJECTIVE_WORDS } from "@2mg/api/mr";
import type { CustomerKind, CustomerList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CustomerDialog } from "../customers/dialog";
import { manilaToday } from "../team/range";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { Button, CARD, Dialog, PageState, Problem, peso, useAction } from "../ui";
import { AddVisitsDialog } from "./plan";
import { ActionSheet, Choices, clientLine, clockOf, dayWords, directions, FIELD, Initial, Label, MrHead, useMrMe } from "./parts";
import { EmptyState, NoInvoicesArt, NoResults } from "../no-results";

/** The CRM kind a new customer starts as, from the field's tab. */
const NEW_KIND: Record<ClientKind, CustomerKind> = { doctor: "doctor", hospital: "hospital", firm: "drugstore" };

export function MrClientsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mr = useMrMe();
  const unit = useTeamUnit();
  const kind = (params.get("kind") as ClientKind) || "doctor";
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
  const [visiting, setVisiting] = useState<number | null>(null);
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
    <div className={`mx-auto flex max-w-4xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead
        title={KIND_TABS[kind]}
        sub="The CRM's customers you look after, for the field"
        actions={
          <>
            <Button small variant="quiet" aria-label="Refresh" onClick={() => void query.refetch()}><RefreshCw size={15} /></Button>
            {data.can.add && (
              <Button small variant="primary" onClick={() => setAdding(true)}><Plus size={15} /> Add {KIND_ONE[kind].toLowerCase()}</Button>
            )}
          </>
        }
      />
      <div className="flex gap-1 overflow-x-auto">
        {CLIENT_KINDS.map((one) => (
          <button key={one} type="button" onClick={() => set({ kind: one })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${kind === one ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>
            {KIND_TABS[one]}
          </button>
        ))}
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
      <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
        <Search size={16} className="text-slate-400" />
        <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Search by name, city, hospital name or code" className="h-10 flex-1 bg-transparent text-sm outline-none" />
      </label>
      <div className="text-sm font-semibold text-sky-800">ALL ({data.rows.length}{data.more ? "+" : ""})</div>
      <ul className="flex flex-col gap-2">
        {data.rows.map((one) => (
          <li key={one.id}>
            <button type="button" onClick={() => setPicked(one)} className={`${CARD} flex w-full items-start gap-3 p-3.5 text-left hover:border-sky-300`}>
              <Initial name={one.name} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900 uppercase">{one.name}</span>
                <span className="block text-xs text-slate-500">{clientLine(one)}</span>
                <span className="block text-xs text-slate-500">
                  {one.assignedTo ? `${one.assignedTo.name} · ` : ""}
                  {one.lastVisit ? `last visit ${dayWords(one.lastVisit)}` : "never visited"}
                  {one.nextVisit ? ` · next ${dayWords(one.nextVisit)}` : ""}
                </span>
                {(one.prefDays.length > 0 || one.prefTime) && (
                  <span className="block text-xs font-semibold text-sky-700">Pref day/time: {[one.prefDays.map((d) => DAY_WORDS[d as keyof typeof DAY_WORDS] ?? d).join(", "), one.prefTime].filter(Boolean).join(" · ")}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data.rows.length === 0 && (
        <div className={CARD}>
          {q ? (
            <NoResults title={<>No {KIND_TABS[kind]} here yet.</>}>Check the spelling, or clear the search.</NoResults>
          ) : (
            <EmptyState title={<>No {KIND_TABS[kind]} here yet.</>}>The CRM's customers you look after show here, for the field.</EmptyState>
          )}
        </div>
      )}

      {picked && (
        <ActionSheet
          title={picked.name}
          sub={clientLine(picked)}
          onClose={() => setPicked(null)}
          actions={[
            { label: "Open", onPick: () => navigate(`/field/clients/${picked.id}`) },
            { label: "Get directions", onPick: () => window.open(directions(picked), "_blank") },
            { label: "Add visit", hidden: !member, onPick: () => setVisiting(picked.id) },
            { label: "Add order", hidden: !member, onPick: () => navigate(`/orders/new?customer=${picked.id}`) },
            { label: "View last five visits", onPick: () => setLastFive(picked.id) },
            { label: "Call history", onPick: () => navigate(`/field/clients/${picked.id}?view=calls`) },
            { label: "Ask to take off the list", hidden: mr.data?.access !== "mr" || scope !== "mine", danger: true, onPick: () => setAsking(picked.id) },
          ]}
        />
      )}
      {adding && <AddCustomer kind={kind} onClose={() => setAdding(false)} onSaved={(id) => navigate(`/field/clients/${id}?profile=1`)} />}
      {visiting && <AddVisitsDialog day={manilaToday()} kind={kind} preset={[visiting]} onClose={() => setVisiting(null)} />}
      {lastFive && <LastFive clientId={lastFive} onClose={() => setLastFive(null)} />}
      {asking && <AskOff clientId={asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

/** The CRM's own Add customer (the same checks as everywhere: one per city, a hospital's papers). */
function AddCustomer({ kind, onClose, onSaved }: { kind: ClientKind; onClose: () => void; onSaved: (id: number) => void }) {
  const crm = useQuery({
    queryKey: ["customers", "field-add", NEW_KIND[kind]],
    // The CRM's list gives the form what it needs (who may set what, the kinds).
    queryFn: () => api<CustomerList>(`/api/customers?kind=${NEW_KIND[kind]}`),
  });
  if (!crm.data)
    return (
      <Dialog title={`Add ${KIND_ONE[kind].toLowerCase()}`} onClose={onClose}>
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
export function MrClientPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({ queryKey: ["mr", "client", id], queryFn: () => api<ClientPage>(`/api/mr/clients/${id}`) });
  const calls = useQuery({
    queryKey: ["mr", "client", id, "calls"],
    queryFn: () => api<{ rows: VisitPage["history"] }>(`/api/mr/clients/${id}/calls`),
    enabled: params.get("view") === "calls",
  });
  const [visiting, setVisiting] = useState(false);
  const [asking, setAsking] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the customer" />;
  const c = data.client;
  const showCalls = params.get("view") === "calls";
  const editing = params.get("profile") === "1";
  const setEditing = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set("profile", "1");
    else next.delete("profile");
    setParams(next, { replace: true });
  };
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <MrHead
        title={c.name}
        sub={`${KIND_ONE[c.kind]} · ${clientLine(c)}${c.offList ? " · off the field's list" : ""}`}
        actions={
          <>
            {data.can.profile && <Button small onClick={() => setEditing(true)}>Field details</Button>}
            {data.can.visit && <Button small variant="primary" onClick={() => setVisiting(true)}>Add visit</Button>}
            {data.can.order && <Button small onClick={() => navigate(`/orders/new?customer=${c.id}`)}>Add order</Button>}
          </>
        }
      />
      {c.offAsked && (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-3 text-sm`}>
          <span>{c.offAsked.by} asked to take it off the list: {c.offAsked.why}</span>
          {data.can.answerOff && (
            <span className="flex gap-2">
              <Button small variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/clients/${c.id}/answer-off`, { body: { remove: true } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Take off</Button>
              <Button small disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/clients/${c.id}/answer-off`, { body: { remove: false } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Keep</Button>
            </span>
          )}
        </div>
      )}
      <section className={`${CARD} grid gap-2 p-4 text-[13px] sm:grid-cols-2`}>
        <Info label="Looked after by">{c.assignedTo?.name ?? "—"}</Info>
        <Info label="Address">{c.address || "—"}{c.city ? `, ${c.city}` : ""}{c.zone ? ` · ${c.zone}` : ""}</Info>
        <Info label="Contact">{[c.contactPerson, c.phone, c.email].filter(Boolean).join(" · ") || "—"}</Info>
        {c.kind === "doctor" && <Info label="Hospital / firm">{[c.worksAtName, c.firmName].filter(Boolean).join(" · ") || "—"}</Info>}
        {c.kind === "doctor" && <Info label="Licence · qualification">{[c.licenceNo, c.qualification, c.dispensing === null ? null : c.dispensing ? "Dispensing" : "Non-dispensing"].filter(Boolean).join(" · ") || "—"}</Info>}
        <Info label="Best day / time">{[c.prefDays.map((d) => DAY_WORDS[d as keyof typeof DAY_WORDS] ?? d).join(", "), c.prefTime].filter(Boolean).join(" · ") || "—"}</Info>
        <Info label="Visits a month">{c.visitsAMonth ?? "—"} · {data.calls} calls in all</Info>
        <Info label="Owes">{data.owed.total ? `${peso(data.owed.total)}${data.owed.overdue ? ` · ${peso(data.owed.overdue)} overdue` : ""}` : "Nothing"}</Info>
        <Info label="Place">{c.pin ? <a className="text-sky-700 hover:underline" href={directions(c)} target="_blank" rel="noreferrer">Pinned · directions</a> : "Not pinned yet (pinned from a check-in)"}</Info>
        <Info label="In the CRM">
          <Link to={`/customers/${c.id}`} className="font-semibold text-sky-700 hover:underline">{c.code ?? "Open"} · the customer's page</Link>
        </Info>
      </section>
      <section className={`${CARD} p-4`}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">{showCalls ? "Call history" : "Last five visits"}</h2>
          <Link to={showCalls ? `/field/clients/${id}` : `/field/clients/${id}?view=calls`} className="text-xs font-semibold text-sky-700">{showCalls ? "Last five" : "Call history"}</Link>
        </div>
        {showCalls ? (calls.data ? <VisitLines rows={calls.data.rows} /> : <PageState query={calls} what="the calls" />) : <VisitLines rows={data.history} />}
        {!showCalls && data.history.length === 0 && (
          <EmptyState art={<NoInvoicesArt size={72} />} title="Never visited yet.">
            The last five visits to this customer show here.
          </EmptyState>
        )}
      </section>
      {data.orders.length > 0 && (
        <section className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold text-slate-900">Orders</h2>
          <ul className="text-[13px]">
            {data.orders.map((one) => (
              <li key={one.id} className="flex justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
                <Link to={`/orders/${one.id}`} className="hover:underline">{one.code ?? `#${one.id}`} · {dayWords(one.on)} · {one.by} · {one.statusWord}</Link>
                <span className={one.status === "cancelled" ? "text-slate-400 line-through" : "font-semibold"}>{peso(one.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.can.askOff && (
        <button type="button" onClick={() => setAsking(true)} className="self-start text-xs font-semibold text-rose-700 hover:underline">
          Ask to take it off the list
        </button>
      )}
      {editing && data.can.profile && <ProfileDialog data={data} onClose={() => setEditing(false)} />}
      {visiting && <AddVisitsDialog day={manilaToday()} kind={c.kind} preset={[c.id]} onClose={() => setVisiting(false)} />}
      {asking && <AskOff clientId={c.id} onClose={() => setAsking(false)} />}
    </div>
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
