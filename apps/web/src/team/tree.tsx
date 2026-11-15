// The team as a chart, top to bottom: each box's lead, the seats under it, the boxes under it.
// Every seat is a small card (the person or Vacant, the job, the login, sold against target)
// that opens the seat's page. Drawn with CSS lines, scrolled sideways when it is wide.

import type { TeamBoard, TeamSeatCard } from "@2mg/api/types";
import { Link } from "react-router-dom";
import { shortPeso } from "../ceo";

const CSS = `
.tch{overflow-x:auto;padding-bottom:4px}
.tch ul{position:relative;display:flex;justify-content:center;margin:0;padding:18px 0 0}
.tch li{position:relative;list-style:none;text-align:center;padding:18px 5px 0}
.tch li::before,.tch li::after{content:"";position:absolute;top:0;right:50%;width:50%;height:18px;border-top:1.5px solid #cbd5e1}
.tch li::after{right:auto;left:50%;border-left:1.5px solid #cbd5e1}
.tch li:only-child::before,.tch li:only-child::after{display:none}
.tch li:only-child{padding-top:0}
.tch li:first-child::before,.tch li:last-child::after{border:0}
.tch li:last-child::before{border-right:1.5px solid #cbd5e1;border-radius:0 7px 0 0}
.tch li:first-child::after{border-radius:7px 0 0 0}
.tch ul ul::before{content:"";position:absolute;top:0;left:50%;height:18px;border-left:1.5px solid #cbd5e1}
.tch > ul{padding-top:0}
`;

type Unit = TeamBoard["units"][number];

function SeatBox({ seat, pace, to }: { seat: TeamSeatCard; pace: number; to: string }) {
  const share = seat.target ? seat.sold / seat.target : null;
  const tone =
    share === null
      ? "bg-slate-300"
      : share >= pace
        ? "bg-emerald-500"
        : share >= pace / 2
          ? "bg-amber-400"
          : "bg-rose-500";
  return (
    <Link
      to={to}
      className={`inline-flex w-40 flex-col gap-1 rounded-xl border px-3 py-2 text-left shadow-sm transition-colors hover:border-emerald-400 ${
        seat.person ? "border-slate-200 bg-white" : "border-amber-300 bg-amber-50"
      } ${seat.lead ? "ring-2 ring-emerald-100" : ""}`}
    >
      <span className="flex items-center justify-between gap-1">
        <span
          className={`truncate text-[13px] font-semibold ${seat.person ? "text-slate-900" : "text-amber-800"}`}
        >
          {seat.person?.name ?? (seat.acting ? `Vacant · ${seat.acting.name} covers` : "Vacant")}
        </span>
        {seat.login && (
          <span className="shrink-0 font-mono text-[10px] text-slate-400">{seat.login}</span>
        )}
      </span>
      <span className="truncate text-[11px] text-slate-500">
        {[seat.title, seat.area?.name].filter(Boolean).join(" · ")}
      </span>
      <span className="mt-0.5 h-1.5 rounded-full bg-slate-100">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(100, (share ?? (seat.sold > 0 ? 1 : 0)) * 100)}%` }}
        />
      </span>
      <span className="flex justify-between text-[10px] text-slate-500 tabular-nums">
        <span>{shortPeso(seat.sold)}</span>
        <span>{share === null ? "no target" : `${Math.round(share * 100)}%`}</span>
      </span>
    </Link>
  );
}

/** A box of the tree in a big chart: its name, its lead, its people and how it is selling. */
function UnitBox({
  unit,
  seats,
  pace,
  to,
  topLead,
}: {
  unit: Unit;
  seats: TeamSeatCard[];
  pace: number;
  to: string;
  /** Who leads the company itself (its CEO), whose seat isn't among the figures. */
  topLead?: string;
}) {
  const lead = seats.find((seat) => seat.unitId === unit.id && seat.lead);
  const sold = seats.reduce((sum, seat) => sum + seat.sold, 0);
  const targets = seats.filter((seat) => seat.target !== null);
  const target = targets.length ? targets.reduce((sum, seat) => sum + (seat.target ?? 0), 0) : null;
  const share = target ? sold / target : null;
  const tone =
    share === null
      ? "bg-slate-300"
      : share >= pace
        ? "bg-emerald-500"
        : share >= pace / 2
          ? "bg-amber-400"
          : "bg-rose-500";
  const people = seats.filter((seat) => seat.person).length;
  const vacant = seats.length - people;
  return (
    <Link
      to={to}
      className="inline-flex w-44 flex-col gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm hover:border-emerald-400"
    >
      <span className="truncate text-[12px] font-bold text-slate-900">{unit.name}</span>
      <span className="truncate text-[11px] text-slate-500">
        {lead
          ? (lead.person?.name ?? (lead.acting ? `${lead.acting.name} covers` : "Lead vacant"))
          : unit.kind === "company" && topLead
            ? topLead
            : "No lead seat"}
      </span>
      <span className="mt-0.5 h-1.5 rounded-full bg-slate-100">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(100, (share ?? (sold > 0 ? 1 : 0)) * 100)}%` }}
        />
      </span>
      <span className="flex justify-between text-[10px] text-slate-500 tabular-nums">
        <span>
          {people} people{vacant ? ` · ${vacant} vacant` : ""}
        </span>
        <span>{shortPeso(sold)}</span>
      </span>
    </Link>
  );
}

