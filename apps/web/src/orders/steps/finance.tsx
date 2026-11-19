// Finance's step on an order's page (orders/order.tsx), one check at a time as Management's
// (Aryan, 19 Nov): the payment (paid first, cash on delivery or credit) and its slip, the papers,
// what the customer owed from before, and its credit limit. Its buttons sit in the column at the
// side: Approve or Hold on what the system found, then Confirm payment or Approve on Payment.

import type { OrderDetail, PaperKind } from "@2mg/api/types";
import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { noProofWords } from "../../finance/no-proof";
import type { useMoney } from "../../finance/parts";
import { dayLabel, peso } from "../../ui";
import { Fact, Facts, NextButton, short, StepPanel } from "./frame";
import { Papers } from "./papers";

/** Finance's checks, in the order they are shown; Paid follows them, after delivery. */
export const FINANCE_PARTS = ["payment", "papers", "dues", "credit"] as const;
export type FinancePart = (typeof FINANCE_PARTS)[number];
export const FINANCE_TITLE: Record<FinancePart, string> = {
  payment: "Payment",
  papers: "Papers",
  dues: "Owed before",
  credit: "Credit limit",
};

/** When Finance checked the order and sent it on (Confirm payment, or Approve), and who. */
export function financeChecked(data: OrderDetail): { at: string; by: string } | null {
  const at = data.stages.find((stage) => stage.key === "finance_verified")?.at ?? null;
  if (!at) return null;
  return { at, by: data.events.findLast((event) => event.stage === "finance_verified")?.by ?? "Finance" };
}

/** The papers Finance looks at: every paper the order asks for but the slip and the receipt. */
function financePaperKinds(data: OrderDetail): PaperKind[] {
  return data.paperList
    .filter((row) => row.kind !== "payment_proof" && row.kind !== "dr")
    .map((row) => row.kind as PaperKind);
}

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

/** The credit limit against what the customer would owe with this order. */
function CreditFacts({ data }: { data: OrderDetail }) {
  const { order, dues } = data;
  const after = dues.owed + order.total;
  const over = dues.creditLimit !== null && after > dues.creditLimit;
  return (
    <>
      <Facts
        rows={[
          [
            "How they pay",
            order.paymentTerms === "days"
              ? `On credit, ${order.paymentDays ?? 30} days after delivery`
              : order.paymentTerms === "cod"
                ? "Cash on delivery"
                : "Paid first",
          ],
          ["Credit limit", dues.creditLimit === null ? "None set" : peso(dues.creditLimit)],
          ["Owed before", peso(dues.owed)],
          ["This order", peso(order.total)],
          [
            "With this order",
            <span key="after" className={over ? "font-semibold text-bad" : undefined}>
              {peso(after)}
              {over ? ` · ${peso(after - (dues.creditLimit ?? 0))} over the limit` : ""}
            </span>,
          ],
        ]}
      />
      {dues.credit > 0 && (
        <p className="text-[13px] text-good">
          They have {peso(dues.credit)} of credit (open credit notes, or money kept from a bill): use
          it on the invoice at the payment step.
        </p>
      )}
      <Link to={`/customers/${order.customerId}`} className="text-xs font-semibold text-emerald-700 underline">
        Their page: history and credit limit
      </Link>
    </>
  );
}

