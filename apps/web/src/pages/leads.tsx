// Leads & enquiries, as the old CRM's desk (frontend/components/lead-desk.tsx): the title with
// its count and New lead; one toolbar card (the queues with counts, the step line New → Rx →
// Quote → Papers / GL → Ready → Ordered → Delivered, unpaid → Done, Lost apart, search and the
// filters); then the cards grouped by the day the enquiry came in, each the old card's layout.
// Three views, as the old desk: Cards (the default), Table (one dense row per card) and Board (a
// lane per step); kept in the address as ?view=table / ?view=board. Phones always get the cards.

import type { DeskStep, LeadCard, LeadDesk, LeadQueue } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  MapPin,
  Package,
  Phone,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { avatarTone, dayHeading, initials, PRIMARY_SM } from "../look";
import { DeskBoard } from "../online/desk-board";
import { DeskTable, deskSortOf, sortDeskCards } from "../online/desk-table";
import { AGENCIES, NewLeadDialog, ROAD_BADGE, ROAD_TRACK, ROADS, SOURCES } from "../online/parts";
import { count, PageState, timeLabel } from "../ui";

const QUEUES: { key: LeadQueue; label: string; dot?: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  // Waiting on the agent's word: an unanswered message, an order held or sent back.
  { key: "attention", label: "Waiting on you", dot: "bg-amber-500" },
  { key: "deliver", label: "To deliver" },
  { key: "payment", label: "Payment" },
  { key: "done", label: "Completed" },
  { key: "lost", label: "Lost", dot: "bg-rose-500" },
];
const HOME: LeadQueue = "active";

type DeskView = "cards" | "table" | "board";
const VIEWS: { key: DeskView; label: string }[] = [
  { key: "cards", label: "Cards" },
  { key: "table", label: "Table" },
  { key: "board", label: "Board" },
];

const STEP_LINE: { key: DeskStep; label: string }[] = [
  { key: "new", label: "New" },
  { key: "rx", label: "Rx" },
  { key: "quote", label: "Quote" },
  { key: "papers", label: "Papers / GL" },
  { key: "ready", label: "Ready" },
  { key: "ordered", label: "Ordered" },
  { key: "unpaid", label: "Delivered, unpaid" },
  { key: "done", label: "Done" },
];

