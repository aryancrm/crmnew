// Finance's step on an order's page (orders/order.tsx): the payment (advance, cash on delivery or
// credit), what the customer owes against its credit, and Confirm payment or Check & send to
// Dispatch.

import type { OrderDetail } from "@2mg/api/types";
import { Banknote, ReceiptText, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { noProofWords } from "../../finance/no-proof";
import { ConfirmPaymentDialog, useMoney } from "../../finance/parts";
import { Button, dayLabel, peso } from "../../ui";
import { Fact, Facts, NextButton, short, StepPanel } from "./frame";
import { Papers } from "./papers";

/** What the customer owed before this order, worked out from this CRM's invoices and Zoho's
 *  (Aryan, 17 Nov: Finance no longer goes to Zoho to see it), and what that means for the check. */
function DuesVerdict({ data }: { data: OrderDetail }) {
  const { dues, order } = data;
  const after = dues.owed + order.total;
  const over = dues.creditLimit !== null && after > dues.creditLimit;
  const tone =
    dues.overdue > 0 || over
      ? "border-bad/20 bg-bad-tint text-bad"
      : dues.owed > 0
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-good/20 bg-good-tint text-good";
  return (
    <div className={`flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-[13px] ${tone}`}>
      <b>
        {dues.overdue > 0
          ? `${peso(dues.overdue)} overdue, the oldest ${dues.days} days late`
          : dues.owed > 0
            ? `Owes ${peso(dues.owed)} from before, nothing late`
            : "Nothing owed from before: clear to send on"}
      </b>
      {dues.owed > 0 && (
        <span>
          Owed before this order: {peso(dues.owed)}
          {dues.zoho > 0 ? ` (${peso(dues.zoho)} of it from before)` : ""}.{" "}
          {dues.overdue > 0 ? "Collect it first, or ask Management." : ""}
        </span>
      )}
      {over && (
        <span>
          With this order they would owe {peso(after)}, over their credit limit of{" "}
          {peso(dues.creditLimit ?? 0)}.
        </span>
      )}
      {dues.credit > 0 && (
        <span className="text-good">
          They have {peso(dues.credit)} of credit (open credit notes, or money kept from a
          bill): use it on the invoice at the payment step.
        </span>
      )}
      <Link to={`/customers/${order.customerId}`} className="text-xs font-semibold underline">
        Their whole history
      </Link>
    </div>
  );
}

export function FinanceStep({
  data,
  n,
  money,
  next,
}: {
  /** Its number at the side, for a desk that sees only its own steps. */
  n?: number;
  data: OrderDetail;
  money: ReturnType<typeof useMoney>;
  next: () => void;
}) {
  const { order, can } = data;
  const [confirming, setConfirming] = useState(false);
  const invoice = data.money.invoice;
  const checked = data.stages.find((stage) => stage.key === "finance_verified")?.at ?? null;
  const by = data.events.findLast((event) => event.stage === "finance_verified")?.by;
  return (
    <StepPanel
      number={n ?? 3}
      title="Finance check"
      footer={
        checked ? <NextButton label="Next: Pack & ship" onClick={next} /> : undefined
      }
    >
      {/* An Online case's order is checked by Finance as every channel's (Aryan, 19 Nov). */}
      {checked ? (
        <Fact shape="done" note={short(checked)}>
          <b>Checked</b> by {by ?? "Finance"}
          {can.undoConfirm && (
            <button
              type="button"
              disabled={money.busy}
              onClick={() => money.send(`/api/finance/orders/${order.id}/undo-confirm`, {})}
              className="ml-2 font-semibold text-emerald-700 hover:underline disabled:opacity-50"
            >
              Undo
            </button>
          )}
        </Fact>
      ) : order.status === "finance_check" ? (
        <Fact shape="now">
          <b>Paid in advance:</b> check the slip and the money in the account
        </Fact>
      ) : order.status === "ready_for_invoice" ? (
        <Fact shape="now">
          <b>
            {order.paymentTerms === "days"
              ? `Credit: pays ${order.paymentDays} days after delivery`
              : "Cash on delivery"}
          </b>{" "}
          · check what they owe and send it to Dispatch
        </Fact>
      ) : (
        <Fact shape="later">
          <b>After Management's approval</b>
        </Fact>
      )}
      {!checked && <DuesVerdict data={data} />}
      {!checked && noProofWords(order.noProofReason, order.noProofNote) && (
        <div className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          <span>
            <b>No slip.</b> {order.medrep} says:{" "}
            {noProofWords(order.noProofReason, order.noProofNote)}
          </span>
        </div>
      )}
      {/* What it owed and its credit limit are in the box above; the rest is listed here. */}
      {data.findings.some((finding) => finding.kind !== "owes" && finding.kind !== "credit") &&
        !checked && (
        <ul className="flex flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-800">
          {data.findings
            .filter((finding) => finding.kind !== "owes" && finding.kind !== "credit")
            .map((finding) => (
            <li key={finding.text} className="flex gap-2">
              <TriangleAlert
                size={15}
                className="mt-0.5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>{finding.text}</span>
            </li>
          ))}
        </ul>
      )}
      {invoice && (
        <Facts
          rows={[
            [
              "Invoice",
              <Link
                key="i"
                to={`/invoices/${invoice.id}`}
                className="font-semibold text-emerald-700 hover:underline"
              >
                {invoice.code}
              </Link>,
            ],
            ["Made", `${dayLabel(invoice.issuedOn)} · ${invoice.invoiceFromLabel}`],
            ["Due", invoice.terms === "cod" ? "Collected on delivery" : dayLabel(invoice.dueOn)],
          ]}
        />
      )}
      {(can.confirm_payment || can.make_invoice) && (
        <div className="flex flex-wrap gap-2">
          {can.confirm_payment && (
            <Button variant="primary" disabled={money.busy} onClick={() => setConfirming(true)}>
              <Banknote size={16} aria-hidden="true" /> Confirm payment
            </Button>
          )}
          {can.make_invoice && (
            <Button
              variant="primary"
              disabled={money.busy}
              onClick={() => money.send(`/api/finance/orders/${order.id}/invoice`, {})}
            >
              <ReceiptText size={16} aria-hidden="true" /> Check & send to Dispatch
            </Button>
          )}
        </div>
      )}
      <Papers data={data} kinds={["payment_proof"]} />
      {confirming && (
        <ConfirmPaymentDialog
          orderId={order.id}
          code={order.code}
          customer={order.customer}
          total={order.total}
          onClose={() => setConfirming(false)}
        />
      )}
    </StepPanel>
  );
}

/** Finance's four checks on an order, as its board cards show them (Aryan, 19 Nov: "like
 *  Management's: what was found and that it is fine"): how it pays, its papers, what the customer
 *  owes and its credit against the limit; fine (green), to look at (amber) or only to know (grey). */
export function financeChecks(
  data: OrderDetail,
): { key: string; label: string; tone: "ok" | "warn" | "info"; note: string }[] {
  const { order, dues } = data;
  const finding = (kind: string) => data.findings.find((one) => one.kind === kind);
  const slip = data.papers.some((paper) => paper.kind === "payment_proof");
  const why = noProofWords(order.noProofReason, order.noProofNote);
  const missing = data.paperList.filter(
    (row) => row.needed && !row.onFile && row.kind !== "payment_proof" && row.kind !== "dr",
  );
  const owes = finding("owes");
  const credit = finding("credit");
  return [
    order.paymentTerms === "advance"
      ? slip
        ? { key: "payment", label: "Payment", tone: "ok", note: "Slip on file: match it with the money in the bank" }
        : { key: "payment", label: "Payment", tone: "warn", note: why ? `No slip: ${why}` : "No slip yet" }
      : order.paymentTerms === "cod"
        ? { key: "payment", label: "Payment", tone: "ok", note: `Cash on delivery: ${peso(order.total)} at the door` }
        : { key: "payment", label: "Payment", tone: "ok", note: `On credit: ${order.paymentDays ?? 30} days from delivery` },
    missing.length
      ? { key: "papers", label: "Papers", tone: "warn", note: `No ${missing.map((row) => row.label).join(", ")}` }
      : { key: "papers", label: "Papers", tone: "ok", note: data.papers.length ? "On file" : "None needed" },
    owes
      ? { key: "dues", label: "Dues", tone: "warn", note: owes.short }
      : dues.owed > 0
        ? { key: "dues", label: "Dues", tone: "ok", note: `Owes ${peso(dues.owed)}, nothing overdue` }
        : { key: "dues", label: "Dues", tone: "ok", note: "Nothing owed" },
    credit
      ? { key: "credit", label: "Credit", tone: "warn", note: credit.short }
      : order.paymentTerms !== "days"
        ? { key: "credit", label: "Credit", tone: "ok", note: "Not on credit" }
        : dues.creditLimit === null
          ? { key: "credit", label: "Credit", tone: "info", note: "On credit, no limit set" }
          : { key: "credit", label: "Credit", tone: "ok", note: `Within the ${peso(dues.creditLimit)} limit` },
  ];
}
