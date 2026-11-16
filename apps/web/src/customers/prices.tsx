// What a customer was given before, shown where the price is decided: under each line of an
// order (the last price, how it compares with now, the trend, and every earlier order one click
// away), in a box about the customer on top of the order, and on the customer's own page with
// their orders from before this CRM (Zoho). Nobody has to open Zoho to find an old price.

import type { CustomerPrices, MedicinePrices, OrderPrices, PriceRow } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Equal, Gift, History } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { avatarTone, initials } from "../look";
import { SectionPanel } from "../record";
import { count, dayLabel, LookSwitch, peso, useLook } from "../ui";

export const useOrderPrices = (orderId: number) =>
  useQuery({
    queryKey: ["orders", orderId, "prices"],
    queryFn: () => api<OrderPrices>(`/api/orders/${orderId}/prices`),
    staleTime: 60_000,
  });

const unitOf = (unit: string | null) => unit ?? "pcs";
const pieces = (row: Pick<PriceRow, "qty" | "freeQty">, unit: string | null) => {
  if (!row.qty) return `${count(row.freeQty)} ${unitOf(unit)} free`;
  return `${count(row.qty)} ${unitOf(unit)}${row.freeQty ? ` + ${count(row.freeQty)} free` : ""}`;
};
/** The prices paid, oldest first. */
const paidOf = (history: MedicinePrices) =>
  history.rows
    .filter((row) => row.unitPrice !== null)
    .map((row) => row.unitPrice as number)
    .reverse();

/** The price over time as a small line; the dot at the end is the price now (amber when lower
 *  than last time, green when higher). */
function Trend({ prices, now, wide }: { prices: number[]; now?: number; wide?: boolean }) {
  const points = now === undefined ? prices : [...prices, now];
  if (points.length < 2) return null;
  const width = wide ? 132 : 76;
  const height = wide ? 34 : 22;
  const low = Math.min(...points);
  const high = Math.max(...points);
  const x = (index: number) => 3 + (index * (width - 6)) / (points.length - 1);
  const y = (value: number) =>
    high === low ? height / 2 : height - 4 - ((value - low) * (height - 8)) / (high - low);
  const last = prices[prices.length - 1] as number;
  const tone =
    now === undefined || now === last ? "#64748b" : now < last ? "#d97706" : "#059669";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      role="img"
      aria-label={`Price over their last ${prices.length} orders`}
    >
      <polyline
        points={points.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {prices.map((value, index) => (
        // The points never reorder, so their place is their key.
        <circle key={index} cx={x(index)} cy={y(value)} r="1.6" fill="#94a3b8" />
      ))}
      <circle
        cx={x(points.length - 1)}
        cy={y(points[points.length - 1] as number)}
        r="3"
        fill={tone}
        stroke="#fff"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** How the price now compares with an earlier one. Lower is the one to look at. */
function Delta({ now, then, small }: { now: number; then: number; small?: boolean }) {
  const size = small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]";
  const percent = then > 0 ? Math.abs(((now - then) / then) * 100) : 0;
  const share = percent >= 0.1 ? ` · ${percent.toFixed(1)}%` : "";
  if (now === then)
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-slate-100 font-semibold whitespace-nowrap text-slate-600 ${size}`}
      >
        <Equal size={small ? 10 : 12} aria-hidden="true" /> Same price
      </span>
    );
  const lower = now < then;
  const Icon = lower ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full font-bold whitespace-nowrap tabular-nums ${size} ${
        lower
          ? "bg-amber-100 text-amber-900 ring-1 ring-amber-200"
          : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
      }`}
    >
      <Icon size={small ? 11 : 13} aria-hidden="true" />
      {peso(Math.abs(now - then))} {lower ? "lower" : "higher"}
      {!small && share}
    </span>
  );
}

const Move = ({ from, to }: { from: number; to: number }) =>
  to === from ? (
    <Equal size={13} className="shrink-0 text-slate-300" aria-label="same as before" />
  ) : to < from ? (
    <ArrowDownRight size={14} className="shrink-0 text-amber-600" aria-label="lower than before" />
  ) : (
    <ArrowUpRight size={14} className="shrink-0 text-emerald-600" aria-label="higher than before" />
  );

