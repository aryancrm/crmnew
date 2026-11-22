// A team lead's (or a head's) team, read from the seats under them in the company's tree, for the
// days picked (this month unless chosen): six figures in plain words, sales day by day, where the
// orders stand now, the team as a chart, one card per team (division) and per person, who sold
// most, the medicines that sold, customers by kind, how long orders wait at each step, and what
// needs the lead now. A seat opens its own page. The CEO and the Admin open any box (?unit=).

import type {
  CustomerList,
  MyOrderStage,
  MyOrders,
  TeamBoard,
  TeamNeed,
  TeamSeatCard,
} from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Clock,
  Eye,
  Gauge,
  HandCoins,
  Mail,
  MapPin,
  Network,
  Package,
  Phone,
  Plus,
  ShoppingCart,
  Truck,
  Undo2,
  UserPlus,
  UserRoundX,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TeamSwitch } from "./switch";
import { placesOrders, useMe } from "../auth";

import { counted, exactPeso, shortPeso } from "../ceo";
import { dayHeading, PRIMARY_SM } from "../look";
import { span, waited } from "../orders/parts";
import { AskForPersonDialog } from "../org/areas-requests";
import { lookAs } from "../shell";
import { Bars, DayBars, Donut, Ring, Spark } from "./charts";
import { DeskWork } from "./desk-work";
import { OfficeWork } from "./office-work";
import { RangePicker, short } from "./range";
import { TeamChart } from "./tree";
import { ZoomBox } from "./zoom";
import { count, PageState, manilaDay } from "../ui";
import { TONE, type Tone, toneOf } from "./pace";
import { OrderCardItem } from "../orders/board";

const CARD = "rounded-2xl border border-slate-200/90 bg-white shadow-sm";

const STEP_SHORT: Record<string, string> = {
  pending_approval: "at Management",
  finance_check: "with Finance",
  ready_for_invoice: "for its invoice",
  ready_for_dispatch: "to be packed",
  packing: "packed",
  shipped: "on the road",
  on_hold: "on hold",
  exception: "on hold",
  draft: "sent back",
};
const STEP_NAME = {
  management: "Management",
  finance: "Finance",
  dispatch: "Packing",
  road: "On the road",
} as const;

const useBoard = (unit: string | null, from: string | null, to: string | null) =>
  useQuery({
    queryKey: ["team", "board", unit ?? "", from ?? "", to ?? ""],
    queryFn: () => {
      const query = new URLSearchParams();
      if (unit) query.set("unit", unit);
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      return api<TeamBoard>(`/api/team/board?${query}`);
    },
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });

// ---- Pieces ----

