// Management changes an order's medicines where it checks them (Aryan, as the hub did): a quick
// search adds a medicine, a line given free is the same medicine at ₱0 with its remark, prices and
// quantities change in place, a line comes off. Saving sends the whole order back through the
// same change the MedRep's form uses; the MedRep is told what changed.

import type { BuyerType, Catalogue, CatalogueRow, OrderDetail } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { Button, count, Problem, peso, useAction } from "../ui";

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
      reason: item.reason ?? "",
      stock: item.inStock,
    })),
  );
  const [search, setSearch] = useState("");
  const [why, setWhy] = useState("");
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
      { ...line, key: keyOf(), qty: line.qty, price: "0.00", free: true, reason: "Free item" },
    ]);
  }

  const total = lines.reduce((sum, line) => {
    const price = line.free ? 0 : typed(line.price);
    return sum + (Number(line.qty) || 0) * (Number.isFinite(price) ? price : 0);
  }, 0);

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
            reason: line.free
              ? line.reason.trim() || "Free item"
              : typed(line.price) < line.listPrice
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
          answer: why.trim() || "Medicines changed by Management",
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
              const below = !line.free && Number.isFinite(price) && price < line.listPrice;
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
                    {(line.free || below) && (
                      <input
                        aria-label={`Remark for ${line.medicine}`}
                        value={line.reason}
                        onChange={(event) => change(line.key, { reason: event.target.value })}
                        placeholder={line.free ? "Free item" : "Why below the list price"}
                        className={`${FIELD} mt-1 w-full text-[12px]`}
                      />
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
                      disabled={line.free}
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

      <input
        aria-label="A word for the MedRep (optional)"
        value={why}
        onChange={(event) => setWhy(event.target.value)}
        placeholder="A word for the MedRep (optional): promo, Buy 10 Take 1…"
        className={`${FIELD} w-full`}
      />
      <Problem message={action.problem?.message} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone} disabled={action.busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={action.busy || lines.length === 0}>
          {action.busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
