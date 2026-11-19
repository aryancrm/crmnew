// Dispatch's step on an order's page (orders/order.tsx): what to pack, batch by batch, shipping
// it, and where it is on the road.

import type { OrderDetail } from "@2mg/api/types";
import { Box, PackageOpen, Printer, Snowflake, Truck, Undo2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useMe } from "../../auth";
import { type DispatchAsk } from "../../dispatch/parts";
import { Button, count, dayLabel } from "../../ui";
import { Fact, NextButton, short, StepPanel } from "./frame";
import { Lines } from "./lines";

export function DispatchStep({
  data,
  n,
  ask,
  next,
}: {
  /** Its number at the side, for a desk that sees only its own steps. */
  n?: number;
  data: OrderDetail;
  ask: (what: NonNullable<DispatchAsk>["what"]) => void;
  next: () => void;
}) {
  const { order, can } = data;
  const me = useMe().data;
  const left = Boolean(order.packedAt) || ["shipped", "completed"].includes(order.status);
  return (
    <StepPanel
      number={n ?? 4}
      title="Pack & ship"
      footer={
        order.shippedAt || order.status === "completed" ? (
          <NextButton label="Next: Delivered" onClick={next} />
        ) : undefined
      }
    >
      {order.packedAt ? (
        <Fact shape="done" note={short(order.packedAt)}>
          <b>Packed</b> by {order.packedBy} · from {order.warehouse ?? "the main warehouse"}
        </Fact>
      ) : (
        <Fact shape={can.pack ? "now" : "later"}>
          <b>Pack it</b> from {order.warehouse ?? "the main warehouse"}
        </Fact>
      )}
      {order.shippedAt ? (
        <Fact shape="done" note={short(order.shippedAt)}>
          <b>Shipped</b>{" "}
          {order.deliveryMethod === "rider"
            ? `with our rider ${order.rider}`
            : `with ${order.courier ?? "the courier"}${order.tracking ? ` · ${order.tracking}` : `, tracking to follow${order.trackingWait ? ` (${order.trackingWait.toLowerCase()})` : ""}`}`}{" "}
          · {order.shippedBy}
        </Fact>
      ) : order.status !== "completed" ? (
        <Fact shape={can.ship ? "now" : "later"}>
          <b>Ship it</b> · courier or our rider
        </Fact>
      ) : null}
      {data.picks.length > 0 && (
        <div className="-mx-4 overflow-x-auto border-y border-slate-100">
          <table className="t">
            <thead>
              <tr>
                <th>In the box</th>
                <th>Batch</th>
                <th>Expires</th>
                <th>From</th>
                <th className="num">Pieces</th>
              </tr>
            </thead>
            <tbody>
              {data.picks.map((pick) => (
                <tr key={pick.id}>
                  <td className="font-semibold">{pick.medicine}</td>
                  <td className="font-mono">{pick.batchNo}</td>
                  <td className="whitespace-nowrap">{dayLabel(pick.expiresOn)}</td>
                  <td className="whitespace-nowrap">{pick.warehouse}</td>
                  <td className="num whitespace-nowrap">{count(pick.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.picks.length === 0 && <Lines data={data} />}
      {data.items.some((item) => item.cold) && order.status !== "completed" && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] text-sky-900">
          <Snowflake size={16} aria-hidden="true" />
          <span>
            <b>Keep cold:</b>{" "}
            {[...new Set(data.items.filter((item) => item.cold).map((item) => item.medicine))].join(
              ", ",
            )}{" "}
            — pack in a styro box with ice packs.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {me &&
          ["dispatch", "admin", "management"].includes(me.role) &&
          ["ready_for_dispatch", "packing", "shipped"].includes(order.status) && (
            <Link
              to={`/orders/${order.id}/address`}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-hover"
            >
              <Printer size={16} aria-hidden="true" /> Print address
            </Link>
          )}
        {can.pack && (
          <Button variant="primary" onClick={() => ask("pack")}>
            <Box size={16} aria-hidden="true" /> Pack
          </Button>
        )}
        {can.ship && (
          <Button variant="primary" onClick={() => ask("ship")}>
            <Truck size={16} aria-hidden="true" /> Ship
          </Button>
        )}
        {can.unpack && (
          <Button onClick={() => ask("unpack")}>
            <PackageOpen size={16} aria-hidden="true" /> Unpack
          </Button>
        )}
        {can.failed && (
          <Button variant="danger" onClick={() => ask("failed")}>
            <Undo2 size={16} aria-hidden="true" /> Didn't reach the customer
          </Button>
        )}
        {order.deliveryMethod === "courier" && me && ["dispatch", "admin"].includes(me.role) && (
          <Button onClick={() => ask("tracking")}>
            {order.tracking ? "Change tracking" : "Add tracking"}
          </Button>
        )}
        {left && me && ["dispatch", "admin", "management"].includes(me.role) && (
          <Link
            to={`/orders/${order.id}/receipt`}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-hover"
          >
            <Printer size={16} aria-hidden="true" /> Delivery receipt
          </Link>
        )}
      </div>
    </StepPanel>
  );
}
