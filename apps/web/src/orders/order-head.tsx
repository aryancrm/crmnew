// biome-ignore-all lint/a11y/useSemanticElements: The journey's stops are SVG groups; HTML buttons cannot be nested inside SVG geometry.
// The Online case page's three pieces on every order's page (Aryan, 27 Nov: "online desk screen is
// mature, can we add these … on other screens"), drawn as the case page draws them:
// - how the patient pays (Regular, Senior / PWD or GL with its agency): the case page's box
//   (online/case-head.tsx, RoadPicker) as it stands once the order is placed, greyed with a lock;
// - the order's journey as the case journey (online/journey.tsx): a patient's road forks by how they
//   pay (the guarantee letter above, the senior / PWD ID below, the prescription straight on), then
//   Management, Finance, packing, the delivery, a letter's claim on the agency and the payment. A
//   business's order walks the one road. The stops come from the order's own steps (order.tsx);
//   a stop opens its step;
// - the customer's orders folded to one line, as "Orders on <number>" under the case's head: a
//   patient's by their number, a business's by the customer on file, only those the reader may open.

import type { OrderDetail, OrderHistory } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AGENCIES, ROADS } from "../online/parts";
import { dayLabel, manilaDay, peso } from "../ui";
import { shortSpan } from "./parts";
import { type Shape, short } from "./steps/frame";

type Order = OrderDetail["order"];
/** How a patient pays, as the case page names the roads. */
export type PayRoad = "regular" | "senior" | "gl";
/** The order's steps as its page lists them ("Where the order is"). */
export type JourneyStep = {
  key: "placed" | "management" | "finance" | "dispatch" | "delivered" | "paid" | "proof";
  label: string;
  who: string;
  when: string | null;
  shape: Shape;
  took: { minutes: number; open: boolean } | null;
};
/** Where a stop stands: "missing" is a paper the road needs that isn't on the order yet. */
type State = "done" | "current" | "held" | "missing" | "todo";

/** A guarantee letter's agency: its case's (DSWD, PCSO, OVP, OP), else the one picked on the order
 *  (its source, as the letter's band on the order page says it). */
const agencyOf = (order: Order) =>
  AGENCIES.find((item) => item.key === order.glClaim?.agency)?.short ?? (order.source || null);

/** How the patient pays, from the order's type; null on a business's order (with or without their PO). */
export function payRoadOf(order: Order): PayRoad | null {
  if (order.type === "gl") return "gl";
  if (order.type === "senior_pwd" || order.relief) return "senior";
  if (order.type === "patient") return "regular";
  if (!order.type && (order.customerKind === "patient" || order.patientOrder)) return "regular";
  return null;
}

/** The case page's payment box as it shows once the order is placed: the road picked, greyed with a
 *  lock (it was picked when the order was placed), and the road in words. */
export function PayRoadBox({ order, road }: { order: Order; road: PayRoad }) {
  const agency = agencyOf(order);
  const words =
    road === "gl"
      ? agency
        ? `GL — ${agency}`
        : "Guarantee letter — the agency pays"
      : (ROADS.find((item) => item.key === road)?.line ?? "");
  const choice = (key: PayRoad, label: string) => (
    <span
      aria-current={road === key ? "true" : undefined}
      className={`rounded-lg px-2 py-1 text-center font-semibold whitespace-nowrap ${road === key ? "bg-slate-500 text-white" : "text-slate-400"}`}
    >
      {label}
    </span>
  );
  return (
    <div
      role="group"
      aria-label="How they pay"
      title="How they pay: picked when the order was placed"
      className="w-full min-w-0 shrink-0 cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-medium shadow-2xs sm:w-[21rem]"
    >
      <div className="grid grid-cols-3 gap-1">
        {choice("regular", "Regular")}
        {/* Senior and PWD are one road (18 Nov): same papers, discount and VAT. */}
        {choice("senior", "Senior / PWD")}
        {choice("gl", "GL")}
      </div>
      <div className="mt-1 flex h-8 items-center gap-1.5 px-1">
        <Lock aria-hidden="true" className="size-3.5 shrink-0 text-slate-500" />
        <span className="truncate text-[11px] font-semibold text-slate-600">{words}</span>
      </div>
    </div>
  );
}

