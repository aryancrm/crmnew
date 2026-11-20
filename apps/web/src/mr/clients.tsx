// SEFMED's KOLs, Hospitals and KBLs (docs/PLAN.md 22): For me · Team with counts, search by name,
// city, hospital or code; each card with its code, city, specialty or type, best day / time; a tap
// opens the actions (view / edit, get directions, add visit, last five visits, call history, add
// order for a firm, ask to delete); + adds one. A client's page holds its details and history.

import type { ClientInput, ClientKind, ClientList, ClientPage, FirmType, VisitPage } from "@2mg/api/mr";
import { CATEGORIES, CLIENT_KINDS, DAYS, DAY_WORDS, FIRM_TYPES, FIRM_WORDS, KIND_ONE, KIND_TABS, MEETING_WORDS, OBJECTIVE_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, CARD, Dialog, PageState, Problem, peso, useAction } from "../ui";
import { manilaToday } from "../team/range";
import { AddVisitsDialog } from "./plan";
import { ActionSheet, Choices, clientLine, clockOf, dayWords, directions, FIELD, Initial, Label, MrHead, useMrMe } from "./parts";

export function MrClientsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mr = useMrMe();
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
    queryKey: ["mr", "clients", kind, scope, q],
    queryFn: () => api<ClientList>(`/api/mr/clients?${new URLSearchParams({ kind, scope, ...(q ? { q } : {}) })}`),
    placeholderData: (previous) => previous,
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
  if (view === "deletes") return <DeleteRequests />;
  const data = query.data;
  if (!data) return <PageState query={query} what="the list" />;
  const member = mr.data?.access === "mr" || mr.data?.access === "lead";
  return (
    <div className={`mx-auto flex max-w-4xl flex-col gap-3 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <MrHead
        title={KIND_TABS[kind]}
        back="/mr"
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
      {member && (
        <div className="flex rounded-full bg-sky-600 p-1">
          {(["mine", "team"] as const).map((one) => (
            <button key={one} type="button" onClick={() => set({ scope: one })} className={`flex-1 rounded-full px-3 py-2 text-sm font-bold ${scope === one ? "bg-white text-sky-800" : "text-white"}`}>
              {one === "mine" ? `FOR ME (${data.counts.mine})` : `TEAM (${data.counts.team})`}
            </button>
          ))}
        </div>
      )}
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
                  {one.assignedTo ? `${one.assignedTo.name} · ` : "Not assigned · "}
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
      {data.rows.length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>No {KIND_TABS[kind]} here yet.</div>}

      {picked && (
        <ActionSheet
          title={picked.name}
          sub={clientLine(picked)}
          onClose={() => setPicked(null)}
          actions={[
            { label: "View / edit client", onPick: () => navigate(`/mr/clients/${picked.id}`) },
            { label: "Get directions", onPick: () => window.open(directions(picked), "_blank") },
            { label: "Add visit", hidden: !member, onPick: () => setVisiting(picked.id) },
            { label: "View / add order", hidden: !member || kind !== "firm", onPick: () => navigate(`/mr/orders/new?client=${picked.id}`) },
            { label: "View last five visits", onPick: () => setLastFive(picked.id) },
            { label: "Call history", onPick: () => navigate(`/mr/clients/${picked.id}?view=calls`) },
            { label: "Delete client", hidden: !member, danger: true, onPick: () => setAsking(picked.id) },
          ]}
        />
      )}
      {adding && <ClientDialog kind={kind} members={data.members} canAssign={data.can.assign} onClose={() => setAdding(false)} />}
      {visiting && <AddVisitsDialog day={manilaToday()} kind={kind} preset={[visiting]} onClose={() => setVisiting(null)} />}
      {lastFive && <LastFive clientId={lastFive} onClose={() => setLastFive(null)} />}
      {asking && <AskDelete clientId={asking} lead={mr.data?.access === "lead"} onClose={() => setAsking(null)} />}
    </div>
  );
}

/** SEFMED's View last five visits. */
function LastFive({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ["mr", "client", clientId], queryFn: () => api<ClientPage>(`/api/mr/clients/${clientId}`) });
  return (
    <Dialog title={query.data?.client.name ?? "Last five visits"} onClose={onClose}>
      {!query.data ? (
        <PageState query={query} what="the visits" />
      ) : query.data.history.length === 0 ? (
        <p className="text-sm text-slate-500">Never visited yet.</p>
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
          <Link to={`/mr/visits/${one.id}`} className="block hover:text-sky-800">
            <div>Employee name: <b>{one.person}</b></div>
            <div>Visit date: {dayWords(one.day)}</div>
            <div>Check-in time: {one.checkedInAt ? clockOf(one.checkedInAt) : "—"}</div>
            <div>Check-out time: {one.doneAt ? clockOf(one.doneAt) : "—"}</div>
            <div>Call objective: {one.objectives.map((key) => OBJECTIVE_WORDS[key as keyof typeof OBJECTIVE_WORDS] ?? key).join(", ") || "—"}</div>
            <div>Call objective remark: {one.objectiveNote || ""}</div>
            {one.meeting && <div>Meeting: {MEETING_WORDS[one.meeting]}</div>}
            <div>Client's feedback: {one.feedback || ""}</div>
            {one.status !== "done" && <div className="font-semibold text-rose-700">{one.status === "missed" ? "Missed" : "Skipped"}</div>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AskDelete({ clientId, lead, onClose }: { clientId: number; lead: boolean; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [why, setWhy] = useState("");
  return (
    <Dialog title={lead ? "Take this client off the list" : "Ask to delete this client"} sub="Nothing is erased: the client and its visits are kept, off the lists." onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-3">
        {!lead && (
          <Label text="Why *" error={action.at("why")}>
            <input className={FIELD} value={why} onChange={(event) => setWhy(event.target.value)} placeholder="Moved away, duplicate, retired…" />
          </Label>
        )}
        <Problem message={action.general(["why"])} />
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api(lead ? `/api/mr/clients/${clientId}/off` : `/api/mr/clients/${clientId}/ask-delete`, { body: lead ? {} : { why } });
              await queries.invalidateQueries({ queryKey: ["mr"] });
              onClose();
            })
          }
        >
          {lead ? "Take it off" : "Send to my team lead"}
        </Button>
      </div>
    </Dialog>
  );
}

function DeleteRequests() {
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({
    queryKey: ["mr", "delete-requests"],
    queryFn: () => api<{ rows: { id: number; code: string; name: string; kind: ClientKind; city: string | null; why: string; by: string; at: string }[] }>("/api/mr/delete-requests"),
  });
  if (!query.data) return <PageState query={query} what="the delete requests" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title="Client delete requests" back="/mr" sub={`${query.data.rows.length} waiting`} />
      {query.data.rows.map((one) => (
        <div key={one.id} className={`${CARD} flex flex-wrap items-center justify-between gap-3 p-4`}>
          <div className="min-w-0 text-sm">
            <b>{one.name}</b> <span className="text-slate-500">{one.code} · {KIND_ONE[one.kind]} · {one.city}</span>
            <div className="text-slate-600">{one.by}: {one.why}</div>
          </div>
          <div className="flex gap-2">
            <Button small variant="primary" disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/clients/${one.id}/answer-delete`, { body: { remove: true } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Delete</Button>
            <Button small disabled={action.busy} onClick={() => action.run(async () => { await api(`/api/mr/clients/${one.id}/answer-delete`, { body: { remove: false } }); await queries.invalidateQueries({ queryKey: ["mr"] }); })}>Keep</Button>
          </div>
        </div>
      ))}
      {query.data.rows.length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>No requests waiting.</div>}
      <Problem message={action.problem?.message} />
    </div>
  );
}

