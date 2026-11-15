// One order, laid out like an Online case (pages/lead.tsx): who it is for at the top, the order's
// journey under it (placed → Management → Finance → packed and shipped → delivered → paid, each
// with who and when), then the steps on the left with the money and the activity under them,
// and the step being worked on the right. Management, Finance and Dispatch each open on their
// own step; the step open is in the address (?step=).

import { DIVISIONS, PAYMENT_TERMS, SUB_DIVISIONS } from "@2mg/api/divisions";
import type { OrderAction, OrderDetail, PaperKind } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Box,
  Camera,
  Check,
  CircleCheck,
  CirclePause,
  CircleX,
  ExternalLink,
  FileText,
  MapPin,
  PackageOpen,
  Phone,
  Play,
  Printer,
  ReceiptText,
  TriangleAlert,
  Truck,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { type DispatchAsk, DispatchDialogs } from "../dispatch/parts";
import {
  ConfirmPaymentDialog,
  InvoiceStatus,
  RecordPaymentDialog,
  useMoney,
} from "../finance/parts";
import { avatarTone, initials } from "../look";
import { ReasonDialog, StatusPill, shortSpan, useOrderAction } from "../orders/parts";
import { SendToCustomer } from "../orders/send-update";
import { PAPER_ACCEPT, uploadPaper } from "../photo";
import {
  Button,
  count,
  dayLabel,
  INPUT,
  inPacks,
  PageState,
  Pill,
  Problem,
  peso,
  timeLabel,
  useAction,
} from "../ui";

type StepKey = "placed" | "management" | "finance" | "dispatch" | "delivered" | "paid";
type Shape = "done" | "now" | "stopped" | "later" | "skipped";

const short = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));

/** Each step of the order: done or not, who did it (or does it), and whether it is this person's. */
function stepsOf(data: OrderDetail) {
  const { order, can, money } = data;
  const stageAt = (key: string) => data.stages.find((stage) => stage.key === key)?.at ?? null;
  const stageBy = (key: string) => data.events.findLast((event) => event.stage === key)?.by ?? null;
  const fromCase = Boolean(order.leadId);
  const held = order.status === "on_hold" || order.status === "exception";
  const heldAt: StepKey | null = held
    ? order.heldRole === "finance"
      ? "finance"
      : order.heldRole === "dispatch"
        ? "dispatch"
        : "management"
    : null;
  const invoice = money.invoice;
  // Past Finance with its invoice but never checked there: the switch said no Finance (or a case).
  const pastFinance = ["ready_for_dispatch", "packing", "shipped", "completed"].includes(
    order.status,
  );
  const financeSkipped =
    (fromCase || pastFinance) && !stageAt("finance_verified") && Boolean(invoice);
  const delivered = order.status === "completed";
  const done: Record<StepKey, boolean> = {
    placed: order.status !== "draft",
    management: Boolean(order.approvedAt),
    finance: Boolean(stageAt("finance_verified")) || financeSkipped,
    dispatch: Boolean(order.shippedAt) || delivered,
    delivered,
    paid: invoice?.status === "paid",
  };
  const order_: StepKey[] = ["placed", "management", "finance", "dispatch", "delivered", "paid"];
  const current =
    order.status === "cancelled" ? null : (heldAt ?? order_.find((key) => !done[key]) ?? null);
  const mine: Record<StepKey, boolean> = {
    placed: can.resubmit,
    management:
      can.approve || can.send_back || can.reject || (can.resume && heldAt === "management"),
    finance: can.confirm_payment || can.make_invoice || (can.resume && heldAt === "finance"),
    dispatch:
      can.pack || can.ship || can.unpack || can.failed || (can.resume && heldAt === "dispatch"),
    delivered: can.deliver,
    paid: can.recordPayment,
  };
  const shape = (key: StepKey): Shape => {
    if (key === "finance" && financeSkipped) return "skipped";
    if (key === "management" && done.management && !order.approvedBy) return "skipped";
    if (done[key]) return "done";
    if (key === current) return held || order.status === "draft" ? "stopped" : "now";
    return "later";
  };
  const finance = stageAt("finance_verified");
  const steps: {
    key: StepKey;
    number: number;
    label: string;
    who: string;
    when: string | null;
    shape: Shape;
    mine: boolean;
  }[] = [
    {
      key: "placed",
      number: 1,
      label: "Placed",
      who: `${order.medrep}${order.raisedBy !== order.medrep ? ` (placed by ${order.raisedBy})` : ""}`,
      when: order.submittedAt ?? order.createdAt,
      shape: shape("placed"),
      mine: mine.placed,
    },
    {
      key: "management",
      number: 2,
      label: "Management check",
      who: order.approvedBy ?? (done.management ? "Not needed" : "Management"),
      when: order.approvedBy ? order.approvedAt : null,
      shape: shape("management"),
      mine: mine.management,
    },
    {
      key: "finance",
      number: 3,
      label: "Finance check",
      who: financeSkipped ? "Not needed" : (stageBy("finance_verified") ?? "Finance"),
      when: finance,
      shape: shape("finance"),
      mine: mine.finance,
    },
    {
      key: "dispatch",
      number: 4,
      label: "Pack & ship",
      who: order.shippedBy ?? order.packedBy ?? "Dispatch",
      when: order.shippedAt ?? order.packedAt,
      shape: shape("dispatch"),
      mine: mine.dispatch,
    },
    {
      key: "delivered",
      number: 5,
      label: "Delivered",
      who: order.deliveredBy ?? (fromCase ? "Online desk or Dispatch" : "Dispatch"),
      when: delivered && order.deliveredOn ? `${order.deliveredOn}T12:00:00Z` : null,
      shape: shape("delivered"),
      mine: mine.delivered,
    },
    {
      key: "paid",
      number: 6,
      label: "Paid",
      who: stageBy("paid") ?? (fromCase ? "Online desk" : "Finance"),
      when: done.paid ? stageAt("paid") : null,
      shape: shape("paid"),
      mine: mine.paid,
    },
  ];
  // How long each stop took (or has been waiting), from the statuses the order stood at.
  const AT: Partial<Record<StepKey, string[]>> = {
    management: ["pending_approval"],
    finance: ["finance_check", "ready_for_invoice"],
    dispatch: ["ready_for_dispatch", "packing", "shipped"],
  };
  const took = (key: StepKey) => {
    const at = data.steps.filter((step) => AT[key]?.includes(step.status));
    if (at.length === 0) return null;
    const minutes = at.reduce((sum, step) => sum + step.minutes, 0);
    return { minutes, open: at.some((step) => step.leftAt === null) };
  };
  return {
    steps: steps.map((item) => ({ ...item, took: took(item.key) })),
    current,
    heldAt,
  };
}

