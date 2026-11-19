// One order, laid out like an Online case (online/lead.tsx): who it is for at the top, the order's
// journey under it (placed → Management → Finance → packed and shipped → delivered → paid, each
// with who and when), then the steps on the left with the money and the activity under them,
// and the step being worked on the right. Management, Finance and Dispatch each open on their
// own step; the step open is in the address (?step=).

import { DIVISIONS, PAYMENT_TERMS, SUB_DIVISIONS, termsOfLabel } from "@2mg/api/divisions";
import type { OrderAction, OrderDetail, PaperKind } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Banknote,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePause,
  CircleX,
  ExternalLink,
  FileText,
  Hourglass,
  MapPin,
  PackageOpen,
  PencilLine,
  Phone,
  Play,
  Printer,
  ReceiptText,
  RotateCcw,
  Snowflake,
  TriangleAlert,
  Truck,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { type FormEvent, Fragment, type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import {
  CustomerStory,
  LastGiven,
  LineLookSwitch,
  useLineLook,
  useOrderPrices,
} from "../customers/prices";
import { DISPATCH_HOLDS, type DispatchAsk, DispatchDialogs } from "../dispatch/parts";
import { noProofWords } from "../finance/no-proof";
import {
  ConfirmPaymentDialog,
  InvoiceStatus,
  RecordPaymentDialog,
  UseCreditDialog,
  useMoney,
} from "../finance/parts";
import { MedicinePopup } from "../inventory/medicine-popup";
import { avatarTone, initials } from "../look";
import { ApproveDialog } from "./approve-dialog";
import { checksOf } from "./checks";
import { LinesEditor } from "./lines-editor";
import { ReasonDialog, StatusPill, shortSpan, useOrderAction } from "./parts";
import { AskUpBox } from "./asks";
import { OrderReturnsBox, RefundButton } from "./returns";
import { SendToCustomer } from "./send-update";
import { OrderVersions } from "./versions";
import { VAT_WORDS } from "../inventory/vat";
import { PAPER_ACCEPT, uploadPaper } from "../photo";
import { manilaToday } from "../team/range";
import {
  Button,
  count,
  dayLabel,
  INPUT,
  inPacks,
  LookSwitch,
  PageState,
  Pill,
  Problem,
  peso,
  timeLabel,
  useAction,
  useLook,
} from "../ui";

type StepKey = "placed" | "management" | "finance" | "dispatch" | "delivered" | "paid" | "proof";
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

// ---------------------------------------------------------------- Management's checks

/** What Management goes through on an order, one step each (Aryan): each opens the part to look
 *  at, and the last approves it. */
const CHECKS = [
  { key: "papers", label: "RX & documents" },
  { key: "price", label: "Medicines & price" },
  { key: "stock", label: "Stock & warehouse" },
  { key: "customer", label: "Customer & licence" },
  { key: "approve", label: "Approve" },
] as const;
/** A hospital's (or any business's) order: its documents, no prescription to check. */
const checkLabel = (key: CheckKey, data: OrderDetail) =>
  key === "papers" && data.order.customerKind !== "patient" && !data.order.patientOrder
    ? "Documents"
    : (CHECKS.find((item) => item.key === key)?.label ?? key);
type CheckKey = (typeof CHECKS)[number]["key"];
/** Management's two looks of its check. */
const ORDER_LOOKS = [
  ["steps", "Steps"],
  ["glance", "One page"],
] as const;

/** How each check stands on this order: fine, or what needs a look. */
function checkStates(data: OrderDetail): Record<CheckKey, { ok: boolean; note: string }> {
  const list = checksOf({
    findings: data.findings,
    papers: data.papers.map((paper) => paper.kind),
    customerKind: data.order.customerKind,
    patientOrder: data.order.patientOrder,
    items: data.items,
    manual: true,
    papersCheckedAt: data.order.papersCheckedAt,
    papersCheckedBy: data.order.papersCheckedBy,
  });
  const of = (key: string) => list.find((one) => one.key === key);
  const state = (keys: string[], fine: string) => {
    const warn = keys.map(of).find((one) => one?.tone === "warn");
    return warn ? { ok: false, note: warn.label } : { ok: true, note: fine };
  };
  return {
    price: state(["price", "note"], of("price")?.label ?? "Price OK"),
    stock: state(["stock"], "In stock"),
    customer: state(["customer"], "Customer OK"),
    papers: (() => {
      // The papers this buyer is expected to send, read from what is on file.
      const missing = data.paperList.filter(
        (row) => row.needed && !row.onFile && row.kind !== "payment_proof" && row.kind !== "dr",
      );
      if (missing.length)
        return { ok: false, note: `No ${missing.map((row) => row.label).join(", ")}` };
      // On file but not read by a person yet: to check, never fine by itself (Aryan, 19 Nov).
      const paper = of("paper");
      if (paper?.tone === "warn") return { ok: false, note: paper.label };
      return { ok: true, note: paper?.label ?? (data.papers.length ? "Papers checked" : "No papers to read") };
    })(),
    approve: { ok: false, note: "Your step" },
  };
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
  const tone = shape === "later" ? "text-slate-500" : "text-slate-800";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] ${tone}`}
    >
      <span
        aria-hidden="true"
        className={`font-bold ${shape === "done" || shape === "skipped" ? "text-emerald-600" : shape === "now" ? "text-amber-500" : shape === "stopped" ? "text-rose-600" : "text-slate-300"}`}
      >
        {shape === "done" || shape === "skipped" ? "✓" : shape === "stopped" ? "!" : "●"}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {note && <span className="text-right text-slate-500">{note}</span>}
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
  // A medicine opens over the page, so the order stays where it is.
  const [medicine, setMedicine] = useState<number | null>(null);
  // What this customer was given before, line by line (this CRM's orders and Zoho's).
  // Dispatch packs and ships: earlier prices are not their work (Aryan, 17 Nov: less clutter).
  const packer = useMe().data?.role === "dispatch";
  const fetched = useOrderPrices(order.id).data;
  const prices = packer ? undefined : fetched;
  const [look, pickLook] = useLineLook();
  const anyBefore = prices ? Object.values(prices.lines).some(Boolean) : false;
  return (
    <div className="-mx-4 overflow-x-auto border-y border-slate-100">
      {medicine !== null && <MedicinePopup id={medicine} onClose={() => setMedicine(null)} />}
      {anyBefore && <LineLookSwitch look={look} onPick={pickLook} />}
      <table className="t">
        <thead>
          <tr>
            <th>Medicine</th>
            <th className="num">Pieces</th>
            {compare && <th className="num">List price</th>}
            <th className="num">Given</th>
            <th className="num" title="On the shelf, less what orders placed before this one hold">
              Free stock
            </th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => {
            const before = prices?.lines[item.id];
            return (
              <Fragment key={item.id}>
                <tr className={before ? "[&>td]:border-b-0 [&>td]:pb-1" : undefined}>
                  <td>
                    <button
                      type="button"
                      onClick={() => setMedicine(item.medicineId)}
                      className="text-left font-semibold hover:underline"
                      title="Prices, stock in each warehouse, batches"
                    >
                      {item.medicine}
                    </button>
                    <div className="text-xs text-ink-2">
                      {item.free ? "Free" : `${item.priceLabel} price`}
                      {item.reason && item.reason !== "Free" ? ` · ${item.reason}` : ""}
                    </div>
                    {/* VAT as Inventory keeps it; an SC/PWD line is sold without it. */}
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-semibold">
                      <span
                        className={`rounded px-1.5 py-0.5 ${item.relief ? "bg-sky-50 text-sky-800" : item.vat === "vat12" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                      >
                        {item.relief
                          ? "SC/PWD: no VAT, 20% off"
                          : (VAT_WORDS[item.vat] ?? item.vat)}
                      </span>
                      {item.rx && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">
                          Prescription
                        </span>
                      )}
                      {item.offerId && (
                        // Priced or given free by an offer set in Inventory: worked out by the system.
                        <span className="rounded bg-good-tint px-1.5 py-0.5 text-good">Offer</span>
                      )}
                      {item.cold && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
                          <Snowflake className="size-3" aria-hidden="true" /> Cold chain
                        </span>
                      )}
                      {item.coldBox && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
                          <Snowflake className="size-3" aria-hidden="true" /> Cold-chain box · priced by Management
                        </span>
                      )}
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
                    {/* Worked out for Management, not by hand (Aryan, 17 Nov): how far from the list. */}
                    {!item.free && !item.relief && item.listPrice > 0 && item.unitPrice !== item.listPrice && (
                      <div
                        className={`text-[11px] font-semibold ${item.unitPrice < item.listPrice ? "text-amber-700" : "text-brand-dark"}`}
                        title={`${peso(Math.abs(item.listPrice - item.unitPrice) * item.qty)} ${item.unitPrice < item.listPrice ? "less" : "more"} on this line`}
                      >
                        {item.unitPrice < item.listPrice ? "−" : "+"}
                        {Math.round((Math.abs(item.listPrice - item.unitPrice) / item.listPrice) * 1000) / 10}% vs list
                      </div>
                    )}
                  </td>
                  <td
                    className={`num ${item.inStock < item.qty ? "font-semibold text-bad" : "text-emerald-700"}`}
                  >
                    {count(item.inStock)}
                  </td>
                  <td className="num font-semibold whitespace-nowrap">{peso(item.amount)}</td>
                </tr>
                {before && (
                  <tr>
                    <td colSpan={compare ? 6 : 5} className="pt-0">
                      <LastGiven
                        key={look}
                        history={before}
                        now={item.unitPrice}
                        free={item.free}
                        look={look}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
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
/** The order's papers on one line (Management's step): one on file opens with a click, one not
 *  yet there is a small "+" to add a photo. */
function PaperChips({ data, kinds }: { data: OrderDetail; kinds: PaperKind[] }) {
  const queries = useQueryClient();
  const [uploading, setUploading] = useState<PaperKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { order, can } = data;
  const mayAdd = (kind: string) =>
    kind === "payment_proof" ? can.addProof : kind === "dr" ? can.addDr : can.addPaper;
  const rows = data.paperList.filter((row) => kinds.includes(row.kind));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
        <span className="font-semibold text-slate-600">Papers</span>
        {rows.map((row) => {
          const onFile = data.papers.filter((paper) => paper.kind === row.kind);
          if (onFile.length)
            return onFile.map((paper) => (
              <a
                key={paper.id}
                href={`/api/papers/${paper.id}`}
                target="_blank"
                rel="noreferrer"
                title={paper.name}
                className="inline-flex items-center gap-1.5 font-semibold text-slate-800 hover:underline"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {row.label}
              </a>
            ));
          return mayAdd(row.kind) ? (
            <label
              key={row.kind}
              title={row.why ?? undefined}
              className={`inline-flex cursor-pointer items-center gap-1 font-semibold ${
                row.needed ? "text-amber-700" : "text-slate-500"
              } hover:text-emerald-700 ${uploading ? "pointer-events-none opacity-50" : ""}`}
            >
              <Camera size={13} aria-hidden="true" />
              {uploading === row.kind ? "Uploading…" : `+ ${row.label}`}
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
          ) : (
            <span key={row.kind} className="text-slate-400">
              No {row.label.toLowerCase()}
            </span>
          );
        })}
      </div>
      {problem && <Problem message={problem} />}
    </div>
  );
}

/** What the MedRep sent, in one line, with the form to complete it folded until it is wanted. */
function DetailsLine({ data }: { data: OrderDetail }) {
  const { order } = data;
  const [open, setOpen] = useState(false);
  const facts = [
    order.division ? [order.division, order.subDivision].filter(Boolean).join(" · ") : null,
    order.paymentTerm,
    order.deliveryAddress,
    order.expectedOn ? `wanted ${dayLabel(order.expectedOn)}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 text-slate-700">
          <span className="font-semibold text-slate-600">Details</span>{" "}
          {facts.length ? facts.join(" · ") : "Division, payment terms and delivery not filled yet"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 font-semibold text-emerald-700 hover:underline"
        >
          {open ? "Close" : "Edit details"}
        </button>
      </div>
      {open && <CompleteDetails data={data} />}
    </div>
  );
}

/** Every paper this order carries, by who it is for (a hospital's PO and its own papers; a
 *  patient's prescription and ID), with what to add next, as the old CRM suggested it. */
function Documents({ data }: { data: OrderDetail }) {
  const onFile = new Set(data.papers.map((paper) => paper.kind));
  const patient = data.order.customerKind === "patient" || data.order.patientOrder;
  const missing = data.paperList.filter(
    (row) => row.needed && !row.onFile && row.kind !== "payment_proof" && row.kind !== "dr",
  );
  const suggestion = missing.length
    ? `Next: add ${missing.map((row) => row.label).join(" and ")}.`
    : patient && onFile.has("prescription") && !onFile.has("gl")
      ? "Prescription on file. Is a guarantee letter paying for it (PCSO, DSWD…)? Add it under Guarantee letter."
      : patient && onFile.has("gl") && !onFile.has("med_cert")
        ? "Guarantee letter on file: add the medical certificate if the agency asks for it."
        : null;
  return (
    <div className="flex flex-col gap-3">
      {data.order.patientOrder && (
        <div className="text-[13px] text-slate-700">
          <b>For a patient:</b> {data.order.patientName ?? "name not given"}
        </div>
      )}
      {suggestion && (
        <div className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          <span>{suggestion}</span>
        </div>
      )}
      {/* Management's papers: the delivery receipt is Dispatch's, the proof of payment Finance's. */}
      <Papers
        data={data}
        kinds={data.paperList
          .map((row) => row.kind)
          .filter((kind) => kind !== "dr" && kind !== "payment_proof")}
      />
      <PapersCheck data={data} />
    </div>
  );
}

/** Management's own word on the papers, after reading each (Aryan, 19 Nov: a prescription is read
 *  by a person, right or wrong; the system never ticks it). Kept with who and when. */
function PapersCheck({ data }: { data: OrderDetail }) {
  const queries = useQueryClient();
  const action = useAction();
  const readable = data.papers.filter((paper) => paper.kind !== "payment_proof" && paper.kind !== "dr");
  if (!readable.length) return null;
  const checkedAt = data.order.papersCheckedAt;
  const may = data.can.approve || data.can.hold;
  const set = (ok: boolean) =>
    action.run(async () => {
      await api(`/api/orders/${data.order.id}/papers-check`, { body: { ok } });
      // The order's page and every card that shows it.
      await queries.invalidateQueries({ queryKey: ["orders"] });
    });
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] ${checkedAt ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"}`}>
      <span className="min-w-0 flex-1">
        {checkedAt
          ? `Papers checked by hand${data.order.papersCheckedBy ? ` by ${data.order.papersCheckedBy}` : ""}, ${new Date(checkedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}.`
          : `${readable.length} ${readable.length === 1 ? "paper" : "papers"} on file, not checked yet: open each (the prescription: right patient, doctor, medicine, date) and say so.`}
      </span>
      {may && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() => void set(!checkedAt)}
          className={checkedAt ? "text-[12.5px] font-semibold text-slate-600 underline hover:text-slate-900" : "rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"}
        >
          {action.busy ? "Saving…" : checkedAt ? "Take back" : "Papers are right"}
        </button>
      )}
      {action.problem && <span className="basis-full text-[12px] text-rose-700">{action.problem.message}</span>}
    </div>
  );
}

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

