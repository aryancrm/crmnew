// The Delivered step on an order's page (orders/order.tsx): who received it, when, the signed
// receipt.

import type { OrderDetail } from "@2mg/api/types";
import { CircleCheck } from "lucide-react";
import { type DispatchAsk } from "../../dispatch/parts";
import { Button, dayLabel } from "../../ui";
import { Fact, Facts, NextButton, StepPanel } from "./frame";
import { Papers } from "./papers";

export function DeliveredStep({
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
  const delivered = order.status === "completed";
  return (
    <StepPanel
      number={n ?? 5}
      title="Delivered"
      footer={delivered ? <NextButton label="Next: Paid" onClick={next} /> : undefined}
    >
      {delivered ? (
        <Fact shape="done" note={order.deliveredOn ? dayLabel(order.deliveredOn) : undefined}>
          <b>Delivered</b> · received by {order.receivedBy ?? "the customer"}
          {order.deliveredBy ? ` · marked by ${order.deliveredBy}` : ""}
        </Fact>
      ) : (
        <Fact
          shape={can.deliver ? "now" : "later"}
          note={
            order.shippedAt
              ? order.courier
                ? `${order.courier}${order.tracking ? ` · ${order.tracking}` : ""}`
                : order.rider
                  ? `Rider ${order.rider}`
                  : undefined
              : undefined
          }
        >
          <b>Delivery</b> ·{" "}
          {can.deliver ? "your step" : order.shippedAt ? "on the way" : "after it is shipped"}
        </Fact>
      )}
      <Facts
        rows={[
          ["Receiver", order.receiver],
          ["Receiver's phone", order.receiverPhone],
          ["Address", order.deliveryAddress],
          [
            "How it pays",
            order.paymentTerms === "days"
              ? `Credit · ${order.paymentDays} days`
              : order.paymentTerms === "cod"
                ? "Cash on delivery"
                : "Paid in advance",
          ],
        ]}
      />
      {can.deliver && (
        <div>
          <Button variant="primary" onClick={() => ask("deliver")}>
            <CircleCheck size={16} aria-hidden="true" />{" "}
            {/* Delivered while still packed at the warehouse: the customer picked it up. */}
            {order.status === "packing" ? "Picked up by the customer" : "Mark as delivered"}
          </Button>
        </div>
      )}
      <Papers data={data} kinds={["dr"]} />
    </StepPanel>
  );
}
