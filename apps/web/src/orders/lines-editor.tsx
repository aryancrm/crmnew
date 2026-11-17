// Management changes an order's medicines where it checks them (Aryan, as the hub did): a quick
// search adds a medicine, a line given free is the same medicine at ₱0 with its remark, prices and
// quantities change in place, a line comes off. Saving sends the whole order back through the
// same change the MedRep's form uses; the MedRep is told what changed.

import type {
  BuyerType,
  Catalogue,
  CatalogueRow,
  OrderDetail,
  OrderVersionLine,
} from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { Button, count, Problem, peso, useAction } from "../ui";
import { changesBetween } from "./versions";

type Line = {
  key: number;
  medicineId: number;
  medicine: string;
  sku: string | null;
  priceKind: string;
  qty: string;
  price: string;
  listPrice: number;
  free: boolean;
  reason: string;
  stock: number;
  /** A senior citizen's or PWD's line: its price is the law's (or a lower promo), worked out by
   *  the API; sent back unchanged it keeps the price it has. */
  relief: boolean;
};

/** The buyer's own price list for each kind of customer. */
const PRICE_OF: Record<string, BuyerType> = {
  patient: "patient",
  hospital: "hospital",
  doctor: "doctor",
  distributor: "distributor",
  drugstore: "drugstore",
  government: "bidding",
};

