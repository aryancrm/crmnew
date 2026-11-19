// Two tabs of Teams & people: the areas (each channel's places, the cities in each, which seat
// holds it, its customers), added and changed by the CEO and the Admin; and the team leads' asks
// for a new person or an empty seat, approved (the seat, its area and the login are made) or
// declined with a reason. And the team lead's own form to ask.

import type { OrgLogin, OrgTree, SeatRequest, SeatRequestForm } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Network, Pencil, Plus, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { Button, CARD, Dialog, PageState, Problem, useAction } from "../ui";
import { FIELD, LoginCard } from "./dialogs";

/** The first word of a new area's name by its channel, as Zoho's salespeople are named. */
const AREA_PREFIX: Record<string, string> = { HOSP: "HOS", ONLINE: "B2C", TS: "TeleSales", PAP: "MD Telesales" };

const LABEL = "text-xs font-semibold text-slate-600";
const cityList = (text: string) =>
  text
    .split(",")
    .map((city) => city.trim())
    .filter(Boolean);

export function AreaDialog({
  channel,
  area,
  onClose,
}: {
  channel: { id: number; code: string; name: string; division?: string | null };
  area?: OrgTree["areas"][number];
  onClose: () => void;
}) {
  const queries = useQueryClient();
  const action = useAction();
  // Areas are named as Zoho names the salespeople ("HOS | Pasay", "B2C | …"), which ties their
  // Zoho history to them: the channel's code, or the hub's word for it.
  const [name, setName] = useState(area?.name ?? `${AREA_PREFIX[channel.code] ?? channel.code} | `);
  const [cities, setCities] = useState(area?.cities.join(", ") ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      area
        ? api(`/api/org/areas/${area.id}`, {
            method: "PATCH",
            body: { name, cities: cityList(cities) },
          })
        : api("/api/org/areas", {
            body: { channelId: channel.id, name, cities: cityList(cities) },
          }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["org"] });
      onClose();
    }
  }
  return (
    <Dialog
      title={area ? `Change ${area.name}` : `A new area in ${channel.code}`}
      sub="Customers in its cities who have no area yet join it."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name *</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Cities in it (comma between)</span>
          <input
            value={cities}
            onChange={(event) => setCities(event.target.value)}
            className={FIELD}
            placeholder="Makati, Taguig, Pateros"
          />
        </label>
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : area ? "Save" : "Add area"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Every channel's areas: their cities, the seat holding each (or nobody), their customers. */
export function AreasTab({ tree }: { tree: OrgTree }) {
  const [pop, setPop] = useState<{
    channel: OrgTree["channels"][number];
    area?: OrgTree["areas"][number];
  } | null>(null);
  const seats = tree.units.flatMap((unit) => unit.seats.map((seat) => ({ seat, unit })));
  return (
    <div className="flex flex-col gap-4">
      {tree.channels
        .filter((channel) => channel.active)
        .map((channel) => {
          const areas = tree.areas.filter((area) => area.channelId === channel.id);
          return (
            <section key={channel.id} className={`${CARD} overflow-hidden`}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-slate-900">
                  {channel.code} · {channel.name}
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                    {areas.length}
                  </span>
                </h3>
                <Button small onClick={() => setPop({ channel })}>
                  <Plus size={14} /> Add area
                </Button>
              </div>
              {areas.length === 0 ? (
                <p className="px-4 py-3 text-xs text-slate-400">No area yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {areas.map((area) => {
                    const held = seats.find(({ seat }) => seat.id === area.seatId);
                    return (
                      <li
                        key={area.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                            <MapPin size={13} className="text-slate-400" /> {area.name}
                          </span>
                          <span className="flex flex-wrap gap-1">
                            {area.cities.length ? (
                              area.cities.map((city) => (
                                <span
                                  key={city}
                                  className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                                >
                                  {city}
                                </span>
                              ))
                            ) : (
                              <span className="text-[11px] text-slate-400">No city yet</span>
                            )}
                          </span>
                        </span>
                        <span className="text-xs text-slate-600">
                          {held ? (
                            held.seat.holder ? (
                              <>
                                <b>{held.seat.holder.name}</b> · {held.unit.name}
                              </>
                            ) : (
                              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                                Vacant seat · {held.unit.name}
                              </span>
                            )
                          ) : (
                            <span className="text-slate-400">No seat holds it</span>
                          )}
                        </span>
                        <span className="w-24 text-right text-xs text-slate-500 tabular-nums">
                          {area.customers} customer{area.customers === 1 ? "" : "s"}
                        </span>
                        <Button
                          small
                          variant="quiet"
                          onClick={() => setPop({ channel, area })}
                          aria-label={`Change ${area.name}`}
                        >
                          <Pencil size={14} />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      {pop && <AreaDialog channel={pop.channel} area={pop.area} onClose={() => setPop(null)} />}
    </div>
  );
}

const STATUS: Record<SeatRequest["status"], string> = {
  open: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-50 text-emerald-800",
  declined: "bg-rose-50 text-rose-700",
};

const KIND_WORD: Record<SeatRequest["kind"], string> = {
  seat: "Person",
  region: "Region",
  area: "Area",
};
const KIND_TONE: Record<SeatRequest["kind"], string> = {
  seat: "bg-sky-100 text-sky-800",
  region: "bg-violet-100 text-violet-800",
  area: "bg-amber-100 text-amber-800",
};

function RequestLine({ request }: { request: SeatRequest }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <span
          className={`rounded px-1.5 py-px text-[10px] font-bold tracking-wide uppercase ${KIND_TONE[request.kind]}`}
        >
          {KIND_WORD[request.kind]}
        </span>
        {request.kind === "region"
          ? `${request.title}, under ${request.unit}`
          : request.kind === "area"
            ? `${request.title} in ${request.unit}`
            : `${request.personName ?? "An empty seat"} · ${request.module === "team_lead" ? "Team lead" : "MedRep"} in ${request.unit}`}
      </span>
      <span className="text-xs text-slate-500">
        {[
          request.kind === "region"
            ? request.leadPerson
              ? `${request.leadPerson} leads it`
              : "Lead to be named"
            : null,
          request.kind === "area"
            ? `${request.newArea?.cities.join(", ") ?? ""}${request.forSeat ? ` · for ${request.forSeat}` : " · not given to anyone yet"}`
            : null,
          request.kind === "seat"
            ? (request.area ??
              (request.newArea
                ? `New area ${request.newArea.name} (${request.newArea.cities.join(", ")})`
                : null))
            : null,
          request.personPhone,
          `asked by ${request.askedBy}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {request.reason && <span className="text-xs text-slate-600">"{request.reason}"</span>}
      {request.answer && (
        <span className="text-xs text-slate-600">
          {request.decidedBy}: {request.answer}
        </span>
      )}
    </span>
  );
}

/** The team leads' asks, open ones first: approve (the login is shown once) or decline with why. */
export function RequestsTab({ tree }: { tree: OrgTree }) {
  const queries = useQueryClient();
  const [deciding, setDeciding] = useState<{ request: SeatRequest; approve: boolean } | null>(null);
  const [login, setLogin] = useState<{ name: string; login: OrgLogin } | null>(null);
  if (!tree.requests.length)
    return (
      <div className={`${CARD} px-5 py-8 text-center text-sm text-slate-500`}>
        No team lead has asked for anyone yet.
      </div>
    );
  return (
    <section className={`${CARD} overflow-hidden`}>
      <ul className="divide-y divide-slate-100">
        {tree.requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <RequestLine request={request} />
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[request.status]}`}
            >
              {request.status === "open"
                ? "Waiting for you"
                : request.status === "approved"
                  ? "Approved"
                  : "Declined"}
            </span>
            {request.status === "open" && (
              <span className="flex gap-1.5">
                <Button
                  small
                  variant="primary"
                  onClick={() => setDeciding({ request, approve: true })}
                >
                  Approve
                </Button>
                <Button small onClick={() => setDeciding({ request, approve: false })}>
                  Decline
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {deciding && (
        <Decide
          {...deciding}
          onClose={() => setDeciding(null)}
          onDone={async (made) => {
            setDeciding(null);
            await queries.invalidateQueries({ queryKey: ["org"] });
            if (made && deciding.request.personName)
              setLogin({ name: deciding.request.personName, login: made });
          }}
        />
      )}
      {login && <LoginCard name={login.name} login={login.login} onClose={() => setLogin(null)} />}
    </section>
  );
}

function Decide({
  request,
  approve,
  onClose,
  onDone,
}: {
  request: SeatRequest;
  approve: boolean;
  onClose: () => void;
  onDone: (login: OrgLogin | null) => void;
}) {
  const action = useAction();
  const [answer, setAnswer] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    let made: OrgLogin | null = null;
    const done = await action.run(async () => {
      made = (
        await api<{ login: OrgLogin | null }>(`/api/org/requests/${request.id}/decide`, {
          body: { approve, answer: answer || null },
        })
      ).login;
    });
    if (done) onDone(made);
  }
  return (
    <Dialog
      title={approve ? "Approve the ask" : "Decline the ask"}
      sub={
        approve
          ? request.kind === "region"
            ? `${request.title} is made under ${request.unit}${request.leadPerson ? `, led by ${request.leadPerson}` : ""}; the team is told.`
            : request.kind === "area"
              ? `${request.title} is made${request.forSeat ? ` and given to ${request.forSeat}` : ""}; the team is told.`
              : request.personName
                ? `${request.personName} gets the seat and a login; you see the password once.`
                : "An empty seat is made, to fill later."
          : "Say why: the team lead sees it."
      }
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <RequestLine request={request} />
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{approve ? "A note (optional)" : "Why *"}</span>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={2}
            required={!approve}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
          />
        </label>
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant={approve ? "primary" : "danger"} disabled={action.busy}>
            {action.busy ? "Saving…" : approve ? "Approve" : "Decline"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A team lead asks the CEO for a new person (or an empty seat) in one of their teams. */
export function AskForPersonDialog({
  onClose,
  kind: firstKind = "seat",
}: {
  onClose: () => void;
  /** What to ask for first: a person, a region or an area (the dialog switches between them). */
  kind?: SeatRequest["kind"];
}) {
  const [kind, setKind] = useState<SeatRequest["kind"]>(firstKind);
  const [regionName, setRegionName] = useState("");
  const [leadPerson, setLeadPerson] = useState("");
  const [forSeat, setForSeat] = useState("");
  const action = useAction();
  const form = useQuery({
    queryKey: ["org", "requests", "form"],
    queryFn: () => api<SeatRequestForm>("/api/org/requests/form"),
  });
  const queries = useQueryClient();
  const [unitId, setUnitId] = useState("");
  const [module, setModule] = useState<"medrep" | "team_lead">("medrep");
  const [area, setArea] = useState("");
  const [newName, setNewName] = useState("");
  const [newCities, setNewCities] = useState("");
  const [personName, setPersonName] = useState("");
  const [personPhone, setPersonPhone] = useState("");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const data = form.data;
  const unit = data?.units.find((one) => String(one.id) === unitId) ?? data?.units[0];
  // An area given to a seat belongs to that seat's team.
  const seatUnit = data?.seats.find((one) => String(one.id) === forSeat)?.unitId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api("/api/org/requests", {
        body:
          kind === "region"
            ? {
                kind,
                unitId: unit?.id,
                name: regionName,
                leadPersonId: leadPerson ? Number(leadPerson) : null,
                reason: reason || null,
              }
            : kind === "area"
              ? {
                  kind,
                  unitId: seatUnit ?? unit?.id,
                  newArea: { name: newName, cities: cityList(newCities) },
                  forSeatId: forSeat ? Number(forSeat) : null,
                  reason: reason || null,
                }
              : {
                  kind,
                  unitId: unit?.id,
                  module,
                  areaId: area && area !== "new" ? Number(area) : null,
                  newArea: area === "new" ? { name: newName, cities: cityList(newCities) } : null,
                  personName: personName || null,
                  personPhone: personPhone || null,
                  reason: reason || null,
                },
      }),
    );
    if (done) {
      setSent(true);
      await queries.invalidateQueries({ queryKey: ["org", "requests", "form"] });
    }
  }

  return (
    <Dialog
      title={
        kind === "region"
          ? "Ask for a new region"
          : kind === "area"
            ? "Ask for a new area"
            : "Ask for a new person"
      }
      sub={
        kind === "region"
          ? "A new team under yours, with who leads it. The CEO approves; your team is told."
          : kind === "area"
            ? "A new area (its cities) and who covers it. The CEO approves; your team is told."
            : "The CEO approves it; then the seat, the area and their login are made."
      }
      onClose={onClose}
      busy={action.busy}
      wide
    >
      {!data ? (
        <PageState query={form} what="your teams" />
      ) : sent ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <UserPlus className="size-10 text-emerald-600" />
          <div className="text-sm font-semibold text-slate-900">Sent to the CEO</div>
          <div className="text-[13px] text-slate-500">
            You'll hear on your bell when it is decided.
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ["seat", "A person", UserPlus],
                ["region", "A region", Network],
                ["area", "An area", MapPin],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
                  kind === key
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          {kind === "region" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Under which team *</span>
                <select
                  value={unit?.id ?? ""}
                  onChange={(event) => setUnitId(event.target.value)}
                  className={FIELD}
                >
                  {data.units.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                      {one.channel ? ` (${one.channel})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>The region's name *</span>
                <input
                  value={regionName}
                  onChange={(event) => setRegionName(event.target.value)}
                  className={FIELD}
                  placeholder="Visayas"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={LABEL}>Who leads it</span>
                <select
                  value={leadPerson}
                  onChange={(event) => setLeadPerson(event.target.value)}
                  className={FIELD}
                >
                  <option value="">Name the lead later</option>
                  {data.people.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name} · {one.title}, {one.unit}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-500">
                  They keep their own seat and lead the region too.
                </span>
              </label>
            </div>
          )}
          {kind === "area" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>The area's name *</span>
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className={FIELD}
                  placeholder="HOS | Cebu"
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Given to</span>
                <select
                  value={forSeat}
                  onChange={(event) => setForSeat(event.target.value)}
                  className={FIELD}
                >
                  <option value="">Nobody yet (the team lead's)</option>
                  {data.seats.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.holder ?? "Empty seat"} · {one.title}, {one.unit}
                    </option>
                  ))}
                </select>
              </label>
              {!forSeat && (
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>In which team *</span>
                  <select
                    value={unit?.id ?? ""}
                    onChange={(event) => setUnitId(event.target.value)}
                    className={FIELD}
                  >
                    {data.units.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                        {one.channel ? ` (${one.channel})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={`flex flex-col gap-1 ${forSeat ? "" : ""} sm:col-span-2`}>
                <span className={LABEL}>Cities in it * (comma between)</span>
                <input
                  value={newCities}
                  onChange={(event) => setNewCities(event.target.value)}
                  className={FIELD}
                  placeholder="Cebu City, Mandaue, Lapu-Lapu"
                  required
                />
                <span className="text-[11px] text-slate-500">
                  Customers in these cities become the area's (its MedRep's). Only seats with no
                  area yet can be given one.
                </span>
              </label>
            </div>
          )}
          <div className={`grid gap-3 sm:grid-cols-2 ${kind === "seat" ? "" : "hidden"}`}>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Team *</span>
              <select
                value={unit?.id ?? ""}
                onChange={(event) => setUnitId(event.target.value)}
                className={FIELD}
              >
                {data.units.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                    {one.channel ? ` (${one.channel})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Work *</span>
              <select
                value={module}
                onChange={(event) => setModule(event.target.value as typeof module)}
                className={FIELD}
              >
                <option value="medrep">MedRep</option>
                <option value="team_lead">Team lead</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Area (their customers)</span>
              <select
                value={area}
                onChange={(event) => setArea(event.target.value)}
                className={FIELD}
              >
                <option value="">No area</option>
                {data.areas.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name} (free)
                  </option>
                ))}
                <option value="new">+ A new area…</option>
              </select>
            </label>
            {area === "new" && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>New area's name *</span>
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className={FIELD}
                  placeholder="HOS | Caloocan"
                  required={kind === "seat"}
                />
              </label>
            )}
            {area === "new" && (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={LABEL}>Cities in it (comma between)</span>
                <input
                  value={newCities}
                  onChange={(event) => setNewCities(event.target.value)}
                  className={FIELD}
                  placeholder="Caloocan, Malabon"
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Their name (if you have someone)</span>
              <input
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
                className={FIELD}
                placeholder="Leave empty for a seat to hire into"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Their phone</span>
              <input
                value={personPhone}
                onChange={(event) => setPersonPhone(event.target.value)}
                className={FIELD}
                inputMode="tel"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Why</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
              placeholder={
                kind === "region"
                  ? "Cebu and Iloilo hospitals are growing"
                  : kind === "area"
                    ? "New hospitals opened there"
                    : "North Manila hospitals have nobody"
              }
            />
          </label>
          <Problem message={action.problem?.message} />
          {data.mine.length > 0 && (
            <div className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                What you asked before
              </div>
              <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
                {data.mine.map((request) => (
                  <li key={request.id} className="flex items-center gap-2 px-3 py-2">
                    <RequestLine request={request} />
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[request.status]}`}
                    >
                      {request.status === "open"
                        ? "Waiting"
                        : request.status === "approved"
                          ? "Approved"
                          : "Declined"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button onClick={onClose} disabled={action.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={action.busy}>
              {action.busy ? "Sending…" : "Send to the CEO"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
