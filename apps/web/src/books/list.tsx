// A books list as Zoho Inventory draws it (docs/PLAN.md 17): "All Bills ▾" with each status as a
// view and its count, "+ New" and "⋯", the table with Zoho's grey capital headings, the number in
// blue, the status in its colour, and "1 – 25 of 8878" under it. Opening a document splits the
// page: the list shrinks to cards on the left, the document fills the right.

import type { BookList, BookRow, DoneState } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DocView } from "./doc";
import { useMay } from "./forms";
import { useMayLedger } from "./ledger";
import { type Column, type KindInfo, kindByPath, statusClass, statusText, viewLabel, zDate, zMoney, zQty } from "./kinds";

/** Why "+ New" is not offered on a list. */
const NEW_HINT: Partial<Record<string, string>> = {
  adjustment: "Stock is counted and corrected from the medicine's page (Inventory).",
  package: "Packages are packed by Dispatch on the order line.",
  shipment: "Shipments go out from Dispatch on the order line.",
  transfer_order: "Stock is moved between warehouses from the medicine's page (Inventory).",
  invoice: "Invoices are made on the order line: Finance invoices an approved order.",

  purchase_receive: "A receive is made from its purchase order: open the order and press Receive.",
  sales_return: "Sales returns are made from the order (Sales comes next).",
  credit_note: "Credit notes come with Sales (next).",
  expense: "Expenses are still entered in Zoho until the switch; they come over with each backup.",
  journal: "Manual journals are still made in Zoho until the switch.",
  transfer_fund: "Transfers between accounts are still made in Zoho until the switch.",
  deposit: "Deposits are still made in Zoho until the switch.",
  refund: "A refund is made from its credit note.",
  recurring_bill: "Recurring bills are still kept in Zoho until the switch.",
  recurring_expense: "Recurring expenses are still kept in Zoho until the switch.",
  fixed_asset: "Fixed assets are still kept in Zoho until the switch.",
};

/** Columns that stay on one line, as in Zoho. */
const NOWRAP = new Set(["date", "due", "status", "mode"]);

const dot = (state: DoneState | null) =>
  state === null ? null : (
    <span
      title={state === "full" ? "Fully" : state === "partial" ? "Partly" : "Not yet"}
      className={`inline-block size-[7px] rounded-full ${state === "full" ? "bg-[#408dfb]" : state === "partial" ? "border-2 border-[#408dfb]" : "bg-[#d5d6dd]"}`}
    />
  );
const status = (row: BookRow) => <span className={`text-[12px] uppercase ${statusClass(row.status)}`}>{statusText(row.status, row.overdueDays)}</span>;
const amount = (value: number | null, row: BookRow) => zMoney(value, row.currency);
/** A card's name when the document has no party: a transfer's accounts, a journal's notes. */
const cardName = (row: BookRow) =>
  row.extra?.from || row.extra?.to ? `${String(row.extra?.from ?? "")} → ${String(row.extra?.to ?? "")}` : String(row.extra?.notes ?? row.extra?.account ?? row.extra?.name ?? "—");
const num = (row: BookRow) => <span className="font-medium text-[#1c5bd9]">{row.number}</span>;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));

