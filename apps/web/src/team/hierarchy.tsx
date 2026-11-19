// A head's and a team lead's team as the sales tracker draws it (Aryan, 19 Nov: "on the Home page a
// tree: whoever comes under him, how much each sold; Subir, then B2B, BID, CLIDP; under B2B
// Domino, what she did; press her and her data opens, and under it her people's"): the lead on
// top, each channel, its manager and the people, each with what they sold against their target on
// the month's pace and the money owed. A press on a channel or a manager opens that channel's own
// work below; a press on a person opens their page.

import type { TeamBoard } from "@2mg/api/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exactPeso, shortPeso } from "../ceo";
import { PACE_TEXT, PaceBar } from "../company/ceo-home";
import { build, type Node, pctOf, toneOfNode } from "../company/sales-tree";

/** What a branch adds up to beyond the tree's own figures: money owed and overdue, orders placed. */
type More = { owed: number; overdue: number; placed: number };

/** The anchor of a channel's own section on the Home (its tracker channel). */
export const channelAnchor = (division: string) => `channel-${division.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** The tracker's channel a branch belongs to: its own box's, else the first box above it with one. */
export const divisionOf = (node: Node): string | null => node.unit?.division ?? null;

/** The tree to show: the levels that only repeat the person above them are left out (a channel
 *  its head manages shows its people straight under it; a team lead's own team, its people). */
function simplify(node: Node): Node {
  const children = node.children.map(simplify).flatMap((child) => {
    // A manager who is the same person as the branch above: their people stand in their place.
    if (child.level === "manager" && child.seat && node.seat && child.seat.person?.id === node.seat.person?.id)
      return child.children;
    return [child];
  });
  // A channel with one manager who is the person above it (CLIDP · Subir under Subir).
  const flat = children.flatMap((child) =>
    child.level === "channel" &&
    child.children.length === 1 &&
    child.children[0]?.level === "manager" &&
    child.children[0].seat?.person?.id !== undefined &&
    child.children[0].seat?.person?.id === node.seat?.person?.id
      ? [{ ...child, children: child.children[0].children }]
      : [child],
  );
  return { ...node, children: flat };
}

export function useTeamTree(board: TeamBoard | undefined): Node | null {
  return useMemo(() => {
    if (!board) return null;
    const built = build(board, false);
    // A lead's single team (their own people only): the lead, then their people.
    const top = simplify(built);
    if (top.level === "head" && top.children.length === 1 && top.children[0]?.level === "channel" && top.children[0].unit?.id === top.unit?.id)
      return { ...top, children: top.children[0].children };
    return top;
  }, [board]);
}

const moreOf = (node: Node): More => {
  if (node.level === "person" && node.seat)
    return { owed: node.seat.owed, overdue: node.seat.overdue, placed: node.seat.placed };
  return node.children.reduce(
    (all, child) => {
      const one = moreOf(child);
      return { owed: all.owed + one.owed, overdue: all.overdue + one.overdue, placed: all.placed + one.placed };
    },
    { owed: 0, overdue: 0, placed: 0 },
  );
};

const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/** The branches open at first: the top and its channels; the managers' people too when the whole
 *  team is small enough to read at once. */
function openAtFirst(top: Node): Set<string> {
  const open = new Set<string>([top.key]);
  const small = top.figures.people <= 20;
  const walk = (node: Node) => {
    for (const child of node.children) {
      if (child.level === "channel" || child.level === "head" || (small && child.level === "manager")) open.add(child.key);
      walk(child);
    }
  };
  walk(top);
  return open;
}

export function TeamTree({
  top,
  pace,
  running,
  onChannel,
}: {
  top: Node;
  pace: number;
  running: boolean;
  /** A channel or a manager pressed: their channel's own work, below. */
  onChannel: (division: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => openAtFirst(top));
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <section aria-labelledby="your-team" className="min-w-0 rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-2 sm:px-5">
        <h2 id="your-team" className="text-sm font-semibold text-slate-900">
          Your team
        </h2>
        <span className="text-xs text-slate-500">
          Sold against target{running ? `, pace ${Math.round(pace * 100)}%` : ""} · press a channel for its work, a
          person for their page
        </span>
      </header>
      <ul className="pb-2" role="tree" aria-labelledby="your-team">
        <Branch node={top} depth={0} pace={pace} running={running} open={open} toggle={toggle} onChannel={onChannel} />
      </ul>
    </section>
  );
}

function Branch({
  node,
  depth,
  pace,
  running,
  open,
  toggle,
  onChannel,
}: {
  node: Node;
  depth: number;
  pace: number;
  running: boolean;
  open: Set<string>;
  toggle: (key: string) => void;
  onChannel: (division: string) => void;
}) {
  const navigate = useNavigate();
  const isOpen = open.has(node.key);
  const hasKids = node.children.length > 0;
  const more = moreOf(node);
  const pct = pctOf(node.figures);
  const tone = toneOfNode(node, pace);
  const barTone = tone === "vacant" ? "far" : tone;
  const division = divisionOf(node);
  const person = node.level === "person";
  const vacant = person && !node.seat?.person;
  // A lead of two boxes (Honey: RX Business, MD Telesales): each box below her name, as a channel.
  const box = node.level === "channel" || (node.level === "head" && depth > 0);
  // What the row opens: a person's page; a channel's or manager's work below; else it folds.
  const press = () => {
    if (person) {
      if (node.seat) navigate(`/my-team/seat/${node.seat.seatId}`);
      return;
    }
    if ((box || node.level === "manager") && division) {
      if (!isOpen && hasKids) toggle(node.key);
      onChannel(division);
      return;
    }
    if (hasKids) toggle(node.key);
  };
  const sub =
    box
      ? [node.unit?.name !== (division ?? node.name) ? node.unit?.name : null, managerOf(node), people(node.figures.people)]
          .filter(Boolean)
          .join(" · ")
      : person
        ? [node.seat?.title, node.sub].filter(Boolean).join(" · ")
        : node.sub;
  return (
    <li role="treeitem" aria-expanded={hasKids ? isOpen : undefined} aria-selected={false}>
      <div
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-slate-100 py-2 pr-4 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,12rem)_8.5rem_3.5rem] sm:pr-5 ${depth === 0 ? "border-t-0 bg-slate-50/60" : ""}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
          {hasKids ? (
            <button
              type="button"
              onClick={() => toggle(node.key)}
              aria-label={isOpen ? `Fold ${node.name}` : `Open ${node.name}`}
              className="grid size-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : (
            <span aria-hidden className="size-6 shrink-0" />
          )}
          <button type="button" onClick={press} className="group flex min-w-0 items-center gap-2.5 text-left">
            <span className="min-w-0">
              <span
                className={`block truncate text-sm group-hover:text-emerald-700 ${depth === 0 ? "font-semibold text-slate-900" : person ? "text-slate-800" : "font-semibold text-slate-900"}`}
              >
                {vacant ? "Vacant seat" : box ? (division ?? node.unit?.name ?? node.name) : node.name}
              </span>
              <span className="block truncate text-[11px] text-slate-500">{sub}</span>
            </span>
          </button>
        </span>
        <span className="col-span-2 row-start-2 pl-8 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:pl-0">
          {node.figures.target ? (
            <PaceBar pct={pct} pace={running ? pace : null} tone={barTone} />
          ) : (
            <span className="text-[11px] text-slate-400">No target</span>
          )}
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            {more.placed > 0 && <span>{more.placed} placed</span>}
            {running && node.figures.today > 0 && <span>{shortPeso(node.figures.today)} today</span>}
            {more.owed > 0 && (
              <span className={more.overdue > 0 ? "text-amber-700" : ""} title={`Overdue ${exactPeso(more.overdue)}`}>
                {shortPeso(more.owed)} owed
              </span>
            )}
          </span>
        </span>
        <span
          className="hidden text-right text-[13px] text-slate-700 tabular-nums sm:col-start-3 sm:row-start-1 sm:block"
          title={exactPeso(node.figures.sold)}
        >
          {shortPeso(node.figures.sold)}
          {node.figures.target > 0 && <span className="text-slate-400"> / {shortPeso(node.figures.target)}</span>}
        </span>
        <span
          className={`col-start-2 row-start-1 text-right text-sm tabular-nums sm:col-start-4 ${pct === null ? "text-slate-400" : `font-semibold ${PACE_TEXT[barTone]}`}`}
        >
          {pct === null ? (
            <>
              <span className="sm:hidden">{shortPeso(node.figures.sold)}</span>
              <span className="hidden sm:inline">—</span>
            </>
          ) : (
            `${Math.round(pct)}%`
          )}
        </span>
      </div>
      {hasKids && isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <Branch
              key={child.key}
              node={child}
              depth={depth + 1}
              pace={pace}
              running={running}
              open={open}
              toggle={toggle}
              onChannel={onChannel}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A channel's manager by name, when it has one of its own. */
function managerOf(node: Node): string | null {
  const managers = node.children.filter((child) => child.level === "manager").map((child) => child.name);
  return managers.length ? managers.join(", ") : null;
}

/** The tracker's channels in the tree, top to bottom, each once. */
export function channelsIn(top: Node): string[] {
  const found: string[] = [];
  const walk = (node: Node) => {
    if (node !== top && (node.level === "head" || node.level === "channel" || node.level === "manager")) {
      const division = divisionOf(node);
      if (division && !found.includes(division)) found.push(division);
    }
    for (const child of node.children) walk(child);
  };
  walk(top);
  // A lead's own team is one channel: their own box's.
  if (!found.length && top.unit?.division) found.push(top.unit.division);
  return found;
}
