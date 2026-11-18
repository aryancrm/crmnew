// One document of the books, as Zoho Inventory shows it on the right of its list (docs/PLAN.md
// 17): the number with ✕, the toolbar, the documents it hangs together with (a purchase order's
// receives and bills, a bill's payments), and the paper itself — title, status steps, the vendor,
// the lines under a dark heading, the totals. Under the paper, everything else Zoho kept about it
// (its own fields, each line's batches and expiry), which Zoho itself keeps out of sight.

import type { BookDoc, BookKind, BookLine, BookLinked } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Printer, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApplyToBills, Plain, useMay, VoidBox } from "./forms";
import { PublishButton, RecurringPanel, RefundBox, useMayLedger } from "./ledger";
import { api } from "../api";
import { type KindInfo, kindInfo, statusClass, statusText, zDate, zMoney, zQty } from "./kinds";

const TITLE: Partial<Record<BookKind, string>> = {
  adjustment: "INVENTORY ADJUSTMENT",
  package: "PACKAGE",
  shipment: "SHIPMENT ORDER",
  transfer_order: "TRANSFER ORDER",
  sales_order: "SALES ORDER",
  invoice: "TAX INVOICE",
  customer_payment: "PAYMENT RECEIPT",
  purchase_order: "PURCHASE ORDER",
  purchase_receive: "PURCHASE RECEIVE",
  bill: "BILL",
  vendor_payment: "PAYMENTS MADE",
  vendor_credit: "VENDOR CREDITS",
  sales_return: "SALES RETURN",
  credit_note: "CREDIT NOTE",
  expense: "EXPENSE",
  journal: "JOURNAL",
  transfer_fund: "TRANSFER FUND",
  deposit: "DEPOSIT",
  refund: "REFUND",
  recurring_bill: "RECURRING BILL",
  recurring_expense: "RECURRING EXPENSE",
  fixed_asset: "FIXED ASSET",
};
const LINKED_TITLE: Partial<Record<BookKind, string>> = {
  package: "Packages",
  shipment: "Shipments",
  purchase_order: "Purchase Orders",
  purchase_receive: "Receives",
  bill: "Bills",
  vendor_payment: "Payments Made",
  vendor_credit: "Vendor Credits",
  sales_order: "Sales Orders",
  invoice: "Invoices",
  credit_note: "Credit Notes",
  sales_return: "Sales Returns",
};

const EXTRA_LABEL: Record<string, string> = {
  reason: "Reason",
  description: "Description",
  type: "Type",
  warehouse: "Warehouse",
  by: "Created By",
  at: "Created Time",
  qty: "Quantity",
  from: "Source Warehouse",
  to: "Destination Warehouse",
  so: "Sales Order#",
  package: "Package#",
  carrier: "Carrier",
  tracking: "Tracking#",
  account: "Expense Account",
  paidThrough: "Paid Through",
  customer: "Customer",
  report: "Expense Report",
  notes: "Notes",
  frequency: "Frequency",
  every: "Repeat Every",
  last: "Last Made",
  mode: "Mode",
  creditNote: "Credit Note#",
  name: "Asset Name",
  method: "Depreciation",
  life: "Asset Life",
};
/** The same key read differently on Books' money documents. */
const MONEY_LABEL: Record<string, string> = { from: "From Account", to: "To Account", account: "Account" };
const extraLabel = (kind: BookKind, key: string) =>
  (["transfer_fund", "deposit", "refund", "fixed_asset"].includes(kind) ? MONEY_LABEL[key] : undefined) ?? EXTRA_LABEL[key] ?? key;

const step = (label: string, value: string, done: boolean) => (
  <div className="flex items-center gap-3 py-1">
    <span className={`w-20 ${done ? "text-[#212529]" : "text-[#6c718a]"}`}>{label}</span>
    <span className={done ? "rounded-sm bg-[#408dfb] px-2 py-0.5 text-[11px] text-white uppercase" : "text-[#8e91a8]"}>{value}</span>
  </div>
);