export const COLUMNS: Record<string, Column[]> = {
  // Zoho Books' own lists, with Zoho's headings (docs/PLAN.md 17).
  expense: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "account", label: "Expense Account", cell: (r) => text(r.extra?.account) },
    { key: "reference", label: "Reference#", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "paid", label: "Paid Through", cell: (r) => text(r.extra?.paidThrough) },
    { key: "customer", label: "Customer Name", cell: (r) => text(r.extra?.customer) },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  recurring_expense: [
    { key: "number", label: "Profile Name", sort: "number", cell: num },
    { key: "account", label: "Expense Account", cell: (r) => text(r.extra?.account) },
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "frequency", label: "Frequency", cell: (r) => `Every ${text(r.extra?.every) || "1"} ${text(r.extra?.frequency)}` },
    { key: "date", label: "Start Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  recurring_bill: [
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "number", label: "Profile Name", sort: "number", cell: num },
    { key: "frequency", label: "Frequency", cell: (r) => `Every ${text(r.extra?.every) || "1"} ${text(r.extra?.frequency)}` },
    { key: "last", label: "Last Bill Date", cell: (r) => zDate(text(r.extra?.last)) },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  journal: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Journal#", sort: "number", cell: num },
    { key: "reference", label: "Reference Number", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "notes", label: "Notes", cell: (r) => text(r.extra?.notes) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "by", label: "Created By", cell: (r) => text(r.extra?.by) },
  ],
  transfer_fund: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Reference#", sort: "number", cell: num },
    { key: "from", label: "From Account", cell: (r) => text(r.extra?.from) },
    { key: "to", label: "To Account", cell: (r) => text(r.extra?.to) },
    { key: "description", label: "Description", cell: (r) => text(r.extra?.description) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  deposit: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "type", label: "Type", cell: (r) => text(r.extra?.type) },
    { key: "number", label: "Reference#", sort: "number", cell: num },
    { key: "from", label: "From Account", cell: (r) => text(r.extra?.from) },
    { key: "to", label: "Deposited To", cell: (r) => text(r.extra?.to) },
    { key: "description", label: "Description", cell: (r) => text(r.extra?.description) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  refund: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "creditNote", label: "Credit Note#", cell: (r) => text(r.extra?.creditNote) },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "mode", label: "Mode", cell: (r) => text(r.extra?.mode) },
    { key: "from", label: "Refunded From", cell: (r) => text(r.extra?.from) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  fixed_asset: [
    { key: "number", label: "Asset Number", sort: "number", cell: num },
    { key: "name", label: "Asset Name", cell: (r) => text(r.extra?.name) },
    { key: "type", label: "Asset Type", cell: (r) => text(r.extra?.type) },
    { key: "date", label: "Purchase Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Purchase Value", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "balance", label: "Current Value", sort: "balance", align: "right", cell: (r) => amount(r.balance, r) },
  ],
  purchase_order: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Purchase Order#", sort: "number", cell: num },
    { key: "reference", label: "Reference#", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "received", label: "Received", align: "center", cell: (r) => dot(r.received) },
    { key: "billed", label: "Billed", align: "center", cell: (r) => dot(r.billed) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "due", label: "Delivery Date", sort: "due", cell: (r) => zDate(r.dueDate) },
  ],
  purchase_receive: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Purchase Receive#", sort: "number", cell: num },
    { key: "linked", label: "Purchase Order#", sort: "reference", cell: (r) => r.linked ?? "" },
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "billed", label: "Billed", align: "center", cell: (r) => dot(r.billed) },
    { key: "qty", label: "Quantity", align: "right", cell: (r) => zQty(r.qty) },
  ],
  bill: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Bill#", sort: "number", cell: num },
    { key: "reference", label: "Reference Number", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "due", label: "Due Date", sort: "due", cell: (r) => zDate(r.dueDate) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "balance", label: "Balance Due", sort: "balance", align: "right", cell: (r) => amount(r.balance, r) },
  ],
  vendor_payment: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Payment #", sort: "number", cell: num },
    { key: "reference", label: "Reference#", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "linked", label: "Bill#", cell: (r) => r.linked ?? "" },
    { key: "mode", label: "Mode", cell: (r) => r.mode ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "unused", label: "Unused Amount", align: "right", cell: (r) => amount(r.unused, r) },
  ],
  vendor_credit: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Credit Note#", sort: "number", cell: num },
    { key: "reference", label: "Reference Number", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Vendor Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "balance", label: "Balance", sort: "balance", align: "right", cell: (r) => amount(r.balance, r) },
  ],
  adjustment: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "reason", label: "Reason", cell: (r) => String(r.extra?.reason ?? "") },
    { key: "description", label: "Description", cell: (r) => String(r.extra?.description ?? "") },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "number", label: "Reference Number", sort: "number", cell: (r) => <span className="font-medium text-[#1c5bd9]">{r.reference || r.number}</span> },
    { key: "type", label: "Type", cell: (r) => String(r.extra?.type ?? "Quantity") },
    { key: "by", label: "Created By", cell: (r) => String(r.extra?.by ?? "") },
    { key: "warehouse", label: "Warehouse Name", cell: (r) => String(r.extra?.warehouse ?? "") },
  ],
  package: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Package#", sort: "number", cell: num },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "so", label: "Sales Order#", sort: "reference", cell: (r) => String(r.extra?.so ?? r.reference ?? "") },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "carrier", label: "Carrier", cell: (r) => String(r.extra?.carrier ?? "") },
    { key: "qty", label: "Quantity", align: "right", cell: (r) => zQty(Number(r.extra?.qty ?? 0)) },
  ],
  shipment: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Shipment Order#", sort: "number", cell: num },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "so", label: "Sales Order#", cell: (r) => String(r.extra?.so ?? "") },
    { key: "package", label: "Package#", cell: (r) => String(r.extra?.package ?? "") },
    { key: "carrier", label: "Carrier", cell: (r) => String(r.extra?.carrier ?? "") },
    { key: "tracking", label: "Tracking#", cell: (r) => String(r.extra?.tracking ?? r.reference ?? "") },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Shipping Rate", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  transfer_order: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Transfer Order#", sort: "number", cell: num },
    { key: "reason", label: "Reason", cell: (r) => String(r.extra?.reason ?? "") },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "qty", label: "Quantity", align: "right", cell: (r) => zQty(Number(r.extra?.qty ?? 0)) },
    { key: "from", label: "Source Warehouse", cell: (r) => String(r.extra?.from ?? "") },
    { key: "to", label: "Destination Warehouse", cell: (r) => String(r.extra?.to ?? "") },
  ],
  sales_order: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Sales Order#", sort: "number", cell: num },
    { key: "reference", label: "Reference#", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "status", label: "Order Status", sort: "status", cell: status },
    { key: "invoiced", label: "Invoiced", align: "center", cell: (r) => dot(r.invoiced ?? null) },
    { key: "paid", label: "Payment", align: "center", cell: (r) => dot(r.paid ?? null) },
    { key: "packed", label: "Packed", align: "center", cell: (r) => dot(r.packed ?? null) },
    { key: "shipped", label: "Shipped", align: "center", cell: (r) => dot(r.shipped ?? null) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "delivery", label: "Delivery Method", cell: (r) => r.deliveryMethod ?? "" },
  ],
  invoice: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Invoice#", sort: "number", cell: num },
    { key: "linked", label: "Order Number", cell: (r) => r.linked ?? "" },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "due", label: "Due Date", sort: "due", cell: (r) => zDate(r.dueDate) },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "balance", label: "Balance Due", sort: "balance", align: "right", cell: (r) => amount(r.balance, r) },
  ],
  customer_payment: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Payment #", sort: "number", cell: num },
    { key: "reference", label: "Reference Number", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "linked", label: "Invoice#", cell: (r) => r.linked ?? "" },
    { key: "mode", label: "Mode", cell: (r) => r.mode ?? "" },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "unused", label: "Unused Amount", align: "right", cell: (r) => amount(r.unused, r) },
  ],
  sales_return: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "RMA#", sort: "number", cell: num },
    { key: "linked", label: "Sales Order#", cell: (r) => r.linked ?? "" },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "qty", label: "Returned", align: "right", cell: (r) => zQty(r.qty) },
    { key: "total", label: "Amount Refunded", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
  ],
  credit_note: [
    { key: "date", label: "Date", sort: "date", cell: (r) => zDate(r.date) },
    { key: "number", label: "Credit Note#", sort: "number", cell: num },
    { key: "reference", label: "Reference Number", sort: "reference", cell: (r) => r.reference ?? "" },
    { key: "party", label: "Customer Name", sort: "party", cell: (r) => r.party ?? "" },
    { key: "linked", label: "Invoice#", cell: (r) => r.linked ?? "" },
    { key: "status", label: "Status", sort: "status", cell: status },
    { key: "total", label: "Amount", sort: "total", align: "right", cell: (r) => amount(r.total, r) },
    { key: "balance", label: "Balance", sort: "balance", align: "right", cell: (r) => amount(r.balance, r) },
  ],
};

