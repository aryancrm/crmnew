// Management's and Finance's "Orders to check", drawn exactly like the old CRM's Leads &
// enquiries desk (frontend/components/lead-desk.tsx): the title with its count, one toolbar
// card (the work tabs, the step line with counts, search and filters), the cards grouped by
// the day they were placed, each card the Leads card's own layout. On the right, Management
// gets Medicine check and Stock to watch (as designed on the canvas); Finance gets what
// customers owe and what came in this month.

import { lateAfterFor } from "@2mg/api/late";
import type {
  BoardTab,
  Desk,
  MedicineDetail,
  OrderBoard,
  OrderCard,
  OrderStatus,
  Overview,
  OwedList,
  PaymentList,
  SearchResult,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  FileCheck2,
  Hand,
  LoaderCircle,
  MapPin,
  Plus,
  Search,
  Snowflake,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { DISPATCH_HOLDS, type DispatchAsk, DispatchDialogs } from "../dispatch/parts";
import { ConfirmPaymentDialog, useMoney } from "../finance/parts";
import { avatarTone, dayHeading, initials, PRIMARY_SM, QUIET_SM } from "../look";
import { Checks, checksOf } from "./checks";
import { ReasonDialog, useOrderAction, waited } from "./parts";
import { count, Dialog, dayLabel, PageState, peso } from "../ui";
import { useWorkClock } from "../work-clock";

/** All orders' tabs: every stage of the line, for whoever looks an order up. */
const ALL_TABS: { key: BoardTab; label: string; dot?: string }[] = [
  { key: "needs", label: "Needs you" },
  { key: "sent", label: "Sent back", dot: "bg-amber-400" },
  { key: "finance", label: "With Finance" },
  { key: "dispatch", label: "With Dispatch" },
  { key: "hold", label: "On hold", dot: "bg-amber-500" },
  { key: "cancelled", label: "Cancelled" },
  { key: "done", label: "Delivered today" },
];
/** Each desk's own tabs only (Aryan, 19 Nov: "on top only what is this desk's; where every order
 *  stands is All orders' in Look up"). */
const DESK_TABS: Record<Desk, { key: BoardTab; label: string; dot?: string }[]> = {
  management: [
    { key: "needs", label: "Needs you" },
    { key: "sent", label: "Sent back", dot: "bg-amber-400" },
    { key: "hold", label: "On hold", dot: "bg-amber-500" },
    { key: "passed", label: "Approved today" },
  ],
  finance: [
    { key: "needs", label: "Needs you" },
    { key: "hold", label: "On hold", dot: "bg-amber-500" },
    { key: "passed", label: "Sent on today" },
  ],
  dispatch: [
    { key: "needs", label: "Needs you" },
    { key: "to_pack", label: "To pack" },
    { key: "to_ship", label: "To ship" },
    { key: "came_back", label: "Came back", dot: "bg-rose-500" },
    { key: "road", label: "On the road" },
    { key: "hold", label: "On hold", dot: "bg-amber-500" },
    { key: "done", label: "Delivered today" },
  ],
};
/** Under Needs you, a filter per check with something on it (Aryan, 19 Nov: "papers not complete,
 *  payment not right: their filters on top"): Management's four checks, Finance's four. */
const LOOKS: Partial<Record<Desk, { key: string; label: string }[]>> = {
  management: [
    { key: "paper", label: "Documents" },
    { key: "price", label: "Medicines & price" },
    { key: "stock", label: "Stock" },
    { key: "customer", label: "Customer & licence" },
  ],
  finance: [
    { key: "proof", label: "Payment" },
    { key: "paper", label: "Papers" },
    { key: "dues", label: "Owed before" },
    { key: "credit", label: "Credit limit" },
  ],
};
const DESK_HOME: Record<Desk, BoardTab> = {
  management: "needs",
  finance: "needs",
  dispatch: "needs",
};

/** The step line, as the Leads desk's "New > Rx > Quote …": every status an order passes. */
const STEP_LINE: { status: OrderStatus; label: string }[] = [
  { status: "pending_approval", label: "Waiting" },
  { status: "finance_check", label: "Payment check" },
  { status: "ready_for_invoice", label: "To invoice" },
  { status: "ready_for_dispatch", label: "To pack" },
  { status: "packing", label: "Packed" },
  { status: "shipped", label: "On the way" },
  { status: "completed", label: "Delivered" },
];
const STEP_LINE_END: { status: OrderStatus; label: string }[] = [
  { status: "on_hold", label: "On hold" },
  { status: "cancelled", label: "Cancelled" },
];

const PAPER_SHORT: Record<string, string> = {
  dr: "Signed DR",
  po: "PO",
  payment_proof: "Payment proof",
  prescription: "Rx",
  gl: "GL",
  other: "Paper",
};

/** The six steps of the card's strip. */
const STRIP = ["Placed", "Management", "Finance", "Packed", "Shipped", "Delivered"];
/** The same steps named under the strip, short enough for a card (18 Nov: "who has it now"). */
const STRIP_SHORT = ["Placed", "Mgmt", "Finance", "Packed", "On way", "Delivered"];

/** The customer's kind as the Leads card shows its type pill. */
export const KIND_BADGE: Record<string, { label: string; style: string }> = {
  hospital: { label: "Hospital", style: "border-sky-200 bg-sky-50 text-sky-800" },
  doctor: { label: "Doctor", style: "border-indigo-200 bg-indigo-50 text-indigo-800" },
  patient: { label: "Patient", style: "border-teal-200 bg-teal-50 text-teal-800" },
  drugstore: { label: "Drugstore", style: "border-amber-200 bg-amber-50 text-amber-900" },
  distributor: { label: "Distributor", style: "border-violet-200 bg-violet-50 text-violet-800" },
  government: { label: "Government", style: "border-rose-200 bg-rose-50 text-rose-800" },
};

const termsOf = (card: OrderCard) =>
  card.payBy
    ? `by ${new Date(`${card.payBy}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" })}`
    : card.paymentTerms === "days"
    ? `${card.paymentDays} days`
    : card.paymentTerms === "cod"
      ? "COD"
      : "Advance";

/** Today's date in Manila, as the API counts days. */
const manilaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/** The three looks of an order list. */
type View = "cards" | "table" | "board";
const savedView = (key: string): View => {
  try {
    const saved = localStorage.getItem(key);
    return saved === "table" || saved === "board" ? saved : "cards";
  } catch {
    return "cards";
  }
};
const rememberView = (key: string, view: View) => {
  try {
    localStorage.setItem(key, view);
  } catch {
    // A private window: the pick lasts until the page is left.
  }
};

/** Dispatch's and Finance's Board views: their own code, fetched only when picked. */
const DispatchLanes = lazy(() =>
  import("../dispatch/lanes").then((module) => ({ default: module.DispatchLanes })),
);
const FinanceLanes = lazy(() =>
  import("../finance/lanes").then((module) => ({ default: module.FinanceLanes })),
);

/** What a card asks a reason for before doing it. */
type CardAsk = "hold" | "send_back" | "reject" | "take_back" | "resume";

/** How long after approving Management may take it back (the API's TAKE_BACK_MINUTES). */
const TAKE_BACK_MINUTES = 30;

/** An order waiting this long for Management is late. */

export function OrdersToCheck({
  desk = "management",
  all = false,
  defaultTab = all ? "all" : DESK_HOME[desk],
  embedded = false,
  aside,
  terms,
  title,
}: {
  /** Only the orders paid this way (Finance's Prepaid orders: "advance"). */
  terms?: "advance" | "cod" | "days";
  /** The page's own title in place of the desk's. */
  title?: string;
  desk?: Desk;
  /** The All orders page: every order, with Cards, Table and Board views. */
  all?: boolean;
  defaultTab?: BoardTab;
  /** Inside a Home: the queue is a part of the page, headed as one. */
  embedded?: boolean;
  /** Boxes for the top of the side column (Management's Home: who sold what). */
  aside?: ReactNode;
}) {
  const navigate = useNavigate();
  // Management and Admin say why a held order goes on, on any desk's board (the API asks them).
  const me = useMe().data;
  const manager = ["management", "admin"].includes(me?.role ?? "");
  const TABS = all ? [{ key: "all" as const, label: "All orders" }, ...ALL_TABS] : DESK_TABS[desk];
  const [params, setParams] = useSearchParams();
  // Cards (the usual look), Table or Board, as the Leads desk offers them: picked by whoever
  // uses it and remembered on this device, per desk.
  const viewKey = `crm:view:${all ? "all" : desk}`;
  const askedView = params.get("view");
  const view: View =
    askedView === "cards" || askedView === "table" || askedView === "board"
      ? askedView
      : savedView(viewKey);
  // Dispatch's and Finance's Board is their work in columns, read from its own place.
  const lanes = view === "board" && !all && (desk === "dispatch" || desk === "finance");
  // Medicine check and Stock to watch belong beside the approvals; All orders and On hold get a
  // "Medicine check" button that opens the same check in a pop-up.
  // Management's cards take the whole width (Aryan: three or more a row); Finance keeps its money
  // glance beside them.
  // Every desk's cards take the whole width (Aryan): Finance's money is in its Money pages.
  const side = false;
  const [checking, setChecking] = useState(false);
  const shown = Number(params.get("shown")) || 0;
  const tab = (params.get("tab") ?? defaultTab) as BoardTab;
  const status = params.get("status") ?? "";
  const channel = params.get("channel") ?? "";
  const medrep = params.get("medrep") ?? "";
  // A check's filter under Needs you (Management's, Finance's): only the orders with something on it.
  const look = params.get("look") ?? "";
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const set = (changes: Record<string, string>) => {
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

  const search = new URLSearchParams({
    desk,
    ...(terms ? { terms } : {}),
    tab,
    status,
    channel,
    medrep,
    q,
    shown: String(shown),
  }).toString();
  const query = useQuery({
    queryKey: ["orders", "board", search],
    queryFn: () => api<OrderBoard>(`/api/orders/board?${search}`),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
    // The Board columns read their own data: the cards aren't fetched behind them.
    enabled: !lanes,
  });
  const order = useOrderAction();
  const queries = useQueryClient();
  const money = useMoney();
  const [asking, setAsking] = useState<{
    card: OrderCard;
    what: CardAsk;
    reason?: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<OrderCard | null>(null);
  const [dispatching, setDispatching] = useState<DispatchAsk>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const pickView = (key: View) => {
    rememberView(viewKey, key);
    set({ view: key === "cards" ? "" : key });
  };
  const viewSwitch = (
    <fieldset className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
      <legend className="sr-only">View</legend>
      {(["cards", "table", "board"] as const).map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => pickView(key)}
          className={`rounded-md px-2.5 py-1 capitalize transition-colors ${key === "table" ? "hidden sm:inline-block" : ""} ${
            view === key
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {key}
        </button>
      ))}
    </fieldset>
  );
  const pageTitle = title
    ? title
    : all
    ? "All orders"
    : defaultTab === "hold"
      ? "On hold"
      : defaultTab === "sent"
        ? "Sent back to MedReps"
        : desk === "dispatch"
          ? embedded
            ? "To pack and ship"
            : "Warehouse: to pack and ship"
          : embedded
            ? "Waiting for approval"
            : "Orders to check";
  if (lanes)
    return (
      <div className={embedded ? "" : "mx-auto max-w-screen-2xl"}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1
            className={
              embedded
                ? "text-lg font-bold tracking-tight text-slate-900"
                : "text-2xl font-bold tracking-tight text-ink"
            }
          >
            {pageTitle}
          </h1>
          {viewSwitch}
        </div>
        <Suspense
          fallback={
            <div className="py-10 text-center text-sm text-slate-500">Opening the board…</div>
          }
        >
          {desk === "dispatch" ? <DispatchLanes /> : <FinanceLanes />}
        </Suspense>
      </div>
    );
  // One person's orders (a name pressed beside the common screen), at Management and Finance.
  const whoId = !all && (desk === "management" || desk === "finance") ? Number(params.get("who")) || 0 : 0;
  const base = query.data
    ? whoId
      ? { ...query.data, cards: query.data.cards.filter((card) => card.handledById === whoId) }
      : query.data
    : undefined;
  if (!base) return <PageState query={query} what="the orders" />;
  // The desk's own check filters sit in its tab row, beside Needs you (Aryan, 19 Nov: the same
  // look as before, only the top changed); their counts are read off Needs you's orders.
  const looks = !all ? LOOKS[base.desk] : undefined;
  const onNeeds = base.tab === "needs" && !base.status;
  const warnsOf = base.desk === "finance" ? financeWarns : managementWarns;
  const data =
    looks && look && onNeeds ? { ...base, cards: base.cards.filter((card) => warnsOf(card).includes(look)) } : base;

  const finance = data.desk === "finance";
  const dispatch = data.desk === "dispatch";
  // The orders nothing was found on: Management approves them, Finance invoices them, together.
  const clean =
    data.tab === "needs" && (!data.status || (finance && data.status === "ready_for_invoice"))
      ? data.cards.filter(
          (card) =>
            card.findings.length === 0 &&
            card.status === (finance ? "ready_for_invoice" : "pending_approval"),
        )
      : [];
  const narrowed = Boolean(q || channel || medrep || status);
  const shownTotal = data.status ? (data.byStatus[data.status] ?? 0) : (data.counts[data.tab] ?? 0);
  const days = [...new Set(data.cards.map((card) => card.placedOn))];
  const busy = order.busy || money.busy;
  const problem = order.problem ?? money.problem;
  const headCount = data.counts[defaultTab] ?? 0;

  async function approveClean() {
    setApprovingAll(true);
    for (const card of clean) {
      const done = finance
        ? await money.send(`/api/finance/orders/${card.id}/invoice`, {})
        : await order.act(card.id, "approve");
      if (!done) break;
    }
    setApprovingAll(false);
  }

  /** Take an order in the warehouse (or take it over), or let it go. */
  async function take(orderId: number, release: boolean) {
    await order.run(() => api(`/api/dispatch/orders/${orderId}/take`, { body: { release } }));
    await queries.invalidateQueries({ queryKey: ["orders"] });
    await queries.invalidateQueries({ queryKey: ["dispatch"] });
  }

  /** Someone in Management says "I'll handle it", takes it over, or lets it go. */
  async function takeFinance(orderId: number, release: boolean) {
    await order.run(() => api(`/api/finance/orders/${orderId}/take`, { body: { release } }));
    await queries.invalidateQueries({ queryKey: ["orders"] });

  }
  async function handle(orderId: number, release: boolean) {
    await order.run(() => api(`/api/orders/${orderId}/handle`, { body: { release } }));
    await queries.invalidateQueries({ queryKey: ["orders"] });
  }

  const cardOf = (card: OrderCard) => (
    <OrderCardItem
      key={card.id}
      card={card}
      desk={data.desk}
      manage={finance ? data.can.finance : dispatch ? data.can.dispatch : data.can.manage}
      busy={busy}
      // Approving picks the warehouse, as the hub did: the order opens with its approve window.
      onApprove={() => navigate(`/orders/${card.id}?step=management&check=approve&approve=1`)}
      // Management says why it can go on (the hub's Resume); Finance and Dispatch lift their own.
      onResume={() =>
        manager ? setAsking({ card, what: "resume" }) : order.act(card.id, "resume")
      }
      onAsk={(what) => setAsking({ card, what })}
      onTake={dispatch && data.can.dispatch ? (release) => take(card.id, release) : undefined}
      onHandle={
        data.desk === "management" && data.can.manage
          ? (release) => handle(card.id, release)
          : data.desk === "finance" && ["finance_check", "ready_for_invoice"].includes(card.status)
            ? (release) => takeFinance(card.id, release)
            : undefined
      }
      onConfirm={() => setConfirming(card)}
      onInvoice={() => money.send(`/api/finance/orders/${card.id}/invoice`, {})}
      onDispatch={(what) =>
        setDispatching({
          what,
          orderId: card.id,
          code: card.code,
          // Cash on delivery: Delivered asks what came in and who has it (19 Nov).
          ...(what === "deliver" && card.paymentTerms === "cod"
            ? { collect: card.total, carrier: card.rider ?? card.courier }
            : {}),
        })
      }
    />
  );

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
    <div className={embedded ? "" : "mx-auto max-w-screen-2xl"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1
            className={
              embedded
                ? "text-lg font-bold tracking-tight text-slate-900"
                : "text-2xl font-bold tracking-tight text-ink"
            }
          >
            {pageTitle}
          </h1>
          <span className="rounded-full bg-stone-200/75 px-2.5 py-0.5 text-xs font-semibold text-stone-600 tabular-nums">
            {count(headCount)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Management approves one by one, picking the warehouse; Finance may invoice the clean ones together. */}
          {finance && data.can.finance && clean.length > 0 && (
            <button
              type="button"
              className={QUIET_SM}
              onClick={approveClean}
              disabled={busy || approvingAll}
            >
              <CheckCheck className="size-3.5 text-emerald-600" />
              {approvingAll ? "Invoicing…" : `Invoice the ${clean.length} with nothing found`}
            </button>
          )}
          {!side && data.desk === "management" && (
            <button type="button" className={QUIET_SM} onClick={() => setChecking(true)}>
              <Search className="size-3.5 text-emerald-600" /> Medicine check
            </button>
          )}
          {data.can.place && data.desk === "management" && (
            <Link to="/orders/new" className={PRIMARY_SM}>
              <Plus className="size-4" /> New order
            </Link>
          )}
        </div>
      </div>

      <div
        className={`mt-4 grid items-start gap-4 ${side ? "xl:grid-cols-[minmax(0,1fr)_19rem]" : ""}`}
      >
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            {/* The work tabs: one row, the count on each. */}
            <div
              role="tablist"
              aria-label="Orders"
              className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
            >
              {TABS.flatMap((item) => [item, ...(item.key === "needs" && looks ? looks.map((one) => ({ ...one, look: true })) : [])]).map((item) => {
                const isLook = "look" in item;
                const selected = isLook
                  ? onNeeds && look === item.key
                  : !data.status && data.tab === item.key && !(item.key === "needs" && look);
                if (isLook)
                  return (
                    <button
                      key={`look-${item.key}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => set({ tab: "", status: "", shown: "", look: selected ? "" : item.key })}
                      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                        selected
                          ? "bg-brand text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-400" />
                      <span>{item.label}</span>
                      {onNeeds && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${selected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}
                        >
                          {count(base.cards.filter((card) => warnsOf(card).includes(item.key)).length)}
                        </span>
                      )}
                    </button>
                  );
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() =>
                      set({ tab: item.key === defaultTab ? "" : item.key, status: "", shown: "", look: "" })
                    }
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                      selected
                        ? "bg-brand text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {item.dot && (
                      <span aria-hidden="true" className={`size-1.5 rounded-full ${item.dot}`} />
                    )}
                    {(item.key === "done" || item.key === "passed") && (
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

            <div className="mt-2.5 flex flex-col gap-2 border-t border-slate-100 pt-2.5 lg:flex-row lg:items-center">
              <div className="relative w-full lg:max-w-sm">
                <Search className="pointer-events-none absolute top-2 left-3 size-4 text-slate-400" />
                <input
                  type="search"
                  aria-label="Search orders"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={
                    dispatch
                      ? "Search customer, medicine, order or address…"
                      : "Search customer, medicine, MedRep or order…"
                  }
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
              <div className="flex flex-wrap items-center gap-1.5">
                {select("Channel", channel, (value) => set({ channel: value }), [
                  { value: "", label: "All channels" },
                  ...data.channels.map((code) => ({ value: code, label: code })),
                ])}
                {data.medreps.length > 1 &&
                  select("MedRep", medrep, (value) => set({ medrep: value, shown: "" }), [
                    { value: "", label: "Every MedRep" },
                    ...data.medreps.map((rep) => ({
                      value: String(rep.id),
                      label: `${rep.name} (${data.byRep.find((one) => one.id === rep.id)?.orders ?? 0})`,
                    })),
                  ])}
              </div>
              <div
                className="flex flex-wrap items-center gap-2 text-xs text-slate-500 lg:ml-auto"
                role="status"
              >
                {query.isFetching && query.isPlaceholderData ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <LoaderCircle className="size-3.5 animate-spin" /> Updating…
                  </span>
                ) : (
                  <span>
                    <strong className="font-semibold text-slate-800 tabular-nums">
                      {data.cards.length}
                    </strong>{" "}
                    of {count(shownTotal)}
                    {q && <span className="ml-1">matching “{q}”</span>}
                  </span>
                )}
                {narrowed && (
                  <button
                    type="button"
                    onClick={() => {
                      setTyped("");
                      set({ q: "", channel: "", medrep: "", status: "" });
                    }}
                    className="font-medium text-emerald-700 hover:underline"
                  >
                    Clear
                  </button>
                )}
                {viewSwitch}
              </div>
            </div>
          </div>

          {problem && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
            >
              {problem.message}
            </div>
          )}

          {data.cards.length > 0 && view === "table" ? (
            <OrdersCardTable
              cards={data.cards}
              faded={query.isPlaceholderData}
              checks={!dispatch}
            />
          ) : data.cards.length > 0 && view === "board" ? (
            <OrdersLanes
              cards={data.cards}
              byStatus={data.byStatus}
              onMore={(key) => set({ status: key, view: "cards" })}
            />
          ) : data.cards.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
              {data.tab === DESK_HOME[data.desk] && !narrowed
                ? finance
                  ? "No payment is waiting for you."
                  : dispatch
                    ? "Nothing to pack, ship or deliver."
                    : "No order is waiting for you."
                : data.tab === "sent"
                  ? "No order is waiting for a MedRep's fix."
                  : "No order here."}
            </div>
          ) : (
            <div className={`space-y-5 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
              {days.map((day) => {
                const cards = data.cards.filter((card) => card.placedOn === day);
                return (
                  <section key={day} aria-label={`Orders placed ${dayHeading(day)}`}>
                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                      <h2 className="text-xs font-semibold text-slate-700">{dayHeading(day)}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums">
                        {cards.length} {cards.length === 1 ? "order" : "orders"}
                      </span>
                      <span className="h-px min-w-6 flex-1 bg-slate-200/70" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4">
                      {cards.map(cardOf)}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {data.cards.length > 0 && data.cards.length < shownTotal && (
            <button
              type="button"
              onClick={() => set({ shown: String(data.cards.length) })}
              disabled={query.isFetching}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-2xs hover:bg-slate-50 disabled:opacity-60"
            >
              {query.isFetching
                ? "Loading…"
                : `Load more · ${count(shownTotal - data.cards.length)} more`}
            </button>
          )}
        </div>

        <div
          className={`flex min-w-0 flex-col gap-4 xl:sticky xl:top-[4.5rem] ${side ? "" : "hidden"}`}
        >
          {aside}
          {finance ? (
            <MoneyGlance />
          ) : (
            <>
              <MedicineCheck />
              <StockWatch />
            </>
          )}
        </div>
      </div>
      {asking && (
        <ReasonDialog
          orderId={asking.card.id}
          code={asking.card.code}
          what={asking.what}
          initial={asking.reason}
          financeHold={
            data.desk === "finance" && ["finance_check", "ready_for_invoice"].includes(asking.card.status)
          }
          presets={asking.what === "hold" && data.desk === "dispatch" ? DISPATCH_HOLDS : []}
          onClose={() => setAsking(null)}
        />
      )}
      {confirming && (
        <ConfirmPaymentDialog
          orderId={confirming.id}
          code={confirming.code}
          customer={confirming.customer}
          total={confirming.total}
          onClose={() => setConfirming(null)}
        />
      )}
      <DispatchDialogs ask={dispatching} onClose={() => setDispatching(null)} />
      {checking && (
        <Dialog
          title="Medicine check"
          sub="Stock by warehouse, the next batch to go out and what is coming."
          onClose={() => setChecking(false)}
        >
          <MedicineCheck />
        </Dialog>
      )}
    </div>
  );
}

/** Management's checks on a card, as the Leads card's road: the next thing to look at, then each
 *  check as a step (green fine, amber to look at); a step opens that check on the order. */
const CARD_CHECKS = [
  { key: "price", label: "Price", check: "price" },
  { key: "stock", label: "Stock", check: "stock" },
  { key: "customer", label: "Customer", check: "customer" },
  { key: "paper", label: "Papers", check: "papers" },
] as const;

function CheckSteps({ card }: { card: OrderCard }) {
  const navigate = useNavigate();
  // The proof of payment is Finance's to check, not Management's; papers are read by hand.
  const all = checksOf({ ...card, manual: true }).filter((one) => one.key !== "proof");
  const tone = (key: string) => all.find((one) => one.key === key)?.tone ?? "ok";
  const warns = all.filter((one) => one.tone === "warn");
  const fine = CARD_CHECKS.filter((step) => tone(step.key) !== "warn").length;
  const go = (check: string) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    navigate(`/orders/${card.id}?step=management&check=${check}`);
  };
  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium text-slate-400">
        <span>Next action</span>
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p
        className="mb-2 line-clamp-2 text-[11px] leading-snug font-medium text-slate-800"
        title={warns.map((one) => one.title).join("\n") || undefined}
      >
        {warns.length
          ? `Look at: ${warns.map((one) => one.label).join(", ")}`
          : "Everything checks out: approve it"}
      </p>
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500">
        <span className="font-semibold text-slate-700">Management check</span>
        <span className="text-[9px] text-slate-400">
          {fine} of {CARD_CHECKS.length} fine
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {CARD_CHECKS.map((step) => {
          const warn = tone(step.key) === "warn";
          return (
            <button
              key={step.key}
              type="button"
              onClick={go(step.check)}
              title={`Open the ${step.label.toLowerCase()} check`}
              className="group/step flex flex-col gap-1 rounded py-0.5 text-left"
            >
              <span
                className={`h-1.5 w-full rounded-full ${warn ? "bg-amber-400 ring-2 ring-amber-100" : "bg-emerald-500"}`}
              />
              <span
                className={`text-[10px] font-semibold group-hover/step:underline ${warn ? "text-amber-700" : "text-slate-600"}`}
              >
                {step.label}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Which of Management's checks have something on a card: its filters under Needs you (19 Nov). */
function managementWarns(card: OrderCard): string[] {
  const found = checksOf({ ...card, manual: true });
  return CARD_CHECKS.filter((one) => found.find((check) => check.key === one.key)?.tone === "warn").map(
    (one) => one.key,
  );
}

/** Which of Finance's checks have something on a card, read as its strip reads them (19 Nov). */
function financeWarns(card: OrderCard): string[] {
  const paper = checksOf(card).find((one) => one.key === "paper");
  return FINANCE_CHECKS.filter((step) =>
    step.key === "paper"
      ? paper?.tone === "warn"
      : card.findings.some((finding) => (step.warnKinds as readonly string[]).includes(finding.kind)),
  ).map((step) => step.key);
}

/** Finance's checks on a card, as Management's (Aryan, 19 Nov: "the same bars in Finance: the papers
 *  it needs, the payment proof, Finance's check, the oldest the customer owes us, on the strip
 *  itself, without going in"): green fine, amber to look at; a step opens the order. */
const FINANCE_CHECKS = [
  { key: "proof", label: "Payment", fine: "Pays by its terms", warnKinds: ["papers"] },
  { key: "paper", label: "Papers", fine: "Papers on file", warnKinds: [] },
  { key: "dues", label: "Owed before", fine: "Nothing overdue", warnKinds: ["owes"] },
  { key: "credit", label: "Credit limit", fine: "Within the limit", warnKinds: ["credit"] },
] as const;

function FinanceSteps({ card }: { card: OrderCard }) {
  const navigate = useNavigate();
  const all = checksOf(card);
  const paper = all.find((one) => one.key === "paper");
  // What each one means for Finance's money, in its own words (Aryan, 19 Nov: the strip's data
  // relevant): how this order pays, what is overdue, and its credit against the limit.
  const fineNote = (key: string) => {
    if (key === "proof")
      return card.payBy
        ? `Pays by ${dayLabel(card.payBy)}`
        : card.paymentTerms === "advance"
          ? card.papers.includes("payment_proof")
            ? "Proof attached: match it with the bank"
            : "Pays in advance"
          : card.paymentTerms === "cod"
            ? `Cash on delivery: ${peso(card.total)} collected at the door`
            : `On credit: ${card.paymentDays ?? 30} days from delivery`;
    if (key === "credit")
      return card.paymentTerms !== "days" && !card.payBy
        ? "Not on credit"
        : card.creditLimit === null
          ? "On credit, no limit set"
          : `Within the ${peso(card.creditLimit)} limit`;
    return null;
  };
  const steps = FINANCE_CHECKS.map((step) => {
    if (step.key === "paper")
      return { ...step, warn: paper?.tone === "warn", info: false, note: paper?.label ?? step.fine };
    const hit = card.findings.find((one) => (step.warnKinds as readonly string[]).includes(one.kind));
    // A sale on credit with no limit set: grey, for Finance to set one (never a stop by itself).
    const info = !hit && step.key === "credit" && (card.paymentTerms === "days" || Boolean(card.payBy)) && card.creditLimit === null;
    return { ...step, warn: Boolean(hit), info, note: hit ? hit.short : (fineNote(step.key) ?? step.fine), title: hit?.text };
  });
  const warns = steps.filter((one) => one.warn);
  const go = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    navigate(`/orders/${card.id}`);
  };
  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium text-slate-400">
        <span>Next action</span>
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mb-2 line-clamp-2 text-[11px] leading-snug font-medium text-slate-800" title={warns.map((one) => one.note).join("\n") || undefined}>
        {warns.length ? `Look at: ${warns.map((one) => one.note).join(", ")}` : card.status === "finance_check" ? "Everything checks out: check it and send it on" : "Everything checks out: make the invoice"}
      </p>
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500">
        <span className="font-semibold text-slate-700">Finance check</span>
        <span className="text-[9px] text-slate-400">
          {steps.length - warns.length} of {steps.length} fine
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {steps.map((step) => (
          <button key={step.key} type="button" onClick={go} title={step.note} className="group/step flex flex-col gap-1 rounded py-0.5 text-left">
            <span className={`h-1.5 w-full rounded-full ${step.warn ? "bg-amber-400 ring-2 ring-amber-100" : step.info ? "bg-slate-300" : "bg-emerald-500"}`} />
            <span className={`text-[10px] font-semibold group-hover/step:underline ${step.warn ? "text-amber-700" : "text-slate-600"}`}>{step.label}</span>
            <span className="line-clamp-2 text-[9.5px] leading-tight text-slate-500">{step.note}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function OrderCardItem({
  card,
  desk = "management",
  manage,
  busy,
  onApprove,
  onResume,
  onAsk,
  onConfirm,
  onInvoice,
  onDispatch,
  fixable = false,
  showRep = true,
  onTake,
  onHandle,
}: {
  card: OrderCard;
  /** Whose buttons the card shows: Management's (approve) or Finance's (confirm, invoice). */
  desk?: Desk;
  /** May act on it at this desk. */
  manage: boolean;
  busy: boolean;
  onApprove: () => void;
  onResume: () => void;
  onAsk: (what: CardAsk) => void;
  /** The MedRep's own sent-back order: a button to fix it and send it again. */
  fixable?: boolean;
  /** Who placed it (not on a MedRep's own list: they are all theirs). */
  showRep?: boolean;
  /** Dispatch: take it in the warehouse (or take it over), or let it go. */
  onTake?: (release: boolean) => void;
  /** Management: "I'll handle it" (or take it over), or let it go. */
  onHandle?: (release: boolean) => void;
  onConfirm?: () => void;
  onInvoice?: () => void;
  onDispatch?: (what: "pack" | "ship" | "deliver" | "failed" | "unpack") => void;
}) {
  const navigate = useNavigate();
  // The clock counts from when it reached its step (Management's wait from when it came to
  // Management, Finance's from when it came to Finance), in working hours: a night or a Sunday
  // doesn't make it late.
  const { waitedAt } = useWorkClock();
  const minutes = waitedAt(card.status, card.stepSince);
  const pending = card.status === "pending_approval";
  const flagged = card.status === "on_hold" || card.status === "exception";
  const stopped = flagged || card.status === "cancelled";
  const finished = card.status === "completed";
  const atFinance = card.status === "finance_check" || card.status === "ready_for_invoice";
  const heldBy = flagged
    ? (card.heldRole ??
      (card.heldFrom === "finance_check" || card.heldFrom === "ready_for_invoice"
        ? "finance"
        : "management"))
    : null;
  const heldByFinance = heldBy === "finance";
  const atDispatch =
    card.status === "ready_for_dispatch" || card.status === "packing" || card.status === "shipped";
  const me = useMe().data;
  // The people who sell (and follow their own orders) see the strip's steps named.
  const sellerView = ["medrep", "team_lead", "manager", "online"].includes(me?.role ?? "");
  const warehouse = desk === "dispatch";
  // Management's checks and buttons only for whoever decides it: Management, or the order's own
  // approver (a PAP order's head). A MedRep reads where it stands instead.
  const decides =
    desk === "management" &&
    manage &&
    (card.approverId == null || card.approverId === me?.id || me?.role === "admin");
  const checking = pending && decides;
  // Finance's own checks on its cards while the order is with Finance.
  const financeChecking = desk === "finance" && atFinance && Boolean(manage);
  // Waiting on the desk that reads it: the clock (and New, Late) count from reaching this step.
  const waitingHere =
    pending ||
    (desk === "finance" && atFinance) ||
    (warehouse && (card.status === "ready_for_dispatch" || card.status === "packing"));
  const isNew = waitingHere && minutes < 60;
  // Each desk's own limit (Management 4h, Finance and Dispatch a day), as Speed counts it.
  const late = waitingHere && minutes >= (lateAfterFor(card.status) ?? Number.POSITIVE_INFINITY);
  const today = manilaToday();
  const inWarehouse = card.status === "ready_for_dispatch" || card.status === "packing";
  const kind = KIND_BADGE[card.customerKind] ?? KIND_BADGE.hospital;
  const stepIdx = Math.min(card.step, STRIP.length - 1);
  const open = () => navigate(`/orders/${card.id}`);

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: the card holds buttons, so it can't be one link */}
      <div
        role="link"
        tabIndex={0}
        aria-label={`Open order ${card.code}: ${card.customer}, ${peso(card.total)}, ${card.statusLabel}`}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target === event.currentTarget) open();
        }}
        className={`group relative flex min-w-0 cursor-pointer flex-col justify-between rounded-2xl border p-3.5 shadow-sm transition-[border-color,box-shadow] hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none ${
          stopped
            ? "border-rose-200/80 bg-rose-50/60 hover:border-rose-300"
            : finished
              ? "border-emerald-300 bg-emerald-50 hover:border-emerald-400"
              : isNew
                ? "border-sky-200/80 bg-sky-50/40 hover:border-sky-300"
                : "border-slate-200/90 bg-white hover:border-emerald-300"
        }`}
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold shadow-2xs ${avatarTone(card.customer)}`}
              >
                {initials(card.customer)}
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3
                    className="line-clamp-2 text-sm leading-snug font-semibold tracking-tight text-slate-900 transition-colors group-hover:text-emerald-800"
                    title={card.customer}
                  >
                    {card.customer}
                  </h3>
                </div>
                <div
                  className="truncate text-[11px] font-medium text-slate-500"
                  title={card.customerPhone ? `Phone ${card.customerPhone}` : undefined}
                >
                  <span className="font-semibold text-slate-700">{peso(card.total)}</span> ·{" "}
                  {card.code}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
              <span className="flex items-center gap-1.5">
                {finished && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    <CheckCheck className="size-3" /> Delivered
                  </span>
                )}
                {flagged && (
                  <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {card.statusLabel}
                  </span>
                )}
                {card.changed && (
                  <span
                    className="inline-flex items-center rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                    title="Management changed its medicines or prices before approving: open it to see what"
                  >
                    Changed by Mgmt
                  </span>
                )}
                {late && (
                  <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Late
                  </span>
                )}
                {isNew && !late && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-2xs">
                    <span className="size-1.5 rounded-full bg-white" />
                    New
                  </span>
                )}
                <span
                  className={`text-[10px] font-medium tabular-nums ${late ? "text-rose-700" : "text-slate-400"}`}
                  title={`${card.statusLabel} since ${new Date(card.stepSince).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} · placed ${new Date(card.submittedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`}
                >
                  {waited(card.stepSince)}
                </span>
              </span>
              {onHandle &&
                (desk === "finance"
                  ? card.status === "finance_check" || card.status === "ready_for_invoice"
                  : pending || (flagged && heldBy === "management")) && (
                // Who in Management has it, so two people don't work the same order.
                <span className="flex items-center gap-1.5">
                  {card.handledById === me?.id ? (
                    <>
                      <span className="max-w-[110px] truncate font-semibold text-sky-700">{card.handledBy}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onHandle(true);
                        }}
                        className="font-medium text-slate-500 hover:text-slate-900"
                      >
                        Let go
                      </button>
                    </>
                  ) : (
                    <>
                      {card.handledBy && (
                        <span className="max-w-[90px] truncate font-semibold text-slate-700">
                          {card.handledBy}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onHandle(false);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                      >
                        {!card.handledBy && <Hand className="size-3" />}
                        {card.handledBy ? "Take over" : "I'll handle it"}
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kind?.style}`}
            >
              {kind?.label}
            </span>
            {card.channel && (
              <span className="max-w-[120px] truncate text-[10px] font-semibold text-slate-600">
                {card.channel}
              </span>
            )}
            {card.via && (
              <span
                className="inline-flex shrink-0 items-center rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                title={`Came in through the Online desk: case ${card.via.code}`}
              >
                Online · {card.via.source}
              </span>
            )}
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
              {termsOf(card)}
            </span>
            {card.customerCity && (
              <span
                className="inline-flex max-w-[140px] items-center gap-0.5 truncate text-[10px] text-slate-500"
                title={card.customerCity}
              >
                <MapPin className="size-2.5 shrink-0 text-slate-400" />
                <span className="truncate">{card.customerCity}</span>
              </span>
            )}
          </div>

          <p className="mt-2 truncate text-[11px] text-slate-600" title={card.lines}>
            <span className="font-semibold text-slate-700">Medicine:</span> {card.lines}
          </p>
          {warehouse ? (
            // The warehouse's facts: where it goes, to whom, how many pieces, by when.
            <div className="mt-1.5 space-y-1.5 text-[11px] text-slate-600">
              <p className="truncate" title={card.deliveryAddress ?? undefined}>
                <span className="font-semibold text-slate-700">Deliver to:</span>{" "}
                {[card.receiver, card.deliveryAddress].filter(Boolean).join(" · ") || "—"}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 tabular-nums">
                  {count(card.pieces)} pcs
                </span>
                {card.receiverPhone && (
                  <a
                    href={`tel:${card.receiverPhone.replace(/[^\d+]/g, "")}`}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded px-1 py-0.5 text-[10px] font-medium text-slate-600 tabular-nums hover:bg-slate-100"
                  >
                    {card.receiverPhone}
                  </a>
                )}
                {card.expectedOn && inWarehouse && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      card.expectedOn < today
                        ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
                        : card.expectedOn === today
                          ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
                          : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
                    }`}
                  >
                    {card.expectedOn < today
                      ? `Late · wanted ${dayLabel(card.expectedOn)}`
                      : card.expectedOn === today
                        ? "Wanted today"
                        : `Wanted ${dayLabel(card.expectedOn)}`}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
              {showRep && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <UserRound className="size-3 shrink-0 text-slate-400" />
                  <span className="truncate">{card.medrep}</span>
                </span>
              )}
              {!checking && <Checks card={card} small />}
            </div>
          )}
          {warehouse && atDispatch && card.items.some((item) => item.cold) && (
            <div className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
              <Snowflake className="size-3" aria-hidden="true" /> Keep cold
            </div>
          )}
          {warehouse &&
            card.status === "packing" &&
            card.cameBackCount > 0 &&
            card.cameBackReason && (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] leading-snug text-rose-900">
                <span className="font-semibold">
                  Came back{card.cameBackCount > 1 ? ` ${card.cameBackCount} times` : ""}:
                </span>{" "}
                {card.cameBackReason}
              </div>
            )}
          {warehouse && inWarehouse && onTake && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
              {
                // Who has it in hand, so two people don't pack the same order.
                <span className="inline-flex items-center gap-1">
                  {card.dispatchById === me?.id ? (
                    <>
                      <span className="rounded-full bg-sky-600 px-2 py-0.5 font-semibold text-white">
                        You have it
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onTake(true);
                        }}
                        className="rounded-full px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      >
                        Let go
                      </button>
                    </>
                  ) : (
                    <>
                      {card.dispatchBy && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                          {card.dispatchBy} has it
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onTake(false);
                        }}
                        className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        {card.dispatchBy ? "Take over" : "Take it"}
                      </button>
                    </>
                  )}
                </span>
              }
            </div>
          )}
        </div>

        <div
          className={`mt-2.5 border-t pt-2.5 ${finished ? "border-emerald-200/80" : "border-slate-100"}`}
        >
          {checking && <CheckSteps card={card} />}
          {financeChecking && <FinanceSteps card={card} />}
          {!checking && !financeChecking && (
            <>
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium text-slate-400">
                <span>{finished ? "Completed" : "Next action"}</span>
                {finished ? (
                  <CheckCheck className="size-3.5 text-emerald-600" />
                ) : (
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                )}
              </div>
              <p
                className={`mb-2 line-clamp-2 text-[11px] leading-snug font-medium ${stopped ? "text-rose-700" : "text-slate-800"}`}
                title={card.next}
              >
                {card.next}
              </p>
            </>
          )}
          {/* Every order in Management's (or Finance's) queue stands at the same step: no strip there. */}
          {!checking && !financeChecking && (
            <>
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500">
                <span
                  className={`max-w-[170px] truncate font-semibold ${stopped ? "text-rose-700" : "text-slate-700"}`}
                >
                  {stopped || atDispatch
                    ? card.statusLabel
                    : finished
                      ? "Delivered"
                      : STRIP[stepIdx]}
                </span>
                <span className="shrink-0 text-[9px] text-slate-400">
                  {finished ? "Complete" : `${stepIdx + 1} of ${STRIP.length}`}
                </span>
              </div>
              {/* Sellers see each step named under the strip (their My orders, 18 Nov); the desks
                  keep the plain strip. */}
              {sellerView ? (
                <div className="grid grid-cols-6 gap-1" aria-hidden="true">
                  {STRIP.map((label, index) => {
                    const done = finished || index < stepIdx;
                    const current = index === stepIdx && !finished;
                    return (
                      <div key={label} title={label} className="flex min-w-0 flex-col gap-1">
                        <span
                          className={`h-1.5 w-full rounded-full ${
                            current
                              ? stopped
                                ? "bg-rose-600 ring-2 ring-rose-200"
                                : "bg-blue-600 ring-2 ring-blue-200"
                              : done
                                ? "bg-emerald-500"
                                : "bg-slate-200"
                          }`}
                        />
                        <span
                          className={`truncate text-[9px] font-semibold ${current ? (stopped ? "text-rose-700" : "text-blue-700") : done ? "text-slate-600" : "text-slate-400"}`}
                        >
                          {STRIP_SHORT[index]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex gap-1" aria-hidden="true">
                  {STRIP.map((label, index) => {
                    const done = finished || index < stepIdx;
                    const current = index === stepIdx && !finished;
                    return (
                      <div
                        key={label}
                        title={label}
                        className={`h-1.5 flex-1 rounded-full ${
                          current
                            ? stopped
                              ? "bg-rose-600 ring-2 ring-rose-200"
                              : "bg-blue-600 ring-2 ring-blue-200"
                            : done
                              ? "bg-emerald-500"
                              : "bg-slate-200"
                        }`}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
          {(card.warehouse || (warehouse && card.papers.length > 0)) && (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {card.warehouse && (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800">
                  Ships from · {card.warehouse}
                </span>
              )}
              {card.status === "shipped" && (card.courier || card.rider) && (
                <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-800">
                  {card.courier
                    ? `${card.courier}${card.tracking ? ` · ${card.tracking}` : ""}`
                    : `Rider · ${card.rider}`}
                </span>
              )}
              {warehouse && card.papers.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700"
                  title="Papers on file"
                >
                  <FileCheck2 className="size-3" />{" "}
                  {card.papers.map((kind) => PAPER_SHORT[kind] ?? "Paper").join(" · ")}
                </span>
              )}
            </div>
          )}

          {desk === "finance" && manage && (atFinance || heldByFinance) && (
            // biome-ignore lint/a11y/noStaticElementInteractions: keeps a button's click off the card
            // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside have their own keys
            <div
              className="mt-3 grid grid-cols-[2fr_1fr] gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {atFinance ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={card.status === "finance_check" ? onConfirm : onInvoice}
                    className="h-8 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                  >
                    {card.status === "finance_check" ? "Confirm payment" : "Check & send to Dispatch"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAsk("hold")}
                    className="h-8 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Hold
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onResume}
                  className="col-span-2 h-8 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                >
                  Take off hold
                </button>
              )}
            </div>
          )}

          {desk === "dispatch" && manage && onDispatch && (atDispatch || heldBy === "dispatch") && (
            // biome-ignore lint/a11y/noStaticElementInteractions: keeps a button's click off the card
            // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside have their own keys
            <div
              className="mt-3 grid grid-cols-[2fr_1fr] gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {atDispatch ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onDispatch(
                        card.status === "ready_for_dispatch"
                          ? "pack"
                          : card.status === "packing"
                            ? "ship"
                            : "deliver",
                      )
                    }
                    className="h-8 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                  >
                    {card.status === "ready_for_dispatch"
                      ? "Pack"
                      : card.status === "packing"
                        ? "Ship"
                        : "Delivered"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      card.status === "shipped" ? onDispatch("failed") : onAsk("hold")
                    }
                    className="h-8 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {card.status === "shipped" ? "Came back" : "Hold"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onResume}
                  className="col-span-2 h-8 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                >
                  Take off hold
                </button>
              )}
            </div>
          )}

          {decides && (pending || flagged) && (
            // biome-ignore lint/a11y/noStaticElementInteractions: keeps a button's click off the card
            // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside have their own keys
            <div
              className="mt-3 grid grid-cols-[2fr_1fr_1fr] gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {pending ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onApprove}
                    className="h-8 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                  >
                    Approve
                  </button>
                  {/* The hub's three: Approve, Send back, Reject (hold and the rest on the order). */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAsk("send_back")}
                    className="h-8 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Send back
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAsk("reject")}
                    className="h-8 rounded-lg text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onResume}
                  className="col-span-3 h-8 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
                >
                  Take off hold
                </button>
              )}
            </div>
          )}

          {desk === "management" && manage && card.takeBack && card.approvedAt && (
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onAsk("take_back");
              }}
              className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              <Undo2 className="size-3.5" /> Take back approval ·{" "}
              {Math.max(
                1,
                Math.ceil(TAKE_BACK_MINUTES - (Date.now() - Date.parse(card.approvedAt)) / 60_000),
              )}{" "}
              min left
            </button>
          )}

          {fixable && card.status === "draft" && (
            <Link
              to={`/orders/${card.id}/fix`}
              onClick={(event) => event.stopPropagation()}
              className="mt-3 flex h-8 items-center justify-center rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark"
            >
              Fix and send again
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the right-hand boxes

const BOX = "rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm";

/** Type a medicine: what is in each warehouse, what is coming, its batches and its prices. */
function MedicineCheck() {
  const [typed, setTyped] = useState("");
  const [asked, setAsked] = useState("");
  const [pickedId, setPickedId] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const found = useQuery({
    queryKey: ["search", asked],
    queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(asked)}`),
    enabled: asked.length >= 2 && pickedId === null,
  });
  const detail = useQuery({
    queryKey: ["inventory", "medicine", pickedId],
    queryFn: () => api<MedicineDetail>(`/api/inventory/medicines/${pickedId}`),
    enabled: pickedId !== null,
  });
  const data = pickedId !== null ? detail.data : undefined;
  const inWarehouse = (id: number) =>
    (data?.batches ?? [])
      .filter((batch) => batch.warehouseId === id && batch.state !== "expired")
      .reduce((sum, batch) => sum + batch.qty, 0);
  const coming = data?.coming[0];
  const promo = data?.promos.find((item) => item.state === "now");
  const firstBatch = data?.batches
    .filter((batch) => batch.state !== "expired")
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];

  return (
    <div className={`${BOX} flex flex-col gap-2.5`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-700">Medicine check</h2>
        <Link to="/medicines" className="text-[11px] font-medium text-emerald-700 hover:underline">
          Open inventory
        </Link>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2 left-3 size-4 text-slate-400" />
        <input
          aria-label="Medicine to check"
          placeholder="Type a medicine"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setPickedId(null);
          }}
          className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/70 py-1.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/10 focus:outline-none"
        />
      </div>
      {pickedId === null && asked.length >= 2 && (
        <ul className="flex flex-col overflow-hidden rounded-lg border border-slate-200">
          {(found.data?.medicines ?? []).map((row) => (
            <li key={row.id} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-slate-50"
                onClick={() => {
                  setPickedId(row.id);
                  setTyped([row.name, row.strength].filter(Boolean).join(" "));
                }}
              >
                <span className="font-semibold text-slate-800">
                  {[row.name, row.strength].filter(Boolean).join(" ")}
                </span>
                {row.sku && <span className="text-slate-500"> · {row.sku}</span>}
              </button>
            </li>
          ))}
          {found.data && found.data.medicines.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-slate-500">No medicine matches.</li>
          )}
          {found.isPending && <li className="px-2.5 py-1.5 text-xs text-slate-500">Searching…</li>}
        </ul>
      )}
      {pickedId !== null && !data && (
        <div className="text-xs text-slate-500">
          {detail.isError ? "Couldn't read this medicine." : "Reading…"}
        </div>
      )}
      {data && (
        <>
          <div>
            <Link
              to={`/medicines/${data.medicine.id}`}
              className="text-sm font-semibold tracking-tight text-slate-900 hover:text-emerald-800"
            >
              {[data.medicine.name, data.medicine.strength].filter(Boolean).join(" ")}
              {data.medicine.pack ? `, ${data.medicine.pack.toLowerCase()}` : ""}
            </Link>
            <div className="text-[11px] text-slate-500">
              {data.medicine.sku ?? data.medicine.code} ·{" "}
              {data.medicine.rx ? "prescription medicine" : "over the counter"}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {data.warehouses.slice(0, 2).map((place) => {
              const qty = inWarehouse(place.id);
              return (
                <div
                  key={place.id}
                  className={`rounded-xl p-2 ${qty === 0 ? "bg-slate-50" : data.status === "low" ? "bg-amber-50" : "bg-emerald-50"}`}
                >
                  <div className="text-base leading-tight font-bold text-slate-900 tabular-nums">
                    {count(qty)}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">
                    {place.name.replace(/ warehouse$/i, "")}
                  </div>
                </div>
              );
            })}
            <div className="rounded-xl bg-slate-50 p-2">
              <div className="text-base leading-tight font-bold text-slate-900 tabular-nums">
                {coming ? count(coming.qty) : "0"}
              </div>
              <div className="truncate text-[10px] text-slate-500">
                {coming ? `Coming ${dayLabel(coming.expectedOn, data.today)}` : "Coming"}
              </div>
            </div>
          </div>
          {firstBatch && (
            <div className="flex justify-between gap-3 text-[11px] text-slate-500">
              <span>Batch {firstBatch.batchNo}</span>
              <span>
                {count(firstBatch.qty)} · expires {dayLabel(firstBatch.expiresOn)}
              </span>
            </div>
          )}
          <dl className="flex flex-col border-t border-slate-100 pt-1 text-xs">
            {data.buyerTypes
              .filter((type) => data.prices[type.key] !== undefined)
              .map((type) => (
                <div
                  key={type.key}
                  className="flex justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0"
                >
                  <dt className="text-slate-600">{type.label} price</dt>
                  <dd className="font-semibold text-slate-900 tabular-nums">
                    {peso(data.prices[type.key] as number)}
                  </dd>
                </div>
              ))}
            {promo && (
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="font-semibold text-emerald-700">
                  Promo to {dayLabel(promo.endsOn, data.today)}
                </dt>
                <dd className="font-semibold text-slate-900 tabular-nums">{peso(promo.amount)}</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
}

function StockWatch() {
  const overview = useQuery({
    queryKey: ["inventory", "overview"],
    queryFn: () => api<Overview>("/api/overview"),
  });
  const rows = overview.data?.low ?? [];
  return (
    <div className={`${BOX} flex flex-col gap-1.5`}>
      <h2 className="text-xs font-semibold text-slate-700">Stock to watch</h2>
      {overview.isPending ? (
        <div className="text-xs text-slate-500">Reading…</div>
      ) : overview.isError ? (
        <div className="text-xs text-rose-700">Couldn't read the stock.</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-slate-500">Nothing is low or out of stock.</div>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0"
            >
              <Link
                to={`/medicines/${row.id}`}
                className="min-w-0 truncate text-slate-700 hover:text-emerald-800"
              >
                {[row.name, row.strength].filter(Boolean).join(" ")}
              </Link>
              {row.status === "out" ? (
                <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                  Out
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  Low · {count(row.total)} left
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Finance's right-hand boxes: what customers owe and who is latest, what came in this month. */
function MoneyGlance() {
  const owed = useQuery({
    queryKey: ["finance", "owed", ""],
    queryFn: () => api<OwedList>("/api/finance/owed"),
  });
  const paid = useQuery({
    queryKey: ["finance", "payments", ""],
    queryFn: () => api<PaymentList>("/api/payments"),
  });
  const late = (owed.data?.rows ?? []).filter((row) => row.overdue > 0).slice(0, 5);
  return (
    <>
      <div className={`${BOX} flex flex-col gap-2.5`}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-700">Customers owe</h2>
          <Link to="/owed" className="text-[11px] font-medium text-emerald-700 hover:underline">
            See all
          </Link>
        </div>
        {owed.isPending ? (
          <div className="text-xs text-slate-500">Reading…</div>
        ) : owed.isError || !owed.data ? (
          <div className="text-xs text-rose-700">Couldn't read what customers owe.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-xl bg-slate-50 p-2">
                <div className="text-base leading-tight font-bold text-slate-900 tabular-nums">
                  {peso(owed.data.totals.total)}
                </div>
                <div className="text-[10px] text-slate-500">Owed in all</div>
              </div>
              <div
                className={`rounded-xl p-2 ${owed.data.totals.overdue > 0 ? "bg-rose-50" : "bg-emerald-50"}`}
              >
                <div
                  className={`text-base leading-tight font-bold tabular-nums ${owed.data.totals.overdue > 0 ? "text-rose-700" : "text-slate-900"}`}
                >
                  {peso(owed.data.totals.overdue)}
                </div>
                <div className="text-[10px] text-slate-500">Overdue</div>
              </div>
            </div>
            {late.length === 0 ? (
              <div className="text-xs text-slate-500">Nobody is late.</div>
            ) : (
              <ul className="flex flex-col">
                {late.map((row) => (
                  <li
                    key={row.customerId}
                    className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0"
                  >
                    <Link
                      to={`/invoices?customer=${row.customerId}&tab=unpaid`}
                      className="min-w-0 truncate text-slate-700 hover:text-emerald-800"
                    >
                      {row.customer}
                    </Link>
                    <span className="shrink-0 text-right">
                      <span className="font-semibold text-rose-700 tabular-nums">
                        {peso(row.overdue)}
                      </span>
                      <span className="ml-1 text-[10px] text-slate-500">{row.oldestDays}d</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className={`${BOX} flex flex-col gap-1.5`}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-700">Received this month</h2>
          <Link to="/payments" className="text-[11px] font-medium text-emerald-700 hover:underline">
            Payments
          </Link>
        </div>
        {paid.isPending ? (
          <div className="text-xs text-slate-500">Reading…</div>
        ) : paid.isError || !paid.data ? (
          <div className="text-xs text-rose-700">Couldn't read the payments.</div>
        ) : (
          <>
            <div className="text-lg leading-tight font-bold text-slate-900 tabular-nums">
              {peso(paid.data.sum)}
            </div>
            <div className="text-[11px] text-slate-500">
              {count(paid.data.total)} {paid.data.total === 1 ? "payment" : "payments"} in{" "}
              {paid.data.monthLabel}
            </div>
          </>
        )}
      </div>
    </>
  );
}

const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  pending_approval: "bg-violet-50 text-violet-800 ring-violet-200",
  finance_check: "bg-amber-50 text-amber-800 ring-amber-200",
  ready_for_invoice: "bg-amber-50 text-amber-800 ring-amber-200",
  ready_for_dispatch: "bg-sky-50 text-sky-800 ring-sky-200",
  packing: "bg-sky-50 text-sky-800 ring-sky-200",
  shipped: "bg-teal-50 text-teal-800 ring-teal-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  on_hold: "bg-rose-50 text-rose-700 ring-rose-200",
  exception: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};
const statusWord = (card: OrderCard) =>
  [...STEP_LINE, ...STEP_LINE_END].find((step) => step.status === card.status)?.label ??
  card.statusLabel;

/** All orders as one dense row each, the Leads desk's Table view for orders. */
function OrdersCardTable({
  cards,
  faded,
  checks = true,
}: {
  cards: OrderCard[];
  faded: boolean;
  /** Management's and Finance's checks; Dispatch's table leaves them out. */
  checks?: boolean;
}) {
  const navigate = useNavigate();
  const head = "whitespace-nowrap px-3 py-2 text-left font-semibold";
  return (
    <div
      className={`overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm ${faded ? "opacity-60" : ""}`}
    >
      <table className="w-full min-w-[960px] text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
          <tr>
            <th scope="col" className={head}>
              Order
            </th>
            <th scope="col" className={head}>
              Customer
            </th>
            <th scope="col" className={head}>
              Medicines
            </th>
            {checks && (
              <th scope="col" className={head}>
                Checks
              </th>
            )}
            <th scope="col" className={head}>
              MedRep
            </th>
            <th scope="col" className={head}>
              Channel
            </th>
            <th scope="col" className={`${head} text-right`}>
              Total
            </th>
            <th scope="col" className={head}>
              Status
            </th>
            <th scope="col" className={head}>
              Next
            </th>
            <th scope="col" className={head}>
              Placed
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cards.map((card) => (
            <tr
              key={card.id}
              className="cursor-pointer transition-colors hover:bg-slate-50"
              onClick={() => navigate(`/orders/${card.id}`)}
            >
              <td className="px-3 py-2">
                <Link
                  to={`/orders/${card.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="font-semibold whitespace-nowrap text-slate-900 hover:text-emerald-800"
                >
                  {card.code}
                </Link>
              </td>
              <td className="max-w-[12rem] px-3 py-2">
                <div className="truncate font-medium text-slate-800">{card.customer}</div>
                <div className="truncate text-[11px] text-slate-500">{card.customerCity ?? ""}</div>
              </td>
              <td className="max-w-[16rem] truncate px-3 py-2 text-slate-600" title={card.lines}>
                {card.lines}
              </td>
              {checks && (
                <td className="px-3 py-2">
                  <Checks card={card} small />
                </td>
              )}
              <td className="px-3 py-2 text-slate-700">{card.medrep}</td>
              <td className="px-3 py-2 text-slate-600">
                {card.channel ?? "—"}
                {card.via && <div className="text-[11px] font-semibold text-violet-700">Online · {card.via.source}</div>}
              </td>
              <td className="px-3 py-2 text-right font-semibold text-slate-900 tabular-nums">
                {peso(card.total)}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${STATUS_TONE[card.status] ?? ""}`}
                >
                  {statusWord(card)}
                </span>
              </td>
              <td className="max-w-[16rem] px-3 py-2 text-slate-600" title={card.next}>
                <span className="line-clamp-2">{card.next}</span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                {dayLabel(card.placedOn)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LANES: { key: OrderStatus; label: string; also?: OrderStatus[]; dot: string }[] = [
  { key: "pending_approval", label: "Waiting", dot: "bg-violet-500" },
  { key: "finance_check", label: "Payment check", dot: "bg-amber-500" },
  { key: "ready_for_invoice", label: "To invoice", dot: "bg-amber-500" },
  { key: "ready_for_dispatch", label: "To pack", dot: "bg-sky-500" },
  { key: "packing", label: "Packed", dot: "bg-sky-500" },
  { key: "shipped", label: "On the way", dot: "bg-teal-500" },
  { key: "completed", label: "Delivered", dot: "bg-emerald-500" },
  { key: "on_hold", label: "On hold", also: ["exception"], dot: "bg-rose-500" },
  { key: "cancelled", label: "Cancelled", dot: "bg-slate-400" },
];
const LANE_SHOWN = 25;

/** Every order in a lane per step, the Placed → Delivered board the old CRM had. */
function OrdersLanes({
  cards,
  byStatus,
  onMore,
}: {
  cards: OrderCard[];
  byStatus: OrderBoard["byStatus"];
  onMore: (status: OrderStatus) => void;
}) {
  return (
    <div className="grid auto-cols-[17rem] grid-flow-col gap-3.5 overflow-x-auto pb-4">
      {LANES.map((lane) => {
        const statuses = [lane.key, ...(lane.also ?? [])];
        const inLane = cards.filter((card) => statuses.includes(card.status));
        const total = statuses.reduce((sum, key) => sum + (byStatus[key] ?? 0), 0);
        return (
          <section
            key={lane.key}
            aria-label={lane.label}
            className="flex min-h-40 flex-col rounded-xl border border-stone-200/80 bg-stone-100/60 p-2.5"
          >
            <div className="flex items-center justify-between px-1.5 py-1 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <span aria-hidden="true" className={`size-1.5 rounded-full ${lane.dot}`} />
                {lane.label}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-stone-600 tabular-nums ring-1 ring-stone-200/80">
                {count(total)}
              </span>
            </div>
            <div className="mt-2.5 space-y-2">
              {inLane.length === 0 && (
                <p className="px-1.5 py-3 text-center text-[11px] text-stone-400">Nothing here</p>
              )}
              {inLane.slice(0, LANE_SHOWN).map((card) => (
                <Link
                  key={card.id}
                  to={`/orders/${card.id}`}
                  className="block rounded-xl border border-slate-200/90 bg-white p-3 text-sm shadow-2xs transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ring-1 ring-black/5 ring-inset ${avatarTone(card.customer)}`}
                    >
                      {initials(card.customer)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate font-semibold text-slate-900">
                          {card.customer}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] font-semibold text-slate-900 tabular-nums">
                          {peso(card.total)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-stone-500">
                        {card.code} · {card.via ? `Online · ${card.via.source}` : (card.channel ?? card.customerKind)}
                      </div>
                    </div>
                  </div>
                  <p className="mt-1.5 truncate text-[11px] text-slate-600" title={card.lines}>
                    {card.lines}
                  </p>
                  <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-2 text-[11px] font-medium text-stone-400">
                    <span className="truncate text-stone-500">{card.medrep}</span>
                    <span className="shrink-0">{dayLabel(card.placedOn)}</span>
                  </div>
                </Link>
              ))}
              {total > Math.min(inLane.length, LANE_SHOWN) && (
                <button
                  type="button"
                  onClick={() => onMore(lane.key)}
                  className="w-full rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold text-emerald-700 hover:bg-white"
                >
                  {count(total - Math.min(inLane.length, LANE_SHOWN))} more in {lane.label}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
