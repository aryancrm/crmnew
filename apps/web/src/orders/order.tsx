// One order, laid out like an Online case (online/lead.tsx): who it is for at the top, the order's
// journey under it (placed → Management → Finance → packed and shipped → delivered → paid, each
// with who and when), then the steps on the left with the money and the activity under them,
// and the step being worked on the right. Management, Finance and Dispatch each open on their
// own step; the step open is in the address (?step=).

import type { OrderAction, OrderDetail } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, CirclePause, CircleX, FileText, Hourglass, MapPin, PencilLine, Phone, Play, RotateCcw, TriangleAlert, Undo2, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { DISPATCH_HOLDS, type DispatchAsk, DispatchDialogs } from "../dispatch/parts";
import { InvoiceStatus, useMoney } from "../finance/parts";
import { ReasonDialog, StatusPill, shortSpan, useOrderAction } from "./parts";
import { AskUpBox } from "./asks";
import { OrderReturnsBox, RefundButton } from "./returns";
import { SendToCustomer } from "./send-update";
import { OrderVersions } from "./versions";
import { Button, dayLabel, PageState, Pill, Problem, peso, timeLabel, useLook } from "../ui";
import { DeliveredStep } from "./steps/delivered";
import { DispatchStep } from "./steps/dispatch";
import { FinanceStep } from "./steps/finance";
import { NextButton, type Shape, short, StepPanel } from "./steps/frame";
import { Lines } from "./steps/lines";
import { type CheckKey, checkLabel, CHECKS, checkStates, ManagementStep } from "./steps/management";
import { PaidStep } from "./steps/paid";
import { Documents, Papers } from "./steps/papers";
import { Activity, MoneyCard } from "./steps/side";