const typed = (text: string) => {
  const clean = text.replace(/[₱,\s]/g, "");
  return /^\d+(\.\d{0,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : Number.NaN;
};
const FIELD =
  "h-9 rounded-lg border border-slate-200 bg-white px-2 text-[13px] tabular-nums focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";

export function LinesEditor({ data, onDone }: { data: OrderDetail; onDone: () => void }) {
  const { order } = data;
  const queries = useQueryClient();
  const action = useAction();
  const kind = PRICE_OF[order.customerKind] ?? "hospital";
  const catalogue = useQuery({
    queryKey: ["inventory", "medicines"],
    queryFn: () => api<Catalogue>("/api/inventory/medicines"),
    staleTime: 120_000,
  });
  let next = 0;
  const [lines, setLines] = useState<Line[]>(() =>
    data.items.map((item) => ({
      key: next++,
      medicineId: item.medicineId,
      medicine: item.medicine,
      sku: item.sku,
      priceKind: item.priceKind,
      qty: String(item.qty),
      price: (item.unitPrice / 100).toFixed(2),
      listPrice: item.listPrice,
      free: item.free,
      reason: item.relief ? "" : (item.reason ?? ""),
      stock: item.inStock,
      relief: item.relief,
    })),
  );
  const [search, setSearch] = useState("");
  const [why, setWhy] = useState("");
  // The hub's "Confirm changes": what changes, old → new, before it is saved.
  const [confirming, setConfirming] = useState(false);
  const keyOf = () => Math.max(0, ...lines.map((line) => line.key)) + 1;
  const found = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return (catalogue.data?.rows ?? [])
      .filter((row) => {
        const text = [row.name, row.strength, row.code, row.sku, row.generic]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .slice(0, 8);
  }, [search, catalogue.data]);

  const change = (key: number, changes: Partial<Line>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  const priceOf = (row: CatalogueRow) => row.prices[kind] ?? row.prices.hospital ?? 0;
  const labelOf = (key: string) =>
    catalogue.data?.buyerTypes.find((type) => type.key === key)?.label ?? key;
  const rowOf = (id: number) => catalogue.data?.rows.find((row) => row.id === id);
  /** Adds a medicine at one of its prices (the buyer's own, or another: a doctor's price). */
  function add(row: CatalogueRow, at: BuyerType = kind) {
    const price = row.prices[at] ?? priceOf(row);
    setLines((all) => [
      ...all,
      {
        key: keyOf(),
        medicineId: row.id,
        medicine: [row.name, row.strength].filter(Boolean).join(" "),
        sku: row.code,
        priceKind: row.prices[at] !== undefined ? at : "hospital",
        qty: "1",
        price: (price / 100).toFixed(2),
        listPrice: price,
        free: false,
        reason: "",
        stock: row.free,
        relief: Boolean(order.relief),
      },
    ]);
    setSearch("");
  }
  /** A line moved to another price list (a doctor's, a patient's…). */
  function priceKindOf(line: Line, at: string) {
    const price = rowOf(line.medicineId)?.prices[at as BuyerType];
    if (price === undefined) return;
    change(line.key, { priceKind: at, listPrice: price, price: (price / 100).toFixed(2) });
  }
  /** The same medicine given free: its quantity set, at ₱0, with a remark. */
  function addFree(line: Line) {
    if (lines.some((other) => other.medicineId === line.medicineId && other.free)) return;
    setLines((all) => [
      ...all,
      {
        ...line,
        key: keyOf(),
        qty: line.qty,
        price: "0.00",
        free: true,
        reason: "Free item",
        relief: false,
      },
    ]);
  }

  const total = lines.reduce((sum, line) => {
    const price = line.free ? 0 : typed(line.price);
    return sum + (Number(line.qty) || 0) * (Number.isFinite(price) ? price : 0);
  }, 0);

  const before: OrderVersionLine[] = data.items.map((item) => ({
    medicineId: item.medicineId,
    name: item.medicine,
    qty: item.qty,
    priceKind: item.priceKind,
    listPrice: item.listPrice,
    unitPrice: item.unitPrice,
    reason: item.reason,
    free: item.free,
    relief: item.relief,
  }));
  const after: OrderVersionLine[] = lines.map((line) => ({
    medicineId: line.medicineId,
    name: line.medicine,
    qty: Math.max(0, Math.floor(Number(line.qty) || 0)),
    priceKind: line.priceKind,
    listPrice: line.listPrice,
    unitPrice: line.free ? 0 : Number.isFinite(typed(line.price)) ? typed(line.price) : 0,
    reason: line.reason || null,
    free: line.free,
    relief: line.relief,
  }));
  const changes = confirming ? changesBetween(before, after) : [];
  const totalBefore = order.total;

  async function save() {
    const done = await action.run(async () => {
      await api(`/api/orders/${order.id}/change`, {
        body: {
          customerId: order.customerId,
          items: lines.map((line) => ({
            medicineId: line.medicineId,
            qty: Math.max(0, Math.floor(Number(line.qty) || 0)),
            priceKind: line.priceKind,
            unitPrice: line.free ? 0 : typed(line.price),
            // Any price other than the list's, below or above, says why (Management's too).
            reason: line.free
              ? line.reason.trim() || "Free item"
              : !line.relief && typed(line.price) !== line.listPrice
                ? line.reason.trim() || null
                : null,
            free: line.free,
          })),
          deliveryAddress: order.deliveryAddress,
          receiver: order.receiver,
          receiverPhone: order.receiverPhone,
          expectedOn: order.expectedOn,
          customerPo: order.customerPo,
          note: order.note,
          invoiceFrom: order.invoiceFrom,
          doctorId: order.doctorId,
          division: order.division,
          subDivision: order.subDivision,
          paymentTerm: order.paymentTerm,
          patientOrder: order.patientOrder,
          patientName: order.patientName,
          // Said by Management every time: the MedRep reads it beside what changed.
          answer: why.trim(),
        },
      });
    });
    if (!done) return;
    await queries.invalidateQueries({ queryKey: ["orders"] });
    onDone();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Quick product search &amp; add
        </div>
        <Search className="pointer-events-none absolute top-[2.15rem] left-3 size-4 text-slate-400" />
        <input
          type="search"
          aria-label="Search a medicine to add"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Type a medicine name or code…"
          className={`${FIELD} h-10 w-full pl-9`}
        />
        {found.length > 0 && (
          <ul className="absolute right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {found.map((row) => (
              <li key={row.id} className="px-3 py-2 hover:bg-slate-50">
                <button
                  type="button"
                  onClick={() => add(row)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-slate-900">
                      {[row.name, row.strength].filter(Boolean).join(" ")}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {row.code}
                      {row.form ? ` · ${row.form}` : ""} · {count(row.free)} free
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13px] font-semibold text-emerald-700 tabular-nums">
                      {peso(priceOf(row))}
                    </span>
                    <span className="block text-[10px] text-slate-400">{labelOf(kind)} price</span>
                  </span>
                </button>
                {/* Every price it has: one tap adds it at that price (a doctor's, a patient's…). */}
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {(Object.entries(row.prices) as [BuyerType, number][]).map(([at, price]) => (
                    <button
                      key={at}
                      type="button"
                      onClick={() => add(row, at)}
                      title={`Add at the ${labelOf(at).toLowerCase()} price`}
                      className={`text-[11px] tabular-nums hover:underline ${at === kind ? "font-semibold text-emerald-700" : "text-slate-600"}`}
                    >
                      {labelOf(at)} {peso(price)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[40rem] text-[13px]">
          <thead className="bg-slate-50 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Medicine</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Price</th>
              <th className="px-2 py-2 text-right">Free stock</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line) => {
              const price = line.free ? 0 : typed(line.price);
              const differs =
                !line.free && !line.relief && Number.isFinite(price) && price !== line.listPrice;
              return (
                <tr key={line.key} className="align-top">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-900">
                      {line.medicine}
                      {line.free && <span className="ml-1 text-emerald-700">(Free)</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      {line.sku ?? ""} ·
                      {!line.free && rowOf(line.medicineId) ? (
                        <select
                          aria-label={`Price list for ${line.medicine}`}
                          value={line.priceKind}
                          onChange={(event) => priceKindOf(line, event.target.value)}
                          className="h-6 rounded border border-slate-200 bg-white px-1 text-[11px]"
                        >
                          {Object.entries(rowOf(line.medicineId)?.prices ?? {}).map(
                            ([at, price]) => (
                              <option key={at} value={at}>
                                {labelOf(at)} {peso(price as number)}
                              </option>
                            ),
                          )}
                        </select>
                      ) : (
                        <span>list {peso(line.listPrice)}</span>
                      )}
                    </div>
                    {(line.free || differs) && (
                      <input
                        aria-label={`Remark for ${line.medicine}`}
                        value={line.reason}
                        onChange={(event) => change(line.key, { reason: event.target.value })}
                        placeholder={
                          line.free
                            ? "Free item"
                            : price < line.listPrice
                              ? "Why below the list price"
                              : "Why above the list price"
                        }
                        className={`${FIELD} mt-1 w-full text-[12px]`}
                      />
                    )}
                    {line.relief && !line.free && (
                      <div className="mt-1 text-[11px] text-sky-800">
                        {order.relief?.kind === "pwd" ? "PWD" : "Senior citizen"}: 20% off, no
                        VAT (or a lower promo), set on saving
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      aria-label={`Quantity of ${line.medicine}`}
                      inputMode="numeric"
                      value={line.qty}
                      onChange={(event) =>
                        change(line.key, { qty: event.target.value.replace(/\D/g, "") })
                      }
                      className={`${FIELD} w-20 text-right`}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      aria-label={`Price of ${line.medicine}`}
                      inputMode="decimal"
                      disabled={line.free || line.relief}
                      value={line.free ? "0.00" : line.price}
                      onChange={(event) => change(line.key, { price: event.target.value })}
                      className={`${FIELD} w-24 text-right disabled:bg-slate-50`}
                    />
                  </td>
                  <td
                    className={`px-2 py-2 text-right tabular-nums ${line.stock < (Number(line.qty) || 0) ? "text-rose-700" : "text-slate-600"}`}
                  >
                    {count(line.stock)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">
                    {peso((Number(line.qty) || 0) * (Number.isFinite(price) ? price : 0))}
                  </td>
                  <td className="px-2 py-2">
                    <span className="flex justify-end gap-1">
                      {!line.free && (
                        <button
                          type="button"
                          title="Give some free (₱0)"
                          aria-label={`Give ${line.medicine} free`}
                          onClick={() => addFree(line)}
                          className="grid size-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50"
                        >
                          <Gift className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Take this line off"
                        aria-label={`Take ${line.medicine} off`}
                        onClick={() =>
                          setLines((all) => all.filter((other) => other.key !== line.key))
                        }
                        className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-700"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200">
              <td colSpan={4} className="px-3 py-2 text-right font-semibold text-slate-600">
                Total
              </td>
              <td className="px-2 py-2 text-right text-[15px] font-bold tabular-nums">
                {peso(total + order.deliveryFee)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-600">
          Why you changed it (the MedRep reads it)
        </span>
        <input
          value={why}
          onChange={(event) => setWhy(event.target.value)}
          placeholder="e.g. Promo Buy 10 Take 1, price as agreed with the hospital…"
          className={`${FIELD} w-full`}
        />
        {action.at("answer") && (
          <span className="text-xs text-rose-700">{action.at("answer")}</span>
        )}
      </label>
      {confirming && (
        <div className="rounded-lg border border-brand/30 bg-brand-tint/40 px-3.5 py-3 text-[13px]">
          <div className="font-semibold text-ink">Confirm changes</div>
          {changes.length === 0 ? (
            <div className="mt-1 text-ink-2">Nothing on the lines changed.</div>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {changes.map((one) => (
                <li key={`${one.name}-${one.what}`}>
                  <b className="text-ink">{one.name}</b>{" "}
                  <span
                    className={
                      one.tone === "add" ? "text-good" : one.tone === "off" ? "text-bad" : "text-ink"
                    }
                  >
                    {one.what}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 tabular-nums text-ink">
            Total {peso(totalBefore)} → <b>{peso(total + order.deliveryFee)}</b>
          </div>
          <div className="mt-1 text-ink-2">
            {order.medrep} is told what changed and why. Every version stays on the order.
          </div>
        </div>
      )}
      <Problem message={action.problem?.message} />
      <div className="flex justify-end gap-2">
        <Button
          onClick={() => (confirming ? setConfirming(false) : onDone())}
          disabled={action.busy}
        >
          {confirming ? "Back to editing" : "Cancel"}
        </Button>
        {confirming ? (
          <Button variant="primary" onClick={save} disabled={action.busy || lines.length === 0}>
            {action.busy ? "Saving…" : "Confirm changes"}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => setConfirming(true)}
            disabled={action.busy || lines.length === 0}
          >
            Save changes
          </Button>
        )}
      </div>
    </div>
  );
}
