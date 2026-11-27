// The money of a quotation or an order, said as the old CRM's Money card said it (Aryan, 27 Nov:
// "how much it was, what we gave it at, what it came to, how much discount — and put it
// everywhere"): what the medicines come to at the list price, what came off it (given below the
// list price, the senior / PWD's no VAT and 20% off, the free goods), the medicines, the delivery
// and the total. Each card adds its own rows after the total (points, the letter, the bill, what
// came in, what is still owed). Patient-facing amounts only, as the old card: no cost, no profit.
// Every row is worked from the same lines, so the rows always add up to the total.

import type { ReactNode } from "react";
import { peso } from "../ui";

/** One medicine on a quotation or an order (centavos). */
export type MoneyLine = {
  qty: number;
  /** The list price of one piece for this buyer. */
  listPrice: number;
  /** What the line comes to, as priced (0 on free goods). */
  amount: number;
  /** Given at no charge (a promo's free goods). */
  free?: boolean;
  /** Sold at the senior's or PWD's price (no VAT, 20% off). */
  relief?: boolean;
};

/** What the lines come to and what came off them. `reliefOff` is a quotation's senior / PWD relief
 *  when it is worked on the whole quotation rather than on each line. */
export function moneyOf(lines: MoneyLine[], reliefOff = 0) {
  const atList = lines.reduce((sum, line) => sum + line.qty * line.listPrice, 0);
  const off = (pick: (line: MoneyLine) => boolean) =>
    lines.filter(pick).reduce((sum, line) => sum + line.qty * line.listPrice - line.amount, 0);
  const free = off((line) => Boolean(line.free));
  const relief = off((line) => !line.free && Boolean(line.relief)) + reliefOff;
  // Given below the list price (or, when negative, above it).
  const belowList = off((line) => !line.free && !line.relief);
  const medicines = lines.reduce((sum, line) => sum + line.amount, 0) - reliefOff;
  return { atList, belowList, relief, free, medicines };
}

const row = "flex items-baseline justify-between gap-3";

/** The rows from the list price down to the total, then the card's own rows. */
export function MoneySummary({
  lines,
  reliefOff = 0,
  deliveryFee = 0,
  totalLabel,
  children,
}: {
  lines: MoneyLine[];
  reliefOff?: number;
  deliveryFee?: number;
  totalLabel: string;
  children?: ReactNode;
}) {
  const money = moneyOf(lines, reliefOff);
  const kinds = [money.belowList, money.relief, money.free].filter((amount) => amount !== 0).length;
  const anyOff = kinds > 0;
  const offRow = (label: string, amount: number, hint?: string) =>
    amount !== 0 && (
      <div className={row} title={hint}>
        <dt className="text-slate-600">{amount > 0 ? label : label.replace("below", "above")}</dt>
        <dd className={`tabular-nums ${amount > 0 ? "text-emerald-700" : "text-slate-900"}`}>
          {amount > 0 ? `−${peso(amount)}` : `+${peso(-amount)}`}
        </dd>
      </div>
    );
  return (
    <>
      {anyOff && (
        <div className={row}>
          <dt className="text-slate-600">At list price</dt>
          <dd className="tabular-nums">{peso(money.atList)}</dd>
        </div>
      )}
      {offRow("Given below the list price", money.belowList, "The price given, under the list price")}
      {offRow("Senior / PWD: no VAT, 20% off", money.relief, "The law's senior citizen and PWD discount")}
      {offRow("Free goods", money.free, "Given at no charge (a promo)")}
      {/* Said once more in one figure when more than one thing came off. */}
      {kinds > 1 && money.belowList >= 0 && money.belowList + money.relief + money.free > 0 && (
        <div className={`${row} text-emerald-700`}>
          <dt>Total discount</dt>
          <dd className="tabular-nums">−{peso(money.belowList + money.relief + money.free)}</dd>
        </div>
      )}
      {deliveryFee > 0 && (
        <div className={`${row} border-t border-slate-200 pt-1`}>
          <dt className="text-slate-600">Medicines</dt>
          <dd className="tabular-nums">{peso(money.medicines)}</dd>
        </div>
      )}
      {deliveryFee > 0 && (
        <div className={row}>
          <dt className="text-slate-600">Delivery fee</dt>
          <dd className="tabular-nums">+{peso(deliveryFee)}</dd>
        </div>
      )}
      <div className={`${row} font-semibold text-slate-900 ${anyOff && deliveryFee === 0 ? "border-t border-slate-200 pt-1" : ""}`}>
        <dt>{totalLabel}</dt>
        <dd className="tabular-nums">{peso(money.medicines + deliveryFee)}</dd>
      </div>
      {children}
    </>
  );
}
