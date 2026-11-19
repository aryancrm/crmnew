// Inventory's first page, after Zoho Inventory's Home: what is waiting (to be received, low,
// out, expiring), the news, the top stocked medicines and what moved last. Every figure comes
// from /api/overview and opens the list it counts.

import type { InventoryList, Overview, StockNews } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  CalendarClock,
  CircleAlert,
  PackageCheck,
  PackageX,
  Pill as PillIcon,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { NewsList } from "./news";
import { count, inPacks, PageHead, PageState, Panel, Status, Tile, timeLabel } from "../ui";
import { MOVE_WORDS } from "../words";

export function InventoryOverview() {
  const me = useMe().data;
  const overview = useQuery({
    queryKey: ["inventory", "overview"],
    queryFn: () => api<Overview>("/api/overview"),
    enabled: Boolean(me),
  });
  const news = useQuery({
    queryKey: ["inventory", "news"],
    queryFn: async () => (await api<{ news: StockNews[] }>("/api/stock-news")).news,
    enabled: Boolean(me),
  });
  if (!me) return null;
  const data = overview.data;
  const biggest = Math.max(1, ...(data?.topStocked ?? []).map((row) => row.total));

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead title="Inventory" sub="What needs doing, and where the stock stands" />

      {!data ? (
        <PageState query={overview} what="today's figures" />
      ) : (
        <div className="flex flex-col gap-4">
          {(Boolean(data.toReceive?.late) || data.stock.out > 0) && (
            <div className="flex flex-wrap gap-3">
              {Boolean(data.toReceive?.late) && (
                <Attention
                  to="/purchases/orders?stage=to_receive"
                  tone="bad"
                  icon={CalendarClock}
                  value={data.toReceive?.late as number}
                  label="Purchase orders late to arrive"
                />
              )}
              {data.stock.out > 0 && (
                <Attention
                  to="/inventory?show=out"
                  tone="bad"
                  icon={PackageX}
                  value={data.stock.out}
                  label="Medicines out of stock"
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
            <Tile
              to="/medicines"
              label="Medicines"
              value={count(data.stock.medicines)}
              sub="In the list"
              icon={PillIcon}
            />
            <Tile
              to="/inventory?show=low"
              label="Low stock"
              value={count(data.stock.low)}
              sub="At or under reorder level"
              tone={data.stock.low ? "warn" : "plain"}
              icon={TriangleAlert}
            />
            <Tile
              to="/inventory?show=out"
              label="Out of stock"
              value={count(data.stock.out)}
              sub="Nothing sellable"
              tone={data.stock.out ? "bad" : "plain"}
              icon={PackageX}
            />
            <Tile
              to="/inventory?show=expiring"
              label="Expiring"
              value={count(data.stock.expiring)}
              sub="A batch ends within 90 days"
              tone={data.stock.expiring ? "warn" : "plain"}
              icon={CalendarClock}
            />
            <Tile
              to="/inventory?show=expired"
              label="Expired on shelf"
              value={count(data.stock.expired)}
              sub="Medicines with an expired batch"
              tone={data.stock.expired ? "bad" : "plain"}
              icon={CircleAlert}
            />
            {data.toReceive && (
              <Tile
                to="/purchases/orders?stage=to_receive"
                label="To be received"
                value={count(data.toReceive.purchases)}
                sub={`${count(data.toReceive.pieces)} pieces on order`}
                tone="info"
                icon={PackageCheck}
              />
            )}
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              {news.data && news.data.length > 0 && (
                <Panel title="Stock news" count={news.data.length}>
                  <div className="px-4">
                    <NewsList news={news.data} />
                  </div>
                </Panel>
              )}
              <Panel
                title="Low and out of stock"
                count={data.stock.low + data.stock.out}
                actions={
                  <Link to="/inventory?show=low" className="font-semibold hover:underline">
                    See all
                  </Link>
                }
              >
                {data.low.length === 0 ? (
                  <div className="px-4 py-6 text-ink-2">
                    Every medicine is above its reorder level.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>Medicine</th>
                          <th className="num">Sellable</th>
                          <th className="num">Reorder level</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.low.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <Link
                                to={`/medicines/${row.id}`}
                                className="font-semibold hover:underline"
                              >
                                {[row.name, row.strength].filter(Boolean).join(" ")}
                              </Link>
                            </td>
                            <td className="num">{count(row.total)}</td>
                            <td className="num">{count(row.reorderLevel)}</td>
                            <td>
                              {row.status === "out" ? (
                                <Status tone="bad">Out of stock</Status>
                              ) : (
                                <Status tone="warn">Low stock</Status>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <ReorderPanel />
              <Panel title="Top stocked">
                <ul className="flex flex-col gap-3 px-4 py-3">
                  {data.topStocked.map((row) => (
                    <li key={row.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <Link
                          to={`/medicines/${row.id}`}
                          className="min-w-0 truncate font-semibold hover:text-brand-dark"
                        >
                          {[row.name, row.strength].filter(Boolean).join(" ")}
                        </Link>
                        <span className="whitespace-nowrap">
                          {count(row.total)} <span className="text-ink-2">{row.unit ?? "pcs"}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-head">
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{ width: `${Math.max(2, (row.total / biggest) * 100)}%` }}
                        />
                      </div>
                      {inPacks(row.total, row.packSize) && (
                        <div className="mt-0.5 text-xs text-ink-2">
                          {inPacks(row.total, row.packSize)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Recent stock activity">
                {data.activity.length === 0 ? (
                  <div className="px-4 py-6 text-ink-2">Nothing has moved yet.</div>
                ) : (
                  <ul className="flex flex-col px-4">
                    {data.activity.map((move) => (
                      <li
                        key={move.id}
                        className="flex items-start gap-3 border-b border-line-soft py-2.5 last:border-b-0"
                      >
                        <span
                          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${move.qty > 0 ? "bg-good-tint text-good" : "bg-info-tint text-info"}`}
                        >
                          <Boxes size={15} aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div>
                            <span className="font-semibold">{MOVE_WORDS[move.kind]}</span>{" "}
                            {move.qty > 0 ? "+" : "−"}
                            {count(Math.abs(move.qty))}{" "}
                            <Link
                              to={`/medicines/${move.medicineId}`}
                              className="text-brand-dark hover:underline"
                            >
                              {move.medicine}
                            </Link>
                          </div>
                          <div className="text-[13px] text-ink-2">
                            {move.warehouse} · batch {move.batchNo} · {move.by} ·{" "}
                            {timeLabel(move.at)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Attention({
  to,
  tone,
  icon: Icon,
  value,
  label,
}: {
  to: string;
  tone: "warn" | "bad";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: number;
  label: string;
}) {
  const colours =
    tone === "bad"
      ? "border-red-200 bg-bad-tint text-bad"
      : "border-amber-200 bg-warn-tint text-warn";
  return (
    <Link
      to={to}
      className={`flex min-w-56 flex-1 items-center gap-3 rounded-2xl border px-4 py-3 hover:shadow-card ${colours}`}
    >
      <Icon size={20} aria-hidden="true" />
      <span className="text-xl font-bold">{count(value)}</span>
      <span className="text-[13px] font-semibold text-ink">{label}</span>
    </Link>
  );
}

/** What to buy: medicines whose free stock and what is already coming fall short of their
 *  reorder level, the furthest short first, with a way to start the purchase order. */
function ReorderPanel() {
  const query = useQuery({
    queryKey: ["inventory", "list"],
    queryFn: () => api<InventoryList>("/api/inventory"),
  });
  const rows = (query.data?.medicines ?? [])
    .map((row) => ({ row, short: row.reorderLevel - (row.free + (row.coming?.qty ?? 0)) }))
    .filter(({ row, short }) => row.reorderLevel > 0 && short > 0)
    .sort((a, b) => b.short / b.row.reorderLevel - a.short / a.row.reorderLevel);
  if (!query.data) return null;
  if (rows.length === 0)
    return (
      <Panel title="To reorder">
        <p className="px-4 py-3 text-[13px] text-ink-2">
          Nothing to reorder: what is free and what is coming covers every reorder level.
        </p>
      </Panel>
    );
  return (
    <Panel title="To reorder" count={rows.length}>
      <ul className="flex flex-col divide-y divide-slate-100 px-4">
        {rows.slice(0, 8).map(({ row, short }) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
            <Link to={`/medicines/${row.id}`} className="min-w-0 hover:underline">
              <span className="block truncate text-[13px] font-semibold text-ink">
                {[row.name, row.strength].filter(Boolean).join(" ")}
              </span>
              <span className="text-[11px] text-ink-2">
                Free {count(row.free)}
                {row.coming ? ` · ${count(row.coming.qty)} coming` : ""} · reorder at{" "}
                {count(row.reorderLevel)}
              </span>
            </Link>
            <span className="shrink-0 text-right">
              <span className="block text-[13px] font-semibold text-bad tabular-nums">
                {count(short)} short
              </span>
              <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full bg-amber-400"
                  style={{
                    width: `${Math.max(4, Math.min(100, ((row.free + (row.coming?.qty ?? 0)) / row.reorderLevel) * 100))}%`,
                  }}
                />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-100 px-4 py-2.5">
        <Link to="/purchases/orders/new" className="text-xs font-semibold text-brand-dark hover:underline">
          New purchase order →
        </Link>
      </div>
    </Panel>
  );
}
