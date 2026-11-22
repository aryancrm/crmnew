// One order, laid out like an Online case (online/lead.tsx): who it is for at the top, the order's
// journey under it (placed → Management → Finance → packed and shipped → delivered → paid, each
// with who and when), then the steps on the left with the money and the activity under them,
// and the step being worked on the right. Management, Finance and Dispatch each open on their
// own step; the step open is in the address (?step=).

import { ORDER_TYPE_HINT, ORDER_TYPE_LABEL } from "@2mg/api/divisions";
import type { OrderAction, OrderDetail } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, CircleCheck, CirclePause, CircleX, FileText, Hourglass, MapPin, PencilLine, Phone, Play, RotateCcw, TriangleAlert, Undo2, UserRound } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { DISPATCH_HOLDS, type DispatchAsk, DispatchDialogs } from "../dispatch/parts";
import { ConfirmPaymentDialog, InvoiceStatus, useMoney } from "../finance/parts";
import { ApproveDialog, shipsFromOf } from "./approve-dialog";
import { ReasonDialog, StatusPill, shortSpan, useOrderAction } from "./parts";
import { AskUpBox } from "./asks";
import { OrderReturnsBox, RefundButton } from "./returns";
import { SendToCustomer } from "./send-update";
import { OrderVersions } from "./versions";
import { Button, dayLabel, PageState, Pill, Problem, peso, timeLabel, useAction, useLook } from "../ui";
import { DeliveredStep } from "./steps/delivered";
import { DispatchStep } from "./steps/dispatch";
import { FINANCE_PARTS, type FinancePart, FinanceStep, financeChecked, financeChecks } from "./steps/finance";
import { NextButton, type Shape, short, StepPanel } from "./steps/frame";
import { Lines } from "./steps/lines";
import {
  type AskFrom,
  type CheckKey,
  checkLabel,
  CHECKS,
  checkStates,
  firstPick,
  ManagementStep,
  sendBackFrom,
} from "./steps/management";
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
  // A reason window opened from a check starts from that check's reason (19 Nov).
  const [askFrom, setAskFrom] = useState<AskFrom>({});
  const askWith = (what: OrderAction, from: AskFrom = {}) => {
    setAskFrom(from);
    setAsking(what);
  };
  // Management's Approve sits in its column (Aryan, 19 Nov: "in that column itself, not a button
  // on another page"): one press, shipping from the warehouse picked on the stock check (else the
  // Approve window's pick), an Undo for a minute after; the window is a press away to change them.
  const [pickedWarehouse, setPickedWarehouse] = useState<string | null>(null);
  const [approveWindow, setApproveWindow] = useState(() => params.get("approve") === "1");
  const [undoUntil, setUndoUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (undoUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [undoUntil]);
  // Finance's Confirm payment, from its column.
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const queries = useQueryClient();
  const [dispatching, setDispatching] = useState<DispatchAsk>(null);
  // Management's and Finance's page keeps the top short: the rest of the details on a press.
  const [moreOpen, setMoreOpen] = useState(false);
  // Management's two looks of its check: step by step, or everything on one page.
  const [pageLook, pickPageLook] = useLook("crm:order-look", ORDER_LOOKS);
  const data = query.data;
  if (!data) return <PageState query={query} what="this order" />;
  const { order, can } = data;
  const { steps, current } = stepsOf(data);
  const fill = data.warehouseFill ?? [];
  const stockPick = pickedWarehouse ?? firstPick(fill);
  const shipsFrom = shipsFromOf(fill, stockPick);
  const shipsFromName = fill.find((one) => String(one.id) === shipsFrom)?.name ?? null;
  const undoLeft = can.take_back ? Math.ceil((undoUntil - now) / 1000) : 0;
  const approvedNow = () => {
    setNow(Date.now());
    setUndoUntil(Date.now() + UNDO_SECONDS * 1000);
  };
  const approvedChecks = new Map(data.checksApproved.map((one) => [one.key as string, one]));
  // A check is fine when the system found nothing on it, or Management approved what it found
  // (Aryan, 19 Nov: "what the system finds fine is ticked by itself").
  const CHECK_KEYS = CHECKS.map((item) => item.key);
  // Documents is never fine by itself: Management reads the papers (Aryan, 19 Nov), so every order
  // has at least one press of Management's.
  const fine = (key: CheckKey) => approvedChecks.has(key) || (key !== "papers" && states[key].ok);
  async function approveOrder() {
    const choice = { warehouseId: shipsFrom ? Number(shipsFrom) : null, finance: order.leadId ? undefined : order.financeCheck };
    if (await act.act(order.id, "approve", choice)) approvedNow();
  }
  /** Approves a check the system found something on; the last one approves the order (19 Nov). */
  async function approveOne(key: CheckKey) {
    const last = CHECK_KEYS.every((other) => other === key || fine(other));
    const done = await act.run(async () => {
      await api(`/api/orders/${order.id}/checks/${key}`, { body: {} });
    });
    if (done && last) await approveOrder();
    else {
      await queries.invalidateQueries({ queryKey: ["orders"] });
      await queries.invalidateQueries({ queryKey: ["dispatch"] });
    }
  }
  async function undoApproval() {
    if (await act.act(order.id, "take_back", { reason: "Undone straight after approving" })) setUndoUntil(0);
  }
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
  const toLookAt = CHECKS.filter((item) => !states[item.key].ok);
  // Whoever only follows the order reads at the top what it waits for and what was found on it.
  const waitsOnManagement = !desk && order.status === "pending_approval" && !order.flagReason;
  const askedCheck = params.get("check") as CheckKey | null;
  const check: CheckKey = CHECKS.some((item) => item.key === askedCheck)
    ? (askedCheck as CheckKey)
    : (CHECKS.find((item) => !states[item.key].ok)?.key ?? "papers");
  const ownStep = (key: StepKey) =>
    !desk ||
    (desk === "management"
      ? key === "management"
      : desk === "finance"
        ? key === "finance" || key === "paid"
        : key === "dispatch" || key === "delivered");
  // Finance's and Dispatch's own steps, from the order's road.
  // Finance's column is its own list of checks (below), as Management's.
  const deskKeys: StepKey[] = desk === "dispatch" ? ["dispatch", "delivered"] : [];
  const railNumber = (key: StepKey) =>
    deskKeys.length && deskKeys.includes(key) ? deskKeys.indexOf(key) + 1 : undefined;
  const railSteps = deskKeys.length
    ? deskKeys.map((key, index) => ({
        ...(steps.find((item) => item.key === key) ?? (steps[0] as (typeof steps)[number])),
        number: index + 1,
      }))
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
  // Finance's checks, one list as Management's (Aryan, 19 Nov: "no approve here, like
  // Management's? Where do I click Payment?"): what the system found on each, ticked by itself when
  // fine; Approve or Hold on what it found; Payment is Finance's own press (Confirm payment, or
  // Approve to make the invoice and send it to Dispatch) once the rest is fine; then Paid.
  const financeRows = desk === "finance" ? financeChecks(data) : [];
  const paymentChecked = financeChecked(data);
  const financeApproval = (key: FinancePart) => approvedChecks.get(`finance_${key}`);
  const financeFine = (row: (typeof financeRows)[number]) =>
    row.key === "payment" ? Boolean(paymentChecked) : row.tone !== "warn" || Boolean(financeApproval(row.key));
  const financeReady = financeRows.every((row) => row.key === "payment" || financeFine(row));
  const financeActs = can.confirm_payment || can.make_invoice;
  const askedPart = params.get("check") ?? "";
  const finPart: FinancePart | "paid" =
    picked === "paid"
      ? "paid"
      : picked === "finance" && (FINANCE_PARTS as readonly string[]).includes(askedPart)
        ? (askedPart as FinancePart)
        : !picked && opened === "paid"
          ? "paid"
          : (financeRows.find((row) => row.key !== "payment" && !financeFine(row))?.key ?? "payment");
  const openFin = (key: FinancePart) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        next.set("step", "finance");
        next.set("check", key);
        return next;
      },
      { replace: true },
    );
  async function approveFinance(key: FinancePart) {
    await act.run(async () => {
      await api(`/api/orders/${order.id}/checks/finance_${key}`, { body: {} });
    });
    await queries.invalidateQueries({ queryKey: ["orders"] });
  }
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
    // Management's whole-order answers, under its checks (each check sends back for itself too).
    { action: "send_back", label: "Send back", icon: Undo2, reason: true },
    { action: "reject", label: "Reject", icon: CircleX, danger: true, reason: true },
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
  const paidStep = steps.find((item) => item.key === "paid");
  const rowLook = (on: boolean) =>
    `flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left text-[13px] transition-colors ${on ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-950" : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"}`;
  const financeList = desk === "finance" && (
    <>
      {financeRows.map((item, index) => {
        const ok = financeFine(item);
        const approval = item.key === "payment" ? undefined : financeApproval(item.key);
        const note =
          item.key === "payment" && paymentChecked
            ? `Checked by ${paymentChecked.by} · ${item.note}`
            : approval
              ? `Approved by ${approval.by}: ${item.note}`
              : item.note;
        const row = (
          <button
            key={item.key}
            type="button"
            aria-current={finPart === item.key ? "step" : undefined}
            onClick={() => openFin(item.key)}
            className={rowLook(finPart === item.key)}
          >
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                ok
                  ? "bg-emerald-600 text-white"
                  : item.tone === "warn"
                    ? "bg-amber-400 text-white"
                    : "bg-white text-emerald-800 ring-2 ring-emerald-500"
              }`}
            >
              {ok ? <Check className="size-3.5" /> : item.tone === "warn" ? "!" : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              <span
                className={`block truncate text-[11px] font-normal ${ok || item.tone !== "warn" ? "text-slate-500" : "font-semibold text-amber-700"}`}
                title={note}
              >
                {note}
              </span>
            </span>
          </button>
        );
        const buttons =
          item.key === "payment"
            ? !paymentChecked && financeActs
              ? [
                  <button
                    key="go"
                    type="button"
                    disabled={money.busy || !financeReady}
                    title={
                      financeReady
                        ? can.confirm_payment
                          ? "The money is in the bank: record it and send the order to Dispatch"
                          : "Makes the invoice and sends the order to Dispatch"
                        : "Approve or hold what is marked first"
                    }
                    onClick={() =>
                      can.confirm_payment
                        ? setConfirmingPayment(true)
                        : money.send(`/api/finance/orders/${order.id}/invoice`, {})
                    }
                    className="rounded-lg bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    {can.confirm_payment ? "Confirm payment" : "Approve"}
                  </button>,
                ]
              : paymentChecked && can.undoConfirm
                ? [
                    <button
                      key="undo"
                      type="button"
                      disabled={money.busy}
                      onClick={() => money.send(`/api/finance/orders/${order.id}/undo-confirm`, {})}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Undo
                    </button>,
                  ]
                : []
            : !ok && financeActs
              ? [
                  <button
                    key="approve"
                    type="button"
                    disabled={act.busy}
                    onClick={() => approveFinance(item.key)}
                    className="rounded-lg bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    Approve
                  </button>,
                  can.hold && (
                    <button
                      key="hold"
                      type="button"
                      onClick={() =>
                        askWith("hold", { initial: `${item.label}: `, presets: [`${item.label}: ${item.note}`] })
                      }
                      className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Hold
                    </button>
                  ),
                ]
              : [];
        return buttons.length ? (
          <div key={item.key} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">{row}</div>
            <span className="flex shrink-0 flex-col gap-1">{buttons}</span>
          </div>
        ) : (
          row
        );
      })}
      {/* Finance's work after delivery: the money in (Aryan, 19 Nov: one list, not a second). */}
      {paidStep && (
        <button
          type="button"
          aria-current={finPart === "paid" ? "step" : undefined}
          onClick={() => open("paid")}
          className={rowLook(finPart === "paid")}
        >
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              paidStep.shape === "done" || paidStep.shape === "skipped"
                ? "bg-emerald-600 text-white"
                : paidStep.shape === "stopped"
                  ? "bg-rose-100 text-rose-700"
                  : finPart === "paid" || paidStep.shape === "now"
                    ? "bg-white text-emerald-800 ring-2 ring-emerald-500"
                    : "bg-slate-100 text-slate-500"
            }`}
          >
            {paidStep.shape === "done" || paidStep.shape === "skipped" ? (
              <Check className="size-3.5" />
            ) : (
              FINANCE_PARTS.length + 1
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{paidStep.label}</span>
            <span
              className={`block truncate text-[11px] font-normal ${paidStep.shape === "now" ? "font-semibold text-amber-700" : "text-slate-500"}`}
            >
              {paidStep.shape === "now" ? "Your step: the money in" : paidStep.shape === "later" ? "After delivery" : paidStep.who}
            </span>
          </span>
        </button>
      )}
      {financeActs && !paymentChecked && !financeReady && (
        <p className="px-1 pt-1 text-[11px] text-slate-500">
          Approve or hold what is marked, then {can.confirm_payment ? "Confirm payment" : "Approve"} on Payment.
        </p>
      )}
      {(money.problem || (act.problem && !asking)) && (
        <p className="px-1 pt-1 text-[11px] font-medium text-rose-700">
          {money.problem?.message ?? act.problem?.message}
        </p>
      )}
    </>
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
        {/* Read in this order: which order and where it stands, whom it is for and how much, what
            stops it, then its facts and papers. Colour is kept for the state and for what is pressed. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-2xl leading-8 font-bold tracking-tight text-ink">
                <span className="sr-only">Order </span>
                {order.code}
              </h1>
              <StatusPill status={order.status} label={order.statusLabel} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
              <Link
                to={`/customers/${order.customerId}`}
                className="text-base font-semibold text-ink hover:text-brand hover:underline"
              >
                {order.customer}
              </Link>
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
            <div className="mt-1 text-[13px] text-ink-2">
              {order.customerKind[0]?.toUpperCase() + order.customerKind.slice(1)}
              {" · "}
              <span className="text-ink">{pays}</span>
              {/* The order's type, picked first (19 Nov); Senior / PWD shows as its ID above. */}
              {order.type && order.type !== "senior_pwd" && !(order.type === "patient" && order.customerKind === "patient") && (
                <span title={ORDER_TYPE_HINT[order.type]}>
                  {" · "}
                  {order.type === "patient" && order.customerKind !== "patient"
                    ? "For one patient"
                    : ORDER_TYPE_LABEL[order.type]}
                  {order.type === "po" && order.customerPo ? ` · ${order.customerPo}` : ""}
                </span>
              )}
              {" · "}MedRep: {order.medrep} · Placed {timeLabel(order.submittedAt ?? order.createdAt)}
              {order.raisedBy !== order.medrep ? ` by ${order.raisedBy}` : ""}
              {/* The Division is in the facts below: the channel only when it says something else. */}
              {order.channel && order.channel !== order.division ? ` · ${order.channel}` : ""}
              {order.leadId && (
                <>
                  {" · "}
                  <Link to={`/leads/${order.leadId}`} className="font-medium text-brand hover:underline">
                    From the Online case{order.via ? ` ${order.via.code}` : ""}
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 sm:flex-col sm:items-end sm:text-right">
            <span className="text-2xl leading-8 font-bold tabular-nums text-ink">
              <span className="sr-only">Total </span>
              {peso(order.total)}
            </span>
            {data.money.invoice && <InvoiceStatus state={data.money.invoice.state} />}
          </div>
        </div>

        {/* 2. What stops it or needs someone, straight under whose order it is. */}
        {order.status === "draft" && (order.sentBackReason ?? order.flagReason) ? (
          // Sent back: Management's reason in the hub's yellow band, and the MedRep's two answers.
          <div className="mt-3 flex flex-col gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center">
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
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center">
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
        {waitsOnManagement && (
          <div
            className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3.5 py-2.5 text-sm ${toLookAt.length ? "bg-amber-50 text-amber-950" : "bg-slate-50 text-ink"}`}
          >
            {toLookAt.length > 0 ? (
              <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden="true" />
            ) : (
              <Hourglass className="size-4 shrink-0 text-ink-2" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              {toLookAt.length > 0 && <b>{toLookAt.map((item) => states[item.key].note).join(" · ")}. </b>}
              Waiting for Management to read it and approve.
            </span>
            {opened !== "management" && (
              <button
                type="button"
                onClick={() => open("management")}
                className="font-semibold text-brand-dark hover:underline pointer-coarse:min-h-11"
              >
                See the check
              </button>
            )}
          </div>
        )}
        {/* A guarantee letter's order: what the agency approves for our quotation, written when
            the letter is in (Aryan, 19 Nov). */}
        {order.type === "gl" && <GlLetter data={data} />}
        {/* An order with their PO and no signed PO yet: print it, have it signed, add its photo
            (Aryan, 19 Nov). */}
        {order.type === "po" &&
          !data.papers.some((paper) => paper.kind === "po") &&
          !["cancelled", "completed"].includes(order.status) && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-[13px] text-amber-950">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Their signed PO isn't on the order yet.</span>
                <Link
                  to={`/orders/${order.id}/purchase-order`}
                  className="font-semibold text-brand-dark underline"
                >
                  Print the purchase order
                </Link>
                <span>for them to sign and stamp, then add its photo:</span>
              </div>
              {can.addPaper && (
                <div className="mt-2">
                  <Papers data={data} kinds={["po"]} />
                </div>
              )}
            </div>
          )}
        {order.note && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
            <b>Customer remarks:</b> {order.note}
          </div>
        )}

        {shortTop && (
          // Every order page (Aryan, 19 Nov: "ours, not the hub's"): the facts that matter in one
          // line; the rest on a press.
          <>
            <div className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
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
                {order.division && (
                  <span>
                    Division {order.division}
                    {order.subDivision ? ` · ${order.subDivision}` : ""}
                    {order.headquarter && order.headquarter !== "N/A" ? ` · HQ ${order.headquarter}` : ""}
                  </span>
                )}
                {order.customerPo && <span>PO {order.customerPo}</span>}
                {order.doctor && <span>Dr. {order.doctor.replace(/^Dr\.?\s*/i, "")}</span>}
                <button
                  type="button"
                  onClick={() => setMoreOpen(!moreOpen)}
                  aria-expanded={moreOpen}
                  className="inline-flex items-center gap-1 font-semibold text-brand-dark hover:underline pointer-coarse:min-h-11"
                >
                  {moreOpen ? "Fewer details" : "More details"}
                  <ChevronDown className={`size-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link
                  to={`/orders/${order.id}/sales-order`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 pointer-coarse:h-11"
                >
                  <FileText className="size-3.5" aria-hidden="true" /> Sales order
                </Link>
                {/* A business's order: its purchase order, printed for them to sign (19 Nov). */}
                {order.customerKind !== "patient" && !order.patientOrder && (
                  <Link
                    to={`/orders/${order.id}/purchase-order`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 pointer-coarse:h-11"
                  >
                    <FileText className="size-3.5" aria-hidden="true" /> Purchase order
                  </Link>
                )}
                <SendToCustomer orderId={order.id} small />
                <RefundButton orderId={order.id} />
              </div>
            </div>
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
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] 2xl:grid-cols-[21rem_minmax(0,1fr)]">
          <nav aria-label="Steps" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:col-start-1 lg:row-start-1">
            <div className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
              {desk === "management" ? "Management checks" : "Finance checks"}
            </div>
            {desk === "management"
              ? [
                  // After approving: an Undo for a minute (Aryan, 19 Nov), above the checks.
                  undoLeft > 0 && (
                    <div
                      key="undo"
                      className="mb-1 flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-[13px]"
                    >
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-900">
                        <CircleCheck className="size-4" aria-hidden="true" /> Order approved
                      </span>
                      <button
                        type="button"
                        disabled={act.busy}
                        onClick={undoApproval}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Undo · {undoLeft}s
                      </button>
                    </div>
                  ),
                  ...CHECKS.map((item, index) => {
                    const on = item.key === check && checking;
                    const state = states[item.key];
                    const ok = fine(item.key);
                    const by = approvedChecks.get(item.key)?.by;
                    const note = by
                      ? state.ok
                        ? `${state.note} · approved by ${by}`
                        : `Approved by ${by}: ${state.note}`
                      : state.note;
                    const row = (
                      <button
                        key={item.key}
                        type="button"
                        aria-current={on ? "step" : undefined}
                        onClick={() => openCheck(item.key)}
                        className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left text-[13px] transition-colors ${on ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-950" : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"}`}
                      >
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            ok
                              ? "bg-emerald-600 text-white"
                              : state.ok
                                ? "bg-white text-emerald-800 ring-2 ring-emerald-500"
                                : "bg-amber-400 text-white"
                          }`}
                        >
                          {ok ? <Check className="size-3.5" /> : state.ok ? index + 1 : "!"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{checkLabel(item.key, data)}</span>
                          <span
                            className={`block truncate text-[11px] font-normal ${ok || state.ok ? "text-slate-500" : "font-semibold text-amber-700"}`}
                            title={note}
                          >
                            {note}
                          </span>
                        </span>
                      </button>
                    );
                    // Each check its own Approve, right in its row; Send back for what the system
                    // found (Aryan, 19 Nov). What it finds fine is ticked by itself; Documents
                    // waits for Management's own look (papers are read by hand), so Management
                    // presses at least once, and the last press approves the order.
                    return can.approve && !ok ? (
                      <div key={item.key} className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">{row}</div>
                        <span className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            disabled={act.busy}
                            onClick={() => approveOne(item.key)}
                            className="rounded-lg bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                          >
                            Approve
                          </button>
                          {can.send_back && !state.ok && (
                            <button
                              type="button"
                              onClick={() => askWith("send_back", sendBackFrom(data, item.key))}
                              className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              Send back
                            </button>
                          )}
                        </span>
                      </div>
                    ) : (
                      row
                    );
                  }),
                  // Every check fine and still waiting (its approval was refused): the reason
                  // and the press to try again.
                  can.approve && undoLeft <= 0 && CHECK_KEYS.every(fine) && (
                    <div key="retry" className="mt-1 flex flex-col gap-1 px-1">
                      {act.problem && !asking && (
                        <p className="text-[11px] font-medium text-rose-700">{act.problem.message}</p>
                      )}
                      <button
                        type="button"
                        disabled={act.busy}
                        onClick={approveOrder}
                        className="rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                      >
                        Approve the order
                      </button>
                    </div>
                  ),
                  can.approve && act.problem && !asking && !CHECK_KEYS.every(fine) && (
                    <p key="problem" className="mt-1 px-1 text-[11px] font-medium text-rose-700">
                      {act.problem.message}
                    </p>
                  ),
                ]
              : financeList}
            {otherButtons && (
              <div className="mt-1 flex flex-wrap gap-1.5 border-t border-slate-100 px-1 pt-2">{otherButtons}</div>
            )}
          </nav>
          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {desk === "management" ? (
              <ManagementStep
                data={data}
                act={act}
                onAsk={askWith}
                next={() => open("finance")}
                check={check}
                onCheck={openCheck}
                states={states}
                warehouse={stockPick}
                onWarehouse={setPickedWarehouse}
              />
            ) : finPart === "paid" ? (
              <PaidStep data={data} n={FINANCE_PARTS.length + 1} />
            ) : (
              <FinanceStep
                data={data}
                money={money}
                part={finPart}
                n={FINANCE_PARTS.indexOf(finPart) + 1}
                next={() => {
                  const after = FINANCE_PARTS[FINANCE_PARTS.indexOf(finPart) + 1];
                  if (after) openFin(after);
                  else open("paid");
                }}
              />
            )}
            <div className="mt-3">
              <Problem message={problem?.message} />
            </div>
            {/* While the order is this desk's to check, its steps cover it all (Aryan, 19 Nov: the
                tabs below repeated them); once it has moved on, they show where it went. */}
            {!atMyDesk && tabsBox}
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
            {/* The order's timeline up here, beside its checks (Aryan, 19 Nov), not at the foot. */}
            <Activity data={data} />
            <MoneyCard data={data} />
          </div>
        </div>
      )}
      {roadView && (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] 2xl:grid-cols-[21rem_minmax(0,1fr)]">
          <nav aria-label="Steps" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:col-start-1 lg:row-start-1">
            <div className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
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
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
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
                  {!waitsOnManagement && (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 font-semibold text-slate-900">
                      {order.approvedAt
                        ? `Approved${order.approvedBy ? ` by ${order.approvedBy}` : ""} · ${timeLabel(order.approvedAt)}`
                        : order.status === "pending_approval"
                          ? "Waiting for Management to read it and approve."
                          : order.status === "draft"
                            ? `Sent back: ${order.flagReason ?? "fix it and place it again"}`
                            : "Not approved."}
                    </p>
                  )}
                  <ul className="flex flex-col gap-1">
                    {CHECKS.map((item) => {
                      const state = states[item.key];
                      return (
                        <li
                          key={item.key}
                          className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${!state.ok && !order.approvedAt ? "bg-amber-50" : ""}`}
                        >
                          <span className={`mt-1 size-2.5 shrink-0 rounded-full ${state.ok ? "bg-emerald-500" : "bg-amber-400"}`} aria-hidden="true" />
                          <span className="min-w-0">
                            <span className={`text-slate-900 ${state.ok ? "font-medium" : "font-semibold"}`}>{checkLabel(item.key, data)}</span>
                            <span className={`block text-[12px] ${state.ok ? "text-slate-500" : "font-semibold text-amber-700"}`}>{state.note}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
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
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
            <Activity data={data} />
            <MoneyCard data={data} />
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
          initial={askFrom.initial}
          presets={asking === "hold" && desk === "dispatch" ? DISPATCH_HOLDS : (askFrom.presets ?? [])}
          onClose={() => {
            setAsking(null);
            setAskFrom({});
          }}
        />
      )}
      <DispatchDialogs ask={dispatching} onClose={() => setDispatching(null)} />
      {approveWindow && can.approve && (
        <ApproveDialog
          data={data}
          initial={stockPick}
          busy={act.busy}
          problem={act.problem?.message ?? null}
          onClose={() => setApproveWindow(false)}
          onApprove={async (choice) => {
            if (await act.act(order.id, "approve", choice)) {
              setApproveWindow(false);
              approvedNow();
            }
          }}
        />
      )}
      {confirmingPayment && (
        <ConfirmPaymentDialog
          orderId={order.id}
          code={order.code}
          customer={order.customer}
          total={order.total}
          onClose={() => setConfirmingPayment(false)}
        />
      )}
    </div>
  );
}
/** How long an approval can be undone with one press (Aryan, 19 Nov: "about 60 seconds"). */
const UNDO_SECONDS = 60;
/** Management's two looks of its check. */
const ORDER_LOOKS = [
  ["steps", "Steps"],
  ["glance", "One page"],
] as const;

/** A guarantee letter's number and the amount the agency approves, and writing them when the
 *  letter is in (the order's MedRep, Management, Finance). */
function GlLetter({ data }: { data: OrderDetail }) {
  const { order } = data;
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(order.glNumber ?? "");
  const [amount, setAmount] = useState(order.glAmount != null ? String(order.glAmount / 100) : "");
  const queries = useQueryClient();
  const action = useAction();
  const gap = order.glAmount != null ? order.total - order.glAmount : null;
  async function save() {
    const typed = amount.trim() ? Math.round(Number(amount.replace(/[,₱\s]/g, "")) * 100) : null;
    if (
      await action.run(async () => {
        await api(`/api/orders/${order.id}/gl`, { body: { number: number.trim() || null, amount: typed } });
      })
    ) {
      setEditing(false);
      await queries.invalidateQueries({ queryKey: ["orders"] });
    }
  }
  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2.5 text-[13px] text-sky-950">
      {!editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            Guarantee letter{order.source ? ` · ${order.source}` : ""}
            {order.glNumber ? ` · No. ${order.glNumber}` : ""}:
          </span>
          {order.glAmount != null ? (
            <span>
              <b>{peso(order.glAmount)}</b> approved
              {gap ? ` · ${peso(Math.abs(gap))} ${gap > 0 ? "less than" : "more than"} our quotation (${peso(order.total)})` : " · the whole quotation"}
              {order.glSetBy ? ` · written by ${order.glSetBy}` : ""}
            </span>
          ) : (
            <span>the amount isn't in yet: the agency writes it on the letter.</span>
          )}
          <button type="button" onClick={() => setEditing(true)} className="font-semibold text-sky-800 underline">
            {order.glAmount != null ? "Change" : "Write the letter's amount"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-sky-900">Letter number</span>
            <input value={number} onChange={(event) => setNumber(event.target.value)} className="h-9 w-40 rounded-lg border border-sky-200 bg-white px-2.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-sky-900">Amount on the letter (₱)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-9 w-40 rounded-lg border border-sky-200 bg-white px-2.5"
            />
          </label>
          <button
            type="button"
            disabled={action.busy}
            onClick={save}
            className="h-9 rounded-lg bg-brand px-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg px-2 text-sky-800 hover:underline">
            Cancel
          </button>
          {action.problem && <span className="w-full text-[12px] text-rose-700">{action.problem.message}</span>}
        </div>
      )}
    </div>
  );
}
