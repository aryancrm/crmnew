// The Leads desk as a board, as the old CRM's board view (frontend/app/m/[model]/page.tsx,
// `?view=board`): a lane per step of the desk's line (New → Rx → Quote → Papers / GL → Ready →
// Ordered → Delivered, unpaid → Done, and Lost when the queue holds closed cards), its count on top,
// the cards under it, each a small card that opens the case.

import type { DeskStep, LeadCard, LeadDesk } from "@2mg/api/types";
import { Phone } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { avatarTone, initials } from "../look";
import { count, timeLabel } from "../ui";
import { AGENCIES, ROAD_BADGE } from "./parts";

/** How many cards a lane draws before "more in this lane". */
const LANE_CARDS = 25;

const LANE_DOT: Partial<Record<DeskStep, string>> = {
  new: "bg-sky-500",
  rx: "bg-indigo-500",
  quote: "bg-blue-500",
  papers: "bg-purple-500",
  ready: "bg-teal-500",
  ordered: "bg-cyan-600",
  unpaid: "bg-amber-500",
  done: "bg-emerald-500",
  lost: "bg-rose-500",
};

/** The card's rail on the left: the road while it is worked, green when done, rose when lost. */
function railOf(card: LeadCard): string {
  if (card.lost) return "border-l-rose-400";
  if (card.finished) return "border-l-emerald-500";
  if (card.road === "gl") return "border-l-purple-500";
  if (card.road === "senior" || card.road === "pwd") return "border-l-amber-500";
  return "border-l-blue-500";
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes < 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

export function DeskBoard({
  data,
  lanes,
  picked,
  onMore,
}: {
  data: LeadDesk;
  lanes: { key: DeskStep; label: string }[];
  /** The step picked on the line: its lane is ringed and scrolled into view. */
  picked: string;
  /** Opens the cards of one step (the lane's "more"). */
  onMore: (step: DeskStep) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Sideways only: the page itself stays where it is.
    const lane = picked
      ? board.current?.querySelector<HTMLElement>(`[data-lane="${picked}"]`)
      : null;
    if (!lane || !board.current) return;
    const left =
      board.current.scrollLeft +
      lane.getBoundingClientRect().left -
      board.current.getBoundingClientRect().left -
      24;
    board.current.scrollTo({ left: Math.max(0, left) });
  }, [picked]);

  return (
    <div ref={board} className="grid auto-cols-[18rem] grid-flow-col gap-3.5 overflow-x-auto pb-4">
      {lanes.map((lane) => {
        const cards = data.cards.filter((card) =>
          lane.key === "lost" ? card.lost : !card.lost && card.deskStep === lane.key,
        );
        const total = lane.key === "lost" ? data.counts.lost : (data.steps[lane.key] ?? 0);
        const shown = cards.slice(0, LANE_CARDS);
        const more = Math.max(total, cards.length) - shown.length;
        return (
          <section
            key={lane.key}
            data-lane={lane.key}
            aria-label={`${lane.label}: ${total}`}
            className={`flex min-h-40 flex-col rounded-xl border bg-stone-100/60 p-2.5 ${
              picked === lane.key
                ? "border-emerald-300 ring-2 ring-emerald-200"
                : "border-stone-200/80"
            }`}
          >
            <div className="flex items-center justify-between px-1.5 py-1 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${LANE_DOT[lane.key] ?? "bg-slate-400"}`}
                />
                {lane.label}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-stone-600 tabular-nums ring-1 ring-stone-200/80">
                {count(total)}
              </span>
            </div>
            <div className="mt-2.5 space-y-2">
              {shown.map((card) => (
                <BoardCard key={card.id} card={card} />
              ))}
              {shown.length === 0 && (
                <p className="px-1.5 py-3 text-center text-[11px] text-stone-400">Nothing here</p>
              )}
              {more > 0 && (
                <button
                  type="button"
                  onClick={() => onMore(lane.key)}
                  className="w-full rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold text-emerald-700 hover:bg-white"
                >
                  {count(more)} more in {lane.label}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ card }: { card: LeadCard }) {
  const road = ROAD_BADGE[card.road];
  const agency = AGENCIES.find((item) => item.key === card.agency)?.short;
  const when = card.lastMessageAt ?? card.firstContactAt;
  return (
    <Link
      to={`/leads/${card.id}`}
      title={card.patient ? `${card.name} · for ${card.patient}` : card.name}
      className={`block rounded-xl border border-l-[3px] border-slate-200/90 p-3 text-sm shadow-2xs transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${railOf(card)} ${
        card.lost
          ? "bg-rose-50/60"
          : card.finished
            ? "bg-emerald-50"
            : card.unopened
              ? "bg-sky-50/40"
              : "bg-white"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ring-1 ring-black/5 ring-inset ${avatarTone(card.name)}`}
        >
          {initials(card.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate font-semibold text-slate-900">{card.name}</span>
            {card.awaitingReply && !card.lost && (
              <span title="Needs reply" className="size-1.5 shrink-0 rounded-full bg-sky-600" />
            )}
            <span className="ml-auto shrink-0 rounded border border-slate-200 bg-white px-1 text-[10px] font-semibold text-slate-500">
              {card.code}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-stone-500">
            {card.patient ? (
              <>for {card.patient}</>
            ) : card.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3 text-slate-400" /> {card.phone}
              </span>
            ) : (
              "No phone added"
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${road.bg} ${road.text} ${road.border}`}
        >
          {card.road === "gl" ? `GL${agency ? ` (${agency})` : ""}` : road.label}
        </span>
        <span className="max-w-[140px] truncate text-[10px] font-semibold text-slate-600">
          {card.sourceLabel}
        </span>
      </div>
      {card.interest && (
        <p className="mt-1.5 truncate text-[11px] text-slate-600" title={card.interest}>
          <span className="font-semibold text-slate-700">Medicine:</span> {card.interest}
        </p>
      )}
      <p
        className={`mt-1.5 line-clamp-2 text-[11px] leading-snug font-medium ${card.lost ? "text-rose-700" : "text-slate-800"}`}
        title={card.lost ? (card.lostReason ?? "Closed as lost") : card.next}
      >
        {card.lost ? (card.lostReason ? `Lost: ${card.lostReason}` : "Closed as lost") : card.next}
      </p>
      <div className="mt-2.5 flex items-center justify-between border-t border-stone-100 pt-2 text-[11px] font-medium text-stone-400">
        <span className="truncate text-stone-500">{card.owner ?? "Unassigned"}</span>
        <span title={timeLabel(when)} className="shrink-0">
          {ago(when)}
        </span>
      </div>
    </Link>
  );
}
