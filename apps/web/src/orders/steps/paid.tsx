// The Paid step on an order's page (orders/order.tsx): the invoice, the payments received, what
// is still owed, and recording a payment.

import type { OrderDetail } from "@2mg/api/types";
import { useState } from "react";
import { useMe } from "../../auth";
import { InvoiceStatus, RecordPaymentDialog, UseCreditDialog } from "../../finance/parts";
import { Button, dayLabel, peso } from "../../ui";
import { Fact, StepPanel } from "./frame";

export function PaidStep({
  data,
  n,
}: {
  /** Its number at the side, for a desk that sees only its own steps. */
  n?: number;
  data: OrderDetail;
}) {
  const { order, can } = data;
  const [paying, setPaying] = useState(false);
  const [using, setUsing] = useState(false);
  const me = useMe().data;
  const finance = me?.role === "finance" || me?.role === "admin";
  const invoice = data.money.invoice;
  const proofs = data.papers.filter((paper) => paper.kind === "payment_proof");
  return (
    <StepPanel number={n ?? 6} title="Paid">
      {!invoice ? (
        <Fact shape="later">
          <b>No invoice yet</b> · it is made when Management approves
        </Fact>
      ) : (
        <>
          {invoice.status === "paid" ? (
            <Fact shape="done">
              <b>Paid in full</b> · {invoice.code}
            </Fact>
          ) : (
            <Fact
              shape={can.recordPayment ? "now" : "later"}
              note={<InvoiceStatus state={invoice.state} />}
            >
              <b>{peso(invoice.balance)} still owed</b> on {invoice.code}
            </Fact>
          )}
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {(
              [
                ["Total", invoice.total],
                ["Received", invoice.paid],
                ["Still owed", invoice.balance],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <dt className="text-xs text-ink-2">{label}</dt>
                <dd className="text-base font-semibold tabular-nums">{peso(value)}</dd>
              </div>
            ))}
          </dl>
          {data.money.payments.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              {data.money.payments.map((payment) => (
                <li
                  key={payment.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${payment.active ? "" : "text-slate-400"}`}
                >
                  <span>
                    <b className={`tabular-nums ${payment.active ? "" : "line-through"}`}>
                      {peso(payment.amount)}
                    </b>{" "}
                    · {payment.methodLabel}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                    {!payment.active && ` · taken off: ${payment.removedReason}`}
                  </span>
                  <span className="text-xs text-slate-500">
                    {dayLabel(payment.paidOn)} · {payment.by}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.money.refunds.length > 0 && (
            <div className="text-sm text-ink-2">
              Given back:{" "}
              {data.money.refunds
                .map((refund) => `${peso(refund.amount)} on ${dayLabel(refund.refundedOn)}`)
                .join(", ")}
            </div>
          )}
          {(can.recordPayment || (finance && invoice.balance > 0 && data.dues.credit > 0)) && (
            <div className="flex flex-wrap gap-2">
              {can.recordPayment && (
                <Button variant="primary" onClick={() => setPaying(true)}>
                  Record payment received
                </Button>
              )}
              {finance && invoice.status === "open" && invoice.balance > 0 && data.dues.credit > 0 && (
                <Button onClick={() => setUsing(true)}>
                  Use their credit ({peso(data.dues.credit)})
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {using && invoice && (
        <UseCreditDialog
          invoiceId={invoice.id}
          code={invoice.code}
          owed={invoice.balance}
          customerId={order.customerId}
          onClose={() => setUsing(false)}
        />
      )}
      {paying && invoice && (
        <RecordPaymentDialog
          invoiceId={invoice.id}
          code={invoice.code}
          balance={invoice.balance}
          orderId={order.id}
          proofs={proofs}
          onClose={() => setPaying(false)}
        />
      )}
    </StepPanel>
  );
}