function Linked({ docs }: { docs: BookLinked[] }) {
  const groups = new Map<BookKind, BookLinked[]>();
  for (const doc of docs) groups.set(doc.kind, [...(groups.get(doc.kind) ?? []), doc]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!docs.length) return null;
  return (
    <div className="space-y-2">
      {[...groups].map(([kind, list]) => {
        const info = kindInfo(kind);
        const isOpen = open[kind] ?? true;
        return (
          <div key={kind} className="rounded-md border border-[#ebeaf2]">
            <button type="button" onClick={() => setOpen({ ...open, [kind]: !isOpen })} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
              <span className="font-medium">
                {LINKED_TITLE[kind] ?? kind} <span className="ml-1 rounded bg-[#ededf7] px-1.5 text-[11px] text-[#6c718a]">{list.length}</span>
              </span>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {isOpen && (
              <table className="w-full border-t border-[#ebeaf2] text-[12.5px]">
                <thead>
                  <tr className="text-[11px] text-[#6c718a] uppercase">
                    <th className="px-4 py-1.5 text-left font-normal">Date</th>
                    <th className="px-2 py-1.5 text-left font-normal">Number</th>
                    <th className="px-2 py-1.5 text-left font-normal">Status</th>
                    <th className="px-2 py-1.5 text-right font-normal">Amount</th>
                    <th className="px-4 py-1.5 text-right font-normal">Put on this</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((doc) => (
                    <tr key={doc.id} className="border-t border-[#f2f2f7]">
                      <td className="px-4 py-1.5">{zDate(doc.date)}</td>
                      <td className="px-2 py-1.5">
                        {info ? (
                          <Link to={`/books/${info.path}/${doc.id}`} className="text-[#1c5bd9]">
                            {doc.number}
                          </Link>
                        ) : (
                          doc.number
                        )}
                      </td>
                      <td className={`px-2 py-1.5 text-[11.5px] uppercase ${statusClass(doc.status)}`}>{statusText(doc.status)}</td>
                      <td className="px-2 py-1.5 text-right">{doc.kind === "purchase_receive" ? "" : zMoney(doc.total)}</td>
                      <td className="px-4 py-1.5 text-right">{doc.amount === null ? "" : zMoney(doc.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Fields the paper itself shows (the delivery address, the terms). */
const SHOWN_ELSEWHERE = new Set(["Attention", "Address", "City", "State", "Country", "Code", "Phone", "Terms & Conditions", "terms"]);

/** Field names as people read them: "CF.Delivery Mode" → "Delivery Mode", "vendor_name" → "Vendor name". */
const fieldLabel = (key: string) => {
  const plain = key.replace(/^CF\./, "").replace(/^Item\.CF\./, "").replace(/_/g, " ");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
};
const fieldValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(fieldValue).filter(Boolean).join(", ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${fieldLabel(k)}: ${fieldValue(v)}`).join(" · ");
  return String(value);
};

function Fields({ fields }: { fields: Record<string, unknown> }) {
  // Zoho fills many fields with a zero or "false" that says nothing: those are left out.
  const entries = Object.entries(fields).filter(([key, value]) => !SHOWN_ELSEWHERE.has(key) && !key.startsWith("_") && !/^(0+(\.0+)?|false)$/i.test(fieldValue(value)) && fieldValue(value) !== "");
  if (!entries.length) return null;
  return (
    <dl className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-3 border-b border-[#f2f2f7] py-1">
          <dt className="w-44 shrink-0 text-[#6c718a]">{fieldLabel(key)}</dt>
          <dd className="min-w-0 break-words">{fieldValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A journal's or an expense's lines: each account with its words and its money. */
function AccountLines({ doc }: { doc: BookDoc }) {
  const journal = doc.kind === "journal";
  return (
    <table className="mt-6 w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="bg-[#3c3d3a] text-left text-white">
          <th className="px-2 py-2 font-normal">Account</th>
          <th className="px-2 py-2 font-normal">Description</th>
          {journal ? (
            <>
              <th className="px-2 py-2 text-right font-normal">Debits</th>
              <th className="px-2 py-2 text-right font-normal">Credits</th>
            </>
          ) : (
            <th className="px-2 py-2 text-right font-normal">Amount</th>
          )}
        </tr>
      </thead>
      <tbody>
        {doc.lines.map((line) => (
          <tr key={line.id} className="border-b border-[#ebeaf2] align-top">
            <td className="px-2 py-2.5 font-medium">{line.account}</td>
            <td className="px-2 py-2.5 whitespace-pre-wrap text-[#4b4f63]">
              {line.description}
              {line.taxName && line.taxName !== "No Tax" && (
                <div className="text-[11px] text-[#6c718a]">
                  {line.taxName}
                  {line.taxPct ? ` (${line.taxPct}%)` : ""}
                </div>
              )}
            </td>
            {journal ? (
              <>
                <td className="px-2 py-2.5 text-right">{(line.amount ?? 0) > 0 ? zMoney(line.amount, "") : ""}</td>
                <td className="px-2 py-2.5 text-right">{(line.amount ?? 0) < 0 ? zMoney(-(line.amount ?? 0), "") : ""}</td>
              </>
            ) : (
              <td className="px-2 py-2.5 text-right">{zMoney(line.amount, "")}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Zoho's "Journal" of a transaction: what it put on each account. */
function Entries({ doc }: { doc: BookDoc }) {
  const entries = doc.entries ?? [];
  if (!entries.length) return null;
  const debit = entries.reduce((sum, e) => sum + e.debit, 0);
  const credit = entries.reduce((sum, e) => sum + e.credit, 0);
  return (
    <section className="mx-auto max-w-[820px] rounded-md border border-[#ebeaf2]">
      <h2 className="border-b border-[#ebeaf2] px-4 py-2 font-medium">Journal</h2>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="text-[11px] text-[#6c718a] uppercase">
            <th className="px-4 py-1.5 text-left font-normal">Account</th>
            <th className="px-2 py-1.5 text-right font-normal">Debit</th>
            <th className="px-4 py-1.5 text-right font-normal">Credit</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={i} className="border-t border-[#ebeaf2]">
              <td className="px-4 py-1.5">
                {entry.accountId ? (
                  <Link to={`/books/accounts/${entry.accountId}`} className="text-[#1c5bd9]">
                    {entry.account}
                  </Link>
                ) : (
                  entry.account
                )}
              </td>
              <td className="px-2 py-1.5 text-right">{entry.debit ? zMoney(entry.debit, "") : ""}</td>
              <td className="px-4 py-1.5 text-right">{entry.credit ? zMoney(entry.credit, "") : ""}</td>
            </tr>
          ))}
          <tr className="border-t border-[#ebeaf2] font-semibold">
            <td className="px-4 py-1.5" />
            <td className="px-2 py-1.5 text-right">{zMoney(debit, "")}</td>
            <td className="px-4 py-1.5 text-right">{zMoney(credit, "")}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function LineItems({ doc }: { doc: BookDoc }) {
  const order = doc.kind === "purchase_order";
  const payment = doc.kind === "vendor_payment" || doc.kind === "customer_payment";
  if (payment || !doc.lines.length) return null;
  if (["journal", "expense", "recurring_expense", "recurring_bill"].includes(doc.kind)) return <AccountLines doc={doc} />;
  return (
    <table className="mt-6 w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="bg-[#3c3d3a] text-left text-white">
          <th className="w-8 px-2 py-2 font-normal">#</th>
          <th className="px-2 py-2 font-normal">Item &amp; Description</th>
          <th className="px-2 py-2 text-right font-normal">{order ? "Ordered" : "Qty"}</th>
          {doc.kind !== "purchase_receive" && <th className="px-2 py-2 text-right font-normal">Rate</th>}
          {doc.kind !== "purchase_receive" && <th className="px-2 py-2 text-right font-normal">Amount</th>}
        </tr>
      </thead>
      <tbody>
        {doc.lines.map((line) => (
          <LineRow key={line.id} line={line} doc={doc} />
        ))}
      </tbody>
    </table>
  );
}

function LineRow({ line, doc }: { line: BookLine; doc: BookDoc }) {
  const done = Object.entries(line.qtyDone ?? {});
  return (
    <tr className="border-b border-[#ebeaf2] align-top">
      <td className="px-2 py-2.5">{line.n}</td>
      <td className="px-2 py-2.5">
        <div className="font-medium">
          {line.medicineId ? (
            <Link to={`/medicines/${line.medicineId}`} className="text-[#1c5bd9]" title={line.medicine ?? undefined}>
              {line.itemName ?? line.medicine}
            </Link>
          ) : (
            (line.itemName ?? line.account ?? "")
          )}
        </div>
        {line.sku && <div className="text-[11.5px] text-[#6c718a]">SKU: {line.sku}</div>}
        {line.description && <div className="text-[12px] whitespace-pre-wrap text-[#4b4f63]">{line.description}</div>}
        {line.account && line.itemName && <div className="text-[11.5px] text-[#6c718a]">Account: {line.account}</div>}
        {line.warehouse && <div className="text-[11.5px] text-[#6c718a]">{line.warehouse}</div>}
        {line.batches?.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[11.5px] text-[#4b4f63]">
            {line.batches.map((batch, i) => (
              <li key={i}>
                Batch {fieldValue(batch["Batch Reference#"] ?? batch.batch_number ?? batch["Manufacturer Batch#"])}
                {batch["Expiry Date"] || batch.expiry_date ? ` · expires ${zDate(String(batch["Expiry Date"] ?? batch.expiry_date))}` : ""}
                {batch["Quantity In"] || batch["Quantity Out"] ? ` · ${fieldValue(batch["Quantity In"] ?? batch["Quantity Out"])}` : ""}
              </li>
            ))}
          </ul>
        )}
        {Object.keys(line.fields ?? {}).length > 0 && (
          <details className="mt-1 text-[11.5px] text-[#6c718a]">
            <summary className="cursor-pointer">More about this line</summary>
            <Fields fields={line.fields} />
          </details>
        )}
      </td>
      <td className="px-2 py-2.5 text-right whitespace-nowrap">
        {zQty(line.qty)} {line.unit ?? ""}
        {done.map(([what, qty]) => (
          <div key={what} className="text-[11px] text-[#6c718a]">
            {zQty(qty)} {what}
          </div>
        ))}
      </td>
      {doc.kind !== "purchase_receive" && <td className="px-2 py-2.5 text-right">{line.rate === null ? "" : zQty(line.rate)}</td>}
      {doc.kind !== "purchase_receive" && (
        <td className="px-2 py-2.5 text-right">
          {zMoney(line.amount, "")}
          {line.taxName && (
            <div className="text-[11px] text-[#6c718a]">
              {line.taxName}
              {line.taxPct ? ` (${line.taxPct}%)` : ""}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

export function DocView({ info, id, onClose }: { info: KindInfo; id: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ["books", info.kind, "doc", id], queryFn: () => api<BookDoc>(`/api/books/${info.kind}/${id}`) });
  const may = useMay();
  const navigate = useNavigate();
  const [box, setBox] = useState<"apply" | "void" | "cancel" | "refund" | null>(null);
  const doc = query.data;
  if (!doc) return <p className="p-6 text-[#6c718a]">{query.isError ? query.error.message : "Loading…"}</p>;
  const order = doc.kind === "purchase_order";
  const f = doc.fields as Record<string, string | undefined>;
  const delivery = f.Attention ? [f.Attention, f.Address, [f.City, f.State].filter(Boolean).join(", "), [f.Country, f.Code].filter(Boolean).join(" - "), f.Phone].filter(Boolean).join("\n") : (f["Warehouse Name"] ?? "");
  const terms = f["Terms & Conditions"] ?? f.terms;
  const next =
    order && doc.status === "issued" && doc.received === "none"
      ? "Convert it to a bill or create a receive to complete your purchase."
      : doc.kind === "bill" && doc.balance > 0 && doc.status !== "void"
        ? "Record a payment for this bill when it is paid."
        : null;
  const fx = doc.currency !== "PHP" ? ` · 1 ${doc.currency} = PHP${doc.fxRate}` : "";
  return (
    <div className="min-h-full bg-white">
      <div className="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-[#ebeaf2] bg-white px-5">
        <h1 className="text-[20px] font-medium text-[#212529]">{doc.number}</h1>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[#f76831] hover:bg-[#f1f1fa]">
          <X size={18} />
        </button>
      </div>
      <div className="flex h-[40px] items-center gap-1 border-b border-[#ebeaf2] bg-[#f9f9fb] px-4 text-[13px] print:hidden">
        <Actions doc={doc} may={may} onBox={setBox} go={(to) => navigate(to)} />
        <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-white">
          <Printer size={14} aria-hidden="true" /> PDF/Print
        </button>
        {doc.crm && (
          <Link to={doc.crm.href} className="ml-auto rounded px-2.5 py-1 text-[#1c5bd9] hover:bg-white">
            Open on the order line ↗
          </Link>
        )}
        {doc.fromZoho && <span className="ml-auto text-[12px] text-[#6c718a]">From Zoho{doc.zohoCreated ? ` · made ${doc.zohoCreated}` : ""}</span>}
      </div>
      <div className="space-y-5 p-5">
        {box === "apply" && <ApplyToBills doc={doc} onDone={() => setBox(null)} />}
        {box === "void" && <VoidBox doc={doc} onDone={() => setBox(null)} />}
        {box === "refund" && <RefundBox doc={doc} onDone={() => setBox(null)} />}
        {(doc.kind === "recurring_expense" || doc.kind === "recurring_bill") && <RecurringPanel doc={doc} />}
        {box === "cancel" && <CancelOrder doc={doc} onDone={() => setBox(null)} />}
        {doc.status === "void" && doc.fields && (
          <div className="mx-auto max-w-[820px] rounded-md bg-[#f7f7fe] px-4 py-2 text-[#6c718a]">This {info.one.toLowerCase()} is void.</div>
        )}
        {next && (
          <div className="rounded-md border border-[#ebeaf2] px-4 py-3">
            <span className="font-semibold">✦ WHAT'S NEXT?</span> <span className="text-[#4b4f63]">{next}</span>
          </div>
        )}
        <Linked docs={doc.linkedDocs} />
        {(doc.files?.length ?? 0) > 0 && (
          <div className="rounded-md border border-[#ebeaf2] px-4 py-3">
            <div className="mb-1 font-medium">Attachments ({doc.files?.length})</div>
            <ul className="space-y-1">
              {doc.files?.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-2">
                  <a href={`/api/books/files/${file.id}`} target="_blank" rel="noreferrer" className="text-[#1c5bd9] hover:underline">
                    {file.name}
                  </a>
                  <span className="text-[12px] text-[#6c718a]">
                    {Math.round(file.size / 1024)} KB{file.uploadedBy ? ` · ${file.uploadedBy}` : ""}{file.uploadedOn ? ` · ${file.uploadedOn}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <article className="mx-auto max-w-[820px] rounded-sm border border-[#ebeaf2] p-8 shadow-[0_0_6px_rgba(0,0,0,0.06)]">
          <div className="flex flex-wrap justify-between gap-6">
            <div>
              <div className="text-[26px] font-normal tracking-wide text-[#212529]">{TITLE[doc.kind] ?? info.one.toUpperCase()}</div>
              <div className="mt-1">
                {info.numberLabel} <b>{doc.number}</b>
              </div>
              <div className="mt-4 text-[11px] text-[#6c718a] uppercase">Status</div>
              {order ? (
                <div className="mt-1 border-l-2 border-[#f7a524] pl-3">
                  {step("Order", statusText(doc.status), true)}
                  {step("Receive", doc.received === "full" ? "Received" : doc.received === "partial" ? "Partially Received" : "Yet To Be Received", doc.received !== "none")}
                  {step("Bill", doc.billed === "full" ? "Billed" : doc.billed === "partial" ? "Partially Billed" : "Yet To Be Billed", doc.billed !== "none")}
                </div>
              ) : (
                <div className={`mt-1 text-[12px] uppercase ${statusClass(doc.status)}`}>{statusText(doc.status, doc.overdueDays)}</div>
              )}
              <dl className="mt-5 grid grid-cols-[9rem_1fr] gap-y-1.5">
                {doc.reference && (
                  <>
                    <dt className="text-[11px] text-[#6c718a] uppercase">Reference#</dt>
                    <dd>{doc.reference}</dd>
                  </>
                )}
                {Object.entries(doc.extra ?? {})
                  .filter(([, value]) => value !== null && value !== "")
                  .map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-[11px] text-[#6c718a] uppercase">{extraLabel(doc.kind, key)}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                <dt className="text-[11px] text-[#6c718a] uppercase">{order ? "Order Date" : "Date"}</dt>
                <dd>{zDate(doc.date)}</dd>
                {doc.dueDate && (
                  <>
                    <dt className="text-[11px] text-[#6c718a] uppercase">{order ? "Delivery Date" : "Due Date"}</dt>
                    <dd>{zDate(doc.dueDate)}</dd>
                  </>
                )}
                {doc.paymentTerms && (
                  <>
                    <dt className="text-[11px] text-[#6c718a] uppercase">Payment Terms</dt>
                    <dd>{doc.paymentTerms}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="max-w-xs">
              <div className="text-[11px] text-[#6c718a] uppercase">{info.section === "Sales" ? "Customer" : info.section === "Purchases" ? "Vendor Address" : "Contact"}</div>
              {doc.vendor ? (
                <Link to={`/books/vendors/${doc.vendor.id}`} className="font-medium text-[#1c5bd9]">
                  {doc.vendor.name}
                </Link>
              ) : doc.partyId && info.section === "Sales" ? (
                <Link to={`/books/customers/${doc.partyId}`} className="font-medium text-[#1c5bd9]">
                  {doc.party}
                </Link>
              ) : (
                <div className="font-medium">{doc.party}</div>
              )}
              {doc.vendor?.address && <div className="mt-1 whitespace-pre-wrap text-[#4b4f63]">{doc.vendor.address}</div>}
              {doc.vendor?.email && <div className="text-[#4b4f63]">{doc.vendor.email}</div>}
              {doc.vendor?.phone && <div className="text-[#4b4f63]">{doc.vendor.phone}</div>}
              {order && delivery && (
                <div className="mt-5">
                  <div className="text-[11px] text-[#6c718a] uppercase">Delivery Address</div>
                  <div className="whitespace-pre-wrap text-[#212529]">{delivery}</div>
                </div>
              )}
            </div>
          </div>
          <LineItems doc={doc} />
          <div className={`mt-4 ml-auto w-full max-w-sm space-y-1.5 ${doc.kind === "purchase_receive" ? "hidden" : ""}`}>
            {doc.subTotal !== null && (
              <div className="flex justify-between">
                <span>Sub Total</span>
                <span>{zMoney(doc.subTotal, "")}</span>
              </div>
            )}
            <div className="flex justify-between bg-[#f5f5f5] px-2 py-2 font-semibold">
              <span>Total</span>
              <span>{zMoney(doc.total, doc.currency)}</span>
            </div>
            {(doc.kind === "bill" || doc.kind === "invoice" || doc.kind === "vendor_credit" || doc.kind === "credit_note") && (
              <div className="flex justify-between px-2">
                <span>{doc.kind === "bill" || doc.kind === "invoice" ? "Balance Due" : "Credits Remaining"}</span>
                <span className="font-medium">{zMoney(doc.balance, doc.currency)}</span>
              </div>
            )}
            {doc.unused !== null && (doc.kind === "vendor_payment" || doc.kind === "customer_payment") && (
              <div className="flex justify-between px-2">
                <span>Unused Amount</span>
                <span>{zMoney(doc.unused, doc.currency)}</span>
              </div>
            )}
            {fx && <div className="text-right text-[11.5px] text-[#6c718a]">{fx.slice(3)}</div>}
          </div>
          {doc.notes && (
            <div className="mt-6">
              <div className="text-[11px] text-[#6c718a] uppercase">Notes</div>
              <div className="whitespace-pre-wrap">{doc.notes}</div>
            </div>
          )}
          {terms && (
            <div className="mt-6">
              <div className="text-[11px] text-[#6c718a] uppercase">Terms &amp; Conditions</div>
              <div className="whitespace-pre-wrap text-[12.5px] text-[#4b4f63]">{terms}</div>
            </div>
          )}
        </article>
        <Entries doc={doc} />
        {Object.keys(doc.fields).some((key) => !SHOWN_ELSEWHERE.has(key) && key !== "Warehouse Name") && (
          <section className="mx-auto max-w-[820px] print:hidden">
            <h2 className="mb-2 text-[14px] font-semibold text-[#212529]">Everything else on it</h2>
            <Fields fields={doc.fields} />
          </section>
        )}
      </div>
    </div>
  );
}

const TOOL = "flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-white";

/** The toolbar's buttons for what can be done next with this document, by who may do it. */
function Actions({ doc, may, onBox, go }: { doc: BookDoc; may: ReturnType<typeof useMay>; onBox: (box: "apply" | "void" | "cancel" | "refund") => void; go: (to: string) => void }) {
  const mayLedger = useMayLedger();
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const left = (what: "received" | "billed") => doc.lines.some((line) => (line.qty ?? 0) - (line.qtyDone.cancelled ?? 0) - (line.qtyDone[what] ?? 0) > 0);
  const open = !["draft", "cancelled", "closed", "void"].includes(doc.status);
  const buttons: ReactNode[] = [];
  if (doc.kind === "purchase_order") {
    if (doc.status === "draft" && may.order)
      buttons.push(
        <button
          key="issue"
          type="button"
          disabled={busy}
          className={TOOL}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/books/purchase_order/${doc.id}/status`, { body: { to: "issued" } });
              await queries.invalidateQueries({ queryKey: ["books"] });
            } finally {
              setBusy(false);
            }
          }}
        >
          Mark as Issued
        </button>,
      );
    if (open && may.order && left("received"))
      buttons.push(
        <button key="receive" type="button" className={TOOL} onClick={() => go(`/books/purchaseorders/${doc.id}/receive`)}>
          Receive
        </button>,
      );
    if (open && may.bill && left("billed"))
      buttons.push(
        <button key="bill" type="button" className={TOOL} onClick={() => go(`/books/purchaseorders/${doc.id}/bill`)}>
          Convert to Bill
        </button>,
      );
    if (may.order && !["cancelled", "closed"].includes(doc.status) && doc.received === "none" && doc.billed === "none")
      buttons.push(
        <button key="cancel" type="button" className={TOOL} onClick={() => onBox("cancel")}>
          Cancel Order
        </button>,
      );
  }
  if (doc.kind === "purchase_receive" && may.bill && doc.billed !== "full") {
    const order = doc.linkedDocs.find((d) => d.kind === "purchase_order");
    if (order)
      buttons.push(
        <button key="bill" type="button" className={TOOL} onClick={() => go(`/books/purchaseorders/${order.id}/bill?receive=${doc.id}`)}>
          Convert to Bill
        </button>,
      );
  }
  if (doc.kind === "bill" && doc.balance > 0 && doc.status !== "void" && may.pay)
    buttons.push(
      <button key="pay" type="button" className={TOOL} onClick={() => go(`/books/paymentsmade/new?vendor=${doc.vendor?.id ?? ""}&bill=${doc.id}`)}>
        Record Payment
      </button>,
    );
  if (doc.kind === "invoice" && doc.balance > 0 && doc.status !== "void" && may.pay)
    buttons.push(
      doc.crm ? (
        <button key="pay" type="button" className={TOOL} onClick={() => go(doc.crm?.href ?? "/")}>
          Record Payment ↗
        </button>
      ) : (
        <button key="pay" type="button" className={TOOL} onClick={() => go(`/books/paymentsreceived/new?customer=${doc.partyId ?? ""}&name=${encodeURIComponent(doc.party ?? "")}&invoice=${doc.id}`)}>
          Record Payment
        </button>
      ),
    );
  if ((doc.kind === "vendor_credit" || doc.kind === "vendor_payment" || ((doc.kind === "credit_note" || doc.kind === "customer_payment") && !doc.crm)) && doc.balance > 0 && doc.status !== "void" && may.pay)
    buttons.push(
      <button key="apply" type="button" className={TOOL} onClick={() => onBox("apply")}>
        Apply to Bills
      </button>,
    );
  if (doc.kind === "journal" && doc.status === "draft" && mayLedger) buttons.push(<PublishButton key="publish" doc={doc} className={TOOL} />);
  if ((doc.kind === "credit_note" || doc.kind === "customer_payment") && !doc.crm && doc.balance > 0 && doc.status !== "void" && mayLedger)
    buttons.push(
      <button key="refund" type="button" className={TOOL} onClick={() => onBox("refund")}>
        Refund
      </button>,
    );
  const voidable =
    doc.status !== "void" &&
    !doc.crm &&
    ((doc.kind === "bill" && may.bill && doc.balance === doc.total) ||
      (["vendor_payment", "vendor_credit", "customer_payment"].includes(doc.kind) && may.pay) ||
      (["credit_note", "expense", "journal", "transfer_fund", "deposit", "refund"].includes(doc.kind) && mayLedger));
  if (voidable)
    buttons.push(
      <button key="void" type="button" className={TOOL} onClick={() => onBox("void")}>
        Void
      </button>,
    );
  return <>{buttons}</>;
}

function CancelOrder({ doc, onDone }: { doc: BookDoc; onDone: () => void }) {
  const queries = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-[820px] rounded-md border border-[#f76831] p-4">
      <div className="mb-2 font-medium">Cancel {doc.number}? It stays in the books, marked cancelled.</div>
      {problem && <div className="mb-2 text-[#b91c1c]">{problem}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          className="h-[32px] rounded-[5px] bg-[#f76831] px-3 text-white"
          onClick={async () => {
            try {
              await api(`/api/books/purchase_order/${doc.id}/status`, { body: { to: "cancelled" } });
              await queries.invalidateQueries({ queryKey: ["books"] });
              onDone();
            } catch (error) {
              setProblem(error instanceof Error ? error.message : "That didn't work.");
            }
          }}
        >
          Cancel the order
        </button>
        <Plain onClick={onDone}>Keep it</Plain>
      </div>
    </div>
  );
}
