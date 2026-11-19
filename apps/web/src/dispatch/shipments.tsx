// Shipments, as Zoho Inventory lists them: every parcel that left, with its courier and
// tracking or rider, and who received it. One order's delivery receipt, to print and have
// signed; and its address slip (the hub's Print address), stuck on the parcel and checked
// against the order before it is shipped.

import type { OrderDetail, ShipmentList, ShipmentTab } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Search, Snowflake } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { type DispatchAsk, DispatchDialogs } from "./parts";
import { StatusPill, waited } from "../orders/parts";
import {
  Button,
  Card,
  count,
  dayLabel,
  inPacks,
  PageHead,
  PageState,
  peso,
  Tabs,
  timeLabel,
} from "../ui";

const TAB_LABEL: Record<ShipmentTab, string> = {
  road: "On the road",
  delivered: "Delivered",
  all: "All",
};

/** How a parcel went, in a few words. */
export const howItWent = (row: {
  deliveryMethod: string | null;
  courier: string | null;
  tracking: string | null;
  trackingWait?: string | null;
  rider: string | null;
}) =>
  row.deliveryMethod === "pickup"
    ? "Picked up at the warehouse"
    : row.deliveryMethod === "rider"
      ? `Our rider · ${row.rider}`
      : row.courier
        ? `${row.courier}${row.tracking ? ` · ${row.tracking}` : ` · tracking to follow${row.trackingWait ? ` (${row.trackingWait.toLowerCase()})` : ""}`}`
        : "—";