export function useBookList(info: KindInfo) {
  const [params] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["view", "page", "perPage", "q", "sort", "dir"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return useQuery({
    queryKey: ["books", info.kind, query.toString()],
    queryFn: () => api<BookList>(`/api/books/${info.kind}?${query}`),
    placeholderData: keepPreviousData,
  });
}

/** "All Bills ▾": the views, each with its count. */
export function ViewMenu({ views, view, plural, onPick, labelOf }: { views: { key: string; count: number }[]; view: string; plural: string; onPick: (key: string) => void; labelOf?: (key: string) => string }) {
  const name = labelOf ?? ((key: string) => viewLabel(key, plural));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="flex max-w-[230px] items-center gap-1.5 text-[16px] font-semibold whitespace-nowrap text-[#212529]" aria-expanded={open}>
        <span className="truncate">{name(view)}</span> <ChevronDown size={16} className="text-[#408dfb]" aria-hidden="true" />
      </button>
      {open && (
        <ul className="absolute top-8 left-0 z-30 max-h-96 w-64 overflow-y-auto rounded-md border border-[#ebeaf2] bg-white py-1 shadow-lg">
          {views.map((v) => (
            <li key={v.key}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(v.key);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#408dfb] hover:text-white ${v.key === view ? "font-medium text-[#408dfb]" : ""}`}
              >
                {name(v.key)} <span className="text-[12px] opacity-70">{v.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "1 – 25 of 8878" with ‹ ›, and how many to a page. */
export function Pager({ page, perPage, total, onPage, onPer }: { page: number; perPage: number; total: number; onPage: (page: number) => void; onPer: (per: number) => void }) {
  const from = total ? (page - 1) * perPage + 1 : 0;
  const to = Math.min(total, page * perPage);
  return (
    <div className="flex items-center justify-end gap-3 border-t border-[#ebeaf2] px-4 py-2 text-[12px] text-[#6c718a]">
      <label className="flex items-center gap-1">
        <select value={perPage} onChange={(event) => onPer(Number(event.target.value))} className="rounded border border-[#d7d5e2] bg-white px-1 py-0.5 text-[12px]">
          {[10, 25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n} per page
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded p-1 hover:bg-[#f1f1fa] disabled:opacity-30" aria-label="Previous page">
        <ChevronLeft size={15} />
      </button>
      <span>
        {from} – {to} of {total}
      </span>
      <button type="button" disabled={to >= total} onClick={() => onPage(page + 1)} className="rounded p-1 hover:bg-[#f1f1fa] disabled:opacity-30" aria-label="Next page">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

export function BookListPage() {
  const { list, id } = useParams();
  const info = kindByPath(list);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const may = useMay();
  const query = useBookList(info ?? { kind: "bill", path: "bills", plural: "Bills", one: "Bill", numberLabel: "Bill#", section: "Purchases" });
  if (!info) return <p className="p-6 text-[#6c718a]">No such list.</p>;
  const data = query.data;
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const mayLedger = useMayLedger();
  const columns = COLUMNS[info.kind] ?? [];
  const newTo =
    info.kind === "sales_order"
      ? "/orders/new"
      : (info.kind === "purchase_order" && may.order) ||
    (info.kind === "bill" && may.bill) ||
    ((info.kind === "vendor_payment" || info.kind === "vendor_credit" || info.kind === "customer_payment") && may.pay) ||
    (["expense", "journal", "transfer_fund", "deposit", "credit_note"].includes(info.kind) && mayLedger)
        ? `/books/${info.path}/new`
        : null;
  const sort = params.get("sort") ?? "date";
  const dir = params.get("dir") ?? "desc";
  const search = params.toString() ? `?${params}` : "";
  const header = (
    <div className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-[#ebeaf2] px-5">
      <ViewMenu views={data?.views ?? [{ key: "all", count: 0 }]} view={data?.view ?? "all"} plural={info.plural} onPick={(key) => set({ view: key === "all" ? null : key, page: null })} />
      <div className="flex items-center gap-2">
        {newTo ? (
          <Link to={newTo} className="flex h-[32px] items-center gap-1 rounded-[5px] bg-[#408dfb] px-2.5 text-white hover:bg-[#2f7ef0]">
            <Plus size={15} aria-hidden="true" /> New
          </Link>
        ) : (
          <span title={NEW_HINT[info.kind] ?? "Not made here yet."} className="flex h-[32px] cursor-not-allowed items-center gap-1 rounded-[5px] bg-[#408dfb]/50 px-2.5 text-white">
            <Plus size={15} aria-hidden="true" /> New
          </span>
        )}
        <span className="flex size-[32px] items-center justify-center rounded-[5px] border border-[#d7d5e2] bg-[#f7f7fe] text-[#6c718a]" aria-hidden="true">
          <Ellipsis size={16} />
        </span>
      </div>
    </div>
  );
  if (id)
    return (
      <div className="flex h-full">
        <aside className="hidden w-[340px] shrink-0 flex-col border-r border-[#ebeaf2] lg:flex">
          {header}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {(data?.rows ?? []).map((row) => (
              <li key={row.id}>
                <Link
                  to={`/books/${info.path}/${row.id}${search}`}
                  className={`block border-b border-[#ebeaf2] px-4 py-2.5 hover:bg-[#f1f1fa] ${String(row.id) === id ? "bg-[#f1f1fa]" : ""}`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium text-[#212529]">{row.party ?? cardName(row)}</span>
                    <span className="shrink-0">{info.kind === "purchase_receive" ? `${zQty(row.qty)} qty` : zMoney(row.total, row.currency)}</span>
                  </div>
                  <div className="text-[12px] text-[#6c718a]">
                    {row.number} • {zDate(row.date)}
                  </div>
                  <div className="text-[12px]">{status(row)}</div>
                </Link>
              </li>
            ))}
          </ul>
          {data && <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={(page) => set({ page: String(page) })} onPer={(per) => set({ perPage: String(per), page: null })} />}
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto">
          <DocView info={info} id={Number(id)} onClose={() => navigate(`/books/${info.path}${search}`)} />
        </section>
      </div>
    );
  if (info.kind === "package" && params.get("as") !== "list")
    return (
      <div className="flex h-full flex-col">
        {header}
        <PackagesBoard search={search} onList={() => set({ as: "list" })} />
      </div>
    );
  return (
    <div className="flex h-full flex-col">
      {header}
      {info.kind === "bill" && <Payables />}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-[#ebeaf2]">
              <th className="w-10 py-3 pl-4 text-left">
                <SlidersHorizontal size={14} className="text-[#408dfb]" aria-hidden="true" />
              </th>
              <th className="w-8 py-3">
                <input type="checkbox" aria-label="Pick every row" className="size-[15px] rounded border-[#c4c6d4] align-middle" checked={picked.size > 0 && picked.size === (data?.rows.length ?? 0)} onChange={(event) => setPicked(event.target.checked ? new Set((data?.rows ?? []).map((r) => r.id)) : new Set())} />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-2 py-3 text-[11px] font-normal tracking-normal whitespace-nowrap text-[#6c718a] uppercase ${column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left"}`}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      onClick={() => set({ sort: column.sort ?? null, dir: sort === column.sort && dir === "desc" ? "asc" : "desc", page: null })}
                      className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                    >
                      {column.label}
                      {sort === column.sort && (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id} onClick={() => navigate(`/books/${info.path}/${row.id}${search}`)} className="cursor-pointer border-b border-[#ebeaf2] hover:bg-[#f9f9fb]">
                <td className="py-2.5 pl-4" />
                <td className="py-2.5" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Pick ${row.number}`}
                    className="size-[15px] rounded border-[#c4c6d4] align-middle"
                    checked={picked.has(row.id)}
                    onChange={() => {
                      const next = new Set(picked);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      setPicked(next);
                    }}
                  />
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-2 py-2.5 align-top ${column.align === "right" ? "text-right whitespace-nowrap" : column.align === "center" ? "text-center" : NOWRAP.has(column.key) ? "whitespace-nowrap" : column.key === "party" ? "max-w-[220px]" : "max-w-[180px] break-words"}`}
                  >
                    {column.cell(row, data?.today ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.rows.length && <p className="px-6 py-10 text-center text-[#6c718a]">Nothing in this view.</p>}
        {query.isError && <p className="px-6 py-10 text-center text-[#f76831]">{query.error.message}</p>}
      </div>
      {data && <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={(page) => set({ page: String(page) })} onPer={(per) => set({ perPage: String(per), page: null })} />}
    </div>
  );
}

/** Bills' band: what is owed to vendors, due today, due within 30 days, overdue (Zoho's). */
function Payables() {
  const [hidden, setHidden] = useState(false);
  const query = useQuery({ queryKey: ["books", "payables"], queryFn: () => api<{ total: number; dueToday: number; due30: number; overdue: number }>("/api/books/bill/payables") });
  const p = query.data;
  if (!p) return null;
  if (hidden)
    return (
      <button type="button" onClick={() => setHidden(false)} className="mx-5 mt-2 self-end text-[12px] text-[#1c5bd9]">
        Show payables
      </button>
    );
  return (
    <div className="relative mx-5 my-3 flex flex-wrap items-center gap-8 rounded-lg bg-[#f7f7fe] px-5 py-4">
      <button type="button" onClick={() => setHidden(true)} className="absolute top-2 right-3 text-[12px] text-[#212529]">
        ^ Hide
      </button>
      <span className="flex size-11 items-center justify-center rounded-full bg-[#f5c88a] text-[#9a5b12]" aria-hidden="true">
        <ArrowUpRight size={20} />
      </span>
      <div className="-ml-4">
        <div className="text-[#6c718a]">Total Outstanding Payables</div>
        <div className="text-[15px] font-semibold">{zMoney(p.total)}</div>
      </div>
      <div className="border-l border-[#ebeaf2] pl-6">
        <div className="text-[#6c718a]">Due Today</div>
        <div className="text-[15px] text-[#f7a524]">{zMoney(p.dueToday)}</div>
      </div>
      <div className="border-l border-[#ebeaf2] pl-6">
        <div className="text-[#6c718a]">Due Within 30 Days</div>
        <div className="text-[15px]">{zMoney(p.due30)}</div>
      </div>
      <div className="border-l border-[#ebeaf2] pl-6">
        <div className="text-[#6c718a]">OverDue Bills</div>
        <div className="text-[15px]">{zMoney(p.overdue)}</div>
      </div>
    </div>
  );
}

/** Packages as Zoho shows them: three columns — Not Shipped, Shipped, Delivered — of cards. */
function PackagesBoard({ search, onList }: { search: string; onList: () => void }) {
  const columns: [string, string, string][] = [
    ["not_shipped", "Packages, Not Shipped", "bg-[#d9f0fa]"],
    ["shipped", "Shipped Packages", "bg-[#fbf3c8]"],
    ["delivered", "Delivered Packages", "bg-[#d8f2c9]"],
  ];
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={onList} className="text-[12px] text-[#1c5bd9]">
          Show as a list
        </button>
      </div>
      <div className="grid min-w-[900px] grid-cols-3 gap-5">
        {columns.map(([key, title, tone]) => (
          <BoardColumn key={key} view={key} title={title} tone={tone} search={search} />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({ view, title, tone, search }: { view: string; title: string; tone: string; search: string }) {
  const [per, setPer] = useState(25);
  const query = useQuery({ queryKey: ["books", "package", "board", view, per], queryFn: () => api<BookList>(`/api/books/package?view=${view}&perPage=${per}`), placeholderData: keepPreviousData });
  const data = query.data;
  return (
    <div className="min-w-0">
      <div className={`mb-3 flex items-center justify-between px-4 py-2.5 font-medium ${tone}`} style={{ clipPath: "polygon(0 0, 96% 0, 100% 50%, 96% 100%, 0 100%)" }}>
        {title} <span className="pr-4 text-[12px] font-normal opacity-70">{data?.total ?? ""}</span>
      </div>
      <ul className="space-y-3">
        {(data?.rows ?? []).map((row) => (
          <li key={row.id}>
            <Link to={`/books/packages/${row.id}${search}`} className="block rounded border border-[#ebeaf2] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#408dfb]">
              <div className="flex justify-between gap-2">
                <span className="truncate">{row.party ?? ""}</span>
                <span className="shrink-0">{zQty(Number(row.extra?.qty ?? 0))}</span>
              </div>
              <div className="text-[12px]">
                <span className="text-[#1c5bd9]">{row.number}</span> <span className="text-[#6c718a]">| {String(row.extra?.so ?? row.reference ?? "")}</span>
              </div>
              <div className="text-[12px] text-[#6c718a]">
                {row.extra?.carrier ? `${String(row.extra.carrier)} | ` : ""}
                {zDate(row.date)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {data && data.rows.length < data.total && (
        <button type="button" onClick={() => setPer(Math.min(200, per + 50))} className="mt-3 w-full rounded bg-[#f1f1fa] py-1.5 text-[12px] text-[#1c5bd9]">
          Show more
        </button>
      )}
    </div>
  );
}
