// A head's and a team lead's Home, as Aryan drew it (19 Nov): "when the head signs in, they see it
// right there, big: my business is RX and MD Telesales; hover on RX and all its details show,
// press it and Honey shows, her whole team, what the team is doing and where; then MD Telesales,
// Honey, who under her does how much, the sales they made, A to Z". So: each channel of theirs as a
// big tile (what it sold against its target on the month's pace, its manager, its people, the money
// owed); hover for the details; a press opens it below: its manager(s), each person with their
// month, and the channel's own work (the same blocks its people's desks are built on), for that box
// alone. A press on a manager narrows it to their team; a press on a person opens their page.

import { DIVISIONS } from "@2mg/api/divisions";
import type { Me } from "@2mg/api/types";
import { ChevronRight, ListTree, Rows3 } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { exactPeso, shortPeso } from "../ceo";
import { PACE_TEXT, PaceBar } from "../company/ceo-home";
import { type Node, pctOf, toneOfNode } from "../company/sales-tree";
import { B2bTeamCard } from "../sellers/b2b";
import { ClidpTeamCard } from "../sellers/clidp";
import { MtHome } from "../sellers/mt";
import { BiddingCard, BiddingHome } from "../sellers/tenders";
import { TeamAccountsCard } from "./accounts-card";
import { DistrictNow } from "./district";
import { divisionOf, TeamTree } from "./hierarchy";
import { HospitalTeams, RxFieldBlock, TelesalesCoachHome } from "./mentor";

const CARD = "rounded-xl border border-slate-200 bg-white";

/** What a branch adds up to beyond the tree's own figures. */
type More = { owed: number; overdue: number; placed: number; customers: number; open: number };
const moreOf = (node: Node): More => {
  if (node.level === "person" && node.seat) {
    const stages = node.seat.stages;
    return {
      owed: node.seat.owed,
      overdue: node.seat.overdue,
      placed: node.seat.placed,
      customers: node.seat.customers,
      open: stages.management + stages.finance + stages.dispatch + stages.road + stages.held + stages.sentBack,
    };
  }
  return node.children.reduce(
    (all, child) => {
      const one = moreOf(child);
      return {
        owed: all.owed + one.owed,
        overdue: all.overdue + one.overdue,
        placed: all.placed + one.placed,
        customers: all.customers + one.customers,
        open: all.open + one.open,
      };
    },
    { owed: 0, overdue: 0, placed: 0, customers: 0, open: 0 },
  );
};
const peopleIn = (node: Node): Node[] =>
  node.level === "person" ? [node] : node.children.flatMap((child) => peopleIn(child));
const peopleWord = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;
const tone = (node: Node, pace: number) => {
  const found = toneOfNode(node, pace);
  return found === "vacant" ? "far" : found;
};

/** The boxes a lead's Home opens with: their channels (a head's), their own boxes (a lead of two),
 *  or none (a lead of one team: their people straight away). */
function tilesOf(top: Node): Node[] {
  const place = (node: Node) => {
    const at = DIVISIONS.indexOf((divisionOf(node) ?? "") as (typeof DIVISIONS)[number]);
    return at < 0 ? DIVISIONS.length : at;
  };
  // In the sales tracker's order (Subir: B2B, BID, CLIDP; Javed: RX Business, MD Telesales).
  return top.children
    .filter((child) => child.level !== "person" && child.level !== "manager")
    .map((child, index) => ({ child, index }))
    .sort((a, b) => place(a.child) - place(b.child) || a.index - b.index)
    .map(({ child }) => child);
}

