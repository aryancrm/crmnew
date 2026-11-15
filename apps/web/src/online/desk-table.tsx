// The Leads desk as one dense row per card, as the old CRM's table (frontend/components/
// lead-table.tsx): the same cards the desk loaded, a row opens the same case. Sorted by the day
// the enquiry came in or by their last message; the newest first unless the header is pressed again.

import type { DeskStep, LeadCard } from "@2mg/api/types";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { timeLabel } from "../ui";
import { AGENCIES, ROAD_BADGE } from "./parts";

export type DeskSort = "-received" | "received" | "-message" | "message";

const STEP_TONE: Partial<Record<DeskStep, string>> = {
  new: "bg-sky-50 text-sky-800 ring-sky-200",
  unpaid: "bg-amber-50 text-amber-800 ring-amber-200",
  done: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  lost: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function deskSortOf(value: string | null): DeskSort {
  return value === "received" || value === "-message" || value === "message" ? value : "-received";
}

/** Pressing a header: newest first, then oldest first. */
function nextSort(sort: DeskSort, column: "received" | "message"): DeskSort {
  return sort === `-${column}` ? column : `-${column}`;
}

/** The loaded cards in the table's order; a card with no message goes last either way. */
export function sortDeskCards(cards: LeadCard[], sort: DeskSort): LeadCard[] {
  const column = sort.replace("-", "") as "received" | "message";
  const newest = sort.startsWith("-");
  const at = (card: LeadCard) =>
    column === "received" ? card.firstContactAt : (card.lastMessageAt ?? "");
  return [...cards].sort((a, b) => {
    const x = at(a);
    const y = at(b);
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    return newest ? y.localeCompare(x) : x.localeCompare(y);
  });
}

/** "5m", "13h", "2d", "3w": how long ago, in the table's few letters. */
function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

function received(iso: string): string {
  const year = new Intl.DateTimeFormat("en-PH", { year: "numeric", timeZone: "Asia/Manila" });
  const same = year.format(new Date(iso)) === year.format(new Date());
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    ...(same ? {} : { year: "numeric" }),
    timeZone: "Asia/Manila",
  }).format(new Date(iso));
}

export function DeskTable({
  cards,
  sort,
  onSort,
}: {
  cards: LeadCard[];
  sort: DeskSort;
  onSort: (sort: DeskSort) => void;
}) {
  const navigate = useNavigate();
  const head = "whitespace-nowrap px-3 py-2 text-left font-semibold";
  const sortHead = (column: "received" | "message", label: string) => {
    const on = sort === column || sort === `-${column}`;
    const Arrow = sort === column ? ArrowUp : ArrowDown;
    return (
      <th
        scope="col"
        aria-sort={on ? (sort.startsWith("-") ? "descending" : "ascending") : "none"}
        className={head}
      >
        <button
          type="button"
          onClick={() => onSort(nextSort(sort, column))}
          className={`inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${on ? "text-slate-900" : ""}`}
        >
          {label}
          <Arrow className={`size-3 ${on ? "" : "opacity-30"}`} aria-hidden="true" />
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[1080px] table-fixed text-xs">
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[14%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
          <tr>
            <th scope="col" className={head}>
              Name
            </th>
            <th scope="col" className={head}>
              Phone
            </th>
            <th scope="col" className={head}>
              Source
            </th>
            <th scope="col" className={head}>
              Road
            </th>
            <th scope="col" className={head}>
              Step
            </th>
            <th scope="col" className={head}>
              Next step
            </th>
            <th scope="col" className={head}>
              Medicine
            </th>
            {sortHead("message", "Last message")}
            <th scope="col" className={head}>
              Assigned to
            </th>
            {sortHead("received", "Received")}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cards.map((card) => {
            const { lost, finished } = card;
            const step: DeskStep = lost ? "lost" : finished ? "done" : card.deskStep;
            const stepLabel = lost ? "Lost" : finished ? "Done" : card.step.label;
            const road = ROAD_BADGE[card.road];
            const agency = AGENCIES.find((item) => item.key === card.agency)?.short;
            const next = lost
              ? card.lostReason
                ? `Lost: ${card.lostReason}`
                : "Closed as lost"
              : card.next;
            return (
              <tr
                key={card.id}
                onClick={() => navigate(`/leads/${card.id}`)}
                className={`cursor-pointer transition-colors ${
                  lost
                    ? "bg-rose-50/40 hover:bg-rose-50"
                    : finished
                      ? "bg-emerald-50/50 hover:bg-emerald-50"
                      : card.unopened
                        ? "bg-sky-50/40 hover:bg-sky-50"
                        : "hover:bg-slate-50"
                }`}
              >
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {card.awaitingReply && !lost && (
                      <span
                        title="Needs reply"
                        className="size-1.5 shrink-0 rounded-full bg-sky-600"
                      />
                    )}
                    <Link
                      to={`/leads/${card.id}`}
                      onClick={(event) => event.stopPropagation()}
                      title={card.patient ? `${card.name} · for ${card.patient}` : card.name}
                      className="truncate font-semibold text-slate-900 hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                    >
                      {card.name}
                    </Link>
                    <span
                      title={`Enquiry ${card.code}`}
                      className="shrink-0 rounded border border-slate-200 px-1 text-[10px] font-semibold text-slate-500"
                    >
                      {card.code}
                    </span>
                  </div>
                </td>
                <td
                  className="truncate px-3 py-2 text-slate-600 tabular-nums"
                  title={card.phone ?? ""}
                >
                  {card.phone ?? "—"}
                </td>
                <td className="truncate px-3 py-2 text-slate-600" title={card.sourceLabel}>
                  {card.sourceLabel}
                </td>
                <td className={`truncate px-3 py-2 font-medium ${road.text}`}>
                  {card.road === "gl" ? `GL${agency ? ` · ${agency}` : ""}` : road.label}
                </td>
                <td className="px-2 py-2">
                  <span
                    title={lost ? "Lost" : `${card.step.label} — ${card.step.hint}`}
                    className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                      STEP_TONE[step] ?? "bg-slate-50 text-slate-700 ring-slate-200"
                    }`}
                  >
                    {stepLabel}
                  </span>
                </td>
                <td
                  className={`truncate px-3 py-2 ${lost ? "text-rose-700" : "text-slate-800"}`}
                  title={next}
                >
                  {next || "—"}
                </td>
                <td className="truncate px-3 py-2 text-slate-600" title={card.interest ?? ""}>
                  {card.interest ?? "—"}
                </td>
                <td
                  className="truncate px-3 py-2 text-slate-500 tabular-nums"
                  title={
                    card.lastMessageAt
                      ? `${timeLabel(card.lastMessageAt)}${card.lastMessage ? ` · ${card.lastMessage}` : ""}`
                      : undefined
                  }
                >
                  {card.lastMessageAt ? ago(card.lastMessageAt) : "—"}
                </td>
                <td className="truncate px-3 py-2 text-slate-600" title={card.owner ?? ""}>
                  {card.owner ?? <span className="text-slate-400">Unassigned</span>}
                </td>
                <td
                  className="truncate px-3 py-2 text-slate-500 tabular-nums"
                  title={timeLabel(card.firstContactAt)}
                >
                  {received(card.firstContactAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
