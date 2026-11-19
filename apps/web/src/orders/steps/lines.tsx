// An order's medicines on its page (orders/order.tsx): each line with its price against the list
// and the last price given, the free ones, the totals.

import type { OrderDetail } from "@2mg/api/types";
import { Snowflake } from "lucide-react";
import { Fragment, useState } from "react";
import { useMe } from "../../auth";
import { LastGiven, LineLookSwitch, useLineLook, useOrderPrices } from "../../customers/prices";
import { MedicinePopup } from "../../inventory/medicine-popup";
import { VAT_WORDS } from "../../inventory/vat";
import { count, inPacks, peso } from "../../ui";

/** The order's lines, with the price list beside what was given. */
export function Lines({ data, compare }: { data: OrderDetail; compare?: boolean }) {
  const { order } = data;
  // A medicine opens over the page, so the order stays where it is.
  const [medicine, setMedicine] = useState<number | null>(null);
  // What this customer was given before, line by line (this CRM's orders and Zoho's).
  // Dispatch packs and ships: earlier prices are not their work (Aryan, 17 Nov: less clutter).
  const packer = useMe().data?.role === "dispatch";
  const fetched = useOrderPrices(order.id).data;
  const prices = packer ? undefined : fetched;
  const [look, pickLook] = useLineLook();
  const anyBefore = prices ? Object.values(prices.lines).some(Boolean) : false;
  return (
    <div className="-mx-4 overflow-x-auto border-y border-slate-100">
      {medicine !== null && <MedicinePopup id={medicine} onClose={() => setMedicine(null)} />}
      {anyBefore && <LineLookSwitch look={look} onPick={pickLook} />}
      <table className="t">
        <thead>
          <tr>
            <th>Medicine</th>
            <th className="num">Pieces</th>
            {compare && <th className="num">List price</th>}
            <th className="num">Given</th>
            <th className="num" title="On the shelf, less what orders placed before this one hold">
              Free stock
            </th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => {
            const before = prices?.lines[item.id];
            return (
              <Fragment key={item.id}>
                <tr className={before ? "[&>td]:border-b-0 [&>td]:pb-1" : undefined}>
                  <td>
                    <button
                      type="button"
                      onClick={() => setMedicine(item.medicineId)}
                      className="text-left font-semibold hover:underline"
                      title="Prices, stock in each warehouse, batches"
                    >
                      {item.medicine}
                    </button>
                    <div className="text-xs text-ink-2">
                      {item.free ? "Free" : `${item.priceLabel} price`}
                      {item.reason && item.reason !== "Free" ? ` · ${item.reason}` : ""}
                    </div>
                    {/* VAT as Inventory keeps it; an SC/PWD line is sold without it. */}
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-semibold">
                      <span
                        className={`rounded px-1.5 py-0.5 ${item.relief ? "bg-sky-50 text-sky-800" : item.vat === "vat12" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                      >
                        {item.relief
                          ? "SC/PWD: no VAT, 20% off"
                          : (VAT_WORDS[item.vat] ?? item.vat)}
                      </span>
                      {item.rx && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">
                          Prescription
                        </span>
                      )}
                      {item.offerId && (
                        // Priced or given free by an offer set in Inventory: worked out by the system.
                        <span className="rounded bg-good-tint px-1.5 py-0.5 text-good">Offer</span>
                      )}
                      {item.cold && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
                          <Snowflake className="size-3" aria-hidden="true" /> Cold chain
                        </span>
                      )}
                      {item.coldBox && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
                          <Snowflake className="size-3" aria-hidden="true" /> Cold-chain box · priced by Management
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="num">
                    {count(item.qty)}
                    {inPacks(item.qty, item.packSize) && (
                      <div className="text-xs text-ink-2">{inPacks(item.qty, item.packSize)}</div>
                    )}
                  </td>
                  {compare && (
                    <td className="num whitespace-nowrap text-ink-2">{peso(item.listPrice)}</td>
                  )}
                  <td
                    className={`num whitespace-nowrap ${item.unitPrice < item.listPrice ? "font-semibold text-amber-700" : ""}`}
                  >
                    {peso(item.unitPrice)}
                    {/* Worked out for Management, not by hand (Aryan, 17 Nov): how far from the list. */}
                    {!item.free && !item.relief && item.listPrice > 0 && item.unitPrice !== item.listPrice && (
                      <div
                        className={`text-[11px] font-semibold ${item.unitPrice < item.listPrice ? "text-amber-700" : "text-brand-dark"}`}
                        title={`${peso(Math.abs(item.listPrice - item.unitPrice) * item.qty)} ${item.unitPrice < item.listPrice ? "less" : "more"} on this line`}
                      >
                        {item.unitPrice < item.listPrice ? "−" : "+"}
                        {Math.round((Math.abs(item.listPrice - item.unitPrice) / item.listPrice) * 1000) / 10}% vs list
                      </div>
                    )}
                  </td>
                  <td
                    className={`num ${item.inStock < item.qty ? "font-semibold text-bad" : "text-emerald-700"}`}
                  >
                    {count(item.inStock)}
                  </td>
                  <td className="num font-semibold whitespace-nowrap">{peso(item.amount)}</td>
                </tr>
                {before && (
                  <tr>
                    <td colSpan={compare ? 6 : 5} className="pt-0">
                      <LastGiven
                        key={look}
                        history={before}
                        now={item.unitPrice}
                        free={item.free}
                        look={look}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {order.deliveryFee > 0 && (
        <div className="flex items-center justify-end gap-6 border-t border-slate-100 px-4 py-2 text-[13px] text-ink-2">
          <span>Delivery fee</span>
          <span className="tabular-nums">{peso(order.deliveryFee)}</span>
        </div>
      )}
    </div>
  );
}
