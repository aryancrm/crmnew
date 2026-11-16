// What a customer was given before, shown where the price is decided: under each line of an
// order (the last price, how many, when, on which order, and the rest one click away), in a box
// about the customer on top of the order, and on the customer's own page with their orders from
// before this CRM (Zoho). Nobody has to open Zoho to find an old price.

import type { CustomerPrices, MedicinePrices, OrderPrices, PriceRow } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, History } from "lucide-react";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { SectionPanel } from "../record";
import { count, dayLabel, peso } from "../ui";

export const useOrderPrices = (orderId: number) =>
  useQuery({
    queryKey: ["orders", orderId, "prices"],
    queryFn: () => api<OrderPrices>(`/api/orders/${orderId}/prices`),
    staleTime: 60_000,
  });

const pieces = (row: Pick<PriceRow, "qty" | "freeQty">, unit: string | null) => {
  const word = unit ?? "pcs";
  if (!row.qty) return `${count(row.freeQty)} ${word} free`;
  return `${count(row.qty)} ${word}${row.freeQty ? ` + ${count(row.freeQty)} free` : ""}`;
};

const OrderCode = ({ row }: { row: PriceRow }) =>
  row.orderId ? (
    <Link to={`/orders/${row.orderId}`} className="font-semibold text-slate-800 hover:underline">
      {row.code}
    </Link>
  ) : (
    <span className="font-semibold text-slate-800" title="An order from before this CRM (Zoho)">
      {row.code}
    </span>
  );

