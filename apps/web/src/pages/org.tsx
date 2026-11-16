// Teams & people: the company as boxes and seats, for the CEO and the Admin. On the left the tree
// (the company, its businesses and lines, their teams, the departments), on the right the box
// picked: its seats by the work they do, who sits in each (or "Vacant"), whom each reports to,
// its area, and Add buttons for each kind of work. A seat stays when its person leaves; the next
// person who sits in it finds its customers and orders.

import type { OrgHolder, OrgLogin, OrgSeat, OrgTree, OrgUnit, Role } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronRight,
  Ellipsis,
  Eye,
  FolderTree,
  KeyRound,
  Plus,
  Search,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AreasTab, RequestsTab } from "../org/areas-requests";
import {
  AddPersonDialog,
  CoverDialog,
  LeaveDialog,
  LoginCard,
  lineUp,
  SeatDialog,
  UnitDialog,
  WORK,
  WORK_ORDER,
} from "../org/dialogs";
import { lookAs } from "../shell";
import { Button, CARD, PageHead, PageState, Problem, useAction } from "../ui";

const KIND_WORD: Record<OrgUnit["kind"], string> = {
  company: "Company",
  business: "Business",
  line: "Business line",
  team: "Team",
  department: "Department",
};

/** Which work an Add button offers first in a box of this kind. */
const ADD_FOR: Record<OrgUnit["kind"], Role[]> = {
  company: ["management", "finance", "dispatch", "inventory", "hr", "admin"],
  business: ["team_lead", "medrep"],
  line: ["team_lead", "medrep"],
  team: ["medrep", "team_lead"],
  department: ["finance", "dispatch", "inventory", "management"],
};

export type Pop =
  | { kind: "add"; unit: OrgUnit; module?: Role; seat?: OrgSeat; title?: string }
  | { kind: "seat"; unit: OrgUnit; seat?: OrgSeat; module?: Role }
  | { kind: "cover"; seat: OrgSeat }
  | { kind: "leave"; holder: OrgHolder }
  | { kind: "unit"; parent?: OrgUnit; unit?: OrgUnit; team?: boolean }
  | { kind: "login"; name: string; login: OrgLogin };

const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function OrgPage() {
  const query = useQuery({ queryKey: ["org"], queryFn: () => api<OrgTree>("/api/org") });
  if (!query.data) return <PageState query={query} what="the company's teams" />;
  return <Org tree={query.data} />;
}

