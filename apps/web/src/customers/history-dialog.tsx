// A customer's history at a glance, opened from an order card while deciding on it: what they
// bought, what they owe and how late, their last orders and the medicines they take. When they owe
// money past its due day, Management can put the order on hold from here, with the amount as the
// reason. The whole story stays on the customer's page.

import type { CustomerPage } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { CirclePause, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { count, Dialog, dayLabel, peso } from "../ui";

const LATE_TONE = "border-rose-200 bg-rose-50 text-rose-800";

export function CustomerHistoryDialog({
  customerId,
  name,
  onHold,
  onClose,
}: {
  customerId: number;
  name: string;
  /** Put the order being decided on hold, with a reason already written. */
  onHold?: (reason: string) => void;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["customers", "page", customerId],
    queryFn: () => api<CustomerPage>(`/api/customers/${customerId}/page`),
  });
  const data = query.data;
  const late =
    data?.invoices.filter((invoice) => invoice.state.overdueDays > 0 && invoice.balance > 0) ?? [];
  const oldest = late.reduce<string | null>(
    (first, invoice) => (!first || invoice.dueOn < first ? invoice.dueOn : first),
    null,
  );
  const lateDays = oldest
    ? Math.max(0, Math.round((Date.now() - Date.parse(`${oldest}T00:00:00+08:00`)) / 86_400_000))
    : 0;

  return (
    <Dialog
      title={`${name} · history`}
      sub="What they bought, what they owe and how late"
      onClose={onClose}
      wide
    >
      {!data ? (
        <div className="py-8 text-center text-sm text-slate-500">
          {query.isError
            ? "Couldn't read their history. Close and try again."
            : "Reading their history…"}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              {
                label: "Orders",
                value: count(data.totals.orders),
                sub: data.totals.lastOrderAt
                  ? `last ${dayLabel(data.totals.lastOrderAt.slice(0, 10))}`
                  : "none yet",
              },
              {
                label: "Bought",
                value: peso(data.totals.bought),
                sub: `paid ${peso(data.totals.paid)}`,
              },
              {
                label: "Owes us",
                value: peso(data.totals.owed),
                sub: data.totals.owed ? "on open invoices" : "nothing",
              },
              {
                label: "Overdue",
                value: peso(data.totals.overdue),
                sub: data.totals.overdue ? `oldest ${lateDays} days late` : "nothing late",
                late: data.totals.overdue > 0,
              },
            ].map((tile) => (
              <div
                key={tile.label}
                className={`rounded-xl border px-3 py-2.5 ${tile.late ? LATE_TONE : "border-slate-200/90 bg-white"}`}
              >
                <div
                  className={`text-[11px] font-semibold ${tile.late ? "text-rose-700" : "text-slate-500"}`}
                >
                  {tile.label}
                </div>
                <div className="mt-0.5 truncate text-lg font-bold tracking-tight tabular-nums">
                  {tile.value}
                </div>
                <div
                  className={`truncate text-[11px] ${tile.late ? "text-rose-700/80" : "text-slate-400"}`}
                >
                  {tile.sub}
                </div>
              </div>
            ))}
          </div>

          {late.length > 0 && (
            <section className="rounded-xl border border-rose-200 bg-white">
              <h3 className="border-b border-rose-100 bg-rose-50/60 px-3 py-2 text-xs font-semibold text-rose-800">
                Invoices past their due day
              </h3>
              <ul className="divide-y divide-slate-100 text-[13px]">
                {late.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 truncate">
                      <Link
                        to={`/invoices/${invoice.id}`}
                        className="font-semibold text-slate-900 hover:underline"
                      >
                        {invoice.code}
                      </Link>{" "}
                      <span className="text-slate-500">
                        · {invoice.orderCode} · due {dayLabel(invoice.dueOn)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-rose-700 tabular-nums">
                      {peso(invoice.balance)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-1.5 text-xs font-bold tracking-wider text-stone-500 uppercase">
                Last orders
              </h3>
              {data.orders.length === 0 ? (
                <p className="text-[13px] text-slate-500">No order before this one.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200/90 text-[13px]">
                  {data.orders.slice(0, 6).map((order) => (
                    <li key={order.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          to={`/orders/${order.id}`}
                          className="truncate font-semibold text-slate-900 hover:underline"
                        >
                          {order.code}
                        </Link>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {peso(order.total)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate">
                          {dayLabel(order.at.slice(0, 10))} · {order.statusLabel}
                        </span>
                        {order.invoice && order.invoice.balance > 0 && (
                          <span
                            className={
                              order.invoice.state.overdueDays > 0
                                ? "font-semibold text-rose-700"
                                : ""
                            }
                          >
                            owes {peso(order.invoice.balance)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-1.5 text-xs font-bold tracking-wider text-stone-500 uppercase">
                What they take
              </h3>
              {data.medicines.length === 0 ? (
                <p className="text-[13px] text-slate-500">Nothing bought yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200/90 text-[13px]">
                  {data.medicines.slice(0, 6).map((medicine) => (
                    <li
                      key={medicine.id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">
                          {medicine.name} {medicine.strength}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {count(medicine.times)} {medicine.times === 1 ? "order" : "orders"} ·{" "}
                          {count(medicine.qty)} {medicine.unit ?? "pcs"}
                        </span>
                      </span>
                      {medicine.lastPrice !== null && (
                        <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                          last {peso(medicine.lastPrice)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link
              to={`/customers/${customerId}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Open their page <ExternalLink className="size-3.5" />
            </Link>
            {onHold && data.totals.overdue > 0 && (
              <button
                type="button"
                onClick={() =>
                  onHold(
                    `Owes ${peso(data.totals.overdue)} past due (oldest ${lateDays} days late). On hold until it is paid.`,
                  )
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-600"
              >
                <CirclePause className="size-4" /> Put this order on hold
              </button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
