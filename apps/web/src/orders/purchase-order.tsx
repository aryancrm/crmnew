// The customer's purchase order, printed from their order for them to sign (Aryan, 19 Nov: "the
// MedRep makes the purchase order on the phone, prints it right there at the hospital, the
// hospital signs it, he takes its photo and it is kept on the order"). The same lines, prices and
// totals as the order (its Sales Order), turned round: the buyer orders from us, with their PO
// number, where it goes and when, then their signature, name, position, date and stamp. Signed,
// its photo goes on the order as the customer's PO (Documents), which Management reads.

import type { SalesOrderDoc } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { dayLabel, PageState } from "../ui";
import { CompanyBlock, DocLines, MetaRows, php, plain, RecordBar, TotalRow, taxRows, ZohoPaper } from "./sales-order";

/** A line to sign or write on, with what goes there under it. */
function SignLine({ label }: { label: string }) {
  return (
    <div className="pt-8">
      <div className="h-px w-full bg-[#333]" />
      <div className="mt-1 text-[11px] text-[#555]">{label}</div>
    </div>
  );
}

export function CustomerPoPage() {
  const id = Number(useParams().id);
  const query = useQuery({
    queryKey: ["orders", "sales-order", id],
    queryFn: () => api<SalesOrderDoc>(`/api/orders/${id}/sales-order`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="this purchase order" />;
  const { order, company, items } = data;
  const own = order.invoiceFrom === "2mg";
  const subTotal = items.reduce((sum, line) => sum + line.amount, 0);
  const meta: [string, ReactNode][] = [
    ["PO Date", dayLabel(order.orderDate)],
    ["Our order #", order.code],
    ["Payment terms", order.terms],
    ...(order.expectedOn ? ([["Deliver by", dayLabel(order.expectedOn)]] as [string, ReactNode][]) : []),
    ...(order.deliveryMethod ? ([["Delivery", order.deliveryMethod]] as [string, ReactNode][]) : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <RecordBar title={`Purchase order · ${order.code}`}>
        <Link
          to={`/orders/${order.id}`}
          className="inline-flex h-8 items-center rounded-[10px] px-2.5 text-[13px] font-semibold text-slate-600 hover:bg-head hover:text-ink"
        >
          Back to the order
        </Link>
      </RecordBar>
      <p className="mx-auto w-full max-w-[800px] text-[13px] text-slate-600 print:hidden">
        Print it (or save it as a PDF), let the customer sign and stamp it, then take its photo on
        the order: Documents → Customer's PO → Add photo.
      </p>

      <ZohoPaper ribbon="">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="max-w-[330px]">
            <div className="text-[11px] font-semibold tracking-wide text-[#888] uppercase">Buyer</div>
            <div className="text-[14px] font-semibold text-black">{order.customer}</div>
            {order.shipTo.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: address lines have no other identity
              <div key={index}>{line}</div>
            ))}
          </div>
          <div className="text-left sm:text-right">
            <div className="text-[30px] leading-none font-light tracking-wide text-black uppercase">
              Purchase Order
            </div>
            <div className="mt-2 text-[12px] font-semibold text-black">
              PO# {order.ref ?? "______________"}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-[#888] uppercase">Supplier</div>
            <CompanyBlock company={company} own={own} label={order.invoiceFromLabel} />
          </div>
          <MetaRows rows={meta} />
        </div>

        <DocLines lines={items} discount={items.some((line) => line.discount)} />

        <table className="mt-2 ml-auto w-full max-w-[360px] border-collapse text-[12px]">
          <tbody>
            <TotalRow label="Sub Total" note="(Tax Inclusive)" value={plain(subTotal)} />
            {order.deliveryFee > 0 && <TotalRow label="Shipping charge" value={plain(order.deliveryFee)} />}
            {taxRows(data.tax)}
            <TotalRow label="Total" value={php(order.total)} strong shaded />
          </tbody>
        </table>

        <p className="mt-8 text-[11px] text-[#555]">
          We order the medicines above, in the quantities and at the prices shown, from{" "}
          {own ? company.name || order.invoiceFromLabel : order.invoiceFromLabel}, delivered to the
          address above, on the payment terms shown.
        </p>

        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-[#888] uppercase">
              Ordered and approved by the buyer
            </div>
            <SignLine label="Signature over printed name" />
            <SignLine label="Position" />
            <SignLine label="Date" />
          </div>
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-[#888] uppercase">Buyer's stamp</div>
            <div className="mt-3 h-28 w-full rounded border border-dashed border-[#bbb]" />
            <div className="mt-4 text-[11px] text-[#555]">
              Taken by our representative: <span className="text-black">{order.salesperson}</span>
            </div>
          </div>
        </div>
      </ZohoPaper>
    </div>
  );
}
