// Inventory: every medicine with its stock in each warehouse. One call brings the whole
// screen; search and the filters work on what is already here, so they are instant.

import type { InventoryList, MedicineRow } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, PackagePlus, Plus, Search, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { MedicineDialog, NewsDialog, ReceiveDialog } from "../inventory/dialogs";
import { NewsList } from "../inventory/news";
import {
  Button,
  Card,
  count,
  dayLabel,
  inPacks,
  PageHead,
  PageState,
  Panel,
  Pill,
  Tabs,
} from "../ui";

type Show = "all" | "out" | "low" | "expiring" | "expired";

export function StatusPill({ row }: { row: Pick<MedicineRow, "status" | "expiringSoon"> }) {
  if (row.status === "out") return <Pill tone="bad">Out of stock</Pill>;
  if (row.status === "low") return <Pill tone="warn">Low</Pill>;
  if (row.expiringSoon) return <Pill tone="warn">Expiring soon</Pill>;
  return <Pill tone="good">In stock</Pill>;
}

export function Inventory() {
  const query = useQuery({
    queryKey: ["inventory", "list"],
    queryFn: () => api<InventoryList>("/api/inventory"),
  });
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"receive" | "medicine" | "news" | null>(null);

  const show = (params.get("show") ?? "all") as Show;
  // One warehouse picked: only its column, and only what it holds.
  const place = Number(params.get("wh")) || 0;
  const search = params.get("q") ?? "";
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const data = query.data;
  const shown = useMemo(() => {
    if (!data) return [];
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return data.medicines.filter((row) => {
      if (show === "out" && row.status !== "out") return false;
      if (show === "low" && row.status !== "low") return false;
      if (show === "expiring" && !row.expiringSoon) return false;
      if (show === "expired" && row.expired === 0) return false;
      if (place && !(row.stock[place] ?? 0)) return false;
      const text = `${row.name} ${row.strength ?? ""} ${row.code}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [data, search, show, place]);

  if (!data) return <PageState query={query} what="the inventory" />;
  const { can, summary } = data;
  const warehouses = place
    ? data.warehouses.filter((warehouse) => warehouse.id === place)
    : data.warehouses;
  const year = data.today;

  const tiles: { key: Show; label: string; value: number; tone: string }[] = [
    { key: "all", label: "Medicines", value: summary.medicines, tone: "bg-white border-line" },
    {
      key: "out",
      label: "Out of stock",
      value: summary.out,
      tone: "bg-bad-tint border-[#f3b9b3] text-bad",
    },
    {
      key: "low",
      label: "Low stock",
      value: summary.low,
      tone: "bg-warn-tint border-[#f0d48a] text-warn",
    },
    {
      key: "expiring",
      label: "Batches expiring in 90 days",
      value: summary.expiring,
      tone: "bg-warn-tint border-[#f0d48a] text-warn",
    },
    {
      key: "expired",
      label: "Expired on the shelf",
      value: (data?.medicines ?? []).filter((row) => row.expired > 0).length,
      tone: "bg-bad-tint border-[#f3b4b4] text-bad",
    },
  ];

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="Stock"
        sub="What is on the shelf in each warehouse, what is coming, and what expires first"
        actions={
          <>
            {can.purchase && (
              <Button variant="primary" onClick={() => navigate("/purchases/new")}>
                <ShoppingCart size={16} aria-hidden="true" /> New purchase order
              </Button>
            )}
            {can.stock && (
              <Button onClick={() => setDialog("receive")}>
                <PackagePlus size={16} aria-hidden="true" /> Add stock
              </Button>
            )}
            {can.catalogue && (
              <Button onClick={() => setDialog("medicine")}>
                <Plus size={16} aria-hidden="true" /> Add medicine
              </Button>
            )}
            {can.stock && (
              <Button onClick={() => setDialog("news")}>
                <Megaphone size={16} aria-hidden="true" /> Post stock news
              </Button>
            )}
          </>
        }
      >
        <Tabs
          value={show}
          onChange={(key) => set("show", key === "all" ? "" : key)}
          tabs={tiles.map((tile) => ({ key: tile.key, label: tile.label, count: tile.value }))}
        />
      </PageHead>

      {data.news.length > 0 && (
        <Panel title="Stock news" count={data.news.length}>
          <div className="px-4">
            <NewsList news={data.news} canClose={can.stock} />
          </div>
        </Panel>
      )}

      <div className="relative">
        <Search
          size={17}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2"
          aria-hidden="true"
        />
        <input
          aria-label="Search a medicine"
          placeholder="Search a medicine"
          value={search}
          onChange={(event) => set("q", event.target.value)}
          className="field pl-10"
        />
      </div>
      {data.warehouses.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ id: 0, name: "All warehouses" }, ...data.warehouses].map((warehouse) => (
            <button
              key={warehouse.id}
              type="button"
              onClick={() => set("wh", warehouse.id ? String(warehouse.id) : "")}
              className={`h-8 rounded-full border px-3 text-xs font-semibold ${
                place === warehouse.id
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {warehouse.name}
            </button>
          ))}
        </div>
      )}

      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-xs text-ink-2">
              <th className="border-b border-line px-5 py-3 font-medium">Medicine</th>
              {warehouses.map((warehouse) => (
                <th
                  key={warehouse.id}
                  className="border-b border-line px-3 py-3 text-right font-medium"
                >
                  {warehouse.name.replace(/ warehouse$/i, "")}
                </th>
              ))}
              <th className="border-b border-line px-3 py-3 text-right font-medium">
                On the shelf
              </th>
              <th className="border-b border-line px-3 py-3 text-right font-medium">Promised</th>
              <th className="border-b border-line px-3 py-3 text-right font-medium">
                Free to sell
              </th>
              <th className="border-b border-line px-3 py-3 font-medium">Coming</th>
              <th className="border-b border-line px-3 py-3 font-medium">Nearest expiry</th>
              <th className="border-b border-line px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/medicines/${row.id}`)}
                className="cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-hover"
              >
                <td className="px-5 py-3">
                  <Link
                    to={`/medicines/${row.id}`}
                    className="font-semibold hover:text-brand"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.name} {row.strength}
                  </Link>
                  <div className="text-xs text-ink-2">
                    {row.code}
                    {row.pack ? ` · ${row.pack}` : ""}
                  </div>
                </td>
                {warehouses.map((warehouse) => (
                  <td key={warehouse.id} className="px-3 py-3 text-right">
                    {count(row.stock[warehouse.id] ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-3 text-right tabular-nums">{count(row.total)}</td>
                <td
                  className={`px-3 py-3 text-right tabular-nums ${row.promised ? "text-amber-700" : "text-ink-3"}`}
                  title={
                    row.promised
                      ? `On ${row.promisedOrders} placed order${row.promisedOrders === 1 ? "" : "s"} not packed yet`
                      : undefined
                  }
                >
                  {row.promised ? count(row.promised) : "—"}
                  {row.promised > 0 && (
                    <div className="text-xs text-ink-2">
                      {row.promisedOrders} order{row.promisedOrders === 1 ? "" : "s"}
                    </div>
                  )}
                </td>
                <td
                  className={`px-3 py-3 text-right font-semibold ${row.free === 0 && row.total > 0 ? "text-bad" : ""}`}
                >
                  {count(row.free)}
                  <div className="text-xs font-normal text-ink-2">
                    {inPacks(row.free, row.packSize)}
                  </div>
                  {row.expired > 0 && (
                    <div className="text-xs font-normal text-bad">{count(row.expired)} expired</div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {row.coming ? (
                    `${count(row.coming.qty)} · ${dayLabel(row.coming.on, year)}`
                  ) : (
                    <span className="text-ink-2">None</span>
                  )}
                </td>
                <td className={`px-3 py-3 ${row.expiringSoon ? "font-semibold text-warn" : ""}`}>
                  {row.nearestExpiry ? (
                    dayLabel(row.nearestExpiry)
                  ) : (
                    <span className="text-ink-2">None</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <StatusPill row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty />}
      </Card>

      <div className="flex flex-col gap-3 md:hidden">
        {shown.map((row) => (
          <Link
            key={row.id}
            to={`/medicines/${row.id}`}
            className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">
                  {row.name} {row.strength}
                </div>
                <div className="text-xs text-ink-2">{row.pack ?? row.code}</div>
              </div>
              <StatusPill row={row} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <span>
                <span className="font-semibold">{count(row.free)}</span> free to sell
                {inPacks(row.free, row.packSize) && (
                  <span className="text-ink-2"> ({inPacks(row.free, row.packSize)})</span>
                )}
              </span>
              {row.promised > 0 && (
                <span className="text-amber-700">
                  {count(row.promised)} promised on {row.promisedOrders} order
                  {row.promisedOrders === 1 ? "" : "s"}
                </span>
              )}
              {warehouses.map((warehouse) => (
                <span key={warehouse.id} className="text-ink-2">
                  {warehouse.name.replace(/ warehouse$/i, "")} {count(row.stock[warehouse.id] ?? 0)}
                </span>
              ))}
            </div>
            {(row.coming || row.nearestExpiry) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
                {row.coming && (
                  <span>
                    {count(row.coming.qty)} coming {dayLabel(row.coming.on, year)}
                  </span>
                )}
                {row.nearestExpiry && (
                  <span className={row.expiringSoon ? "font-semibold text-warn" : ""}>
                    Expires {dayLabel(row.nearestExpiry)}
                  </span>
                )}
              </div>
            )}
          </Link>
        ))}
        {shown.length === 0 && (
          <Card>
            <Empty />
          </Card>
        )}
      </div>

      <div className="text-[13px] text-ink-2">
        {shown.length === data.medicines.length
          ? `${count(shown.length)} medicines`
          : `${count(shown.length)} of ${count(data.medicines.length)} medicines`}
      </div>

      {dialog === "receive" && (
        <ReceiveDialog
          warehouses={warehouses}
          medicines={data.medicines}
          canCost={can.cost}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "news" && (
        <NewsDialog medicines={data.medicines} onClose={() => setDialog(null)} />
      )}
      {dialog === "medicine" && (
        <MedicineDialog
          onClose={() => setDialog(null)}
          onSaved={(id) => navigate(`/medicines/${id}`)}
        />
      )}
    </div>
  );
}

const Empty = () => <div className="p-8 text-center text-ink-2">No medicine matches.</div>;
