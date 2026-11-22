// The sales organisation, full screen (Aryan, 19 Nov: "make it as the photo I sent: its colours,
// its size, it zoomed well, hovering opened its data; open it full screen"): the old CRM's sales
// tree (docs/prototypes/sales-tree.html, 10 Nov) and its company org chart, on the CRM's own live
// data. Two looks: the Tree (left to right: the CEO, each head, their channels and teams, each
// team's coach, their people) and the Org chart (top down, the same boxes as rings). Every box shows
// what it sold against its month's target at the CRM's one pace; hover shows its figures, a press
// opens them at the side; drag to move, the wheel or − / + to zoom, Fit to see it all.
// Nothing is typed for it: the boxes and seats come from the chart, the people from who sits in each
// seat, the targets from Targets, the sales from the invoices, so a new channel, a person joining,
// leaving or moving shows by itself, and every figure rolls up to the boxes above.

import type { OrgSeat, OrgTree, OrgUnit, TeamBoard, TeamSeatCard } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize, Minus, Plus, Search, X } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { exactPeso, shortPeso } from "../ceo";
import { OrgPops, type Pop } from "../org/teams";
import { lookAs } from "../shell";
import { type Tone, toneOf } from "../team/pace";
import { reportRange } from "../team/range";
import { PageState } from "../ui";

type Unit = TeamBoard["units"][number];
export type Figures = { sold: number; target: number; today: number; people: number; vacant: number; territories: number };
type Level = "root" | "head" | "channel" | "manager" | "person";
export type Node = {
  key: string;
  level: Level;
  unit: Unit | null;
  seat: TeamSeatCard | null;
  name: string;
  sub: string;
  /** The circle's letters in the Org chart (a channel's code, a person's initial). */
  code: string;
  /** The colour of the head's part of the company (the Org chart's circles). */
  hue: string;
  figures: Figures;
  children: Node[];
  path: string[];
};

// The colours of the old CRM's tree: green on pace, amber a little behind, red behind, grey none.
export const COLOR: Record<Tone, string> = {
  on: "#16a34a",
  behind: "#d97706",
  far: "#dc2626",
  none: "#94a3b8",
  vacant: "#dc2626",
};
// Each head's part of the company in the Org chart (teal, indigo, purple, amber, rose, sky…).
const HUES = ["#0f766e", "#4f46e5", "#9333ea", "#b45309", "#be123c", "#0369a1", "#4d7c0f"];

/** How a box is named on the tree (Aryan, 22 Nov: "the business's name big, its head or manager
 *  smaller: the business is the main thing"): a business, a channel or a team by its own name,
 *  with who heads or manages it small under it; a person's box by the person. Only how it is
 *  written: the tree's data (and the pages that share it) is as it was. */
export function face(node: Node): { big: string; small: string } {
  const unit = node.unit;
  if (!unit || node.level === "person") return { big: node.name, small: node.sub };
  const parts = node.sub.split(" · ").filter(Boolean);
  if (node.level === "root" || node.level === "head")
    return node.name === unit.name
      ? { big: node.name, small: node.sub }
      : { big: unit.name, small: [node.name, ...parts.filter((part) => part !== unit.name)].join(" · ") };
  if (node.level === "channel") {
    // One manager for the whole channel (RX Business · Honey): said on the channel's own box.
    const only = node.children.length === 1 && node.children[0]?.level === "manager" ? node.children[0].name : null;
    return { big: node.name, small: [only, ...parts].filter(Boolean).join(" · ") };
  }
  // A manager: of a team inside a channel (HOSP's NCR 1), the team's name with the manager under
  // it; the channel's own manager stays a person's box under the channel.
  const team = node.key === `m:${unit.id}` && !node.path.includes(`u:${unit.id}`);
  return team ? { big: unit.name, small: [node.name, ...parts].join(" · ") } : { big: node.name, small: node.sub };
}

export const pctOf = (figures: Figures) =>
  figures.target ? Math.round((figures.sold / figures.target) * 1000) / 10 : null;
export const toneOfNode = (node: Node, pace: number): Tone =>
  node.seat && !node.seat.person ? "vacant" : toneOf(node.figures.sold, node.figures.target || null, pace);
