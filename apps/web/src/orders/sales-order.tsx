// An order as Zoho Inventory shows its Sales Order (GetMeds' "2MG Template"), and the pieces
// the invoice shares with it: the paper with its status ribbon, the company block, the lines
// under the dark heading (strength, medicine form, the senior citizen / PWD discount, quantity
// in pcs, rate and amount with their centavos), Zoho's tax lines and the total; around the
// paper, the record's toolbar, its invoice and shipment status, "More Information" and the
// custom fields. No logo on 2MG's papers: Zoho's 2MG template has none.

import type { CompanyInfo, DocLine, SalesOrderDoc } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { SendToCustomer } from "./send-update";
import { Button, dayLabel, PageState } from "../ui";

/** Zoho prints every amount with its centavos and no peso sign: 1,044.58. */
export const plain = (centavos: number) =>
  (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** And the totals with the currency code: PHP15,500.00. */
export const php = (centavos: number) => `PHP${plain(centavos)}`;

const RIBBON_TONE: Record<string, string> = {
  Confirmed: "bg-[#408dfb]",
  Due: "bg-[#408dfb]",
  "Partially Paid": "bg-[#408dfb]",
  "Pending Approval": "bg-[#f7a23a]",
  Overdue: "bg-[#f7a23a]",
  "On Hold": "bg-[#f7a23a]",
  Paid: "bg-[#21b26f]",
  Closed: "bg-[#21b26f]",
  Draft: "bg-[#9e9fb0]",
  Void: "bg-[#9e9fb0]",
};

/** The white sheet with the status ribbon across its top-left corner. */
export function ZohoPaper({ ribbon, children }: { ribbon: string; children: ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[800px] overflow-hidden bg-white text-[12px] leading-[1.6] text-[#333] shadow-[0_0_6px_rgba(0,0,0,0.16)] print:max-w-none print:shadow-none">
      <div className="pointer-events-none absolute top-0 left-0 size-32 overflow-hidden">
        <div
          className={`absolute top-[30px] -left-[46px] w-[180px] -rotate-45 py-[2px] text-center text-[11px] text-white shadow-sm ${RIBBON_TONE[ribbon] ?? "bg-[#408dfb]"}`}
        >
          {ribbon}
        </div>
      </div>
      <div className="px-8 pt-[72px] pb-12 sm:px-[54px]">{children}</div>
    </div>
  );
}

/** The company on the left, as Zoho's template prints it (no email, no logo). */
export function CompanyBlock({
  company,
  own,
  label,
  upper,
}: {
  company: CompanyInfo;
  own: boolean;
  label: string;
  upper?: boolean;
}) {
  const name = own ? company.name || label : label;
  return (
    <div className="max-w-[330px]">
      <div className="text-black">{upper ? name.toUpperCase() : name}</div>
      {own && company.address && <div className="whitespace-pre-line">{company.address}</div>}
      {own && company.tin && (
        <div>
          {company.vat ? "VAT Reg. TIN" : "Non-VAT Reg. TIN"}: {company.tin}
        </div>
      )}
      {own && company.phone && <div>Phone - {company.phone}</div>}
    </div>
  );
}

/** The right-hand rows "Order Date : 14 Nov 2026". */
export function MetaRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="ml-auto border-collapse">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="py-[5px] pr-6 text-right align-top">{label} :</td>
            <td className="min-w-[110px] py-[5px] text-right align-top text-black">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Ship To", the customer's name in blue, then where it goes. */
export function ShipTo({ name, to, lines }: { name: string; to?: string; lines: string[] }) {
  return (
    <div className="max-w-[330px]">
      <div className="text-black">Ship To</div>
      {to ? (
        <Link to={to} className="font-semibold text-[#408dfb] hover:underline print:text-black">
          {name}
        </Link>
      ) : (
        <div className="font-semibold text-[#408dfb]">{name}</div>
      )}
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: address lines have no other identity
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}

/** The lines under Zoho's dark heading. The SC/PWD-Discount column is the sales order's. */
export function DocLines({ lines, discount }: { lines: DocLine[]; discount?: boolean }) {
  const head = "px-2.5 py-2 font-normal";
  return (
    <table className="mt-8 w-full border-collapse text-[12px]">
      <thead>
        <tr className="bg-[#3c3d3a] text-left text-white">
          <th className={`${head} w-8`}>#</th>
          <th className={head}>Item &amp; Description</th>
          <th className={`${head} w-[70px]`}>Strength</th>
          <th className={`${head} w-[90px]`}>
            Medicine
            <br />
            Form
          </th>
          {discount && (
            <th className={`${head} w-[70px]`}>
              SC/PWD-
              <br />
              Discount
            </th>
          )}
          <th className={`${head} w-[70px] text-right`}>Qty</th>
          <th className={`${head} w-[70px] text-right`}>Rate</th>
          <th className={`${head} w-[90px] text-right`}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={line.id} className="border-b border-[#ddd] align-top">
            <td className="px-2.5 py-3">{index + 1}</td>
            <td className="px-2.5 py-3 text-black">{line.item}</td>
            <td className="px-2.5 py-3">{line.strength ?? ""}</td>
            <td className="px-2.5 py-3">{line.form ?? ""}</td>
            {discount && <td className="px-2.5 py-3">{line.discount ?? ""}</td>}
            <td className="px-2.5 py-3 text-right tabular-nums">
              {line.qty.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
              <div className="text-[11px] text-[#888]">pcs</div>
            </td>
            <td className="px-2.5 py-3 text-right tabular-nums">{plain(line.unitPrice)}</td>
            <td className="px-2.5 py-3 text-right tabular-nums">{plain(line.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One row of the totals block on the right. */
export function TotalRow({
  label,
  value,
  note,
  strong,
  shaded,
  red,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  shaded?: boolean;
  red?: boolean;
}) {
  return (
    <tr className={shaded ? "bg-[#f5f4f3]" : ""}>
      <td
        className={`px-2.5 text-right align-top ${shaded ? "py-2.5" : "py-[7px]"} ${strong ? "font-semibold text-black" : ""}`}
      >
        {label}
        {note && <div className="text-[10px] font-normal text-[#888]">{note}</div>}
      </td>
      <td
        className={`w-[130px] px-2.5 text-right align-top tabular-nums ${shaded ? "py-2.5" : "py-[7px]"} ${
          strong ? "font-semibold text-black" : ""
        } ${red ? "text-[#e8001c]" : ""}`}
      >
        {value}
      </td>
    </tr>
  );
}

/** Zoho's tax lines under the Sub Total. */
export function taxRows(tax: {
  vat: number;
  vatLines: boolean;
  exempt: boolean;
  zeroRated: boolean;
}) {
  return (
    <>
      {tax.vatLines && <TotalRow label="Vat (12%)" value={plain(tax.vat)} />}
      {tax.exempt && <TotalRow label="No Tax (0%)" value={plain(0)} />}
      {tax.zeroRated && <TotalRow label="Zero Rated (0%)" value={plain(0)} />}
    </>
  );
}

/** Under the paper, as on Zoho's record: the salesperson, then the custom fields. */
export function MoreInformation({
  salesperson,
  fields,
}: {
  salesperson: string;
  fields: [string, string][];
}) {
  const row = (label: string, value: string) => (
    <div key={label} className="grid grid-cols-[150px_1fr] gap-3 py-1.5 text-[13px]">
      <span className="text-[#5d6a8a]">{label}</span>
      <span className="text-[#21263c]">: {value}</span>
    </div>
  );
  return (
    <div className="mx-auto w-full max-w-[800px] print:hidden">
      <div className="border-t border-[#e6e6e6] pt-5">
        <h2 className="text-[16px] font-normal text-[#21263c]">More Information</h2>
        <div className="mt-3">{row("Salesperson", salesperson)}</div>
      </div>
      {fields.length > 0 && (
        <div className="mt-5 border-t border-[#e6e6e6] pt-5">
          <h2 className="text-[13px] font-semibold tracking-wide text-[#21263c] uppercase">
            Custom Fields
          </h2>
          <div className="mt-3">{fields.map(([label, value]) => row(label, value))}</div>
        </div>
      )}
    </div>
  );
}

/** The record's own bar above the paper, as Zoho's: its number, then its buttons. */
export function RecordBar({ title, children }: { title: string; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-[800px] print:hidden">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden="true" /> Back
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e6e6] pb-3">
        <h1 className="text-[20px] font-normal text-[#21263c]">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {children}
          <Button small onClick={() => window.print()}>
            <Printer size={15} aria-hidden="true" /> PDF/Print
          </Button>
        </div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  INVOICED: "text-[#21b26f]",
  PAID: "text-[#21b26f]",
  "NOT INVOICED": "text-[#888]",
  SHIPPED: "text-[#408dfb]",
  FULFILLED: "text-[#21b26f]",
  PENDING: "text-[#888]",
  VOID: "text-[#888]",
};

export function SalesOrderPage() {
  const id = Number(useParams().id);
  const query = useQuery({
    queryKey: ["orders", "sales-order", id],
    queryFn: () => api<SalesOrderDoc>(`/api/orders/${id}/sales-order`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="this sales order" />;
  const { order, company, items } = data;
  const own = order.invoiceFrom === "2mg";
  const subTotal = items.reduce((sum, line) => sum + line.amount, 0);
  const meta: [string, ReactNode][] = [
    ["Order Date", dayLabel(order.orderDate)],
    ["Terms", order.terms],
    ...(order.expectedOn
      ? ([["Expected Shipment Date", dayLabel(order.expectedOn)]] as [string, ReactNode][])
      : []),
    ...(order.ref ? ([["Ref#", order.ref]] as [string, ReactNode][]) : []),
    ...(order.deliveryMethod
      ? ([["Delivery Method", order.deliveryMethod]] as [string, ReactNode][])
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <RecordBar title={order.code}>
        <Link
          to={`/orders/${order.id}`}
          className="inline-flex h-8 items-center rounded-[10px] px-2.5 text-[13px] font-semibold text-slate-600 hover:bg-head hover:text-ink"
        >
          Open the order
        </Link>
        <SendToCustomer orderId={order.id} small />
      </RecordBar>

      <div className="mx-auto flex w-full max-w-[800px] flex-wrap items-center gap-x-6 gap-y-1 text-[13px] print:hidden">
        <span className="text-[#5d6a8a]">
          Invoice Status :{" "}
          <b className={`font-semibold ${STATUS_TONE[order.invoiceStatus] ?? ""}`}>
            {order.invoiceStatus}
          </b>
          {order.invoiceId && (
            <Link
              to={`/invoices/${order.invoiceId}`}
              className="ml-2 text-[#408dfb] hover:underline"
            >
              {order.invoiceCode}
            </Link>
          )}
        </span>
        <span className="text-[#5d6a8a]">
          Shipment :{" "}
          <b className={`font-semibold ${STATUS_TONE[order.shipment] ?? ""}`}>{order.shipment}</b>
        </span>
      </div>

      <ZohoPaper ribbon={order.ribbon}>
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <CompanyBlock company={company} own={own} label={order.invoiceFromLabel} />
          <div className="text-left sm:text-right">
            <div className="text-[32px] leading-none font-light tracking-wide text-black uppercase">
              Sales Order
            </div>
            <div className="mt-2 text-[12px] font-semibold text-black">
              Sales Order# {order.code}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <ShipTo
            name={order.customer}
            to={`/customers/${order.customerId}`}
            lines={order.shipTo}
          />
          <MetaRows rows={meta} />
        </div>

        <DocLines lines={items} discount />

        <table className="mt-2 ml-auto w-full max-w-[360px] border-collapse text-[12px]">
          <tbody>
            <TotalRow label="Sub Total" note="(Tax Inclusive)" value={plain(subTotal)} />
            {order.deliveryFee > 0 && (
              <TotalRow label="Shipping charge" value={plain(order.deliveryFee)} />
            )}
            {taxRows(data.tax)}
            <TotalRow label="Total" value={php(order.total)} strong shaded />
          </tbody>
        </table>

        {order.notes.length > 0 && (
          <div className="mt-10">
            <div className="text-black">Notes</div>
            {order.notes.map((note) => (
              <div key={note} className="mt-1 text-[11px] whitespace-pre-line">
                {note}
              </div>
            ))}
          </div>
        )}
      </ZohoPaper>

      <MoreInformation salesperson={order.salesperson} fields={order.customFields} />
    </div>
  );
}
