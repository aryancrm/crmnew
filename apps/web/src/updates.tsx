// What the CRM tells each person (an order sent back, a request to decide, a team announcement),
// kept under Messages rather than in a bell nobody opens: "Needs you" holds what waits on the
// person, "Updates" the news of what moved. Opening a line marks it read and opens its page.

import type { NotificationList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck, Inbox } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { waited } from "./orders/parts";

/** News that waits on the person: something to do, decide or look at now. */
const NEEDS_YOU = new Set([
  "sent_back",
  "to_pack",
  "to_finance",
  "medicine_request",
  "held",
  "came_back",
  "cancelled",
  "taken_back",
  "seat_request",
  "announcement",
  "leave_request",
  "form_request",
  "stock_back",
  // A team's order stopped: the team lead chases it.
  "team_stop",
  // Management asks a team lead or a Business Mentor for a yes; their answer comes back.
  "ask_up",
  "ask_answered",
  // The CRM's own alerts (automations) and samples asked, approved or on the way.
  "licence_expiring",
  "late_customers",
  "stock_expiring",
  "samples_count",
  "sample_request",
]);

export type UpdatesBox = "important" | "updates";
export const inBox = (box: UpdatesBox, kind: string) =>
  box === "important" ? NEEDS_YOU.has(kind) : !NEEDS_YOU.has(kind);

/** A dot by the kind of news: amber for what waits on you, rose for a stop, green for done. */
const TONE: Record<string, string> = {
  sent_back: "bg-amber-500",
  to_pack: "bg-amber-500",
  to_finance: "bg-amber-500",
  medicine_request: "bg-amber-500",
  resent: "bg-sky-500",
  held: "bg-rose-500",
  came_back: "bg-rose-500",
  cancelled: "bg-rose-500",
  taken_back: "bg-rose-500",
  approved: "bg-emerald-500",
  shipped: "bg-emerald-500",
  delivered: "bg-emerald-500",
  resumed: "bg-emerald-500",
  request_answered: "bg-emerald-500",
  seat_request: "bg-violet-500",
  announcement: "bg-sky-500",
  message: "bg-sky-500",
  team_stop: "bg-rose-500",
  team_news: "bg-emerald-500",
  ask_up: "bg-violet-500",
  ask_answered: "bg-violet-500",
};

/** The person's news, read every 30 seconds while the page is in view (shared by the sidebar's
 *  counts and the lists). */
export function useUpdates() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationList>("/api/notifications"),
    refetchInterval: () => (document.visibilityState === "visible" ? 30_000 : false),
  });
}

/** Unread lines in each box, for the sidebar. */
export function unreadIn(data: NotificationList | undefined, box: UpdatesBox): number {
  return (data?.rows ?? []).filter((row) => !row.read && inBox(box, row.kind)).length;
}

export function UpdatesList({ box }: { box: UpdatesBox }) {
  const query = useUpdates();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const rows = (query.data?.rows ?? []).filter((row) => inBox(box, row.kind));
  const unread = rows.filter((row) => !row.read);

  async function open(row: NotificationList["rows"][number]) {
    if (!row.read) {
      await api(`/api/notifications/${row.id}/read`, { body: {} }).catch(() => null);
      await queries.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (row.link) navigate(row.link);
  }
  async function readAll() {
    await Promise.all(
      unread.map((row) => api(`/api/notifications/${row.id}/read`, { body: {} }).catch(() => null)),
    );
    await queries.invalidateQueries({ queryKey: ["notifications"] });
  }

  if (!query.data)
    return (
      <div className="px-4 py-10 text-center text-sm text-slate-500">
        {query.isError ? "Couldn't read them. Try again in a moment." : "Reading…"}
      </div>
    );
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-1 pb-2 text-xs text-slate-500">
        <span>
          {unread.length ? `${unread.length} not read yet` : "All read"} · {rows.length} in all
        </span>
        {unread.length > 0 && (
          <button
            type="button"
            onClick={readAll}
            className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900"
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        )}
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto pb-24 md:pb-4">
        {rows.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-slate-500">
            {box === "important" ? (
              <BellRing className="size-8 text-slate-300" />
            ) : (
              <Inbox className="size-8 text-slate-300" />
            )}
            {box === "important"
              ? "Nothing waits on you. What needs you comes here."
              : "No news yet. What moves on your orders and team comes here."}
          </li>
        )}
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => open(row)}
              className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${row.read ? "" : "bg-amber-50/50"}`}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 size-2 shrink-0 rounded-full ${row.read ? "bg-slate-200" : (TONE[row.kind] ?? "bg-slate-400")}`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[13px] leading-snug ${row.read ? "text-slate-600" : "font-semibold text-slate-900"}`}
                >
                  {row.title}
                </span>
                {row.body && (
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-slate-500">
                    {row.body}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                {waited(row.at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
