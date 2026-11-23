// The Admin panel's Channels: how many sales channels the company has, a new one added in one
// step (its code, name and Division; its box at the top of the company is made with it), and each
// channel opened as its structure: who heads it, its teams with their team leads, the MedReps
// under them (shown only: who is under whom is changed on the Company tree, 22 Nov), and its areas. Everything that reads channels (orders, sales, targets, the CEO's
// figures) takes a new channel from here. People are added through the same dialogs as Teams &
// people, so a seat, its login and its area work the same everywhere.

import { DIVISIONS } from "@2mg/api/divisions";
import type { OrgSeat, OrgTree, OrgUnit } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  FolderTree,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  UserPlus,
  Users,
} from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { AreaDialog } from "../org/areas-requests";
import { FIELD } from "../org/dialogs";
import { Button, CARD, Dialog, PageHead, PageState, Problem, useAction } from "../ui";
import { Menu, OrgPops, type Pop, SeatRow } from "../org/teams";

type Channel = OrgTree["channels"][number];
type Area = OrgTree["areas"][number];

const LABEL = "text-xs font-semibold text-slate-600";

/** A channel's own box (the one with its channel whose box above isn't the same channel), every
 *  box under it, and its seats by the work they do. A channel can have a box in two businesses
 *  (Telesales: Vanessa's TeleSales, Javed's MD Telesales): the highest one, first in order, is its
 *  own box (as the server picks its head); the others are teams of it, each said where it sits. */
