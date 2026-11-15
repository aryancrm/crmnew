// biome-ignore-all lint/a11y/useSemanticElements: The interactive journey stops are SVG groups; HTML buttons cannot be nested inside SVG geometry.
// The case as a map, brought over from the old CRM as it was (frontend/components/lead-journey.tsx):
// one line from the enquiry through the conversation, the quote and the prescription; then the
// road forks by how the patient pays — up through the agency (apply, then the letter verified),
// down through the senior / PWD discount, or straight on for a regular sale — and the roads meet
// again at the order and its delivery. The road this patient is on is drawn in colour, the others
// stay faint; a stop opens the step it belongs to. Its stops come from the old journey rules
// (`@2mg/api/journey`), fed by the case.

import { AGENCY_SHORT, type JourneyStopKey, journeyStops, quotationStale } from "@2mg/api/journey";
import { Check, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { peso, timeLabel } from "../ui";

type Row = Record<string, unknown>;

type Stop = {
  key: string;
  x: number;
  y: number;
  label: string;
  hint?: string;
  href?: string;
  detail?: string;
  documents?: string[];
  state: "done" | "current" | "todo";
};

// Compact branching map; the main road joins the three payment routes.
// the agency road above, the discount road below. After the delivery the GL
// road walks on (photo sent, claim, paid); the others end at Paid.
const MAIN_Y = 110;
const TOP_Y = 44;
const BOTTOM_Y = 180;
const X = {
  enquiry: 55,
  talk: 190,
  quote: 325,
  apply: 455,
  verified: 610,
  docs: 535,
  rx: 535,
  order: 750,
  packed: 860,
  pickup: 970,
  photo: 1080,
  claim: 1190,
  paid: 1300,
  /** Paid, on the roads that end at the delivery's payment. */
  paidShort: 1090,
};

const VIA: Record<string, string> = {
  email: "email",
  hand: "hand",
  messenger: "Messenger",
  other: "another way",
};

/** A saved date ("2026-11-05") as "5 Nov 2026". */
const shortDay = (d: unknown) =>
  d
    ? new Date(`${String(d).slice(0, 10)}T00:00:00+08:00`).toLocaleDateString("en-PH", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Manila",
      })
    : "";

