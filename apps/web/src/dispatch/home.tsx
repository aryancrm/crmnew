// Dispatch's Home, as the warehouse works (Aryan, 19 Nov: "the orders come for dispatch at the
// top, then what they packed and sent, then what was delivered; filter by cash on delivery,
// prepaid, 30 or 45 days"). Three stages: 1 To pack & ship, 2 On the road, 3 Delivered (the last
// 30 days), each order with how it is paid and its own buttons. Dispatch marks an order delivered
// only with the photo of the signed receipt; on a cash-on-delivery order it notes how much the
// rider or courier collected and who has it, and Finance records the payment once it is in the
// bank. Its people press Start at the top of the menu; the orders are shared out among them.

import type { DispatchBoard, DispatchCard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Printer, Snowflake } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Figure } from "../home/figures";
import { todayWords } from "../home/home";
import { ReasonDialog } from "../orders/parts";
import { count, dayLabel, PageState, peso } from "../ui";
import { type DispatchAsk, DispatchDialogs } from "./parts";

type Stage = "pending" | "road" | "done";
type Paying = "all" | "cod" | "advance" | "days";

const STAGES: { key: Stage; number: number; title: string; hint: string }[] = [
  { key: "pending", number: 1, title: "To pack & ship", hint: "Came for dispatch: pack it, then ship it" },
  { key: "road", number: 2, title: "On the road", hint: "Sent: mark it delivered with the signed receipt" },
  { key: "done", number: 3, title: "Delivered", hint: "Delivered: cash on delivery noted, then Finance" },
];

const PAYING: { key: Paying; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cod", label: "Cash on delivery" },
  { key: "advance", label: "Prepaid" },
  { key: "days", label: "On terms" },
];

const MAIN =
  "h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50";
const QUIET =
  "h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50";

/** Whole days since a moment. */
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : 0);

