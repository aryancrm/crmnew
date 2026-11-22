// What the order screens share: a status as a pill, the orders table with its filters, the
// "say why" dialog, and how waiting time is written.

import type { OrderAction, OrderList, OrderStatus } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { smaller } from "../photo";
import {
  Button,
  Card,
  count,
  Dialog,
  Field,
  INPUT,
  PageState,
  Pill,
  Problem,
  peso,
  type Tone,
  timeLabel,
  useAction,
} from "../ui";

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: "plain",
  pending_approval: "violet",
  finance_check: "warn",
  ready_for_invoice: "warn",
  ready_for_dispatch: "info",
  packing: "info",
  shipped: "brand",
  completed: "good",
  on_hold: "bad",
  exception: "bad",
  cancelled: "plain",
};

export function StatusPill({ status, label }: { status: OrderStatus; label: string }) {
  return <Pill tone={STATUS_TONE[status]}>{label}</Pill>;
}

/** How long ago, short: "40m", "5.1h", "3d". */
export function waited(iso: string): string {
  return shortSpan(Math.max(0, (Date.now() - Date.parse(iso)) / 60_000));
}

/** Minutes as the cards say them: "now", "1m", "29m", "1h", "3d". */
export function shortSpan(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Minutes as "22h 36m". */
export const span = (minutes: number) =>
  minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;

/** Runs one of an order's buttons and re-reads every order screen. */
export function useOrderAction() {
  const queries = useQueryClient();
  const action = useAction();
  async function run(
    id: number,
    what: OrderAction,
    body: {
      reason?: string;
      warehouseId?: number | null;
      finance?: boolean;
      stock?: boolean;
      /** Taking it off hold: the step it goes on from. */
      to?: OrderStatus;
    } = {},
  ) {
    const done = await action.run(async () => {
      await api(`/api/orders/${id}/${what}`, { body });
    });
    await queries.invalidateQueries({ queryKey: ["orders"] });
    await queries.invalidateQueries({ queryKey: ["dispatch"] });
    return done;
  }
  return { ...action, act: run };
}

const WHY: Partial<Record<OrderAction, { title: string; button: string; hint: string }>> = {
  send_back: {
    title: "Send back to the MedRep",
    button: "Send back",
    hint: "The order returns to the MedRep as a draft with your reason, to fix and place again.",
  },
  reject: {
    title: "Reject this order",
    button: "Reject",
    hint: "It stops here with your reason (it is kept on hold, not deleted): nothing goes further until it is taken off hold. To end it for good, cancel it instead.",
  },
  hold: {
    title: "Put on hold",
    button: "Put on hold",
    hint: "The order stops where it is until it is taken off hold.",
  },
  exception: {
    title: "Mark as an exception",
    button: "Mark exception",
    hint: "For a problem Management can't settle alone (a contract, a dispute, a special price): it waits on hold, marked Exception, until the CEO or a supervisor decides and it is taken off hold.",
  },
  cancel: {
    title: "Cancel this order",
    button: "Cancel order",
    hint: "It stops for good and is kept. Management can bring it back later (Restore) while no money was given back on it.",
  },
  resume: {
    title: "Take off hold",
    button: "Take off hold",
    hint: "It goes on from where it stopped, or from an earlier desk to look at it again. The MedRep and that desk are told.",
  },
  restore: {
    title: "Restore this order",
    button: "Restore",
    hint: "The cancelled order comes back to Management's approval as it was; the cancel stays on its timeline. Its invoice is made again when it is approved.",
  },
  take_back: {
    title: "Take back the approval",
    button: "Take back approval",
    hint: "Approved by mistake? It comes back to Management's queue, and Finance and Dispatch stop seeing it. Only while they haven't worked on it, and up to 30 minutes after approving.",
  },
  answer: {
    title: "Answer the hold",
    button: "Send the answer",
    hint: "Your answer goes on the order and to the desk that held it. The hold stays until they take it off.",
  },
  resubmit: {
    title: "Send again unchanged",
    button: "Send to Management",
    hint: "Tell Management why the order is right as it is. To change it, use Fix and send again instead.",
  },
};

/** Asks why, then does it. Used by Send back, Reject, Put on hold, Mark exception, Cancel. */
export function ReasonDialog({
  orderId,
  code,
  what,
  initial = "",
  financeHold = false,
  choices = [],
  presets = [],
  onClose,
}: {
  orderId: number;
  code: string;
  what: OrderAction;
  /** Taking it off hold: where it may go on from, where it stopped first. */
  choices?: { status: OrderStatus; label: string }[];
  /** A reason already written (holding for money owed). */
  initial?: string;
  /** Finance holds it: screenshots (the bank, the slip) go with the reason, for the MedRep. */
  financeHold?: boolean;
  /** Reasons to pick with one press (Dispatch's hold, the hub's list); anything else is typed. */
  presets?: string[];
  onClose: () => void;
}) {
  const [reason, setReason] = useState(initial);
  const [to, setTo] = useState<OrderStatus | "">(choices[0]?.status ?? "");
  const [shots, setShots] = useState<File[]>([]);
  const [shotProblem, setShotProblem] = useState<string | null>(null);
  const order = useOrderAction();
  const queries = useQueryClient();
  const words = WHY[what];
  if (!words) return null;
  const withShots = financeHold && what === "hold";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!(await order.act(orderId, what, { reason, ...(to ? { to } : {}) }))) return;
    if (withShots && shots.length) {
      const failed: string[] = [];
      for (const shot of shots) {
        try {
          const form = new FormData();
          form.set("file", await smaller(shot));
          await api(`/api/finance/orders/${orderId}/hold-proof`, { body: form });
        } catch {
          failed.push(shot.name);
        }
      }
      await queries.invalidateQueries({ queryKey: ["orders"] });
      if (failed.length) {
        setShotProblem(`Held, but these didn't go: ${failed.join(", ")}`);
        return;
      }
    }
    onClose();
  }
  return (
    <Dialog title={`${words.title} · ${code}`} onClose={onClose} busy={order.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="text-[13px] text-ink-2">{words.hint}</div>
        {choices.length > 1 && (
          <Field label="Continue from" error={order.at("to")}>
            {(field) => (
              <select
                {...field}
                className={INPUT}
                value={to}
                onChange={(event) => setTo(event.target.value as OrderStatus)}
              >
                {choices.map((choice, index) => (
                  <option key={choice.status} value={choice.status}>
                    {index === 0 ? `Where it stopped — ${choice.label}` : `Back to ${choice.label}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field
          label={
            what === "resubmit"
              ? "Your answer to Management"
              : what === "answer"
                ? "Your answer"
                : what === "resume" || what === "restore"
                  ? "Why can it go on?"
                  : "Reason"
          }
          error={order.at("reason")}
        >
          {(field) => (
            <>
              {presets.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${reason === preset ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-line text-slate-600 hover:bg-hover"}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
              <textarea
              {...field}
              className={`${INPUT} min-h-24`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
            </>
          )}
        </Field>
        {withShots && (
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-medium text-slate-600">
              Screenshots for the MedRep (up to 5)
            </div>
            {shots.length > 0 && (
              <ul className="flex flex-col gap-1 text-[13px]">
                {shots.map((shot, index) => (
                  <li
                    key={`${shot.name}-${index}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{shot.name}</span>
                    <button
                      type="button"
                      onClick={() => setShots((all) => all.filter((_, at) => at !== index))}
                      className="text-xs text-slate-500 hover:text-slate-900"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {shots.length < 5 && (
              <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                <ImagePlus className="size-4" /> Add screenshot
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    const chosen = [...(event.target.files ?? [])];
                    setShots((all) => [...all, ...chosen].slice(0, 5));
                    event.target.value = "";
                  }}
                />
              </label>
            )}
            {shotProblem && <div className="text-[13px] text-rose-700">{shotProblem}</div>}
          </div>
        )}
        <Problem message={order.general(["reason"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={order.busy}>
            Close
          </Button>
          <Button
            type="submit"
            variant={
              ["send_back", "hold", "resubmit", "take_back", "answer", "resume", "restore"].includes(what)
                ? "primary"
                : "danger"
            }
            disabled={order.busy}
          >
            {order.busy ? "Saving…" : words.button}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The orders table with its search and filters. The filters live in the address. */
export function OrdersTable({ title }: { title: string }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [typed, setTyped] = useState(params.get("q") ?? "");
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    for (const [key, value] of Object.entries(changes))
      if (key === "page" && value) next.set("page", value);
    setParams(next, { replace: true });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts the timer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed !== (params.get("q") ?? "")) set({ q: typed });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const keys = ["status", "group", "q", "medrep", "from", "to", "stuck", "page"];
  const search = keys
    .map((key) =>
      params.get(key) ? `${key}=${encodeURIComponent(params.get(key) as string)}` : "",
    )
    .filter(Boolean)
    .join("&");
  const query = useQuery({
    queryKey: ["orders", "list", search],
    queryFn: () => api<OrderList>(`/api/orders?${search}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the orders" />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const narrowed = ["status", "group", "stuck", "medrep", "from", "to", "q"].some((key) =>
    params.get(key),
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
        <h2 className="text-[15px] font-semibold">
          {title} <span className="font-normal text-ink-2">{count(data.total)} total</span>
        </h2>
        <div className="rounded-[10px] bg-head px-3 py-1.5 text-[13px]">
          Total orders: <span className="font-semibold">{count(data.total)}</span>
          <span className="mx-2 text-slate-300">|</span>
          Total value:{" "}
          <span className="font-semibold text-brand-dark">{peso(data.totalValue)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 px-5 py-3">
        <div className="relative min-w-0 flex-[2_1_14rem]">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            aria-label="Search orders"
            placeholder="Search order, customer or MedRep"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="field pl-9"
          />
        </div>
        <select
          aria-label="Status"
          className={`${INPUT} flex-[1_1_11rem]`}
          value={params.get("status") ?? ""}
          onChange={(event) => set({ status: event.target.value, group: "", stuck: "" })}
        >
          <option value="">All statuses</option>
          {data.statuses.map((status) => (
            <option key={status.key} value={status.key}>
              {status.label}
            </option>
          ))}
        </select>
        {data.medreps.length > 1 && (
          <select
            aria-label="MedRep"
            className={`${INPUT} flex-[1_1_10rem]`}
            value={params.get("medrep") ?? ""}
            onChange={(event) => set({ medrep: event.target.value })}
          >
            <option value="">All MedReps</option>
            {data.medreps.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          From
          <input
            type="date"
            className={INPUT}
            value={params.get("from") ?? ""}
            onChange={(event) => set({ from: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          To
          <input
            type="date"
            className={INPUT}
            value={params.get("to") ?? ""}
            onChange={(event) => set({ to: event.target.value })}
          />
        </label>
        {narrowed && (
          <Button
            variant="quiet"
            onClick={() => {
              setTyped("");
              setParams({}, { replace: true });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {data.rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-ink-2">
          {narrowed ? "No order matches." : "No orders yet."}
        </div>
      ) : (
        <div className={`overflow-x-auto ${query.isPlaceholderData ? "opacity-60" : ""}`}>
          <table className="t">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>MedRep</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/orders/${row.id}`)}
                >
                  <td>
                    <Link
                      to={`/orders/${row.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="font-semibold whitespace-nowrap hover:underline"
                    >
                      {row.code}
                    </Link>
                  </td>
                  <td className="font-semibold">
                    {row.customer}
                    {row.via && (
                      <span className="ml-1.5 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white">
                        Online · {row.via.source}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-slate-600">{row.medrep}</td>
                  <td>
                    <StatusPill status={row.status} label={row.statusLabel} />
                  </td>
                  <td className="num font-semibold whitespace-nowrap">{peso(row.total)}</td>
                  <td className="whitespace-nowrap text-slate-600">{timeLabel(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-line-soft px-5 py-3 text-[13px] text-ink-2">
          Page {data.page} of {pages}
          <Button
            small
            disabled={data.page <= 1}
            onClick={() => set({ page: String(data.page - 1) })}
          >
            Previous
          </Button>
          <Button
            small
            disabled={data.page >= pages}
            onClick={() => set({ page: String(data.page + 1) })}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * The switch at the top of an order form: whether it goes to Management (and to Finance) before
 * Dispatch. It sets itself: nothing wrong on the order, it goes straight on; something wrong
 * (a price below the list, a new customer, an expired licence), Management is locked on and the
 * reasons are said. The person placing it can still ask Management to look.
 */
export function OrderChecksBox({
  reasons,
  management,
  onManagement,
  finance,
  onFinance,
}: {
  reasons: string[];
  management: boolean;
  onManagement: (on: boolean) => void;
  /** Left out where Finance always checks it. */
  finance?: boolean;
  onFinance?: (on: boolean) => void;
}) {
  const forced = reasons.length > 0;
  const toManagement = forced || management;
  const row = (
    label: string,
    on: boolean,
    text: string,
    locked: boolean,
    change: (on: boolean) => void,
  ) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">{label}</div>
        <div className={`text-[12px] ${on ? "text-amber-800" : "text-emerald-800"}`}>{text}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={locked}
        onClick={() => change(!on)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:cursor-not-allowed ${on ? "bg-amber-500" : "bg-slate-300"} ${locked ? "opacity-70" : ""}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
        />
      </button>
    </div>
  );
  const straight = !toManagement && !finance;
  return (
    <section
      aria-label="Before Dispatch"
      className={`flex flex-col gap-3 rounded-2xl border p-4 ${straight ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/50"}`}
    >
      <div className="text-[13px] font-semibold text-ink">
        {straight ? "Goes straight to Dispatch" : "Checked before Dispatch"}
      </div>
      {row(
        "Send to Management",
        toManagement,
        forced
          ? `Management checks it: ${reasons.join("; ")}`
          : management
            ? "Management checks it first"
            : "Nothing looks wrong: no need",
        forced,
        onManagement,
      )}
      {finance !== undefined &&
        onFinance &&
        row(
          "Send to Finance",
          finance,
          finance
            ? "Finance checks the payment, or what the customer owes, first"
            : "The invoice is made at once; Finance records the money when it comes",
          false,
          onFinance,
        )}
    </section>
  );
}