export function LeadJourney({
  lead,
  rx,
  gl,
  order,
  files = [],
  times = {},
  onOpenDocuments,
  onOpenQuotation,
  onOpenClaim,
  onOpenAgency,
  onOpenDelivery,
  actions,
  channelLabel = null,
}: {
  /** Where the case came from (Messenger, the 2MG website, a call). */
  channelLabel?: string | null;
  lead: Row;
  rx: Row | null;
  gl: Row | null;
  order: Row | null;
  files?: {
    id: string;
    name: string;
    kind: string | null;
    status: string;
    mime?: string;
    createdAt?: string | Date;
  }[];
  /** When a stop happened (Philippine time shown), by stop key. */
  times?: Record<string, Date | string | undefined>;
  onOpenDocuments?: (kind?: string) => void;
  onOpenQuotation?: () => void;
  onOpenClaim?: () => void;
  onOpenAgency?: (tab: "letter" | "claim") => void;
  onOpenDelivery?: () => void;
  /** Case tools belong beside the map, rather than another hidden navigation area. */
  actions?: ReactNode;
}) {
  // A stop opens the step it belongs to.
  const selectStop = (key: string) => {
    if (["apply", "verified"].includes(key)) {
      if (lead.assistance === "gl") onOpenAgency?.("letter");
      return;
    }
    if (["photo", "claim", "paid"].includes(key)) return onOpenClaim?.();
    if (key === "order" || key === "packed" || key === "pickup") return onOpenDelivery?.();
    if (key === "rx" || key === "docs") return onOpenDocuments?.();
    onOpenQuotation?.();
  };
  const s = String(lead.state ?? "new");
  const lost = s === "lost";
  const quoted = !quotationStale(lead) && Boolean(String(lead.quote ?? "").trim());
  const talked = quoted || ["replied", "quoted", "docs", "ordered"].includes(s);
  // Over-the-counter only (or a business order): the rules say no Rx is needed.
  const rxNotNeeded = lead.rx_needed === false;
  const rxDone = rxNotNeeded || (rx !== null && ["approved", "ordered"].includes(String(rx.state)));
  const glState = gl ? String(gl.state) : null;
  const glDone =
    glState !== null && ["verified", "billed", "paid", "disputed", "closed"].includes(glState);
  const road: "agency" | "discount" | "regular" =
    lead.assistance === "gl"
      ? "agency"
      : ["senior", "pwd"].includes(String(lead.assistance))
        ? "discount"
        : "regular";
  const agency = AGENCY_SHORT[String(gl?.agency ?? lead.agency ?? "")] ?? "DSWD / PCSO / OVP / OP";
  const eligibilityKind = lead.assistance === "pwd" ? "pwd_id" : "osca_id";
  const docsApproved = files.some(
    (file) => file.kind === eligibilityKind && file.status === "approved",
  );

  const pickedUp = order?.state === "delivered";
  const claimed = ["billed", "paid", "disputed", "closed"].includes(glState ?? "");
  const settled =
    road === "agency" ? ["paid", "closed"].includes(glState ?? "") : lead.road_step === "done";
  // The GL claim after the hand-over: the photo of the patient with the
  // medicine, sent to the agency (a claim billed before this was recorded
  // counts as sent), then the claim, then the agency's money.
  const photoOnFile = files.some(
    (file) => file.kind === "pickup_photo" && file.status === "approved",
  );
  const photoSentOn = gl?.claim_sent_on ? String(gl.claim_sent_on) : "";
  const photoSentVia = VIA[String(gl?.claim_sent_via ?? "")] ?? "";
  const photoSent = Boolean(photoSentOn) || claimed;
  const quoteSent = quoted && Boolean(lead.quote_sent_via);

  // The flow as the desk runs it: inquiry → quotation in progress → quotation
  // sent → (the client applies; the GL is awarded; the GL and the papers reach
  // the office) → order → delivery with proof → invoice and payment. The stops,
  // their words, what is done and which one is current come from the shared
  // journey (`@bishnoi/platform/journey`, the website admin reads the same);
  // this adds where each is drawn, its hint and where it leads.
  const where: Record<JourneyStopKey, { x: number; y: number }> = {
    enquiry: { x: X.enquiry, y: MAIN_Y },
    talk: { x: X.talk, y: MAIN_Y },
    quote: { x: X.quote, y: MAIN_Y },
    apply: { x: X.apply, y: TOP_Y },
    docs: { x: X.docs, y: BOTTOM_Y },
    rx: { x: X.rx, y: MAIN_Y },
    verified: { x: X.verified, y: TOP_Y },
    order: { x: X.order, y: MAIN_Y },
    packed: { x: X.packed, y: MAIN_Y },
    pickup: { x: X.pickup, y: MAIN_Y },
    photo: { x: X.photo, y: MAIN_Y },
    claim: { x: X.claim, y: MAIN_Y },
    paid: { x: road === "agency" ? X.paid : X.paidShort, y: MAIN_Y },
  };
  const hints: Partial<Record<JourneyStopKey, string | undefined>> = {
    enquiry: channelLabel ?? "Enquiry",
    talk: talked ? undefined : "reply to them",
    quote: quoteSent
      ? "with the patient"
      : quoted
        ? "medicines & prices ready"
        : "medicines, quantity & price",
    apply:
      road !== "agency"
        ? undefined
        : gl
          ? gl.applied_on
            ? String(gl.applied_on)
            : undefined
          : "with our quotation",
    verified:
      road !== "agency"
        ? undefined
        : glState === "applying"
          ? gl?.expected_on
            ? `expected ${shortDay(gl.expected_on)}`
            : "waiting on the agency"
          : glState === "rejected"
            ? "rejected"
            : glState === "pending"
              ? "check the letter"
              : glDone
                ? peso(Number(gl?.amount ?? 0))
                : undefined,
    docs:
      road !== "discount"
        ? undefined
        : docsApproved
          ? undefined
          : order
            ? "checked on the order"
            : "verify before ordering",
    rx: rxNotNeeded ? "not needed" : rxDone ? "on file" : "prescription to file",
    order: order
      ? String(order.code ?? "")
      : road === "agency"
        ? glDone
          ? "claim the medicine"
          : undefined
        : rxDone || quoted
          ? "ready to place"
          : undefined,
    // Packing is the warehouse's step, once the order is confirmed
    packed: order?.packed_by__name
      ? `by ${String(order.packed_by__name)}`
      : order?.state === "confirmed" && !order.packed_at
        ? "pack the medicines"
        : undefined,
    pickup: pickedUp
      ? road === "agency"
        ? photoOnFile
          ? "photo on file"
          : "photo needed"
        : "check delivery proof"
      : order
        ? road === "discount" && !docsApproved
          ? "documents first"
          : "hand over, take the photo"
        : undefined,
    photo: photoSent
      ? photoSentOn
        ? [shortDay(photoSentOn), photoSentVia].filter(Boolean).join(" · ")
        : "sent"
      : pickedUp
        ? photoOnFile
          ? `send it to ${agency}`
          : "take the hand-over photo"
        : undefined,
    claim: claimed
      ? String(gl?.claim_ref ?? "") || "submitted"
      : photoSent
        ? "submit the claim"
        : undefined,
    paid:
      road === "agency"
        ? settled
          ? "agency paid"
          : claimed
            ? `waiting for ${agency}`
            : undefined
        : settled
          ? "payment received"
          : pickedUp
            ? "record payment"
            : undefined,
  };
  const journey = journeyStops({
    lead,
    rx,
    gl,
    order,
    approved: files
      .filter((file) => file.status === "approved" && file.kind)
      .map((f) => String(f.kind)),
  });
  const stops: Stop[] = journey.map((stop) => ({
    key: stop.key,
    ...where[stop.key],
    label: stop.label,
    hint: hints[stop.key],
    state: stop.state,
  }));
  // Keep the compact buttons and keyboard order consistent with the drawn route.
  stops.sort((a, b) => a.x - b.x);
  const at = (k: string) => stops.find((x) => x.key === k) as Stop;
  // When each stop happened: what the case passes, plus the letter's own claim dates.
  const stopTimes: Record<string, Date | string | undefined> = {
    ...times,
    verified: times.verified ?? times.awarded,
    packed: times.packed ?? (order?.packed_at ? String(order.packed_at) : undefined),
    ...(road === "agency"
      ? {
          photo: photoSentOn || undefined,
          claim: gl?.claim_submitted_on ? String(gl.claim_submitted_on) : undefined,
          paid: gl?.claim_paid_on ? String(gl.claim_paid_on) : undefined,
        }
      : {}),
  };
  const mapWidth = (road === "agency" ? X.paid : X.paidShort) + 60;
  const onRoad = (k: string) => journey.find((stop) => stop.key === k)?.onRoad ?? true;

  // The roads: a segment is lit once the stop it leaves is done and the stop it
  // leads to is reached (done or current), so the line fills up to where the
  // case stands — the same saved road step the rail below highlights.
  const line = (from: Stop, to: Stop) => {
    if (from.y === to.y) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    const mid = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`;
  };
  const reached = (from: string, to: string) =>
    at(from).state === "done" && at(to).state !== "todo";
  const seg = (from: string, to: string, road: "agency" | "discount" | "regular" | "main") => ({
    d: line(at(from), at(to)),
    road,
    lit: reached(from, to),
  });
  const roads: { d: string; road: "agency" | "discount" | "regular" | "main"; lit: boolean }[] = [
    seg("enquiry", "talk", "main"),
    seg("talk", "quote", "main"),
    seg("quote", "apply", "agency"),
    seg("apply", "verified", "agency"),
    seg("verified", "order", "agency"),
    seg("quote", "rx", "regular"),
    seg("rx", "order", "regular"),
    seg("quote", "docs", "discount"),
    seg("docs", "order", "discount"),
    seg("order", "packed", "main"),
    seg("packed", "pickup", "main"),
    ...(road === "agency"
      ? [
          seg("pickup", "photo", "main"),
          seg("photo", "claim", "main"),
          seg("claim", "paid", "main"),
        ]
      : [seg("pickup", "paid", "main")]),
  ];
  const roadOn = (r: (typeof roads)[number]["road"]) => r === "main" || r === road;

  const journeyColor =
    road === "agency"
      ? "stroke-violet-600"
      : road === "discount"
        ? "stroke-amber-500"
        : "stroke-emerald-600";
  const journeyLabelColor =
    road === "agency"
      ? "fill-violet-700"
      : road === "discount"
        ? "fill-amber-700"
        : "fill-emerald-700";

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">
          Case journey
          {lost && (
            <span className="ml-2 font-medium normal-case tracking-normal text-rose-700">
              Marked lost
            </span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>
      {!lost && (
        <>
          {/* Phones: the same road as a row of stops. */}
          <div
            role="group"
            className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:hidden"
            aria-label="Case journey steps"
          >
            {stops
              .filter((stop) => onRoad(stop.key))
              .map((stop, i) => {
                const at = stopTimes[stop.key];
                return (
                  <Fragment key={stop.key}>
                    {i > 0 && (
                      <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-slate-300" />
                    )}
                    <button
                      type="button"
                      onClick={() => selectStop(stop.key)}
                      className={`inline-flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${stop.state === "current" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-600"}`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {stop.state === "done" ? (
                          <Check className="size-3 text-emerald-700" />
                        ) : (
                          <span
                            className={`size-1.5 rounded-full ${stop.state === "current" ? "bg-amber-500" : "bg-slate-300"}`}
                          />
                        )}
                        {stop.label}
                      </span>
                      {at && stop.state !== "todo" ? (
                        <span className="pl-4 text-[9px] font-normal leading-none text-slate-400">
                          {timeLabel(String(at))}
                        </span>
                      ) : null}
                    </button>
                  </Fragment>
                );
              })}
          </div>
          <div className="hidden border-t border-slate-100 bg-slate-50/50 px-3 py-1 sm:block">
            <svg
              viewBox={`0 0 ${mapWidth} 248`}
              // One scale on every road (the shorter roads' map is narrower,
              // not drawn larger): at most 0.9 px per unit, as before.
              style={{ maxWidth: Math.round(mapWidth * 0.9) }}
              className="mx-auto block h-auto w-full"
              role="group"
              aria-label="Case journey. Select a stop to open its step."
            >
              <title>The patient's journey</title>
              {/* road names */}
              <text
                x={36}
                y={25}
                textAnchor="start"
                className={`text-[11px] font-semibold uppercase tracking-wider ${road === "agency" ? journeyLabelColor : "fill-slate-400"}`}
              >
                Guarantee letter
              </text>
              <text
                x={36}
                y={223}
                textAnchor="start"
                className={`text-[11px] font-semibold uppercase tracking-wider ${road === "discount" ? journeyLabelColor : "fill-slate-400"}`}
              >
                Senior / PWD discount
              </text>
              <text
                x={(X.quote + X.order) / 2}
                y={MAIN_Y - 24}
                textAnchor="middle"
                className={`text-[11px] font-semibold uppercase tracking-wider ${road === "regular" ? journeyLabelColor : "fill-slate-400"}`}
              >
                Regular
              </text>
              {roads.map((r) => (
                <path
                  key={r.d}
                  d={r.d}
                  fill="none"
                  strokeWidth={r.lit ? 3 : 2}
                  strokeLinecap="round"
                  className={
                    r.lit && roadOn(r.road)
                      ? journeyColor
                      : roadOn(r.road)
                        ? "stroke-slate-300"
                        : "stroke-slate-200"
                  }
                  strokeDasharray={roadOn(r.road) ? undefined : "4 6"}
                />
              ))}
              {stops.map((st) => {
                const faint = !onRoad(st.key);
                const r = st.state === "current" ? 17 : 14;
                return (
                  <g
                    key={st.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${st.label}, ${faint ? "alternate route" : st.state}${st.hint ? `. ${st.hint}` : ""}`}
                    onClick={() => selectStop(st.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectStop(st.key);
                      }
                    }}
                    className={`cursor-pointer transition-opacity ${faint ? "opacity-70" : ""} focus:outline-none`}
                  >
                    <title>
                      {st.label}
                      {stopTimes[st.key] && st.state !== "todo"
                        ? ` · ${timeLabel(String(stopTimes[st.key]))}`
                        : ""}
                    </title>
                    {st.state === "current" && (
                      <circle cx={st.x} cy={st.y} r={r + 6} className="fill-amber-100" />
                    )}
                    <circle
                      cx={st.x}
                      cy={st.y}
                      r={r}
                      className={
                        st.state === "done"
                          ? "fill-brand stroke-brand"
                          : st.state === "current"
                            ? "fill-white stroke-amber-500"
                            : "fill-white stroke-stone-300"
                      }
                      strokeWidth={2.5}
                    />
                    {st.state === "done" && (
                      <path
                        d={`M ${st.x - 6} ${st.y} l 4 4 l 8 -8`}
                        fill="none"
                        className="stroke-white"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                    <text
                      x={st.x}
                      y={st.y + (st.y === TOP_Y ? -26 : 34)}
                      textAnchor="middle"
                      className={`text-[11px] font-semibold ${
                        st.state === "done"
                          ? "fill-ink"
                          : st.state === "current"
                            ? "fill-amber-700"
                            : "fill-slate-500"
                      }`}
                    >
                      {st.label}
                    </text>
                    {(st.hint || st.key === "talk") && (
                      <text
                        x={st.x}
                        y={st.y + (st.y === TOP_Y ? -12 : 50)}
                        textAnchor="middle"
                        className="fill-slate-500 text-[9px]"
                      >
                        {st.hint ?? (st.key === "talk" ? "patient conversation" : "")}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