export function DispatchHome() {
  const [params, setParams] = useSearchParams();
  const stage: Stage = params.get("tab") === "road" ? "road" : params.get("tab") === "done" ? "done" : "pending";
  const paying = (PAYING.some((one) => one.key === params.get("pay")) ? params.get("pay") : "all") as Paying;
  const [asking, setAsking] = useState<DispatchAsk>(null);
  const [holding, setHolding] = useState<DispatchCard | null>(null);
  const board = useQuery({
    queryKey: ["dispatch", "board"],
    queryFn: () => api<DispatchBoard>("/api/dispatch/board"),
    refetchInterval: 60_000,
  });
  const data = board.data;
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const lists: Record<Stage, DispatchCard[]> = data
    ? { pending: [...data.toPack, ...data.toShip], road: data.road, done: data.done }
    : { pending: [], road: [], done: [] };
  const totals: Record<Stage, number> = data
    ? { pending: data.counts.toPack + data.counts.toShip, road: data.counts.road, done: data.counts.done }
    : { pending: 0, road: 0, done: 0 };
  const here = lists[stage];
  const ofKind = (kind: Paying) => (kind === "all" ? here : here.filter((card) => card.pay?.terms === kind));
  const shown = ofKind(paying);
  const ask = (what: NonNullable<DispatchAsk>["what"], card: DispatchCard) =>
    setAsking({
      what,
      orderId: card.id,
      code: card.code,
      collect: what === "cod" ? (card.pay?.balance ?? 0) : card.collect,
      carrier: card.cod?.by ?? card.rider ?? card.courier,
    });
  const counts = data?.counts;

  return (
    <div className="mx-auto max-w-screen-2xl">
      <div className="min-w-0 space-y-4">
        <div>
          <div className="text-xs text-slate-500">{todayWords()}</div>
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Dispatch desk</h1>
          <div className="mt-0.5 text-xs text-slate-500">
            Every order to pack and ship, shared automatically among the people started (left).
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure label="To pack" value={counts ? count(counts.toPack) : "—"} sub="approved and invoiced" to="/" tone={counts && counts.toPack > 0 ? "warn" : undefined} />
          <Figure label="To ship" value={counts ? count(counts.toShip) : "—"} sub="packed, waiting for the courier" to="/" />
          <Figure label="On the road" value={counts ? count(counts.road) : "—"} sub={counts ? `${count(counts.delivered)} delivered today` : undefined} to="/?tab=road" />
          <Figure label="On hold" value={counts ? count(counts.held) : "—"} sub="held with a reason" to="/dispatch/hold" />
        </div>

        {/* The three stages, in the order the warehouse works them. */}
        <div className="grid gap-2 sm:grid-cols-3">
          {STAGES.map((one) => (
            <button
              key={one.key}
              type="button"
              aria-pressed={stage === one.key}
              onClick={() => set({ tab: one.key === "pending" ? null : one.key, pay: null })}
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                stage === one.key
                  ? "border-brand bg-emerald-50/70 ring-1 ring-brand/30"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                  stage === one.key ? "bg-brand text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {one.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  {one.title}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 tabular-nums">
                    {data ? count(totals[one.key]) : "…"}
                  </span>
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {one.key === "done" && data ? `The last ${data.doneDays} days` : one.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* How it is paid. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Paid by</span>
          {PAYING.map((one) => (
            <button
              key={one.key}
              type="button"
              aria-pressed={paying === one.key}
              onClick={() => set({ pay: one.key === "all" ? null : one.key })}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${
                paying === one.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {one.label}
              <span className={paying === one.key ? "text-white/80" : "text-slate-400"}>{count(ofKind(one.key).length)}</span>
            </button>
          ))}
        </div>

        {!data ? (
          <PageState query={board} what="the warehouse's work" />
        ) : (
          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,auto)] gap-4 border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase lg:grid">
              <span>Order</span>
              <span>What goes</span>
              <span>{stage === "pending" ? "Where it stands" : stage === "road" ? "With whom" : "Delivered"}</span>
              <span>Payment</span>
              <span className="text-right">&nbsp;</span>
            </div>
            {shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                {stage === "pending"
                  ? "Nothing to pack or ship."
                  : stage === "road"
                    ? "Nothing on the road."
                    : `Nothing delivered in the last ${data.doneDays} days.`}
                {paying !== "all" && " (with this payment)"}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((card) => (
                  <Row key={card.id} card={card} stage={stage} today={data.today}>
                    {data.can.work && <Actions card={card} stage={stage} ask={ask} onHold={() => setHolding(card)} />}
                  </Row>
                ))}
              </ul>
            )}
            {here.length < totals[stage] && (
              <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                Showing {count(here.length)} of {count(totals[stage])}: the oldest first. The rest are in{" "}
                <Link to="/orders" className="font-semibold text-emerald-700 hover:underline">
                  All orders
                </Link>
                .
              </p>
            )}
          </section>
        )}
        {stage === "done" && (
          <p className="text-[12px] leading-relaxed text-slate-500">
            Cash on delivery: note how much the rider or courier collected and who has it. Finance records the payment once
            the money is in the bank, and collects the orders on terms when they fall due.
          </p>
        )}
      </div>
      <DispatchDialogs ask={asking} onClose={() => setAsking(null)} />
      {holding && <ReasonDialog orderId={holding.id} code={holding.code} what="hold" onClose={() => setHolding(null)} />}
    </div>
  );
}

/** One order: who it is for, what goes, where it stands, how it is paid, its buttons. */
function Row({ card, stage, today, children }: { card: DispatchCard; stage: Stage; today: string; children?: ReactNode }) {
  const late = card.expectedOn !== null && card.expectedOn < today;
  const items = card.items.filter((item) => !item.free);
  const cold = card.items.some((item) => item.cold);
  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,auto)] lg:items-center">
      <div className="min-w-0">
        <Link to={`/orders/${card.id}`} className="text-sm font-semibold text-slate-900 hover:underline">
          {card.code}
        </Link>
        <span className="ml-2 text-sm text-slate-700">{card.customer}</span>
        <div className="truncate text-[11px] text-slate-500">
          {[card.address, card.receiver && `to ${card.receiver}`, card.receiverPhone].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
      <div className="min-w-0 text-[12px] text-slate-700">
        <div className="truncate">
          {items.slice(0, 2).map((item) => `${item.name} × ${count(item.qty)}`).join(", ")}
          {items.length > 2 && ` +${items.length - 2} more`}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {count(card.pieces)} pieces{card.warehouse ? ` · from ${card.warehouse}` : ""}
          {cold && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-sky-700">
              <Snowflake className="size-3" /> cold
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0 text-[12px]">
        {stage === "pending" ? (
          <>
            {card.status === "ready_for_dispatch" ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">To pack</span>
            ) : card.cameBack ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                Came back: ship again
              </span>
            ) : (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">Packed: to ship</span>
            )}
            <div className={`mt-1 text-[11px] ${late ? "font-semibold text-rose-700" : "text-slate-500"}`}>
              {card.expectedOn ? `Wanted ${dayLabel(card.expectedOn)}${late ? " (late)" : ""}` : "No day asked"}
              {card.dispatchBy && ` · with ${card.dispatchBy}`}
            </div>
          </>
        ) : stage === "road" ? (
          <>
            <div className="text-slate-800">
              {card.courier ? `${card.courier}${card.tracking ? ` · ${card.tracking}` : " · no tracking yet"}` : card.rider ? `Rider · ${card.rider}` : "—"}
            </div>
            <div className={`text-[11px] ${daysSince(card.shippedAt) >= 3 ? "font-semibold text-rose-700" : "text-slate-500"}`}>
              {card.shippedAt ? `Sent ${daysSince(card.shippedAt) === 0 ? "today" : `${daysSince(card.shippedAt)} days ago`}` : "Sent"}
            </div>
          </>
        ) : (
          <>
            <div className="text-slate-800">{card.deliveredAt ? dayLabel(card.deliveredAt.slice(0, 10)) : "Delivered"}</div>
            <div className="truncate text-[11px] text-slate-500">
              {card.receivedBy ? `Received by ${card.receivedBy}` : "—"}
              {card.papers.includes("dr") && " · signed receipt ✓"}
            </div>
          </>
        )}
      </div>
      <div className="min-w-0">
        <Payment card={card} stage={stage} today={today} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">{children}</div>
    </li>
  );
}

