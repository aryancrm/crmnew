// The top of an MD Telesales' Home (Rx Team & Training Playbook): the care groups waiting for
// first contact (15 minutes), and the refills coming due (in two days or due now) with what each
// patient took last time and the buttons to call and to order.

import type { CareGroups, Reorders } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Phone, Pill, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { CARD, dayLabel } from "../ui";
import { WaitingGroups } from "./care-groups";
import { EmptyState } from "../no-results";

export function TelesalesDay() {
  const groups = useQuery({ queryKey: ["care-groups"], queryFn: () => api<CareGroups>("/api/care-groups"), refetchInterval: 30_000 });
  const soon = useQuery({ queryKey: ["reorders", "soon", null, null], queryFn: () => api<Reorders>("/api/my/reorders?state=soon") });
  const due = useQuery({ queryKey: ["reorders", "due", null, null], queryFn: () => api<Reorders>("/api/my/reorders?state=due") });
  const refills = [...(due.data?.rows ?? []), ...(soon.data?.rows ?? [])].slice(0, 8);
  return (
    <>
      {groups.data && <WaitingGroups data={groups.data} />}
      <section className={`${CARD} min-w-0`}>
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Pill className="size-4 text-slate-500" /> Refills due
          </h3>
          <Link to="/to-call?state=soon" className="text-[12px] font-semibold text-emerald-700 hover:underline">
            All
          </Link>
        </header>
        {refills.length === 0 ? (
          <EmptyState title="No refill due today or in the next two days.">Customers whose refill is due soon show here to call.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {refills.map((row) => (
              <li key={row.customerId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <Link to={`/customers/${row.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
                    {row.name}
                  </Link>
                  <span className="block truncate text-[11.5px] text-slate-500">
                    {row.expectedOn <= (due.data?.today ?? "") ? "Due now" : `Due ${dayLabel(row.expectedOn)}`} · every {row.usual} days ·{" "}
                    {row.lastItems ?? `last order ${shortPeso(row.lastTotal)}`}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {row.phone && row.phone.replace(/\D/g, "").length >= 7 && (
                    <a
                      href={`tel:${row.phone.replace(/\s/g, "")}`}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                      <Phone className="size-3" /> Call
                    </a>
                  )}
                  <Link
                    to={`/orders/new?customer=${row.customerId}`}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white"
                  >
                    <ShoppingCart className="size-3" /> New order
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
