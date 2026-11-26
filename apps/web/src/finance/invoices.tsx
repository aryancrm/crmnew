// Invoices, as Zoho Books lists them: date, number, order, customer, company, status, due
// date, amount and balance, with tabs; and one invoice as a document with its payments.

import { allCompanyNames } from "@2mg/api/companies";
import type { DocLine, InvoiceDetail, InvoiceList, InvoiceTab } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import {
  InvoiceStatus,
  RecordPaymentDialog,
  RefundDialog,
  RemovePaymentDialog,
} from "./parts";
import { SendToCustomer } from "../orders/send-update";
import {
  Button,
  Card,
  count,
  dayLabel,
  PageHead,
  PageState,
  Pill,
  peso,
  Tabs,
  timeLabel,
} from "../ui";
import {
  CompanyBlock,
  DocLines,
  MetaRows,
  MoreInformation,
  php,
  plain,
  RecordBar,
  ShipTo,
  TotalRow,
  taxRows,
  ZohoPaper,
} from "../orders/sales-order";

const TAB_LABEL: Record<InvoiceTab, string> = {
  all: "All",
  unpaid: "Unpaid",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

export function Invoices() {
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
  const search = ["tab", "q", "customer", "page"]
    .map((key) =>
      params.get(key) ? `${key}=${encodeURIComponent(params.get(key) as string)}` : "",
    )
    .filter(Boolean)
    .join("&");
  const query = useQuery({
    queryKey: ["finance", "invoices", search],
    queryFn: () => api<InvoiceList>(`/api/invoices?${search}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the invoices" />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="mx-auto max-w-[88rem]">
      <PageHead
        title="Invoices"
        sub={
          data.customer
            ? `For ${data.customer.name}`
            : `Every sales invoice, under ${allCompanyNames(" or ")}`
        }
        tags={
          data.customer && (
            <button
              type="button"
              onClick={() => set({ customer: "" })}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
            >
              {data.customer.name} <X size={13} aria-hidden="true" />
            </button>
          )
        }
      >
        <Tabs
          value={data.tab}
          onChange={(key) => set({ tab: key === "all" ? "" : key })}
          tabs={(Object.keys(TAB_LABEL) as InvoiceTab[]).map((key) => ({
            key,
            label: TAB_LABEL[key],
            count: data.counts[key],
          }))}
        />
      </PageHead>

      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input
              type="search"
              aria-label="Search invoices"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Invoice, order or customer"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/70 pr-3 pl-9 text-sm focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/10 focus:outline-none"
            />
          </div>
          <div className="text-[13px] text-ink-2">
            {count(data.total)} invoices ·{" "}
            <span className="font-semibold text-ink">{peso(data.sums.total)}</span> billed ·{" "}
            <span className="font-semibold text-ink">{peso(data.sums.balance)}</span> still owed
          </div>
        </div>
        {data.rows.length === 0 ? (
          <div className="p-8 text-center text-ink-2">
            {data.counts.all === 0
              ? "No invoice yet. Finance makes one when it lets an order go to Dispatch."
              : "No invoice here."}
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Company</th>
                <th>Status</th>
                <th>Due date</th>
                <th className="num">Amount</th>
                <th className="num">Balance due</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/invoices/${row.id}`)}
                >
                  <td className="whitespace-nowrap">{dayLabel(row.issuedOn)}</td>
                  <td>
                    <Link
                      to={`/invoices/${row.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="font-semibold whitespace-nowrap hover:underline"
                    >
                      {row.code}
                    </Link>
                  </td>
                  <td>
                    <Link
                      to={`/orders/${row.orderId}`}
                      onClick={(event) => event.stopPropagation()}
                      className="whitespace-nowrap hover:underline"
                    >
                      {row.orderCode}
                    </Link>
                  </td>
                  <td className="font-semibold">{row.customer}</td>
                  <td className="whitespace-nowrap text-ink-2">{row.invoiceFromLabel}</td>
                  <td className="whitespace-nowrap">
                    <InvoiceStatus state={row.state} />
                  </td>
                  <td className="whitespace-nowrap">
                    {row.terms === "advance" ? "—" : dayLabel(row.dueOn)}
                  </td>
                  <td className="num font-semibold whitespace-nowrap">{peso(row.total)}</td>
                  <td
                    className={`num whitespace-nowrap ${row.balance > 0 ? "font-semibold" : "text-ink-2"}`}
                  >
                    {/* Paid beyond the bill (a return lowered it): it is on Refunds owed. */}
                    {row.balance < 0 ? (
                      <span className="font-semibold text-amber-700">{peso(-row.balance)} to give back</span>
                    ) : (
                      peso(row.balance)
                    )}
                  </td>
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
    </div>
  );
}

export function Invoice() {
  const id = Number(useParams().id);
  const query = useQuery({
    queryKey: ["finance", "invoice", id],
    queryFn: () => api<InvoiceDetail>(`/api/invoices/${id}`),
  });
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [removing, setRemoving] = useState<{ id: number; what: string } | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="this invoice" />;
  const { invoice, can } = data;
  const active = data.payments.filter((payment) => payment.active);
  const owedBack = invoice.refundOwed;
  const fields: [string, string][] = [
    ["Doctor Name", invoice.doctor ?? ""],
    ["Invoicing From", invoice.invoiceFromLabel],
    ["Source", invoice.source ?? ""],
    ["Customer's PO", invoice.customerPo ?? ""],
    ["Payment Terms", invoice.paymentTerm ?? ""],
    ...(invoice.relief
      ? ([
          [
            invoice.relief.kind === "pwd" ? "PWD ID No." : "OSCA ID No.",
            [invoice.relief.idNo, invoice.relief.name].filter(Boolean).join(" · "),
          ],
        ] as [string, string][])
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <RecordBar title={invoice.code}>
        {can.pay && (
          <Button small variant="primary" onClick={() => setPaying(true)}>
            Record payment
          </Button>
        )}
        {can.refund && (
          <Button small variant="primary" onClick={() => setRefunding(true)}>
            Give money back
          </Button>
        )}
        <SendToCustomer orderId={invoice.orderId} small />
      </RecordBar>

      <div className="mx-auto flex w-full max-w-[800px] flex-wrap items-center justify-between gap-2 rounded border border-[#e6e6e6] bg-white px-4 py-2.5 text-[13px] print:hidden">
        <span className="text-[#21263c]">
          Associated sales orders{" "}
          <Link
            to={`/orders/${invoice.orderId}/sales-order`}
            className="ml-1 text-[#408dfb] hover:underline"
          >
            {invoice.orderCode}
          </Link>
        </span>
        <InvoiceStatus state={invoice.state} />
      </div>
      {invoice.status === "cancelled" && (
        <div className="mx-auto w-full max-w-[800px] text-[13px] text-ink-2 print:hidden">
          Cancelled with its order{invoice.cancelledReason ? `: ${invoice.cancelledReason}` : ""}.
          {owedBack > 0 ? ` ${peso(owedBack)} received for it is still to be given back.` : ""}
        </div>
      )}

      <InvoicePaper data={data} />

      <MoreInformation
        salesperson={invoice.salesperson ?? invoice.medrep}
        fields={fields.filter(([, value]) => value)}
      />

      <Card className="mx-auto w-full max-w-[800px] print:hidden">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
          <h2 className="font-semibold">Payments received</h2>
          <span className="text-[13px] text-ink-2">
            {active.length ? `${active.length} · ${peso(invoice.paid)}` : "None yet"}
          </span>
        </div>
        {data.payments.length === 0 ? (
          <div className="px-5 py-4 text-[13px] text-ink-2">
            {invoice.terms === "days"
              ? `The customer pays within ${invoice.paymentDays} days.`
              : "Nothing received yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="t">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>How</th>
                  <th>Reference</th>
                  <th>Slip</th>
                  <th>Recorded by</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.payments.map((payment) => (
                  <tr key={payment.id} className={payment.active ? "" : "text-slate-400"}>
                    <td className="whitespace-nowrap">{dayLabel(payment.paidOn)}</td>
                    <td className="whitespace-nowrap">
                      {payment.methodLabel}
                      {!payment.active && (
                        <div className="text-xs">
                          <Pill tone="bad">Taken off</Pill> {payment.removedReason}
                        </div>
                      )}
                    </td>
                    <td>{payment.reference ?? "—"}</td>
                    <td>
                      {payment.proofId ? (
                        <a
                          href={`/api/papers/${payment.proofId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[#1c5bd9] hover:underline"
                        >
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {payment.by}
                      <div className="text-xs text-ink-2">{timeLabel(payment.at)}</div>
                    </td>
                    <td
                      className={`num font-semibold whitespace-nowrap ${payment.active ? "" : "line-through"}`}
                    >
                      {peso(payment.amount)}
                    </td>
                    <td className="text-right">
                      {payment.active && can.removePayment && (
                        <Button
                          small
                          variant="quiet"
                          onClick={() =>
                            setRemoving({
                              id: payment.id,
                              what: `${peso(payment.amount)} by ${payment.methodLabel.toLowerCase()} on ${dayLabel(payment.paidOn)}`,
                            })
                          }
                        >
                          Take off
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.refunds.length > 0 && (
          <div className="border-t border-line-soft px-5 py-3 text-[13px]">
            <div className="mb-1 font-semibold">Given back</div>
            {data.refunds.map((refund) => (
              <div key={refund.id} className="flex justify-between gap-3 py-1">
                <span>
                  {dayLabel(refund.refundedOn)} · {refund.methodLabel}
                  {refund.reference ? ` · ${refund.reference}` : ""} · by {refund.by}
                </span>
                <span className="font-semibold tabular-nums">{peso(refund.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="mx-auto w-full max-w-[800px] text-xs text-ink-2 print:hidden">
        Made by {invoice.by}, {timeLabel(invoice.at)}.
      </div>

      {paying && (
        <RecordPaymentDialog
          invoiceId={invoice.id}
          code={invoice.code}
          balance={invoice.balance}
          orderId={invoice.orderId}
          proofs={data.proofs}
          onClose={() => setPaying(false)}
        />
      )}
      {refunding && (
        <RefundDialog
          invoiceId={invoice.id}
          code={invoice.code}
          owed={owedBack}
          onClose={() => setRefunding(false)}
        />
      )}
      {removing && (
        <RemovePaymentDialog
          paymentId={removing.id}
          what={removing.what}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** The invoice as Zoho prints it: the status ribbon across the corner, the company on the left
 *  (a logo only on GetMeds' papers, and only when there is one to show; 2MG's template has none),
 *  "Invoice" with its number and balance due on the right, Ship To and its dates, the lines under
 *  the dark heading, then Sub Total, Zoho's tax lines, Total, Payment Made and Balance Due. */
function InvoicePaper({ data }: { data: InvoiceDetail }) {
  const { invoice, company } = data;
  const own = invoice.invoiceFrom === "2mg";
  const ribbon =
    invoice.status === "paid"
      ? "Paid"
      : invoice.status === "cancelled"
        ? "Void"
        : invoice.state.overdueDays > 0
          ? "Overdue"
          : invoice.paid > 0
            ? "Partially Paid"
            : "Due";
  const lines: DocLine[] = data.items.map((item) => ({
    id: item.id,
    item: item.medicine,
    strength: item.strength ?? null,
    form: item.form ?? null,
    discount: item.relief ? "20%" : null,
    qty: item.qty,
    unitPrice: item.unitPrice,
    amount: item.amount,
    vat: item.vat,
    free: item.free,
  }));
  const subTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const terms =
    invoice.paymentTerm?.trim() ||
    (invoice.terms === "advance"
      ? "Advanced Payment"
      : invoice.terms === "cod"
        ? "Cash on Delivery"
        : `Net ${invoice.paymentDays ?? 30}`);
  const meta: [string, ReactNode][] = [
    ["Invoice Date", dayLabel(invoice.issuedOn)],
    ["Terms", terms],
    [
      "Due Date",
      invoice.terms === "advance" ? dayLabel(invoice.issuedOn) : dayLabel(invoice.dueOn),
    ],
    [
      "S.O.#",
      <Link
        key="so"
        to={`/orders/${invoice.orderId}/sales-order`}
        className="hover:text-[#408dfb] hover:underline print:no-underline"
      >
        {invoice.orderCode}
      </Link>,
    ],
    ...(invoice.doctor ? ([["Doctor Name", invoice.doctor]] as [string, ReactNode][]) : []),
    // A senior citizen's or PWD's sale: their ID number and name on the invoice (the law).
    ...(invoice.relief
      ? ([
          [
            invoice.relief.kind === "pwd" ? "PWD ID No." : "OSCA ID No.",
            [invoice.relief.idNo, invoice.relief.name].filter(Boolean).join(" · ") || "—",
          ],
        ] as [string, ReactNode][])
      : []),
  ];
  const shipTo = [
    ...(invoice.receiver && invoice.receiver !== invoice.customer ? [invoice.receiver] : []),
    ...((invoice.deliveryAddress ?? invoice.customerAddress)
      ? [(invoice.deliveryAddress ?? invoice.customerAddress) as string]
      : []),
    "Philippines",
  ];
  return (
    <ZohoPaper ribbon={ribbon}>
      <div className="flex flex-col justify-between gap-6 sm:flex-row">
        <CompanyBlock company={company} own={own} label={invoice.invoiceFromLabel} upper={!own} />
        <div className="text-left sm:text-right">
          <div className="text-[34px] leading-none font-light text-black">Invoice</div>
          <div className="mt-2 text-[12px] font-semibold text-black"># {invoice.code}</div>
          <div className="mt-5 text-[11px] font-semibold text-black">{invoice.balance < 0 ? "To give back" : "Balance Due"}</div>
          <div className="text-[15px] font-semibold text-black">{php(invoice.balance < 0 ? invoice.refundOwed : invoice.balance)}</div>
        </div>
      </div>

      <div className="mt-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <ShipTo name={invoice.customer} to={`/customers/${invoice.customerId}`} lines={shipTo} />
        <MetaRows rows={meta} />
      </div>

      <DocLines lines={lines} discount={lines.some((line) => line.discount)} />

      <table className="mt-2 ml-auto w-full max-w-[360px] border-collapse text-[12px]">
        <tbody>
          <TotalRow label="Sub Total" note="(Tax Inclusive)" value={plain(subTotal)} />
          {invoice.deliveryFee > 0 && (
            <TotalRow label="Shipping charge" value={plain(invoice.deliveryFee)} />
          )}
          {taxRows({
            vat: invoice.vat,
            vatLines: invoice.vatable + invoice.vat > 0,
            exempt: invoice.exempt > 0,
            zeroRated: invoice.zeroRated > 0,
          })}
          {/* Goods returned and credited: the line between the lines' sum and the bill's total. */}
          {invoice.credited > 0 && (
            <TotalRow label="Returned goods credited" value={`(-) ${plain(invoice.credited)}`} red />
          )}
          <TotalRow label="Total" value={php(invoice.total)} strong />
          {invoice.paid > 0 && (
            <TotalRow label="Payment Made" value={`(-) ${plain(invoice.paid)}`} red />
          )}
          {invoice.refunded > 0 && <TotalRow label="Given back" value={plain(invoice.refunded)} />}
          {invoice.balance < 0 ? (
            <TotalRow label="To give back" value={php(invoice.refundOwed)} strong shaded />
          ) : (
            <TotalRow label="Balance Due" value={php(invoice.balance)} strong shaded />
          )}
        </tbody>
      </table>

      {company.footer && own && (
        <div className="mt-10">
          <div className="text-black">Notes</div>
          <div className="mt-1 text-[11px]">{company.footer}</div>
        </div>
      )}
    </ZohoPaper>
  );
}
