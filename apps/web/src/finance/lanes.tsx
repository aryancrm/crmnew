// Finance's Board view (the order list's third look, beside Cards and Table): the money as it
// is worked, three columns in order. 1 Check payment: an advance order's proof beside the amount it
// should be. 2 Check dues: a credit or cash-on-delivery order (invoiced on approval), with what the customer already
// owes, how late, against their credit limit. 3 Collect: open invoices, the latest past due first.
// Above them the money in today and this month, owed and overdue. Loaded only when someone picks
// Board (lazy), with its own read. On a phone the three columns are three tabs.

import type { FinanceBoard, FinanceCollect, FinanceOrderCard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { FileText, ImageOff, StickyNote, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { ConfirmPaymentDialog, RecordPaymentDialog, useMoney } from "./parts";
import { ReasonDialog, waited } from "../orders/parts";
import { count, dayLabel, PageState, peso } from "../ui";
import { useWorkClock } from "../work-clock";
import { Figure } from "../home/figures";

type Lane = "check" | "invoice" | "collect";

const LANES: { key: Lane; number: number; title: string; hint: string }[] = [
  { key: "check", number: 1, title: "Check payment", hint: "Advance orders: is the money in?" },
  {
    key: "invoice",
    number: 2,
    title: "Check dues",
    hint: "Credit and COD: look at what they owe, then send it on"
  },
  { key: "collect", number: 3, title: "Collect", hint: "Open invoices, the latest past due first" },
];

const MAIN =
  "h-9 flex-1 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50";
const QUIET =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";

const termsWord = (card: FinanceOrderCard) =>
  card.terms === "days"
    ? `${card.paymentDays} days after delivery${card.paymentTerm ? ` (${card.paymentTerm})` : ""}`
    : card.terms === "cod"
      ? "Cash on delivery"
      : "Paid in advance";

export function FinanceLanes() {
  const me = useMe().data;
  const navigate = useNavigate();
  const money = useMoney();
  const [params, setParams] = useSearchParams();
  const lane = (params.get("lane") ?? "check") as Lane;
  const [confirming, setConfirming] = useState<FinanceOrderCard | null>(null);
  const [holding, setHolding] = useState<FinanceOrderCard | null>(null);
  const [recording, setRecording] = useState<FinanceCollect | null>(null);
  const board = useQuery({
    queryKey: ["finance", "board"],
    queryFn: () => api<FinanceBoard>("/api/finance/board"),
    refetchInterval: 30_000,
  });
  const data = board.data;
  if (!me) return null;
  if (!data) return <PageState query={board} what="Finance's work" />;
  const work = data.can.work;
  const counts: Record<Lane, number> = {
    check: data.check.length,
    invoice: data.invoice.length,
    collect: data.money.toCollect,
  };

  const column = (key: Lane) => {
    const meta = LANES.find((one) => one.key === key) as (typeof LANES)[number];
    const empty =
      key === "check"
        ? data.check.length === 0
        : key === "invoice"
          ? data.invoice.length === 0
          : data.collect.length === 0;
    return (
      <section key={key} aria-label={meta.title} className="flex min-w-0 flex-col gap-3">
        <header className="flex items-center gap-2.5 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-2xs">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700">
            {meta.number}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">{meta.title}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 tabular-nums">
                {count(counts[key])}
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-500">{meta.hint}</p>
          </div>
        </header>
        {empty ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-xs text-slate-500">
            {key === "check"
              ? "No payment to check."
              : key === "invoice"
                ? "No invoice to make."
                : "Nothing to collect."}
          </div>
        ) : key === "check" ? (
          data.check.map((card) => (
            <OrderMoneyCard
              key={card.id}
              card={card}
              lane="check"
              onOpen={() => navigate(`/orders/${card.id}`)}
            >
              {work && (
                <>
                  <button type="button" className={MAIN} onClick={() => setConfirming(card)}>
                    Confirm payment
                  </button>
                  <button type="button" className={QUIET} onClick={() => setHolding(card)}>
                    Hold
                  </button>
                </>
              )}
            </OrderMoneyCard>
          ))
        ) : key === "invoice" ? (
          data.invoice.map((card) => (
            <OrderMoneyCard
              key={card.id}
              card={card}
              lane="invoice"
              onOpen={() => navigate(`/orders/${card.id}`)}
            >
              {work && (
                <>
                  <button
                    type="button"
                    className={MAIN}
                    disabled={money.busy}
                    onClick={() => money.send(`/api/finance/orders/${card.id}/invoice`, {})}
                  >
                    Check & send to Dispatch
                  </button>
                  <button type="button" className={QUIET} onClick={() => setHolding(card)}>
                    Hold
                  </button>
                </>
              )}
            </OrderMoneyCard>
          ))
        ) : (
          data.collect.map((row) => (
            <CollectCard
              key={row.invoiceId}
              row={row}
              onOpen={() => navigate(`/invoices/${row.invoiceId}`)}
            >
              {work && (
                <button type="button" className={MAIN} onClick={() => setRecording(row)}>
                  Record payment
                </button>
              )}
              <Link
                to={`/invoices/${row.invoiceId}`}
                onClick={(event) => event.stopPropagation()}
                className={`${QUIET} inline-flex items-center gap-1.5`}
              >
                <FileText className="size-3.5" /> Invoice
              </Link>
            </CollectCard>
          ))
        )}
        {key === "collect" && data.money.toCollect > data.collect.length && (
          <Link
            to="/owed"
            className="text-center text-xs font-semibold text-emerald-700 hover:underline"
          >
            {count(data.money.toCollect - data.collect.length)} more → Customers owe
          </Link>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {data.money.held > 0 && (
            <Link
              to="/finance?tab=hold"
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-semibold text-rose-700 hover:border-rose-300"
            >
              <span className="size-1.5 rounded-full bg-rose-500" /> {count(data.money.held)} on
              hold
            </Link>
          )}
          {data.money.refunds > 0 && (
            <Link
              to="/refunds"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-900 hover:border-amber-400"
            >
              <span className="size-1.5 rounded-full bg-amber-500" /> {count(data.money.refunds)}{" "}
              refunds owed
            </Link>
          )}
          {data.money.coming > 0 && (
            <Link
              to="/finance?tab=upstream"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 shadow-2xs hover:border-slate-300"
            >
              <span className="size-1.5 rounded-full bg-sky-500" /> {count(data.money.coming)}{" "}
              waiting for Management
            </Link>
          )}
        </div>
      </div>

      {/* The money at a glance. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Money in today"
          value={peso(data.money.inToday)}
          sub="payments recorded"
          to="/payments"
        />
        <Figure
          label="Money in this month"
          value={peso(data.money.inMonth)}
          sub={`invoiced ${peso(data.money.invoicedMonth)}`}
          to="/payments"
        />
        <Figure
          label="Customers owe"
          value={peso(data.money.owed)}
          sub={
            data.money.onDelivery
              ? `+ ${peso(data.money.onDelivery)} on delivery`
              : `${count(data.money.toCollect)} invoices`
          }
          to="/owed"
        />
        <Figure
          label="Overdue"
          value={peso(data.money.overdue)}
          sub={data.money.overdue ? "past the due day" : "nothing late"}
          tone={data.money.overdue ? "bad" : undefined}
          to="/owed"
        />
      </div>

      {money.problem && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
        >
          {money.problem.message}
        </div>
      )}

      {/* A phone: the three steps as tabs. */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 xl:hidden">
        {LANES.map((one) => (
          <button
            key={one.key}
            type="button"
            aria-pressed={lane === one.key}
            onClick={() =>
              setParams(
                (old) => {
                  const next = new URLSearchParams(old);
                  if (one.key === "check") next.delete("lane");
                  else next.set("lane", one.key);
                  return next;
                },
                { replace: true },
              )
            }
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-semibold ${
              lane === one.key
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600"
            }`}
          >
            {one.number}. {one.title.replace(" payment", "").replace(" invoice", "")}
            <span className="rounded-full bg-slate-200/70 px-1.5 text-[10px] tabular-nums">
              {count(counts[one.key])}
            </span>
          </button>
        ))}
      </div>
      <div className="xl:hidden">{column(lane)}</div>
      <div className="hidden items-start gap-4 xl:grid xl:grid-cols-3">
        {LANES.map((one) => column(one.key))}
      </div>

      {confirming && (
        <ConfirmPaymentDialog
          orderId={confirming.id}
          code={confirming.code}
          customer={confirming.customer}
          total={confirming.due}
          onClose={() => setConfirming(null)}
        />
      )}
      {holding && (
        <ReasonDialog
          orderId={holding.id}
          code={holding.code}
          what="hold"
          financeHold
          onClose={() => setHolding(null)}
        />
      )}
      {recording && (
        <RecordPaymentDialog
          invoiceId={recording.invoiceId}
          code={recording.code}
          balance={recording.balance}
          orderId={recording.orderId}
          proofs={[]}
          onClose={() => setRecording(null)}
        />
      )}
    </div>
  );
}

const CARD =
  "flex cursor-pointer flex-col gap-2.5 rounded-2xl border p-3.5 shadow-2xs transition-[border-color,box-shadow] hover:shadow-md";

/** An order waiting on Finance: who, how much, what Finance looks at before letting it go. */
function OrderMoneyCard({
  card,
  lane,
  onOpen,
  children,
}: {
  card: FinanceOrderCard;
  lane: "check" | "invoice";
  onOpen: () => void;
  children: ReactNode;
}) {
  // Past Finance's limit (a working day), in working hours.
  const late = useWorkClock().lateAt("finance_check", card.stepSince);
  const overLimit = card.creditLimit !== null && card.owed + card.total > card.creditLimit;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the card holds buttons, so it can't be one link
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) onOpen();
      }}
      className={`${CARD} border-slate-200/90 bg-white hover:border-emerald-300`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            className="truncate text-sm font-semibold tracking-tight text-slate-900"
            title={card.customer}
          >
            {card.customer}
          </h3>
          <div className="truncate text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">{card.code}</span> · {card.medrep}
            {card.customerPo ? ` · PO ${card.customerPo}` : ""}
          </div>
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold tabular-nums ${late ? "text-rose-700" : "text-slate-500"}`}
        >
          {waited(card.stepSince)}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-slate-500">
            {lane === "check" ? "Should be paid" : "Invoice for"}
          </div>
          <div className="text-lg font-bold tracking-tight text-slate-900 tabular-nums">
            {peso(lane === "check" ? card.due : card.total)}
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
          {termsWord(card)}
        </span>
      </div>

      {lane === "check" &&
        (card.proofId ? (
          card.proofMime?.startsWith("image/") ? (
            <a
              href={`/api/papers/${card.proofId}`}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
              title="Open the proof of payment"
            >
              <img
                src={`/api/papers/${card.proofId}`}
                alt="Proof of payment"
                loading="lazy"
                className="h-28 w-full object-cover"
              />
            </a>
          ) : (
            <a
              href={`/api/papers/${card.proofId}`}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileText className="size-3.5" /> Open the proof of payment
            </a>
          )
        ) : (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
            <ImageOff className="size-3.5" /> No proof of payment yet: check the bank, or hold it
          </div>
        ))}

      {(card.owed > 0 || overLimit) && (
        <div
          className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${card.overdue > 0 || overLimit ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}
        >
          {card.overdue > 0 && <TriangleAlert className="mr-1 inline size-3.5" />}
          Already owes <span className="font-semibold">{peso(card.owed)}</span>
          {card.overdue > 0 && (
            <>
              {" "}
              · <span className="font-semibold">{peso(card.overdue)}</span> overdue
            </>
          )}
          {card.creditLimit !== null && (
            <span className="block text-[10px] opacity-80">
              Credit limit {peso(card.creditLimit)}
              {overLimit ? " · this order goes over it" : ""}
            </span>
          )}
        </div>
      )}

      {card.note && (
        <p className="flex gap-1.5 rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-950">
          <StickyNote className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span className="line-clamp-2">{card.note}</span>
        </p>
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps a button's click off the card */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside have their own keys */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** An open invoice: how much is left, by when, how late. */
function CollectCard({
  row,
  onOpen,
  children,
}: {
  row: FinanceCollect;
  onOpen: () => void;
  children: ReactNode;
}) {
  const late = row.daysLate > 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the card holds buttons, so it can't be one link
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) onOpen();
      }}
      className={`${CARD} ${late ? "border-rose-200 bg-rose-50/40 hover:border-rose-300" : "border-slate-200/90 bg-white hover:border-emerald-300"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            className="truncate text-sm font-semibold tracking-tight text-slate-900"
            title={row.customer}
          >
            {row.customer}
          </h3>
          <div className="truncate text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">{row.code}</span> · {row.orderCode} ·{" "}
            {row.medrep}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            late
              ? "bg-rose-600 text-white"
              : row.daysLate === 0
                ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300"
                : "bg-slate-100 text-slate-700"
          }`}
        >
          {late
            ? `${row.daysLate} days late`
            : row.daysLate === 0
              ? "Due today"
              : `Due in ${-row.daysLate} days`}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-slate-500">Left to pay</div>
          <div
            className={`text-lg font-bold tracking-tight tabular-nums ${late ? "text-rose-700" : "text-slate-900"}`}
          >
            {peso(row.balance)}
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>of {peso(row.total)}</div>
          <div>due {dayLabel(row.dueOn)}</div>
        </div>
      </div>
      {row.terms === "cod" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
          Cash on delivery: delivered, the cash is with{" "}
          {row.deliveryMethod === "rider"
            ? `our rider ${row.rider ?? ""}`
            : (row.courier ?? "the courier")}
        </p>
      )}
      {row.lastPaidOn && (
        <p className="text-[11px] text-slate-500">Last paid {dayLabel(row.lastPaidOn)}</p>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps a button's click off the card */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside have their own keys */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
