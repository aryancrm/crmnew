// The stock report: every batch in every warehouse, as Zoho's Batch Details Report lists them, and
// more: the days to expiry, what came in and went out, what is on the shelf, what placed orders
// promised of each medicine and so what is free, and (for those who see costs) what it cost and
// is worth. The API does the filtering, so "Download Excel" gives exactly the rows on the screen.

import type { Warehouse } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Card, count, dayLabel, inPacks, PageHead, PageState, Pill, peso, Tile } from "../ui";
import { EmptyState, NoResults } from "../no-results";

// The API's answer (StockReport in apps/api/src/inventory/stock-report.ts), written out here: the
// web reads the API's types only through @2mg/api/types.
type Row = {
  medicineId: number;
  medicine: string;
  code: string;
  sku: string | null;
  packSize: number;
  batchId: number;
  batchNo: string;
  expiresOn: string;
  daysToExpiry: number;
  state: "ok" | "soon" | "expired";
  warehouseId: number;
  warehouse: string;
  receivedOn: string | null;
  vendor: string | null;
  received: number;
  moved: number;
  packed: number;
  samples: number;
  counted: number;
  onShelf: number;
  unitCost: number | null;
  value: number | null;
};
type MedicineLine = {
  medicineId: number;
  medicine: string;
  code: string;
  sku: string | null;
  packSize: number;
  sellable: number;
  expired: number;
  promised: number;
  promisedOrders: number;
  free: number;
};
type StockReport = {
  today: string;
  expiringDays: number;
  can: { cost: boolean };
  warehouses: Warehouse[];
  rows: Row[];
  medicines: MedicineLine[];
  totals: {
    rows: number;
    batches: number;
    medicines: number;
    received: number;
    moved: number;
    packed: number;
    samples: number;
    counted: number;
    onShelf: number;
    expired: number;
    soon: number;
    promised: number;
    free: number;
    value: number | null;
    expiredValue: number | null;
    uncosted: number | null;
  };
};

const WITHIN: [string, string][] = [
  ["", "Any expiry"],
  ["30", "Expired or expiring in 30 days"],
  ["90", "Expired or expiring in 90 days"],
  ["180", "Expired or expiring in 180 days"],
  ["365", "Expired or expiring in a year"],
];

/** +20, −20, or a dash for nothing. */
const signed = (value: number) =>
  value > 0 ? `+${count(value)}` : value < 0 ? `−${count(-value)}` : "—";

