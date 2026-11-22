// The case header's two pieces from the old CRM: the payment road as three equal buttons with one
// line under them (frontend/components/assistance-road-selector.tsx), and the customer's orders
// folded to one line under the header (frontend/components/customer-orders.tsx).

import type { LeadCase, LeadInput, LeadRoad } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Lock } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiFailure, api } from "../api";
import { dayLabel, peso, manilaDay } from "../ui";
import { AGENCIES, roadOf } from "./parts";

/** What the case's own form holds, to change one or two of them. */
export function inputOf(lead: LeadCase["lead"]): LeadInput {
  return {
    source: lead.source,
    name: lead.name,
    relation: lead.relation,
    patientName: lead.patientName,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    address: lead.address,
    road: lead.road,
    agency: lead.agency,
    request: lead.request,
    assignedTo: lead.assignedTo,
  };
}

/** Saves a few of the case's details, keeping the rest as they are. */
export function useCaseDetails(data: LeadCase | undefined) {
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(changes: Partial<LeadInput>) {
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/leads/${data.lead.id}`, { body: { ...inputOf(data.lead), ...changes } });
      await queries.invalidateQueries({ queryKey: ["leads"] });
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save };
}

/** The road in words, so it can't be misread. */
export function roadWords(road: LeadRoad, agency: string | null): string {
  if (road === "gl") {
    const named = AGENCIES.find((item) => item.key === agency);
    return named ? `GL — ${named.short}` : "GL — choose the agency";
  }
  return roadOf(road)?.line ?? "";
}

/**
 * How they pay: Regular, Senior / PWD or GL (with the agency). Always shown, the same size and
 * place. Once the order is placed the picker is greyed with a lock and says why on hover.
 */
export function RoadPicker({
  data,
  locked,
  canChange,
}: {
  data: LeadCase;
  locked: string | null;
  canChange: boolean;
}) {
  const { lead } = data;
  const details = useCaseDetails(data);
  const off = Boolean(locked) || !canChange;
  const seniorPwd = lead.road === "senior" || lead.road === "pwd";
  // GL needs its agency first: the button opens the agency list, picking one saves the road.
  const [choosingGl, setChoosingGl] = useState(false);
  const button = (active: boolean) =>
    `rounded-lg px-2 py-1 font-semibold whitespace-nowrap transition ${off ? "pointer-events-none" : "disabled:cursor-wait"} ${
      active
        ? off
          ? "bg-slate-500 text-white"
          : "bg-emerald-700 text-white shadow-2xs"
        : off
          ? "text-slate-400"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;
  const pick = (road: LeadRoad, agency?: string | null) => {
    if (road === lead.road && (agency === undefined || agency === lead.agency)) return;
    void details.save({
      road,
      agency: road === "gl" ? ((agency ?? lead.agency) as LeadInput["agency"]) : null,
    });
  };
  return (
    <fieldset
      title={locked ?? (canChange ? "How they pay" : undefined)}
      className={`w-full min-w-0 shrink-0 rounded-xl border p-1 text-xs font-medium shadow-2xs sm:w-[21rem] ${
        off ? "cursor-not-allowed border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
      }`}
    >
      <legend className="sr-only">Payment road</legend>
      {/* A PAP case is always a guarantee letter: only its agency is chosen. */}
      <div className={`grid grid-cols-3 gap-1 ${lead.desk === "pap" ? "hidden" : ""}`}>
        <button
          type="button"
          disabled={details.busy || off}
          aria-pressed={lead.road === "regular"}
          onClick={() => pick("regular")}
          className={button(lead.road === "regular")}
        >
          Regular
        </button>
        {/* Senior and PWD are one road (18 Nov): same papers, discount and VAT. */}
        <button
          type="button"
          disabled={details.busy || off}
          aria-pressed={seniorPwd}
          onClick={() => !seniorPwd && pick("senior")}
          className={button(seniorPwd)}
        >
          Senior / PWD
        </button>
        <button
          type="button"
          disabled={details.busy || off}
          aria-pressed={lead.road === "gl"}
          onClick={() => (lead.agency ? pick("gl") : setChoosingGl(true))}
          className={button(lead.road === "gl" || choosingGl)}
        >
          GL
        </button>
      </div>
      <div className="mt-1 flex h-8 items-center gap-1.5 px-1">
        {off && locked && <Lock aria-hidden="true" className="size-3.5 shrink-0 text-slate-500" />}
        {(lead.road === "gl" || choosingGl) && !off ? (
          <select
            aria-label="GL agency"
            value={lead.agency ?? ""}
            disabled={details.busy}
            onChange={(event) => pick("gl", event.target.value)}
            className="h-7 w-full truncate rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            <option value="" disabled>
              Choose agency
            </option>
            {AGENCIES.map((agency) => (
              <option key={agency.key} value={agency.key}>
                {agency.label}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={`truncate text-[11px] font-semibold ${off ? "text-slate-600" : "text-slate-500"}`}
          >
            {roadWords(lead.road, lead.agency)}
          </span>
        )}
        {locked && <span className="sr-only">{locked}</span>}
      </div>
      {details.error && (
        <span role="alert" className="block px-2 py-1 text-[11px] font-medium text-rose-700">
          {details.error}
        </span>
      )}
    </fieldset>
  );
}

/** The customer, by their number: their orders and enquiries folded to one line, opened as a
 *  list; their customer page and their points on the same line. */
export function CustomerOrdersBar({ data, aside }: { data: LeadCase; aside?: React.ReactNode }) {
  const { history } = data;
  const [shown, setShown] = useState(true);
  const latest = history.orders[0];
  const number = history.number
    ? `0${history.number}`.replace(/^0(9\d{2})(\d{3})(\d{4})$/, "0$1 $2 $3")
    : null;
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-2xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => setShown((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <ChevronDown
            className={`size-4 shrink-0 text-slate-400 transition-transform ${shown ? "rotate-180" : ""}`}
          />
          <span className="shrink-0 font-semibold text-slate-900">
            {number ? `Orders on ${number}` : "This customer's orders"}
          </span>
          <span className="min-w-0 truncate text-xs text-slate-500">
            {[
              `${history.ordersTotal} ${history.ordersTotal === 1 ? "order" : "orders"}`,
              history.enquiriesTotal
                ? `${history.enquiriesTotal} other ${history.enquiriesTotal === 1 ? "enquiry" : "enquiries"}`
                : "",
              latest && !shown
                ? `latest ${latest.code} · ${peso(latest.total)} · ${latest.statusLabel}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
        {history.customerId && (
          <Link
            to={`/customers/${history.customerId}`}
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            Customer page
          </Link>
        )}
        {aside}
      </div>
      {shown && (history.orders.length > 0 || history.enquiries.length > 0) && (
        <div className="mt-2.5 space-y-2">
          {history.orders.length > 0 && (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {history.orders.map((order, index) => {
                const current = order.id === data.order?.id;
                return (
                  <li key={order.id}>
                    <Link
                      to={
                        order.leadId && order.leadId !== data.lead.id
                          ? `/leads/${order.leadId}`
                          : `/orders/${order.id}`
                      }
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs hover:bg-slate-50 ${current ? "bg-emerald-50/60" : ""}`}
                    >
                      <span className="w-14 shrink-0 font-semibold text-slate-900">
                        Order {history.ordersTotal - index}
                      </span>
                      <span className="w-20 shrink-0 text-slate-500">
                        {dayLabel(manilaDay(order.at))}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-700">
                        {order.medicines ?? order.code}
                      </span>
                      <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                        {peso(order.total)}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          order.status === "completed"
                            ? "bg-emerald-50 text-emerald-700"
                            : order.status === "cancelled"
                              ? "bg-slate-100 text-slate-500"
                              : "bg-sky-50 text-sky-700"
                        }`}
                      >
                        {order.statusLabel}
                      </span>
                      {order.invoiceBalance !== null && order.status === "completed" && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            order.invoiceBalance > 0
                              ? "bg-rose-50 text-rose-700"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {order.invoiceBalance > 0 ? `${peso(order.invoiceBalance)} due` : "Paid"}
                        </span>
                      )}
                      {current && (
                        <span className="text-[10px] font-semibold text-emerald-700">
                          this case
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {history.enquiries.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">Enquiries</span>
              {history.enquiries.map((enquiry) => (
                <Link
                  key={enquiry.id}
                  to={`/leads/${enquiry.id}`}
                  title={enquiry.request ?? undefined}
                  className={`rounded-md px-2 py-0.5 font-semibold hover:underline ${
                    enquiry.state === "lost"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {enquiry.code} · {dayLabel(manilaDay(enquiry.at))}
                  {enquiry.orderCode ? ` · ${enquiry.orderCode}` : ""}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
