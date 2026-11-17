// The company as a chart (Aryan, 17 Nov): every seat a box under the seat it reports to, as HR's
// chart draws it. Each box: + adds someone under it, ✎ changes the seat (work, title, team, boss,
// area: moving someone up, down or across), ⋯ the rest (password, their screens, leaving, closing
// an empty seat). Big branches start folded; a search opens the way to whoever it finds.

import type { OrgLogin, OrgSeat, OrgTree, OrgUnit } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye, KeyRound, Minus, Pencil, Plus, Search, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Pop } from "../pages/org";
import { Menu } from "../pages/org";
import { lookAs } from "../shell";
import { Button, CARD, useAction } from "../ui";
import { defaultBoss } from "./dialogs";

type Node = { seat: OrgSeat; unit: OrgUnit; kids: Node[]; size: number };

/** Every seat under the seat it reports to (its own choice, else its team's lead, else above). */
function buildChart(tree: OrgTree): Node[] {
  const all = tree.units.flatMap((unit) => unit.seats.map((seat) => ({ seat, unit })));
  const byId = new Map(all.map((one) => [one.seat.id, one]));
  const bossOf = (seat: OrgSeat, unit: OrgUnit): number | null => {
    if (seat.reportsToSeatId && byId.has(seat.reportsToSeatId) && seat.reportsToSeatId !== seat.id) return seat.reportsToSeatId;
    const boss = defaultBoss(tree, unit.id, seat.lead);
    return boss && boss.id !== seat.id ? boss.id : null;
  };
  const nodes = new Map(all.map(({ seat, unit }) => [seat.id, { seat, unit, kids: [] as Node[], size: 0 }]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const boss = bossOf(node.seat, node.unit);
    // A loop (someone reporting to their own report) is cut at the seat that closes it.
    let up = boss;
    let loop = false;
    for (let hops = 0; up && hops < 60; hops++) {
      if (up === node.seat.id) {
        loop = true;
        break;
      }
      const above = nodes.get(up);
      up = above ? bossOf(above.seat, above.unit) : null;
    }
    const parent = boss && !loop ? nodes.get(boss) : undefined;
    if (parent) parent.kids.push(node);
    else roots.push(node);
  }
  const order = (a: Node, b: Node) =>
    Number(b.seat.lead) - Number(a.seat.lead) || b.kids.length - a.kids.length || a.unit.name.localeCompare(b.unit.name) || a.seat.title.localeCompare(b.seat.title);
  const count = (node: Node): number => {
    node.kids.sort(order);
    node.size = node.kids.reduce((sum, kid) => sum + 1 + count(kid), 0);
    return node.size;
  };
  for (const root of roots) count(root);
  // The CEO's seat first, then the other tops (the Admin, anyone with nobody above).
  return roots.sort((a, b) => b.size - a.size);
}

/** The work someone added under this seat most likely does: what most of its people do, else
 *  the seat's own (a lead's or a manager's people sell, unless they show otherwise). */
function likelyWork(node: Node): OrgSeat["module"] {
  const count = new Map<OrgSeat["module"], number>();
  for (const kid of node.kids) count.set(kid.seat.module, (count.get(kid.seat.module) ?? 0) + 1);
  const most = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (most) return most;
  return ["team_lead", "manager", "ceo", "admin"].includes(node.seat.module) ? "medrep" : node.seat.module;
}

export function OrgChart({ tree, open }: { tree: OrgTree; open: (pop: Pop) => void }) {
  const roots = useMemo(() => buildChart(tree), [tree]);
  const [q, setQ] = useState("");
  // Folded or opened by hand; untouched, only the top and its own people show.
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const [zoom, setZoom] = useState(1);
  const words = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!words) return new Set<number>();
    const found = new Set<number>();
    for (const unit of tree.units)
      for (const seat of unit.seats)
        if (
          [seat.holder?.name, seat.acting?.name, seat.title, seat.login, unit.name, seat.area?.name]
            .filter(Boolean)
            .some((text) => String(text).toLowerCase().includes(words))
        )
          found.add(seat.id);
    return found;
  }, [tree, words]);
  /** Seats on the way to a search hit stay open. */
  const onWay = useMemo(() => {
    const keep = new Set<number>();
    const walk = (node: Node): boolean => {
      let inside = hits.has(node.seat.id);
      for (const kid of node.kids) if (walk(kid)) inside = true;
      if (inside) keep.add(node.seat.id);
      return inside;
    };
    for (const root of roots) walk(root);
    return keep;
  }, [roots, hits]);
  const isOpen = (node: Node, depth: number) => shown[node.seat.id] ?? (words ? onWay.has(node.seat.id) : depth < 1);
  // The top of the chart in the middle of the view, whatever its width.
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = view.current;
    if (box) box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
  }, [shown, words, zoom]);
  const setAll = (value: boolean) => {
    const next: Record<number, boolean> = {};
    const walk = (node: Node) => {
      if (node.kids.length) next[node.seat.id] = value;
      node.kids.forEach(walk);
    };
    roots.forEach(walk);
    setShown(next);
  };

  return (
    <section className={`${CARD} flex flex-col`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <label className="relative flex min-w-0 flex-1 items-center sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 text-slate-400" />
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setShown({});
            }}
            placeholder="Find someone on the chart"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
          />
        </label>
        {words && <span className="text-xs text-slate-500">{hits.size} found</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button small onClick={() => setAll(true)}>
            Open all
          </Button>
          <Button small onClick={() => setAll(false)}>
            Fold all
          </Button>
          <Button small variant="quiet" aria-label="Smaller" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
            <Minus size={14} />
          </Button>
          <span className="w-10 text-center text-xs text-slate-500 tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button small variant="quiet" aria-label="Bigger" onClick={() => setZoom((z) => Math.min(1.3, z + 0.1))}>
            <Plus size={14} />
          </Button>
        </div>
      </div>
      <div ref={view} className="max-h-[75dvh] overflow-auto p-4">
        <div style={{ zoom }} className="flex w-max min-w-full justify-center gap-8">
          {roots.map((root) => (
            <Branch key={root.seat.id} node={root} depth={0} isOpen={isOpen} toggle={(id, value) => setShown((now) => ({ ...now, [id]: value }))} hits={hits} open={open} />
          ))}
        </div>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        <b>+</b> adds someone under a person · <b>✎</b> changes their job, team or boss (moving them up, down or across) · <b>⋯</b> password, their screens, or
        "no longer with us". A seat stays when someone leaves: its customers wait for the next person.
      </p>
    </section>
  );
}