/** Where the order ships from, as Management picks it: each warehouse with whether it can fill
 *  every line, else what it is short of (as the hub's approve-and-check-stock did). */
function ShipsFrom({
  fill,
  value,
  onChange,
}: {
  fill: NonNullable<OrderDetail["warehouseFill"]>;
  value: string;
  onChange: (value: string) => void;
}) {
  const picked = value || String(fill.find((place) => place.isDefault)?.id ?? fill[0]?.id ?? "");
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[12px] font-semibold text-slate-600">Ships from</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {fill.map((place) => {
          const chosen = String(place.id) === picked;
          const fills = place.short.length === 0;
          return (
            <label
              key={place.id}
              className={`flex cursor-pointer gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] ${
                chosen
                  ? "border-emerald-400 bg-emerald-50/60 ring-1 ring-emerald-300"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="ships-from"
                checked={chosen}
                onChange={() => onChange(place.isDefault ? "" : String(place.id))}
                className="mt-0.5 accent-emerald-600"
              />
              <span className="min-w-0">
                <span className="font-semibold text-slate-900">
                  {place.name}
                  {place.isDefault && (
                    <span className="ml-1.5 text-[11px] font-medium text-slate-500">main</span>
                  )}
                </span>
                <span className={`block text-xs ${fills ? "text-emerald-700" : "text-amber-800"}`}>
                  {fills
                    ? "Can fill every line"
                    : place.short
                        .map(
                          (one) =>
                            `${one.medicine}: needs ${count(one.need)}, has ${count(one.have)}`,
                        )
                        .join(" · ")}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The buyer's licence (a hospital's or drugstore's LTO, a doctor's PRC), its expiry and TIN, with
 *  what is missing in amber and a way to fill it on the customer. A patient needs none. */
function LicenceFacts({ order }: { order: OrderDetail["order"] }) {
  if (order.customerKind === "patient") return null;
  const name = order.customerKind === "doctor" ? "PRC licence" : "LTO number";
  const today = manilaToday();
  const expired = Boolean(order.licenceExpires && order.licenceExpires < today);
  // A hospital, distributor or drugstore: the hub's whole list (licence and the three papers).
  const missing = ["hospital", "distributor", "drugstore"].includes(order.customerKind)
    ? order.customerMissing
    : [
        order.licenceNo ? null : name,
        order.customerKind !== "doctor" && !order.licenceExpires ? "licence expiry" : null,
        order.tin ? null : "TIN",
      ].filter(Boolean);
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-[13px] ${
        expired || missing.length
          ? "border-transparent bg-slate-50 text-slate-800"
          : "border-slate-200 text-slate-700"
      }`}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <span className="text-slate-500">{name}:</span> <b>{order.licenceNo ?? "—"}</b>
        </span>
        {order.customerKind !== "doctor" && (
          <span>
            <span className="text-slate-500">Expires:</span>{" "}
            <b className={expired ? "text-rose-700" : ""}>
              {order.licenceExpires ? dayLabel(order.licenceExpires) : "—"}
              {expired ? " (expired)" : ""}
            </b>
          </span>
        )}
        <span>
          <span className="text-slate-500">TIN:</span> <b>{order.tin ?? "—"}</b>
        </span>
      </div>
      {missing.length > 0 && (
        <Link
          to={`/customers/${order.customerId}`}
          className="text-xs font-semibold text-amber-700 underline"
        >
          Missing {missing.join(", ")}: fill it on the customer
        </Link>
      )}
    </div>
  );
}

