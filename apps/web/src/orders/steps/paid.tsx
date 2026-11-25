// The Paid step on an order's page (orders/order.tsx): the invoice, the payments received, what
// is still owed, and recording a payment.

import type { OrderDetail } from "@2mg/api/types";
import { useState } from "react";
import { useMe } from "../../auth";
import { InvoiceStatus, RecordPaymentDialog, UseCreditDialog, useMoney } from "../../finance/parts";
import { Button, dayLabel, INPUT, peso, Problem } from "../../ui";
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
  // A guarantee letter's order (Aryan, 22 Nov): the agency pays later and often less than its
  // letter; the patient pays the rest or it is let go. Finance sends the claim and records each part.
  const gl = order.type === "gl";
  const live = data.money.payments.filter((payment) => payment.active);
  const sumOf = (test: (payment: (typeof live)[number]) => boolean) =>
    live.filter(test).reduce((sum, payment) => sum + payment.amount, 0);
  const byAgency = sumOf((payment) => payment.method !== "deduction" && payment.payer === "agency");
  const letGo = sumOf((payment) => payment.method === "deduction" && payment.deductionKind === "gl_waived");
  const byPatient = sumOf((payment) => payment.method !== "deduction" && payment.payer !== "agency");
  const notCash = sumOf((payment) => ["points", "withholding", "credit", "deduction"].includes(payment.method));
  const whoOf = (payment: (typeof live)[number]) =>
    !gl
      ? ""
      : payment.method === "deduction"
        ? payment.deductionKind === "gl_waived"
          ? "Let go · "
          : ""
        : payment.payer === "agency"
          ? "The agency · "
          : "The patient · ";
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
          {gl && (
            <GlSettlement
              data={data}
              finance={finance}
              figures={{ letter: order.glAmount, byAgency, byPatient, letGo, owed: invoice.balance }}
            />
          )}
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {(
              [
                ["Total", invoice.total],
                // Settled without money too (let go, tax withheld, deducted, credit, points).
                [notCash > 0 ? "Settled" : "Received", invoice.paid],
                ["Still owed", invoice.balance],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <dt className="text-xs text-ink-2">{label}</dt>
                <dd className="text-base font-semibold tabular-nums">{peso(value)}</dd>
              </div>
            ))}
          </dl>
          {notCash > 0 && (
            <p className="-mt-1 text-xs text-ink-2">
              {peso(invoice.paid - notCash)} came as money; {peso(notCash)} was settled without money
              (let go, tax withheld, deducted, or paid from credit or points).
            </p>
          )}
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
                    · {whoOf(payment)}
                    {payment.methodLabel}
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

/** A guarantee letter's money in one place: what the letter says, what the agency paid, what the
 *  patient paid, what was let go and what is still owed; and the claim on the agency, which
 *  Finance sends once the medicines are delivered (the PAP person only sees it). */
function GlSettlement({
  data,
  finance,
  figures,
}: {
  data: OrderDetail;
  finance: boolean;
  figures: { letter: number | null; byAgency: number; byPatient: number; letGo: number; owed: number };
}) {
  const { order } = data;
  const money = useMoney();
  const claim = order.glClaim;
  const [sentOn, setSentOn] = useState(claim?.sentOn ?? "");
  const [ref, setRef] = useState(claim?.ref ?? "");
  const delivered = order.status === "completed";
  const short = figures.letter != null && figures.byAgency > 0 && figures.byAgency < figures.letter;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-sky-50 px-3 py-3 text-[13px] text-sky-950">
      <div className="font-semibold">
        Guarantee letter{order.glNumber ? ` ${order.glNumber}` : ""}
        {claim?.agency ? ` · ${claim.agency.toUpperCase()}` : ""}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ["On the letter", figures.letter],
            ["Agency paid", figures.byAgency],
            ["Patient paid", figures.byPatient],
            ["Let go", figures.letGo],
            ["Still owed", figures.owed],
          ] as [string, number | null][]
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-white px-2.5 py-2">
            <dt className="text-[11px] text-slate-500">{label}</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{value == null ? "not written" : peso(value)}</dd>
          </div>
        ))}
      </dl>
      {short && figures.owed > 0 && (
        <div>
          The agency paid {peso((figures.letter ?? 0) - figures.byAgency)} less than its letter: record the rest as the
          patient's payment, or let it go.
        </div>
      )}
      {claim && (
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <label>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">Claim sent to the agency on</span>
            <input type="date" className={INPUT} disabled={!finance || !delivered || money.busy} value={sentOn} onChange={(event) => setSentOn(event.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600">Claim reference</span>
            <input className={INPUT} disabled={!finance || !delivered || money.busy} value={ref} onChange={(event) => setRef(event.target.value)} />
          </label>
          {finance && delivered && (
            <Button
              small
              variant={claim.sentOn ? "plain" : "primary"}
              disabled={money.busy || !sentOn}
              onClick={() => money.send(`/api/finance/orders/${order.id}/gl-claim`, { sentOn: sentOn || null, ref: ref.trim() || null })}
            >
              {claim.sentOn ? "Save" : "Claim sent"}
            </Button>
          )}
          {!delivered && <span className="text-[12px] text-slate-600 sm:col-span-3">The claim goes after the delivery.</span>}
          {!finance && delivered && <span className="text-[12px] text-slate-600 sm:col-span-3">Finance sends the claim and records what the agency pays.</span>}
        </div>
      )}
      <Problem message={money.problem?.message} />
    </div>
  );
}