function Branch({
  node,
  depth,
  isOpen,
  toggle,
  hits,
  open,
}: {
  node: Node;
  depth: number;
  isOpen: (node: Node, depth: number) => boolean;
  toggle: (id: number, value: boolean) => void;
  hits: Set<number>;
  open: (pop: Pop) => void;
}) {
  const unfolded = node.kids.length > 0 && isOpen(node, depth);
  return (
    <div className="flex flex-col items-center">
      <Box node={node} hit={hits.has(node.seat.id)} unfolded={unfolded} onFold={() => toggle(node.seat.id, !unfolded)} open={open} />
      {unfolded && (
        <>
          <div className="h-4 w-px bg-slate-300" />
          <div className="flex">
            {node.kids.map((kid, at) => (
              <div key={kid.seat.id} className="relative flex flex-col items-center px-2 pt-4">
                {/* The line across the children, and the line down to each. */}
                <span
                  className={`absolute top-0 h-px bg-slate-300 ${node.kids.length === 1 ? "hidden" : at === 0 ? "right-0 left-1/2" : at === node.kids.length - 1 ? "right-1/2 left-0" : "right-0 left-0"}`}
                />
                <span className="absolute top-0 left-1/2 h-4 w-px bg-slate-300" />
                <Branch node={kid} depth={depth + 1} isOpen={isOpen} toggle={toggle} hits={hits} open={open} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Box({ node, hit, unfolded, onFold, open }: { node: Node; hit: boolean; unfolded: boolean; onFold: () => void; open: (pop: Pop) => void }) {
  const { seat, unit } = node;
  const holder = seat.holder;
  const queries = useQueryClient();
  const act = useAction();
  const run = (path: string, then?: (answer: unknown) => void) =>
    act.run(async () => {
      const answer = await api(path, { body: {} });
      await queries.invalidateQueries({ queryKey: ["org"] });
      then?.(answer);
    });
  return (
    <div
      className={`relative w-52 rounded-xl border bg-white px-3 pt-2.5 pb-2 text-left shadow-sm ${
        hit ? "border-emerald-500 ring-2 ring-emerald-200" : holder ? "border-slate-200" : "border-dashed border-amber-300 bg-amber-50/50"
      }`}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[13px] font-semibold ${holder ? "text-slate-900" : "text-amber-800"}`} title={holder?.name ?? "Vacant"}>
            {holder?.name ?? "Vacant"}
          </div>
          <div className="truncate text-[11.5px] text-slate-600" title={seat.title}>
            {seat.title}
          </div>
          <div className="truncate text-[11px] text-slate-400" title={unit.name}>
            {unit.name}
            {seat.area ? ` · ${seat.area.name}` : ""}
          </div>
        </div>
        {seat.login && (
          <span className="shrink-0 rounded bg-slate-50 px-1 font-mono text-[10.5px] font-semibold text-slate-600 ring-1 ring-slate-200" title="Login ID">
            {seat.login}
          </span>
        )}
      </div>
      {seat.acting && <div className="mt-1 truncate text-[11px] text-sky-700">{seat.acting.name} covers</div>}
      {act.problem && <div className="mt-1 text-[11px] text-rose-700">{act.problem.message}</div>}
      <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-1.5">
        {holder ? (
          <Button small variant="quiet" aria-label={`Add someone under ${holder.name}`} title="Add someone under them" onClick={() => open({ kind: "add", unit, reportsTo: seat.id, module: likelyWork(node) })}>
            <Plus size={14} />
          </Button>
        ) : (
          <Button small variant="primary" onClick={() => open({ kind: "add", unit, seat })}>
            <UserPlus size={13} /> Fill
          </Button>
        )}
        <Button small variant="quiet" aria-label="Change" title="Change job, team or boss" onClick={() => open({ kind: "seat", unit, seat })}>
          <Pencil size={13} />
        </Button>
        <Menu
          busy={act.busy}
          items={
            holder
              ? [
                  { label: "See their screens (read only)", icon: <Eye size={14} />, onClick: () => lookAs(holder.personId) },
                  {
                    label: "Show their login",
                    icon: <KeyRound size={14} />,
                    onClick: () => run(`/api/org/people/${holder.personId}/password`, (answer) => open({ kind: "login", name: holder.name, login: answer as OrgLogin })),
                  },
                  { label: "Someone covers (leave)", onClick: () => open({ kind: "cover", seat }) },
                  { label: "No longer with us…", icon: <UserMinus size={14} />, danger: true, onClick: () => open({ kind: "leave", holder }) },
                ]
              : [
                  { label: "Someone covers it meanwhile", onClick: () => open({ kind: "cover", seat }) },
                  { label: "Close this seat", danger: true, onClick: () => run(`/api/org/seats/${seat.id}/close`) },
                ]
          }
        />
        {node.kids.length > 0 && (
          <button type="button" onClick={onFold} className="ml-auto flex items-center gap-0.5 rounded px-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100" title={unfolded ? "Fold" : "Open"}>
            {unfolded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {node.size}
          </button>
        )}
      </div>
    </div>
  );
}