function ManagementStep({
  data,
  act,
  onAsk,
  next,
  check,
  onCheck,
  states,
  autoApprove = false,
}: {
  data: OrderDetail;
  act: ReturnType<typeof useOrderAction>;
  onAsk: (action: OrderAction) => void;
  next: () => void;
  /** The check being gone through (Management, while it waits); none = everything at once. */
  check?: CheckKey;
  onCheck?: (key: CheckKey) => void;
  states?: Record<CheckKey, { ok: boolean; note: string }>;
  /** Opened from a card's Approve: the approve window opens at once. */
  autoApprove?: boolean;
}) {
  const { order, can } = data;
  const shows = (key: CheckKey) => !check || check === key;
  const at = check ? CHECKS.findIndex((item) => item.key === check) : -1;
  const after = at >= 0 ? CHECKS[at + 1] : undefined;
  const findingsOf = (kinds: string[]) =>
    data.findings.filter((finding) => !check || kinds.includes(finding.kind));
  const shownFindings = !check
    ? data.findings
    : check === "price"
      ? findingsOf(["price", "note"])
      : check === "stock"
        ? findingsOf(["stock"])
        : check === "customer"
          ? findingsOf(["customer", "licence", "owes", "credit"])
          : check === "papers"
            ? findingsOf(["rx"])
            : data.findings;
  // Where it ships from: the default warehouse, unless only another can fill every line.
  const [warehouse, setWarehouse] = useState(() => {
    const fill = data.warehouseFill ?? [];
    const main = fill.find((place) => place.isDefault);
    const fills = fill.find((place) => place.short.length === 0);
    return main && main.short.length > 0 && fills ? String(fills.id) : "";
  });
  // Management decides here whether Finance checks the order too.
  const [approving, setApproving] = useState(autoApprove && data.can.approve);
  const [editing, setEditing] = useState(false);
  const waiting = order.status === "pending_approval";
  // Management completes what the MedRep sent before approving it.
  const completes = can.approve || (can.resume && order.heldRole === "management");
  return (
    <StepPanel
      number={check ? at + 1 : 2}
      title={check ? checkLabel(check, data) : "Management check"}
      footer={
        order.approvedAt ? (
          <NextButton label="Next: Finance check" onClick={next} />
        ) : check && after && onCheck ? (
          <NextButton label={`Next: ${after.label}`} onClick={() => onCheck(after.key)} />
        ) : undefined
      }
    >
      {check && check !== "approve" && states ? (
        <Fact shape={states[check].ok ? "done" : "now"}>
          <b>{states[check].note}</b>
        </Fact>
      ) : order.approvedAt ? (
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
          <b>
            Waiting for {order.approverName ? `${order.approverName} (PAP head)` : "Management"}
          </b>
        </Fact>
      ) : order.status === "draft" ? (
        <Fact shape="stopped">
          <b>Sent back</b> · {order.flagReason ?? "fix it and place it again"}
        </Fact>
      ) : null}
      {shownFindings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-800">
          {shownFindings.map((finding) => (
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
      {editing && check === "price" ? (
        <LinesEditor data={data} onDone={() => setEditing(false)} />
      ) : (
        (shows("price") || shows("stock")) && (
          <>
            {/* An Online order's prices are the case's quotation: one click to it as the agent made it. */}
            {order.via && order.leadId && check === "price" && (
              <div className="rounded-xl bg-violet-50 px-3 py-2 text-[13px] text-violet-900">
                Priced as quoted on the Online case {order.via.code} ({order.via.source}).{" "}
                <Link to={`/leads/${order.leadId}?step=quote`} className="font-semibold underline">
                  Open the quotation
                </Link>
              </div>
            )}
            <Lines data={data} compare />
            {can.approve && check === "price" && (
              <div>
                <Button small onClick={() => setEditing(true)}>
                  <PencilLine size={14} aria-hidden="true" /> Edit medicines · add, free, price
                </Button>
              </div>
            )}
          </>
        )
      )}
      {/* What Management checks besides the price: the buyer's licence and the papers. */}
      {shows("customer") && <CustomerStory orderId={order.id} name={order.customer} />}
      {shows("customer") && <LicenceFacts order={order} />}
      {check === "papers" ? (
        <Documents data={data} />
      ) : (
        !check && <PaperChips data={data} kinds={["po", "prescription", "gl", "payment_proof"]} />
      )}
      {(shows("customer") || check === "approve") && completes && <DetailsLine data={data} />}
      {(shows("stock") || check === "approve") &&
        can.approve &&
        data.warehouseFill &&
        data.warehouseFill.length > 0 && (
          <ShipsFrom fill={data.warehouseFill} value={warehouse} onChange={setWarehouse} />
        )}
      {check === "approve" && states && (
        <ul className="flex flex-col gap-1 text-[13px]">
          {CHECKS.filter((item) => item.key !== "approve").map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onCheck?.(item.key)}
                className="flex items-center gap-2 text-left hover:underline"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${states[item.key].ok ? "bg-emerald-500" : "bg-amber-400"}`}
                  aria-hidden="true"
                />
                <span className="font-semibold text-slate-800">{item.label}</span>
                <span className="text-slate-500">· {states[item.key].note}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {can.approve && shows("approve") && (
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="primary" disabled={act.busy} onClick={() => setApproving(true)}>
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
      {approving && (
        <ApproveDialog
          data={data}
          initial={warehouse}
          busy={act.busy}
          problem={act.problem?.message ?? null}
          onClose={() => setApproving(false)}
          onApprove={async (choice) => {
            if (await act.act(order.id, "approve", choice)) setApproving(false);
          }}
        />
      )}
    </StepPanel>
  );
}

/** Management's check on one page (Aryan: the useful things right on top, the rest out of the
 *  way). On top: how many things need a look, each check as a chip, and Approve / Send back /
 *  Reject. Under it one part per check: the ones the system found fine stay folded to a line, the
 *  ones that need a look are open. */
function ManagementGlance({
  data,
  act,
  onAsk,
  states,
  more,
  autoApprove = false,
}: {
  data: OrderDetail;
  act: ReturnType<typeof useOrderAction>;
  onAsk: (action: OrderAction) => void;
  states: Record<CheckKey, { ok: boolean; note: string }>;
  /** Hold, exception, cancel and the like. */
  more?: ReactNode;
  autoApprove?: boolean;
}) {
  const { order, can } = data;
  const parts = ["price", "stock", "customer", "papers"] as const;
  type Part = (typeof parts)[number];
  const toLook = parts.filter((key) => !states[key].ok);
  // Open at first: what needs a look; when nothing does, the medicines and their prices.
  const [shown, setShown] = useState<Part[]>(() => (toLook.length ? toLook : ["price"]));
  const [warehouse, setWarehouse] = useState(() => {
    const fill = data.warehouseFill ?? [];
    const main = fill.find((place) => place.isDefault);
    const fills = fill.find((place) => place.short.length === 0);
    return main && main.short.length > 0 && fills ? String(fills.id) : "";
  });
  const [approving, setApproving] = useState(autoApprove && can.approve);
  const [editing, setEditing] = useState(false);
  const waiting = order.status === "pending_approval";
  const completes = can.approve || (can.resume && order.heldRole === "management");
  const kinds: Record<Part, string[]> = {
    price: ["price", "note"],
    stock: ["stock"],
    customer: ["customer", "licence", "owes", "credit"],
    papers: ["rx"],
  };
  const flip = (key: Part) =>
    setShown(shown.includes(key) ? shown.filter((one) => one !== key) : [...shown, key]);
  const goTo = (key: Part) => {
    if (!shown.includes(key)) setShown([...shown, key]);
    requestAnimationFrame(() =>
      document.getElementById(`part-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const body = (key: Part) => {
    const findings = data.findings.filter((finding) => kinds[key].includes(finding.kind));
    return (
      <div className="flex flex-col gap-4 border-t border-slate-100 p-4">
        {findings.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-xl bg-amber-50/70 px-3 py-2.5 text-[13px] text-slate-800">
            {findings.map((finding) => (
              <li key={finding.text} className="flex gap-2">
                <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                <span>{finding.text}</span>
              </li>
            ))}
          </ul>
        )}
        {key === "price" &&
          (editing ? (
            <LinesEditor data={data} onDone={() => setEditing(false)} />
          ) : (
            <>
              <Lines data={data} compare />
              {can.approve && (
                <div>
                  <Button small onClick={() => setEditing(true)}>
                    <PencilLine size={14} aria-hidden="true" /> Edit medicines · add, free, price
                  </Button>
                </div>
              )}
            </>
          ))}
        {key === "stock" &&
          (can.approve && data.warehouseFill && data.warehouseFill.length > 0 ? (
            <ShipsFrom fill={data.warehouseFill} value={warehouse} onChange={setWarehouse} />
          ) : (
            <div className="text-[13px] text-slate-700">
              {order.warehouse ? (
                <>
                  Ships from <b>{order.warehouse}</b>.
                </>
              ) : (
                "The warehouse is picked when it is approved."
              )}
            </div>
          ))}
        {key === "customer" && (
          <>
            <CustomerStory orderId={order.id} name={order.customer} />
            <LicenceFacts order={order} />
            {completes && <DetailsLine data={data} />}
          </>
        )}
        {key === "papers" && <Documents data={data} />}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {/* What to decide, and the buttons: it stays in sight while the page is read. */}
      <section className="sticky top-[3.75rem] z-10 rounded-2xl border border-slate-200 bg-white/95 shadow-md backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl text-base font-bold ${
              order.approvedAt || toLook.length === 0
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {order.approvedAt || toLook.length === 0 ? <Check className="size-5" /> : toLook.length}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[15px] font-bold text-ink">
              {order.approvedAt
                ? order.approvedBy
                  ? `Approved by ${order.approvedBy}`
                  : "Went straight on: no discount, no credit"
                : order.status === "draft"
                  ? "Sent back to the MedRep"
                  : toLook.length === 0
                    ? "Everything checks out"
                    : `${toLook.length} ${toLook.length === 1 ? "thing" : "things"} to look at`}
            </div>
            <div className="text-[12px] text-slate-500">
              {order.approvedAt
                ? `${short(order.approvedAt)}${order.warehouse ? ` · ships from ${order.warehouse}` : ""}`
                : order.status === "draft"
                  ? (order.flagReason ?? "They fix it and place it again")
                  : toLook.length === 0
                    ? "Papers, price, stock and customer are fine."
                    : `${toLook.map((key) => states[key].note).join(" · ")}${
                        toLook.length < parts.length ? ". The rest is fine." : ""
                      }`}
            </div>
          </div>
          {can.approve && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={act.busy} onClick={() => setApproving(true)}>
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
        </div>
      </section>
      {/* Each check as a chip (it opens that part), and the rarer things to do. */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
          {parts.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => goTo(key)}
              title={states[key].note}
              className={`inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1.5 text-[12px] font-semibold ring-1 transition-colors ${
                states[key].ok
                  ? "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                  : "bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-100"
              }`}
            >
              <span
                className={`grid size-4 place-items-center rounded-full text-[9px] font-bold text-white ${states[key].ok ? "bg-emerald-600" : "bg-amber-500"}`}
              >
                {states[key].ok ? <Check className="size-3" /> : "!"}
              </span>
              {checkLabel(key, data)}
              {!states[key].ok && (
                <span className="font-normal text-amber-800">· {states[key].note}</span>
              )}
            </button>
          ))}
          {more && <span className="ml-auto flex flex-wrap items-center gap-1.5">{more}</span>}
        </div>
      </section>
      <AskUpBox data={data} />

      {parts.map((key) => {
        const open = shown.includes(key);
        return (
          <section
            key={key}
            id={`part-${key}`}
            className="scroll-mt-40 rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => flip(key)}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
            >
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${states[key].ok ? "bg-emerald-600" : "bg-amber-400"}`}
              >
                {states[key].ok ? <Check className="size-3.5" /> : "!"}
              </span>
              <h2 className="text-[15px] font-semibold text-ink">{checkLabel(key, data)}</h2>
              <span
                className={`min-w-0 flex-1 truncate text-[12.5px] ${states[key].ok ? "text-slate-500" : "font-semibold text-amber-700"}`}
              >
                {states[key].note}
              </span>
              <ChevronDown
                className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {open && body(key)}
          </section>
        );
      })}
      {waiting && !can.approve && (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
          Waiting for {order.approverName ? `${order.approverName} (PAP head)` : "Management"}.
        </div>
      )}
      {approving && (
        <ApproveDialog
          data={data}
          initial={warehouse}
          busy={act.busy}
          problem={act.problem?.message ?? null}
          onClose={() => setApproving(false)}
          onApprove={async (choice) => {
            if (await act.act(order.id, "approve", choice)) setApproving(false);
          }}
        />
      )}
    </div>
  );
}

/** What a Payment Term means for the money: paid first, on delivery, or credit for some days. */
function termWords(label: string): string {
  const { terms, days } = termsOfLabel(label);
  return terms === "advance"
    ? "Paid before it goes out"
    : terms === "cod"
      ? "Cash on delivery"
      : `Credit: paid ${days} days after delivery`;
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
        {(SUB_DIVISIONS[value.division] ?? []).length > 0 ? (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-slate-600">Sub-division</span>
            <select
              value={value.subDivision}
              onChange={(event) => set("subDivision", event.target.value)}
              className={INPUT}
            >
              <option value="">-- Not set --</option>
              {[
                ...(value.subDivision &&
                !(SUB_DIVISIONS[value.division] ?? []).includes(value.subDivision)
                  ? [value.subDivision]
                  : []),
                ...(SUB_DIVISIONS[value.division] ?? []),
              ].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          input("subDivision", "Sub-division", { placeholder: "The area within the Division" })
        )}
        <p className="-mt-1 text-[11px] text-slate-500 sm:col-span-2">
          Division: the selling team the order counts for (HOS hospitals; B&amp;B, STC, URO the Rx
          field teams; B2B distributors; BID government tenders; MD Telesales the doctors'
          patients). Sub-division: the area within it.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-slate-600">Payment terms</span>
          <select
            value={value.paymentTerm}
            onChange={(event) => set("paymentTerm", event.target.value)}
            className={INPUT}
          >
            <option value="">-- Not set --</option>
            {[
              ...(value.paymentTerm && !PAYMENT_TERMS.includes(value.paymentTerm as never)
                ? [value.paymentTerm]
                : []),
              ...PAYMENT_TERMS,
            ].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {value.paymentTerm && (
            <span className="text-[11px] text-slate-500">{termWords(value.paymentTerm)}</span>
          )}
          {action.at("paymentTerm") && (
            <span className="text-xs text-rose-700">{action.at("paymentTerm")}</span>
          )}
        </label>
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

/** What the customer owed before this order, worked out from this CRM's invoices and Zoho's
 *  (Aryan, 17 Nov: Finance no longer goes to Zoho to see it), and what that means for the check. */
function DuesVerdict({ data }: { data: OrderDetail }) {
  const { dues, order } = data;
  const after = dues.owed + order.total;
  const over = dues.creditLimit !== null && after > dues.creditLimit;
  const tone =
    dues.overdue > 0 || over
      ? "border-bad/20 bg-bad-tint text-bad"
      : dues.owed > 0
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-good/20 bg-good-tint text-good";
  return (
    <div className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-[13px] ${tone}`}>
      <b>
        {dues.overdue > 0
          ? `${peso(dues.overdue)} overdue, the oldest ${dues.days} days late`
          : dues.owed > 0
            ? `Owes ${peso(dues.owed)} from before, nothing late`
            : "Nothing owed from before: clear to send on"}
      </b>
      {dues.owed > 0 && (
        <span>
          Owed before this order: {peso(dues.owed)}
          {dues.zoho > 0 ? ` (${peso(dues.zoho)} of it from before)` : ""}.{" "}
          {dues.overdue > 0 ? "Collect it first, or ask Management." : ""}
        </span>
      )}
      {over && (
        <span>
          With this order they would owe {peso(after)}, over their credit limit of{" "}
          {peso(dues.creditLimit ?? 0)}.
        </span>
      )}
      {dues.credit > 0 && (
        <span className="text-good">
          They have {peso(dues.credit)} of credit (open credit notes, or money kept from a
          bill): use it on the invoice at the payment step.
        </span>
      )}
      <Link to={`/customers/${order.customerId}`} className="text-xs font-semibold underline">
        Their whole history
      </Link>
    </div>
  );
}

function FinanceStep({
  data,
  n,
  money,
  next,
}: {
  /** Its number at the side, for a desk that sees only its own steps. */
  n?: number;
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
      number={n ?? 3}
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
          {can.undoConfirm && (
            <button
              type="button"
              disabled={money.busy}
              onClick={() => money.send(`/api/finance/orders/${order.id}/undo-confirm`, {})}
              className="ml-2 font-semibold text-emerald-700 hover:underline disabled:opacity-50"
            >
              Undo
            </button>
          )}
        </Fact>
      ) : order.status === "finance_check" ? (
        <Fact shape="now">
          <b>Paid in advance:</b> check the slip and the money in the account
        </Fact>
      ) : order.status === "ready_for_invoice" ? (
        <Fact shape="now">
          <b>
            {order.paymentTerms === "days"
              ? `Credit: pays ${order.paymentDays} days after delivery`
              : "Cash on delivery"}
          </b>{" "}
          · check what they owe and send it to Dispatch
        </Fact>
      ) : (
        <Fact shape="later">
          <b>After Management's approval</b>
        </Fact>
      )}
      {!checked && !skipped && <DuesVerdict data={data} />}
      {!checked && noProofWords(order.noProofReason, order.noProofNote) && (
        <div className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          <span>
            <b>No slip.</b> {order.medrep} says:{" "}
            {noProofWords(order.noProofReason, order.noProofNote)}
          </span>
        </div>
      )}
      {/* What it owed and its credit limit are in the box above; the rest is listed here. */}
      {data.findings.some((finding) => finding.kind !== "owes" && finding.kind !== "credit") &&
        !checked && (
        <ul className="flex flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-800">
          {data.findings
            .filter((finding) => finding.kind !== "owes" && finding.kind !== "credit")
            .map((finding) => (
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
              <ReceiptText size={16} aria-hidden="true" /> Check & send to Dispatch
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
  n,
  ask,
  next,
}: {
  /** Its number at the side, for a desk that sees only its own steps. */
  n?: number;
  data: OrderDetail;
  ask: (what: NonNullable<DispatchAsk>["what"]) => void;
  next: () => void;
}) {
  const { order, can } = data;
  const me = useMe().data;
  const left = Boolean(order.packedAt) || ["shipped", "completed"].includes(order.status);
  return (
    <StepPanel
      number={n ?? 4}
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
            : `with ${order.courier ?? "the courier"}${order.tracking ? ` · ${order.tracking}` : `, tracking to follow${order.trackingWait ? ` (${order.trackingWait.toLowerCase()})` : ""}`}`}{" "}
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
      {data.items.some((item) => item.cold) && order.status !== "completed" && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] text-sky-900">
          <Snowflake size={16} aria-hidden="true" />
          <span>
            <b>Keep cold:</b>{" "}
            {[...new Set(data.items.filter((item) => item.cold).map((item) => item.medicine))].join(
              ", ",
            )}{" "}
            — pack in a styro box with ice packs.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {me &&
          ["dispatch", "admin", "management"].includes(me.role) &&
          ["ready_for_dispatch", "packing", "shipped"].includes(order.status) && (
            <Link
              to={`/orders/${order.id}/address`}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-hover"
            >
              <Printer size={16} aria-hidden="true" /> Print address
            </Link>
          )}
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
  n,
  ask,
  next,
}: {
  /** Its number at the side, for a desk that sees only its own steps. */
  n?: number;
  data: OrderDetail;
  ask: (what: NonNullable<DispatchAsk>["what"]) => void;
  next: () => void;
}) {
  const { order, can } = data;
  const delivered = order.status === "completed";
  return (
    <StepPanel
      number={n ?? 5}
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

function PaidStep({
  data,
  n,
}: {
  /** Its number at the side, for a desk that sees only its own steps. */
  n?: number;
  data: OrderDetail;
}) {
  const { order, can } = data;
  const [paying, setPaying] = useState(false);
  const [using, setUsing] = useState(false);
  const me = useMe().data;
  const finance = me?.role === "finance" || me?.role === "admin";
  const invoice = data.money.invoice;
  const proofs = data.papers.filter((paper) => paper.kind === "payment_proof");
  return (
    <StepPanel number={n ?? 6} title="Paid">
      {!invoice ? (
        <Fact shape="later">
          <b>No invoice yet</b> · it is made when Management approves
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
          {(can.recordPayment || (finance && invoice.balance > 0 && data.dues.credit > 0)) && (
            <div className="flex flex-wrap gap-2">
              {can.recordPayment && (
                <Button variant="primary" onClick={() => setPaying(true)}>
                  Record payment received
                </Button>
              )}
              {finance && invoice.status === "open" && invoice.balance > 0 && data.dues.credit > 0 && (
                <Button onClick={() => setUsing(true)}>
                  Use their credit ({peso(data.dues.credit)})
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {using && invoice && (
        <UseCreditDialog
          invoiceId={invoice.id}
          code={invoice.code}
          owed={invoice.balance}
          customerId={order.customerId}
          onClose={() => setUsing(false)}
        />
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

/** The order's money, plainly (Aryan, 19 Nov: "show the money section properly"): each medicine
 *  whole (its name, pieces × price, free goods marked), the total, then the bill: its number, when
 *  it is due, what came in and what is still owed. */
function MoneyCard({ data }: { data: OrderDetail }) {
  const { order } = data;
  const invoice = data.money.invoice;
  const goods = data.items.reduce((sum, item) => sum + item.amount, 0);
  const free = data.items.filter((item) => item.free).length;
  const row = "flex items-baseline justify-between gap-3";
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <h2 className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5 text-[13px] font-semibold text-ink">
        Money
        <span className="text-[11px] font-normal text-slate-500">
          {data.items.length} {data.items.length === 1 ? "line" : "lines"}
          {free ? ` · ${free} free` : ""}
        </span>
      </h2>
      <ul className="divide-y divide-slate-100 px-3.5">
        {data.items.map((item) => (
          <li key={item.id} className="py-2">
            <div className={row}>
              <span className="line-clamp-2 min-w-0 text-[12.5px] font-medium text-slate-800">{item.medicine}</span>
              <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${item.free ? "text-emerald-700" : "text-slate-900"}`}>
                {item.free ? "Free" : peso(item.amount)}
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-slate-500 tabular-nums">
              {count(item.qty)} × {peso(item.unitPrice)}
              {!item.free && item.unitPrice < item.listPrice ? (
                <span className="ml-1.5 font-semibold text-amber-700">list {peso(item.listPrice)}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-1 border-t border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-[13px]">
        {order.deliveryFee > 0 && (
          <div className={row}>
            <dt className="text-slate-600">Medicines</dt>
            <dd className="tabular-nums">{peso(goods)}</dd>
          </div>
        )}
        {order.deliveryFee > 0 && (
          <div className={row}>
            <dt className="text-slate-600">Delivery fee</dt>
            <dd className="tabular-nums">{peso(order.deliveryFee)}</dd>
          </div>
        )}
        <div className={`${row} text-[14px] font-bold text-slate-900`}>
          <dt>Order total</dt>
          <dd className="tabular-nums">{peso(goods + order.deliveryFee)}</dd>
        </div>
        {order.pointsUsed > 0 && (
          <div className={`${row} text-emerald-700`}>
            <dt>{order.pointsUsed.toLocaleString("en-PH")} points</dt>
            <dd className="tabular-nums">−{peso(order.pointsUsed * 100)}</dd>
          </div>
        )}
        {invoice && goods + order.deliveryFee - invoice.total > 0 && (
          // Goods that came back: credited on the bill.
          <div className={`${row} text-slate-600`}>
            <dt>Returned</dt>
            <dd className="tabular-nums">−{peso(goods + order.deliveryFee - invoice.total)}</dd>
          </div>
        )}
        {invoice ? (
          <>
            <div className={`${row} mt-1 border-t border-slate-200 pt-1.5 text-[12px] text-slate-500`}>
              <dt>Invoice {invoice.code}</dt>
              <dd>due {invoice.dueOn}</dd>
            </div>
            <div className={row}>
              <dt className="text-slate-600">Received</dt>
              <dd className="tabular-nums">{peso(invoice.paid)}</dd>
            </div>
            <div className={`${row} font-semibold`}>
              <dt>Still owed</dt>
              <dd className={`tabular-nums ${invoice.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {invoice.balance > 0 ? peso(invoice.balance) : "Paid"}
              </dd>
            </div>
          </>
        ) : (
          <p className="mt-1 border-t border-slate-200 pt-1.5 text-[11.5px] text-slate-500">No invoice yet: it is made when Management approves.</p>
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
      <h2 className="mb-2 text-[13px] font-semibold text-ink">Timeline</h2>
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