/** How the order is paid, and where its money stands for Dispatch. */
function Payment({ card, stage, today }: { card: DispatchCard; stage: Stage; today: string }) {
  const pay = card.pay;
  if (!pay) return <span className="text-[12px] text-slate-400">No invoice yet</span>;
  const paid = <span className="text-[11px] font-semibold text-emerald-700">Paid ✓</span>;
  if (pay.terms === "cod") {
    return (
      <div className="text-[12px]">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
          Cash on delivery
        </span>
        <div className="mt-1 text-[11px]">
          {pay.paid ? (
            paid
          ) : stage !== "done" ? (
            <span className="text-slate-700">{peso(pay.balance)} to collect</span>
          ) : card.cod ? (
            <span className="text-sky-800">
              {peso(card.cod.amount)} with {card.cod.by} · Finance to confirm
            </span>
          ) : (
            <span className="font-semibold text-rose-700">{peso(pay.balance)}: cash not noted yet</span>
          )}
        </div>
      </div>
    );
  }
  if (pay.terms === "advance")
    return (
      <div className="text-[12px]">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Prepaid</span>
        <div className="mt-1 text-[11px]">{pay.paid ? paid : <span className="text-slate-600">Finance checking the payment</span>}</div>
      </div>
    );
  const late = stage === "done" && !pay.paid && pay.dueOn !== null && pay.dueOn < today;
  return (
    <div className="text-[12px]">
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
        {pay.payBy ? `Pays by ${dayLabel(pay.payBy)}` : `On terms · ${pay.days ?? 30} days`}
      </span>
      <div className="mt-1 text-[11px]">
        {pay.paid ? (
          paid
        ) : stage !== "done" ? (
          <span className="text-slate-600">{peso(pay.balance)}, due after delivery</span>
        ) : late ? (
          <span className="font-semibold text-rose-700">{peso(pay.balance)} late since {dayLabel(pay.dueOn ?? today)}</span>
        ) : (
          <span className="text-slate-600">
            {peso(pay.balance)} due {pay.dueOn ? dayLabel(pay.dueOn) : "after delivery"} · Finance collects
          </span>
        )}
      </div>
    </div>
  );
}

/** The buttons of the order's step. */
function Actions({
  card,
  stage,
  ask,
  onHold,
}: {
  card: DispatchCard;
  stage: Stage;
  ask: (what: NonNullable<DispatchAsk>["what"], card: DispatchCard) => void;
  onHold: () => void;
}) {
  if (stage === "pending")
    return card.status === "ready_for_dispatch" ? (
      <>
        <button type="button" className={MAIN} onClick={() => ask("pack", card)}>
          Pack
        </button>
        <button type="button" className={QUIET} onClick={onHold}>
          Hold
        </button>
      </>
    ) : (
      <>
        <button type="button" className={MAIN} onClick={() => ask("ship", card)}>
          {card.cameBack ? "Ship again" : "Ship"}
        </button>
        <Link to={`/orders/${card.id}/receipt`} className={`${QUIET} inline-flex items-center gap-1.5`}>
          <Printer className="size-3.5" /> Receipt
        </Link>
      </>
    );
  if (stage === "road")
    return (
      <>
        <button type="button" className={MAIN} onClick={() => ask("deliver", card)}>
          Delivered
        </button>
        {card.method === "courier" && !card.tracking && (
          <button type="button" className={QUIET} onClick={() => ask("tracking", card)}>
            Add tracking
          </button>
        )}
        <button type="button" className={QUIET} onClick={() => ask("failed", card)}>
          Came back
        </button>
      </>
    );
  // Delivered: a cash-on-delivery order whose money isn't recorded yet takes the cash note.
  if (card.pay?.terms === "cod" && !card.pay.paid && card.pay.balance > 0)
    return (
      <button type="button" className={card.cod ? QUIET : MAIN} onClick={() => ask("cod", card)}>
        {card.cod ? "Change cash note" : "Note the cash"}
      </button>
    );
  return null;
}