function Org({ tree }: { tree: OrgTree }) {
  const [params, setParams] = useSearchParams();
  const [pop, setPop] = useState<Pop | null>(null);
  const root = tree.units.find((unit) => unit.kind === "company") ?? tree.units[0];
  const picked = tree.units.find((unit) => String(unit.id) === params.get("unit")) ?? root;
  const q = params.get("q") ?? "";
  const tab = (["areas", "requests"] as const).find((one) => one === params.get("tab")) ?? "teams";
  const openAsks = tree.requests.filter((request) => request.status === "open").length;
  const set = (next: Record<string, string | null>) =>
    setParams(
      (now) => {
        const out = new URLSearchParams(now);
        for (const [key, value] of Object.entries(next))
          value ? out.set(key, value) : out.delete(key);
        return out;
      },
      { replace: true },
    );

  const children = useMemo(() => {
    const map = new Map<number, OrgUnit[]>();
    for (const unit of tree.units) {
      if (unit.parentId === null) continue;
      map.set(unit.parentId, [...(map.get(unit.parentId) ?? []), unit]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sort - b.sort || a.id - b.id);
    return map;
  }, [tree.units]);
  /** People and empty seats in a box and every box under it. */
  const totals = useMemo(() => {
    const memo = new Map<number, { people: number; vacant: number }>();
    const walk = (unit: OrgUnit): { people: number; vacant: number } => {
      const known = memo.get(unit.id);
      if (known) return known;
      const own = {
        people: unit.seats.filter((seat) => seat.holder).length,
        vacant: unit.seats.filter((seat) => !seat.holder).length,
      };
      for (const child of children.get(unit.id) ?? []) {
        const sub = walk(child);
        own.people += sub.people;
        own.vacant += sub.vacant;
      }
      memo.set(unit.id, own);
      return own;
    };
    for (const unit of tree.units) walk(unit);
    return memo;
  }, [tree.units, children]);

  const seats = tree.units.flatMap((unit) => unit.seats);
  const people = new Set(seats.flatMap((seat) => (seat.holder ? [seat.holder.personId] : []))).size;
  const vacant = seats.filter((seat) => !seat.holder).length;
  const covering = seats.filter((seat) => seat.acting).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Teams & people"
        sub="Every job is a seat in a team; its customers and orders stay with the seat."
        actions={
          <label className="relative flex items-center">
            <Search size={16} className="pointer-events-none absolute left-3 text-slate-400" />
            <input
              value={q}
              onChange={(event) => set({ q: event.target.value || null })}
              placeholder="Find a person, area or job"
              className="h-10 w-72 max-w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
            />
          </label>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="People" value={people} />
          <Figure label="Vacant seats" value={vacant} tone={vacant ? "amber" : undefined} />
          <Figure label="Covering a seat" value={covering} tone={covering ? "sky" : undefined} />
          <Figure
            label="Signed in, no seat"
            value={tree.unplaced.length}
            tone={tree.unplaced.length ? "amber" : undefined}
          />
        </div>
      </PageHead>

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["teams", "Teams"],
            ["areas", `Areas · ${tree.areas.length}`],
            ["requests", `Asks for people${openAsks ? ` · ${openAsks} waiting` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => set({ tab: key === "teams" ? null : key })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? "border-emerald-600 text-emerald-800" : "border-transparent text-slate-500 hover:text-slate-800"} ${key === "requests" && openAsks ? "text-amber-700" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "areas" && <AreasTab tree={tree} />}
      {tab === "requests" && <RequestsTab tree={tree} />}
      {tab === "teams" && (
        <div className="grid items-start gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
          <nav
            aria-label="Company tree"
            className={`${CARD} hidden p-2 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto`}
          >
            {root && (
              <TreeNode
                unit={root}
                depth={0}
                childrenOf={children}
                totals={totals}
                picked={picked?.id ?? null}
                onPick={(unit) => set({ unit: String(unit.id), q: null })}
              />
            )}
          </nav>
          <div className="flex min-w-0 flex-col gap-4">
            {/* On a phone the tree is a list to pick from, so the team picked stays in view. */}
            <label className="flex flex-col gap-1 lg:hidden">
              <span className="text-xs font-semibold text-slate-600">Team</span>
              <select
                value={picked?.id ?? ""}
                onChange={(event) => set({ unit: event.target.value, q: null })}
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                {flatTree(root, children).map(({ unit, depth }) => (
                  <option key={unit.id} value={unit.id}>
                    {`${"\u00a0\u00a0".repeat(depth)}${unit.name} · ${totals.get(unit.id)?.people ?? 0}${totals.get(unit.id)?.vacant ? ` (${totals.get(unit.id)?.vacant} vacant)` : ""}`}
                  </option>
                ))}
              </select>
            </label>
            {q.trim() ? (
              <Found tree={tree} q={q} onPick={(unit) => set({ unit: String(unit.id), q: null })} />
            ) : picked ? (
              <UnitPanel
                tree={tree}
                unit={picked}
                under={children.get(picked.id) ?? []}
                totals={totals}
                onPick={(unit) => set({ unit: String(unit.id) })}
                open={setPop}
              />
            ) : null}
            {tree.unplaced.length > 0 && !q && picked?.kind === "company" && (
              <section className={`${CARD} p-4`}>
                <h2 className="text-sm font-semibold text-slate-900">Signed in, but in no seat</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Put them in an empty seat ("Fill" → Someone already here).
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {tree.unplaced.map((person) => (
                    <li
                      key={person.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-950"
                    >
                      <b>{person.name}</b> · {person.roleLabel}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
      <OrgPops tree={tree} pop={pop} setPop={setPop} />
    </div>
  );
}

/** The dialog a Teams & people action opens: add or fill, a seat, a cover, leaving, a box, the
 *  login shown once. Shared with the Admin panel's channel page. */
export function OrgPops({
  tree,
  pop,
  setPop,
}: {
  tree: OrgTree;
  pop: Pop | null;
  setPop: (pop: Pop | null) => void;
}) {
  const seats = tree.units.flatMap((unit) => unit.seats);
  return (
    <>
      {pop?.kind === "add" && (
        <AddPersonDialog
          tree={tree}
          unit={pop.unit}
          seat={pop.seat}
          module={pop.module}
          title={pop.title}
          onClose={() => setPop(null)}
          onLogin={(name, login) => setPop({ kind: "login", name, login })}
        />
      )}
      {pop?.kind === "seat" && (
        <SeatDialog
          tree={tree}
          unit={pop.unit}
          seat={pop.seat}
          module={pop.module}
          onClose={() => setPop(null)}
        />
      )}
      {pop?.kind === "cover" && (
        <CoverDialog tree={tree} seat={pop.seat} onClose={() => setPop(null)} />
      )}
      {pop?.kind === "leave" && (
        <LeaveDialog
          holder={pop.holder}
          seats={seats.filter((seat) => seat.holder?.personId === pop.holder.personId)}
          onClose={() => setPop(null)}
        />
      )}
      {pop?.kind === "unit" && (
        <UnitDialog
          tree={tree}
          parent={pop.parent}
          unit={pop.unit}
          team={pop.team}
          onClose={() => setPop(null)}
        />
      )}
      {pop?.kind === "login" && (
        <LoginCard name={pop.name} login={pop.login} onClose={() => setPop(null)} />
      )}
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The tree in reading order, each box with its depth. */
function flatTree(
  root: OrgUnit | undefined,
  children: Map<number, OrgUnit[]>,
): { unit: OrgUnit; depth: number }[] {
  const out: { unit: OrgUnit; depth: number }[] = [];
  const walk = (unit: OrgUnit, depth: number) => {
    out.push({ unit, depth });
    for (const kid of children.get(unit.id) ?? []) walk(kid, depth + 1);
  };
  if (root) walk(root, 0);
  return out;
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "amber" | "sky" }) {
  return (
    <div className={`${CARD} px-4 py-3`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone === "amber" ? "text-amber-600" : tone === "sky" ? "text-sky-700" : "text-slate-900"}`}
      >
        {value}
      </div>
    </div>
  );
}

function TreeNode({
  unit,
  depth,
  childrenOf,
  totals,
  picked,
  onPick,
}: {
  unit: OrgUnit;
  depth: number;
  childrenOf: Map<number, OrgUnit[]>;
  totals: Map<number, { people: number; vacant: number }>;
  picked: number | null;
  onPick: (unit: OrgUnit) => void;
}) {
  const kids = childrenOf.get(unit.id) ?? [];
  const sum = totals.get(unit.id) ?? { people: 0, vacant: 0 };
  const isPicked = picked === unit.id;
  return (
    <div>
      <button
        type="button"
        onClick={() => onPick(unit)}
        aria-current={isPicked ? "true" : undefined}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-[13px] ${
          isPicked
            ? "bg-emerald-50 font-semibold text-emerald-900"
            : "text-slate-700 hover:bg-slate-50"
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${depth <= 1 ? "font-semibold" : ""}`}>
          {unit.name}
        </span>
        {unit.channel && depth <= 2 && unit.kind !== "team" && (
          <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">
            {unit.channel.code}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{sum.people}</span>
        {sum.vacant > 0 && (
          <span
            className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 tabular-nums"
            title={`${sum.vacant} vacant`}
          >
            {sum.vacant}
          </span>
        )}
      </button>
      {kids.length > 0 && (
        <div
          className="border-l border-slate-100"
          style={{ marginLeft: `${0.9 + depth * 0.9}rem` }}
        >
          {kids.map((kid) => (
            <TreeNode
              key={kid.id}
              unit={kid}
              depth={depth + 1}
              childrenOf={childrenOf}
              totals={totals}
              picked={picked}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnitPanel({
  tree,
  unit,
  under,
  totals,
  onPick,
  open,
}: {
  tree: OrgTree;
  unit: OrgUnit;
  under: OrgUnit[];
  totals: Map<number, { people: number; vacant: number }>;
  onPick: (unit: OrgUnit) => void;
  open: (pop: Pop) => void;
}) {
  const path = lineUp(tree, unit.id).reverse();
  const lead = unit.seats.find((seat) => seat.lead);
  const others = unit.seats.filter((seat) => !seat.lead);
  // Seats by the work they do, in the order the work is offered.
  const groups = WORK_ORDER.map((module) => ({
    module,
    seats: others.filter(
      (seat) => (seat.module === "manager" ? "team_lead" : seat.module) === module,
    ),
  })).filter((group) => group.seats.length);
  const adds = ADD_FOR[unit.kind].filter(
    (module) => !(lead && module !== "medrep" && unit.kind === "team" && module === "team_lead"),
  );
  const channel = path.find((one) => one.channel)?.channel ?? null;
  const close = useAction();
  const queries = useQueryClient();
  const empty = unit.seats.length === 0 && under.length === 0 && unit.kind !== "company";

  return (
    <>
      <section className={`${CARD} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
          {path.slice(0, -1).map((one) => (
            <span key={one.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onPick(one)}
                className="hover:text-emerald-700 hover:underline"
              >
                {one.name}
              </button>
              <ChevronRight size={12} />
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
              {unit.name}
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                {KIND_WORD[unit.kind]}
              </span>
              {channel && (
                <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                  {channel.code} · {channel.name}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {lead ? (
                <>
                  Led by{" "}
                  <b className="text-slate-800">
                    {lead.acting?.name ?? lead.holder?.name ?? "nobody yet (vacant)"}
                  </b>
                  {lead.acting && " (covering)"} · {lead.title}
                </>
              ) : (
                "No lead seat: its people report to the lead above."
              )}
              {" · "}
              {plural(totals.get(unit.id)?.people ?? 0, "person", "people")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => open({ kind: "add", unit, module: adds[0] })}>
              <UserPlus size={16} /> Add person
            </Button>
            {unit.kind !== "company" && (
              <Link
                to={`/my-team?unit=${unit.id}`}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                Its work
              </Link>
            )}
            <Button onClick={() => open({ kind: "unit", parent: unit })}>
              <FolderTree size={16} /> Add team under it
            </Button>
            <Menu
              items={[
                {
                  label: "A vacant seat (fill later)",
                  onClick: () => open({ kind: "seat", unit, module: adds[0] }),
                },
                ...(unit.kind !== "company"
                  ? [{ label: "Rename / channel", onClick: () => open({ kind: "unit", unit }) }]
                  : []),
                ...(empty
                  ? [
                      {
                        label: `Close ${unit.name}`,
                        danger: true,
                        onClick: () =>
                          close.run(async () => {
                            await api(`/api/org/units/${unit.id}/close`, { body: {} });
                            await queries.invalidateQueries({ queryKey: ["org"] });
                            if (unit.parentId)
                              onPick(tree.units.find((one) => one.id === unit.parentId) as OrgUnit);
                          }),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
        <Problem message={close.problem?.message} />
      </section>

      {lead && (
        <SeatGroup title="Lead" tree={tree}>
          <SeatRow seat={lead} unit={unit} open={open} />
        </SeatGroup>
      )}
      {groups.map((group) => (
        <SeatGroup
          key={group.module}
          title={`${WORK[group.module].label}${group.seats.length === 1 ? "" : "s"}`}
          count={group.seats.length}
          tree={tree}
          add={
            <Button small onClick={() => open({ kind: "add", unit, module: group.module })}>
              <Plus size={14} /> Add {WORK[group.module].label}
            </Button>
          }
        >
          {group.seats.map((seat) => (
            <SeatRow key={seat.id} seat={seat} unit={unit} open={open} />
          ))}
        </SeatGroup>
      ))}
      {/* Work this kind of box usually has, not here yet: one click adds the first one. */}
      {adds.some(
        (module) => !groups.some((group) => group.module === module) && !(lead?.module === module),
      ) && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-3">
          <span className="text-[13px] text-slate-500">Add to {unit.name}:</span>
          {adds
            .filter(
              (module) =>
                !groups.some((group) => group.module === module) && lead?.module !== module,
            )
            .map((module) => (
              <Button key={module} small onClick={() => open({ kind: "add", unit, module })}>
                <Plus size={14} /> {WORK[module].label}
              </Button>
            ))}
        </div>
      )}

      {under.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            Under {unit.name}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {under.map((kid) => {
              const kidLead = kid.seats.find((seat) => seat.lead);
              const sum = totals.get(kid.id) ?? { people: 0, vacant: 0 };
              return (
                <button
                  key={kid.id}
                  type="button"
                  onClick={() => onPick(kid)}
                  className={`${CARD} flex flex-col gap-1 p-4 text-left transition-colors hover:border-emerald-300`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    {kid.kind === "department" ? (
                      <Building2 size={15} className="text-slate-400" />
                    ) : (
                      <Users size={15} className="text-slate-400" />
                    )}
                    <span className="truncate">{kid.name}</span>
                    {kid.channel && (
                      <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">
                        {kid.channel.code}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500">
                    {KIND_WORD[kid.kind]}
                    {kidLead
                      ? ` · ${kidLead.acting?.name ?? kidLead.holder?.name ?? "lead vacant"}`
                      : ""}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                    <b className="tabular-nums">{sum.people}</b>{" "}
                    {sum.people === 1 ? "person" : "people"}
                    {sum.vacant > 0 && (
                      <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">
                        {sum.vacant} vacant
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function SeatGroup({
  title,
  count,
  add,
  children,
}: {
  title: string;
  count?: number;
  tree: OrgTree;
  add?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {title}
          {count !== undefined && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums">
              {count}
            </span>
          )}
        </h3>
        {add}
      </div>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  );
}

export function SeatRow({
  seat,
  unit,
  open,
}: {
  seat: OrgSeat;
  unit: OrgUnit;
  open: (pop: Pop) => void;
}) {
  const queries = useQueryClient();
  const act = useAction();
  const holder = seat.holder;
  const run = (path: string, body: object = {}, then?: (answer: unknown) => void) =>
    act.run(async () => {
      const answer = await api(path, { body });
      await queries.invalidateQueries({ queryKey: ["org"] });
      then?.(answer);
    });
  const facts = [
    seat.title !== WORK[seat.module].title || seat.lead ? `${seat.title}` : null,
    seat.area ? seat.area.name : null,
    seat.boss ? `reports to ${seat.boss}` : null,
  ].filter(Boolean);
  return (
    <li
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${holder ? "" : "bg-amber-50/40"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {holder ? (
            <span className="text-sm font-semibold text-slate-900">{holder.name}</span>
          ) : (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
              Vacant
            </span>
          )}
          {seat.login && (
            <span
              className="rounded-md bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200"
              title="The seat's login ID: whoever sits here signs in with it"
            >
              {seat.login}
            </span>
          )}
          {holder?.newLogin && (
            <span
              className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"
              title="Hasn't set their own password yet"
            >
              New login
            </span>
          )}
          {holder?.elsewhere && (
            <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
              {holder.elsewhere}
            </span>
          )}
          {seat.acting && (
            <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
              {seat.acting.name} covers until {fmtDay(seat.acting.endsOn ?? "")}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {facts.join(" · ") || WORK[seat.module].label}
          {holder?.email && <span className="text-slate-400"> · {holder.email}</span>}
        </div>
        {act.problem && (
          <span className="text-xs font-medium text-rose-700">{act.problem.message}</span>
        )}
      </div>
      {(seat.customers > 0 || seat.openOrders > 0) && (
        <div className="flex gap-4 text-xs text-slate-500">
          {seat.customers > 0 && (
            <span>
              <b className="text-slate-800 tabular-nums">{seat.customers}</b>{" "}
              {seat.customers === 1 ? "customer" : "customers"}
            </span>
          )}
          {seat.openOrders > 0 && (
            <span>
              <b className="text-slate-800 tabular-nums">{seat.openOrders}</b> open{" "}
              {seat.openOrders === 1 ? "order" : "orders"}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        {!holder && (
          <Button small variant="primary" onClick={() => open({ kind: "add", unit, seat })}>
            <UserPlus size={14} /> Fill
          </Button>
        )}
        <Menu
          busy={act.busy}
          items={[
            {
              label: holder ? "Someone covers (leave)" : "Someone covers it meanwhile",
              onClick: () => open({ kind: "cover", seat }),
            },
            ...(seat.acting
              ? [
                  {
                    label: `End ${seat.acting.name}'s cover now`,
                    onClick: () => run(`/api/org/holdings/${seat.acting?.id}/end`),
                  },
                ]
              : []),
            {
              label: "Change the seat (work, boss, area)",
              onClick: () => open({ kind: "seat", unit, seat }),
            },
            ...(holder
              ? [
                  {
                    label: "See their screens (read only)",
                    icon: <Eye size={14} />,
                    onClick: () => lookAs(holder.personId),
                  },
                  {
                    label: "Give a new password",
                    icon: <KeyRound size={14} />,
                    onClick: () =>
                      run(`/api/org/people/${holder.personId}/password`, {}, (answer) =>
                        open({ kind: "login", name: holder.name, login: answer as OrgLogin }),
                      ),
                  },
                  // Kept in the menu, not on every row: someone leaving isn't news to show.
                  {
                    label: "No longer with us…",
                    icon: <UserMinus size={14} />,
                    onClick: () => open({ kind: "leave", holder }),
                  },
                ]
              : [
                  {
                    label: "Close this seat",
                    danger: true,
                    onClick: () => run(`/api/org/seats/${seat.id}/close`),
                  },
                ]),
          ]}
        />
      </div>
    </li>
  );
}

/** A small "…" menu of the less used actions. Closes on a click outside or Esc. */
export function Menu({
  items,
  busy,
}: {
  items: { label: string; onClick: () => void; danger?: boolean; icon?: ReactNode }[];
  busy?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setShown(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShown(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);
  if (!items.length) return null;
  return (
    <div ref={box} className="relative">
      <Button
        small
        variant="quiet"
        aria-label="More"
        aria-expanded={shown}
        disabled={busy}
        onClick={() => setShown((now) => !now)}
      >
        <Ellipsis size={16} />
      </Button>
      {shown && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setShown(false);
                item.onClick();
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${
                item.danger ? "text-rose-700 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the search finds: people, areas and jobs anywhere in the tree. */
function Found({ tree, q, onPick }: { tree: OrgTree; q: string; onPick: (unit: OrgUnit) => void }) {
  const words = q.trim().toLowerCase();
  const hits = tree.units.flatMap((unit) =>
    unit.seats
      .filter((seat) =>
        [
          seat.holder?.name,
          seat.holder?.email,
          seat.login,
          seat.acting?.name,
          seat.title,
          seat.area?.name,
          ...(seat.area?.cities ?? []),
          unit.name,
          WORK[seat.module].label,
        ]
          .filter(Boolean)
          .some((text) => (text as string).toLowerCase().includes(words)),
      )
      .map((seat) => ({ seat, unit })),
  );
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
        {hits.length} found for "{q.trim()}"
      </div>
      <ul className="divide-y divide-slate-100">
        {hits.map(({ seat, unit }) => (
          <li key={seat.id}>
            <button
              type="button"
              onClick={() => onPick(unit)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50"
            >
              <span className="text-sm font-semibold text-slate-900">
                {seat.holder?.name ?? (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                    Vacant
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500">
                {[
                  seat.title,
                  seat.area?.name,
                  lineUp(tree, unit.id)
                    .reverse()
                    .slice(1)
                    .map((one) => one.name)
                    .join(" › "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
        {hits.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-500">Nobody matches.</li>
        )}
      </ul>
    </section>
  );
}
