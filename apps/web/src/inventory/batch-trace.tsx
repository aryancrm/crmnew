// Batch trace (docs/ERP-PLAN.md phase 3), for a recall or a complaint: type a batch number and see
// the medicine, where its pieces are now, every customer it reached (with how to reach them) and
// every move it made. Print the customer list, or take it as a CSV, to call them.

import type { BatchTrace } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { timeLabel } from "../ui";
import { EmptyState, NoResults } from "../no-results";

const CARD = "rounded-xl border border-slate-200 bg-white";
const TH = "px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase";

function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function BatchTracePage() {
  const [params, setParams] = useSearchParams();
  const batch = params.get("batch") ?? "";
  const query = useQuery({
    queryKey: ["trace", batch],
    queryFn: () => api<BatchTrace>(`/api/trace?batch=${encodeURIComponent(batch)}`),
    enabled: Boolean(batch),
  });
  const data = query.data;
  return (
    <div className="mx-auto w-full max-w-screen-xl space-y-4">
      <header className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Batch trace</h1>
        <p className="mt-1 text-[13px] text-slate-500">For a recall or a complaint: where a batch is now, every customer it reached, every move it made.</p>
      </header>
      <form
        className="flex gap-2 print:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = new FormData(event.currentTarget).get("batch");
          setParams(typed ? { batch: String(typed).trim() } : {});
        }}
      >
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
          <input name="batch" defaultValue={batch} placeholder="Batch number" className="h-10 w-72 rounded-lg border border-slate-200 bg-white pr-3 pl-8 text-sm" />
        </label>
        <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
          Trace
        </button>
      </form>
      {query.isError && <p className="text-sm text-rose-700">{(query.error as Error).message}</p>}
      {batch && data && !data.batches.length && (
        <NoResults title={<>No batch numbered like "{batch}".</>}>Check the batch number and trace it again.</NoResults>
      )}
      {data && data.batches.length > 0 && (
        <>
          <section className={`${CARD} p-4`}>
            {data.batches.map((one) => (
              <div key={one.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-100 py-2 text-sm last:border-b-0">
                <span className="font-semibold text-slate-900">Batch {one.batchNo}</span>
                <Link to={`/medicines/${one.medicineId}`} className="font-medium text-brand hover:underline">
                  {one.medicine}
                </Link>
                <span className="text-slate-600">Expires {one.expires ?? "—"}</span>
                <span className="text-slate-600">{one.onHand.toLocaleString("en-PH")} on the shelves</span>
                <span className="text-slate-500">
                  {data.places
                    .filter((place) => place.batchId === one.id)
                    .map((place) => `${place.warehouse} ${place.qty.toLocaleString("en-PH")}`)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </section>
          <section className={CARD}>
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Customers it reached ({data.customers.length})</h2>
              <div className="flex gap-2 print:hidden">
                <button type="button" onClick={() => window.print()} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm">
                  <Printer className="size-4" /> Print
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(`batch-${batch}-customers`, [
                      ["Customer", "Kind", "Phone", "Address", "City", "Orders", "Pieces", "Came back", "First", "Last"],
                      ...data.customers.map((one) => [one.name, one.kind, one.phone, one.address, one.city, one.orders, one.pieces, one.returned, one.first, one.last]),
                    ])
                  }
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm"
                >
                  <Download className="size-4" /> CSV
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>Customer</th>
                    <th className={TH}>Phone</th>
                    <th className={TH}>Address</th>
                    <th className={TH}>Orders</th>
                    <th className={`${TH} text-right`}>Pieces</th>
                    <th className={`${TH} text-right`}>Came back</th>
                    <th className={TH}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map((one) => (
                    <tr key={`${one.customerId}-${one.address}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2">
                        <Link to={`/customers/${one.customerId}`} className="font-semibold text-brand hover:underline">
                          {one.name}
                        </Link>
                        <div className="text-xs text-slate-500 capitalize">{one.kind}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{one.phone ?? "—"}</td>
                      <td className="px-3 py-2">{[one.address, one.city].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-3 py-2">{one.orders}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{one.pieces.toLocaleString("en-PH")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{one.returned ? one.returned.toLocaleString("en-PH") : ""}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{one.first === one.last ? one.first : `${one.first} – ${one.last}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.customers.length && <EmptyState title="No piece of it has gone to a customer.">Every customer this batch reaches shows here, with how to reach them.</EmptyState>}
            </div>
          </section>
          <section className={`${CARD} print:hidden`}>
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Every move ({data.moves.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={TH}>When</th>
                    <th className={TH}>Move</th>
                    <th className={`${TH} text-right`}>Pieces</th>
                    <th className={TH}>Warehouse</th>
                    <th className={TH}>For</th>
                    <th className={TH}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.moves.map((one, n) => (
                    <tr key={`${one.at}-${n}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{timeLabel(one.at)}</td>
                      <td className="px-3 py-2 capitalize">{one.kind.replace("_", " ")}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${one.qty < 0 ? "text-rose-700" : "text-emerald-700"}`}>{one.qty.toLocaleString("en-PH")}</td>
                      <td className="px-3 py-2">{one.warehouse}</td>
                      <td className="px-3 py-2">
                        {one.orderId ? (
                          <Link to={`/orders/${one.orderId}`} className="text-brand hover:underline">
                            {one.ref} · {one.customer}
                          </Link>
                        ) : (
                          [one.ref, one.note].filter(Boolean).join(" · ")
                        )}
                      </td>
                      <td className="px-3 py-2">{one.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
