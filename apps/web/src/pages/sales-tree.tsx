// The sales organisation (the old CRM's company tree, brought back live): the company, its heads,
// their channels and teams, each team's lead and people, every box with how much of its target it
// sold at the CRM's one pace. Nothing is typed for it: the boxes and seats come from the chart,
// the people from who sits in each seat, the targets from Targets, the sales from the invoices;
// a new channel or team, a person joining, leaving or moving shows by itself and its figures roll
// up to every box above. Search, open all or heads only, zoom; a box opens its details at the side.

import type { TeamBoard, TeamSeatCard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { exactPeso, shortPeso } from "../ceo";
import { TONE, type Tone, toneOf } from "../team/pace";
import { RangePicker, reportRange, short } from "../team/range";
import { TeamSwitch } from "../team/switch";
import { ZoomBox } from "../team/zoom";
import { PageState } from "../ui";

type Unit = TeamBoard["units"][number];
type Figures = {
  sold: number;
  target: number;
  today: number;
  people: number;
  vacant: number;
  territories: number;
};
type Node = {
  key: string;
  unit: Unit | null;
  seat: TeamSeatCard | null;
  name: string;
  sub: string;
  figures: Figures;
  children: Node[];
  path: string[];
};

const RING: Record<Tone, string> = {
  on: "#10b981",
  behind: "#f59e0b",
  far: "#f43f5e",
  none: "#94a3b8",
  vacant: "#cbd5e1",
};
const pct = (figures: Figures) =>
  figures.target ? Math.round((figures.sold / figures.target) * 1000) / 10 : null;

export function SalesTreePage() {
  const [params] = useSearchParams();
  const unit = params.get("unit");
  const { from, to } = reportRange(params);
  const qs = new URLSearchParams();
  if (unit) qs.set("unit", unit);
  qs.set("from", from);
  qs.set("to", to);
  const board = useQuery({
    queryKey: ["team", "board", unit ?? "", from, to],
    queryFn: () => api<TeamBoard>(`/api/team/board${qs.size ? `?${qs}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const [open, setOpen] = useState<Set<string> | "all" | null>(null);
  const [headsOnly, setHeadsOnly] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const [find, setFind] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const tree = useMemo(() => (board.data ? build(board.data, everyone) : []), [board.data, everyone]);
  if (!board.data) return <PageState query={board} what="the sales organisation" />;
  const data = board.data;
  const pace = data.pace;
  const all: Node[] = [];
  const walk = (node: Node) => {
    all.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of tree) walk(root);
  const total = tree.reduce(
    (sum, node) => ({
      sold: sum.sold + node.figures.sold,
      target: sum.target + node.figures.target,
      people: sum.people + node.figures.people,
      vacant: sum.vacant + node.figures.vacant,
    }),
    { sold: 0, target: 0, people: 0, vacant: 0 },
  );
  const dayOf = Math.max(
    1,
    Math.round((Date.parse(`${data.today}T00:00:00Z`) - Date.parse(`${data.from}T00:00:00Z`)) / 86_400_000) + 1,
  );
  const dayCount = data.days;
  const words = find.trim().toLowerCase();
  const hits = words
    ? all.filter((node) =>
        `${node.name} ${node.sub} ${node.seat?.area?.name ?? ""} ${node.seat?.title ?? ""}`
          .toLowerCase()
          .includes(words),
      )
    : [];
  const hitPaths = new Set(hits.flatMap((node) => node.path));
  // Open at first: the top two levels.
  const isOpen = (node: Node, depth: number) =>
    open === "all" ||
    hitPaths.has(node.key) ||
    (open === null ? depth < 2 : open.has(node.key));
  const toggle = (node: Node, depth: number) => {
    const next = new Set(
      open === "all" ? all.map((one) => one.key) : open === null ? all.filter((one) => one.path.length - 1 < 2).map((one) => one.key) : open,
    );
    if (isOpen(node, depth)) next.delete(node.key);
    else next.add(node.key);
    setOpen(next);
  };
  const selected = all.find((node) => node.key === picked) ?? null;

  const box = (node: Node, depth: number) => {
    const share = pct(node.figures);
    const tone: Tone = node.seat && !node.seat.person ? "vacant" : toneOf(node.figures.sold, node.figures.target || null, pace);
    const hit = words && hits.includes(node);
    const kids = headsOnly ? node.children.filter((child) => child.unit) : node.children;
    return (
      <div className="flex items-center" key={node.key}>
        <button
          type="button"
          onClick={() => setPicked(node.key)}
          className={`relative w-60 shrink-0 rounded-xl border px-3 py-2 text-left shadow-sm transition-colors hover:border-brand ${picked === node.key ? "border-brand ring-2 ring-brand/30" : hit ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"} ${node.unit && depth === 0 ? "bg-emerald-900" : "bg-white"}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-[13px] font-semibold ${node.unit && depth === 0 ? "text-white" : "text-slate-900"}`}>
              {node.name}
            </span>
            <span className="shrink-0 text-[12px] font-bold tabular-nums" style={{ color: RING[tone] }}>
              {node.seat && !node.seat.person ? "VACANT" : share === null ? shortPeso(node.figures.sold) : `${share}%`}
            </span>
          </div>
          <div className={`truncate text-[11px] ${node.unit && depth === 0 ? "text-emerald-100" : "text-slate-500"}`}>{node.sub}</div>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-slate-200">
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${Math.min(100, share ?? 0)}%`, background: RING[tone] }}
            />
            {/* The pace mark: where the bar should be by today. */}
            <div className="absolute -top-0.5 h-2.5 w-px bg-slate-500" style={{ left: `${Math.min(100, pace * 100)}%` }} />
          </div>
        </button>
        {kids.length > 0 && (
          <button
            type="button"
            onClick={() => toggle(node, depth)}
            aria-label={isOpen(node, depth) ? `Close ${node.name}` : `Open ${node.name}`}
            className="-ml-2 z-10 grid size-5 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-500 hover:text-slate-900"
          >
            {isOpen(node, depth) ? <Minus className="size-3" /> : <Plus className="size-3" />}
          </button>
        )}
        {kids.length > 0 && isOpen(node, depth) && (
          <div className="ml-4 flex flex-col gap-2 border-l border-slate-300 py-1 pl-5">
            {kids.map((child) => (
              <div key={child.key} className="relative before:absolute before:top-1/2 before:-left-5 before:w-5 before:border-t before:border-slate-300">
                {box(child, depth + 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sales organisation</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            <b className="text-slate-800">{shortPeso(total.sold)}</b> achieved of{" "}
            {total.target ? shortPeso(total.target) : "no target yet"}
            {total.target ? ` · ${Math.round((total.sold / total.target) * 1000) / 10}%` : ""} ·{" "}
            {total.people} people{total.vacant ? ` · ${total.vacant} vacant` : ""} ·{" "}
            {pace < 1 ? `day ${Math.min(dayOf, dayCount)} of ${dayCount}` : `${short(data.from)} – ${short(data.to)}`} ·
            live from the chart, Targets and the invoices
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder="Find a person, team or area"
              className="h-9 w-64 rounded-lg border border-slate-200 bg-white pr-3 pl-8 text-sm"
            />
          </label>
          <button type="button" onClick={() => setOpen("all")} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Open all
          </button>
          <button
            type="button"
            onClick={() => setHeadsOnly(!headsOnly)}
            aria-pressed={headsOnly}
            className={`h-9 rounded-lg border px-3 text-sm font-semibold ${headsOnly ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            Heads only
          </button>
          <button
            type="button"
            onClick={() => setEveryone(!everyone)}
            aria-pressed={everyone}
            className={`h-9 rounded-lg border px-3 text-sm font-semibold ${everyone ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            title="Show the teams that don't sell too (HR, IT, Finance…)"
          >
            Every team
          </button>
        </div>
      </header>
      <TeamSwitch />
      <RangePicker />
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: RING.on }} /> On pace ({Math.round(pace * 100)}% or more by day {Math.min(dayOf, dayCount)})</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: RING.behind }} /> Behind</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: RING.far }} /> Far behind (under half the pace)</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: RING.none }} /> No target</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">VACANT</span> nobody in the seat
        {words && <span className="ml-auto font-semibold text-amber-800">{hits.length} found</span>}
      </div>
      {!total.target && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          No target is set for these days yet, so the boxes show only what was sold. Each head or lead
          types their people's month on{" "}
          <Link to="/targets" className="font-semibold underline">
            Targets
          </Link>{" "}
          and every box here shows its % of target at once, rolled up to the top.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ZoomBox height={680}>
          <div className="flex flex-col gap-4 p-6">{tree.map((root) => box(root, 0))}</div>
        </ZoomBox>
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {selected ? (
            <Details node={selected} pace={pace} day={Math.min(dayOf, dayCount)} days={dayCount} onClose={() => setPicked(null)} unit={unit} />
          ) : (
            <p className="text-sm text-slate-500">
              Press a box to see its target, what it sold, what is left to do, today, its people and
              who under it is doing best.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Details({
  node,
  pace,
  day,
  days,
  onClose,
  unit,
}: {
  node: Node;
  pace: number;
  day: number;
  days: number;
  onClose: () => void;
  unit: string | null;
}) {
  const share = pct(node.figures);
  const tone: Tone = node.seat && !node.seat.person ? "vacant" : toneOf(node.figures.sold, node.figures.target || null, pace);
  const under = [...node.children].sort(
    (a, b) => (pct(b.figures) ?? -1) - (pct(a.figures) ?? -1) || b.figures.sold - a.figures.sold,
  );
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] text-slate-500">{node.path.slice(0, -1).map((key) => key.split(":").slice(2).join(":")).join(" › ")}</div>
          <h2 className="text-lg font-bold text-slate-900">{node.name}</h2>
          <div className="text-[12px] text-slate-500">{node.sub}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-800">
          <X className="size-4" />
        </button>
      </div>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums" style={{ color: RING[tone] }}>
            {node.seat && !node.seat.person ? "VACANT" : share === null ? "—" : `${share}%`}
          </span>
          <span className="text-[13px] text-slate-600">{node.figures.target ? "of the target" : "no target set"}</span>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-slate-200">
          <div className="h-2 rounded-full" style={{ width: `${Math.min(100, share ?? 0)}%`, background: RING[tone] }} />
          <div className="absolute -top-0.5 h-3 w-px bg-slate-600" style={{ left: `${Math.min(100, pace * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          The mark on the bar is the pace: by day {day} of {days}, {Math.round(pace * 100)}% of the target.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[12px]">
        {(
          [
            ["Target", node.figures.target ? exactPeso(node.figures.target) : "—"],
            ["Achieved", exactPeso(node.figures.sold)],
            ["Balance to do", node.figures.target ? exactPeso(Math.max(0, node.figures.target - node.figures.sold)) : "—"],
            ["Today", exactPeso(node.figures.today)],
            ["People under", String(node.figures.people)],
            ["Territories", String(node.figures.territories)],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-2.5 py-2">
            <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</dt>
            <dd className="font-bold text-slate-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {node.seat && (
        <Link
          to={`/my-team/seat/${node.seat.seatId}${unit ? `?unit=${unit}` : ""}`}
          className="inline-block text-[12px] font-semibold text-brand hover:underline"
        >
          Open their page →
        </Link>
      )}
      {under.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Under {node.name} · best first
          </h3>
          <ul className="space-y-1.5">
            {under.map((child) => {
              const childShare = pct(child.figures);
              const childTone: Tone = child.seat && !child.seat.person ? "vacant" : toneOf(child.figures.sold, child.figures.target || null, pace);
              return (
                <li key={child.key} className="text-[12px]">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-semibold text-slate-800">{child.name}</span>
                    <span className="font-bold tabular-nums" style={{ color: RING[childTone] }}>
                      {child.seat && !child.seat.person ? "VACANT" : childShare === null ? shortPeso(child.figures.sold) : `${childShare}%`}
                    </span>
                  </div>
                  <div className="relative mt-0.5 h-1 rounded-full bg-slate-200">
                    <div className="h-1 rounded-full" style={{ width: `${Math.min(100, childShare ?? 0)}%`, background: RING[childTone] }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Live: the chart's seats and who sits in them, the targets typed on Targets, and what Finance
        invoiced (Zoho's history counted for the seat it was sold from).
      </p>
    </div>
  );
}

/** The tree from the board: boxes from the chart, each lead's box named by its lead, people under. */
function build(board: TeamBoard, everyone: boolean): Node[] {
  const units = board.units;
  const ids = new Set(units.map((one) => one.id));
  const seatsOf = new Map<number, TeamSeatCard[]>();
  for (const seat of board.seats) seatsOf.set(seat.unitId, [...(seatsOf.get(seat.unitId) ?? []), seat]);
  // A seat that sells: its work is selling (MedRep, a team's lead, the online desk), or it has a
  // target, or it sold something in the days picked. So a new channel's seats show by themselves.
  const sellingSeat = (seat: TeamSeatCard) =>
    (seat.target ?? 0) > 0 || seat.sold > 0 || /^(medrep|team lead|online desk)$/i.test(seat.moduleLabel);
  const nodeOf = (unit: Unit, path: string[]): Node | null => {
    const key = `u:${unit.id}:${unit.name}`;
    const here = [...path, key];
    const seats = seatsOf.get(unit.id) ?? [];
    const lead = seats.find((seat) => seat.seatId === unit.leadSeatId) ?? null;
    const childUnits = units
      .filter((one) => one.parentId === unit.id)
      .map((one) => nodeOf(one, here))
      .filter((one): one is Node => one !== null);
    const people = seats
      .filter((seat) => seat.seatId !== unit.leadSeatId)
      .filter((seat) => everyone || sellingSeat(seat))
      .sort((a, b) => b.sold - a.sold)
      .map((seat): Node => {
        const seatKey = `s:${seat.seatId}:${seat.person?.name ?? seat.title}`;
        return {
          key: seatKey,
          unit: null,
          seat,
          name: seat.person?.name ?? "VACANT",
          sub: [seat.title, seat.area?.name].filter(Boolean).join(" · "),
          figures: {
            sold: seat.sold,
            target: seat.target ?? 0,
            today: seat.today,
            people: seat.person ? 1 : 0,
            vacant: seat.person ? 0 : 1,
            territories: seat.area ? 1 : 0,
          },
          children: [],
          path: [...here, seatKey],
        };
      });
    const children = [...childUnits, ...people];
    const leadFigures: Figures = lead
      ? {
          sold: lead.sold,
          target: lead.target ?? 0,
          today: lead.today,
          people: lead.person ? 1 : 0,
          vacant: lead.person ? 0 : 1,
          territories: lead.area ? 1 : 0,
        }
      : { sold: 0, target: 0, today: 0, people: 0, vacant: 0, territories: 0 };
    const figures = children.reduce(
      (sum, child) => ({
        sold: sum.sold + child.figures.sold,
        target: sum.target + child.figures.target,
        today: sum.today + child.figures.today,
        people: sum.people + child.figures.people,
        vacant: sum.vacant + child.figures.vacant,
        territories: sum.territories + child.figures.territories,
      }),
      leadFigures,
    );
    const sells = everyone || figures.people + figures.vacant > 0 && (figures.target > 0 || figures.sold > 0 || children.length > 0);
    if (!sells && !everyone) return null;
    if (!everyone && children.length === 0 && !(lead && sellingSeat(lead))) return null;
    const leadName = lead?.person?.name ?? (lead ? (lead.acting ? `${lead.acting.name} (covering)` : "No lead yet") : null);
    return {
      key,
      unit,
      seat: null,
      name: leadName && leadName !== "No lead yet" ? `${unit.name} · ${leadName}` : unit.name,
      sub: [
        lead?.title,
        `${figures.people} ${figures.people === 1 ? "person" : "people"}`,
        figures.vacant ? `${figures.vacant} vacant` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      figures,
      children,
      path: here,
    };
  };
  return units
    .filter((one) => one.parentId === null || !ids.has(one.parentId))
    .map((one) => nodeOf(one, []))
    .filter((one): one is Node => one !== null);
}