function Tile({
  icon,
  tint,
  label,
  value,
  title,
  note,
  children,
}: {
  icon: ReactNode;
  tint: string;
  label: string;
  value: string;
  title?: string;
  note: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`${CARD} flex min-w-0 items-center gap-3 p-4`}>
      {children ?? (
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${tint}`}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div
          title={title}
          className="text-xl font-semibold tracking-tight text-slate-900 tabular-nums"
        >
          {value}
        </div>
        <div className="truncate text-[11px] text-slate-500">{note}</div>
      </div>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD} min-w-0 p-4 sm:p-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </header>
      {children}
    </section>
  );
}

const CHIPS: [keyof TeamSeatCard["stages"], string, string][] = [
  ["management", "Management", "bg-violet-50 text-violet-700"],
  ["finance", "Finance", "bg-amber-50 text-amber-800"],
  ["dispatch", "Packing", "bg-sky-50 text-sky-700"],
  ["road", "On the road", "bg-teal-50 text-teal-700"],
  ["held", "On hold", "bg-rose-50 text-rose-700"],
  ["sentBack", "Sent back", "bg-amber-100 text-amber-900"],
];

/** One person (or empty seat), as the customer cards look: who, how they are doing, where things stand. */
function PersonCard({ seat, pace, to }: { seat: TeamSeatCard; pace: number; to: string }) {
  const tone: Tone = seat.person ? toneOf(seat.sold, seat.target, pace) : "vacant";
  const share = seat.target ? seat.sold / seat.target : null;
  const chips = CHIPS.filter(([key]) => seat.stages[key] > 0);
  return (
    <Link
      to={to}
      className={`group flex min-w-0 flex-col gap-3 rounded-2xl border p-3.5 shadow-sm transition-[border-color,box-shadow] hover:shadow-md ${
        seat.person
          ? "border-slate-200/90 bg-white hover:border-emerald-300"
          : "border-amber-200 bg-amber-50/40 hover:border-amber-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight text-slate-900 group-hover:text-emerald-800">
            {seat.person?.name ?? (seat.acting ? `${seat.acting.name} covers` : "Nobody yet")}
          </h3>
          <div className="truncate text-[11px] font-medium text-slate-500">
            {seat.login && (
              <span className="font-mono font-semibold text-slate-700">{seat.login}</span>
            )}
            {seat.login ? " · " : ""}
            {seat.title}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${TONE[tone].pill}`}
        >
          {TONE[tone].word}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
        {seat.area && (
          <span className="inline-flex max-w-[170px] items-center gap-0.5 truncate">
            <MapPin className="size-2.5 shrink-0 text-slate-400" />
            <span className="truncate">{seat.area.name}</span>
          </span>
        )}
        {seat.person?.phone && <span className="tabular-nums">{seat.person.phone}</span>}
      </div>
      <div className="flex items-center gap-3">
        <Ring share={share} pace={pace} color={TONE[tone].ring} size={52}>
          {share === null ? "—" : `${Math.round(share * 100)}%`}
        </Ring>
        <dl className="grid min-w-0 flex-1 grid-cols-3 gap-1 text-center">
          {[
            ["Sold", shortPeso(seat.sold)],
            ["Orders", String(seat.placed)],
            ["Collected", shortPeso(seat.collected)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg bg-slate-50 px-1 py-1.5">
              <dt className="text-[10px] text-slate-500">{label}</dt>
              <dd className="truncate text-[13px] font-semibold text-slate-900 tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <Spark values={seat.spark} />
      <div className="flex min-h-5 flex-wrap gap-1">
        {chips.length ? (
          chips.map(([key, label, style]) => (
            <span
              key={key}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${style}`}
            >
              {label} {seat.stages[key]}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-slate-400">Nothing open</span>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
        {seat.area && <span>{counted(seat.customers, "customer")}</span>}
        {seat.newCustomers > 0 && (
          <span className="text-emerald-700">+{seat.newCustomers} new</span>
        )}
        {seat.lastOrderAt && <span>last order {waited(seat.lastOrderAt)} ago</span>}
        {seat.owed > 0 && (
          <span className={seat.overdue ? "font-semibold text-rose-600" : ""}>
            {shortPeso(seat.owed)} owed{seat.overdue ? ` · ${shortPeso(seat.overdue)} late` : ""}
          </span>
        )}
      </div>
    </Link>
  );
}

/** A team (division) at a glance: its lead, people, sold against target, what moves. */
function DivisionCard({
  unit,
  seats,
  pace,
  picked,
  onPick,
}: {
  unit: TeamBoard["units"][number];
  seats: TeamSeatCard[];
  pace: number;
  picked: boolean;
  onPick: () => void;
}) {
  const lead = seats.find((seat) => seat.lead);
  const sold = seats.reduce((sum, seat) => sum + seat.sold, 0);
  const targets = seats.filter((seat) => seat.target !== null);
  const target = targets.length ? targets.reduce((sum, seat) => sum + (seat.target ?? 0), 0) : null;
  const tone = toneOf(sold, target, pace);
  const moving = seats.reduce(
    (sum, seat) =>
      sum + seat.stages.management + seat.stages.finance + seat.stages.dispatch + seat.stages.road,
    0,
  );
  const stopped = seats.reduce((sum, seat) => sum + seat.stages.held + seat.stages.sentBack, 0);
  const owed = seats.reduce((sum, seat) => sum + seat.owed, 0);
  const vacant = seats.filter((seat) => !seat.person).length;
  const spark =
    seats[0]?.spark.map((_, n) => seats.reduce((sum, seat) => sum + (seat.spark[n] ?? 0), 0)) ?? [];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      className={`${CARD} flex min-w-0 flex-col gap-3 p-4 text-left transition-colors ${picked ? "border-emerald-400 ring-2 ring-emerald-100" : "hover:border-emerald-300"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{unit.name}</div>
          <div className="truncate text-[11px] text-slate-500">
            {lead
              ? `Led by ${lead.person?.name ?? (lead.acting ? `${lead.acting.name} (covering)` : "nobody yet")}`
              : "No lead seat"}
          </div>
        </div>
        <Ring share={target ? sold / target : null} pace={pace} color={TONE[tone].ring} size={48}>
          {target ? `${Math.round((sold / target) * 100)}%` : "—"}
        </Ring>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span>
          <b className="text-slate-900">{seats.length - vacant}</b> people
        </span>
        {vacant > 0 && <span className="font-semibold text-amber-700">{vacant} vacant</span>}
        <span>
          <b className="text-slate-900">{shortPeso(sold)}</b> sold
        </span>
        <span>{moving} moving</span>
        {stopped > 0 && <span className="text-rose-600">{stopped} stopped</span>}
        {owed > 0 && <span>{shortPeso(owed)} owed</span>}
      </div>
      <Spark values={spark} />
    </button>
  );
}

const NEED: Record<TeamNeed["kind"], { icon: ReactNode; tone: string }> = {
  sent_back: { icon: <Undo2 className="size-4" />, tone: "bg-amber-50 text-amber-700" },
  held: { icon: <CirclePause className="size-4" />, tone: "bg-rose-50 text-rose-600" },
  late: { icon: <Clock className="size-4" />, tone: "bg-violet-50 text-violet-700" },
  overdue: { icon: <Banknote className="size-4" />, tone: "bg-rose-50 text-rose-600" },
  vacant: { icon: <UserRoundX className="size-4" />, tone: "bg-amber-50 text-amber-700" },
  score: { icon: <Gauge className="size-4" />, tone: "bg-violet-50 text-violet-700" },
};

function Needs({ needs, seatHref }: { needs: TeamNeed[]; seatHref: (seatId: number) => string }) {
  if (needs.length === 0)
    return <p className="text-sm text-slate-500">Nothing stuck. Every order is moving.</p>;
  return (
    <ul className="-mx-2 max-h-[26rem] overflow-y-auto">
      {needs.map((need) => (
        <li key={`${need.kind}-${need.code ?? need.seatId}-${need.why}`}>
          <Link
            to={need.orderId ? `/orders/${need.orderId}` : need.kind === "score" ? "/team-scores" : seatHref(need.seatId ?? 0)}
            className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
          >
            <span
              className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${NEED[need.kind].tone}`}
            >
              {NEED[need.kind].icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-slate-900">
                {need.code ? `${need.code} · ${need.customer}` : need.who}
              </span>
              <span className="line-clamp-2 text-xs text-slate-500">
                {need.code ? `${need.who} · ` : ""}
                {need.why}
                {need.amount && need.kind === "overdue" ? ` · ${shortPeso(need.amount)}` : ""}
              </span>
            </span>
            {need.since && need.kind !== "overdue" && (
              <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                {waited(need.since)}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const KIND_WORD: Record<string, string> = {
  hospital: "Hospitals",
  doctor: "Doctors",
  patient: "Patients",
  drugstore: "Drugstores",
  distributor: "Distributors",
  government: "Government",
};

// ---- Team performance (the hub's table) ----

/** Person by person, the hub's Team performance: today, the days picked, the target and how much
 *  of it is reached, what waits, what is owed; each opens their own page (read-only). */
function PerformanceTable({
  seats,
  units,
  pace,
  seatHref,
}: {
  seats: TeamSeatCard[];
  units: { id: number; name: string }[];
  pace: number;
  seatHref: (seatId: number) => string;
}) {
  const unitName = new Map(units.map((one) => [one.id, one.name]));
  const rows = seats
    .filter((seat) => seat.person)
    .sort((a, b) => b.sold - a.sold || b.today - a.today);
  if (!rows.length) return <p className="text-sm text-slate-500">No one in these seats yet.</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="t">
        <thead>
          <tr>
            <th>Person</th>
            <th>Team</th>
            <th className="num">Today</th>
            <th className="num">Sold</th>
            <th className="num">Target</th>
            <th className="num">% of target</th>
            <th className="num">Orders</th>
            <th className="num">Stopped</th>
            <th className="num">Owed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((seat, n) => {
            const share = seat.target ? seat.sold / seat.target : null;
            const tone = TONE[toneOf(seat.sold, seat.target, pace)];
            const stopped = seat.stages.held + seat.stages.sentBack;
            return (
              <tr key={seat.seatId}>
                <td>
                  <span className="mr-1.5 text-[11px] text-slate-400 tabular-nums">
                    {seat.today > 0 ? n + 1 : "–"}
                  </span>
                  <Link to={seatHref(seat.seatId)} className="font-semibold text-slate-900 hover:underline">
                    {seat.person?.name}
                  </Link>
                  <span className="block text-[11px] text-slate-500">{seat.title}</span>
                </td>
                <td className="whitespace-nowrap text-slate-600">{unitName.get(seat.unitId) ?? "—"}</td>
                <td className="num" title={exactPeso(seat.today)}>
                  {seat.today ? shortPeso(seat.today) : "—"}
                </td>
                <td className="num font-semibold" title={exactPeso(seat.sold)}>
                  {shortPeso(seat.sold)}
                </td>
                <td className="num">{seat.target ? shortPeso(seat.target) : "No target"}</td>
                <td className="num">
                  {share === null ? (
                    "—"
                  ) : (
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ring-1 ${tone.pill}`}>
                      {Math.round(share * 100)}%
                    </span>
                  )}
                </td>
                <td className="num">{seat.placed || "—"}</td>
                <td className={`num ${stopped ? "font-semibold text-rose-700" : ""}`}>{stopped || "—"}</td>
                <td className="num" title={exactPeso(seat.owed)}>
                  {seat.owed ? shortPeso(seat.owed) : "—"}
                </td>
                <td>
                  <Link to={seatHref(seat.seatId)} className="text-xs font-semibold whitespace-nowrap text-brand hover:underline">
                    Dashboard →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- The page ----

export function MyTeamPage() {
  const [params] = useSearchParams();
  const unit = params.get("unit");
  const query = useBoard(unit, params.get("from"), params.get("to"));
  const [everyone, setEveryone] = useState(false);
  const [asking, setAsking] = useState<"seat" | "region" | "area" | null>(null);
  // The chart: boxes of teams (a big view), or every person (a team's own view).
  const [chartAll, setChartAll] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const me = useMe().data;
  const data = query.data;
  if (!data) return <PageState query={query} what="your team" />;
  const { totals, pace } = data;
  const keep = new URLSearchParams();
  if (unit) keep.set("unit", unit);
  if (params.get("from")) keep.set("from", params.get("from") as string);
  if (params.get("to")) keep.set("to", params.get("to") as string);
  const seatHref = (seatId: number) => `/my-team/seat/${seatId}${keep.size ? `?${keep}` : ""}`;
  const tone = toneOf(totals.sold, totals.target, pace);
  // A team that sells (MedReps, team leads, a target or a sale) shows its sales; the others (Supply
  // Chain, Ops & Finance; Management) their desk work instead.
  const selling =
    totals.sold > 0 ||
    (totals.target ?? 0) > 0 ||
    data.seats.some((seat) =>
      /medrep|team lead|sales|online/i.test(`${seat.moduleLabel} ${seat.title}`),
    );
  const deskTeam = data.seats.some((seat) => /management|finance|dispatch|inventory|pharmac/i.test(`${seat.moduleLabel} ${seat.title}`));
  const kinds = (kind: TeamNeed["kind"]) => data.needs.filter((need) => need.kind === kind).length;
  // The boxes right under the one looked at (or the lead's own boxes, when they lead several):
  // each a card that opens it, so the CEO goes company → business → team → person.
  const parentOf = new Map(data.units.map((one) => [one.id, one.parentId]));
  const within = (top: number, unitId: number) => {
    for (let at: number | null | undefined = unitId; at != null; at = parentOf.get(at))
      if (at === top) return true;
    return false;
  };
  const seatsUnder = (top: number) => data.seats.filter((seat) => within(top, seat.unitId));
  const below =
    data.rootIds.length > 1
      ? data.units.filter((one) => data.rootIds.includes(one.id))
      : data.units.filter((one) => one.parentId !== null && data.rootIds.includes(one.parentId));
  const teams = below.filter((one) => seatsUnder(one.id).length > 0);
  const dates = new URLSearchParams();
  for (const key of ["from", "to"]) if (params.get(key)) dates.set(key, params.get(key) as string);
  const unitHref = (unitId: number) =>
    `/my-team?${new URLSearchParams([["unit", String(unitId)], ...dates])}`;
  const deep = teams.length > 0 && data.rootIds.length === 1;
  const own = deep ? data.seats.filter((seat) => data.rootIds.includes(seat.unitId)) : data.seats;
  const people = everyone || !deep ? data.seats : own;
  const showAll = chartAll ?? !(deep || data.seats.length > 24);
  const whole = me?.role === "ceo" || me?.role === "admin";
  const places = placesOrders(me);
  const rootLead = data.seats.find((seat) => data.rootIds.includes(seat.unitId) && seat.lead);
  // One step up from a team: the box above it, else my own team (or the company).
  const above = data.path.length > 1 ? data.path[data.path.length - 2] : null;
  const upHref = above ? unitHref(above.id) : `/my-team${dates.size ? `?${dates}` : ""}`;
  const upName = above
    ? `Back to ${above.name}`
    : whole
      ? "Back to the company"
      : "Back to my team";
  // Everyone who sold or placed something (a lead who sells counts too), most sold first; placed
  // orders say what is still on its way to being sold.
  const leaders = data.seats
    .filter((seat) => seat.person && (!seat.lead || seat.sold > 0 || seat.placedValue > 0))
    .sort((a, b) => b.sold - a.sold || b.placedValue - a.placedValue)
    .map((seat) => ({
      key: seat.seatId,
      label: seat.person?.name ?? "",
      sub: [
        seat.lead ? "Lead" : null,
        seat.login,
        seat.area?.name,
        seat.placedValue ? `placed ${shortPeso(seat.placedValue)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      value: seat.sold,
      mark: seat.target,
      tone: TONE[toneOf(seat.sold, seat.target, pace)].bar,
    }));
  const rangeWords =
    data.from === data.to ? short(data.from) : `${short(data.from)} – ${short(data.to)}`;

  return (
    <div
      className={`mx-auto w-full max-w-screen-2xl space-y-5 ${query.isPlaceholderData ? "opacity-60" : ""}`}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {(unit || data.path.length > 1) && (
            <nav
              aria-label="Where you are"
              className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500"
            >
              {unit && (
                // Up one level: the box above it (or the company / my own team).
                <Link
                  to={upHref}
                  title={upName}
                  aria-label={upName}
                  className="mr-1 grid size-6 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-emerald-300 hover:text-emerald-700"
                >
                  <ChevronLeft className="size-3.5" />
                </Link>
              )}
              {unit && !whole ? (
                <Link
                  to={`/my-team${dates.size ? `?${dates}` : ""}`}
                  className="hover:text-emerald-700 hover:underline"
                >
                  My team
                </Link>
              ) : null}
              {data.path.map((one, n) => (
                <span key={one.id} className="flex items-center gap-1">
                  {(n > 0 || unit) && <ChevronRight className="size-3" />}
                  {n === data.path.length - 1 ? (
                    <span className="font-semibold text-slate-700">{one.name}</span>
                  ) : (
                    <Link to={unitHref(one.id)} className="hover:text-emerald-700 hover:underline">
                      {one.name}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {data.viewing ?? "My team"}
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {[
              // Looking into a box: who leads it; else whose team this is.
              unit
                ? `Led by ${rootLead?.person?.name ?? (rootLead?.acting ? `${rootLead.acting.name} (covering)` : "nobody yet")}`
                : data.lead.units.length && !whole
                  ? `${data.lead.name} · leads ${data.lead.units.join(", ")}`
                  : null,
              `${counted(totals.people, "person", "people")} in ${counted(data.units.length, "team")}`,
              totals.vacant ? `${totals.vacant} empty seat${totals.vacant === 1 ? "" : "s"}` : null,
              ...(unit ? [] : data.lead.covering.map((seat) => `covering ${seat}`)),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {whole && unit && (
            <Link
              to={`/people?unit=${unit}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              title="Add, move or replace its people"
            >
              <UserPlus className="size-4" /> Change its people
            </Link>
          )}
          {(me?.role === "team_lead" || me?.role === "manager") && (
            <div className="inline-flex h-9 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm">
              <span className="flex items-center gap-1.5 border-r border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-500">
                <Plus className="size-3.5" /> Ask for
              </span>
              {(
                [
                  ["seat", "Person", UserPlus],
                  ["region", "Region", Network],
                  ["area", "Area", MapPin],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAsking(key)}
                  className="flex items-center gap-1.5 border-r border-slate-100 px-2.5 last:border-r-0 hover:bg-emerald-50 hover:text-emerald-800"
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
          )}
          <Link
            to="/targets"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Targets
          </Link>
          {/* The same people as a tree and on the map (the old reports, live), for this box. */}
          <Link
            to={`/company/sales${unit ? `?unit=${unit}` : ""}`}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Tree
          </Link>
          <Link
            to={`/company/map${unit ? `?unit=${unit}` : ""}`}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Map
          </Link>
          {places && (
            <Link to="/orders/new" className={PRIMARY_SM}>
              <Plus className="size-4" /> New order
            </Link>
          )}
        </div>
      </header>

      {/* The hub's switch: All · each team by its lead, one press turns the whole page. */}
      <TeamSwitch />

      {unit && rootLead && !rootLead.person && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          Nobody leads {data.viewing}
          {rootLead.acting ? `; ${rootLead.acting.name} covers it` : ""}.
          {whole ? (
            <>
              {" "}
              <Link to={`/people?unit=${unit}`} className="font-semibold underline">
                Fill the seat in Teams & people
              </Link>
            </>
          ) : null}
        </p>
      )}
      {asking && <AskForPersonDialog kind={asking} onClose={() => setAsking(null)} />}
      <RangePicker />

      {/* A team that moves orders (Management, Finance, Dispatch, Inventory) by its desk work; an
          office team (IT, HR, Digital Marketing, Regulatory) by its work logs. */}
      {!selling && deskTeam && (
        <DeskWork personIds={data.seats.flatMap((seat) => (seat.person ? [seat.person.id] : []))} />
      )}
      {!selling && !deskTeam && (
        <OfficeWork
          unit={unit}
          people={data.seats.flatMap((seat) => (seat.person ? [{ id: seat.person.id, name: seat.person.name, title: seat.title }] : []))}
        />
      )}
      {selling && (
        <section
          aria-label={`The team, ${rangeWords}`}
          className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
        >
          <Tile
            icon={null}
            tint=""
            label="Sold (invoiced)"
            value={shortPeso(totals.sold)}
            title={exactPeso(totals.sold)}
            note={
              totals.target
                ? `${TONE[tone].word} · target ${shortPeso(totals.target)}`
                : "No targets set"
            }
          >
            <Ring
              share={totals.target ? totals.sold / totals.target : null}
              pace={pace}
              color={TONE[tone].ring}
              size={48}
            >
              {totals.target ? `${Math.round((totals.sold / totals.target) * 100)}%` : "—"}
            </Ring>
          </Tile>
          <Tile
            icon={<HandCoins className="size-5" />}
            tint="bg-teal-50 text-teal-700"
            label="Money collected"
            value={shortPeso(totals.collected)}
            title={exactPeso(totals.collected)}
            note="Paid by customers"
          />
          <Tile
            icon={<ShoppingCart className="size-5" />}
            tint="bg-emerald-50 text-emerald-700"
            label="Orders placed"
            value={count(totals.placed)}
            note={`${shortPeso(totals.placedValue)}${totals.placed ? ` · avg ${shortPeso(totals.placedValue / totals.placed)}` : ""}`}
          />
          <Tile
            icon={<Truck className="size-5" />}
            tint="bg-sky-50 text-sky-700"
            label="Delivered"
            value={count(totals.delivered)}
            note={`${totals.waiting} on their way now`}
          />
          <Tile
            icon={<UserPlus className="size-5" />}
            tint="bg-violet-50 text-violet-700"
            label="New customers"
            value={count(totals.newCustomers)}
            note="Added in their areas"
          />
          <Tile
            icon={<Banknote className="size-5" />}
            tint={totals.overdue ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"}
            label="Customers owe"
            value={shortPeso(totals.owed)}
            title={exactPeso(totals.owed)}
            note={totals.overdue ? `${shortPeso(totals.overdue)} past due` : "Nothing past due"}
          />
        </section>
      )}

      {selling && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel
            title="Day by day"
            note={
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-emerald-100" /> Placed
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-emerald-600" /> Sold
                </span>
                {rangeWords}
              </span>
            }
          >
            <DayBars days={data.daily} />
          </Panel>
          <Panel title="Orders right now" note={`${totals.stopped} stopped`}>
            <Donut
              label="open"
              middle={String(totals.waiting + totals.stopped)}
              slices={[
                { label: "At Management", value: data.stagesNow.management, color: "#8b5cf6" },
                { label: "With Finance", value: data.stagesNow.finance, color: "#f59e0b" },
                { label: "Packing", value: data.stagesNow.dispatch, color: "#0ea5e9" },
                { label: "On the road", value: data.stagesNow.road, color: "#14b8a6" },
                { label: "On hold", value: data.stagesNow.held, color: "#f43f5e" },
                { label: "Sent back", value: data.stagesNow.sentBack, color: "#fbbf24" },
              ]}
            />
          </Panel>
        </div>
      )}

      <Panel
        title="The team"
        note={
          <span className="flex items-center gap-2">
            <span className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
              {(
                [
                  [false, "Teams"],
                  [true, "Everyone"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setChartAll(value)}
                  className={`rounded-md px-2.5 py-1 ${showAll === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </span>
            Click a box to open it
          </span>
        }
      >
        <ZoomBox height={showAll ? 560 : 420}>
          <TeamChart board={data} seatHref={seatHref} unitHref={unitHref} compact={!showAll} />
        </ZoomBox>
      </Panel>

      {teams.length > 0 && (
        <section aria-label="Teams" className="space-y-2.5">
          <h2 className="text-sm font-semibold text-slate-900">
            {deep
              ? `Teams in ${data.viewing ?? data.path[data.path.length - 1]?.name ?? "it"}`
              : "Your teams"}
            <span className="ml-2 text-xs font-normal text-slate-500">
              Open one to see its people, customers and orders
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {teams.map((one) => (
              <DivisionCard
                key={one.id}
                unit={one}
                seats={seatsUnder(one.id)}
                pace={pace}
                picked={false}
                onPick={() => navigate(unitHref(one.id))}
              />
            ))}
          </div>
        </section>
      )}

      {selling && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Who sold most" note="Sold (invoiced); the line marks each target">
            {leaders.length ? (
              <Bars rows={leaders} />
            ) : (
              <p className="text-sm text-slate-500">Nobody sold yet.</p>
            )}
          </Panel>
          <Panel
            title="Stuck in your team (you chase, the desk decides)"
            note={[
              kinds("sent_back") && `${kinds("sent_back")} sent back`,
              kinds("held") && `${kinds("held")} on hold`,
              kinds("late") && `${kinds("late")} late`,
              kinds("overdue") && `${kinds("overdue")} unpaid`,
              kinds("vacant") && `${kinds("vacant")} empty`,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <Needs needs={data.needs} seatHref={seatHref} />
          </Panel>
        </div>
      )}

      {selling && (
        <Panel
          title="Team performance"
          note={`${data.seats.filter((seat) => seat.person && seat.today > 0).length} of ${data.seats.filter((seat) => seat.person).length} sold today · ${rangeWords}`}
        >
          <PerformanceTable
            seats={data.seats}
            units={data.units}
            pace={pace}
            seatHref={seatHref}
          />
        </Panel>
      )}

      <section aria-label="People" className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {deep && !everyone ? "Its own people" : "Everyone"}
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
              {people.length}
            </span>
          </h2>
          {deep && (
            <button
              type="button"
              onClick={() => setEveryone((now) => !now)}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              {everyone ? "Only its own people" : `Show everyone under it (${data.seats.length})`}
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {people.map((seat) => (
            <PersonCard key={seat.seatId} seat={seat} pace={pace} to={seatHref(seat.seatId)} />
          ))}
        </div>
      </section>

      {selling && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Panel title="Medicines sold" note="Placed, by value">
            {data.topMedicines.length ? (
              <Bars
                rows={data.topMedicines.map((one) => ({
                  key: one.name,
                  label: one.name,
                  sub: `${count(one.qty)} pcs`,
                  value: one.value,
                }))}
                color="bg-sky-500"
              />
            ) : (
              <p className="text-sm text-slate-500">No order in these days.</p>
            )}
          </Panel>
          <Panel title="Customers" note="By kind, with their orders">
            <Bars
              rows={data.byKind.map((one) => ({
                key: one.kind,
                label: KIND_WORD[one.kind] ?? one.kind,
                sub: `${counted(one.orders, "order")} · ${shortPeso(one.value)}`,
                value: one.customers,
              }))}
              format={(value) => String(value)}
              color="bg-violet-500"
            />
          </Panel>
          <Panel title="Time at each step" note="Average, for orders that moved on">
            {data.stepTimes.length ? (
              <Bars
                rows={(["management", "finance", "dispatch", "road"] as const)
                  .map((step) => data.stepTimes.find((one) => one.step === step))
                  .filter((one): one is NonNullable<typeof one> => Boolean(one))
                  .map((one) => ({
                    key: one.step,
                    label: STEP_NAME[one.step],
                    sub: counted(one.orders, "order"),
                    value: Math.round(one.minutes),
                  }))}
                format={(minutes) => (minutes < 1 ? "<1m" : span(minutes))}
                color="bg-amber-500"
              />
            ) : (
              <p className="text-sm text-slate-500">No order moved on in these days.</p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

const STAGES: { key: MyOrderStage; label: string }[] = [
  { key: "all", label: "All" },
  { key: "sent_back", label: "Sent back" },
  { key: "management", label: "With Management" },
  { key: "finance", label: "With Finance" },
  { key: "dispatch", label: "Packing or on the way" },
  { key: "held", label: "On hold" },
  { key: "delivered", label: "Delivered this month" },
];

/** One seat of the team: who sits in it, their days picked, their orders and their customers. */
export function TeamSeatPage() {
  const { id } = useParams();
  const me = useMe().data;
  const places = placesOrders(me);
  const [params, setParams] = useSearchParams();
  const unit = params.get("unit");
  const tab = params.get("tab") === "customers" ? "customers" : "orders";
  const stage = (params.get("stage") ?? "all") as MyOrderStage;
  const page = Number(params.get("page")) || 1;
  const board = useBoard(unit, params.get("from"), params.get("to"));
  const orders = useQuery({
    queryKey: ["orders", "mine", "seat", id, stage, page],
    queryFn: () => api<MyOrders>(`/api/orders/mine?seat=${id}&stage=${stage}&page=${page}`),
    enabled: tab === "orders",
    placeholderData: (previous) => previous,
  });
  const customers = useQuery({
    queryKey: ["customers", "seat", id],
    queryFn: () => api<CustomerList>(`/api/customers?seat=${id}`),
    enabled: tab === "customers",
  });
  if (!board.data) return <PageState query={board} what="the seat" />;
  const keep = new URLSearchParams();
  for (const key of ["unit", "from", "to"])
    if (params.get(key)) keep.set(key, params.get(key) as string);
  const back = `/my-team${keep.size ? `?${keep}` : ""}`;
  const seat = board.data.seats.find((one) => String(one.seatId) === id);
  if (!seat)
    return (
      <div className="mx-auto max-w-md space-y-3 py-10 text-center">
        <p className="text-sm text-slate-600">This seat isn't in your team.</p>
        <Link to={back} className="text-sm font-semibold text-emerald-700 hover:underline">
          Back to my team
        </Link>
      </div>
    );
  const { pace } = board.data;
  const tone: Tone = seat.person ? toneOf(seat.sold, seat.target, pace) : "vacant";
  const share = seat.target ? seat.sold / seat.target : null;
  const unitName = board.data.units.find((one) => one.id === seat.unitId)?.name ?? "";
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
  const data = orders.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const days = board.data.daily.map((one, n) => ({
    ...one,
    sold: seat.spark[n] ?? 0,
    placed: 0,
    collected: 0,
  }));

  // The hub's ‹ Previous / Next ›: through the team's people, in Team performance's order.
  const order = board.data.seats
    .filter((one) => one.person)
    .sort((a, b) => b.sold - a.sold || b.today - a.today);
  const at = order.findIndex((one) => one.seatId === seat.seatId);
  const near = (step: number) => (at < 0 ? undefined : order[at + step]);
  const hrefOf = (seatId: number) => `/my-team/seat/${seatId}${keep.size ? `?${keep}` : ""}`;
  // What to talk about with them (the hub's "For the coaching talk"), from their figures.
  const daysLeft = Math.max(
    0,
    Math.round(
      (Date.parse(`${board.data.to}T00:00:00Z`) - Date.parse(`${board.data.today}T00:00:00Z`)) /
        86_400_000,
    ),
  );
  const stopped = seat.stages.held + seat.stages.sentBack;
  const talk = seat.person
    ? [
        seat.target
          ? seat.sold >= seat.target
            ? `Target reached: ${shortPeso(seat.sold)} of ${shortPeso(seat.target)}.`
            : `Needs ${shortPeso(seat.target - seat.sold)} more to reach the target (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).`
          : "No target set for these days: set it on Targets.",
        stopped
          ? `${stopped} order${stopped === 1 ? "" : "s"} stopped (on hold or sent back): see why below.`
          : "Nothing stopped.",
        `${seat.newCustomers} new customer${seat.newCustomers === 1 ? "" : "s"} in these days.`,
        seat.owed
          ? `${shortPeso(seat.owed)} owed by their customers${seat.overdue ? `, ${shortPeso(seat.overdue)} of it past due` : ""}.`
          : "Their customers owe nothing.",
        // Their last order placed in this CRM (Zoho's history counts in Sold, not here).
        seat.lastOrderAt ? `Last order placed ${short(manilaDay(seat.lastOrderAt))}.` : null,
      ].filter((line): line is string => Boolean(line))
    : [];

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={back}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="size-4" /> {board.data.viewing ?? "My team"}
        </Link>
        {order.length > 1 && at >= 0 && (
          <div className="flex items-center gap-1 text-sm">
            {near(-1) ? (
              <Link
                to={hrefOf(near(-1)?.seatId as number)}
                className="rounded-lg px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-100"
                title={near(-1)?.person?.name}
              >
                ‹ Previous
              </Link>
            ) : null}
            <span className="text-xs text-slate-400 tabular-nums">
              {at + 1} of {order.length}
            </span>
            {near(1) ? (
              <Link
                to={hrefOf(near(1)?.seatId as number)}
                className="rounded-lg px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-100"
                title={near(1)?.person?.name}
              >
                Next ›
              </Link>
            ) : null}
          </div>
        )}
      </div>
      {talk.length > 0 && (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-[13px] text-slate-700">
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-sky-900 uppercase">
            For the coaching talk
          </h2>
          <ul className="list-disc space-y-0.5 pl-5">
            {talk.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      <section className={`${CARD} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Ring share={share} pace={pace} color={TONE[tone].ring} size={64}>
              {share === null ? "—" : `${Math.round(share * 100)}%`}
            </Ring>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
                {seat.person?.name ?? "Nobody sits here yet"}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${TONE[tone].pill}`}
                >
                  {TONE[tone].word}
                </span>
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {[
                  seat.title,
                  unitName,
                  seat.area
                    ? `${seat.area.name}${seat.area.cities.length ? ` (${seat.area.cities.join(", ")})` : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-600">
                {seat.login && <span className="font-mono text-slate-500">Login {seat.login}</span>}
                {seat.person?.phone && (
                  <a
                    href={`tel:${seat.person.phone}`}
                    className="inline-flex items-center gap-1.5 hover:text-emerald-700"
                  >
                    <Phone className="size-3.5" /> {seat.person.phone}
                  </a>
                )}
                {seat.person?.email && (
                  <a
                    href={`mailto:${seat.person.email}`}
                    className="inline-flex items-center gap-1.5 hover:text-emerald-700"
                  >
                    <Mail className="size-3.5" /> {seat.person.email}
                  </a>
                )}
                {seat.person?.since && (
                  <span className="text-slate-400">
                    In this seat since {dayHeading(seat.person.since)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {seat.person && (me?.role === "ceo" || me?.role === "admin") && !me.viewedBy && (
              <button
                type="button"
                onClick={() => seat.person && lookAs(seat.person.id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                title="Open the CRM as they see it, read only"
              >
                <Eye className="size-4" /> See as {seat.person.name.split(" ")[0]}
              </button>
            )}
            {places && (
              <Link to="/orders/new" className={PRIMARY_SM}>
                <Plus className="size-4" /> New order
              </Link>
            )}
          </div>
        </div>
        {!seat.person && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            Nobody sits in this seat{seat.acting ? `; ${seat.acting.name} covers it` : ""}. Its
            customers wait with the team lead, who orders for them. The CEO fills the seat in Teams
            & people.
          </p>
        )}
      </section>

      <RangePicker />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          icon={<ShoppingCart className="size-5" />}
          tint="bg-emerald-50 text-emerald-700"
          label="Sold"
          value={shortPeso(seat.sold)}
          note={seat.target ? `of ${shortPeso(seat.target)} target` : "No target"}
        />
        <Tile
          icon={<HandCoins className="size-5" />}
          tint="bg-teal-50 text-teal-700"
          label="Collected"
          value={shortPeso(seat.collected)}
          note="Paid by customers"
        />
        <Tile
          icon={<Package className="size-5" />}
          tint="bg-sky-50 text-sky-700"
          label="Orders placed"
          value={count(seat.placed)}
          note={shortPeso(seat.placedValue)}
        />
        <Tile
          icon={<Truck className="size-5" />}
          tint="bg-sky-50 text-sky-700"
          label="Delivered"
          value={count(seat.delivered)}
          note={
            seat.oldest
              ? `Oldest open ${waited(seat.oldest.since)} ${STEP_SHORT[seat.oldest.status] ?? ""}`
              : "Nothing waiting"
          }
        />
        <Tile
          icon={<UserPlus className="size-5" />}
          tint="bg-violet-50 text-violet-700"
          label="Customers"
          value={count(seat.customers)}
          note={`+${seat.newCustomers} new`}
        />
        <Tile
          icon={<Banknote className="size-5" />}
          tint={seat.overdue ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"}
          label="They owe"
          value={shortPeso(seat.owed)}
          note={seat.overdue ? `${shortPeso(seat.overdue)} past due` : "Nothing past due"}
        />
      </section>

      <Panel title="Sold day by day">
        <DayBars days={days} />
      </Panel>

      <div className="flex gap-1 border-b border-slate-200">
        {(["orders", "customers"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => set({ tab: key === "orders" ? null : key, stage: null, page: null })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? "border-emerald-600 text-emerald-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {key === "orders" ? "Orders" : `Customers · ${seat.customers}`}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        !data ? (
          <PageState query={orders} what="the seat's orders" />
        ) : (
          <div className={`space-y-4 ${orders.isPlaceholderData ? "opacity-60" : ""}`}>
            <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
              {STAGES.map((one) => {
                const picked = one.key === data.stage;
                return (
                  <button
                    key={one.key}
                    type="button"
                    onClick={() => set({ stage: one.key === "all" ? null : one.key, page: null })}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${picked ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
                  >
                    {one.label}
                    <span
                      className={`rounded-full px-1.5 text-[10px] tabular-nums ${picked ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}
                    >
                      {count(data.counts[one.key])}
                    </span>
                  </button>
                );
              })}
            </div>
            {data.cards.length === 0 ? (
              <div className={`${CARD} px-5 py-8 text-center text-sm text-slate-500`}>
                No order here.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.cards.map((card) => (
                  <OrderCardItem
                    key={card.id}
                    card={card}
                    showRep={!seat.person}
                    manage={false}
                    busy={false}
                    onApprove={() => {}}
                    onResume={() => {}}
                    onAsk={() => {}}
                  />
                ))}
              </div>
            )}
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
                Page {data.page} of {pages}
                <button
                  type="button"
                  disabled={data.page <= 1}
                  onClick={() => set({ page: String(data.page - 1) })}
                  className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={data.page >= pages}
                  onClick={() => set({ page: String(data.page + 1) })}
                  className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>
        )
      ) : !customers.data ? (
        <PageState query={customers} what="the seat's customers" />
      ) : (
        <section className={`${CARD} overflow-hidden`}>
          {customers.data.rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              No customer in this area yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {customers.data.rows.map((row) => (
                <li key={row.id}>
                  <Link
                    to={`/customers/${row.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {row.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {[KIND_WORD[row.kind] ?? row.kind, row.specialty, row.city]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {counted(row.orders, "order")}
                      {row.lastOrderAt ? ` · last ${waited(row.lastOrderAt)} ago` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