export function TeamChart({
  board,
  seatHref,
  unitHref,
  compact = false,
}: {
  board: TeamBoard;
  seatHref: (seatId: number) => string;
  /** Opens a box (big charts show boxes, not seats). */
  unitHref?: (unitId: number) => string;
  /** Boxes only: for the whole company or a whole business. */
  compact?: boolean;
}) {
  const ids = new Set(board.units.map((unit) => unit.id));
  const tops = board.units.filter((unit) => unit.parentId === null || !ids.has(unit.parentId));
  const pace = board.pace;
  const parentOf = new Map(board.units.map((unit) => [unit.id, unit.parentId]));
  const under = (top: number) =>
    board.seats.filter((seat) => {
      for (let at: number | null | undefined = seat.unitId; at != null; at = parentOf.get(at))
        if (at === top) return true;
      return false;
    });

  const box = (unit: Unit) => (
    <li key={`u${unit.id}`}>
      <UnitBox
        unit={unit}
        seats={under(unit.id)}
        pace={pace}
        to={unitHref ? unitHref(unit.id) : "#"}
        topLead={board.lead.name}
      />
      {board.units.some((one) => one.parentId === unit.id && under(one.id).length > 0) && (
        <ul>
          {board.units
            .filter((one) => one.parentId === unit.id && under(one.id).length > 0)
            .map(box)}
        </ul>
      )}
    </li>
  );
  if (compact)
    return (
      <div className="tch">
        <style>{CSS}</style>
        <ul>{tops.filter((unit) => under(unit.id).length > 0).map(box)}</ul>
      </div>
    );

  const node = (unit: Unit) => {
    const lead = board.seats.find((seat) => seat.unitId === unit.id && seat.lead);
    const members = board.seats.filter((seat) => seat.unitId === unit.id && !seat.lead);
    const kids = board.units.filter((one) => one.parentId === unit.id && under(one.id).length > 0);
    const below = (
      <>
        {members.map((seat) => (
          <li key={seat.seatId}>
            <SeatBox seat={seat} pace={pace} to={seatHref(seat.seatId)} />
          </li>
        ))}
        {kids.map((kid) => (
          <li key={`u${kid.id}`}>{node(kid)}</li>
        ))}
      </>
    );
    return (
      <>
        <div className="inline-flex flex-col items-center gap-1">
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
            {unit.name}
          </span>
          {lead && <SeatBox seat={lead} pace={pace} to={seatHref(lead.seatId)} />}
        </div>
        {members.length + kids.length > 0 && <ul>{below}</ul>}
      </>
    );
  };

  return (
    <div className="tch">
      <style>{CSS}</style>
      <ul>
        {tops
          .filter((unit) => under(unit.id).length > 0)
          .map((unit) => (
            <li key={unit.id}>{node(unit)}</li>
          ))}
      </ul>
    </div>
  );
}