export function FinanceStep({
  data,
  part,
  n,
  money,
  next,
}: {
  data: OrderDetail;
  /** The check picked in the column. */
  part: FinancePart;
  /** Its number in the column. */
  n: number;
  money: ReturnType<typeof useMoney>;
  next: () => void;
}) {
  const { order, can } = data;
  const invoice = data.money.invoice;
  const checked = financeChecked(data);
  const after = FINANCE_PARTS[FINANCE_PARTS.indexOf(part) + 1];
  // The slip missing, as the system found it (the rest of its findings are Management's).
  const slipFindings = data.findings.filter((finding) => finding.kind === "papers");
  const missing = data.paperList.filter(
    (row) => row.needed && !row.onFile && row.kind !== "payment_proof" && row.kind !== "dr",
  );
  return (
    <StepPanel
      number={n}
      title={FINANCE_TITLE[part]}
      footer={<NextButton label={`Next: ${after ? FINANCE_TITLE[after] : "Paid"}`} onClick={next} />}
    >
      {part === "payment" && (
        <>
          {/* An Online case's order is checked by Finance as every channel's (Aryan, 19 Nov). */}
          {checked ? (
            <Fact shape="done" note={short(checked.at)}>
              <b>Checked</b> by {checked.by}
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
              <b>Paid first:</b> match the slip with the money in the bank, then Confirm payment
            </Fact>
          ) : order.status === "ready_for_invoice" ? (
            <Fact shape="now">
              <b>
                {order.paymentTerms === "days"
                  ? `On credit: pays ${order.paymentDays ?? 30} days after delivery`
                  : `Cash on delivery: ${peso(order.total)} at the door`}
              </b>{" "}
              · Approve makes the invoice and sends it to Dispatch
            </Fact>
          ) : (
            <Fact shape="later">
              <b>After Management's approval</b>
            </Fact>
          )}
          {/* A guarantee letter's order: the agency pays what its letter approves (19 Nov). */}
          {order.type === "gl" && (
            <div className="rounded-xl bg-sky-50 px-3 py-2 text-[13px] text-sky-950">
              <b>Paid by the agency's guarantee letter{order.source ? ` (${order.source})` : ""}:</b>{" "}
              {order.glAmount != null
                ? `${peso(order.glAmount)} approved${order.glNumber ? `, letter ${order.glNumber}` : ""}${
                    order.total !== order.glAmount
                      ? ` · ${peso(Math.abs(order.total - order.glAmount))} ${order.total > order.glAmount ? "less than" : "more than"} the order`
                      : ""
                  }`
                : "the letter's amount isn't written yet (the order's MedRep or Management writes it when it is in)."}
            </div>
          )}
          {!checked && noProofWords(order.noProofReason, order.noProofNote) && (
            <div className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
              <span>
                <b>No slip.</b> {order.medrep} says: {noProofWords(order.noProofReason, order.noProofNote)}
              </span>
            </div>
          )}
          {!checked && slipFindings.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-800">
              {slipFindings.map((finding) => (
                <li key={finding.text} className="flex gap-2">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
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
          <Papers data={data} kinds={["payment_proof"]} />
        </>
      )}
      {part === "papers" && (
        <>
          {missing.length > 0 ? (
            <Fact shape="now">
              <b>Not on file:</b> {missing.map((row) => row.label).join(", ")}
            </Fact>
          ) : (
            <Fact shape="done">
              <b>{data.papers.some((paper) => paper.kind !== "payment_proof") ? "On file" : "None needed"}</b>
            </Fact>
          )}
          <Papers data={data} kinds={financePaperKinds(data)} />
        </>
      )}
      {part === "dues" && <DuesVerdict data={data} />}
      {part === "credit" && <CreditFacts data={data} />}
    </StepPanel>
  );
}

/** Finance's checks on an order, in a few words each (Aryan, 19 Nov: "like Management's: what was
 *  found and that it is fine"): how it pays, its papers, what the customer owed from before and its
 *  credit limit; fine (green), to look at (amber) or only to know (grey). */
export function financeChecks(
  data: OrderDetail,
): { key: FinancePart; label: string; tone: "ok" | "warn" | "info"; note: string }[] {
  const { order, dues } = data;
  const finding = (kind: string) => data.findings.find((one) => one.kind === kind);
  const slip = data.papers.some((paper) => paper.kind === "payment_proof");
  const why = noProofWords(order.noProofReason, order.noProofNote);
  const missing = data.paperList.filter(
    (row) => row.needed && !row.onFile && row.kind !== "payment_proof" && row.kind !== "dr",
  );
  const owes = finding("owes");
  const credit = finding("credit");
  const label = FINANCE_TITLE;
  return [
    order.paymentTerms === "advance"
      ? slip
        ? { key: "payment", label: label.payment, tone: "ok", note: "Paid first: match the slip with the bank" }
        : { key: "payment", label: label.payment, tone: "warn", note: why ? `Paid first, no slip: ${why}` : "Paid first: no slip yet" }
      : order.paymentTerms === "cod"
        ? { key: "payment", label: label.payment, tone: "ok", note: `Cash on delivery: ${peso(order.total)} at the door` }
        : { key: "payment", label: label.payment, tone: "ok", note: `On credit: pays ${order.paymentDays ?? 30} days after delivery` },
    missing.length
      ? { key: "papers", label: label.papers, tone: "warn", note: `No ${missing.map((row) => row.label).join(", ")}` }
      : {
          key: "papers",
          label: label.papers,
          tone: "ok",
          note: data.papers.some((paper) => paper.kind !== "payment_proof") ? "On file" : "None needed",
        },
    owes
      ? { key: "dues", label: label.dues, tone: "warn", note: owes.short }
      : dues.owed > 0
        ? { key: "dues", label: label.dues, tone: "ok", note: `Owes ${peso(dues.owed)}, nothing late` }
        : { key: "dues", label: label.dues, tone: "ok", note: "Owes nothing" },
    credit
      ? { key: "credit", label: label.credit, tone: "warn", note: credit.short }
      : order.paymentTerms !== "days"
        ? { key: "credit", label: label.credit, tone: "ok", note: "Not on credit" }
        : dues.creditLimit === null
          ? { key: "credit", label: label.credit, tone: "info", note: "On credit, no limit set" }
          : { key: "credit", label: label.credit, tone: "ok", note: `Within the ${peso(dues.creditLimit)} limit` },
  ];
}