export function Shipments() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [typed, setTyped] = useState(params.get("q") ?? "");
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts the timer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== (params.get("q") ?? "")) set({ q: typed.trim() });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const search = ["tab", "q", "page"]
    .map((key) =>
      params.get(key) ? `${key}=${encodeURIComponent(params.get(key) as string)}` : "",
    )
    .filter(Boolean)
    .join("&");
  const me = useMe().data;
  // Dispatch marks a parcel delivered or back, or adds its tracking, from the row.
  const works = me?.role === "dispatch" || me?.role === "admin";
  const [asking, setAsking] = useState<DispatchAsk>(null);
  const query = useQuery({
    queryKey: ["dispatch", "shipments", search],
    queryFn: () => api<ShipmentList>(`/api/shipments?${search}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the shipments" />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title={
          data.tab === "road" ? "On the road" : data.tab === "delivered" ? "Delivered" : "Shipments"
        }
        sub={
          data.tab === "road"
            ? "Parcels out with a courier or our rider, the longest out first to chase"
            : "Every parcel that left the warehouse"
        }
      >
        <Tabs
          value={data.tab}
          onChange={(key) => set({ tab: key === "road" ? "" : key })}
          tabs={(Object.keys(TAB_LABEL) as ShipmentTab[]).map((key) => ({
            key,
            label: TAB_LABEL[key],
            count: data.counts[key],
          }))}
        />
      </PageHead>
      <Card className="overflow-x-auto">
        <div className="border-b border-line-soft px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input
              type="search"
              aria-label="Search shipments"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Order, customer, courier, tracking or rider"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/70 pr-3 pl-9 text-sm focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/10 focus:outline-none"
            />
          </div>
        </div>
        {data.rows.length === 0 ? (
          <div className="p-8 text-center text-ink-2">
            {data.tab === "road" ? "Nothing is on the way." : "No shipment here."}
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Shipped</th>
                {data.tab === "road" && <th>Out for</th>}
                <th>Order</th>
                <th>Customer</th>
                <th>How it went</th>
                <th>Status</th>
                {data.tab !== "road" && <th>Delivered</th>}
                {data.tab !== "road" && <th>Received by</th>}
                <th className="num">Amount</th>
                {data.tab === "road" && works && <th className="sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/orders/${row.id}`)}
                >
                  <td className="whitespace-nowrap">
                    {row.shippedAt ? timeLabel(row.shippedAt) : "—"}
                  </td>
                  {data.tab === "road" && (
                    <td className="whitespace-nowrap">
                      {row.shippedAt ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                            (Date.now() - Date.parse(row.shippedAt)) / 3_600_000 >= 72
                              ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {waited(row.shippedAt)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td>
                    <Link
                      to={`/orders/${row.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="font-semibold whitespace-nowrap hover:underline"
                    >
                      {row.code}
                    </Link>
                  </td>
                  <td>
                    <div className="font-semibold">{row.customer}</div>
                    <div className="text-xs text-ink-2">
                      {row.city ? `${row.city} · ` : ""}
                      {row.medrep}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{howItWent(row)}</td>
                  <td>
                    <StatusPill status={row.status} label={row.statusLabel} />
                  </td>
                  {data.tab !== "road" && (
                    <td className="whitespace-nowrap">
                      {row.deliveredOn ? dayLabel(row.deliveredOn) : "—"}
                    </td>
                  )}
                  {data.tab !== "road" && <td>{row.receivedBy ?? "—"}</td>}
                  <td className="num font-semibold whitespace-nowrap">{peso(row.total)}</td>
                  {data.tab === "road" && works && (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside have their own keys
                    <td onClick={(event) => event.stopPropagation()} className="whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {row.deliveryMethod === "courier" && !row.tracking && (
                          <button
                            type="button"
                            onClick={() =>
                              setAsking({ what: "tracking", orderId: row.id, code: row.code })
                            }
                            className="h-8 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                          >
                            Add tracking
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setAsking({ what: "failed", orderId: row.id, code: row.code })
                          }
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Came back
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAsking({ what: "deliver", orderId: row.id, code: row.code })
                          }
                          className="h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-dark"
                        >
                          Delivered
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-line-soft px-4 py-3 text-[13px]">
            <span className="text-ink-2">
              Page {data.page} of {pages}
            </span>
            <Button
              small
              disabled={data.page <= 1}
              onClick={() => set({ page: String(data.page - 1) })}
            >
              Previous
            </Button>
            <Button
              small
              disabled={data.page >= pages}
              onClick={() => set({ page: String(data.page + 1) })}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
      {query.isError && (
        <div className="mt-3 text-[13px] text-bad">
          Couldn't refresh the shipments. {count(data.rows.length)} shown from before.
        </div>
      )}
      <DispatchDialogs ask={asking} onClose={() => setAsking(null)} />
    </div>
  );
}

const expiry = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** The delivery receipt that goes with the parcel: what is in the box, batch by batch, and
 *  lines for the customer to sign. */
export function DeliveryReceipt() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["orders", "one", id],
    queryFn: () => api<OrderDetail>(`/api/orders/${id}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the delivery receipt" />;
  const { order } = data;
  const packed = data.picks.length > 0;
  const rows = packed
    ? data.picks.map((pick) => ({
        key: `p${pick.id}`,
        medicine: pick.medicine,
        batch: pick.batchNo,
        expires: expiry(pick.expiresOn),
        qty: pick.qty,
        packSize: pick.packSize,
      }))
    : data.items.map((item) => ({
        key: `i${item.id}`,
        medicine: item.medicine,
        batch: "—",
        expires: "—",
        qty: item.qty,
        packSize: item.packSize,
      }));
  const via =
    order.deliveryMethod === "courier"
      ? `${order.courier}${order.tracking ? ` · ${order.tracking}` : ""}`
      : order.deliveryMethod === "rider"
        ? `Our rider · ${order.rider}`
        : order.deliveryMethod === "pickup"
          ? "Picked up at the warehouse"
          : "—";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-ink"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back
        </button>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" /> Print
        </Button>
      </div>
      {!packed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 print:hidden">
          Not packed yet: the batches are filled in when Dispatch packs it.
        </div>
      )}
      <Card className="flex flex-col gap-6 p-6 md:p-8 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-lg font-bold">{order.invoiceFromLabel}</div>
            <div className="text-[13px] text-ink-2">
              From {order.warehouse ?? "the main warehouse"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-light tracking-wide text-slate-500 uppercase">
              Delivery receipt
            </div>
            <div className="font-semibold"># {order.code}</div>
            {data.money.invoice && (
              <div className="text-[13px] text-ink-2">Invoice {data.money.invoice.code}</div>
            )}
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs text-ink-2">Deliver to</div>
            <div className="font-semibold">{order.customer}</div>
            <div className="text-[13px]">{order.deliveryAddress ?? "—"}</div>
            {(order.receiver || order.receiverPhone) && (
              <div className="text-[13px] text-ink-2">
                {[order.receiver, order.receiverPhone].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 self-start text-[13px] sm:justify-self-end">
            <dt className="text-ink-2">Date</dt>
            <dd className="text-right font-medium">
              {order.shippedAt
                ? timeLabel(order.shippedAt)
                : order.packedAt
                  ? timeLabel(order.packedAt)
                  : "—"}
            </dd>
            <dt className="text-ink-2">Via</dt>
            <dd className="text-right font-medium">{via}</dd>
            {order.customerPo && (
              <>
                <dt className="text-ink-2">Customer's PO</dt>
                <dd className="text-right font-medium">{order.customerPo}</dd>
              </>
            )}
            <dt className="text-ink-2">Salesperson</dt>
            <dd className="text-right font-medium">{order.medrep}</dd>
          </dl>
        </div>
        <div className="-mx-6 overflow-x-auto md:-mx-8">
          <table className="t">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Item</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key}>
                  <td className="text-ink-2">{index + 1}</td>
                  <td className="font-semibold">{row.medicine}</td>
                  <td className="font-mono">{row.batch}</td>
                  <td className="whitespace-nowrap">{row.expires}</td>
                  <td className="num whitespace-nowrap">
                    {count(row.qty)}
                    {inPacks(row.qty, row.packSize) && (
                      <div className="text-xs text-ink-2">{inPacks(row.qty, row.packSize)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[13px] text-ink-2">
          Received the above in good order and condition.
        </div>
        <div className="grid gap-8 pt-6 sm:grid-cols-3">
          {[
            "Received by (name and signature)",
            "Date received",
            `Released by${order.packedBy ? `: ${order.packedBy}` : ""}`,
          ].map((label) => (
            <div key={label}>
              <div className="h-10 border-b border-slate-400">
                {label === "Received by (name and signature)" && order.receivedBy ? (
                  <span className="text-sm">{order.receivedBy}</span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-ink-2">{label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** The hub's Print address: a slip for the parcel, big enough to read at the door. Dispatch
 *  checks it against the order when it ships (the Ship window asks). */
export function AddressSlip() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["orders", "one", id],
    queryFn: () => api<OrderDetail>(`/api/orders/${id}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the address slip" />;
  const { order } = data;
  const cold = data.items.some((item) => item.cold);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-ink"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back
        </button>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" /> Print
        </Button>
      </div>
      <Card className="flex flex-col gap-4 border-2 border-slate-800 p-6 print:shadow-none">
        <div className="flex items-start justify-between gap-4">
          <div className="text-xs font-semibold tracking-[0.12em] text-slate-500 uppercase">
            Deliver to
          </div>
          <div className="text-right text-[13px]">
            <div className="font-mono font-semibold">{order.code}</div>
            {data.money.invoice && <div className="text-ink-2">{data.money.invoice.code}</div>}
          </div>
        </div>
        <div>
          <div className="text-2xl leading-tight font-bold">{order.receiver || order.customer}</div>
          {order.receiver && order.receiver !== order.customer && (
            <div className="text-lg">{order.customer}</div>
          )}
          <div className="mt-2 text-lg leading-snug">
            {order.deliveryAddress ?? "No delivery address on the order"}
          </div>
          {order.receiverPhone && (
            <div className="mt-1 text-lg font-semibold tabular-nums">{order.receiverPhone}</div>
          )}
        </div>
        {cold && (
          <div className="flex items-center gap-2 rounded-lg border-2 border-sky-700 px-3 py-2 text-lg font-bold text-sky-800">
            <Snowflake size={20} aria-hidden="true" /> KEEP COLD
          </div>
        )}
        <div className="border-t border-slate-300 pt-3 text-[13px] text-ink-2">
          From {order.invoiceFromLabel} · {order.warehouse ?? "the main warehouse"}
        </div>
      </Card>
    </div>
  );
}
