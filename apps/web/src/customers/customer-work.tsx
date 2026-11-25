// What a seller does with a customer, drawn on the customer's page (rules in work.ts): the
// action bar on top, What's next under the head, and the dialogs they open (log a call, add a
// visit) without leaving the page (medrep branch, 25 Nov).

import type { ClientPage } from "@2mg/api/mr";
import type { CustomerPage, Me } from "@2mg/api/types";
import { CalendarPlus, ClipboardPlus, Ellipsis, MapPin, MessageSquareWarning, PhoneCall, Plus, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMrMe } from "../mr/parts";
import { directions } from "../mr/parts";
import { useFieldClient } from "../mr/clients";
import { AddVisitsDialog } from "../mr/plan";
import { LogCall } from "../sellers/calls";
import { manilaToday } from "../team/range";
import { CARD, Dialog } from "../ui";
import { placesOrders } from "../auth";
import { ACTION_WORDS, type ActionKey, actionsFor, type NextStep, nextSteps, sellerKind } from "./work";

/** The customer kinds the field visits (doctors, hospitals, firms). */
const FIELD_KINDS = ["doctor", "hospital", "drugstore", "distributor"];
/** Who logs calls (the calls page's own rule). */
const CALL_ROLES = ["medrep", "team_lead", "manager", "online"];

/** Everything the page needs to guide this seller on this customer. */
export function useCustomerWork(me: Me | undefined, page: CustomerPage | undefined, id: number) {
  const navigate = useNavigate();
  const mr = useMrMe();
  const kind = page?.customer.kind ?? "";
  const field = useFieldClient(id, Boolean(mr.data?.access) && FIELD_KINDS.includes(kind)).data;
  const [doing, setDoing] = useState<"call" | "visit" | null>(null);
  const seller = me ? sellerKind(me) : "desk";
  const looking = Boolean(me?.viewedBy);
  const customer = page?.customer;
  const where = customer ? { pin: field?.client.pin ?? null, name: customer.name, city: customer.city, address: customer.address } : null;
  const can = {
    order: placesOrders(me) && !looking,
    visit: Boolean(field?.can.visit) && !looking,
    call: CALL_ROLES.includes(me?.role ?? "") && !looking,
    directions: kind !== "patient" && Boolean(where && (where.pin || where.address || where.city)),
  };
  const run = (key: ActionKey) => {
    if (!customer) return;
    if (key === "order") navigate(`/orders/new?customer=${customer.id}`);
    else if (key === "directions" && where) window.open(directions(where), "_blank", "noreferrer");
    else if (key === "call" || key === "visit") setDoing(key);
  };
  const close = () => setDoing(null);
  const dialogs: ReactNode = customer ? (
    <>
      {doing === "call" && (
        <Dialog title={`Log a call with ${customer.name}`} sub="What came of it, and when to call next." onClose={close}>
          <LogCall customer={{ id: customer.id, name: customer.name }} onSaved={close} />
        </Dialog>
      )}
      {doing === "visit" && field && <AddVisitsDialog day={manilaToday()} kind={field.client.kind} preset={[customer.id]} onClose={close} />}
    </>
  ) : null;
  return {
    seller,
    field,
    can,
    run,
    /** Directions to them, shown by their address (proximity), not among the buttons on top. */
    directionsHref: can.directions && where ? directions(where) : null,
    dialogs,
    actions: actionsFor(seller, can),
    steps: page ? nextSteps(page, field, can, manilaToday()) : [],
  };
}

const ICON: Record<ActionKey, typeof Plus> = { order: Plus, visit: CalendarPlus, call: PhoneCall, directions: MapPin };

/** The buttons on top: one primary in green (New order), at most two of the seller's own beside it,
 *  the rarely used under ⋯ More. On a phone the bar stays under the top bar while the page scrolls
 *  (the bottom is the phone's tabs), so the three are always in reach. */
export function ActionBar({
  actions,
  run,
  field,
  customerId,
  name,
}: {
  actions: ActionKey[];
  run: (key: ActionKey) => void;
  field: ClientPage | undefined;
  customerId: number;
  name: string;
}) {
  const [params, setParams] = useSearchParams();
  const fieldDetails = () => {
    const next = new URLSearchParams(params);
    next.set("profile", "1");
    setParams(next, { replace: true });
  };
  return (
    <div
      className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
      role="toolbar"
      aria-label={`What to do with ${name}`}
    >
      {actions.map((key, index) => {
        const Icon = ICON[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => run(key)}
            className={
              index === 0
                ? "inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
                : "inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
            }
          >
            <Icon className="size-4" aria-hidden="true" /> {ACTION_WORDS[key]}
          </button>
        );
      })}
      <details className="relative">
        <summary
          aria-label="More actions"
          title="More actions"
          className="inline-flex size-10 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        >
          <Ellipsis className="size-5" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 z-20 mt-1 flex w-60 flex-col rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {field?.can.profile && (
            <button type="button" onClick={fieldDetails} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">
              <SlidersHorizontal className="size-4 text-slate-400" /> Field details (best day, class)
            </button>
          )}
          <Link to={`/customers/${customerId}/statement`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
            <ClipboardPlus className="size-4 text-slate-400" /> Statement of account
          </Link>
          <Link to={`/complaints?report=1&customer=${customerId}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
            <MessageSquareWarning className="size-4 text-slate-400" /> Report a complaint or side-effect
          </Link>
        </div>
      </details>
    </div>
  );
}

const TONE: Record<NextStep["tone"], string> = {
  bad: "bg-rose-500",
  warn: "bg-amber-500",
  info: "bg-sky-500",
};

/** What waits with this customer now, the most urgent first, each with what to press. Inside
 *  the head card, right under the name (`flat`): the first thing read (26 Nov). */
export function NextCard({ steps, run, flat }: { steps: NextStep[]; run: (key: ActionKey) => void; flat?: boolean }) {
  return (
    <section className={flat ? "mt-4 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3" : `${CARD} p-4`} aria-labelledby="whats-next">
      <h2 id="whats-next" className="mb-2 text-sm font-bold text-slate-900">
        What's next with them
      </h2>
      {steps.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing waiting with them.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {steps.map((step) => (
            <li key={step.key} className="flex flex-wrap items-center gap-3 py-2">
              <span className={`size-2 shrink-0 rounded-full ${TONE[step.tone]}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{step.text}</span>
                {step.sub && <span className="block truncate text-xs text-slate-500">{step.sub}</span>}
              </span>
              {step.go &&
                ("action" in step.go ? (
                  <button type="button" onClick={() => run((step.go as { action: ActionKey }).action)} className={GO}>
                    {step.go.label}
                  </button>
                ) : "to" in step.go ? (
                  <Link to={step.go.to} className={GO}>
                    {step.go.label}
                  </Link>
                ) : (
                  <a href="#papers" className={GO}>
                    {step.go.label}
                  </a>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const GO = "shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-800";