type Stop = {
  /** Unique on the map (the papers stop is drawn once on each road). */
  key: string;
  /** The order's step it opens. */
  step: JourneyStep["key"];
  x: number;
  y: number;
  label: string;
  hint?: string;
  /** Said on hover when the hint is short of it (which papers are missing). */
  more?: string;
  took?: JourneyStep["took"];
  state: State;
  /** On a road this order isn't on: drawn faint, as the case journey draws the other roads. */
  faint: boolean;
};

const LANE = { top: 58, main: 130, bottom: 202 };
const stateOf = (shape: Shape): State =>
  shape === "done" || shape === "skipped"
    ? "done"
    : shape === "now"
      ? "current"
      : shape === "stopped"
        ? "held"
        : "todo";
/** A hint kept to one short line under its stop. */
const clip = (text: string | undefined, max = 26) =>
  text && text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function OrderJourney({
  data,
  steps,
  road,
  onOpen,
  canOpen,
}: {
  data: OrderDetail;
  steps: JourneyStep[];
  road: PayRoad | null;
  onOpen: (step: JourneyStep["key"]) => void;
  canOpen: (step: JourneyStep["key"]) => boolean;
}) {
  const { order } = data;
  const cancelled = order.status === "cancelled";
  const step = (key: JourneyStep["key"]) => steps.find((item) => item.key === key) as JourneyStep;
  const state = Object.fromEntries(steps.map((item) => [item.key, stateOf(item.shape)])) as Record<
    JourneyStep["key"],
    State
  >;
  // The road's papers (the prescription, the senior / PWD ID, the letter): fine once every paper
  // the order needs is on it, or Management read them or approved the order; a missing one is
  // flagged on its stop. The order itself stays where its steps say (Management reads them).
  const missing = data.paperList.filter((paper) => paper.needed && !paper.onFile);
  const papersDone = state.management === "done" || Boolean(order.papersCheckedAt) || missing.length === 0;
  const papers: State = papersDone ? "done" : "missing";
  // A guarantee letter's claim on the agency, sent by Finance after the delivery (22 Nov); a letter
  // already paid counts as claimed.
  const claimDone = Boolean(order.glClaim?.sentOn) || state.paid === "done";
  const claim: State = claimDone ? "done" : state.delivered === "done" ? "current" : "todo";
  if (road === "gl" && claim === "current" && state.paid === "current") state.paid = "todo";
  const agency = agencyOf(order) ?? "the agency";

  const papersHint =
    road === "gl" && order.glNumber
      ? [order.glNumber, order.glAmount ? peso(order.glAmount) : null].filter(Boolean).join(" · ")
      : !papersDone
        ? missing.length === 1
          ? `${missing[0]?.label} missing`
          : `${missing.length} papers missing`
        : order.papersCheckedBy
          ? `checked by ${order.papersCheckedBy}`
          : state.management === "done"
            ? "checked"
            : "on file";
  const hintOf = (item: JourneyStep) => {
    const done = stateOf(item.shape) === "done";
    const at =
      item.when && done ? (item.key === "delivered" ? dayLabel(item.when.slice(0, 10)) : short(item.when)) : null;
    return [item.who, at].filter(Boolean).join(" · ");
  };

  const X = road
    ? {
        placed: 80,
        papers: 235,
        management: 390,
        finance: 535,
        dispatch: 680,
        delivered: 825,
        claim: 970,
        paid: road === "gl" ? 1115 : 970,
      }
    : { placed: 80, papers: 0, management: 230, finance: 380, dispatch: 530, delivered: 680, claim: 0, paid: 830 };
  const main = road ? LANE.main : 34;
  const height = road ? 268 : 106;
  const width = X.paid + 75;

  const stops: Stop[] = [
    { key: "placed", step: "placed", x: X.placed, y: main, label: "Placed", hint: hintOf(step("placed")), state: state.placed, faint: false },
  ];
  if (road)
    for (const lane of ["gl", "regular", "senior"] as const) {
      const on = lane === road;
      stops.push({
        key: `papers-${lane}`,
        step: "management",
        x: X.papers,
        y: lane === "gl" ? LANE.top : lane === "senior" ? LANE.bottom : LANE.main,
        label: lane === "gl" ? "Letter approved" : lane === "senior" ? "Senior / PWD ID & Rx" : "Rx verification",
        hint: on ? papersHint : undefined,
        more: on && !papersDone ? `Missing: ${missing.map((paper) => paper.label).join(", ")}` : undefined,
        state: on ? papers : "todo",
        faint: !on,
      });
    }
  for (const key of ["management", "finance", "dispatch", "delivered"] as const)
    stops.push({
      key,
      step: key,
      x: X[key],
      y: main,
      label: step(key).label,
      hint: hintOf(step(key)),
      took: step(key).took,
      state: state[key],
      faint: false,
    });
  if (road === "gl")
    stops.push({
      key: "claim",
      step: "paid",
      x: X.claim,
      y: main,
      label: "Claim",
      hint: claimDone
        ? [order.glClaim?.sentOn ? dayLabel(order.glClaim.sentOn) : "sent", order.glClaim?.ref].filter(Boolean).join(" · ")
        : claim === "current"
          ? `Finance sends it to ${agency}`
          : undefined,
      state: claim,
      faint: false,
    });
  stops.push({
    key: "paid",
    step: "paid",
    x: X.paid,
    y: main,
    label: "Paid",
    hint: hintOf(step("paid")),
    took: step("paid").took,
    state: state.paid,
    faint: false,
  });

  const at = (key: string) => stops.find((stop) => stop.key === key) as Stop;
  const path = (from: Stop, to: Stop) => {
    if (from.y === to.y) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    const mid = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`;
  };
  // A road is lit up to where the order stands: the stop it leaves is passed (done, or papers
  // flagged missing that Management reads on its check) and the next is reached.
  const passed = (stop: Stop) => stop.state === "done" || stop.state === "missing";
  const segment = (from: string, to: string, lane: PayRoad | "main") => ({
    d: path(at(from), at(to)),
    on: lane === "main" || lane === road,
    lit: (lane === "main" || lane === road) && passed(at(from)) && at(to).state !== "todo",
  });
  const roads = [
    ...(road
      ? (["gl", "regular", "senior"] as const).flatMap((lane) => [
          segment("placed", `papers-${lane}`, lane),
          segment(`papers-${lane}`, "management", lane),
        ])
      : [segment("placed", "management", "main")]),
    segment("management", "finance", "main"),
    segment("finance", "dispatch", "main"),
    segment("dispatch", "delivered", "main"),
    ...(road === "gl"
      ? [segment("delivered", "claim", "main"), segment("claim", "paid", "main")]
      : [segment("delivered", "paid", "main")]),
  ];
  const lineColor = road === "gl" ? "stroke-violet-600" : road === "senior" ? "stroke-amber-500" : "stroke-emerald-600";
  const nameColor = (lane: PayRoad) =>
    lane !== road ? "fill-slate-400" : lane === "gl" ? "fill-violet-700" : lane === "senior" ? "fill-amber-700" : "fill-emerald-700";
  const open = (stop: Stop) => {
    if (!stop.faint && canOpen(stop.step)) onOpen(stop.step);
  };
  const tookWords = (took: NonNullable<JourneyStep["took"]>) =>
    took.minutes < 1
      ? took.open
        ? "just came"
        : "took <1m"
      : `${took.open ? "waiting" : "took"} ${shortSpan(took.minutes)}`;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-xs font-bold tracking-wider text-stone-500 uppercase">
          Order journey
          {cancelled && <span className="ml-2 font-medium tracking-normal text-rose-700 normal-case">Cancelled</span>}
        </h2>
      </div>
      {!cancelled && (
        <>
          {/* Phones: the same road as a row of stops. */}
          <div
            role="group"
            aria-label="Order journey steps"
            className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:hidden"
          >
            {stops
              .filter((stop) => !stop.faint)
              .map((stop, index) => (
                <Fragment key={stop.key}>
                  {index > 0 && <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-slate-300" />}
                  <button
                    type="button"
                    disabled={!canOpen(stop.step)}
                    onClick={() => open(stop)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${
                      stop.state === "current" || stop.state === "missing"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : stop.state === "held"
                          ? "border-rose-300 bg-rose-50 text-rose-800"
                          : "border-slate-200 text-slate-600"
                    }`}
                  >
                    {stop.state === "done" ? (
                      <Check className="size-3 text-emerald-700" />
                    ) : stop.state === "missing" || stop.state === "held" ? (
                      <span className={`font-bold ${stop.state === "held" ? "text-rose-600" : "text-amber-600"}`}>!</span>
                    ) : (
                      <span
                        className={`size-1.5 rounded-full ${stop.state === "current" ? "bg-amber-500" : "bg-slate-300"}`}
                      />
                    )}
                    {stop.label}
                  </button>
                </Fragment>
              ))}
          </div>
          <div className="hidden border-t border-slate-100 bg-slate-50/50 px-3 py-1 sm:block">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              // One scale on every order, as the case journey (at most 0.9 px per unit).
              style={{ maxWidth: Math.round(width * 0.9) }}
              className="mx-auto block h-auto w-full"
              role="group"
              aria-label="Order journey. Select a stop to open its step."
            >
              <title>The order's journey</title>
              {road && (
                <>
                  <text x={8} y={16} textAnchor="start" className={`text-[11px] font-semibold tracking-wider uppercase ${nameColor("gl")}`}>
                    Guarantee letter
                  </text>
                  <text x={X.papers} y={LANE.main - 26} textAnchor="middle" className={`text-[11px] font-semibold tracking-wider uppercase ${nameColor("regular")}`}>
                    Regular
                  </text>
                  <text x={8} y={height - 6} textAnchor="start" className={`text-[11px] font-semibold tracking-wider uppercase ${nameColor("senior")}`}>
                    Senior / PWD discount
                  </text>
                </>
              )}
              {roads.map((segmentRow) => (
                <path
                  key={segmentRow.d}
                  d={segmentRow.d}
                  fill="none"
                  strokeWidth={segmentRow.lit ? 3 : 2}
                  strokeLinecap="round"
                  className={segmentRow.lit ? lineColor : segmentRow.on ? "stroke-slate-300" : "stroke-slate-200"}
                  strokeDasharray={segmentRow.on ? undefined : "4 6"}
                />
              ))}
              {stops.map((stop) => {
                const radius = stop.state === "current" || stop.state === "held" ? 17 : 14;
                const above = road !== null && stop.y === LANE.top;
                const clickable = !stop.faint && canOpen(stop.step);
                return (
                  <g
                    key={stop.key}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    aria-label={`${stop.label}, ${stop.faint ? "another road" : stop.state === "todo" ? "later" : stop.state === "missing" ? "a paper missing" : stop.state}${stop.hint ? `. ${stop.hint}` : ""}`}
                    onClick={() => open(stop)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        open(stop);
                      }
                    }}
                    className={`${clickable ? "cursor-pointer" : ""} ${stop.faint ? "opacity-70" : ""} focus:outline-none`}
                  >
                    <title>{[stop.label, stop.more ?? stop.hint].filter(Boolean).join(" · ")}</title>
                    {(stop.state === "current" || stop.state === "held") && (
                      <circle cx={stop.x} cy={stop.y} r={radius + 6} className={stop.state === "held" ? "fill-rose-100" : "fill-amber-100"} />
                    )}
                    <circle
                      cx={stop.x}
                      cy={stop.y}
                      r={radius}
                      strokeWidth={2.5}
                      className={
                        stop.state === "done"
                          ? "fill-brand stroke-brand"
                          : stop.state === "current" || stop.state === "missing"
                            ? "fill-white stroke-amber-500"
                            : stop.state === "held"
                              ? "fill-white stroke-rose-500"
                              : "fill-white stroke-stone-300"
                      }
                    />
                    {stop.state === "done" && (
                      <path
                        d={`M ${stop.x - 6} ${stop.y} l 4 4 l 8 -8`}
                        fill="none"
                        className="stroke-white"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                    {(stop.state === "held" || stop.state === "missing") && (
                      <text
                        x={stop.x}
                        y={stop.y + 4}
                        textAnchor="middle"
                        className={`text-[12px] font-bold ${stop.state === "held" ? "fill-rose-600" : "fill-amber-600"}`}
                      >
                        !
                      </text>
                    )}
                    <text
                      x={stop.x}
                      y={stop.y + (above ? -44 : 34)}
                      textAnchor="middle"
                      className={`text-[11px] font-semibold ${
                        stop.state === "done"
                          ? "fill-ink"
                          : stop.state === "current" || stop.state === "missing"
                            ? "fill-amber-700"
                            : stop.state === "held"
                              ? "fill-rose-700"
                              : "fill-slate-500"
                      }`}
                    >
                      {stop.label}
                    </text>
                    {stop.hint && (
                      <text x={stop.x} y={stop.y + (above ? -31 : 48)} textAnchor="middle" className="fill-slate-500 text-[9px]">
                        {clip(stop.hint)}
                      </text>
                    )}
                    {stop.took && !above && (
                      <text
                        x={stop.x}
                        y={stop.y + 61}
                        textAnchor="middle"
                        className={`text-[9px] font-semibold ${stop.took.open ? "fill-amber-700" : "fill-slate-400"}`}
                      >
                        {tookWords(stop.took)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </section>
  );
}

/** The customer's orders folded to one line under the order's head, opened as a list: a patient's
 *  on their number, a business's on the customer on file (the case page's bar). */
export function CustomerOrders({ orderId }: { orderId: number }) {
  const query = useQuery({
    queryKey: ["orders", "history", orderId],
    queryFn: () => api<OrderHistory>(`/api/orders/${orderId}/history`),
  });
  const [open, setOpen] = useState<boolean | null>(null);
  const history = query.data;
  if (!history) return null;
  // Open at first while the list is short, as on the case page; a long one starts folded.
  const shown = open ?? history.orders.length <= 5;
  const latest = history.orders[0];
  const number = history.number
    ? `0${history.number}`.replace(/^0(9\d{2})(\d{3})(\d{4})$/, "0$1 $2 $3")
    : null;
  const listed = history.orders.slice(0, 10);
  const more = history.ordersTotal - listed.length;
  return (
    <section className="mt-4 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-2xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => setOpen(!shown)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <ChevronDown
            className={`size-4 shrink-0 text-slate-400 transition-transform ${shown ? "rotate-180" : ""}`}
          />
          {/* Who they are: a patient by their mobile number, a business by its own number
              (CUS-00012, Aryan 27 Nov: "give hospitals and drugstores a unique number too"). */}
          <span className="shrink-0 font-semibold text-slate-900">
            {number ? `Orders on ${number}` : history.code ? `Orders on ${history.code}` : `Orders of ${history.customer}`}
          </span>
          <span className="min-w-0 truncate text-xs text-slate-500">
            {[
              !number && history.code ? history.customer : "",
              `${history.ordersTotal} ${history.ordersTotal === 1 ? "order" : "orders"}`,
              latest && !shown ? `latest ${latest.code} · ${peso(latest.total)} · ${latest.statusLabel}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
        <Link to={`/customers/${history.customerId}`} className="text-xs font-medium text-blue-700 hover:underline">
          Customer page
        </Link>
      </div>
      {shown && listed.length > 0 && (
        <div className="mt-2.5 space-y-2">
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {listed.map((row, index) => {
              const current = row.id === orderId;
              return (
                <li key={row.id}>
                  <Link
                    to={`/orders/${row.id}`}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs hover:bg-slate-50 ${current ? "bg-emerald-50/60" : ""}`}
                  >
                    <span className="w-14 shrink-0 font-semibold text-slate-900">Order {history.ordersTotal - index}</span>
                    <span className="w-20 shrink-0 text-slate-500">{dayLabel(manilaDay(row.at))}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-700">{row.medicines ?? row.code}</span>
                    <span className="shrink-0 font-semibold text-slate-900 tabular-nums">{peso(row.total)}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        row.status === "completed"
                          ? "bg-emerald-50 text-emerald-700"
                          : row.status === "cancelled"
                            ? "bg-slate-100 text-slate-500"
                            : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {row.statusLabel}
                    </span>
                    {row.invoiceBalance !== null && row.status === "completed" && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          row.invoiceBalance > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {row.invoiceBalance > 0 ? `${peso(row.invoiceBalance)} due` : "Paid"}
                      </span>
                    )}
                    {current && <span className="text-[10px] font-semibold text-emerald-700">this order</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <Link to={`/customers/${history.customerId}`} className="block text-xs font-medium text-blue-700 hover:underline">
              {more} more on the customer page
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