const emptyInput = (kind: ClientKind): ClientInput => ({ kind, name: "", city: "", prefDays: [] });

/** Add or edit a client (SEFMED's Add / Edit KOL: basic info, address). */
export function ClientDialog({
  kind,
  members,
  canAssign,
  onClose,
  editing,
}: {
  kind: ClientKind;
  members: { id: number; name: string }[];
  canAssign: boolean;
  onClose: () => void;
  editing?: { id: number; input: ClientInput };
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [input, setInput] = useState<ClientInput>(editing?.input ?? emptyInput(kind));
  const hospitals = useQuery({
    queryKey: ["mr", "clients", "hospital", "team", "pick"],
    queryFn: () => api<ClientList>("/api/mr/clients?kind=hospital&scope=team"),
    enabled: kind === "doctor",
  });
  const firms = useQuery({
    queryKey: ["mr", "clients", "firm", "team", "pick"],
    queryFn: () => api<ClientList>("/api/mr/clients?kind=firm&scope=team"),
    enabled: kind === "doctor",
  });
  const patch = (next: Partial<ClientInput>) => setInput((all) => ({ ...all, ...next }));
  const text = (key: keyof ClientInput, label: string, placeholder?: string) => (
    <Label text={label} error={action.at(key)}>
      <input className={FIELD} value={(input[key] as string | null | undefined) ?? ""} placeholder={placeholder} onChange={(event) => patch({ [key]: event.target.value } as Partial<ClientInput>)} />
    </Label>
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(editing ? `/api/mr/clients/${editing.id}` : "/api/mr/clients", { body: input });
    });
    if (done) {
      await queries.invalidateQueries({ queryKey: ["mr"] });
      onClose();
    }
  }
  return (
    <Dialog title={`${editing ? "Edit" : "Add"} ${KIND_ONE[kind].toLowerCase()}`} onClose={onClose} busy={action.busy} wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {text("name", "Name *")}
        {canAssign && (
          <Label text="Assign employee" error={action.at("assignedTo")}>
            <select className={FIELD} value={input.assignedTo ?? ""} onChange={(event) => patch({ assignedTo: Number(event.target.value) || null })}>
              <option value="">Not assigned</option>
              {members.map((one) => (
                <option key={one.id} value={one.id}>{one.name}</option>
              ))}
            </select>
          </Label>
        )}
        {kind === "doctor" && (
          <>
            {text("specialty", "Specialty", "Medical oncology")}
            <Label text="Category">
              <Choices options={CATEGORIES.map((key) => ({ key, label: key }))} value={input.category ? [input.category as (typeof CATEGORIES)[number]] : []} onChange={(next) => patch({ category: next[0] ?? null })} />
            </Label>
            <Label text="Hospital">
              <select className={FIELD} value={input.worksAt ?? ""} onChange={(event) => patch({ worksAt: Number(event.target.value) || null })}>
                <option value="">—</option>
                {(hospitals.data?.rows ?? []).map((one) => (
                  <option key={one.id} value={one.id}>{one.name}</option>
                ))}
              </select>
            </Label>
            <Label text="Firm selection (pharmacy that serves them)">
              <select className={FIELD} value={input.firmId ?? ""} onChange={(event) => patch({ firmId: Number(event.target.value) || null })}>
                <option value="">—</option>
                {(firms.data?.rows ?? []).map((one) => (
                  <option key={one.id} value={one.id}>{one.name}</option>
                ))}
              </select>
            </Label>
            <Label text="Gender">
              <select className={FIELD} value={input.gender ?? ""} onChange={(event) => patch({ gender: (event.target.value || null) as ClientInput["gender"] })}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Label>
            {text("qualification", "Qualification")}
            {text("registrationNo", "Registration no. (PRC)")}
            <Label text="Dispensing">
              <Choices options={[{ key: "yes", label: "Dispensing" }, { key: "no", label: "Non-dispensing" }]} value={input.dispensing === null || input.dispensing === undefined ? [] : [input.dispensing ? "yes" : "no"]} onChange={(next) => patch({ dispensing: next[0] ? next[0] === "yes" : null })} />
            </Label>
          </>
        )}
        {kind === "hospital" && (
          <>
            <Label text="Category">
              <Choices options={[{ key: "government", label: "Government" }, { key: "private", label: "Private" }]} value={input.hospitalType ? [input.hospitalType] : []} onChange={(next) => patch({ hospitalType: (next[0] ?? null) as ClientInput["hospitalType"] })} />
            </Label>
            <Label text="Class">
              <Choices options={[{ key: "general", label: "General" }, { key: "specialty", label: "Specialty" }]} value={input.hospitalClass ? [input.hospitalClass] : []} onChange={(next) => patch({ hospitalClass: (next[0] ?? null) as ClientInput["hospitalClass"] })} />
            </Label>
          </>
        )}
        {kind === "firm" && (
          <Label text="Firm type *" error={action.at("firmType")}>
            <select className={FIELD} value={input.firmType ?? ""} onChange={(event) => patch({ firmType: (event.target.value || null) as FirmType | null })}>
              <option value="">Pick</option>
              {FIRM_TYPES.map((key) => (
                <option key={key} value={key}>{FIRM_WORDS[key]}</option>
              ))}
            </select>
          </Label>
        )}
        {text("contactPerson", "Contact person")}
        {text("phone", "Contact no.")}
        {text("email", "Email")}
        {text("address", "Address")}
        {text("city", "City *", "Angeles City")}
        {text("zone", "Zone (region)", "Region III")}
        <Label text="Preferred days">
          <Choices options={DAYS.map((key) => ({ key, label: DAY_WORDS[key] }))} value={(input.prefDays ?? []) as (typeof DAYS)[number][]} onChange={(next) => patch({ prefDays: next })} many />
        </Label>
        {text("prefTime", "Preferred time", "9–11 AM")}
        <Label text="Visits a month" error={action.at("visitsAMonth")}>
          <input type="number" min={0} max={31} className={FIELD} value={input.visitsAMonth ?? ""} onChange={(event) => patch({ visitsAMonth: event.target.value === "" ? null : Number(event.target.value) })} />
        </Label>
        {text("note", "Note")}
        <div className="sm:col-span-2">
          <Problem message={action.general(["name", "assignedTo", "specialty", "category", "qualification", "registrationNo", "firmType", "contactPerson", "phone", "email", "address", "city", "zone", "prefTime", "visitsAMonth", "note"])} />
          <Button type="submit" variant="primary" className="mt-2 w-full" disabled={action.busy}>{action.busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A client's page: its details, last five visits (or all calls), orders booked; edit. */
export function MrClientPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["mr", "client", id], queryFn: () => api<ClientPage>(`/api/mr/clients/${id}`) });
  const calls = useQuery({
    queryKey: ["mr", "client", id, "calls"],
    queryFn: () => api<{ rows: VisitPage["history"] }>(`/api/mr/clients/${id}/calls`),
    enabled: params.get("view") === "calls",
  });
  const members = useQuery({ queryKey: ["mr", "clients", "members"], queryFn: () => api<ClientList>("/api/mr/clients?kind=doctor&scope=team"), enabled: Boolean(query.data?.can.assign) });
  const [editing, setEditing] = useState(false);
  const [visiting, setVisiting] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the client" />;
  const c = data.client;
  const showCalls = params.get("view") === "calls";
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <MrHead
        title={c.name}
        back={`/mr/clients?kind=${c.kind}`}
        sub={`${KIND_ONE[c.kind]} · ${clientLine(c)}${c.active ? "" : " · off the list"}`}
        actions={
          <>
            {data.can.edit && <Button small onClick={() => setEditing(true)}>Edit</Button>}
            {data.can.visit && <Button small variant="primary" onClick={() => setVisiting(true)}>Add visit</Button>}
            {data.can.order && <Button small onClick={() => navigate(`/mr/orders/new?client=${c.id}`)}>Add order</Button>}
          </>
        }
      />
      <section className={`${CARD} grid gap-2 p-4 text-[13px] sm:grid-cols-2`}>
        <Info label="Assigned to">{c.assignedTo?.name ?? "Not assigned"}</Info>
        <Info label="Address">{c.address || "—"}{c.city ? `, ${c.city}` : ""}{c.zone ? ` · ${c.zone}` : ""}</Info>
        <Info label="Contact">{[c.contactPerson, c.phone, c.email].filter(Boolean).join(" · ") || "—"}</Info>
        {c.kind === "doctor" && <Info label="Hospital / firm">{[c.worksAtName, c.firmName].filter(Boolean).join(" · ") || "—"}</Info>}
        {c.kind === "doctor" && <Info label="Registration · qualification">{[c.registrationNo, c.qualification, c.dispensing === null ? null : c.dispensing ? "Dispensing" : "Non-dispensing"].filter(Boolean).join(" · ") || "—"}</Info>}
        <Info label="Best day / time">{[c.prefDays.join(", "), c.prefTime].filter(Boolean).join(" · ") || "—"}</Info>
        <Info label="Visits a month">{c.visitsAMonth ?? "—"} · {data.calls} calls in all</Info>
        <Info label="Added">{c.addedBy} · {dayWords(c.addedAt.slice(0, 10))}</Info>
        <Info label="Place">{c.pin ? <a className="text-sky-700 hover:underline" href={directions(c)} target="_blank" rel="noreferrer">Pinned · directions</a> : "Not pinned yet (pinned from a check-in)"}</Info>
      </section>
      <section className={`${CARD} p-4`}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">{showCalls ? "Call history" : "Last five visits"}</h2>
          <Link to={showCalls ? `/mr/clients/${id}` : `/mr/clients/${id}?view=calls`} className="text-xs font-semibold text-sky-700">{showCalls ? "Last five" : "Call history"}</Link>
        </div>
        {showCalls ? (calls.data ? <VisitLines rows={calls.data.rows} /> : <PageState query={calls} what="the calls" />) : <VisitLines rows={data.history} />}
        {!showCalls && data.history.length === 0 && <p className="text-sm text-slate-500">Never visited yet.</p>}
      </section>
      {data.orders.length > 0 && (
        <section className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold text-slate-900">Orders booked</h2>
          <ul className="text-[13px]">
            {data.orders.map((one) => (
              <li key={one.id} className="flex justify-between border-b border-slate-100 py-1.5 last:border-0">
                <span>{one.code} · {dayWords(one.madeAt.slice(0, 10))} · {one.person.name}</span>
                <span className={one.status === "cancelled" ? "text-slate-400 line-through" : "font-semibold"}>{peso(one.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing && (
        <ClientDialog
          kind={c.kind}
          members={members.data?.members ?? []}
          canAssign={data.can.assign}
          onClose={() => setEditing(false)}
          editing={{
            id: c.id,
            input: {
              kind: c.kind, name: c.name, specialty: c.specialty, category: c.category, dispensing: c.dispensing, qualification: c.qualification,
              registrationNo: c.registrationNo, gender: c.gender, hospitalType: c.hospitalType, hospitalClass: c.hospitalClass, firmType: c.firmType,
              contactPerson: c.contactPerson, phone: c.phone, email: c.email, address: c.address, city: c.city, zone: c.zone, prefDays: c.prefDays,
              prefTime: c.prefTime, worksAt: c.worksAt, firmId: c.firmId, assignedTo: c.assignedTo?.id ?? null, visitsAMonth: c.visitsAMonth, note: c.note,
            },
          }}
        />
      )}
      {visiting && <AddVisitsDialog day={manilaToday()} kind={c.kind} preset={[c.id]} onClose={() => setVisiting(false)} />}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase">{label}</div>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}