function shapeOf(tree: OrgTree, channel: Channel) {
  const byId = new Map(tree.units.map((unit) => [unit.id, unit]));
  const depthOf = (unit: OrgUnit) => {
    let n = 0;
    for (let at = unit.parentId; at !== null && n < 50; at = byId.get(at)?.parentId ?? null) n++;
    return n;
  };
  const tops = tree.units
    .filter(
      (unit) =>
        unit.channel?.id === channel.id &&
        (unit.parentId === null || byId.get(unit.parentId)?.channel?.id !== channel.id),
    )
    .sort((a, b) => depthOf(a) - depthOf(b) || a.sort - b.sort || a.id - b.id);
  const top = tops[0] ?? null;
  /** The channel's other boxes, with the box each sits in (another business). */
  const elsewhere = new Map(
    tops.slice(1).flatMap((unit) => {
      const parent = unit.parentId ? byId.get(unit.parentId) : undefined;
      return parent ? [[unit.id, parent] as const] : [];
    }),
  );
  const kids = new Map<number, OrgUnit[]>();
  for (const unit of tree.units) {
    if (unit.parentId === null) continue;
    kids.set(unit.parentId, [...(kids.get(unit.parentId) ?? []), unit]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.sort - b.sort || a.id - b.id);
  /** Every box under the top, in reading order, with the boxes between ("Luzon › NCR 1"). */
  const teams: { unit: OrgUnit; path: string[] }[] = [];
  const walk = (unit: OrgUnit, path: string[]) => {
    for (const kid of kids.get(unit.id) ?? []) {
      // A box of another channel sitting under this one is that channel's, never a team here.
      if (kid.channel && kid.channel.id !== channel.id) continue;
      teams.push({ unit: kid, path });
      walk(kid, [...path, kid.name]);
    }
  };
  if (top) walk(top, []);
  for (const unit of tops.slice(1)) {
    teams.push({ unit, path: [] });
    walk(unit, [unit.name]);
  }
  const head = top?.seats.find((seat) => seat.lead) ?? null;
  const all = [...(top?.seats ?? []), ...teams.flatMap(({ unit }) => unit.seats)];
  const isLead = (seat: OrgSeat) => seat.module === "team_lead" || seat.module === "manager";
  const leads = all.filter((seat) => seat !== head && isLead(seat));
  const reps = all.filter((seat) => seat.module === "medrep");
  const areas = tree.areas.filter((area) => area.channelId === channel.id);
  const holding = new Set(all.flatMap((seat) => (seat.area ? [seat.area.id] : [])));
  const unitIds = new Set([top?.id, ...teams.map(({ unit }) => unit.id)]);
  const asks = tree.requests.filter(
    (request) => request.status === "open" && unitIds.has(request.unitId),
  );
  const parent = top?.parentId ? byId.get(top.parentId) : undefined;
  return {
    top,
    /** The box of another channel this channel's box sits inside, when it does (it shouldn't). */
    insideOf: parent?.channel && parent.channel.id !== channel.id ? parent : null,
    elsewhere,
    head,
    teams,
    leads,
    reps,
    areas,
    areasFree: areas.filter((area) => !holding.has(area.id)),
    asks,
    people: new Set(all.flatMap((seat) => (seat.holder ? [seat.holder.personId] : []))).size,
  };
}

const vacantOf = (seats: OrgSeat[]) => seats.filter((seat) => !seat.holder).length;
const who = (seat: OrgSeat | null) =>
  seat ? (seat.acting?.name ?? seat.holder?.name ?? null) : null;

export function AdminChannelsPage() {
  const query = useQuery({ queryKey: ["org"], queryFn: () => api<OrgTree>("/api/org") });
  if (!query.data) return <PageState query={query} what="the channels" />;
  return <Channels tree={query.data} />;
}

function Channels({ tree }: { tree: OrgTree }) {
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const open = tree.channels.filter((channel) => channel.active);
  const retired = tree.channels.filter((channel) => !channel.active);
  const shapes = open.map((channel) => ({ channel, shape: shapeOf(tree, channel) }));
  const people = shapes.reduce((sum, { shape }) => sum + shape.people, 0);
  const vacant = shapes.reduce(
    (sum, { shape }) =>
      sum + vacantOf([...(shape.head ? [shape.head] : []), ...shape.leads, ...shape.reps]),
    0,
  );
  const asks = tree.requests.filter((request) => request.status === "open").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Channels"
        sub={[
          `${open.length} ${open.length === 1 ? "channel" : "channels"}`,
          `${people} ${people === 1 ? "person" : "people"}`,
          vacant ? `${vacant} vacant ${vacant === 1 ? "seat" : "seats"}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          tree.can.change && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={16} /> Add channel
            </Button>
          )
        }
      />
      {asks > 0 && (
        <Link
          to="/people?tab=requests"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 hover:border-amber-300"
        >
          <span>
            <b>{asks}</b> {asks === 1 ? "ask" : "asks"} from team leads for people or areas
          </span>
          <span className="font-semibold text-amber-800">Answer →</span>
        </Link>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shapes.map(({ channel, shape }) => (
          <ChannelCard key={channel.id} channel={channel} shape={shape} />
        ))}
        {tree.can.change && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-700"
          >
            <span className="grid size-10 place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
              <Plus size={18} />
            </span>
            <span className="text-sm font-semibold">A new channel</span>
          </button>
        )}
      </div>

      {retired.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowRetired((now) => !now)}
            className="self-start text-xs font-semibold text-slate-500 hover:text-slate-800"
          >
            {showRetired ? "Hide" : "Show"} channels out of use ({retired.length})
          </button>
          {showRetired && (
            <ul className={`${CARD} divide-y divide-slate-100`}>
              {retired.map((channel) => (
                <RetiredRow key={channel.id} channel={channel} can={tree.can.change} />
              ))}
            </ul>
          )}
        </section>
      )}

      {adding && <ChannelDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function ChannelCard({ channel, shape }: { channel: Channel; shape: ReturnType<typeof shapeOf> }) {
  const head = who(shape.head);
  const teams = shape.teams;
  return (
    <Link
      to={`/admin/channels/${channel.id}`}
      className={`${CARD} flex flex-col gap-3 p-4 transition-colors hover:border-emerald-300`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
              {channel.code}
            </span>
            <span className="truncate text-sm font-semibold text-slate-900">{channel.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {channel.division ? `Division ${channel.division}` : "No Division set"}
            {shape.insideOf && (
              <span className="font-semibold text-amber-700"> · inside {shape.insideOf.name}</span>
            )}
          </div>
        </div>
        {shape.asks.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            {shape.asks.length} {shape.asks.length === 1 ? "ask" : "asks"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2">
        <Avatar name={head} />
        <div className="min-w-0 text-[13px]">
          <div className="text-[11px] text-slate-500">Head</div>
          {head ? (
            <div className="truncate font-semibold text-slate-900">{head}</div>
          ) : (
            <div className="font-semibold text-amber-700">
              {shape.head ? "Vacant" : "No head yet"}
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Count label="Teams" value={teams.length} />
        <Count label="Team leads" value={shape.leads.length} vacant={vacantOf(shape.leads)} />
        <Count label="MedReps" value={shape.reps.length} vacant={vacantOf(shape.reps)} />
      </dl>

      {teams.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {teams.slice(0, 6).map(({ unit }) => {
            const lead = who(unit.seats.find((seat) => seat.lead) ?? null);
            return (
              <li
                key={unit.id}
                className="max-w-full truncate rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600"
              >
                <b className="font-semibold text-slate-800">{unit.name}</b>
                {lead ? ` · ${lead}` : ""}
              </li>
            );
          })}
          {teams.length > 6 && (
            <li className="px-1 text-[11px] text-slate-400">+{teams.length - 6} more</li>
          )}
        </ul>
      )}
      <div className="mt-auto flex items-center gap-1.5 text-xs text-slate-500">
        <MapPin size={12} className="text-slate-400" />
        {shape.areas.length} {shape.areas.length === 1 ? "area" : "areas"}
        {shape.areasFree.length > 0 && (
          <span className="text-amber-700">· {shape.areasFree.length} with no MedRep</span>
        )}
      </div>
    </Link>
  );
}

function Count({ label, value, vacant }: { label: string; value: number; vacant?: number }) {
  return (
    <div className="rounded-lg border border-slate-100 px-1 py-1.5">
      <dd className="text-lg font-semibold text-slate-900 tabular-nums">{value}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      {vacant ? (
        <div className="text-[10px] font-semibold text-amber-700">{vacant} vacant</div>
      ) : null}
    </div>
  );
}

function Avatar({ name }: { name: string | null }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={`grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ${name ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-700"}`}
    >
      {initials || "?"}
    </span>
  );
}

function RetiredRow({ channel, can }: { channel: Channel; can: boolean }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <span className="text-sm text-slate-600">
        <b className="text-slate-800">{channel.code}</b> · {channel.name}
      </span>
      {can && (
        <Button
          small
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await api(`/api/org/channels/${channel.id}`, {
                method: "PATCH",
                body: { active: true },
              });
              await queries.invalidateQueries({ queryKey: ["org"] });
            })
          }
        >
          <RotateCcw size={14} /> Bring back
        </Button>
      )}
      <Problem message={action.problem?.message} />
    </li>
  );
}