const people_ = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/** A channel's letters: its capitals' word (RX, CLIDP, B2B, NCR), else the words' first letters. */
function codeOf(name: string): string {
  const caps = name.split(/[\s&·,-]+/).find((word) => /^[A-Z0-9]{2,6}$/.test(word));
  if (caps) return caps;
  const camel = name.replace(/[^A-Z]/g, "");
  if (camel.length >= 2 && camel.length <= 4) return camel;
  const words = name.split(/\s+/).filter((word) => /^[A-Za-z]/.test(word));
  return words.length > 1
    ? words
        .slice(0, 3)
        .map((word) => word[0]?.toUpperCase())
        .join("")
    : name.slice(0, 3).toUpperCase();
}
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function SalesTreePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const unit = params.get("unit");
  const look = params.get("look") === "chart" ? "chart" : "tree";
  const { from, to } = reportRange(params);
  const qs = new URLSearchParams();
  if (unit) qs.set("unit", unit);
  qs.set("from", from);
  qs.set("to", to);
  const board = useQuery({
    queryKey: ["team", "board", unit ?? "", from, to],
    queryFn: () => api<TeamBoard>(`/api/team/board?${qs}`),
    placeholderData: (previous) => previous,
  });
  const [open, setOpen] = useState<Set<string> | "all" | null>(null);
  const [headsOnly, setHeadsOnly] = useState(false);
  // The seats that don't sell (Finance, Dispatch, HR, IT…) are on the same tree: shown when asked,
  // and always while positions are edited, so everyone's place is set here (Aryan, 23 Nov).
  const [everyone, setEveryone] = useState(params.get("all") === "1");
  const [find, setFind] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const tree = useMemo(() => (board.data ? build(board.data, everyone) : null), [board.data, everyone]);
  // The one place the company's tree is changed (Aryan, 20 Nov: "one place where I finalise who is
  // under whom, and the whole software uses it"): the CEO and the Admin change it from a box's
  // panel, with the same windows as the Admin's Teams & people; every other screen reads it.
  const me = useMe().data;
  const canChange = me?.role === "ceo" || me?.role === "admin";
  const org = useQuery({ queryKey: ["org"], queryFn: () => api<OrgTree>("/api/org"), enabled: canChange });
  const [pop, setPop] = useState<Pop | null>(null);
  // Changing is one button on top (Aryan, 20 Nov: "an Edit button; otherwise the normal data, no
  // clutter"): off, a box's panel is its figures as before; on, it has the changes.
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const queries = useQueryClient();
  const orgStamp = useRef(0);
  // A change saved: the tree is read again.
  useEffect(() => {
    if (!org.dataUpdatedAt) return;
    if (orgStamp.current && orgStamp.current !== org.dataUpdatedAt) void queries.invalidateQueries({ queryKey: ["team"] });
    orgStamp.current = org.dataUpdatedAt;
  }, [org.dataUpdatedAt, queries]);

  // Esc closes the side panel, then the page (a window open on top closes itself).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || pop) return;
      if (picked) setPicked(null);
      else navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, navigate, pop]);

  if (!board.data || !tree)
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[#f6f7f9]">
        <PageState query={board} what="the sales organisation" />
      </div>
    );
  const data = board.data;
  const pace = data.pace;
  const all: Node[] = [];
  const walk = (node: Node) => {
    all.push(node);
    for (const child of node.children) walk(child);
  };
  walk(tree);
  const dayOf = Math.max(
    1,
    Math.min(data.days, Math.round((Date.parse(`${data.today}T00:00:00Z`) - Date.parse(`${data.from}T00:00:00Z`)) / 86_400_000) + 1),
  );
  const month = new Date(`${data.from}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
  const words = find.trim().toLowerCase();
  const hits = words
    ? all.filter((node) =>
        `${node.name} ${node.sub} ${node.seat?.area?.name ?? ""} ${node.seat?.title ?? ""}`.toLowerCase().includes(words),
      )
    : [];
  const hitKeys = new Set(hits.map((node) => node.key));
  const hitPaths = new Set(hits.flatMap((node) => node.path));
  // Open at first: down to the channels (the photo's first look); a found box opens its way down.
  const isOpen = (node: Node) =>
    open === "all" || hitPaths.has(node.key) || (open === null ? node.level === "root" || node.level === "head" : open.has(node.key));
  const toggle = (node: Node) => {
    const next = new Set(
      open === "all"
        ? all.map((one) => one.key)
        : open === null
          ? all.filter((one) => one.level === "root" || one.level === "head").map((one) => one.key)
          : open,
    );
    if (isOpen(node)) next.delete(node.key);
    else next.add(node.key);
    setOpen(next);
  };
  const kidsOf = (node: Node) =>
    headsOnly ? node.children.filter((child) => child.level !== "person") : node.children;
  const selected = all.find((node) => node.key === picked) ?? null;
  const hovered = hover ? all.find((node) => node.key === hover.key) : null;
  const farLine = Math.round((pace / 2) * 100);
  const paceLine = Math.round(pace * 100);
  const props: ViewProps = {
    pace,
    isOpen,
    toggle,
    kidsOf,
    picked,
    hitKeys,
    onPick: (node) => setPicked(node.key),
    onHover: (node, event) => setHover(node && event ? { key: node.key, x: event.clientX, y: event.clientY } : null),
  };
  const setLook = (next: "tree" | "chart") => {
    const nextParams = new URLSearchParams(params);
    if (next === "chart") nextParams.set("look", "chart");
    else nextParams.delete("look");
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f6f7f9]">
      {/* The bar on top: what it is, find, open all, heads only, the zoom (in the canvas), the look. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">Company tree</h1>
          <p className="text-[13px] text-slate-500">
            Who is under whom{editing ? ": press a box to change it, every screen follows" : ""} · {month} ·{" "}
            {pace < 1 ? `day ${dayOf} of ${data.days}` : "the whole month"} ·{" "}
            <b className="text-slate-800">{shortPeso(tree.figures.sold)}</b> of{" "}
            {tree.figures.target ? shortPeso(tree.figures.target) : "no target yet"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder="Find a person, territory, team"
              className="h-10 w-72 rounded-xl border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          {canChange && (
            <Toggle
              on={editing}
              onClick={() => {
                if (!editing) setEveryone(true);
                setEditing(!editing);
              }}
              title="Move people, change a job, add or close a seat or a team: sales and non-sales"
            >
              {editing ? "Done editing" : "Edit positions"}
            </Toggle>
          )}
          <Toggle on={false} onClick={() => setOpen("all")}>
            Open all
          </Toggle>
          <Toggle on={headsOnly} onClick={() => setHeadsOnly(!headsOnly)}>
            Heads only
          </Toggle>
          <Toggle on={everyone} onClick={() => setEveryone(!everyone)} title="The teams that don't sell too (Finance, Dispatch, Inventory, HR, IT…)">
            Non-sales seats too
          </Toggle>
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Look">
            {(
              [
                ["tree", "Tree"],
                ["chart", "Org chart"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={look === key}
                onClick={() => setLook(key)}
                className={`h-9 rounded-lg px-3 text-sm font-semibold ${look === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            title="The whole screen"
            aria-label="The whole screen"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
            className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <Maximize className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={() => navigate(-1)}
            className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-white px-5 py-2 text-[13px] text-slate-600">
        <Legend color={COLOR.on}>On pace ({paceLine}% or more by day {dayOf})</Legend>
        <Legend color={COLOR.behind}>A little behind ({farLine}–{paceLine}%)</Legend>
        <Legend color={COLOR.far}>Behind (under {farLine}%)</Legend>
        <Legend color={COLOR.none}>No target</Legend>
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-600">VACANT</span> nobody in the seat
        </span>
        {words && <span className="ml-auto font-semibold text-amber-700">{hits.length} found</span>}
      </div>

      <div className="relative min-h-0 flex-1">
        <Canvas key={`${look}:${everyone}`}>
          {look === "tree" ? <TreeBox node={tree} {...props} /> : <ChartTop node={tree} {...props} />}
        </Canvas>
        {selected && (
          <Details
            node={selected}
            all={all}
            pace={pace}
            day={dayOf}
            days={data.days}
            month={month.split(" ")[0] ?? ""}
            unit={unit}
            onPick={(node) => setPicked(node.key)}
            onClose={() => setPicked(null)}
            change={canChange && editing && org.data ? { tree: org.data, open: setPop } : null}
          />
        )}
        {org.data && <OrgPops tree={org.data} pop={pop} setPop={setPop} />}
        {hovered && hover && !picked && <Hover node={hovered} pace={pace} x={hover.x} y={hover.y} />}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`h-10 rounded-xl border px-4 text-sm font-semibold ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
    >
      {children}
    </button>
  );
}

function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-3 rounded-[4px]" style={{ background: color }} />
      {children}
    </span>
  );
}

/** The space the tree sits on: drag to move it, the wheel or − / + to zoom, Fit to see it all. */
function Canvas({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, scale: 0.85 });
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const fit = () => {
    const box = outer.current?.getBoundingClientRect();
    const content = inner.current;
    if (!box || !content) return;
    const width = content.scrollWidth;
    const height = content.scrollHeight;
    const scale = Math.max(0.2, Math.min(1.2, Math.min((box.width - 80) / width, (box.height - 80) / height)));
    setView({ scale, x: (box.width - width * scale) / 2, y: Math.max(24, (box.height - height * scale) / 2) });
  };
  // Fitted when it opens, once its boxes are drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only once, on opening
  useEffect(() => {
    const timer = setTimeout(fit, 60);
    return () => clearTimeout(timer);
  }, []);
  const zoomAt = (factor: number, cx?: number, cy?: number) =>
    setView((now) => {
      const box = outer.current?.getBoundingClientRect();
      const px = cx ?? (box ? box.width / 2 : 0);
      const py = cy ?? (box ? box.height / 2 : 0);
      const scale = Math.max(0.15, Math.min(2.5, now.scale * factor));
      const k = scale / now.scale;
      return { scale, x: px - (px - now.x) * k, y: py - (py - now.y) * k };
    });
  useEffect(() => {
    const element = outer.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button,a,input")) return;
    drag.current = { x: event.clientX, y: event.clientY, from: { x: view.x, y: view.y } };
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setView((now) => ({ ...now, x: start.from.x + event.clientX - start.x, y: start.from.y + event.clientY - start.y }));
  };
  return (
    <div
      ref={outer}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null;
      }}
      className="absolute inset-0 cursor-grab touch-none overflow-hidden select-none bg-[radial-gradient(circle,#dfe3e8_1px,transparent_1px)] [background-size:22px_22px] active:cursor-grabbing"
    >
      <div
        ref={inner}
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {children}
      </div>
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2)} className="grid size-10 place-items-center text-slate-700 hover:bg-slate-50">
            <Minus className="size-4" />
          </button>
          <span className="w-14 text-center text-sm font-semibold text-slate-700 tabular-nums">{Math.round(view.scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.2)} className="grid size-10 place-items-center text-slate-700 hover:bg-slate-50">
            <Plus className="size-4" />
          </button>
        </div>
        <button type="button" onClick={fit} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
          Fit
        </button>
      </div>
    </div>
  );
}

type ViewProps = {
  pace: number;
  isOpen: (node: Node) => boolean;
  toggle: (node: Node) => void;
  kidsOf: (node: Node) => Node[];
  picked: string | null;
  hitKeys: Set<string>;
  onPick: (node: Node) => void;
  onHover: (node: Node | null, event?: ReactMouseEvent) => void;
};

/** A box's own look in the Tree: the CEO dark green, channels mint, everyone else white. */
function Card({ node, pace, picked, hitKeys, onPick, onHover }: { node: Node } & ViewProps) {
  const share = pctOf(node.figures);
  const tone = toneOfNode(node, pace);
  const root = node.level === "root";
  const vacant = Boolean(node.seat && !node.seat.person);
  return (
    <button
      type="button"
      onClick={() => onPick(node)}
      onMouseMove={(event) => onHover(node, event)}
      onMouseLeave={() => onHover(null)}
      className={`relative w-[250px] shrink-0 rounded-[14px] border px-4 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:-translate-y-px hover:shadow-md ${
        root
          ? "border-emerald-900 bg-[#0f5c46] text-white"
          : node.level === "channel"
            ? "border-emerald-100 bg-[#eaf6f0]"
            : "border-slate-200 bg-white"
      } ${picked === node.key ? "ring-2 ring-emerald-500" : hitKeys.has(node.key) ? "ring-2 ring-amber-400" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-[15px] font-semibold ${root ? "text-white" : "text-slate-900"}`}>{face(node).big}</span>
        <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: root ? "#ffffff" : COLOR[tone] }}>
          {vacant ? "VACANT" : share === null ? shortPeso(node.figures.sold) : `${share}%`}
        </span>
      </div>
      <div className={`mt-0.5 truncate text-[12px] ${root ? "text-emerald-100" : "text-slate-500"}`}>{face(node).small}</div>
      <div className={`relative mt-2.5 h-[5px] rounded-full ${root ? "bg-white/25" : "bg-slate-200"}`}>
        <div className="h-[5px] rounded-full" style={{ width: `${Math.min(100, share ?? 0)}%`, background: root ? "#ffffff" : COLOR[tone] }} />
        {/* The pace mark: where the bar should be by today. */}
        <div className={`absolute -top-[3px] h-[11px] w-[2px] rounded ${root ? "bg-white/70" : "bg-slate-400"}`} style={{ left: `${Math.min(100, pace * 100)}%` }} />
      </div>
    </button>
  );
}

/** The Tree, left to right: a box, its open button, its children in a column joined by a line. */
function TreeBox({ node, ...props }: { node: Node } & ViewProps) {
  const kids = props.kidsOf(node);
  const open = kids.length > 0 && props.isOpen(node);
  return (
    <div className="flex items-center">
      <Card node={node} {...props} />
      {kids.length > 0 && (
        <button
          type="button"
          onClick={() => props.toggle(node)}
          aria-label={open ? `Close ${node.name}` : `Open ${node.name}`}
          className="z-10 -ml-2.5 grid size-6 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm hover:text-slate-900"
        >
          {open ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
        </button>
      )}
      {open && (
        <div className="relative ml-8 flex flex-col gap-4 py-1">
          {kids.map((child, index) => (
            <div key={child.key} className="relative pl-8">
              {/* The elbow: from the column's line to this box. */}
              <span className="absolute top-1/2 left-0 h-px w-8 bg-slate-300" />
              <span
                className={`absolute left-0 w-px bg-slate-300 ${kids.length === 1 ? "top-1/2 h-0" : index === 0 ? "top-1/2 bottom-[-8px]" : index === kids.length - 1 ? "top-[-8px] bottom-1/2" : "top-[-8px] bottom-[-8px]"}`}
              />
              <TreeBox node={child} {...props} />
            </div>
          ))}
          {/* From the parent's open button to the column. */}
          <span className="absolute top-1/2 -left-8 h-px w-8 bg-slate-300" />
        </div>
      )}
    </div>
  );
}

/** A ring round a circle: how far the target is along, in its colour. */
function Ring({ node, pace, size, children, fill }: { node: Node; pace: number; size: number; children: ReactNode; fill: string }) {
  const share = pctOf(node.figures);
  const tone = toneOfNode(node, pace);
  const radius = size / 2 - 3;
  const length = 2 * Math.PI * radius;
  const shown = Math.min(1, (share ?? 0) / 100);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill={fill} stroke="#e2e8f0" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={node.seat && !node.seat.person ? COLOR.vacant : COLOR[tone]}
          strokeWidth={3}
          strokeDasharray={node.seat && !node.seat.person ? "3 3" : `${length * shown} ${length}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="relative">{children}</span>
    </div>
  );
}

/** The Org chart, top down: each head with their channels below, each channel's coach, their people. */
function ChartTop({ node, ...props }: { node: Node } & ViewProps) {
  // The CEO on top, the heads in a row under.
  const heads = props.kidsOf(node);
  return (
    <div className="flex flex-col items-center gap-10 p-6">
      <div className="flex flex-col items-center">
        <ChartLabel node={node} {...props} big />
        <span className="h-6 w-px bg-slate-300" />
      </div>
      <div className="-mt-10 flex items-start">
        {heads.map((head, index) => (
          <div key={head.key} className="relative flex flex-col items-center px-7">
            {heads.length > 1 && (
              <span
                className="absolute top-0 h-px bg-slate-300"
                style={{ left: index === 0 ? "50%" : 0, right: index === heads.length - 1 ? "50%" : 0 }}
              />
            )}
            <span className="h-6 w-px bg-slate-300" />
            <ChartNode node={head} {...props} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartLabel({ node, pace, onPick, onHover, picked, hitKeys, big }: { node: Node; big?: boolean } & ViewProps) {
  const share = pctOf(node.figures);
  const tone = toneOfNode(node, pace);
  return (
    <button
      type="button"
      onClick={() => onPick(node)}
      onMouseMove={(event) => onHover(node, event)}
      onMouseLeave={() => onHover(null)}
      className={`rounded-xl px-3 py-1 text-center ${picked === node.key ? "ring-2 ring-emerald-500" : hitKeys.has(node.key) ? "ring-2 ring-amber-400" : ""}`}
    >
      <div className={`${big ? "text-[18px]" : "text-[15px]"} font-semibold text-slate-900`}>{face(node).big}</div>
      <div className="text-[12px] text-slate-500">{face(node).small}</div>
      <div className="text-[13px] font-bold tabular-nums" style={{ color: COLOR[tone] }}>
        {share === null ? shortPeso(node.figures.sold) : `${share}%`}
      </div>
    </button>
  );
}

function ChartNode({ node, ...props }: { node: Node } & ViewProps) {
  const { pace, onPick, onHover, picked, hitKeys } = props;
  const kids = props.kidsOf(node);
  const share = pctOf(node.figures);
  const tone = toneOfNode(node, pace);
  const vacant = Boolean(node.seat && !node.seat.person);
  // The people under a coach: a list, as the old chart drew them.
  if (node.level === "person")
    return (
      <button
        type="button"
        onClick={() => onPick(node)}
        onMouseMove={(event) => onHover(node, event)}
        onMouseLeave={() => onHover(null)}
        className={`flex w-[170px] items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-white ${picked === node.key ? "ring-2 ring-emerald-500" : hitKeys.has(node.key) ? "ring-2 ring-amber-400" : ""}`}
      >
        <Ring node={node} pace={pace} size={34} fill="#ffffff">
          <span className="text-[11px] font-bold" style={{ color: node.hue }}>
            {vacant ? "–" : node.code}
          </span>
        </Ring>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-slate-900">{face(node).big}</span>
          <span className="block truncate text-[11px] text-slate-500">{face(node).small}</span>
        </span>
        <span className="text-[12px] font-bold tabular-nums" style={{ color: COLOR[tone] }}>
          {vacant ? "" : share === null ? "" : `${share}%`}
        </span>
      </button>
    );
  const people = kids.filter((one) => one.level === "person");
  const groups = kids.filter((one) => one.level !== "person");
  const circle = node.level === "head" ? null : node.level === "channel" ? 58 : 50;
  return (
    <div className="flex flex-col items-center">
      {circle ? (
        <button
          type="button"
          onClick={() => onPick(node)}
          onMouseMove={(event) => onHover(node, event)}
          onMouseLeave={() => onHover(null)}
          className={`flex flex-col items-center rounded-xl px-2 py-1 ${picked === node.key ? "ring-2 ring-emerald-500" : hitKeys.has(node.key) ? "ring-2 ring-amber-400" : ""}`}
        >
          <Ring node={node} pace={pace} size={circle} fill={node.level === "channel" ? node.hue : "#f8fafc"}>
            <span className={`font-bold ${node.level === "channel" ? "text-[13px] text-white" : "text-[17px]"}`} style={node.level === "channel" ? undefined : { color: node.hue }}>
              {node.code}
            </span>
          </Ring>
          <span className="mt-1.5 max-w-[160px] truncate text-[14px] font-semibold text-slate-900">{face(node).big}</span>
          <span className="max-w-[170px] truncate text-[11px] text-slate-500">{face(node).small}</span>
          <span className="text-[12px] font-bold tabular-nums" style={{ color: COLOR[tone] }}>
            {share === null ? shortPeso(node.figures.sold) : `${share}%`}
          </span>
        </button>
      ) : (
        <ChartLabel node={node} {...props} />
      )}
      {kids.length > 0 && (
        <>
          <span className="h-6 w-px" style={{ background: `${node.hue}66` }} />
          {groups.length > 0 && (
            <div className="flex items-start">
              {groups.map((group, index) => (
                <div key={group.key} className="relative flex flex-col items-center px-4">
                  {/* Its part of the bar joining the children, then down to it. */}
                  {groups.length > 1 && (
                    <span
                      className="absolute top-0 h-px"
                      style={{
                        background: `${node.hue}66`,
                        left: index === 0 ? "50%" : 0,
                        right: index === groups.length - 1 ? "50%" : 0,
                      }}
                    />
                  )}
                  {groups.length > 1 && <span className="h-5 w-px" style={{ background: `${node.hue}66` }} />}
                  <ChartNode node={group} {...props} />
                </div>
              ))}
            </div>
          )}
          {people.length > 0 && (
            <div className={`flex flex-col gap-1 border-l-2 pl-2 ${groups.length ? "mt-6" : ""}`} style={{ borderColor: `${node.hue}40` }}>
              {people.map((person) => (
                <ChartNode key={person.key} node={person} {...props} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** What a box holds, on hover. */
function Hover({ node, pace, x, y }: { node: Node; pace: number; x: number; y: number }) {
  const share = pctOf(node.figures);
  const tone = toneOfNode(node, pace);
  const left = Math.min(x + 16, window.innerWidth - 280);
  const top = Math.min(y + 16, window.innerHeight - 190);
  return (
    <div className="pointer-events-none fixed z-[60] w-[260px] rounded-xl border border-slate-200 bg-white p-3 text-[12px] shadow-lg" style={{ left, top }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[14px] font-semibold text-slate-900">{face(node).big}</span>
        <span className="font-bold tabular-nums" style={{ color: COLOR[tone] }}>
          {node.seat && !node.seat.person ? "VACANT" : share === null ? "—" : `${share}%`}
        </span>
      </div>
      <div className="truncate text-slate-500">{face(node).small}</div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-slate-500">Target</dt>
        <dd className="text-right font-semibold tabular-nums">{node.figures.target ? shortPeso(node.figures.target) : "—"}</dd>
        <dt className="text-slate-500">Achieved</dt>
        <dd className="text-right font-semibold tabular-nums">{shortPeso(node.figures.sold)}</dd>
        <dt className="text-slate-500">Today</dt>
        <dd className="text-right font-semibold tabular-nums">{shortPeso(node.figures.today)}</dd>
        <dt className="text-slate-500">People</dt>
        <dd className="text-right font-semibold tabular-nums">
          {node.figures.people}
          {node.figures.vacant ? ` · ${node.figures.vacant} vacant` : ""}
        </dd>
      </dl>
      <div className="mt-1.5 text-[11px] text-slate-400">Press it for everything.</div>
    </div>
  );
}

/** A box's figures at the side, as the old tree's panel. */
const PLACE_BUTTON = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50";

/** Where a box sits in the company (who is above it, what it leads, the work its login does) and,
 *  for the CEO and the Admin, the changes: move or change the job, add under, fill, leave, close;
 *  a team's name and place, a team under it. Saved, every screen of the software follows. */
function Place({ node, all, change }: { node: Node; all: Node[]; change: { tree: OrgTree; open: (pop: Pop) => void } | null }) {
  const queries = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const seat = node.seat;
  // Who is above: the nearest person up the line who is not them.
  const above = node.path
    .slice(0, -1)
    .map((key) => all.find((one) => one.key === key))
    .filter((one): one is Node => Boolean(one))
    .reverse();
  const boss = above.find((one) => (one.seat?.person || one.level === "root") && one.name !== node.name);
  const box = above.find((one) => one.level === "channel" || one.level === "head");
  const found = change && seat ? change.tree.units.flatMap((one) => one.seats.map((orgSeat) => ({ orgSeat, orgUnit: one }))).find((one) => one.orgSeat.id === seat.seatId) : undefined;
  const orgSeat: OrgSeat | undefined = found?.orgSeat;
  const seatUnit: OrgUnit | undefined = found?.orgUnit;
  const orgUnit: OrgUnit | undefined = change && node.unit ? change.tree.units.find((one) => one.id === node.unit?.id) : undefined;
  const leadsNothing = Boolean(seat && !seat.lead && (seat.moduleLabel === "Team lead" || seat.moduleLabel === "Head"));
  const lines: [string, string][] = [
    ...(seat ? ([["Seat", [seat.title, seat.login].filter(Boolean).join(" · ")]] as [string, string][]) : []),
    ...(boss && node.level !== "root" ? ([[seat ? "Reports to" : "Under", boss.name]] as [string, string][]) : []),
    ...(seat?.lead && node.unit ? ([["Leads", node.unit.name]] as [string, string][]) : []),
    ...(seat && !seat.lead && box ? ([["Team", box.unit?.name ?? box.name]] as [string, string][]) : []),
    ...(seat ? ([["Their screens", seat.moduleLabel]] as [string, string][]) : []),
  ];
  // Not editing: the panel is its figures, as before; only a seat whose screens don't match its
  // place says so.
  if (!change)
    return leadsNothing ? (
      <p className="mt-4 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900">
        Has a {seat?.moduleLabel === "Head" ? "head's" : "team lead's"} screens but leads no team on the tree.
      </p>
    ) : null;
  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-3.5">
      <dl className="space-y-1 text-[13px]">
        {lines.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
            <dd className="min-w-0 font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      {leadsNothing && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900">
          Has a {seat?.moduleLabel === "Head" ? "head's" : "team lead's"} screens but leads no team on the tree. Change the job
          below if that is not meant.
        </p>
      )}
      {change && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {orgSeat && seatUnit && orgSeat.holder && (
            <>
              <button type="button" className={PLACE_BUTTON} onClick={() => change.open({ kind: "seat", unit: seatUnit, seat: orgSeat })}>
                Move or change the job
              </button>
              <button type="button" className={PLACE_BUTTON} onClick={() => change.open({ kind: "add", unit: seatUnit, reportsTo: orgSeat.id })}>
                Add someone under
              </button>
              <button type="button" className={PLACE_BUTTON} onClick={() => orgSeat.holder && void lookAs(orgSeat.holder.personId)}>
                See their screens
              </button>
              <button
                type="button"
                className={`${PLACE_BUTTON} text-rose-700`}
                onClick={() => orgSeat.holder && change.open({ kind: "leave", holder: orgSeat.holder })}
              >
                No longer with us
              </button>
            </>
          )}
          {orgSeat && seatUnit && !orgSeat.holder && (
            <>
              <button type="button" className={PLACE_BUTTON} onClick={() => change.open({ kind: "add", unit: seatUnit, seat: orgSeat })}>
                Fill this seat
              </button>
              <button type="button" className={PLACE_BUTTON} onClick={() => change.open({ kind: "seat", unit: seatUnit, seat: orgSeat })}>
                Move or change the seat
              </button>
              <button
                type="button"
                className={`${PLACE_BUTTON} text-rose-700`}
                onClick={async () => {
                  if (!window.confirm("Close this empty seat? Its customers stay on record.")) return;
                  try {
                    setProblem(null);
                    await api(`/api/org/seats/${orgSeat.id}/close`, { body: {} });
                    await queries.invalidateQueries({ queryKey: ["org"] });
                  } catch (error) {
                    setProblem(error instanceof Error ? error.message : "That didn't save.");
                  }
                }}
              >
                Close this seat
              </button>
            </>
          )}
          {orgUnit && (
            <>
              {!seat && (
                <button type="button" className={PLACE_BUTTON} onClick={() => change.open({ kind: "add", unit: orgUnit })}>
                  Add someone here
                </button>
              )}
              <button type="button" className={PLACE_BUTTON} onClick={() => change.open({ kind: "unit", unit: orgUnit })}>
                Change this team
              </button>
              <button type="button" className={PLACE_BUTTON} onClick={() => change.open({ kind: "unit", parent: orgUnit, team: true })}>
                Add a team under it
              </button>
            </>
          )}
        </div>
      )}
      {problem && <p className="mt-2 text-[12.5px] text-rose-700">{problem}</p>}
    </div>
  );
}

function Details({
  node,
  all,
  pace,
  day,
  days,
  month,
  unit,
  onPick,
  onClose,
  change,
}: {
  node: Node;
  all: Node[];
  pace: number;
  day: number;
  days: number;
  month: string;
  unit: string | null;
  onPick: (node: Node) => void;
  onClose: () => void;
  /** The CEO and the Admin change the tree from here; null for anyone else. */
  change: { tree: OrgTree; open: (pop: Pop) => void } | null;
}) {
  const share = pctOf(node.figures);
  const tone = toneOfNode(node, pace);
  const vacant = Boolean(node.seat && !node.seat.person);
  const under = [...node.children].sort(
    (a, b) => (pctOf(b.figures) ?? -1) - (pctOf(a.figures) ?? -1) || b.figures.sold - a.figures.sold,
  );
  const trail = node.path
    .slice(0, -1)
    .map((key) => all.find((one) => one.key === key)?.name)
    .filter(Boolean)
    .join(" › ");
  return (
    <aside className="absolute top-4 right-4 bottom-4 z-20 flex w-[400px] max-w-[calc(100%-2rem)] flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {trail && <div className="truncate text-[13px] text-slate-500">{trail}</div>}
          <h2 className="mt-1 text-[22px] font-bold text-slate-900">{face(node).big}</h2>
          <div className="text-[14px] text-slate-500">{face(node).small}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-800">
          <X className="size-5" />
        </button>
      </div>
      <div className="mt-5">
        <div className="flex items-baseline gap-3">
          <span className="text-[40px] leading-none font-bold tabular-nums" style={{ color: COLOR[tone] }}>
            {vacant ? "VACANT" : share === null ? "—" : `${share}%`}
          </span>
          <span className="text-[15px] text-slate-600">{node.figures.target ? `of the ${month} target` : "no target set"}</span>
        </div>
        <div className="relative mt-3 h-2.5 rounded-full bg-slate-200">
          <div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, share ?? 0)}%`, background: COLOR[tone] }} />
          <div className="absolute -top-1 h-[18px] w-[2px] rounded bg-slate-500" style={{ left: `${Math.min(100, pace * 100)}%` }} />
        </div>
        <p className="mt-2 text-[13px] text-slate-500">
          The mark on the bar is the month's pace: by day {day} of {days}, {Math.round(pace * 100)}% of the target.
        </p>
      </div>
      <Place node={node} all={all} change={change} />
      <dl className="mt-4 grid grid-cols-2 gap-3">
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
          <div key={label} className="rounded-xl bg-slate-50 px-3.5 py-3">
            <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</dt>
            <dd className="mt-0.5 text-[17px] font-bold text-slate-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {node.seat && (
        <Link
          to={`/my-team/seat/${node.seat.seatId}${unit ? `?unit=${unit}` : ""}`}
          className="mt-3 inline-block text-[13px] font-semibold text-emerald-700 hover:underline"
        >
          Open their page →
        </Link>
      )}
      {under.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">
            Under {face(node).big} · best first
          </h3>
          <ul className="space-y-2.5">
            {under.map((child) => {
              const childShare = pctOf(child.figures);
              const childTone = toneOfNode(child, pace);
              const childVacant = Boolean(child.seat && !child.seat.person);
              return (
                <li key={child.key}>
                  <button type="button" onClick={() => onPick(child)} className="w-full text-left">
                    <div className="flex justify-between gap-2 text-[14px]">
                      <span className="truncate font-semibold text-slate-800">{face(child).big}</span>
                      <span className="font-bold tabular-nums" style={{ color: COLOR[childTone] }}>
                        {childVacant ? "VACANT" : childShare === null ? shortPeso(child.figures.sold) : `${childShare}%`}
                      </span>
                    </div>
                    <div className="relative mt-1 h-1.5 rounded-full bg-slate-200">
                      <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, childShare ?? 0)}%`, background: COLOR[childTone] }} />
                      <div className="absolute -top-0.5 h-2.5 w-px bg-slate-500" style={{ left: `${Math.min(100, pace * 100)}%` }} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="mt-auto pt-5 text-[12px] text-slate-400">
        Live: the chart's seats and who sits in them, the targets typed on Targets, and what Finance
        invoiced (Zoho's history counted for the seat it was sold from).
      </p>
    </aside>
  );
}

/**
 * The tree from the board, in the sales tracker's levels (Aryan, 19 Nov: "the tracker is God"):
 * the CEO; each Head (a business's lead); their Channels (the boxes right under them, mint); each
 * channel's Manager (its lead; a channel with no lead of its own shows its head, as the tracker's
 * "CLIDP · SUBIR"); the Sales persons. A box inside a channel with its own lead is a manager
 * (HOSP's Julius, Daniel…); one without folds its people into the manager above (RX Business's
 * Uro & Onco and Blood & Bone are Honey's people). People sitting straight under a head are their
 * own channel (Modern Trade's MT, under Mhalou). Every selling seat shows (a MedRep's, the Online
 * desk's, a lead's, a head's, and any other with a target or a sale), an empty one as VACANT; the
 * teams that don't sell when every team is asked for. Every box's figures are the sum of what is
 * under it.
 */
export function build(board: TeamBoard, everyone: boolean): Node {
  const units = board.units;
  const ids = new Set(units.map((one) => one.id));
  const seatsOf = new Map<number, TeamSeatCard[]>();
  for (const seat of board.seats) seatsOf.set(seat.unitId, [...(seatsOf.get(seat.unitId) ?? []), seat]);
  const childrenOf = (unitId: number) => units.filter((one) => one.parentId === unitId);
  // Every selling seat shows, with or without a target or a sale yet (Aryan, 20 Nov: the tree is
  // who is under whom, nobody left out); the teams that don't sell come with "Every team".
  const SELLING = ["MedRep", "Online desk", "Team lead", "Head"];
  const sells = (seat: TeamSeatCard) => everyone || seat.target !== null || seat.sold > 0 || SELLING.includes(seat.moduleLabel);
  const zero: Figures = { sold: 0, target: 0, today: 0, people: 0, vacant: 0, territories: 0 };
  const add = (a: Figures, b: Figures): Figures => ({
    sold: a.sold + b.sold,
    target: a.target + b.target,
    today: a.today + b.today,
    people: a.people + b.people,
    vacant: a.vacant + b.vacant,
    territories: a.territories + b.territories,
  });
  const sum = (nodes: Node[], start: Figures = zero) => nodes.reduce((all, node) => add(all, node.figures), start);
  const seatFigures = (seat: TeamSeatCard): Figures => ({
    sold: seat.sold,
    target: seat.target ?? 0,
    today: seat.today,
    people: seat.person ? 1 : 0,
    vacant: seat.person ? 0 : 1,
    territories: seat.area ? 1 : 0,
  });
  const leadOf = (unit: Unit) => (seatsOf.get(unit.id) ?? []).find((seat) => seat.seatId === unit.leadSeatId) ?? null;
  const nameOf = (seat: TeamSeatCard | null) => seat?.person?.name ?? (seat?.acting ? `${seat.acting.name} (covering)` : null);
  const personNode = (seat: TeamSeatCard, hue: string): Node => ({
    key: `s:${seat.seatId}`,
    level: "person",
    unit: null,
    seat,
    name: seat.person?.name ?? "VACANT",
    sub: seat.area?.name?.split("|").pop()?.trim() || "On site",
    code: initialOf(seat.person?.name ?? "?"),
    hue,
    figures: seatFigures(seat),
    children: [],
    path: [],
  });
  /** A box's own sellers, and those of the boxes inside it with no lead of their own (folded in);
   *  the boxes inside it that have a lead come back as managers. */
  const gather = (unit: Unit, hue: string): { people: Node[]; managers: Node[] } => {
    const people = (seatsOf.get(unit.id) ?? [])
      .filter((seat) => seat.seatId !== unit.leadSeatId && sells(seat))
      .map((seat) => personNode(seat, hue));
    const managers: Node[] = [];
    for (const child of childrenOf(unit.id)) {
      const lead = leadOf(child);
      if (lead && nameOf(lead)) {
        const manager = managerNode(child, lead, hue);
        if (manager) managers.push(manager);
      } else {
        const inner = gather(child, hue);
        people.push(...inner.people);
        managers.push(...inner.managers);
      }
    }
    people.sort((a, b) => b.figures.sold - a.figures.sold);
    return { people, managers };
  };
  /** A manager: the person leading a box, their people (and any managers) under them. */
  const managerNode = (unit: Unit, lead: TeamSeatCard, hue: string, key = `m:${unit.id}`): Node | null => {
    const { people, managers } = gather(unit, hue);
    const kids = [...managers, ...people];
    if (!kids.length && !sells(lead)) return null;
    const figures = sum(kids, lead.target !== null || lead.sold > 0 ? seatFigures(lead) : { ...zero, people: lead.person ? 1 : 0 });
    const name = nameOf(lead) ?? "No manager";
    return {
      key,
      level: "manager",
      unit,
      seat: lead,
      name,
      sub: [lead.title?.replace(/\s*–.*$/, "") || "Manager", people_(figures.people), figures.vacant ? `${figures.vacant} vacant` : null]
        .filter(Boolean)
        .join(" · "),
      code: initialOf(name),
      hue,
      figures,
      children: kids,
      path: [],
    };
  };
  /** A channel: the box right under a head, its manager (its own lead, else the head when nobody
   *  inside leads), and the people. */
  const channelNode = (unit: Unit, head: TeamSeatCard | null, hue: string): Node | null => {
    const lead = leadOf(unit);
    let kids: Node[];
    if (lead && nameOf(lead)) {
      const manager = managerNode(unit, lead, hue);
      kids = manager ? [manager] : [];
    } else {
      const { people, managers } = gather(unit, hue);
      if (!people.length && !managers.length) return null;
      if (managers.length) kids = [...managers, ...people];
      else if (head && nameOf(head) && unit.sheetName) {
        // No lead of its own and nobody inside leading: the head manages it (the tracker's CLIDP · SUBIR).
        // Only where the target sheet has the box as a channel: a box on no sheet row (Patient
        // Assistance, a process with no head; Aryan, 22 Nov) isn't given the head above as its
        // manager, it only sits in that division.
        const figures = sum(people);
        kids = [
          {
            key: `h:${unit.id}`,
            level: "manager",
            unit,
            seat: head,
            name: nameOf(head) ?? "",
            sub: ["Manager", people_(figures.people), figures.vacant ? `${figures.vacant} vacant` : null].filter(Boolean).join(" · "),
            code: initialOf(nameOf(head) ?? "?"),
            hue,
            figures,
            children: people,
            path: [],
          },
        ];
      } else kids = people;
    }
    if (!kids.length) return null;
    const figures = sum(kids);
    return {
      key: `u:${unit.id}`,
      level: "channel",
      unit,
      seat: null,
      // The sheet's own word for the channel (B2B, BID), where its box is named longer (22 Nov).
      name: unit.sheetName ?? unit.name,
      sub: [!lead && !unit.sheetName ? "no head · not on the target sheet" : null, people_(figures.people), figures.vacant ? `${figures.vacant} vacant` : null]
        .filter(Boolean)
        .join(" · "),
      code: codeOf(unit.sheetName ?? unit.name),
      hue,
      figures,
      children: kids,
      path: [],
    };
  };
  // The same tree with every seat, built once when a business has to be read from it.
  let full: Node | null = null;
  const fromFull = (key: string): Node | null => {
    full ??= build(board, true);
    const find = (node: Node): Node | null => (node.key === key ? node : node.children.reduce<Node | null>((found, child) => found ?? find(child), null));
    const found = find(full);
    return found?.children.length ? found : null;
  };
  const headNode = (unit: Unit, hue: string): Node | null => {
    if (!everyone && unit.kind === "department") return null;
    const head = leadOf(unit);
    const channels = childrenOf(unit.id)
      .map((child) => channelNode(child, head, hue))
      .filter((one): one is Node => one !== null);
    // People sitting straight under the head: their own channel, named for the business (Modern
    // Trade's MT), managed by the head.
    const direct = (seatsOf.get(unit.id) ?? [])
      .filter((seat) => seat.seatId !== unit.leadSeatId && sells(seat))
      .map((seat) => personNode(seat, hue))
      .sort((a, b) => b.figures.sold - a.figures.sold);
    if (direct.length) {
      const figures = sum(direct);
      const manager: Node = {
        key: `h:${unit.id}:own`,
        level: "manager",
        unit,
        seat: head,
        name: nameOf(head) ?? unit.name,
        sub: ["Manager", people_(figures.people), figures.vacant ? `${figures.vacant} vacant` : null].filter(Boolean).join(" · "),
        code: initialOf(nameOf(head) ?? unit.name),
        hue,
        figures,
        children: direct,
        path: [],
      };
      channels.push({
        key: `u:${unit.id}:own`,
        level: "channel",
        unit,
        seat: null,
        name: codeOf(unit.name),
        sub: [unit.name, people_(figures.people)].join(" · "),
        code: codeOf(unit.name),
        hue,
        figures,
        children: [manager],
        path: [],
      });
    }
    // A business with nobody selling yet (no target set, no sale: Modern Trade's two empty seats)
    // still shows, with every seat in it (Aryan, 20 Nov: "where is Mhalou's department?"): the
    // tree is who is under whom first, the figures second.
    if (!channels.length && !everyone) return unit.kind === "business" ? fromFull(`u:${unit.id}`) : null;
    const figures = sum(channels, head && (head.target !== null || head.sold > 0) ? seatFigures(head) : zero);
    const headName = nameOf(head);
    return {
      key: `u:${unit.id}`,
      level: "head",
      unit,
      seat: head,
      name: headName ?? unit.name,
      sub: [headName ? unit.name : "No head named", people_(figures.people), figures.vacant ? `${figures.vacant} vacant` : null]
        .filter(Boolean)
        .join(" · "),
      code: codeOf(unit.name),
      hue,
      figures,
      children: channels,
      path: [],
    };
  };
  const rootNode = (unit: Unit): Node => {
    const heads = childrenOf(unit.id)
      .map((child, index) => headNode(child, HUES[index % HUES.length] as string))
      .filter((one): one is Node => one !== null);
    const figures = sum(heads);
    const ceo = board.lead && /ceo|chief executive/i.test(board.lead.title ?? "") ? board.lead.name : null;
    return {
      key: `u:${unit.id}`,
      level: "root",
      unit,
      seat: null,
      name: ceo ?? unit.name,
      sub: [ceo ? "CEO" : null, people_(figures.people), figures.vacant ? `${figures.vacant} vacant` : null].filter(Boolean).join(" · "),
      code: codeOf(unit.name),
      hue: "#0f5c46",
      figures,
      children: heads,
      path: [],
    };
  };
  const withPaths = (node: Node, above: string[]): Node => {
    const path = [...above, node.key];
    return { ...node, path, children: node.children.map((child) => withPaths(child, path)) };
  };
  const roots = units.filter((one) => one.parentId === null || !ids.has(one.parentId));
  // The company on top; a lead looking at their own part of it: their box (and boxes) as the top.
  const built = roots.map((one) =>
    one.kind === "company" ? rootNode(one) : (headNode(one, HUES[0] as string) ?? rootNode(one)),
  );
  if (built.length === 1) return withPaths(built[0] as Node, []);
  const figures = sum(built);
  return withPaths(
    {
      key: "top",
      level: "root",
      unit: null,
      seat: null,
      name: board.lead?.name ?? "Your teams",
      sub: people_(figures.people),
      code: "",
      hue: "#0f5c46",
      figures,
      children: built.map((one) => ({ ...one, level: one.level === "root" ? "head" : one.level })),
      path: [],
    },
    [],
  );
}
