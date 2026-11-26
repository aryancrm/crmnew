// A refill call, start to end (26 Nov: "guide the MedRep to the next proper screen"). Opened from
// Refills due (`?from=refills&state=…`), the customer's page leads with the call: when they need
// their medicines and what they took last, (1) call them, (2) what they said: ordering now (the
// order form, then back to the list), not yet (the day their medicines run out), or no answer
// (log the call and when to call back), then (3) the next one on the same list.

import type { CustomerPage, Reorders, ReorderState } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, ChevronLeft, Phone, PhoneMissed, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { dayLabel } from "../ui";
import { RefillCard } from "./refill";

export const STATE_LABEL: Record<ReorderState, string> = {
  soon: "In 2 days",
  due: "Due now",
  late: "Late",
  at_risk: "At risk",
  lost: "Lost",
};
const STATES = Object.keys(STATE_LABEL) as ReorderState[];

/** Where a refill call came from, read from the page's address; null when it didn't. */
export function refillFrom(params: URLSearchParams): ReorderState | null {
  if (params.get("from") !== "refills") return null;
  const state = params.get("state") as ReorderState | null;
  return state && STATES.includes(state) ? state : "due";
}
/** The address that keeps a page in the refill flow. */
export const inRefills = (path: string, state: ReorderState) =>
  `${path}${path.includes("?") ? "&" : "?"}from=refills&state=${state}`;
/** The list itself, on the same tab. */
export const refillsList = (state: ReorderState) => `/to-call?state=${state}`;

/** The same list Refills due shows (its query, so it is read once). */
export function useRefills(state: ReorderState) {
  return useQuery({
    queryKey: ["reorders", state, null, null],
    queryFn: () => api<Reorders>(`/api/my/reorders?${new URLSearchParams({ state })}`),
  });
}

const STEP = "flex gap-3 py-3";
const NUM = "grid size-6 shrink-0 place-items-center rounded-full bg-emerald-600 text-[12px] font-bold text-white";
const CHOICE =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-800";

export function RefillFlow({
  data,
  state,
  onCall,
  canOrder,
}: {
  data: CustomerPage;
  state: ReorderState;
  /** Opens Log a call (the page's own dialog). */
  onCall: () => void;
  canOrder: boolean;
}) {
  const navigate = useNavigate();
  const list = useRefills(state).data;
  const [setting, setSetting] = useState(false);
  const { customer, refill } = data;
  const rows = list?.rows ?? [];
  const at = rows.findIndex((row) => row.customerId === customer.id);
  const row = at >= 0 ? rows[at] : undefined;
  const next = rows.slice(at + 1).find((one) => one.customerId !== customer.id) ?? rows.find((one, n) => n < at);
  const phone = customer.phone && customer.phone.replace(/\D/g, "").length >= 7 ? customer.phone : null;
  const due = refill.nextOn ?? row?.expectedOn ?? null;

  return (
    <section aria-labelledby="refill-call" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="refill-call" className="text-sm font-bold text-slate-900">
          Refill call
          <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
            Refills due · {STATE_LABEL[state]}
            {at >= 0 ? ` · ${at + 1} of ${rows.length}` : ""}
          </span>
        </h2>
        <Link to={refillsList(state)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-800 hover:underline">
          <ChevronLeft className="size-3.5" /> Back to the list
        </Link>
      </div>
      <p className="mt-1 text-[13px] text-slate-600">
        {due ? (
          <>
            Needs their medicines <span className="font-semibold text-slate-900">{dayLabel(due)}</span>
          </>
        ) : (
          "No refill day yet"
        )}
        {refill.usual ? ` · usually every ${refill.usual} days` : ""}
        {row?.lastItems ? (
          <>
            {" · "}Last: <span className="font-medium text-slate-800">{row.lastItems}</span>
          </>
        ) : null}
      </p>

      <ol className="mt-1 divide-y divide-emerald-100">
        <li className={STEP}>
          <span className={NUM}>1</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900">Call them</div>
            <div className="mt-1.5">
              {phone ? (
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={CHOICE}>
                  <Phone className="size-3.5" /> {phone}
                </a>
              ) : (
                <span className="text-[13px] text-slate-500">No phone number yet: add it with Edit details above.</span>
              )}
            </div>
          </div>
        </li>
        <li className={STEP}>
          <span className={NUM}>2</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900">What did they say?</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {canOrder && (
                <button
                  type="button"
                  onClick={() => navigate(inRefills(`/orders/new?customer=${customer.id}`, state))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90"
                >
                  <Plus className="size-3.5" /> Ordering now: new order
                </button>
              )}
              {refill.canSet && refill.lastOn && (
                <button type="button" onClick={() => setSetting((on) => !on)} className={CHOICE}>
                  <CalendarClock className="size-3.5" /> Not yet: when they run out
                </button>
              )}
              <button type="button" onClick={onCall} className={CHOICE}>
                <PhoneMissed className="size-3.5" /> No answer or call back: log the call
              </button>
            </div>
            {setting && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
                <RefillCard
                  plain
                  refill={refill}
                  post={`/api/customers/${customer.id}/refill`}
                  onSaved={() => setSetting(false)}
                />
              </div>
            )}
          </div>
        </li>
        <li className={STEP}>
          <span className={NUM}>3</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900">Next</div>
            <div className="mt-1.5">
              {next ? (
                <Link to={inRefills(`/customers/${next.customerId}`, state)} className={CHOICE}>
                  {next.name}
                  <span className="font-normal text-slate-500">
                    {next.lastItems ? ` · ${next.lastItems}` : ""}
                  </span>
                  <ArrowRight className="size-3.5" />
                </Link>
              ) : (
                <span className="text-[13px] text-slate-500">
                  That's everyone in {STATE_LABEL[state]}.{" "}
                  <Link to={refillsList(state)} className="font-semibold text-emerald-800 hover:underline">
                    Back to the list
                  </Link>
                </span>
              )}
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}