/** The last prices side by side, the newest first, with an arrow for which way each moved from
 *  the order before it. `now` puts the price being decided in front. */
function StepBoxes({ history, now }: { history: MedicinePrices; now?: number }) {
  const steps = history.rows.filter((row) => row.unitPrice !== null).slice(0, 5);
  const first = steps[0]?.unitPrice ?? null;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 pl-0.5">
      {now !== undefined && (
        <>
          <span
            className={`shrink-0 rounded-lg px-2.5 py-1.5 leading-tight ring-1 ${
              first !== null && now < first
                ? "bg-amber-100 ring-amber-300"
                : "bg-slate-900 text-white ring-slate-900"
            }`}
          >
            <span
              className={`block text-[13px] font-bold tabular-nums ${first !== null && now < first ? "text-amber-950" : "text-white"}`}
            >
              {peso(now)}
            </span>
            <span
              className={`block text-[10px] font-semibold tracking-wide uppercase ${first !== null && now < first ? "text-amber-800" : "text-slate-300"}`}
            >
              Now
            </span>
          </span>
          {first !== null && <Move from={first} to={now} />}
        </>
      )}
      {steps.length === 0 && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
          Only given free
        </span>
      )}
      {steps.map((row, index) => {
        const older = steps[index + 1]?.unitPrice ?? null;
        const price = row.unitPrice as number;
        return (
          <Fragment key={`${row.from}:${row.code}:${price}`}>
            <span
              className={`shrink-0 rounded-lg px-2.5 py-1.5 leading-tight ring-1 ${
                index === 0 ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-200"
              }`}
              title={`${row.code} · ${pieces(row, history.unit)}`}
            >
              <span className="block text-[13px] font-bold text-slate-900 tabular-nums">
                {peso(price)}
              </span>
              <span className="block text-[10px] whitespace-nowrap text-slate-500">
                {dayLabel(row.at)}
                {row.freeQty ? (
                  <span className="font-semibold text-emerald-700">
                    {" "}
                    · +{count(row.freeQty)} free
                  </span>
                ) : null}
              </span>
            </span>
            {older !== null && <Move from={older} to={price} />}
          </Fragment>
        );
      })}
    </span>
  );
}

const ZohoTag = () => (
  <span
    className="rounded bg-slate-100 px-1 py-px text-[9px] font-bold tracking-wide text-slate-500 uppercase"
    title="An order from before this CRM (Zoho)"
  >
    Zoho
  </span>
);

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="truncate text-[13px] font-bold text-slate-900 tabular-nums">{children}</div>
    </div>
  );
}

/** Every time this customer was given the medicine, newest first: lowest, highest and usual
 *  price on top, then each order. `now` compares each with the price being decided. */