export function StockReportPage() {
  const [params, setParams] = useSearchParams();
  const warehouse = params.get("warehouse") ?? "";
  const within = params.get("within") ?? "";
  const empty = params.get("empty") === "1";
  const asked = params.get("q") ?? "";
  const [typed, setTyped] = useState(asked);

  // From the address as it is now, so a search that settles late keeps a filter picked meanwhile.
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  // The search goes to the address (and so to the API) once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      const now = new URLSearchParams(window.location.search).get("q") ?? "";
      if (typed.trim() !== now) set("q", typed.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [typed]);

  // The same filters for the screen and the Excel file.
  const filters = new URLSearchParams();
  if (warehouse) filters.set("warehouse", warehouse);
  if (asked) filters.set("q", asked);
  if (within) filters.set("within", within);
  if (empty) filters.set("empty", "1");
  const qs = filters.toString();

  const query = useQuery({
    queryKey: ["inventory", "stock-report", qs],
    queryFn: () => api<StockReport>(`/api/inventory/stock-report${qs ? `?${qs}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the stock report" />;

  const { totals, can, today } = data;
  const medicineOf = new Map(data.medicines.map((line) => [line.medicineId, line]));
  // A movement's column shows only when some batch here has one (the Excel file has them all).
  const show = {
    moved: data.rows.some((row) => row.moved !== 0),
    out: data.rows.some((row) => row.packed !== 0 || row.samples !== 0),
    counted: data.rows.some((row) => row.counted !== 0),
  };
  const columns =
    5 + Number(show.moved) + Number(show.out) + Number(show.counted) + (can.cost ? 2 : 0);
  const filtered = Boolean(qs);

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="Stock report"
        sub={`Every batch in every warehouse, as of ${dayLabel(today)}`}
        actions={
          <a
            href={`/api/inventory/stock-report.xlsx${qs ? `?${qs}` : ""}`}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Download className="size-4" aria-hidden="true" /> Download Excel
          </a>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-[1_1_18rem]">
          <Search
            size={17}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2"
            aria-hidden="true"
          />
          <input
            aria-label="Search a medicine, SKU or batch"
            placeholder="Search a medicine, SKU or batch"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="field pl-10"
          />
        </div>
        <select
          aria-label="Warehouse"
          value={warehouse}
          onChange={(event) => set("warehouse", event.target.value)}
          className="field !w-auto min-w-48"
        >
          <option value="">All warehouses</option>
          {data.warehouses.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Expiry"
          value={within}
          onChange={(event) => set("within", event.target.value)}
          className="field !w-auto min-w-56"
        >
          {WITHIN.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-2 px-1 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={empty}
            onChange={(event) => set("empty", event.target.checked ? "1" : "")}
            className="size-4 accent-emerald-600"
          />
          Show batches with nothing left
        </label>
      </div>

      <div
        className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${can.cost ? "xl:grid-cols-6" : "xl:grid-cols-5"}`}
      >
        <Tile
          label="Batches"
          value={count(totals.batches)}
          sub={`${count(totals.medicines)} ${totals.medicines === 1 ? "medicine" : "medicines"}`}
        />
        <Tile label="On the shelf" value={count(totals.onShelf)} sub="pieces" />
        <Tile
          label="Expired on the shelf"
          value={count(totals.expired)}
          sub="pieces past their expiry"
          tone={totals.expired > 0 ? "bad" : "plain"}
        />
        <Tile
          label={`Expiring in ${data.expiringDays} days`}
          value={count(totals.soon)}
          sub="pieces"
          tone={totals.soon > 0 ? "warn" : "plain"}
        />
        <Tile
          label="Free to sell"
          value={count(totals.free)}
          sub={
            totals.promised > 0
              ? `after ${count(totals.promised)} promised to orders`
              : "nothing promised to orders"
          }
        />
        {can.cost && totals.value !== null && (
          <Tile
            label="Value on the shelf"
            value={peso(totals.value)}
            sub={
              totals.uncosted
                ? `${count(totals.uncosted)} pieces have no cost on file`
                : totals.expiredValue
                  ? `${peso(totals.expiredValue)} of it expired`
                  : "at what it cost to land"
            }
          />
        )}
      </div>

      <Card className={`overflow-x-auto ${query.isPlaceholderData ? "opacity-60" : ""}`}>
        <table className="t">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Expiry</th>
              <th>Warehouse</th>
              <th className="num">Received</th>
              {show.moved && <th className="num">Moved</th>}
              {show.out && <th className="num">Went out</th>}
              {show.counted && <th className="num">Counted</th>}
              <th className="num">On the shelf</th>
              {can.cost && <th className="num">Cost of one</th>}
              {can.cost && <th className="num">Value</th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, at) => {
              const first = data.rows[at - 1]?.medicineId !== row.medicineId;
              const line = medicineOf.get(row.medicineId);
              return (
                <Fragment key={`${row.batchId}:${row.warehouseId}`}>
                  {first && line && (
                    <MedicineHead line={line} columns={columns} oneWarehouse={Boolean(warehouse)} />
                  )}
                  <tr
                    className={
                      row.state === "expired"
                        ? "bg-bad-tint/50"
                        : row.state === "soon"
                          ? "bg-warn-tint/40"
                          : ""
                    }
                  >
                    <td className="pl-6">
                      <div className="font-medium whitespace-nowrap">{row.batchNo}</div>
                      {row.receivedOn && (
                        <div className="text-xs whitespace-nowrap text-ink-2">
                          Received {dayLabel(row.receivedOn, today)}
                        </div>
                      )}
                      {row.vendor && <div className="max-w-56 truncate text-xs text-ink-2" title={row.vendor}>from {row.vendor}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      <div
                        className={
                          row.state === "expired"
                            ? "font-semibold text-bad"
                            : row.state === "soon"
                              ? "font-semibold text-warn"
                              : ""
                        }
                      >
                        {dayLabel(row.expiresOn)}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-2">
                        {row.state === "expired" ? (
                          <>
                            <Pill tone="bad">Expired</Pill>{" "}
                            {`${count(-row.daysToExpiry)} ${row.daysToExpiry === -1 ? "day" : "days"} ago`}
                          </>
                        ) : row.state === "soon" ? (
                          <Pill tone="warn">
                            {row.daysToExpiry === 0
                              ? "Expires today"
                              : `In ${count(row.daysToExpiry)} ${row.daysToExpiry === 1 ? "day" : "days"}`}
                          </Pill>
                        ) : (
                          `in ${count(row.daysToExpiry)} days`
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{row.warehouse}</td>
                    <td className="num">{count(row.received)}</td>
                    {show.moved && <td className="num">{signed(row.moved)}</td>}
                    {show.out && (
                      <td
                        className="num"
                        title={`Packed for orders (less what came back): ${count(row.packed)} · Samples: ${count(row.samples)}`}
                      >
                        {row.packed + row.samples ? count(row.packed + row.samples) : "—"}
                      </td>
                    )}
                    {show.counted && (
                      <td
                        className={`num ${row.counted < 0 ? "text-bad" : row.counted > 0 ? "text-good" : ""}`}
                      >
                        {signed(row.counted)}
                      </td>
                    )}
                    <td className="num">
                      <div className="font-semibold">{count(row.onShelf)}</div>
                      {inPacks(row.onShelf, row.packSize) && (
                        <div className="text-xs whitespace-nowrap text-ink-2">
                          {inPacks(row.onShelf, row.packSize)}
                        </div>
                      )}
                    </td>
                    {can.cost && (
                      <td className="num whitespace-nowrap">
                        {row.unitCost === null ? (
                          <span className="text-ink-2">Not known</span>
                        ) : (
                          peso(row.unitCost)
                        )}
                      </td>
                    )}
                    {can.cost && (
                      <td className="num whitespace-nowrap">
                        {row.value === null ? "—" : peso(row.value)}
                      </td>
                    )}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td colSpan={3} className="px-3 py-3">
                  Total · {count(totals.batches)} {totals.batches === 1 ? "batch" : "batches"} in{" "}
                  {count(totals.rows)} {totals.rows === 1 ? "place" : "places"}
                </td>
                <td className="px-3 py-3 text-right">{count(totals.received)}</td>
                {show.moved && <td className="px-3 py-3 text-right">{signed(totals.moved)}</td>}
                {show.out && (
                  <td className="px-3 py-3 text-right">{count(totals.packed + totals.samples)}</td>
                )}
                {show.counted && (
                  <td className="px-3 py-3 text-right">{signed(totals.counted)}</td>
                )}
                <td className="px-3 py-3 text-right">{count(totals.onShelf)}</td>
                {can.cost && <td />}
                {can.cost && (
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {totals.value === null ? "—" : peso(totals.value)}
                  </td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
        {data.rows.length === 0 && (
          <div>
            {filtered ? (
              <NoResults title="No batch matches.">Try another filter, or clear the search.</NoResults>
            ) : (
              <EmptyState title="Nothing on the shelf yet.">Batches show here once stock is received.</EmptyState>
            )}
          </div>
        )}
      </Card>

      <p className="text-[13px] text-ink-2">
        Received: bought, opening stock or added. Moved: to and from other warehouses. Went out:
        packed for orders (less what came back) and samples. Counted: what a stock count found over
        or short. Promised and free to sell are for the whole medicine, in all warehouses.
      </p>
    </div>
  );
}

/** A medicine's line over its batches: what is on the shelf, promised and free in all warehouses. */
function MedicineHead({
  line,
  columns,
  oneWarehouse,
}: {
  line: MedicineLine;
  columns: number;
  oneWarehouse: boolean;
}) {
  return (
    <tr className="bg-slate-50">
      <td colSpan={columns}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="min-w-0">
            <Link to={`/medicines/${line.medicineId}`} className="font-semibold hover:underline">
              {line.medicine}
            </Link>
            <span className="ml-2 text-xs text-ink-2">
              {[line.sku, line.code].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink-2">
            <span>
              {count(line.sellable)} on the shelf{oneWarehouse ? " in all warehouses" : ""}
            </span>
            {line.expired > 0 && <span className="text-bad">{count(line.expired)} expired</span>}
            {line.promised > 0 && (
              <span className="text-amber-700">
                {count(line.promised)} promised on {count(line.promisedOrders)}{" "}
                {line.promisedOrders === 1 ? "order" : "orders"}
              </span>
            )}
            <span className={`font-semibold ${line.free === 0 ? "text-bad" : "text-ink"}`}>
              {count(line.free)} free to sell
              {inPacks(line.free, line.packSize) ? ` (${inPacks(line.free, line.packSize)})` : ""}
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
}
