// What a seller does with a customer, drawn on the customer's page (rules in work.ts): the
// action bar on top and the dialogs it opens (log a call, add a visit) without leaving the page
// (medrep branch, 25 Nov).

import type { ClientPage } from "@2mg/api/mr";
import type { CustomerPage, Me } from "@2mg/api/types";
import { CalendarPlus, ChevronDown, ClipboardPlus, MapPin, MessageSquareWarning, PhoneCall, Plus, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMrMe } from "../mr/parts";
import { directions } from "../mr/parts";
import { useFieldClient } from "../mr/clients";
import { AddVisitsDialog } from "../mr/plan";
import { LogCall } from "../sellers/calls";
import { manilaToday } from "../team/range";
import { Dialog } from "../ui";
import { placesOrders } from "../auth";
import { ACTION_WORDS, type ActionKey, actionsFor, sellerKind } from "./work";

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
    dialogs,
    actions: actionsFor(seller, can),
  };
}

const ICON: Record<ActionKey, typeof Plus> = { order: Plus, visit: CalendarPlus, call: PhoneCall, directions: MapPin };

/** The buttons on top: the seller's most used first and in green, the rest beside it, the rarely
 *  used under More. */
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
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={`What to do with ${name}`}>
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
            <Icon className="size-4" aria-hidden="true" /> {key === "order" && index === 0 ? "New order for them" : ACTION_WORDS[key]}
          </button>
        );
      })}
      <details className="relative">
        <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          More <ChevronDown className="size-4" aria-hidden="true" />
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