/** Every time this customer was given the medicine, newest first. `now` marks a price above it. */
export function PriceRows({ history, now }: { history: MedicinePrices; now?: number }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-left text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
          <th className="py-1 pr-3 font-semibold">Date</th>
          <th className="py-1 pr-3 font-semibold">Order</th>
          <th className="py-1 pr-3 text-right font-semibold">Pieces</th>
          <th className="py-1 text-right font-semibold">Price for one</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {history.rows.map((row) => (
          <tr key={`${row.from}:${row.code}:${row.unitPrice}`}>
            <td className="py-1 pr-3 whitespace-nowrap text-slate-600">{dayLabel(row.at)}</td>
            <td className="py-1 pr-3 whitespace-nowrap">
              <OrderCode row={row} />
            </td>
            <td className="py-1 pr-3 text-right whitespace-nowrap tabular-nums">
              {row.qty ? count(row.qty) : ""}
              {row.freeQty ? (
                <span className="text-emerald-700">
                  {row.qty ? " + " : ""}
                  {count(row.freeQty)} free
                </span>
              ) : null}
            </td>
            <td
              className={`py-1 text-right font-semibold whitespace-nowrap tabular-nums ${
                now !== undefined && row.unitPrice !== null && now < row.unitPrice
                  ? "text-amber-700"
                  : "text-slate-900"
              }`}
            >
              {row.unitPrice !== null ? peso(row.unitPrice) : "Free"}
            </td>
          </tr>
        ))}
      </tbody>
      {history.times > history.rows.length && (
        <tfoot>
          <tr>
            <td colSpan={4} className="pt-1 text-[11px] text-slate-500">
              The newest {history.rows.length} of {count(history.times)} orders.
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Under an order's line: what this customer got last time, and the rest behind one click.
 *  Amber when the price now is below the last one. */
export function LastGiven({
  history,
  now,
  free,
}: {
  history: MedicinePrices;
  /** The price on the order being looked at. */
  now: number;
  free?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const last = history.rows[0];
  if (!last) return null;
  const lower = !free && history.lastPrice !== null && now < history.lastPrice;
  const more = history.times - 1;
  return (
    <div
      className={`rounded-lg border text-[12px] ${
        lower ? "border-amber-200 bg-amber-50/70" : "border-slate-200/80 bg-slate-50/70"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-left"
      >
        <History
          size={13}
          className={`shrink-0 ${lower ? "text-amber-600" : "text-slate-400"}`}
          aria-hidden="true"
        />
        <span className={lower ? "text-amber-800" : "text-slate-500"}>Last time</span>
        <b className={`tabular-nums ${lower ? "text-amber-900" : "text-slate-900"}`}>
          {history.lastPrice !== null ? peso(history.lastPrice) : "Free"}
        </b>
        <span className="text-slate-600 tabular-nums">· {pieces(last, history.unit)}</span>
        <span className="text-slate-600">· {dayLabel(last.at)}</span>
        <span className="font-semibold text-slate-700">· {last.code}</span>
        {lower && history.lastPrice !== null && (
          <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">
            {peso(history.lastPrice - now)} lower now
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-slate-600">
          {more > 0 ? `${count(more)} more` : "Details"}
          <ChevronDown
            size={13}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-200/70 px-2.5 py-1.5">
          <PriceRows history={history} now={free ? undefined : now} />
        </div>
      )}
    </div>
  );
}

/** On top of an order: the customer in short (how often they buy, since when, what they take). */
export function CustomerBefore({ prices, name }: { prices: OrderPrices; name: string }) {
  const { customer } = prices;
  if (customer.orders === 0)
    return (
      <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2 text-[12.5px] text-sky-900">
        <b>{name}</b> has not ordered before: this is their first order.
      </div>
    );
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
        <Link
          to={`/customers/${customer.id}`}
          className="text-[13px] font-bold text-slate-900 hover:underline"
        >
          {name}
        </Link>
        <span className="text-slate-600">
          <b className="text-slate-900 tabular-nums">{count(customer.orders)}</b>{" "}
          {customer.orders === 1 ? "order" : "orders"} before
        </span>
        {customer.lastOn && (
          <span className="text-slate-600">
            last <b className="text-slate-900">{dayLabel(customer.lastOn)}</b>
            {customer.lastCode ? ` (${customer.lastCode})` : ""}
          </span>
        )}
        {customer.firstOn && (
          <span className="text-slate-500">buying since {dayLabel(customer.firstOn)}</span>
        )}
      </div>
      {customer.top.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {customer.top.map((one) => (
            <span
              key={one.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
              title={`${count(one.qty)} ${one.unit ?? "pcs"} in all`}
            >
              <b className="font-semibold text-slate-900">{one.name}</b>
              <span className="tabular-nums">
                {count(one.times)}×{one.lastPrice !== null ? ` · ${peso(one.lastPrice)}` : ""}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const PAST_STATUS: Record<string, string> = {
  closed: "Delivered",
  fulfilled: "Delivered",
  confirmed: "Confirmed",
  void: "Cancelled",
};

/** On the customer's page: what they were given, medicine by medicine, and their orders from
 *  before this CRM. Shown once they have any such history. */
export function PricesGiven({ customerId }: { customerId: number }) {
  const query = useQuery({
    queryKey: ["customers", "prices", customerId],
    queryFn: () => api<CustomerPrices>(`/api/customers/${customerId}/prices`),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const data = query.data;
  if (!data || data.past.orders === 0) return null;
  const medicines = all ? data.medicines : data.medicines.slice(0, 12);
  return (
    <>
      <SectionPanel
        icon={History}
        title={`Prices given · ${count(data.medicines.length)} ${data.medicines.length === 1 ? "medicine" : "medicines"}`}
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2.5 sm:px-5">Medicine</th>
                <th className="px-3 py-2.5 text-right">Orders</th>
                <th className="px-3 py-2.5 text-right">Pieces</th>
                <th className="px-3 py-2.5 text-right">Last price</th>
                <th className="px-4 py-2.5 sm:px-5">Last bought</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {medicines.map((medicine) => (
                <Fragment key={medicine.key}>
                  <tr
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpen(open === medicine.key ? null : medicine.key)}
                  >
                    <td className="px-4 py-2.5 sm:px-5">
                      <button
                        type="button"
                        aria-expanded={open === medicine.key}
                        className="inline-flex items-center gap-1.5 text-left font-semibold text-slate-900"
                      >
                        <ChevronDown
                          size={14}
                          className={`shrink-0 text-slate-400 transition-transform ${open === medicine.key ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                        {medicine.name}
                      </button>
                      {medicine.sku && (
                        <span className="ml-1.5 text-[11px] text-slate-400">{medicine.sku}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{count(medicine.times)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {count(medicine.qty)}
                      {medicine.freeQty ? (
                        <span className="text-[11px] text-emerald-700">
                          {" "}
                          ({count(medicine.freeQty)} free)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      {medicine.lastPrice !== null ? peso(medicine.lastPrice) : "Free"}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 sm:px-5">
                      {dayLabel(medicine.lastAt)}
                    </td>
                  </tr>
                  {open === medicine.key && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={5} className="px-4 py-2 sm:px-5">
                        <PriceRows history={medicine} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {data.medicines.length > 12 && (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="w-full border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            {all ? "Show fewer" : `Show all ${count(data.medicines.length)} medicines`}
          </button>
        )}
      </SectionPanel>

      <SectionPanel
        icon={History}
        title={`Orders before this CRM (Zoho) · ${count(data.past.orders)}`}
        actions={
          <span className="text-xs text-slate-500">
            {peso(data.past.bought)}
            {data.past.firstOn && data.past.lastOn
              ? ` · ${dayLabel(data.past.firstOn)} to ${dayLabel(data.past.lastOn)}`
              : ""}
          </span>
        }
        flush
      >
        <ul className="divide-y divide-slate-100">
          {data.orders.map((order) => (
            <li key={order.id} className="px-4 py-2.5 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm">
                  <b className="text-slate-900">{order.code}</b>
                  <span className="text-slate-500"> · {dayLabel(order.on)}</span>
                  {order.seller && <span className="text-slate-500"> · {order.seller}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      order.status === "void"
                        ? "bg-slate-100 text-slate-500"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {PAST_STATUS[order.status] ?? order.status}
                  </span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${order.status === "void" ? "text-slate-400 line-through" : ""}`}
                  >
                    {peso(order.total)}
                  </span>
                </span>
              </div>
              <div className="truncate text-[12.5px] text-slate-600">{order.medicines ?? "—"}</div>
            </li>
          ))}
        </ul>
        {data.past.orders > data.orders.length && (
          <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 sm:px-5">
            The newest {data.orders.length}; each medicine's prices above cover them all.
          </div>
        )}
      </SectionPanel>
    </>
  );
}
