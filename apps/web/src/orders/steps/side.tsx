// What sits beside an order's steps on its page (orders/order.tsx): its money and its timeline.

import type { OrderDetail } from "@2mg/api/types";
import { useState } from "react";
import { count, peso, timeLabel } from "../../ui";

// ---------------------------------------------------------------- side

/** The order's money, plainly (Aryan, 19 Nov: "show the money section properly"): each medicine
 *  whole (its name, pieces × price, free goods marked), the total, then the bill: its number, when
 *  it is due, what came in and what is still owed. */
export function MoneyCard({ data }: { data: OrderDetail }) {
  const { order } = data;
  const invoice = data.money.invoice;
  const goods = data.items.reduce((sum, item) => sum + item.amount, 0);
  const free = data.items.filter((item) => item.free).length;
  const row = "flex items-baseline justify-between gap-3";
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <h2 className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5 text-sm font-semibold text-ink">
        Money
        <span className="text-xs font-normal text-slate-500">
          {data.items.length} {data.items.length === 1 ? "line" : "lines"}
          {free ? ` · ${free} free` : ""}
        </span>
      </h2>
      <ul className="divide-y divide-slate-100 px-3.5">
        {data.items.map((item) => (
          <li key={item.id} className="py-2">
            <div className={row}>
              <span className="line-clamp-2 min-w-0 text-sm font-medium text-slate-800">{item.medicine}</span>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${item.free ? "text-emerald-700" : "text-slate-900"}`}>
                {item.free ? "Free" : peso(item.amount)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
              {count(item.qty)} × {peso(item.unitPrice)}
              {!item.free && item.unitPrice < item.listPrice ? (
                <span className="ml-1.5 font-semibold text-amber-700">list {peso(item.listPrice)}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-1 border-t border-slate-100 bg-slate-50/60 px-3.5 py-2.5 text-sm">
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
        <div className={`${row} text-sm font-semibold text-slate-900`}>
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
            <div className={`${row} mt-1 border-t border-slate-200 pt-1.5 text-xs text-slate-500`}>
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
          <p className="mt-1 border-t border-slate-200 pt-1.5 text-xs text-slate-500">No invoice yet: it is made when Management approves.</p>
        )}
      </dl>
    </section>
  );
}

export function Activity({ data }: { data: OrderDetail }) {
  const [all, setAll] = useState(false);
  const events = [...data.events].reverse();
  const shown = all ? events : events.slice(0, 8);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-ink">Timeline</h2>
      <ul className="flex flex-col gap-2.5 text-sm">
        {shown.map((event) => (
          <li key={event.id}>
            <div className="text-slate-800">{event.message}</div>
            <div className="text-xs text-slate-500">
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