/** Add a channel, or change one's name and Division. */
function ChannelDialog({ channel, onClose }: { channel?: Channel; onClose: () => void }) {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const [code, setCode] = useState(channel?.code ?? "");
  const [name, setName] = useState(channel?.name ?? "");
  const [division, setDivision] = useState(channel?.division ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    let made: { channelId: number } | null = null;
    const done = await action.run(async () => {
      if (channel)
        await api(`/api/org/channels/${channel.id}`, {
          method: "PATCH",
          body: { name, division: division || null },
        });
      else
        made = await api<{ channelId: number }>("/api/org/channels", {
          body: { code, name, division: division || null },
        });
    });
    if (!done) return;
    await queries.invalidateQueries({ queryKey: ["org"] });
    onClose();
    const added = made as { channelId: number } | null;
    if (added) navigate(`/admin/channels/${added.channelId}`);
  }
  return (
    <Dialog
      title={channel ? `Change ${channel.code}` : "A new channel"}
      sub={
        channel
          ? undefined
          : "Its head, teams and MedReps go in next. Its orders, sales and targets show everywhere at once."
      }
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Code *</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              className={`${FIELD} font-semibold tracking-wide uppercase`}
              placeholder="HOSP"
              maxLength={12}
              disabled={Boolean(channel)}
              required
            />
            {action.at("code") && (
              <span className="text-xs font-medium text-rose-700">{action.at("code")}</span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name *</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={FIELD}
              placeholder="Hospital Division"
              maxLength={60}
              required
            />
            {action.at("name") && (
              <span className="text-xs font-medium text-rose-700">{action.at("name")}</span>
            )}
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Division on its orders</span>
          <select
            value={division}
            onChange={(event) => setDivision(event.target.value)}
            className={FIELD}
          >
            <option value="">None</option>
            {DIVISIONS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
          {action.at("division") && (
            <span className="text-xs font-medium text-rose-700">{action.at("division")}</span>
          )}
        </label>
        <Problem message={action.general(["code", "name", "division"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : channel ? "Save" : "Add channel"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ one channel

export function AdminChannelPage() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["org"], queryFn: () => api<OrgTree>("/api/org") });
  if (!query.data) return <PageState query={query} what="the channel" />;
  const channel = query.data.channels.find((one) => String(one.id) === id);
  if (!channel)
    return (
      <div className={`${CARD} p-6 text-sm text-slate-600`}>
        No such channel. <Link to="/">Back to Channels</Link>
      </div>
    );
  return <ChannelPage tree={query.data} channel={channel} />;
}

function ChannelPage({ tree, channel }: { tree: OrgTree; channel: Channel }) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const retire = useAction();
  const [pop, setPop] = useState<Pop | null>(null);
  const [editing, setEditing] = useState(false);
  const [area, setArea] = useState<{ area?: Area } | null>(null);
  const shape = useMemo(() => shapeOf(tree, channel), [tree, channel]);
  const { top, head } = shape;
  const can = tree.can.change;
  // Who is under whom is changed in one place, the Company tree (Aryan, 20 and 22 Nov): this page
  // shows the channel's people and keeps what only a channel has (its name, Division, areas).
  const place = false as boolean;
  const seatOfArea = new Map(
    tree.units.flatMap((unit) =>
      unit.seats.flatMap((seat) => (seat.area ? [[seat.area.id, seat] as const] : [])),
    ),
  );
  // Seats in the channel's own box other than its head: people straight under the head.
  const direct = top?.seats.filter((seat) => !seat.lead) ?? [];
  /** Moves the channel's box out of another channel's, straight under the company. */
  const standAlone = () =>
    retire.run(async () => {
      const root = tree.units.find((unit) => unit.kind === "company");
      if (!top || !root) return;
      await api(`/api/org/units/${top.id}`, { method: "PATCH", body: { parentId: root.id } });
      await queries.invalidateQueries({ queryKey: ["org"] });
    });

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Where you are" className="flex items-center gap-1.5 text-xs text-slate-500">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          aria-label="Back"
          className="mr-1 grid size-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:text-emerald-700"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <Link to="/" className="hover:text-slate-800">
          Channels
        </Link>
        <span aria-hidden="true" className="text-slate-300">
          ›
        </span>
        <span className="font-medium text-slate-700">{channel.code}</span>
      </nav>

      <section className={`${CARD} flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5`}>
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-sm font-bold tracking-wide text-white">
              {channel.code}
            </span>
            {channel.name}
            {!channel.active && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                Out of use
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {[
              channel.division ? `Division ${channel.division}` : "No Division set",
              `${shape.people} ${shape.people === 1 ? "person" : "people"}`,
              `${shape.areas.length} ${shape.areas.length === 1 ? "area" : "areas"}`,
            ].join(" · ")}
          </p>
          {/* The channel's shape in one line: who heads it, how many lead teams, teams, MedReps. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            {[
              ["Head", who(head) ?? "none yet"],
              ["Team leads", String(shape.leads.filter((seat) => seat.holder).length)],
              ["Teams", String(shape.teams.length)],
              ["MedReps", String(shape.reps.filter((seat) => seat.holder).length)],
            ].map(([label, value], at) => (
              <span key={label} className="flex items-center gap-2">
                {at > 0 && <span className="text-slate-300">→</span>}
                <span className="rounded-lg bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200">
                  <span className="text-slate-500">{label} </span>
                  <b className="text-slate-900">{value}</b>
                </span>
              </span>
            ))}
          </div>
          {shape.insideOf && (
            <p className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
              Sits inside {shape.insideOf.name}: it counts there too.
              {place && (
                <button
                  type="button"
                  disabled={retire.busy}
                  onClick={() => standAlone()}
                  className="font-semibold text-amber-800 underline hover:text-amber-950"
                >
                  Make it a channel of its own
                </button>
              )}
            </p>
          )}
        </div>
        {can && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setEditing(true)}>
              <Pencil size={14} /> Name & Division
            </Button>
            <Menu
              busy={retire.busy}
              items={[
                ...(top
                  ? [
                      {
                        label: "Open in Teams & people",
                        onClick: () => navigate(`/people?unit=${top.id}`),
                      },
                    ]
                  : []),
                channel.active
                  ? {
                      label: "Take out of use",
                      danger: true,
                      onClick: () =>
                        retire.run(async () => {
                          await api(`/api/org/channels/${channel.id}`, {
                            method: "PATCH",
                            body: { active: false },
                          });
                          await queries.invalidateQueries({ queryKey: ["org"] });
                        }),
                    }
                  : {
                      label: "Bring back into use",
                      onClick: () =>
                        retire.run(async () => {
                          await api(`/api/org/channels/${channel.id}`, {
                            method: "PATCH",
                            body: { active: true },
                          });
                          await queries.invalidateQueries({ queryKey: ["org"] });
                        }),
                    },
              ]}
            />
          </div>
        )}
        <div className="basis-full">
          <Problem message={retire.problem?.message} />
        </div>
      </section>

      {shape.asks.length > 0 && (
        <Link
          to="/people?tab=requests"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 hover:border-amber-300"
        >
          <span>
            <b>{shape.asks.length}</b> {shape.asks.length === 1 ? "ask" : "asks"} waiting from this
            channel's team leads
          </span>
          <span className="font-semibold text-amber-800">Answer →</span>
        </Link>
      )}

      {!top ? (
        <section className={`${CARD} p-5 text-sm text-slate-600`}>
          This channel has no box in the company yet.{" "}
          {place && (
            <Button
              small
              onClick={() => {
                const root = tree.units.find((unit) => unit.kind === "company");
                if (root) setPop({ kind: "unit", parent: root });
              }}
            >
              <FolderTree size={14} /> Make its box
            </Button>
          )}
        </section>
      ) : (
        <>
          <Link
            to="/company/sales"
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <span>
              Who is under whom is changed in one place: the <b>Company tree</b> (Edit positions).
              This page shows it.
            </span>
            <span className="shrink-0 font-semibold text-brand">Open the tree →</span>
          </Link>

          {/* 1 · The head */}
          <Step n={1} title="Head of the channel">
            {head ? (
              <ul
                className={`${CARD} [&>li:last-child]:rounded-b-2xl [&>li:first-child]:rounded-t-2xl`}
              >
                <SeatRow fixed seat={head} unit={top} open={setPop} />
              </ul>
            ) : (
              <Empty
                text="Nobody heads this channel yet."
                action={
                  place && (
                    <Button
                      small
                      variant="primary"
                      onClick={() =>
                        setPop({
                          kind: "add",
                          unit: top,
                          module: "team_lead",
                          title: `${channel.code} head`,
                        })
                      }
                    >
                      <UserPlus size={14} /> Add the head
                    </Button>
                  )
                }
              />
            )}
          </Step>

          {/* 2 · Teams, their team leads and MedReps */}
          <Step
            n={2}
            title="Teams, their team leads and MedReps"
            action={
              place && (
                <Button small onClick={() => setPop({ kind: "unit", parent: top, team: true })}>
                  <FolderTree size={14} /> Add team
                </Button>
              )
            }
          >
            {shape.teams.length === 0 && direct.length === 0 && (
              <Empty
                text="No team yet. Add a team, then its team lead and MedReps."
                action={
                  place && (
                    <Button
                      small
                      variant="primary"
                      onClick={() => setPop({ kind: "unit", parent: top, team: true })}
                    >
                      <FolderTree size={14} /> Add the first team
                    </Button>
                  )
                }
              />
            )}
            {/* A tree (Aryan, 18 Nov: "who heads it, who are team leads, how many teams under whom"):
                each team with its lead and MedReps, the teams under it inside it, any depth. */}
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {shape.teams
                .filter(({ unit }) => unit.parentId === top.id || shape.elsewhere.has(unit.id))
                .map(({ unit }) => (
                  <TeamCard
                    key={unit.id}
                    unit={unit}
                    teams={shape.teams.map((one) => one.unit)}
                    top={top}
                    sitsIn={shape.elsewhere.get(unit.id)}
                    can={place}
                    open={setPop}
                  />
                ))}
              {direct.length > 0 && (
                <section className={CARD}>
                  <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Straight under the head
                    </h3>
                    {place && (
                      <Button
                        small
                        onClick={() => setPop({ kind: "add", unit: top, module: "medrep" })}
                      >
                        <Plus size={14} /> MedRep
                      </Button>
                    )}
                  </div>
                  <ul className="divide-y divide-slate-100 [&>li:last-child]:rounded-b-2xl">
                    {direct.map((seat) => (
                      <SeatRow fixed key={seat.id} seat={seat} unit={top} open={setPop} />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </Step>

          {/* 3 · Areas: where the MedReps' customers are */}
          <Step
            n={3}
            title="Areas"
            action={
              can && (
                <Button small onClick={() => setArea({})}>
                  <MapPin size={14} /> Add area
                </Button>
              )
            }
          >
            {shape.areas.length === 0 ? (
              <Empty text="No area yet: a MedRep gets the customers of the area their seat holds." />
            ) : (
              <ul className={`${CARD} divide-y divide-slate-100`}>
                {shape.areas.map((one) => {
                  const seat = seatOfArea.get(one.id);
                  return (
                    <li
                      key={one.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                          <MapPin size={13} className="text-slate-400" /> {one.name}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {one.cities.length ? (
                            one.cities.map((city) => (
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
                      <span className="text-xs text-slate-500">
                        {seat ? (
                          <>
                            <b className="text-slate-800">{who(seat) ?? "Vacant seat"}</b> ·{" "}
                            {seat.title}
                          </>
                        ) : (
                          <span className="font-semibold text-amber-700">No MedRep yet</span>
                        )}
                        {" · "}
                        <b className="text-slate-800 tabular-nums">{one.customers}</b>{" "}
                        {one.customers === 1 ? "customer" : "customers"}
                      </span>
                      {can && (
                        <Button small variant="quiet" onClick={() => setArea({ area: one })}>
                          <Pencil size={14} />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Step>
        </>
      )}

      <OrgPops tree={tree} pop={pop} setPop={setPop} />
      {editing && <ChannelDialog channel={channel} onClose={() => setEditing(false)} />}
      {area && <AreaDialog channel={channel} area={area.area} onClose={() => setArea(null)} />}
    </div>
  );
}

function Step({
  n,
  title,
  action,
  children,
}: {
  n: number;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="grid size-5 place-items-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
            {n}
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-3">
      <span className="text-[13px] text-slate-500">{text}</span>
      {action}
    </div>
  );
}

/** One team: its lead, its MedReps (each with their area), and Add buttons. */
function TeamCard({
  unit,
  teams,
  top,
  sitsIn,
  can,
  open,
  depth = 0,
}: {
  unit: OrgUnit;
  /** Every team of the channel: the ones under this one are drawn inside it. */
  teams: OrgUnit[];
  /** The channel's own box (the head's). */
  top: OrgUnit;
  /** For the channel's box in another business: the box it sits in there (Prescription Business). */
  sitsIn?: OrgUnit;
  can: boolean;
  open: (pop: Pop) => void;
  depth?: number;
}) {
  const queries = useQueryClient();
  const close = useAction();
  const [moving, setMoving] = useState(false);
  const lead = unit.seats.find((seat) => seat.lead) ?? null;
  // A team may have more than one team lead (Aryan, 18 Nov): the other leads sit in it beside the
  // main one, each MedRep under the lead they report to.
  const isLeadSeat = (seat: OrgSeat) => seat.module === "team_lead" || seat.module === "manager";
  const coLeads = unit.seats.filter((seat) => !seat.lead && isLeadSeat(seat));
  const others = unit.seats.filter((seat) => !seat.lead && !isLeadSeat(seat));
  const repsOf = (leadSeat: OrgSeat | null) =>
    others.filter((seat) =>
      leadSeat && leadSeat !== lead
        ? seat.reportsToSeatId === leadSeat.id
        : !coLeads.some((co) => co.id === seat.reportsToSeatId),
    );
  const parentUnit = sitsIn ?? teams.find((one) => one.id === unit.parentId) ?? top;
  const aboveLead = parentUnit.seats.find((seat) => seat.lead) ?? null;
  const under = teams.filter((one) => one.parentId === unit.id);
  /** No seat and no team under it: it can be closed. */
  const empty = unit.seats.length === 0 && under.length === 0;
  return (
    <section className={depth === 0 ? CARD : "rounded-xl border border-slate-200 bg-white"}>
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <div className="min-w-0">
          {(sitsIn || under.length > 0) && (
            <div className="text-[11px] text-slate-400">
              {[
                sitsIn && `In ${sitsIn.name}${who(sitsIn.seats.find((seat) => seat.lead) ?? null) ? ` · ${who(sitsIn.seats.find((seat) => seat.lead) ?? null)}` : ""}`,
                under.length > 0 && `${under.length} ${under.length === 1 ? "team" : "teams"} under it`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Users size={14} className="text-slate-400" />
            <span className="truncate">{unit.name}</span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums">
              {unit.seats.filter((seat) => seat.holder).length}
            </span>
          </h3>
        </div>
        {can && (
          <div className="flex items-center gap-1">
            <Button small onClick={() => open({ kind: "add", unit, module: "medrep" })}>
              <Plus size={14} /> MedRep
            </Button>
            <Menu
              items={[
                ...(lead
                  ? [
                      {
                        label: "Add another team lead",
                        onClick: () =>
                          open({ kind: "add", unit, module: "team_lead", ...(aboveLead ? { reportsTo: aboveLead.id } : {}) }),
                      },
                    ]
                  : [
                      {
                        label: "Add its team lead",
                        onClick: () => open({ kind: "add", unit, module: "team_lead" }),
                      },
                    ]),
                {
                  label: "A vacant MedRep seat (fill later)",
                  onClick: () => open({ kind: "seat", unit, module: "medrep" }),
                },
                {
                  label: "Add a team under it",
                  onClick: () => open({ kind: "unit", parent: unit, team: true }),
                },
                { label: "Move under…", onClick: () => setMoving(true) },
                { label: "Rename", onClick: () => open({ kind: "unit", unit, team: true }) },
                ...(empty
                  ? [
                      {
                        label: `Close ${unit.name}`,
                        danger: true,
                        onClick: () =>
                          close.run(async () => {
                            await api(`/api/org/units/${unit.id}/close`, { body: {} });
                            await queries.invalidateQueries({ queryKey: ["org"] });
                          }),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </div>
      {close.problem && (
        <div className="px-4 pt-2">
          <Problem message={close.problem.message} />
        </div>
      )}
      <ul className="divide-y divide-slate-100 [&>li:last-child]:rounded-b-2xl">
        {lead ? (
          <SeatRow fixed seat={lead} unit={unit} open={open} />
        ) : (
          <li className="flex flex-wrap items-center justify-between gap-2 bg-amber-50/40 px-4 py-2.5">
            <span className="text-xs font-semibold text-amber-800">No team lead yet</span>
            {can && (
              <Button
                small
                variant="primary"
                onClick={() => open({ kind: "add", unit, module: "team_lead" })}
              >
                <UserPlus size={14} /> Add team lead
              </Button>
            )}
          </li>
        )}
        {repsOf(lead).map((seat) => (
          <SeatRow fixed key={seat.id} seat={seat} unit={unit} open={open} />
        ))}
        {others.length === 0 && coLeads.length === 0 && (
          <li className="px-4 py-2.5 text-xs text-slate-400">No MedRep yet.</li>
        )}
        {coLeads.map((co) => (
          <li key={co.id} className="!p-0">
            <div className="flex items-center justify-between gap-2 border-t border-dashed border-slate-200 bg-slate-50/60 px-4 py-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Another team lead</span>
              {can && (
                <Button small variant="quiet" onClick={() => open({ kind: "add", unit, module: "medrep", reportsTo: co.id })}>
                  <Plus size={13} /> MedRep under them
                </Button>
              )}
            </div>
            <ul className="divide-y divide-slate-100">
              <SeatRow fixed seat={co} unit={unit} open={open} />
              {repsOf(co).map((seat) => (
                <SeatRow fixed key={seat.id} seat={seat} unit={unit} open={open} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {under.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 p-2.5 pl-4">
          {under.map((one) => (
            <TeamCard key={one.id} unit={one} teams={teams} top={top} can={can} open={open} depth={depth + 1} />
          ))}
        </div>
      )}
      {moving && <MoveTeamDialog unit={unit} teams={teams} top={top} onClose={() => setMoving(false)} />}
    </section>
  );
}

/** Moves a team (with everything under it) under another team of the channel, or straight under
 *  the head: the structure is changed here, never by hand. */
function MoveTeamDialog({ unit, teams, top, onClose }: { unit: OrgUnit; teams: OrgUnit[]; top: OrgUnit; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  // Not itself, nor any team under it (that would make a loop).
  const inside = new Set<number>([unit.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const one of teams)
      if (one.parentId !== null && inside.has(one.parentId) && !inside.has(one.id)) {
        inside.add(one.id);
        grew = true;
      }
  }
  const places = [top, ...teams.filter((one) => !inside.has(one.id))];
  const [to, setTo] = useState(String(unit.parentId ?? top.id));
  return (
    <Dialog title={`Move ${unit.name}`} onClose={onClose} busy={action.busy}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void action.run(async () => {
            await api(`/api/org/units/${unit.id}`, { method: "PATCH", body: { parentId: Number(to) } });
            await queries.invalidateQueries({ queryKey: ["org"] });
            onClose();
          });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Under</span>
          <select className={FIELD} value={to} onChange={(event) => setTo(event.target.value)}>
            {places.map((one) => (
              <option key={one.id} value={one.id}>
                {one.id === top.id ? `Straight under the head (${top.name})` : one.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12.5px] text-slate-500">Its team lead, MedReps and the teams under it move with it.</p>
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            Move
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