export function LeadsDesk({ desk = "online" }: { desk?: "online" | "pap" }) {
  const pap = desk === "pap";
  const [params, setParams] = useSearchParams();
  const queue = (params.get("queue") ?? HOME) as LeadQueue;
  const step = params.get("at") ?? "";
  const source = params.get("source") ?? "";
  const road = params.get("road") ?? "";
  const who = params.get("who") ?? "";
  const type = params.get("type") ?? "";
  const q = params.get("q") ?? "";
  const view: DeskView =
    params.get("view") === "table" ? "table" : params.get("view") === "board" ? "board" : "cards";
  const sort = deskSortOf(params.get("sort"));
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState(q);
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
    setShown(0);
  };
  // The view and the table's order change only the screen: the cards loaded stay loaded.
  const setLook = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts the timer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== q) set({ q: typed.trim() });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  // On the board the lanes are the steps: every step is read, the picked one only ringed.
  const search = new URLSearchParams({
    queue,
    step: view === "board" ? "" : step,
    source,
    road,
    who,
    type,
    q,
    shown: shown ? String(shown) : "",
    desk: pap ? "pap" : "",
  }).toString();
  const query = useQuery({
    queryKey: ["leads", "desk", search],
    queryFn: () => api<LeadDesk>(`/api/leads?${search}`),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the enquiries" />;

  const narrowed = Boolean(q || source || road || who || step || type);
  const adding = params.get("new") === "1";
  const setAdding = (on: boolean) => set({ new: on ? "1" : "" });
  const days = [...new Set(data.cards.map((card) => card.firstDay))];

  const select = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { value: string; label: string }[],
  ) => (
    <label
      className={`relative inline-flex items-center rounded-lg border text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-brand/30 ${
        options[0]?.value === value
          ? "border-slate-200 bg-white text-slate-600"
          : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 cursor-pointer appearance-none rounded-lg bg-transparent py-1 pr-7 pl-2.5 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-slate-400" />
    </label>
  );

  return (
    <div className="mx-auto max-w-screen-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {pap ? "PAP cases" : "Leads & enquiries"}
          </h1>
          <span className="rounded-full bg-stone-200/75 px-2.5 py-0.5 text-xs font-semibold text-stone-600 tabular-nums">
            {count(data.counts.active)}
          </span>
        </div>
        {data.can.add && (
          <button type="button" className={PRIMARY_SM} onClick={() => setAdding(true)}>
            <Plus className="size-4" /> {pap ? "New PAP case" : "New lead"}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div
            role="tablist"
            aria-label="Enquiries"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
          >
            {QUEUES.map((item) => {
              const selected = data.queue === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => set({ queue: item.key === HOME ? "" : item.key, at: "" })}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                    selected
                      ? "bg-brand text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {item.dot && (
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${item.dot}`} />
                  )}
                  {item.key === "done" && (
                    <CheckCheck
                      aria-hidden="true"
                      className={`size-3.5 ${selected ? "text-emerald-300" : "text-emerald-600"}`}
                    />
                  )}
                  <span>{item.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${selected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}
                  >
                    {count(data.counts[item.key] ?? 0)}
                  </span>
                </button>
              );
            })}
          </div>

          {data.queue !== "lost" && (
            <fieldset className="-mx-1 mt-2 flex min-w-0 items-center gap-0.5 overflow-x-auto border-t border-slate-100 px-1 pt-2 [scrollbar-width:none]">
              <legend className="sr-only">Enquiries by step</legend>
              {STEP_LINE.map((item, index) => {
                const n = data.steps[item.key] ?? 0;
                const on = (view === "board" ? step : data.step) === item.key;
                return (
                  <Fragment key={item.key}>
                    {index > 0 && (
                      <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-slate-300" />
                    )}
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ at: on ? "" : item.key })}
                      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                        on
                          ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300 ring-inset"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <span>{item.label}</span>
                      <span
                        className={`font-bold tabular-nums ${on ? "" : n ? "text-slate-900" : "text-slate-400"}`}
                      >
                        {n}
                      </span>
                    </button>
                  </Fragment>
                );
              })}
              <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-slate-200" />
              <button
                type="button"
                onClick={() => set({ queue: "lost", at: "" })}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <span>Lost</span>
                <span
                  className={`font-bold tabular-nums ${data.counts.lost ? "text-rose-700" : "text-slate-400"}`}
                >
                  {data.counts.lost}
                </span>
              </button>
            </fieldset>
          )}

          <div className="mt-2.5 flex flex-col gap-2 border-t border-slate-100 pt-2.5 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute top-2 left-3 size-4 text-slate-400" />
              <input
                type="search"
                aria-label="Search enquiries"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Search name, phone, medicine or city…"
                className="h-8 w-full appearance-none rounded-lg border border-slate-200 bg-slate-50/70 py-1.5 pr-9 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/10 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {typed && (
                <button
                  type="button"
                  onClick={() => setTyped("")}
                  aria-label="Clear search"
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className={`flex flex-wrap items-center gap-1.5 ${pap ? "hidden" : ""}`}>
              {select("Type", type, (value) => set({ type: value }), [
                { value: "", label: "All types" },
                { value: "enquiry", label: "Enquiries" },
                { value: "website_order", label: "Website orders" },
              ])}
              {select("Source", source, (value) => set({ source: value }), [
                { value: "", label: "All sources" },
                ...SOURCES.map((item) => ({ value: item.key, label: item.label })),
              ])}
              {select("Payment road", road, (value) => set({ road: value }), [
                { value: "", label: "Every road" },
                ...ROADS.map((item) => ({ value: item.key === "senior" ? "senior_pwd" : item.key, label: item.label })),
              ])}
              {select("Assigned to", who, (value) => set({ who: value }), [
                { value: "", label: "Everyone's" },
                { value: "mine", label: "Mine" },
              ])}
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-2" role="status">
              {query.isFetching && query.isPlaceholderData ? (
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <LoaderCircle className="size-3.5 animate-spin" /> Updating…
                </span>
              ) : (
                <span>
                  <strong className="font-semibold text-slate-800 tabular-nums">
                    {data.cards.length}
                  </strong>{" "}
                  of {count(data.total)} enquiries
                  {q && <span className="ml-1">matching “{q}”</span>}
                </span>
              )}
              {narrowed && (
                <button
                  type="button"
                  onClick={() => {
                    setTyped("");
                    set({ q: "", source: "", road: "", who: "", at: "", type: "" });
                  }}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
            <fieldset className="hidden shrink-0 rounded-lg border border-slate-200 p-0.5 text-[11px] font-medium lg:inline-flex">
              <legend className="sr-only">View</legend>
              {VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={view === item.key}
                  onClick={() => setLook({ view: item.key === "cards" ? "" : item.key })}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    view === item.key
                      ? "bg-brand text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </fieldset>
          </div>
        </div>

        {data.cards.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
            {narrowed
              ? pap
                ? "No case matches."
                : "No enquiry matches."
              : data.queue === "active"
                ? pap
                  ? "No open PAP case. Add one with New PAP case: the patient, the agency (DSWD, PCSO…), then the guarantee letter's papers."
                  : "No open enquiry. Add one with New lead."
                : "Nothing here."}
          </div>
        ) : (
          <>
            {view === "table" && (
              <div className={`hidden lg:block ${query.isPlaceholderData ? "opacity-60" : ""}`}>
                <DeskTable
                  cards={sortDeskCards(data.cards, sort)}
                  sort={sort}
                  onSort={(next) => setLook({ sort: next === "-received" ? "" : next })}
                />
              </div>
            )}
            {view === "board" && (
              <div className={`hidden lg:block ${query.isPlaceholderData ? "opacity-60" : ""}`}>
                <DeskBoard
                  data={data}
                  lanes={
                    data.queue === "lost"
                      ? [{ key: "lost", label: "Lost" }]
                      : [
                          ...STEP_LINE,
                          ...(data.queue === "all"
                            ? [{ key: "lost" as const, label: "Lost" }]
                            : []),
                        ]
                  }
                  picked={step}
                  onMore={(lane) =>
                    set(
                      lane === "lost"
                        ? { view: "", queue: "lost", at: "" }
                        : { view: "", at: lane },
                    )
                  }
                />
              </div>
            )}
            <div className={`space-y-4 ${view === "cards" ? "" : "lg:hidden"}`}>
              {days.map((day) => {
                const cards = data.cards.filter((card) => card.firstDay === day);
                return (
                  <section key={day} aria-label={`Came in ${dayHeading(day)}`}>
                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                      <h2 className="text-xs font-semibold text-slate-700">{dayHeading(day)}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums">
                        {cards.length} {cards.length === 1 ? "card" : "cards"}
                      </span>
                      <span className="h-px min-w-6 flex-1 bg-slate-200/70" />
                    </div>
                    <div
                      className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}
                    >
                      {cards.map((card) => (
                        <LeadCardItem key={card.id} card={card} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {data.cards.length < data.total && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setShown(data.cards.length + 300)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
            >
              Show {count(Math.min(300, data.total - data.cards.length))} more
            </button>
          </div>
        )}
      </div>

      {adding && <NewLeadDialog pap={pap} agents={data.agents} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** One enquiry, as the old desk's card. */
function LeadCardItem({ card }: { card: LeadCard }) {
  const { lost, finished } = card;
  const unopened = card.unopened && !lost && !finished;
  const track = ROAD_TRACK[card.road];
  const roadStyle = ROAD_BADGE[card.road];
  const agency = AGENCIES.find((item) => item.key === card.agency)?.short;
  return (
    <Link
      to={`/leads/${card.id}`}
      aria-label={`Open ${card.name} — ${lost ? "closed as lost" : finished ? "completed" : card.step.label}${unopened ? " (not opened yet)" : ""}`}
      className={`group relative flex min-w-0 flex-col justify-between rounded-2xl border p-3.5 shadow-sm transition-[border-color,box-shadow] hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none ${
        lost
          ? "border-rose-200/80 bg-rose-50/60 hover:border-rose-300"
          : finished
            ? "border-emerald-300 bg-emerald-50 hover:border-emerald-400"
            : unopened
              ? "border-sky-200/80 bg-sky-50/40 hover:border-sky-300"
              : "border-slate-200/90 bg-white hover:border-emerald-300"
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold shadow-2xs ${avatarTone(card.name)}`}
            >
              {initials(card.name)}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <h3
                  className="truncate text-[15px] font-semibold tracking-tight text-slate-900 transition-colors group-hover:text-emerald-800"
                  title={`${card.name} · ${card.code}`}
                >
                  {card.name}
                </h3>
              </div>
              {card.patient && (
                <div
                  className="truncate text-[11px] font-medium text-slate-600"
                  title={`Patient: ${card.patient}`}
                >
                  for {card.patient}
                </div>
              )}
              {card.phone ? (
                <div
                  className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-slate-500"
                  title={card.phone}
                >
                  <Phone className="size-3 shrink-0 text-slate-400" />
                  <span className="truncate">{card.phone}</span>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">No phone added</div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {finished && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                <CheckCheck className="size-3" /> Completed
              </span>
            )}
            {card.awaitingReply && !lost && (
              <span
                className="inline-flex items-center rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                title={card.lastMessage ?? undefined}
              >
                Needs reply
              </span>
            )}
            {card.step.value === "new" && !lost && !finished && !card.awaitingReply && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-2xs">
                <span className="size-1.5 rounded-full bg-white" />
                New
              </span>
            )}
            <span
              className="text-[10px] font-medium text-slate-400"
              title={[
                `Received ${timeLabel(card.firstContactAt)}`,
                card.lastMessageAt ? `Last message ${timeLabel(card.lastMessageAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              {new Intl.DateTimeFormat("en-PH", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "Asia/Manila",
              }).format(new Date(card.firstContactAt))}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {card.buyer && (
            <span
              className="inline-flex items-center rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white capitalize"
              title="A business buying through the Online desk: its own price list"
            >
              B2B · {card.buyer}
            </span>
          )}
          {card.caseType === "website_order" ? (
            <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800">
              Website order
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
              Enquiry
            </span>
          )}
          <span
            className="max-w-[140px] truncate text-[10px] font-semibold text-slate-600"
            title={`Came in through ${card.sourceLabel}`}
          >
            {card.sourceLabel}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roadStyle.bg} ${roadStyle.text} ${roadStyle.border}`}
          >
            {card.road === "gl" ? (
              <>
                <span>GL</span>
                {agency && <span className="font-bold">({agency})</span>}
              </>
            ) : (
              roadStyle.label
            )}
          </span>
          {card.city && (
            <span
              className="inline-flex max-w-[140px] items-center gap-0.5 truncate text-[10px] text-slate-500"
              title={card.city}
            >
              <MapPin className="size-2.5 shrink-0 text-slate-400" />
              <span className="truncate">{card.city}</span>
            </span>
          )}
          {card.papers.needed > 0 && !lost && !finished && (
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${card.papers.onFile >= card.papers.needed ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}
              title="Papers on file"
            >
              Papers {card.papers.onFile}/{card.papers.needed}
            </span>
          )}
        </div>

        {card.interest && (
          <p className="mt-2 truncate text-[11px] text-slate-600" title={card.interest}>
            <span className="font-semibold text-slate-700">Medicine:</span> {card.interest}
          </p>
        )}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span className="inline-flex min-w-0 items-center gap-1">
            <UserRound className="size-3 shrink-0 text-slate-400" />
            <span className="truncate">{card.owner || "Unassigned"}</span>
          </span>
          {card.order && (
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={`${card.order.code}: ${card.order.statusLabel}`}
            >
              <Package className="size-3 shrink-0 text-slate-400" />
              <span className="truncate">
                {card.order.code} · {card.order.statusLabel}
              </span>
            </span>
          )}
        </div>
      </div>

      <div
        className={`mt-2.5 border-t pt-2.5 ${finished ? "border-emerald-200/80" : "border-slate-100"}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium text-slate-400">
          <span>{lost ? "Case closed" : finished ? "Completed" : "Next action"}</span>
          {finished ? (
            <CheckCheck className="size-3.5 text-emerald-600" />
          ) : (
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          )}
        </div>
        <p
          className={`mb-2 line-clamp-2 text-[11px] leading-snug font-medium ${lost ? "text-rose-700" : "text-slate-800"}`}
          title={lost ? (card.lostReason ?? "Closed as lost") : card.next}
        >
          {lost ? (card.lostReason ? `Lost: ${card.lostReason}` : "Closed as lost") : card.next}
        </p>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500">
          <span
            className={`max-w-[170px] truncate font-semibold ${lost ? "text-rose-700" : "text-slate-700"}`}
            title={lost ? "Lost" : `${card.step.label} — ${card.step.hint}`}
          >
            {lost ? "Lost" : card.step.label}
          </span>
          <span className="shrink-0 text-[9px] text-slate-400">
            {lost
              ? "History retained"
              : finished
                ? "Complete"
                : `${card.stepIndex + 1} of ${card.steps.length}`}
          </span>
        </div>
        {!lost && (
          <div className="flex gap-1" aria-hidden="true">
            {card.steps.map((item, index) => {
              const done = finished || index < card.stepIndex;
              const current = index === card.stepIndex && !finished;
              return (
                <div
                  key={item.value}
                  className={`h-1.5 flex-1 rounded-full ${current ? `${track.active} ring-2 ${track.ring}` : done ? "bg-emerald-500" : "bg-slate-200"}`}
                  title={`${item.label} — ${item.hint}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}