export function Order() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ["orders", "one", id],
    queryFn: () => api<OrderDetail>(`/api/orders/${id}`),
  });
  const act = useOrderAction();
  const money = useMoney();
  const [asking, setAsking] = useState<OrderAction | null>(null);
  const [dispatching, setDispatching] = useState<DispatchAsk>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="this order" />;
  const { order, can } = data;
  const { steps, current } = stepsOf(data);
  const picked = params.get("step") as StepKey | null;
  // Each desk opens on its own step when it has one, else where the order stands.
  const opened: StepKey =
    picked && steps.some((item) => item.key === picked)
      ? picked
      : (steps.find((item) => item.mine)?.key ?? current ?? "placed");
  const open = (key: StepKey) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        next.set("step", key);
        return next;
      },
      { replace: true },
    );
  const nextOf = (key: StepKey) =>
    steps[steps.findIndex((item) => item.key === key) + 1]?.key ?? null;
  const ask = (what: NonNullable<DispatchAsk>["what"]) =>
    setDispatching({ what, orderId: order.id, code: order.code });
  const pays =
    order.paymentTerms === "days"
      ? `Pays ${order.paymentDays} days after the invoice`
      : order.paymentTerms === "cod"
        ? "Cash on delivery"
        : "Paid in advance";
  const problem = act.problem ?? money.problem;
  const others: {
    action: OrderAction;
    label: string;
    icon: typeof Play;
    danger?: boolean;
    reason: boolean;
  }[] = [
    { action: "resume", label: "Take off hold", icon: Play, reason: false },
    {
      action: "take_back",
      label: order.takeBackUntil
        ? `Take back approval (until ${new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(order.takeBackUntil))})`
        : "Take back approval",
      icon: Undo2,
      reason: true,
    },
    { action: "hold", label: "Put on hold", icon: CirclePause, reason: true },
    {
      action: "exception",
      label: "Mark exception",
      icon: TriangleAlert,
      danger: true,
      reason: true,
    },
    { action: "cancel", label: "Cancel order", icon: CircleX, danger: true, reason: true },
  ];
  const shownOthers = others.filter((item) => can[item.action]);

  return (
    <div className="mx-auto max-w-screen-2xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-3.5" /> Back
      </button>

      {/* Who it is for, what it is worth and where it goes. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${avatarTone(order.customer)}`}
            >
              {initials(order.customer)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold tracking-tight text-ink">
                  <Link to={`/customers/${order.customerId}`} className="hover:text-emerald-800">
                    {order.customer}
                  </Link>
                </h1>
                <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                  {order.code}
                </span>
                <StatusPill status={order.status} label={order.statusLabel} />
                {order.customerReview === "to_review" && order.customerKind !== "patient" && (
                  <Pill tone="warn">New customer</Pill>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <UserRound className="size-3.5 text-slate-400" />{" "}
                  {order.receiver ?? order.customer}
                </span>
                {order.receiverPhone && (
                  <a
                    href={`tel:${order.receiverPhone}`}
                    className="inline-flex items-center gap-1 hover:text-emerald-700"
                  >
                    <Phone className="size-3.5 text-slate-400" /> {order.receiverPhone}
                  </a>
                )}
                {order.deliveryAddress && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <MapPin className="size-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{order.deliveryAddress}</span>
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-slate-600">
                  {order.customerKind[0]?.toUpperCase() + order.customerKind.slice(1)}
                </span>
                {order.channel && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700">
                      {order.channel}
                    </span>
                  </>
                )}
                <span className="text-slate-300">·</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700">
                  {pays}
                </span>
                <span className="text-slate-400">
                  Placed {timeLabel(order.submittedAt ?? order.createdAt)} by {order.raisedBy}
                </span>
                {order.leadId && (
                  <Link
                    to={`/leads/${order.leadId}`}
                    className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                  >
                    From the Online case <ExternalLink className="size-3" />
                  </Link>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-tight tabular-nums">
              {peso(order.total)}
            </div>
            {data.money.invoice && (
              <div className="mt-1 flex justify-end">
                <InvoiceStatus state={data.money.invoice.state} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <Link
                to={`/orders/${order.id}/sales-order`}
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 text-[13px] font-semibold text-slate-700 shadow-sm hover:border-field hover:bg-hover"
              >
                <FileText className="size-4" aria-hidden="true" /> Sales order
              </Link>
              <SendToCustomer orderId={order.id} small />
            </div>
          </div>
        </div>
        {order.status === "draft" && (order.sentBackReason ?? order.flagReason) ? (
          // Sent back: Management's reason, and the MedRep's two ways to answer it.
          <div className="mt-3 flex flex-col gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-950 sm:flex-row sm:items-center">
            <Undo2 className="hidden size-5 shrink-0 text-amber-600 sm:block" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                Sent back to {order.medrep}
                {order.sentBackBy ? ` by ${order.sentBackBy}` : ""}
                {order.sentBackAt ? ` · ${timeLabel(order.sentBackAt)}` : ""}
                {order.sentBackCount > 1 ? ` · ${order.sentBackCount} times` : ""}
              </div>
              <div className="mt-0.5">{order.sentBackReason ?? order.flagReason}</div>
            </div>
            {can.resubmit && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  to={`/orders/${order.id}/fix`}
                  className="inline-flex h-9 items-center rounded-lg bg-brand px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-dark"
                >
                  Fix and send again
                </Link>
                <button
                  type="button"
                  onClick={() => setAsking("resubmit")}
                  className="inline-flex h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                >
                  It's right as it is
                </button>
              </div>
            )}
          </div>
        ) : order.flagReason ? (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 sm:flex-row sm:items-center">
            <span className="flex flex-1 gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <b>{order.statusLabel}:</b> {order.flagReason}
              </span>
            </span>
            {can.answer && (
              // The MedRep's own held order: answer the question, or call the order off.
              <span className="flex shrink-0 gap-2">
                {can.answer && (
                  <button
                    type="button"
                    onClick={() => setAsking("answer")}
                    className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-dark"
                  >
                    Answer
                  </button>
                )}
                {can.cancel && (
                  <button
                    type="button"
                    onClick={() => setAsking("cancel")}
                    className="inline-flex h-8 items-center rounded-lg border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Cancel order
                  </button>
                )}
              </span>
            )}
          </div>
        ) : null}
        {order.status !== "draft" && order.sentBackCount > 0 && order.sentBackReason && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-[13px] leading-snug text-amber-950">
            <div>
              <b>
                Sent back{order.sentBackCount > 1 ? ` ${order.sentBackCount} times` : ""}
                {order.sentBackBy ? ` by ${order.sentBackBy}` : ""}:
              </b>{" "}
              {order.sentBackReason}
            </div>
            {order.reply && (
              <div className="mt-1">
                <b>{order.medrep}'s answer:</b> {order.reply}
              </div>
            )}
          </div>
        )}
      </section>

      {/* The order's road, each stop with who and when. */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 pt-3 pb-4 shadow-sm">
        <div className="text-[11px] font-semibold tracking-[0.06em] text-slate-500">
          ORDER JOURNEY
        </div>
        <ol className="relative mt-3 grid grid-cols-6 gap-1">
          <span
            aria-hidden="true"
            className="absolute top-[13px] right-[8.33%] left-[8.33%] h-[3px] rounded bg-slate-200"
          />
          <span
            aria-hidden="true"
            className="absolute top-[13px] left-[8.33%] h-[3px] rounded bg-emerald-500"
            style={{
              width: `${(Math.max(0, steps.filter((item) => item.shape === "done" || item.shape === "skipped").length - 1) / 5) * 83.34}%`,
            }}
          />
          {steps.map((item) => (
            <li key={item.key} className="relative flex min-w-0 flex-col items-center text-center">
              <button
                type="button"
                onClick={() => open(item.key)}
                aria-label={`${item.label}: ${item.shape === "done" ? "done" : item.shape === "skipped" ? "not needed" : item.shape === "now" ? "now" : item.shape === "stopped" ? "held" : "later"}`}
                className={`grid size-7 place-items-center rounded-full focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
                  item.shape === "done"
                    ? "bg-emerald-500 text-white"
                    : item.shape === "skipped"
                      ? "border-2 border-emerald-400 bg-white text-emerald-600"
                      : item.shape === "now"
                        ? "border-[3px] border-amber-500 bg-amber-50"
                        : item.shape === "stopped"
                          ? "border-[3px] border-rose-500 bg-rose-50 text-rose-600"
                          : "border-2 border-slate-300 bg-white"
                }`}
              >
                {item.shape === "done" ? (
                  <Check className="size-4" />
                ) : item.shape === "skipped" ? (
                  <Check className="size-3.5" />
                ) : item.shape === "stopped" ? (
                  "!"
                ) : null}
              </button>
              <span
                className={`mt-2 text-[10px] leading-tight font-semibold sm:text-[12px] ${item.shape === "now" ? "text-amber-700" : item.shape === "stopped" ? "text-rose-700" : item.shape === "later" ? "text-slate-500" : "text-ink"}`}
              >
                {item.label}
              </span>
              <span className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">
                {item.who}
                {item.when && item.shape === "done"
                  ? ` · ${item.key === "delivered" ? dayLabel(item.when.slice(0, 10)) : short(item.when)}`
                  : ""}
              </span>
              {item.took && (
                <span
                  className={`mt-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${item.took.open ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "text-slate-500"}`}
                  title={item.took.open ? "Waiting here for" : "Time it took at this step"}
                >
                  {item.took.minutes < 1
                    ? item.took.open
                      ? "just came"
                      : "took <1m"
                    : `${item.took.open ? "waiting" : "took"} ${shortSpan(item.took.minutes)}`}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] 2xl:grid-cols-[22rem_minmax(0,1fr)]">
        <nav
          aria-label="Steps"
          className="min-w-0 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:col-start-1 lg:row-start-1"
        >
          {steps.map((item) => {
            const on = item.key === opened;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={on ? "step" : undefined}
                onClick={() => open(item.key)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors ${on ? "bg-emerald-50 font-semibold text-emerald-900" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    item.shape === "done" || item.shape === "skipped"
                      ? "bg-emerald-600 text-white"
                      : item.shape === "stopped"
                        ? "bg-rose-100 text-rose-700"
                        : on || item.shape === "now"
                          ? "bg-white text-emerald-800 ring-2 ring-emerald-500"
                          : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.shape === "done" || item.shape === "skipped" ? (
                    <Check className="size-3.5" />
                  ) : (
                    item.number
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  <span
                    className={`block truncate text-[11px] font-normal ${item.mine && item.shape !== "done" ? "font-semibold text-amber-700" : "text-slate-500"}`}
                  >
                    {item.mine && item.shape !== "done" ? "Your step" : item.who}
                  </span>
                </span>
              </button>
            );
          })}
          {shownOthers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5 border-t border-slate-100 px-1 pt-2">
              {shownOthers.map((item) => (
                <Button
                  key={item.action}
                  small
                  variant={item.danger ? "danger" : "plain"}
                  disabled={act.busy}
                  onClick={() =>
                    item.reason ? setAsking(item.action) : act.act(order.id, item.action)
                  }
                >
                  <item.icon className="size-3.5" aria-hidden="true" /> {item.label}
                </Button>
              ))}
            </div>
          )}
        </nav>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {opened === "placed" && <PlacedStep data={data} next={() => open("management")} />}
          {opened === "management" && (
            <ManagementStep
              data={data}
              act={act}
              onAsk={setAsking}
              next={() => open(nextOf("management") ?? "finance")}
            />
          )}
          {opened === "finance" && (
            <FinanceStep data={data} money={money} next={() => open("dispatch")} />
          )}
          {opened === "dispatch" && (
            <DispatchStep data={data} ask={ask} next={() => open("delivered")} />
          )}
          {opened === "delivered" && (
            <DeliveredStep data={data} ask={ask} next={() => open("paid")} />
          )}
          {opened === "paid" && <PaidStep data={data} />}
          <div className="mt-3">
            <Problem message={problem?.message} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
          <MoneyCard data={data} />
          <Activity data={data} />
        </div>
      </div>

      {asking && (
        <ReasonDialog
          orderId={order.id}
          code={order.code}
          what={asking}
          onClose={() => setAsking(null)}
        />
      )}
      <DispatchDialogs ask={dispatching} onClose={() => setDispatching(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- frames

function StepPanel({
  number,
  title,
  children,
  footer,
}: {
  number: number;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
          {number}
        </span>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
          {footer}
        </div>
      )}
    </section>
  );
}

function NextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button small onClick={onClick}>
      {label} <ArrowRight className="size-4" />
    </Button>
  );
}

/** A finished or waiting fact on a step, one line. */
function Fact({ shape, children, note }: { shape: Shape; children: ReactNode; note?: ReactNode }) {
  const tone =
    shape === "done" || shape === "skipped"
      ? "border-green-200 bg-green-50"
      : shape === "now"
        ? "border-amber-300 bg-amber-50"
        : shape === "stopped"
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-white text-slate-500";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-[13px] ${tone}`}
    >
      <span
        aria-hidden="true"
        className={`font-bold ${shape === "done" || shape === "skipped" ? "text-emerald-700" : shape === "now" ? "text-amber-700" : shape === "stopped" ? "text-rose-700" : "text-slate-300"}`}
      >
        {shape === "done" || shape === "skipped" ? "✓" : shape === "stopped" ? "!" : "●"}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {note && (
        <span className={`text-right ${shape === "now" ? "text-amber-800" : "text-slate-500"}`}>
          {note}
        </span>
      )}
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
      {rows
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([label, value]) => (
          <div key={label}>
            <dt className="text-[12px] font-semibold text-slate-600">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** The order's lines, with the price list beside what was given. */
function Lines({ data, compare }: { data: OrderDetail; compare?: boolean }) {
  const { order } = data;
  return (
    <div className="-mx-4 overflow-x-auto border-y border-slate-100">
      <table className="t">
        <thead>
          <tr>
            <th>Medicine</th>
            <th className="num">Pieces</th>
            {compare && <th className="num">List price</th>}
            <th className="num">Given</th>
            <th className="num" title="On the shelf, less what orders placed before this one hold">
              Free
            </th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link
                  to={`/medicines/${item.medicineId}`}
                  className="font-semibold hover:underline"
                >
                  {item.medicine}
                </Link>
                <div className="text-xs text-ink-2">
                  {item.free ? "Free" : `${item.priceLabel} price`}
                  {item.reason && item.reason !== "Free" ? ` · ${item.reason}` : ""}
                </div>
              </td>
              <td className="num">
                {count(item.qty)}
                {inPacks(item.qty, item.packSize) && (
                  <div className="text-xs text-ink-2">{inPacks(item.qty, item.packSize)}</div>
                )}
              </td>
              {compare && (
                <td className="num whitespace-nowrap text-ink-2">{peso(item.listPrice)}</td>
              )}
              <td
                className={`num whitespace-nowrap ${item.unitPrice < item.listPrice ? "font-semibold text-amber-700" : ""}`}
              >
                {peso(item.unitPrice)}
              </td>
              <td
                className={`num ${item.inStock < item.qty ? "font-semibold text-bad" : "text-emerald-700"}`}
              >
                {count(item.inStock)}
              </td>
              <td className="num font-semibold whitespace-nowrap">{peso(item.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.deliveryFee > 0 && (
        <div className="flex items-center justify-end gap-6 border-t border-slate-100 px-4 py-2 text-[13px] text-ink-2">
          <span>Delivery fee</span>
          <span className="tabular-nums">{peso(order.deliveryFee)}</span>
        </div>
      )}
    </div>
  );
}

/** Papers of some kinds: each with what it is for, its files, and adding one. */
function Papers({ data, kinds }: { data: OrderDetail; kinds: PaperKind[] }) {
  const queries = useQueryClient();
  const [uploading, setUploading] = useState<PaperKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { order, can } = data;
  const mayAdd = (kind: string) =>
    kind === "payment_proof" ? can.addProof : kind === "dr" ? can.addDr : can.addPaper;
  const rows = data.paperList.filter((row) => kinds.includes(row.kind));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-semibold text-slate-600">Papers</div>
      {rows.map((row) => {
        const onFile = data.papers.filter((paper) => paper.kind === row.kind);
        return (
          <div key={row.kind} className="rounded-xl border border-slate-200 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold">{row.label}</div>
                {row.why && (
                  <div
                    className={`text-xs ${row.needed && !row.onFile ? "text-amber-700" : "text-ink-2"}`}
                  >
                    {row.why}
                  </div>
                )}
              </div>
              {mayAdd(row.kind) && (
                <label
                  className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 ${uploading ? "pointer-events-none opacity-50" : ""}`}
                >
                  <Camera size={15} aria-hidden="true" />{" "}
                  {uploading === row.kind
                    ? "Uploading…"
                    : onFile.length
                      ? "Add another"
                      : "Add photo"}
                  <input
                    type="file"
                    accept={PAPER_ACCEPT}
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setUploading(row.kind);
                      try {
                        await uploadPaper(order.id, row.kind, file);
                        setProblem(null);
                      } catch (error) {
                        setProblem(
                          error instanceof Error
                            ? error.message
                            : "That paper didn't upload. Try again.",
                        );
                      } finally {
                        setUploading(null);
                        await queries.invalidateQueries({ queryKey: ["orders"] });
                      }
                    }}
                  />
                </label>
              )}
            </div>
            {onFile.map((paper) => (
              <div
                key={paper.id}
                className="mt-2 flex items-center gap-3 rounded-lg bg-slate-50 px-2 py-1.5"
              >
                {paper.mime.startsWith("image/") ? (
                  <a
                    href={`/api/papers/${paper.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                  >
                    <img
                      src={`/api/papers/${paper.id}`}
                      alt={paper.name}
                      className="size-10 rounded-md object-cover"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-slate-500">
                    <FileText size={18} aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/papers/${paper.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-[13px] font-semibold hover:underline"
                  >
                    {paper.name}
                  </a>
                  <div className="text-xs text-ink-2">
                    {paper.by} · {timeLabel(paper.at)}
                  </div>
                </div>
                {mayAdd(paper.kind) && (
                  <button
                    type="button"
                    aria-label={`Remove ${paper.name}`}
                    onClick={async () => {
                      try {
                        await api(`/api/papers/${paper.id}/remove`, { method: "POST" });
                      } catch (error) {
                        setProblem(
                          error instanceof Error
                            ? error.message
                            : "That paper couldn't be removed.",
                        );
                      }
                      await queries.invalidateQueries({ queryKey: ["orders"] });
                    }}
                    className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
      <Problem message={problem} />
    </div>
  );
}

// ---------------------------------------------------------------- the steps

function PlacedStep({ data, next }: { data: OrderDetail; next: () => void }) {
  const { order } = data;
  return (
    <StepPanel
      number={1}
      title="What was ordered"
      footer={<NextButton label="Next: Management check" onClick={next} />}
    >
      <Lines data={data} />
      <Facts
        rows={[
          ["MedRep", order.medrep],
          ["Placed by", order.raisedBy],
          ["Division", order.division],
          ["Sub-division", order.subDivision],
          ["Payment terms", order.paymentTerm],
          ["Channel", order.channel],
          ["Area", order.area],
          ["Customer's PO", order.customerPo],
          ["Doctor", order.doctor],
          ["Invoicing from", order.invoiceFromLabel],
          ["Wanted by", order.expectedOn ? dayLabel(order.expectedOn) : null],
          ["Note", order.note],
        ]}
      />
      <Papers data={data} kinds={["po", "prescription", "gl"]} />
    </StepPanel>
  );
}

function ManagementStep({
  data,
  act,
  onAsk,
  next,
}: {
  data: OrderDetail;
  act: ReturnType<typeof useOrderAction>;
  onAsk: (action: OrderAction) => void;
  next: () => void;
}) {
  const { order, can } = data;
  const [warehouse, setWarehouse] = useState("");
  // Management decides here whether Finance checks the order too.
  const [finance, setFinance] = useState(data.order.financeCheck);
  const waiting = order.status === "pending_approval";
  // Management completes what the MedRep sent before approving it.
  const completes = can.approve || (can.resume && order.heldRole === "management");
  return (
    <StepPanel
      number={2}
      title="Management check"
      footer={
        order.approvedAt ? <NextButton label="Next: Finance check" onClick={next} /> : undefined
      }
    >
      {order.approvedAt ? (
        order.approvedBy ? (
          <Fact shape="done" note={short(order.approvedAt)}>
            <b>Approved</b> by {order.approvedBy}
            {order.warehouse ? ` · ships from ${order.warehouse}` : ""}
          </Fact>
        ) : (
          <Fact shape="skipped" note="no discount, no credit">
            <b>Not needed</b> · it went straight on
          </Fact>
        )
      ) : waiting ? (
        <Fact shape="now">
          <b>Waiting for Management</b>
        </Fact>
      ) : order.status === "draft" ? (
        <Fact shape="stopped">
          <b>Sent back</b> · {order.flagReason ?? "fix it and place it again"}
        </Fact>
      ) : null}
      {data.findings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          {data.findings.map((finding) => (
            <li key={finding.text} className="flex gap-2">
              <TriangleAlert
                size={15}
                className="mt-0.5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>{finding.text}</span>
            </li>
          ))}
        </ul>
      )}
      <Lines data={data} compare />
      {completes && <CompleteDetails data={data} />}
      {can.approve && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">
            Ships from
            <select
              className={`${INPUT} w-56`}
              value={warehouse}
              onChange={(event) => setWarehouse(event.target.value)}
            >
              <option value="">Main (the default)</option>
              {data.warehouses.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
          {!order.leadId && (
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700">
              <input
                type="checkbox"
                checked={finance}
                onChange={(event) => setFinance(event.target.checked)}
              />
              Finance checks it too
            </label>
          )}
          <Button
            variant="primary"
            disabled={act.busy}
            onClick={() =>
              act.act(order.id, "approve", {
                warehouseId: warehouse ? Number(warehouse) : null,
                finance: order.leadId ? undefined : finance,
              })
            }
          >
            <CircleCheck size={16} aria-hidden="true" /> Approve
          </Button>
          {can.send_back && (
            <Button disabled={act.busy} onClick={() => onAsk("send_back")}>
              <Undo2 size={16} aria-hidden="true" /> Send back
            </Button>
          )}
          {can.reject && (
            <Button variant="danger" disabled={act.busy} onClick={() => onAsk("reject")}>
              <CircleX size={16} aria-hidden="true" /> Reject
            </Button>
          )}
        </div>
      )}
    </StepPanel>
  );
}

/** What the MedRep sent, for Management to complete before approving: the Division and
 *  Sub-division, the Payment Terms, who receives it and where, the day, the PO, the company that
 *  bills it and the remarks. */
function CompleteDetails({ data }: { data: OrderDetail }) {
  const { order } = data;
  const queries = useQueryClient();
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState({
    division: order.division ?? "",
    subDivision: order.subDivision ?? "",
    paymentTerm: order.paymentTerm ?? "",
    receiver: order.receiver ?? "",
    receiverPhone: order.receiverPhone ?? "",
    deliveryAddress: order.deliveryAddress ?? "",
    expectedOn: order.expectedOn ?? "",
    customerPo: order.customerPo ?? "",
    invoiceFrom: order.invoiceFrom as string,
    note: order.note ?? "",
  });
  const set = (key: keyof typeof value, to: string) => {
    setSaved(false);
    setValue({ ...value, [key]: to });
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await action.run(async () => api(`/api/orders/${order.id}/details`, { body: value }))) {
      setSaved(true);
      await queries.invalidateQueries({ queryKey: ["orders"] });
    }
  }
  const input = (
    key: keyof typeof value,
    label: string,
    more: { list?: string; type?: string; wide?: boolean; placeholder?: string } = {},
  ) => (
    <label className={`flex flex-col gap-1 ${more.wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[12px] font-semibold text-slate-600">{label}</span>
      <input
        type={more.type ?? "text"}
        list={more.list}
        value={value[key]}
        placeholder={more.placeholder}
        onChange={(event) => set(key, event.target.value)}
        className={INPUT}
      />
      {action.at(key) && <span className="text-xs text-rose-700">{action.at(key)}</span>}
    </label>
  );
  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
    >
      <div className="text-[13px] font-semibold text-ink">Complete the order</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-slate-600">Division</span>
          <select
            value={value.division}
            onChange={(event) =>
              setValue({ ...value, division: event.target.value, subDivision: "" })
            }
            className={INPUT}
          >
            <option value="">-- Not set --</option>
            {DIVISIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {input("subDivision", "Sub-division", { list: "complete-sub-divisions" })}
        {input("paymentTerm", "Payment terms", {
          list: "complete-payment-terms",
          placeholder: "e.g. PDC 30, NET 30, COD",
        })}
        {input("expectedOn", "Expected shipment date", { type: "date" })}
        {input("receiver", "Receiver")}
        {input("receiverPhone", "Receiver's contact")}
        {input("deliveryAddress", "Delivery address", { wide: true })}
        {input("customerPo", "Customer's PO")}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-slate-600">Invoicing from</span>
          <select
            value={value.invoiceFrom}
            onChange={(event) => set("invoiceFrom", event.target.value)}
            className={INPUT}
          >
            <option value="2mg">2MG Inc.</option>
            <option value="getmeds">GetMeds Philippines Inc.</option>
          </select>
        </label>
        {input("note", "Customer remarks", { wide: true })}
      </div>
      <datalist id="complete-sub-divisions">
        {(SUB_DIVISIONS[value.division] ?? []).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="complete-payment-terms">
        {PAYMENT_TERMS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <Problem message={action.general(Object.keys(value))} />
      <div className="flex items-center gap-3">
        <Button type="submit" small disabled={action.busy}>
          {action.busy ? "Saving…" : "Save the details"}
        </Button>
        {saved && <span className="text-[13px] font-medium text-emerald-700">Saved.</span>}
      </div>
    </form>
  );
}

function FinanceStep({
  data,
  money,
  next,
}: {
  data: OrderDetail;
  money: ReturnType<typeof useMoney>;
  next: () => void;
}) {
  const { order, can } = data;
  const [confirming, setConfirming] = useState(false);
  const invoice = data.money.invoice;
  const checked = data.stages.find((stage) => stage.key === "finance_verified")?.at ?? null;
  const by = data.events.findLast((event) => event.stage === "finance_verified")?.by;
  const skipped = Boolean(order.leadId) && !checked && Boolean(invoice);
  return (
    <StepPanel
      number={3}
      title="Finance check"
      footer={
        checked || skipped ? <NextButton label="Next: Pack & ship" onClick={next} /> : undefined
      }
    >
      {skipped ? (
        <Fact shape="skipped" note="Finance sees every payment">
          <b>Not needed</b> · the Online desk takes this order's money
        </Fact>
      ) : checked ? (
        <Fact shape="done" note={short(checked)}>
          <b>Checked</b> by {by ?? "Finance"}
        </Fact>
      ) : order.status === "finance_check" ? (
        <Fact shape="now">
          <b>Paid in advance:</b> check the slip and the money in the account
        </Fact>
      ) : order.status === "ready_for_invoice" ? (
        <Fact shape="now">
          <b>
            {order.paymentTerms === "days"
              ? `Credit: pays ${order.paymentDays} days after the invoice`
              : "Cash on delivery"}
          </b>{" "}
          · make the invoice
        </Fact>
      ) : (
        <Fact shape="later">
          <b>After Management's approval</b>
        </Fact>
      )}
      {data.findings.length > 0 && !checked && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          {data.findings.map((finding) => (
            <li key={finding.text} className="flex gap-2">
              <TriangleAlert
                size={15}
                className="mt-0.5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>{finding.text}</span>
            </li>
          ))}
        </ul>
      )}
      {invoice && (
        <Facts
          rows={[
            [
              "Invoice",
              <Link
                key="i"
                to={`/invoices/${invoice.id}`}
                className="font-semibold text-emerald-700 hover:underline"
              >
                {invoice.code}
              </Link>,
            ],
            ["Made", `${dayLabel(invoice.issuedOn)} · ${invoice.invoiceFromLabel}`],
            ["Due", invoice.terms === "cod" ? "Collected on delivery" : dayLabel(invoice.dueOn)],
          ]}
        />
      )}
      {(can.confirm_payment || can.make_invoice) && (
        <div className="flex flex-wrap gap-2">
          {can.confirm_payment && (
            <Button variant="primary" disabled={money.busy} onClick={() => setConfirming(true)}>
              <Banknote size={16} aria-hidden="true" /> Confirm payment
            </Button>
          )}
          {can.make_invoice && (
            <Button
              variant="primary"
              disabled={money.busy}
              onClick={() => money.send(`/api/finance/orders/${order.id}/invoice`, {})}
            >
              <ReceiptText size={16} aria-hidden="true" /> Make invoice
            </Button>
          )}
        </div>
      )}
      <Papers data={data} kinds={["payment_proof"]} />
      {confirming && (
        <ConfirmPaymentDialog
          orderId={order.id}
          code={order.code}
          customer={order.customer}
          total={order.total}
          onClose={() => setConfirming(false)}
        />
      )}
    </StepPanel>
  );
}

function DispatchStep({
  data,
  ask,
  next,
}: {
  data: OrderDetail;
  ask: (what: NonNullable<DispatchAsk>["what"]) => void;
  next: () => void;
}) {
  const { order, can } = data;
  const me = useMe().data;
  const left = Boolean(order.packedAt) || ["shipped", "completed"].includes(order.status);
  return (
    <StepPanel
      number={4}
      title="Pack & ship"
      footer={
        order.shippedAt || order.status === "completed" ? (
          <NextButton label="Next: Delivered" onClick={next} />
        ) : undefined
      }
    >
      {order.packedAt ? (
        <Fact shape="done" note={short(order.packedAt)}>
          <b>Packed</b> by {order.packedBy} · from {order.warehouse ?? "the main warehouse"}
        </Fact>
      ) : (
        <Fact shape={can.pack ? "now" : "later"}>
          <b>Pack it</b> from {order.warehouse ?? "the main warehouse"}
        </Fact>
      )}
      {order.shippedAt ? (
        <Fact shape="done" note={short(order.shippedAt)}>
          <b>Shipped</b>{" "}
          {order.deliveryMethod === "rider"
            ? `with our rider ${order.rider}`
            : `with ${order.courier ?? "the courier"}${order.tracking ? ` · ${order.tracking}` : ", tracking to follow"}`}{" "}
          · {order.shippedBy}
        </Fact>
      ) : order.status !== "completed" ? (
        <Fact shape={can.ship ? "now" : "later"}>
          <b>Ship it</b> · courier or our rider
        </Fact>
      ) : null}
      {data.picks.length > 0 && (
        <div className="-mx-4 overflow-x-auto border-y border-slate-100">
          <table className="t">
            <thead>
              <tr>
                <th>In the box</th>
                <th>Batch</th>
                <th>Expires</th>
                <th>From</th>
                <th className="num">Pieces</th>
              </tr>
            </thead>
            <tbody>
              {data.picks.map((pick) => (
                <tr key={pick.id}>
                  <td className="font-semibold">{pick.medicine}</td>
                  <td className="font-mono">{pick.batchNo}</td>
                  <td className="whitespace-nowrap">{dayLabel(pick.expiresOn)}</td>
                  <td className="whitespace-nowrap">{pick.warehouse}</td>
                  <td className="num whitespace-nowrap">{count(pick.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.picks.length === 0 && <Lines data={data} />}
      <div className="flex flex-wrap gap-2">
        {can.pack && (
          <Button variant="primary" onClick={() => ask("pack")}>
            <Box size={16} aria-hidden="true" /> Pack
          </Button>
        )}
        {can.ship && (
          <Button variant="primary" onClick={() => ask("ship")}>
            <Truck size={16} aria-hidden="true" /> Ship
          </Button>
        )}
        {can.unpack && (
          <Button onClick={() => ask("unpack")}>
            <PackageOpen size={16} aria-hidden="true" /> Unpack
          </Button>
        )}
        {can.failed && (
          <Button variant="danger" onClick={() => ask("failed")}>
            <Undo2 size={16} aria-hidden="true" /> Didn't reach the customer
          </Button>
        )}
        {order.deliveryMethod === "courier" && me && ["dispatch", "admin"].includes(me.role) && (
          <Button onClick={() => ask("tracking")}>
            {order.tracking ? "Change tracking" : "Add tracking"}
          </Button>
        )}
        {left && me && ["dispatch", "admin", "management"].includes(me.role) && (
          <Link
            to={`/orders/${order.id}/receipt`}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-hover"
          >
            <Printer size={16} aria-hidden="true" /> Delivery receipt
          </Link>
        )}
      </div>
    </StepPanel>
  );
}

function DeliveredStep({
  data,
  ask,
  next,
}: {
  data: OrderDetail;
  ask: (what: NonNullable<DispatchAsk>["what"]) => void;
  next: () => void;
}) {
  const { order, can } = data;
  const delivered = order.status === "completed";
  return (
    <StepPanel
      number={5}
      title="Delivered"
      footer={delivered ? <NextButton label="Next: Paid" onClick={next} /> : undefined}
    >
      {delivered ? (
        <Fact shape="done" note={order.deliveredOn ? dayLabel(order.deliveredOn) : undefined}>
          <b>Delivered</b> · received by {order.receivedBy ?? "the customer"}
          {order.deliveredBy ? ` · marked by ${order.deliveredBy}` : ""}
        </Fact>
      ) : (
        <Fact
          shape={can.deliver ? "now" : "later"}
          note={
            order.shippedAt
              ? order.courier
                ? `${order.courier}${order.tracking ? ` · ${order.tracking}` : ""}`
                : order.rider
                  ? `Rider ${order.rider}`
                  : undefined
              : undefined
          }
        >
          <b>Delivery</b> ·{" "}
          {can.deliver ? "your step" : order.shippedAt ? "on the way" : "after it is shipped"}
        </Fact>
      )}
      <Facts
        rows={[
          ["Receiver", order.receiver],
          ["Receiver's phone", order.receiverPhone],
          ["Address", order.deliveryAddress],
          [
            "How it pays",
            order.paymentTerms === "days"
              ? `Credit · ${order.paymentDays} days`
              : order.paymentTerms === "cod"
                ? "Cash on delivery"
                : "Paid in advance",
          ],
        ]}
      />
      {can.deliver && (
        <div>
          <Button variant="primary" onClick={() => ask("deliver")}>
            <CircleCheck size={16} aria-hidden="true" />{" "}
            {/* Delivered while still packed at the warehouse: the customer picked it up. */}
            {order.status === "packing" ? "Picked up by the customer" : "Mark as delivered"}
          </Button>
        </div>
      )}
      <Papers data={data} kinds={["dr"]} />
    </StepPanel>
  );
}

function PaidStep({ data }: { data: OrderDetail }) {
  const { order, can } = data;
  const [paying, setPaying] = useState(false);
  const invoice = data.money.invoice;
  const proofs = data.papers.filter((paper) => paper.kind === "payment_proof");
  return (
    <StepPanel number={6} title="Paid">
      {!invoice ? (
        <Fact shape="later">
          <b>No invoice yet</b> · it is made once the order is checked
        </Fact>
      ) : (
        <>
          {invoice.status === "paid" ? (
            <Fact shape="done">
              <b>Paid in full</b> · {invoice.code}
            </Fact>
          ) : (
            <Fact
              shape={can.recordPayment ? "now" : "later"}
              note={<InvoiceStatus state={invoice.state} />}
            >
              <b>{peso(invoice.balance)} still owed</b> on {invoice.code}
            </Fact>
          )}
          <dl className="grid grid-cols-3 gap-3 text-[13px]">
            {(
              [
                ["Total", invoice.total],
                ["Received", invoice.paid],
                ["Still owed", invoice.balance],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <dt className="text-xs text-ink-2">{label}</dt>
                <dd className="text-base font-semibold tabular-nums">{peso(value)}</dd>
              </div>
            ))}
          </dl>
          {data.money.payments.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-[13px]">
              {data.money.payments.map((payment) => (
                <li
                  key={payment.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${payment.active ? "" : "text-slate-400"}`}
                >
                  <span>
                    <b className={`tabular-nums ${payment.active ? "" : "line-through"}`}>
                      {peso(payment.amount)}
                    </b>{" "}
                    · {payment.methodLabel}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                    {!payment.active && ` · taken off: ${payment.removedReason}`}
                  </span>
                  <span className="text-[12px] text-slate-500">
                    {dayLabel(payment.paidOn)} · {payment.by}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.money.refunds.length > 0 && (
            <div className="text-[13px] text-ink-2">
              Given back:{" "}
              {data.money.refunds
                .map((refund) => `${peso(refund.amount)} on ${dayLabel(refund.refundedOn)}`)
                .join(", ")}
            </div>
          )}
          {can.recordPayment && (
            <div>
              <Button variant="primary" onClick={() => setPaying(true)}>
                Record payment received
              </Button>
            </div>
          )}
        </>
      )}
      {paying && invoice && (
        <RecordPaymentDialog
          invoiceId={invoice.id}
          code={invoice.code}
          balance={invoice.balance}
          orderId={order.id}
          proofs={proofs}
          onClose={() => setPaying(false)}
        />
      )}
    </StepPanel>
  );
}

// ---------------------------------------------------------------- side

function MoneyCard({ data }: { data: OrderDetail }) {
  const { order } = data;
  const invoice = data.money.invoice;
  const goods = data.items.reduce((sum, item) => sum + item.amount, 0);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <h2 className="mb-2 text-[13px] font-semibold text-ink">Money</h2>
      <dl className="flex flex-col gap-1 text-[13px]">
        {data.items.map((item) => (
          <div key={item.id} className="flex justify-between gap-3">
            <dt className="truncate text-slate-600">
              {item.medicine} × {count(item.qty)}
            </dt>
            <dd className="tabular-nums">{peso(item.amount)}</dd>
          </div>
        ))}
        {order.deliveryFee > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-600">Delivery fee</dt>
            <dd className="tabular-nums">{peso(order.deliveryFee)}</dd>
          </div>
        )}
        <div className="mt-1 flex justify-between gap-3 border-t border-slate-100 pt-1.5 font-semibold">
          <dt>Order total</dt>
          <dd className="tabular-nums">{peso(goods + order.deliveryFee)}</dd>
        </div>
        {order.pointsUsed > 0 && (
          <div className="flex justify-between gap-3 text-emerald-700">
            <dt>{order.pointsUsed.toLocaleString("en-PH")} points</dt>
            <dd className="tabular-nums">−{peso(order.pointsUsed * 100)}</dd>
          </div>
        )}
        {invoice && (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Received</dt>
              <dd className="tabular-nums">{peso(invoice.paid)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-semibold">
              <dt>Still owed</dt>
              <dd
                className={`tabular-nums ${invoice.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}
              >
                {peso(invoice.balance)}
              </dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}

function Activity({ data }: { data: OrderDetail }) {
  const [all, setAll] = useState(false);
  const events = [...data.events].reverse();
  const shown = all ? events : events.slice(0, 8);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <h2 className="mb-2 text-[13px] font-semibold text-ink">Activity</h2>
      <ul className="flex flex-col gap-2.5 text-[13px]">
        {shown.map((event) => (
          <li key={event.id}>
            <div className="text-slate-800">{event.message}</div>
            <div className="text-[11px] text-slate-500">
              {event.by} ({event.byRole}) · {timeLabel(event.at)}
            </div>
          </li>
        ))}
      </ul>
      {events.length > 8 && (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="mt-2 text-xs font-semibold text-emerald-700 hover:underline"
        >
          {all ? "Show less" : `Show all ${events.length}`}
        </button>
      )}
    </section>
  );
}