type StepKey = "placed" | "management" | "finance" | "dispatch" | "delivered" | "paid" | "proof";

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
    proof: false,
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
    proof: false,
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
  const me = useMe().data;
  const [asking, setAsking] = useState<OrderAction | null>(null);
  const [dispatching, setDispatching] = useState<DispatchAsk>(null);
  // Management's and Finance's page keeps the top short: the rest of the details on a press.
  const [moreOpen, setMoreOpen] = useState(false);
  // Management's two looks of its check: step by step, or everything on one page.
  const [pageLook, pickPageLook] = useLook("crm:order-look", ORDER_LOOKS);
  const data = query.data;
  if (!data) return <PageState query={query} what="this order" />;
  const { order, can } = data;
  const { steps, current } = stepsOf(data);
  const picked = params.get("step") as StepKey | null;
  // Each desk opens on its own step when it has one, else where the order stands.
  const opened: StepKey =
    picked && (steps.some((item) => item.key === picked) || picked === "proof")
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
  // Each desk sees its own steps at the side (Aryan): Management what it checks, Finance the
  // money, Dispatch the packing and the handover. Everyone else, the order's whole road.
  // Whoever approves this order (Management, or a PAP order's head) sees the checks.
  const desk =
    me?.role === "management" || me?.role === "admin" || can.approve
      ? "management"
      : me?.role === "finance"
        ? "finance"
        : me?.role === "dispatch"
          ? "dispatch"
          : null;
  const checking = desk === "management" && (!picked || picked === "management");
  const glance = checking && pageLook === "glance";
  const states = checkStates(data);
  const askedCheck = params.get("check") as CheckKey | null;
  const check: CheckKey = CHECKS.some((item) => item.key === askedCheck)
    ? (askedCheck as CheckKey)
    : (CHECKS.find((item) => item.key !== "approve" && !states[item.key].ok)?.key ??
      (order.status === "pending_approval" ? "approve" : "papers"));
  const ownStep = (key: StepKey) =>
    !desk ||
    (desk === "management"
      ? key === "management"
      : desk === "finance"
        ? key === "finance" || key === "paid"
        : key === "dispatch" || key === "delivered");
  // Finance's and Dispatch's own steps, from the order's road.
  const deskKeys: StepKey[] =
    desk === "finance"
      ? ["proof", "finance", "paid"]
      : desk === "dispatch"
        ? ["dispatch", "delivered"]
        : [];
  const railNumber = (key: StepKey) =>
    deskKeys.length && deskKeys.includes(key) ? deskKeys.indexOf(key) + 1 : undefined;
  const proofOk =
    !data.paperList.find((row) => row.kind === "payment_proof")?.needed ||
    data.papers.some((paper) => paper.kind === "payment_proof");
  const railSteps = deskKeys.length
    ? deskKeys.map((key, index) =>
        key === "proof"
          ? {
              key,
              number: index + 1,
              label: "Payment proof",
              shape: (proofOk ? "done" : "now") as Shape,
              who: proofOk ? "On file or not needed" : "Pays in advance: check the slip",
              mine: !proofOk,
            }
          : {
              ...(steps.find((item) => item.key === key) ?? (steps[0] as (typeof steps)[number])),
              number: index + 1,
            },
      )
    : steps;
  const openCheck = (key: CheckKey) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        next.set("step", "management");
        next.set("check", key);
        return next;
      },
      { replace: true },
    );
  const nextOf = (key: StepKey) =>
    steps[steps.findIndex((item) => item.key === key) + 1]?.key ?? null;
  // Cash on delivery still open: Delivered asks how much came in and who has it (19 Nov).
  const codLeft =
    data.money.invoice?.terms === "cod" && data.money.invoice.status === "open" ? data.money.invoice.balance : null;
  const ask = (what: NonNullable<DispatchAsk>["what"]) =>
    setDispatching({
      what,
      orderId: order.id,
      code: order.code,
      ...(what === "deliver" ? { collect: codLeft, carrier: order.rider ?? order.courier } : {}),
    });
  // Management's last change before approving: what it added, gave free or repriced.
  const changed = data.events.findLast((event) =>
    event.message.includes("changed the order before approving it"),
  );
  const changedBy = changed
    ? {
        by: changed.by,
        at: changed.at,
        what: changed.message.replace(/^.*changed the order before approving it:\s*/, ""),
      }
    : null;
  const pays =
    order.paymentTerms === "days"
      ? order.paymentTerm?.startsWith("Pays by ")
        ? `Pays by ${dayLabel(order.paymentTerm.slice(8))}`
        : `Pays ${order.paymentDays} days after delivery`
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
    // Management says why it can go on and from where (the hub's Resume); Finance and Dispatch
    // lift their own holds with a press.
    { action: "resume", label: "Take off hold", icon: Play, reason: data.resumeTo.length > 0 },
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
    { action: "restore", label: "Restore", icon: RotateCcw, reason: true },
  ];
  const shownOthers = others.filter((item) => can[item.action]);

  // The order's road, each stop with who and when.
  const journey = (
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
                // Each desk opens only its own steps: Management doesn't tick Finance's or Dispatch's.
                disabled={!ownStep(item.key)}
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
                  className={`mt-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${item.took.open ? "bg-amber-500 text-white" : "text-slate-500"}`}
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
  );
  const otherButtons = shownOthers.length > 0 && (
    <>
      {shownOthers.map((item) => (
        <Button
          key={item.action}
          small
          variant={item.danger ? "danger" : "plain"}
          disabled={act.busy}
          onClick={() => (item.reason ? setAsking(item.action) : act.act(order.id, item.action))}
        >
          <item.icon className="size-3.5" aria-hidden="true" /> {item.label}
        </Button>
      ))}
      {can.waitStock && (
        <Button
          small
          disabled={act.busy}
          title="Hold it until what it needs is on the shelf; you are told when it comes in"
          onClick={() => act.act(order.id, "hold", { stock: true })}
        >
          <Hourglass className="size-3.5" aria-hidden="true" /> Wait for stock
        </Button>
      )}
    </>
  );

  // The hub's order page (Aryan, 17 Nov: simple like the hub): who and what on top, the step
  // that is this person's to do under it, then the tabs everyone reads.
  const tabs = [
    ["timeline", "Timeline"],
    ["items", "Items"],
    ["payment", "Payment"],
    ["dispatch", "Dispatch"],
    ["documents", "Documents"],
  ] as const;
  type Tab = (typeof tabs)[number][0];
  const tab: Tab = tabs.some(([key]) => key === params.get("tab"))
    ? (params.get("tab") as Tab)
    : "items";
  const pickTab = (key: Tab) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        next.set("tab", key);
        return next;
      },
      { replace: true },
    );
  // Management's and Finance's own page (Aryan, 18 Nov): the top short, then, as on the Leads
  // case, its steps at the side (each ticked once fine), the one picked open beside them.
  const deskView = desk === "management" || desk === "finance";
  // Everyone else (the MedRep, a lead, the CEO, Dispatch) reads the same page (Aryan, 19 Nov: "the
  // hub's copy, where is ours?"): the order's road at the side, the step picked open beside it.
  const roadView = !deskView;
  const shortTop = true;
  const atMyDesk =
    (desk === "management" && (order.status === "pending_approval" || order.heldRole === "management")) ||
    (desk === "finance" && (["finance_check", "ready_for_invoice"].includes(order.status) || order.heldRole === "finance"));
  const tabsBox = (
      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div role="tablist" aria-label="About this order" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => pickTab(key)}
              className={`-mb-px border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap ${tab === key ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === "timeline" && (
            <div className="flex flex-col gap-4">
              {journey}
              <Activity data={data} />
            </div>
          )}
          {tab === "items" && <Lines data={data} compare={desk === "management"} />}
          {tab === "payment" && (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <MoneyCard data={data} />
              <PaidStep data={data} />
            </div>
          )}
          {tab === "dispatch" &&
            (["ready_for_dispatch", "packing", "shipped", "completed"].includes(order.status) ? (
              <div className="flex flex-col gap-4">
                <DispatchStep data={data} ask={ask} next={() => pickTab("dispatch")} />
                {(order.status === "shipped" || order.status === "completed") && (
                  <DeliveredStep data={data} ask={ask} next={() => pickTab("payment")} />
                )}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-ink-2">
                Not with Dispatch yet: it is {order.statusLabel.toLowerCase()}.
              </div>
            ))}
          {tab === "documents" && (
            <div className="flex flex-col gap-4">
              <Documents data={data} />
              <OrderReturnsBox orderId={order.id} />
            </div>
          )}
        </div>
      </section>
  );
  const detail = (label: string, value: ReactNode) => (
    <div className="min-w-0">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-ink">{value || "—"}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-screen-xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-brand"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Back
      </button>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-ink-2">Order ID</div>
            <h1 className="text-2xl font-bold tracking-tight text-brand">{order.code}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <Link
                to={`/customers/${order.customerId}`}
                className="font-medium text-ink hover:text-brand"
              >
                {order.customer}
              </Link>
              <span>·</span>
              <span className="rounded bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-dark">
                {order.customerKind[0]?.toUpperCase() + order.customerKind.slice(1)}
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {pays}
              </span>
              {order.via && (
                <Link
                  to={`/leads/${order.leadId}`}
                  className="rounded bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-violet-700"
                  title={`Came in through the Online desk: case ${order.via.code}`}
                >
                  Online · {order.via.source}
                </Link>
              )}
              {order.relief && (
                <span
                  className="rounded bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-dark"
                  title="20% off and no VAT on their own medicines (or a lower promo without VAT, never both)"
                >
                  {order.relief.kind === "pwd" ? "PWD" : "Senior citizen"}
                  {order.relief.idNo ? ` · ${order.relief.idNo}` : ""}
                </span>
              )}
              {order.customerReview === "to_review" && order.customerKind !== "patient" && (
                <Pill tone="warn">New customer</Pill>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-2">
              MedRep: {order.medrep} · Placed {timeLabel(order.submittedAt ?? order.createdAt)}
              {order.raisedBy !== order.medrep ? ` by ${order.raisedBy}` : ""}
              {order.channel ? ` · ${order.channel}` : ""}
              {order.leadId && (
                <>
                  {" · "}
                  <Link to={`/leads/${order.leadId}`} className="font-medium text-brand hover:underline">
                    From the Online case{order.via ? ` ${order.via.code}` : ""}
                  </Link>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                to={`/orders/${order.id}/sales-order`}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-tint"
              >
                <FileText className="size-3.5" aria-hidden="true" /> Sales order
              </Link>
              <SendToCustomer orderId={order.id} small />
              <RefundButton orderId={order.id} />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <div className="flex items-center gap-3">
              <StatusPill status={order.status} label={order.statusLabel} />
              <span className="text-2xl font-bold tabular-nums text-ink">{peso(order.total)}</span>
            </div>
            {data.money.invoice && <InvoiceStatus state={data.money.invoice.state} />}
          </div>
        </div>

        {shortTop && (
          // Every order page (Aryan, 19 Nov: "ours, not the hub's"): the facts that matter in one
          // line; the rest on a press.
          <>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-[13px] text-ink-2">
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{order.deliveryAddress ?? "No address"}</span>
              </span>
              {order.warehouse && <span>Ships from {order.warehouse}</span>}
              <span>
                Invoice{" "}
                {data.money.invoice ? (
                  <Link to={`/invoices/${data.money.invoice.id}`} className="font-medium text-brand hover:underline">
                    {data.money.invoice.code}
                  </Link>
                ) : (
                  "made when approved"
                )}
              </span>
              {order.division && <span>Division {order.division}</span>}
              {order.customerPo && <span>PO {order.customerPo}</span>}
              {order.doctor && <span>Dr. {order.doctor.replace(/^Dr\.?\s*/i, "")}</span>}
              <button
                type="button"
                onClick={() => setMoreOpen(!moreOpen)}
                className="ml-auto inline-flex items-center gap-1 font-semibold text-brand hover:underline"
              >
                {moreOpen ? "Fewer details" : "More details"}
                <ChevronDown className={`size-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </div>
            {order.note && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
                <b>Customer remarks:</b> {order.note}
              </div>
            )}
          </>
        )}
        {(!shortTop || moreOpen) && (
          <>
        <div className="mt-5 grid gap-5 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Delivery address</div>
            <div className="mt-1 text-sm text-ink">{order.deliveryAddress ?? "—"}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-ink-2">
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3.5" aria-hidden="true" /> {order.receiver ?? order.customer}
              </span>
              {order.receiverPhone && (
                <a href={`tel:${order.receiverPhone}`} className="inline-flex items-center gap-1 hover:text-brand">
                  <Phone className="size-3.5" aria-hidden="true" /> {order.receiverPhone}
                </a>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Invoice</div>
            <div className="mt-1 text-sm text-ink">
              {data.money.invoice ? (
                <Link to={`/invoices/${data.money.invoice.id}`} className="font-medium text-brand hover:underline">
                  {data.money.invoice.code}
                </Link>
              ) : (
                <span className="text-ink-2">Made when Management approves</span>
              )}
            </div>
            {order.warehouse && (
              <div className="mt-1 inline-flex items-center gap-1 text-xs text-ink-2">
                <MapPin className="size-3.5" aria-hidden="true" /> Ships from {order.warehouse}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Order details</div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {detail("Division", order.division)}
            {detail("Sub-division", order.subDivision)}
            {detail("Payment terms", order.paymentTerm ?? pays)}
            {detail("Customer PO", order.customerPo)}
            {detail("Doctor", order.doctor)}
            {detail("Invoicing from", order.invoiceFromLabel)}
            {detail("Expected", order.expectedOn ? dayLabel(order.expectedOn) : null)}
            {detail("Raised by", order.raisedBy)}
            {detail("Source", order.source)}
            {detail("Customer remarks", order.note)}
            {order.stockReason && detail("Goes on though short", order.stockReason)}
          </div>
        </div>

          </>
        )}

        <OrderVersions versions={data.versions} />
        {changedBy && !data.versions.some((version) => version.kind === "changed") && (
          // Changed before versions were kept: Management's words from the order's history.
          <div className="mt-3 flex gap-2.5 rounded-lg bg-slate-50 px-3.5 py-3 text-sm text-ink">
            <PencilLine className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <div className="min-w-0">
              <b>Changed by {changedBy.by}</b> <span className="text-ink-2">· {short(changedBy.at)}</span>
              <div className="mt-0.5">{changedBy.what}</div>
            </div>
          </div>
        )}
        {order.status === "draft" && (order.sentBackReason ?? order.flagReason) ? (
          // Sent back: Management's reason in the hub's yellow band, and the MedRep's two answers.
          <div className="mt-4 flex flex-col gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <b>
                Sent back{order.sentBackBy ? ` by ${order.sentBackBy}` : ""}
                {order.sentBackAt ? ` · ${timeLabel(order.sentBackAt)}` : ""}
                {order.sentBackCount > 1 ? ` · ${order.sentBackCount} times` : ""} — What to fix:
              </b>{" "}
              {order.sentBackReason ?? order.flagReason}
            </div>
            {can.resubmit && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  to={`/orders/${order.id}/fix`}
                  className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
                >
                  Fix and resubmit
                </Link>
                <button
                  type="button"
                  onClick={() => setAsking("resubmit")}
                  className="inline-flex items-center rounded-md border border-brand/40 bg-white px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-tint"
                >
                  ↩ Resubmit as it is
                </button>
              </div>
            )}
          </div>
        ) : order.flagReason ? (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center">
            <span className="flex flex-1 gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <b>{order.statusLabel}:</b> {order.flagReason}
                {data.waitingStock && (
                  // Waiting for stock: crmnew watches the shelf and tells whoever held it.
                  <span className="mt-1 block text-xs">
                    Waiting since {timeLabel(data.waitingStock.since)}
                    {data.waitingStock.by ? ` · held by ${data.waitingStock.by}` : ""}.{" "}
                    {data.waitingStock.short.length === 0 ? (
                      <b className="text-good">Stock is back: everything is on the shelf now. Take it off hold.</b>
                    ) : (
                      // Said only when it changed since the hold (the reason says what was short then).
                      (() => {
                        const now = data.waitingStock.short
                          .map((one) => `${one.name} (needs ${one.need.toLocaleString("en-PH")}, ${one.free.toLocaleString("en-PH")} free)`)
                          .join("; ");
                        return order.flagReason?.includes(now) ? null : <>Short now: {now}.</>;
                      })()
                    )}
                  </span>
                )}
                {order.holdProofs.length > 0 && (
                  // Finance's screenshots with the hold, for the MedRep to see what it saw.
                  <span className="mt-2 flex flex-wrap gap-2">
                    {order.holdProofs.map((shot) => (
                      <a
                        key={shot.id}
                        href={`/api/papers/${shot.id}`}
                        target="_blank"
                        rel="noreferrer"
                        title={shot.name}
                        className="block overflow-hidden rounded-md border border-slate-200 bg-white hover:border-slate-400"
                      >
                        <img src={`/api/papers/${shot.id}`} alt={shot.name} loading="lazy" className="h-16 w-20 object-cover" />
                      </a>
                    ))}
                  </span>
                )}
              </span>
            </span>
            {can.answer && (
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setAsking("answer")}
                  className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
                >
                  ↩ Re-submit
                </button>
                {can.cancel && (
                  <button
                    type="button"
                    onClick={() => setAsking("cancel")}
                    className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    Cancel order
                  </button>
                )}
              </span>
            )}
          </div>
        ) : null}
        {order.status !== "draft" && order.sentBackCount > 0 && order.sentBackReason && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm text-ink">
            <b>
              Sent back{order.sentBackCount > 1 ? ` ${order.sentBackCount} times` : ""}
              {order.sentBackBy ? ` by ${order.sentBackBy}` : ""}:
            </b>{" "}
            {order.sentBackReason}
            {order.reply && (
              <div className="mt-1">
                <b>{order.medrep}'s answer:</b> {order.reply}
              </div>
            )}
          </div>
        )}
      </section>

      {deskView && (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[21rem_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <nav aria-label="Steps" className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              <div className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
                {desk === "management" ? "Management checks" : "Finance steps"}
              </div>
              {desk === "management"
                ? CHECKS.map((item, index) => {
                    const on = item.key === check && checking;
                    const state = states[item.key];
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-current={on ? "step" : undefined}
                        onClick={() => openCheck(item.key)}
                        className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left text-[13px] transition-colors ${on ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-950" : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"}`}
                      >
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            item.key === "approve" && order.approvedAt
                              ? "bg-emerald-600 text-white"
                              : item.key === "approve"
                                ? "bg-white text-emerald-800 ring-2 ring-emerald-500"
                                : state.ok
                                  ? "bg-emerald-600 text-white"
                                  : "bg-amber-400 text-white"
                          }`}
                        >
                          {item.key === "approve" && !order.approvedAt ? (
                            index + 1
                          ) : state.ok || item.key === "approve" ? (
                            <Check className="size-3.5" />
                          ) : (
                            "!"
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{checkLabel(item.key, data)}</span>
                          <span
                            className={`block truncate text-[11px] font-normal ${state.ok || item.key === "approve" ? "text-slate-500" : "font-semibold text-amber-700"}`}
                          >
                            {item.key === "approve"
                              ? order.approvedAt
                                ? `Approved${order.approvedBy ? ` by ${order.approvedBy}` : ""}`
                                : can.approve
                                  ? "The last step: approve it"
                                  : order.status === "pending_approval"
                                    ? "Waiting"
                                    : "—"
                              : state.note}
                          </span>
                        </span>
                      </button>
                    );
                  })
                : railSteps.map((item) => {
                    const on = item.key === opened;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-current={on ? "step" : undefined}
                        onClick={() => open(item.key)}
                        className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left text-[13px] transition-colors ${on ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-950" : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"}`}
                      >
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            item.shape === "done" || item.shape === "skipped"
                              ? "bg-emerald-600 text-white"
                              : item.shape === "stopped"
                                ? "bg-rose-100 text-rose-700"
                                : on || item.shape === "now"
                                  ? "bg-white text-emerald-800 ring-2 ring-emerald-500"
                                  : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {item.shape === "done" || item.shape === "skipped" ? <Check className="size-3.5" /> : item.number}
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
              {otherButtons && (
                <div className="mt-1 flex flex-wrap gap-1.5 border-t border-slate-100 px-1 pt-2">{otherButtons}</div>
              )}
            </nav>
            {/* The order's timeline up here, beside its checks (Aryan, 19 Nov), not at the foot. */}
            <Activity data={data} />
            <MoneyCard data={data} />
          </div>
          <div className="min-w-0">
            {desk === "management" ? (
              <ManagementStep
                data={data}
                act={act}
                onAsk={setAsking}
                next={() => openCheck("approve")}
                check={check}
                onCheck={openCheck}
                states={states}
                autoApprove={params.get("approve") === "1"}
              />
            ) : opened === "proof" ? (
              <StepPanel
                number={1}
                title="Payment proof"
                footer={<NextButton label="Next: Finance check" onClick={() => open("finance")} />}
              >
                <Papers data={data} kinds={["payment_proof", "po", "other"]} />
              </StepPanel>
            ) : opened === "paid" ? (
              <PaidStep data={data} n={railNumber("paid")} />
            ) : (
              <FinanceStep data={data} money={money} next={() => open("paid")} n={railNumber("finance")} />
            )}
            <div className="mt-3">
              <Problem message={problem?.message} />
            </div>
            {/* While the order is this desk's to check, its steps cover it all (Aryan, 19 Nov: the
                tabs below repeated them); once it has moved on, they show where it went. */}
            {!atMyDesk && tabsBox}
          </div>
        </div>
      )}
      {roadView && (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[21rem_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <nav aria-label="Steps" className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              <div className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
                {desk === "dispatch" ? "Dispatch steps" : "Where the order is"}
              </div>
              {railSteps.map((item) => {
                const on = item.key === opened;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={on ? "step" : undefined}
                    onClick={() => open(item.key)}
                    className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left text-[13px] transition-colors ${on ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-950" : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"}`}
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        item.shape === "done" || item.shape === "skipped"
                          ? "bg-emerald-600 text-white"
                          : item.shape === "stopped"
                            ? "bg-rose-100 text-rose-700"
                            : on || item.shape === "now"
                              ? "bg-white text-emerald-800 ring-2 ring-emerald-500"
                              : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.shape === "done" || item.shape === "skipped" ? <Check className="size-3.5" /> : item.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      <span
                        className={`block truncate text-[11px] font-normal ${item.mine && item.shape !== "done" ? "font-semibold text-amber-700" : item.shape === "now" ? "font-semibold text-emerald-700" : "text-slate-500"}`}
                      >
                        {item.mine && item.shape !== "done" ? "Your step" : item.shape === "now" ? `Now · ${item.who}` : item.who}
                      </span>
                    </span>
                  </button>
                );
              })}
              {otherButtons && (
                <div className="mt-1 flex flex-wrap gap-1.5 border-t border-slate-100 px-1 pt-2">{otherButtons}</div>
              )}
            </nav>
            <Activity data={data} />
            <MoneyCard data={data} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {/* Asked up the line: the Team Lead or Business Mentor answers here; others read it. */}
            {data.asks.length > 0 && <AskUpBox data={data} />}
            {opened === "dispatch" ? (
              <DispatchStep data={data} n={railNumber("dispatch")} ask={ask} next={() => open("delivered")} />
            ) : opened === "delivered" ? (
              <DeliveredStep data={data} n={railNumber("delivered")} ask={ask} next={() => open("paid")} />
            ) : opened === "paid" ? (
              <PaidStep data={data} n={railNumber("paid")} />
            ) : opened === "finance" ? (
              <StepPanel number={3} title="Finance check">
                <div className="flex flex-col gap-3 text-[13px]">
                  <p className="text-slate-600">
                    {["finance_check", "ready_for_invoice"].includes(order.status)
                      ? "With Finance now: they check the payment (or what the customer owes) and make the invoice."
                      : order.status === "pending_approval" || order.status === "draft"
                        ? "Comes to Finance once Management approves."
                        : "Finance checked it."}
                  </p>
                  <Papers data={data} kinds={["payment_proof", "po", "other"]} />
                </div>
              </StepPanel>
            ) : opened === "management" ? (
              <StepPanel number={2} title="Management check">
                <div className="flex flex-col gap-3 text-[13px]">
                  <ul className="flex flex-col gap-2">
                    {CHECKS.filter((item) => item.key !== "approve").map((item) => {
                      const state = states[item.key];
                      return (
                        <li key={item.key} className="flex items-start gap-2.5">
                          <span className={`mt-1 size-2.5 shrink-0 rounded-full ${state.ok ? "bg-emerald-500" : "bg-amber-400"}`} aria-hidden="true" />
                          <span className="min-w-0">
                            <b className="text-slate-900">{checkLabel(item.key, data)}</b>
                            <span className={`block text-[12px] ${state.ok ? "text-slate-500" : "font-semibold text-amber-700"}`}>{state.note}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
                    {order.approvedAt
                      ? `Approved${order.approvedBy ? ` by ${order.approvedBy}` : ""} · ${timeLabel(order.approvedAt)}`
                      : order.status === "pending_approval"
                        ? "Waiting for Management to read it and approve."
                        : order.status === "draft"
                          ? `Sent back: ${order.flagReason ?? "fix it and place it again"}`
                          : "Not approved."}
                  </p>
                </div>
              </StepPanel>
            ) : (
              <StepPanel number={1} title="The order as placed">
                <div className="flex flex-col gap-4">
                  <Lines data={data} />
                  <Documents data={data} />
                  <OrderReturnsBox orderId={order.id} />
                </div>
              </StepPanel>
            )}
            <Problem message={problem?.message} />
          </div>
        </div>
      )}

      {asking && (
        <ReasonDialog
          orderId={order.id}
          code={order.code}
          what={asking}
          // Finance's hold carries screenshots for the MedRep; Management's is words only.
          financeHold={desk === "finance" && ["finance_check", "ready_for_invoice"].includes(order.status)}
          choices={asking === "resume" ? data.resumeTo : []}
          presets={asking === "hold" && desk === "dispatch" ? DISPATCH_HOLDS : []}
          onClose={() => setAsking(null)}
        />
      )}
      <DispatchDialogs ask={dispatching} onClose={() => setDispatching(null)} />
    </div>
  );
}
/** Management's two looks of its check. */
const ORDER_LOOKS = [
  ["steps", "Steps"],
  ["glance", "One page"],
] as const;