export function TeamDrill({ top, pace, running, me }: { top: Node; pace: number; running: boolean; me: Me }) {
  const tiles = tilesOf(top);
  // Open at first: the channel with the most people (Vanessa's HOSP, Subir's B2B, Javed's RX).
  const biggest = [...tiles].sort((a, b) => b.figures.people - a.figures.people)[0];
  const [picked, setPicked] = useState<string | null>(biggest?.key ?? null);
  const [manager, setManager] = useState<string | null>(null);
  const [look, setLook] = useState<"tiles" | "tree">("tiles");
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null);
  const channel = tiles.find((one) => one.key === picked) ?? null;
  // The branch opened below: a manager picked inside the channel, else the channel, else the lead's
  // own team (a lead of one team).
  const managers = channel ? channel.children.filter((child) => child.level === "manager") : [];
  const branch = (manager ? managers.find((one) => one.key === manager) : null) ?? channel ?? top;
  const onHover = (node: Node | null, event?: ReactMouseEvent) =>
    setHover(node && event ? { node, x: event.clientX, y: event.clientY } : null);

  return (
    <section aria-labelledby="your-team" className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h2 id="your-team" className="text-base font-semibold text-slate-900">
            {tiles.length ? "Your channels" : "Your team"}
          </h2>
          <p className="text-[12px] text-slate-500">
            Sold against target{running ? ` on the month's pace (${Math.round(pace * 100)}%)` : ""} · hover for the details,
            press to open
          </p>
        </div>
        <div className={`${CARD} flex p-0.5`} role="tablist" aria-label="Look">
          {(
            [
              ["tiles", "Channels", Rows3],
              ["tree", "Whole tree", ListTree],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={look === key}
              onClick={() => setLook(key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold ${look === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      </header>

      {look === "tree" ? (
        <TeamTree
          top={top}
          pace={pace}
          running={running}
          onChannel={(division) => {
            const found = tiles.find((one) => divisionOf(one) === division);
            if (found) {
              setPicked(found.key);
              setManager(null);
              setLook("tiles");
            }
          }}
        />
      ) : (
        <>
          {tiles.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tiles.map((tile) => (
                <ChannelTile
                  key={tile.key}
                  node={tile}
                  pace={pace}
                  running={running}
                  on={tile.key === picked}
                  onPick={() => {
                    setPicked(tile.key);
                    setManager(null);
                  }}
                  onHover={onHover}
                />
              ))}
            </div>
          )}
          <Opened
            key={branch.key}
            top={top}
            channel={channel}
            branch={branch}
            managers={managers}
            manager={manager}
            setManager={setManager}
            pace={pace}
            running={running}
            me={me}
            onHover={onHover}
          />
        </>
      )}
      {hover && <HoverCard node={hover.node} pace={pace} running={running} x={hover.x} y={hover.y} />}
    </section>
  );
}

/** A channel as a big tile: its tracker name, its manager, what it sold against its target. */
function ChannelTile({
  node,
  pace,
  running,
  on,
  onPick,
  onHover,
}: {
  node: Node;
  pace: number;
  running: boolean;
  on: boolean;
  onPick: () => void;
  onHover: (node: Node | null, event?: ReactMouseEvent) => void;
}) {
  const division = divisionOf(node);
  const more = moreOf(node);
  const pct = pctOf(node.figures);
  const t = tone(node, pace);
  const managers = node.children.filter((child) => child.level === "manager").map((child) => child.name);
  return (
    <button
      type="button"
      onClick={onPick}
      onMouseMove={(event) => onHover(node, event)}
      onMouseLeave={() => onHover(null)}
      aria-pressed={on}
      className={`${CARD} flex min-w-0 flex-col gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${on ? "ring-2 ring-emerald-500" : ""}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold text-slate-900">{division ?? node.name}</span>
            <span className="block truncate text-[12px] text-slate-500">
              {[node.unit?.name !== division ? node.unit?.name : null, managers.length ? managers.join(", ") : null]
                .filter(Boolean)
                .join(" · ") || peopleWord(node.figures.people)}
            </span>
          </span>
        </span>
        <span className={`text-xl font-semibold tabular-nums ${pct === null ? "text-slate-400" : PACE_TEXT[t]}`}>
          {pct === null ? "—" : `${Math.round(pct)}%`}
        </span>
      </span>
      <span>
        {node.figures.target ? (
          <PaceBar pct={pct} pace={running ? pace : null} tone={t} />
        ) : (
          <span className="text-[12px] text-slate-400">No target set</span>
        )}
        <span className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-slate-600">
          <span className="tabular-nums" title={exactPeso(node.figures.sold)}>
            <b className="text-slate-900">{shortPeso(node.figures.sold)}</b>
            {node.figures.target > 0 && <> of {shortPeso(node.figures.target)}</>}
          </span>
          <span>{peopleWord(node.figures.people)}</span>
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5 text-[11.5px]">
        <Chip>{more.placed} placed</Chip>
        {more.open > 0 && <Chip>{more.open} open orders</Chip>}
        {more.owed > 0 && <Chip warn={more.overdue > 0}>{shortPeso(more.owed)} owed</Chip>}
        {node.figures.vacant > 0 && <Chip warn>{node.figures.vacant} vacant</Chip>}
      </span>
    </button>
  );
}

function Chip({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 ${warn ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
      {children}
    </span>
  );
}

/** The channel opened: its manager(s) to narrow it, each person's month, and its own work. */
function Opened({
  top,
  channel,
  branch,
  managers,
  manager,
  setManager,
  pace,
  running,
  me,
  onHover,
}: {
  top: Node;
  channel: Node | null;
  branch: Node;
  managers: Node[];
  manager: string | null;
  setManager: (key: string | null) => void;
  pace: number;
  running: boolean;
  me: Me;
  onHover: (node: Node | null, event?: ReactMouseEvent) => void;
}) {
  const division = divisionOf(branch) ?? (channel ? divisionOf(channel) : null) ?? divisionOf(top);
  const box = branch.unit?.id ?? null;
  const people = peopleIn(branch);
  const more = moreOf(branch);
  const pct = pctOf(branch.figures);
  const t = tone(branch, pace);
  const trail = [top.name, channel ? (divisionOf(channel) ?? channel.name) : null, manager ? branch.name : null].filter(
    (one): one is string => Boolean(one),
  );
  return (
    <div className="space-y-4">
      <div className={`${CARD} min-w-0`}>
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1 text-[12px] text-slate-500">
              {trail.map((step, index) => (
                <span key={`${step}-${index}`} className="inline-flex items-center gap-1">
                  {index > 0 && <ChevronRight className="size-3 text-slate-300" />}
                  {step}
                </span>
              ))}
            </p>
            <h3 className="mt-0.5 text-[17px] font-semibold text-slate-900">
              {manager ? branch.name : channel ? (divisionOf(channel) ?? channel.name) : "Your team"}
            </h3>
          </div>
          <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-right sm:grid-cols-5">
            <Fact label="Sold" value={shortPeso(branch.figures.sold)} title={exactPeso(branch.figures.sold)} />
            <Fact
              label="Target"
              value={branch.figures.target ? `${Math.round(pct ?? 0)}% of ${shortPeso(branch.figures.target)}` : "—"}
              className={pct === null ? "" : PACE_TEXT[t]}
            />
            <Fact label="Orders placed" value={String(more.placed)} />
            <Fact label="Owed" value={more.owed ? shortPeso(more.owed) : "—"} title={`Overdue ${exactPeso(more.overdue)}`} />
            <Fact label="People" value={String(branch.figures.people)} />
          </dl>
        </header>

        {/* A channel with managers of its own: the whole channel, or one manager's team. */}
        {managers.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 sm:px-5" role="group" aria-label="Managers">
            {managers.length > 1 && (
              <ManagerChip on={!manager} onClick={() => setManager(null)} label={`All of ${divisionOf(channel as Node) ?? ""}`} />
            )}
            {managers.map((one) => (
              <ManagerChip
                key={one.key}
                on={manager === one.key || (managers.length === 1 && !manager)}
                onClick={() => setManager(managers.length === 1 ? null : one.key)}
                onHover={(event) => onHover(event ? one : null, event)}
                label={one.name}
                sub={`${peopleWord(one.figures.people)} · ${pctOf(one.figures) === null ? shortPeso(one.figures.sold) : `${Math.round(pctOf(one.figures) ?? 0)}%`}`}
                tone={pctOf(one.figures) === null ? undefined : PACE_TEXT[tone(one, pace)]}
              />
            ))}
          </div>
        )}

        {/* Each person: their month, their orders, the money owed by their customers. */}
        {people.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">Nobody sells here this month.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {[...people]
              .sort((a, b) => b.figures.sold - a.figures.sold)
              .map((one) => (
                <PersonRow key={one.key} node={one} pace={pace} running={running} onHover={onHover} />
              ))}
          </ul>
        )}
      </div>

      {/* The channel's own work, for this box alone (one manager's team when one is picked). */}
      {division && <ChannelWork division={division} me={me} unit={box} narrow={Boolean(manager)} />}

      {/* Its customers: where it sells, who is due, late or stopped, what each owes. */}
      <TeamAccountsCard unit={box} division={division} />
    </div>
  );
}

function Fact({ label, value, title, className = "" }: { label: string; value: string; title?: string; className?: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">{label}</dt>
      <dd className={`text-[14px] font-semibold text-slate-900 tabular-nums ${className}`} title={title}>
        {value}
      </dd>
    </div>
  );
}

function ManagerChip({
  on,
  onClick,
  onHover,
  label,
  sub,
  tone: toneClass,
}: {
  on: boolean;
  onClick: () => void;
  onHover?: (event?: ReactMouseEvent) => void;
  label: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseMove={onHover ? (event) => onHover(event) : undefined}
      onMouseLeave={onHover ? () => onHover() : undefined}
      aria-pressed={on}
      className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-left ${on ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
    >
      <span>
        <span className="block text-[13px] font-semibold text-slate-900">{label}</span>
        {sub && <span className={`block text-[11px] ${toneClass ?? "text-slate-500"}`}>{sub}</span>}
      </span>
    </button>
  );
}

function PersonRow({
  node,
  pace,
  running,
  onHover,
}: {
  node: Node;
  pace: number;
  running: boolean;
  onHover: (node: Node | null, event?: ReactMouseEvent) => void;
}) {
  const seat = node.seat;
  const vacant = !seat?.person;
  const pct = pctOf(node.figures);
  const t = tone(node, pace);
  const more = moreOf(node);
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="min-w-0">
          <span className={`block truncate text-sm font-semibold ${vacant ? "text-rose-600" : "text-slate-900"}`}>
            {vacant ? "Vacant seat" : node.name}
          </span>
          <span className="block truncate text-[11.5px] text-slate-500">
            {[seat?.title, seat?.area?.name?.split("|").slice(1, 2).join("").trim() || null].filter(Boolean).join(" · ")}
          </span>
        </span>
      </span>
      <span className="col-span-2 sm:col-span-1">
        {node.figures.target ? (
          <PaceBar pct={pct} pace={running ? pace : null} tone={t} />
        ) : (
          <span className="text-[11px] text-slate-400">No target</span>
        )}
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          <span>{more.placed} placed</span>
          {more.open > 0 && <span>{more.open} open</span>}
          {more.customers > 0 && <span>{more.customers} customers</span>}
          {more.owed > 0 && <span className={more.overdue > 0 ? "text-amber-700" : ""}>{shortPeso(more.owed)} owed</span>}
          {seat?.lastOrderAt && <span>last order {daysAgo(seat.lastOrderAt)}</span>}
        </span>
      </span>
      <span className="hidden text-right text-[13px] text-slate-700 tabular-nums sm:block" title={exactPeso(node.figures.sold)}>
        {shortPeso(node.figures.sold)}
        {node.figures.target > 0 && <span className="text-slate-400"> / {shortPeso(node.figures.target)}</span>}
      </span>
      <span className={`text-right text-sm tabular-nums ${pct === null ? "text-slate-400" : `font-semibold ${PACE_TEXT[t]}`}`}>
        {pct === null ? "—" : `${Math.round(pct)}%`}
      </span>
    </>
  );
  const grid =
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_8.5rem_3.5rem] sm:px-5";
  return (
    <li onMouseMove={(event) => onHover(node, event)} onMouseLeave={() => onHover(null)}>
      {seat ? (
        <Link to={`/my-team/seat/${seat.seatId}`} className={`${grid} hover:bg-slate-50`}>
          {body}
        </Link>
      ) : (
        <div className={grid}>{body}</div>
      )}
    </li>
  );
}

const daysAgo = (at: string) => {
  const days = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

/** The details on hover: the month, the orders, the money, the people. */
function HoverCard({ node, pace, running, x, y }: { node: Node; pace: number; running: boolean; x: number; y: number }) {
  const more = moreOf(node);
  const pct = pctOf(node.figures);
  const t = tone(node, pace);
  const seat = node.level === "person" ? node.seat : null;
  const rows: [string, string][] = [
    ["Sold this month", `${shortPeso(node.figures.sold)}${node.figures.target ? ` of ${shortPeso(node.figures.target)}` : ""}`],
    ...(running && node.figures.today ? ([["Today", shortPeso(node.figures.today)]] as [string, string][]) : []),
    ["Orders placed", String(more.placed)],
    ...(more.open ? ([["Open orders now", String(more.open)]] as [string, string][]) : []),
    ["Money owed", more.owed ? `${shortPeso(more.owed)}${more.overdue ? ` · ${shortPeso(more.overdue)} overdue` : ""}` : "—"],
    ...(seat
      ? ([
          ["Customers", String(seat.customers)],
          ["Last order", seat.lastOrderAt ? daysAgo(seat.lastOrderAt) : "—"],
          ["Collected this month", shortPeso(seat.collected)],
        ] as [string, string][])
      : ([
          ["People", `${node.figures.people}${node.figures.vacant ? ` · ${node.figures.vacant} vacant` : ""}`],
          ["Customers", String(more.customers)],
        ] as [string, string][])),
  ];
  const left = Math.min(x + 16, window.innerWidth - 300);
  const top = Math.min(y + 16, window.innerHeight - 260);
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-40 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
      style={{ left, top }}
    >
      <p className="text-[13px] font-semibold text-slate-900">{seat && !seat.person ? "Vacant seat" : node.name}</p>
      <p className="truncate text-[11.5px] text-slate-500">{seat ? [seat.title, seat.area?.name].filter(Boolean).join(" · ") : node.sub}</p>
      {node.figures.target > 0 && (
        <div className="mt-2">
          <PaceBar pct={pct} pace={running ? pace : null} tone={t} />
          <p className={`mt-1 text-[12px] font-semibold ${PACE_TEXT[t]}`}>{Math.round(pct ?? 0)}% of the target</p>
        </div>
      )}
      <dl className="mt-2 space-y-1 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium text-slate-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A channel's own work for one box: the blocks its manager's and its people's desks are built on. */
export function ChannelWork({
  division,
  me,
  unit,
  narrow = false,
}: {
  division: string;
  me: Me;
  unit: number | null;
  /** One manager's team picked inside the channel. */
  narrow?: boolean;
}) {
  switch (division) {
    case "RX Business":
      return <RxFieldBlock unit={unit} />;
    case "MD Telesales":
      return <TelesalesCoachHome unit={unit} />;
    case "B2B":
      return <B2bTeamCard unit={unit} />;
    case "CLIDP":
      return <ClidpTeamCard unit={unit} />;
    case "BID":
      return me.role === "team_lead" ? <BiddingHome /> : <BiddingCard unit={unit} />;
    case "HOSP":
      // The head: the teams side by side; one team (a coach picked, or the coach's own): its day.
      return me.role === "manager" && !narrow ? <HospitalTeams unit={unit} /> : <DistrictNow unit={unit} />;
    case "MT":
      return <MtHome />;
    default:
      return null;
  }
}