export function PriceRows({ history, now }: { history: MedicinePrices; now?: number }) {
  const paid = paidOf(history);
  const average = paid.length ? Math.round(paid.reduce((sum, one) => sum + one, 0) / paid.length) : null;
  return (
    <div className="flex flex-col gap-2.5">
      {paid.length > 1 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/80 sm:grid-cols-4">
          <Figure label="Lowest">{peso(Math.min(...paid))}</Figure>
          <Figure label="Highest">{peso(Math.max(...paid))}</Figure>
          <Figure label="Average">{average !== null ? peso(average) : "—"}</Figure>
          <Figure label="In all">
            {count(history.qty)} {unitOf(history.unit)}
          </Figure>
        </div>
      )}
      <div className="overflow-hidden rounded-lg bg-white ring-1 ring-slate-200/80">
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto_6.5rem] items-center gap-x-4 border-b border-slate-100 bg-slate-50/70 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
          <span>Date</span>
          <span>Order</span>
          <span className="text-right">Pieces</span>
          <span className="text-right">For one</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {history.rows.map((row, index) => (
            <li
              key={`${row.from}:${row.code}:${row.unitPrice}`}
              className={`grid grid-cols-[6.5rem_minmax(0,1fr)_auto_6.5rem] items-center gap-x-4 px-3 py-1.5 text-[12.5px] ${index === 0 ? "bg-emerald-50/30" : ""}`}
            >
              <span className="whitespace-nowrap text-slate-600">{dayLabel(row.at)}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                {row.orderId ? (
                  <Link
                    to={`/orders/${row.orderId}`}
                    className="truncate font-semibold text-slate-900 hover:text-emerald-700 hover:underline"
                  >
                    {row.code}
                  </Link>
                ) : (
                  <>
                    <span className="truncate font-semibold text-slate-900">{row.code}</span>
                    <ZohoTag />
                  </>
                )}
                {index === 0 && (
                  <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-bold tracking-wide text-emerald-800 uppercase">
                    Last
                  </span>
                )}
              </span>
              <span className="flex items-center justify-end gap-1.5 whitespace-nowrap tabular-nums">
                {row.qty ? <span className="text-slate-800">{count(row.qty)}</span> : null}
                {row.freeQty ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px text-[10.5px] font-semibold text-emerald-700">
                    <Gift size={10} aria-hidden="true" />+{count(row.freeQty)} free
                  </span>
                ) : null}
              </span>
              <span className="flex flex-col items-end leading-tight">
                <span className="font-bold whitespace-nowrap text-slate-900 tabular-nums">
                  {row.unitPrice !== null ? peso(row.unitPrice) : "Free"}
                </span>
                {now !== undefined && row.unitPrice !== null && now !== row.unitPrice && (
                  <span
                    className={`text-[10px] font-semibold whitespace-nowrap tabular-nums ${now < row.unitPrice ? "text-amber-700" : "text-emerald-700"}`}
                  >
                    now {peso(Math.abs(now - row.unitPrice))} {now < row.unitPrice ? "lower" : "higher"}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {history.times > history.rows.length && (
          <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
            The newest {history.rows.length} of {count(history.times)} orders.
          </div>
        )}
      </div>
    </div>
  );
}

/** The looks of the earlier prices under an order's lines. */
export const LINE_LOOKS = [
  ["strip", "Strip"],
  ["steps", "Steps"],
  ["open", "Open"],
] as const;
export type LineLook = (typeof LINE_LOOKS)[number][0];
export const useLineLook = () => useLook("crm:order-prices-look", LINE_LOOKS);

/** Above an order's lines: how to see what the customer paid before. */
export function LineLookSwitch({
  look,
  onPick,
}: {
  look: LineLook;
  onPick: (look: LineLook) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
        <History size={13} className="text-slate-400" aria-hidden="true" />
        What they paid before
      </span>
      <LookSwitch legend="How to see the earlier prices" looks={LINE_LOOKS} value={look} onPick={onPick} />
    </div>
  );
}

/** Under an order's line: what this customer got last time against the price now, and every
 *  earlier order behind one click. Amber when the price now is below the last one. Three looks:
 *  a strip (last price, trend, how much lower or higher), steps (the last prices side by side
 *  starting from now), or open (every order shown without a click). */
export function LastGiven({
  history,
  now,
  free,
  look = "strip",
}: {
  history: MedicinePrices;
  /** The price on the order being looked at. */
  now: number;
  free?: boolean;
  look?: LineLook;
}) {
  const [open, setOpen] = useState(look === "open");
  const last = history.rows[0];
  if (!last) return null;
  const compare = !free && history.lastPrice !== null;
  const lower = compare && now < (history.lastPrice as number);
  const orders = (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-slate-700 shadow-2xs ring-1 ring-slate-200">
      {count(history.times)} {history.times === 1 ? "order" : "orders"}
      <ChevronDown
        size={13}
        className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </span>
  );
  return (
    <div
      className={`overflow-hidden rounded-xl border transition-colors ${
        lower
          ? "border-amber-300/80 bg-linear-to-r from-amber-50 to-amber-50/30"
          : "border-slate-200 bg-linear-to-r from-slate-50 to-white"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Every time this customer was given it"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-left"
      >
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-lg ${
            lower ? "bg-amber-100 text-amber-700" : "bg-white text-slate-500 ring-1 ring-slate-200"
          }`}
        >
          <History size={14} aria-hidden="true" />
        </span>
        {look === "steps" ? (
          <>
            <StepBoxes history={history} now={compare ? now : undefined} />
            <span className="ml-auto flex items-center gap-3">
              {compare && <Delta now={now} then={history.lastPrice as number} small />}
              {orders}
            </span>
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                className={`text-[10px] font-semibold tracking-wide uppercase ${lower ? "text-amber-700" : "text-slate-500"}`}
              >
                Last time
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <b className="text-[15px] font-bold text-slate-900 tabular-nums">
                  {history.lastPrice !== null ? peso(history.lastPrice) : "Free"}
                </b>
                <span className="text-[12px] text-slate-600 tabular-nums">
                  {pieces(last, history.unit)} · {dayLabel(last.at)} ·{" "}
                  <span className="font-semibold text-slate-800">{last.code}</span>
                </span>
              </span>
            </span>
            <span className="ml-auto flex items-center gap-3">
              <Trend prices={paidOf(history).slice(-8)} now={compare ? now : undefined} />
              {compare && <Delta now={now} then={history.lastPrice as number} />}
              {orders}
            </span>
          </>
        )}
      </button>
      {open && (
        <div className={`border-t px-3 py-2.5 ${lower ? "border-amber-200/70" : "border-slate-200/70"}`}>
          <PriceRows history={history} now={compare ? now : undefined} />
        </div>
      )}
    </div>
  );
}

/** On top of an order: the customer in short (how often they buy, how much, since when, and what
 *  they take with the last price of each). */
export function CustomerBefore({ prices, name }: { prices: OrderPrices; name: string }) {
  const { customer } = prices;
  if (customer.orders === 0)
    return (
      <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-linear-to-r from-sky-50 to-white px-3 py-2.5">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl text-xs font-bold ${avatarTone(name)}`}
        >
          {initials(name)}
        </span>
        <div className="text-[13px] text-sky-950">
          <b>First order.</b> {name} has not bought from us before, so there is no earlier price.
        </div>
      </div>
    );
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 bg-linear-to-r from-slate-50 to-white px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold ${avatarTone(name)}`}
          >
            {initials(name)}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              Bought before
            </div>
            <Link
              to={`/customers/${customer.id}`}
              className="block truncate text-sm font-bold text-slate-900 hover:text-emerald-700"
            >
              {name}
            </Link>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-x-7 gap-y-2 whitespace-nowrap">
          <Figure label="Orders">{count(customer.orders)}</Figure>
          <Figure label="Bought">{peso(customer.bought)}</Figure>
          <Figure label="Last order">
            {customer.lastOn ? dayLabel(customer.lastOn) : "—"}
            {customer.lastCode && (
              <span className="font-medium text-slate-500"> · {customer.lastCode}</span>
            )}
          </Figure>
          <Figure label="Buying since">{customer.firstOn ? dayLabel(customer.firstOn) : "—"}</Figure>
        </div>
      </div>
      {customer.top.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3.5 py-2">
          <span className="mr-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Takes most
          </span>
          {customer.top.map((one) => (
            <span
              key={one.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 py-0.5 pr-1 pl-2.5 text-[11.5px] text-slate-700 ring-1 ring-slate-200"
              title={`${count(one.times)} ${one.times === 1 ? "order" : "orders"}, ${count(one.qty)} ${unitOf(one.unit)} in all`}
            >
              <b className="font-semibold text-slate-900">{one.name}</b>
              <span className="text-slate-500 tabular-nums">{count(one.times)}×</span>
              {one.lastPrice !== null && (
                <span className="rounded-full bg-white px-1.5 py-px font-semibold text-slate-900 tabular-nums ring-1 ring-slate-200">
                  {peso(one.lastPrice)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type LookProps = {
  medicines: MedicinePrices[];
  open: string | null;
  toggle: (key: string) => void;
};

/** Look 1, a table: one line per medicine with its trend; a line opens to every order. */
function PricesTable({ medicines, open, toggle }: LookProps) {
  return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2.5 sm:px-5">Medicine</th>
                <th className="px-3 py-2.5 text-right">Orders</th>
                <th className="px-3 py-2.5 text-right">Pieces</th>
                <th className="px-2 py-2.5">Trend</th>
                <th className="px-4 py-2.5 text-right sm:px-5">Last price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {medicines.map((medicine) => (
                <Fragment key={medicine.key}>
                  <tr
                    className={`cursor-pointer ${open === medicine.key ? "bg-slate-50" : "hover:bg-slate-50"}`}
                    onClick={() => toggle(medicine.key)}
                  >
                    <td className="px-4 py-2.5 sm:px-5">
                      <button
                        type="button"
                        aria-expanded={open === medicine.key}
                        className="flex items-center gap-2 text-left"
                      >
                        <ChevronDown
                          size={15}
                          className={`shrink-0 text-slate-400 transition-transform ${open === medicine.key ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                        <span className="leading-tight">
                          <span className="block font-semibold text-slate-900">{medicine.name}</span>
                          {medicine.sku && (
                            <span className="block text-[11px] text-slate-400">{medicine.sku}</span>
                          )}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{count(medicine.times)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {count(medicine.qty)}
                      {medicine.freeQty ? (
                        <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-px text-[10.5px] font-semibold text-emerald-700">
                          {count(medicine.freeQty)} free
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2.5">
                      <Trend prices={paidOf(medicine).slice(-8)} />
                    </td>
                    <td className="px-4 py-2.5 text-right leading-tight whitespace-nowrap sm:px-5">
                      <span className="block font-bold text-slate-900 tabular-nums">
                        {medicine.lastPrice !== null ? peso(medicine.lastPrice) : "Free"}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {dayLabel(medicine.lastAt)}
                      </span>
                    </td>
                  </tr>
                  {open === medicine.key && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-4 pt-1 pb-3 sm:px-5">
                        <PriceRows history={medicine} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
  );
}

const Chip = ({ children, tone }: { children: ReactNode; tone?: "free" }) => (
  <span
    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums ${
      tone === "free" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
    }`}
  >
    {children}
  </span>
);

/** Look 2, cards: each medicine a card with the last price large, the trend and the range. */
function PricesCards({ medicines, open, toggle }: LookProps) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
      {medicines.map((medicine) => {
        const paid = paidOf(medicine);
        const isOpen = open === medicine.key;
        return (
          <div
            key={medicine.key}
            className={`flex flex-col rounded-xl border bg-white transition-shadow ${
              isOpen ? "border-emerald-300 shadow-sm sm:col-span-2" : "border-slate-200 hover:shadow-sm"
            }`}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(medicine.key)}
              className="flex flex-col gap-2.5 p-3.5 text-left"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-bold text-slate-900">
                    {medicine.name}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    {medicine.sku ?? "No SKU"} · last {dayLabel(medicine.lastAt)}
                  </span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <span className="block text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    Last price
                  </span>
                  <span className="block text-lg font-bold text-slate-900 tabular-nums">
                    {medicine.lastPrice !== null ? peso(medicine.lastPrice) : "Free"}
                  </span>
                </span>
              </span>
              <span className="flex items-end justify-between gap-3">
                <span className="flex flex-wrap gap-1.5">
                  <Chip>
                    {count(medicine.times)} {medicine.times === 1 ? "order" : "orders"}
                  </Chip>
                  <Chip>
                    {count(medicine.qty)} {unitOf(medicine.unit)}
                  </Chip>
                  {medicine.freeQty > 0 && <Chip tone="free">{count(medicine.freeQty)} free</Chip>}
                  {paid.length > 1 && Math.min(...paid) !== Math.max(...paid) && (
                    <Chip>
                      {peso(Math.min(...paid))} to {peso(Math.max(...paid))}
                    </Chip>
                  )}
                </span>
                <Trend prices={paid.slice(-8)} wide />
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                {isOpen ? "Hide the orders" : "Every order"}
                <ChevronDown
                  size={13}
                  className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                <PriceRows history={medicine} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Look 3, steps: each medicine's last prices side by side, the newest first, with an arrow
 *  showing which way each one moved from the order before it. */
function PricesSteps({ medicines, open, toggle }: LookProps) {
  return (
    <ul className="divide-y divide-slate-100">
      {medicines.map((medicine) => {
        const isOpen = open === medicine.key;
        return (
          <li key={medicine.key} className={isOpen ? "bg-slate-50" : ""}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(medicine.key)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-slate-50 sm:px-5"
            >
              <span className="w-44 min-w-0 shrink-0 leading-tight">
                <span className="block truncate text-sm font-semibold text-slate-900">
                  {medicine.name}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {medicine.sku ? `${medicine.sku} · ` : ""}
                  {count(medicine.times)} {medicine.times === 1 ? "order" : "orders"}
                </span>
              </span>
              <StepBoxes history={medicine} />
              <ChevronDown
                size={15}
                className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {isOpen && (
              <div className="px-4 pb-3 sm:px-5">
                <PriceRows history={medicine} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The three looks of Prices given. */
const LOOKS = [
  ["table", "Table"],
  ["cards", "Cards"],
  ["steps", "Steps"],
] as const;

const PAST_STATUS: Record<string, string> = {
  closed: "Delivered",
  fulfilled: "Delivered",
  invoiced: "Invoiced",
  partially_invoiced: "Partly invoiced",
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
  const [look, pickLook] = useLook("crm:prices-look", LOOKS);
  const toggle = (key: string) => setOpen(open === key ? null : key);
  const data = query.data;
  if (!data || data.past.orders === 0) return null;
  const medicines = all ? data.medicines : data.medicines.slice(0, 12);
  return (
    <>
      <SectionPanel
        icon={History}
        title={`Prices given · ${count(data.medicines.length)} ${data.medicines.length === 1 ? "medicine" : "medicines"}`}
        actions={
          <LookSwitch legend="How to see the prices" looks={LOOKS} value={look} onPick={pickLook} />
        }
        flush
      >
        {look === "table" && <PricesTable medicines={medicines} open={open} toggle={toggle} />}
        {look === "cards" && <PricesCards medicines={medicines} open={open} toggle={toggle} />}
        {look === "steps" && <PricesSteps medicines={medicines} open={open} toggle={toggle} />}
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
            <b className="text-slate-800 tabular-nums">{peso(data.past.bought)}</b>
            {data.past.firstOn && data.past.lastOn
              ? ` · ${dayLabel(data.past.firstOn)} to ${dayLabel(data.past.lastOn)}`
              : ""}
          </span>
        }
        flush
      >
        {(data.zoho.seller || data.zoho.division || data.zoho.owed > 0) && (
          // Whose customer it was in Zoho, and what Zoho's invoices still show as owed.
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[12.5px] sm:px-5">
            {data.zoho.seller && (
              <span className="text-slate-600">
                Sold by <b className="text-slate-900">{data.zoho.seller}</b>
              </span>
            )}
            {data.zoho.division && (
              <span className="text-slate-600">
                Division{" "}
                <b className="text-slate-900">
                  {[data.zoho.division, data.zoho.subDivision, data.zoho.headquarter]
                    .filter(Boolean)
                    .join(" · ")}
                </b>
              </span>
            )}
            {data.zoho.owed > 0 && (
              <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-200">
                Owes {peso(data.zoho.owed)} in Zoho · {count(data.zoho.openInvoices)}{" "}
                {data.zoho.openInvoices === 1 ? "invoice" : "invoices"}
                {data.zoho.oldestDue ? ` · oldest due ${dayLabel(data.zoho.oldestDue)}` : ""}
              </span>
            )}
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {data.orders.map((order) => (
            <li key={order.id} className="px-4 py-2.5 hover:bg-slate-50/60 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className="flex flex-wrap items-center gap-x-2 text-sm">
                  <b className="text-slate-900">{order.code}</b>
                  <span className="text-slate-500">{dayLabel(order.on)}</span>
                  {order.seller && (
                    <span className="rounded bg-slate-100 px-1.5 py-px text-[11px] text-slate-600">
                      {order.seller}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2.5">
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
                    className={`text-sm font-bold tabular-nums ${order.status === "void" ? "text-slate-400 line-through" : "text-slate-900"}`}
                  >
                    {peso(order.total)}
                  </span>
                </span>
              </div>
              <div className="mt-0.5 truncate text-[12.5px] text-slate-600">
                {order.medicines ?? "—"}
              </div>
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
