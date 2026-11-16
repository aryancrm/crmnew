// Management approves an order in one window (as the hub did): pick the warehouse it ships
// from (each says whether it can fill every line), see each medicine ordered against what is
// free there, say whether Finance checks it too, and approve.

import type { OrderDetail } from "@2mg/api/types";
import { CircleAlert, CircleCheck, Package } from "lucide-react";
import { useState } from "react";
import { Button, count, Dialog, Problem } from "../ui";

type Fill = NonNullable<OrderDetail["warehouseFill"]>[number];

export function ApproveDialog({
  data,
  initial,
  busy,
  problem,
  onApprove,
  onClose,
}: {
  data: OrderDetail;
  /** The warehouse already picked on the stock step, if any. */
  initial: string;
  busy: boolean;
  problem: string | null;
  onApprove: (choice: { warehouseId: number | null; finance: boolean | undefined }) => void;
  onClose: () => void;
}) {
  const { order } = data;
  const fill: Fill[] = data.warehouseFill ?? [];
  // The main warehouse unless only another can fill every line.
  const first =
    initial ||
    String(
      (
        fill.find((place) => place.isDefault && place.short.length === 0) ??
        fill.find((place) => place.short.length === 0) ??
        fill.find((place) => place.isDefault) ??
        fill[0]
      )?.id ?? "",
    );
  const [picked, setPicked] = useState(first);
  const [finance, setFinance] = useState(order.financeCheck);
  const place = fill.find((one) => String(one.id) === picked);
  // Only the warehouses that can fill the order (and the main one, and the one picked) show at
  // first; the ones short on a line wait behind "more" (Aryan, 17 Nov: less clutter).
  const [all, setAll] = useState(false);
  const useful = fill.filter(
    (one) => one.short.length === 0 || one.isDefault || String(one.id) === picked,
  );
  const shown = all || useful.length === 0 ? fill : useful;
  return (
    <Dialog
      title="Approve and check stock"
      sub={`${order.code} · ${order.customer}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="flex flex-col gap-4">
        {fill.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Send from warehouse
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {shown.map((one) => {
                const on = String(one.id) === picked;
                const fills = one.short.length === 0;
                return (
                  <button
                    key={one.id}
                    type="button"
                    onClick={() => setPicked(String(one.id))}
                    aria-pressed={on}
                    className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${on ? "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <span
                      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${on ? "border-emerald-600" : "border-slate-300"}`}
                      aria-hidden="true"
                    >
                      {on && <span className="size-2 rounded-full bg-emerald-600" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-900">
                        {one.name}
                        {one.isDefault && (
                          <span className="ml-1.5 text-[10px] font-semibold text-slate-400 uppercase">
                            Main
                          </span>
                        )}
                      </span>
                      <span
                        className={`mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium ${fills ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {fills ? (
                          <CircleCheck className="size-3.5" />
                        ) : (
                          <CircleAlert className="size-3.5" />
                        )}
                        {fills
                          ? "Can fill every line"
                          : `Short on ${one.short.length} ${one.short.length === 1 ? "line" : "lines"}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {shown.length < fill.length && (
              <button
                type="button"
                onClick={() => setAll(true)}
                className="mt-2 text-[12px] font-semibold text-slate-500 hover:text-slate-800"
              >
                {fill.length - shown.length} more, short on a line
              </button>
            )}
          </div>
        )}

        {place && (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Medicine</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Free here</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {place.lines.map((line) => (
                  <tr key={line.medicine}>
                    <td className="px-3 py-2 font-semibold text-slate-900">{line.medicine}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(line.need)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(line.have)}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`inline-flex items-center gap-1 text-[12px] font-semibold ${line.have >= line.need ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {line.have >= line.need
                          ? "Enough"
                          : `Short ${count(line.need - line.have)}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!order.leadId && (
          <label className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
            <input
              type="checkbox"
              checked={finance}
              onChange={(event) => setFinance(event.target.checked)}
            />
            Finance checks it too
          </label>
        )}
        <Problem message={problem} />
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
            <Package className="size-4" />
            {place
              ? place.short.length === 0
                ? `${place.name} has enough for every line.`
                : `${place.name} is short: Dispatch will see it.`
              : "Ships from the main warehouse."}
          </span>
          <span className="flex gap-2">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                onApprove({
                  warehouseId: picked ? Number(picked) : null,
                  finance: order.leadId ? undefined : finance,
                })
              }
            >
              {busy ? "Approving…" : "Approve"}
            </Button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
