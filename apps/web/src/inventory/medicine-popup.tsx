// A medicine at a glance, over the page (Aryan: open it where you are, don't leave the order):
// what each buyer pays, how much is free in each warehouse, the batches and their expiry, and
// what is coming in. The medicine's own page keeps everything else.

import type { MedicineDetail } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { count, Dialog, dayLabel, PageState, peso } from "../ui";

export function MedicinePopup({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["inventory", "medicine", id],
    queryFn: () => api<MedicineDetail>(`/api/inventory/medicines/${id}`),
  });
  const data = query.data;
  const m = data?.medicine;
  const title = m ? [m.name, m.strength].filter(Boolean).join(" ") : "Medicine";
  return (
    <Dialog
      title={title}
      sub={
        m
          ? [m.generic, m.form, m.pack, m.rx ? "Prescription medicine" : null]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
      onClose={onClose}
      wide
    >
      {!data || !m ? (
        <PageState query={query} what="the medicine" />
      ) : (
        <div className="flex flex-col gap-5 text-[13px]">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Price for each buyer
            </h3>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {data.buyerTypes
                .filter((buyer) => data.prices[buyer.key] !== undefined)
                .map((buyer) => (
                  <div
                    key={buyer.key}
                    className="flex items-baseline justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5"
                  >
                    <span className="text-slate-600">{buyer.label}</span>
                    <span className="text-right">
                      <b className="tabular-nums">{peso(data.prices[buyer.key] as number)}</b>
                      {data.packPrices[buyer.key] !== undefined && m.packSize > 1 && (
                        <span className="block text-[11px] text-slate-500 tabular-nums">
                          {peso(data.packPrices[buyer.key] as number)} a pack
                        </span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
            {data.promos.some((promo) => promo.state === "now") && (
              <p className="mt-1.5 text-xs text-emerald-700">
                Promo now:{" "}
                {data.promos
                  .filter((promo) => promo.state === "now")
                  .map(
                    (promo) =>
                      `${promo.name} ${peso(promo.amount)} until ${dayLabel(promo.endsOn)}`,
                  )
                  .join(" · ")}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Stock: {count(data.total)} {m.unit ?? "pieces"} on the shelf
              {data.expired ? ` · ${count(data.expired)} expired` : ""}
            </h3>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {data.warehouses.map((place) => {
                const here = data.batches.filter(
                  (batch) => batch.warehouseId === place.id && batch.state !== "expired",
                );
                const qty = here.reduce((sum, batch) => sum + batch.qty, 0);
                return (
                  <div
                    key={place.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-1.5"
                  >
                    <span className="text-slate-600">{place.name}</span>
                    <b className={`tabular-nums ${qty ? "" : "text-rose-700"}`}>{count(qty)}</b>
                  </div>
                );
              })}
            </div>
          </section>

          {data.batches.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Batches
              </h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {data.batches.map((batch) => (
                  <li
                    key={`${batch.batchId}-${batch.warehouseId}`}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                  >
                    <span>
                      <b>{batch.batchNo}</b>{" "}
                      <span className="text-slate-500">
                        · {data.warehouses.find((place) => place.id === batch.warehouseId)?.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span
                        className={
                          batch.state === "expired"
                            ? "text-rose-700"
                            : batch.state === "soon"
                              ? "text-amber-700"
                              : "text-slate-600"
                        }
                      >
                        {batch.state === "expired" ? "Expired " : "Expires "}
                        {dayLabel(batch.expiresOn)}
                      </span>
                      <b>{count(batch.qty)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.coming.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Coming in
              </h3>
              <ul className="flex flex-col gap-1">
                {data.coming.map((row) => (
                  <li key={row.purchaseId} className="flex justify-between gap-2">
                    <span>
                      {row.code} · {row.supplier} → {row.warehouse}
                    </span>
                    <span
                      className={`tabular-nums ${row.late ? "text-rose-700" : "text-slate-600"}`}
                    >
                      {count(row.qty)} · {row.late ? "late, was " : ""}
                      {dayLabel(row.expectedOn)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-3">
            <Link
              to={`/medicines/${id}`}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              Open the medicine's page
            </Link>
          </div>
        </div>
      )}
    </Dialog>
  );
}
