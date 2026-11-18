// The books' forms, drawn as Zoho Inventory draws its own (docs/PLAN.md 17): "New Purchase Order"
// with ✕, a label column on the left (red when it must be filled), 34px fields, the item table
// (ITEM DETAILS, ACCOUNT, QUANTITY, RATE, TAX, AMOUNT, + Add New Row), Sub Total and Total on the
// right, Terms & Conditions, and the buttons in a bar along the bottom. Receive, Convert to Bill,
// a bill on its own, Record Payment, a vendor credit, putting credits on bills, and a new vendor.

import type { BookChoices, BookDoc, BookList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { useAction } from "../ui";
import { zDate, zMoney, zQty } from "./kinds";

export const BOOK_ROLES = {
  order: ["inventory", "admin"],
  bill: ["inventory", "finance", "admin"],
  pay: ["finance", "admin"],
} as const;
export function useMay() {
  const role = useMe().data?.role ?? "";
  return {
    order: (BOOK_ROLES.order as readonly string[]).includes(role),
    bill: (BOOK_ROLES.bill as readonly string[]).includes(role),
    pay: (BOOK_ROLES.pay as readonly string[]).includes(role),
  };
}

export const useChoices = () => useQuery({ queryKey: ["books", "choices"], queryFn: () => api<BookChoices>("/api/books-choices"), staleTime: 60_000 });

export const ZIN = "h-[34px] w-full rounded-md border border-[#d7d5e2] bg-white px-2.5 text-[13px] outline-none focus:border-[#408dfb] disabled:bg-[#f7f7fe]";
const ZBTN = "h-[32px] rounded-[5px] px-3 text-[13px]";

export function ZPage({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#ebeaf2] px-5">
        <h1 className="flex items-center gap-2 text-[20px] font-medium text-[#212529]">
          <ShoppingBag size={20} aria-hidden="true" /> {title}
        </h1>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[#6c718a] hover:bg-[#f1f1fa]">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[#ebeaf2] bg-white px-5 py-3 shadow-[0_-2px_6px_rgba(0,0,0,0.04)]">{footer}</div>
    </div>
  );
}

export function ZRow({ label, required, children, error, wide }: { label: string; required?: boolean; children: ReactNode; error?: string; wide?: boolean }) {
  return (
    <div className="grid grid-cols-1 items-start gap-1 py-2 sm:grid-cols-[180px_1fr] sm:gap-4">
      <label className={`pt-1.5 ${required ? "text-[#d6141d]" : "text-[#212529]"}`}>
        {label}
        {required ? "*" : ""}
      </label>
      <div className={wide ? "max-w-[760px]" : "max-w-[380px]"}>
        {children}
        {error && <div className="mt-1 text-[12px] text-[#d6141d]">{error}</div>}
      </div>
    </div>
  );
}

export const Primary = ({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) => (
  <button type="button" disabled={disabled} onClick={onClick} className={`${ZBTN} bg-[#408dfb] text-white hover:bg-[#2f7ef0] disabled:opacity-50`}>
    {children}
  </button>
);
export const Plain = ({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) => (
  <button type="button" disabled={disabled} onClick={onClick} className={`${ZBTN} border border-[#d7d5e2] bg-[#f7f7fe] text-[#212529] hover:bg-white disabled:opacity-50`}>
    {children}
  </button>
);
const Problem = ({ message }: { message?: string | null }) => (message ? <div className="mx-5 mt-3 rounded-md border border-[#f5c2c0] bg-[#fdf2f2] px-3 py-2 text-[#b91c1c]">{message}</div> : null);

/** A vendor picked by typing its name (Zoho's searchable "Select a Vendor"). */
function VendorPick({ choices, value, onChange }: { choices: BookChoices; value: number | null; onChange: (id: number | null) => void }) {
  const current = choices.vendors.find((v) => v.id === value);
  const [text, setText] = useState(current?.name ?? "");
  return (
    <>
      <input
        className={ZIN}
        list="book-vendors"
        placeholder="Select a Vendor"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const found = choices.vendors.find((v) => v.name.toLowerCase() === event.target.value.trim().toLowerCase());
          onChange(found?.id ?? null);
        }}
      />
      <datalist id="book-vendors">
        {choices.vendors.map((v) => (
          <option key={v.id} value={v.name} />
        ))}
      </datalist>
    </>
  );
}

// ------------------------------------------------------------------ the item table

export type ItemRow = { medicineId: number | null; itemName: string; account: string; description: string; qty: string; rate: string; taxPct: string };
const emptyRow = (): ItemRow => ({ medicineId: null, itemName: "", account: "", description: "", qty: "1.00", rate: "0.00", taxPct: "" });
const rowAmount = (row: ItemRow) => Math.round((Number(row.qty) || 0) * (Number(row.rate) || 0) * 100);
const rowTax = (row: ItemRow) => Math.round((rowAmount(row) * (Number(row.taxPct) || 0)) / 100);
const toLines = (rows: ItemRow[]) =>
  rows
    .filter((row) => row.medicineId || row.itemName.trim() || row.account.trim())
    .map((row) => ({
      medicineId: row.medicineId,
      itemName: row.medicineId ? null : row.itemName.trim() || null,
      account: row.account.trim() || null,
      description: row.description.trim() || null,
      qty: Number(row.qty) || 0,
      rate: Number(row.rate) || 0,
      taxPct: row.taxPct ? Number(row.taxPct) : null,
    }));

function ItemTable({ rows, setRows, choices, currency }: { rows: ItemRow[]; setRows: (rows: ItemRow[]) => void; choices: BookChoices; currency: string }) {
  const set = (at: number, change: Partial<ItemRow>) => setRows(rows.map((row, i) => (i === at ? { ...row, ...change } : row)));
  const subTotal = rows.reduce((sum, row) => sum + rowAmount(row), 0);
  const tax = rows.reduce((sum, row) => sum + rowTax(row), 0);
  return (
    <div className="px-5 py-4">
      <div className="mb-2 font-medium">Item Table</div>
      <datalist id="book-items">
        {choices.medicines.map((m) => (
          <option key={m.id} value={m.name}>
            {m.sku ?? ""}
          </option>
        ))}
      </datalist>
      <datalist id="book-accounts">
        {choices.accounts.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border border-[#ebeaf2]">
          <thead>
            <tr className="border-b border-[#ebeaf2] bg-[#f9f9fb] text-left text-[11px] text-[#6c718a] uppercase">
              <th className="px-3 py-2 font-normal">Item Details</th>
              <th className="w-48 px-2 py-2 font-normal">Account</th>
              <th className="w-24 px-2 py-2 text-right font-normal">Quantity</th>
              <th className="w-28 px-2 py-2 text-right font-normal">Rate</th>
              <th className="w-20 px-2 py-2 text-right font-normal">Tax %</th>
              <th className="w-32 px-2 py-2 text-right font-normal">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, at) => (
              <tr key={at} className="border-b border-[#ebeaf2] align-top">
                <td className="px-3 py-2">
                  <input
                    className={ZIN}
                    list="book-items"
                    placeholder="Type or click to select an item."
                    value={row.itemName}
                    onChange={(event) => {
                      const found = choices.medicines.find((m) => m.name.toLowerCase() === event.target.value.trim().toLowerCase());
                      set(at, { itemName: event.target.value, medicineId: found?.id ?? null });
                    }}
                  />
                  <textarea
                    className="mt-1 w-full resize-y rounded-md border border-transparent px-2.5 py-1 text-[12px] text-[#4b4f63] outline-none hover:border-[#d7d5e2] focus:border-[#408dfb]"
                    rows={1}
                    placeholder="Add a description"
                    value={row.description}
                    onChange={(event) => set(at, { description: event.target.value })}
                  />
                  {row.itemName && !row.medicineId && <div className="text-[11px] text-[#6c718a]">Not a medicine on the list: no stock moves for it.</div>}
                </td>
                <td className="px-2 py-2">
                  <input className={ZIN} list="book-accounts" placeholder="Select an account" value={row.account} onChange={(event) => set(at, { account: event.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <input className={`${ZIN} text-right`} inputMode="decimal" value={row.qty} onChange={(event) => set(at, { qty: event.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <input className={`${ZIN} text-right`} inputMode="decimal" value={row.rate} onChange={(event) => set(at, { rate: event.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <input className={`${ZIN} text-right`} inputMode="decimal" placeholder="0" value={row.taxPct} onChange={(event) => set(at, { taxPct: event.target.value })} />
                </td>
                <td className="px-2 py-3 text-right">{zMoney(rowAmount(row), "")}</td>
                <td className="py-2">
                  {rows.length > 1 && (
                    <button type="button" aria-label="Remove this row" onClick={() => setRows(rows.filter((_, i) => i !== at))} className="p-1.5 text-[#d6141d]">
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <button type="button" onClick={() => setRows([...rows, emptyRow()])} className="flex items-center gap-1 rounded-md bg-[#f1f1fa] px-3 py-1.5 text-[#1c5bd9]">
          <Plus size={14} /> Add New Row
        </button>
        <div className="w-full max-w-sm rounded-md bg-[#f9f9fb] p-4">
          <div className="flex justify-between py-1">
            <span>Sub Total</span>
            <span>{zMoney(subTotal, "")}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between py-1">
              <span>Tax</span>
              <span>{zMoney(tax, "")}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-[#ebeaf2] pt-2 text-[15px] font-semibold">
            <span>Total ( {currency} )</span>
            <span>{zMoney(subTotal + tax, "")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const Grey = ({ children }: { children: ReactNode }) => <div className="border-t border-[#ebeaf2] bg-[#fbfbfe] px-5 py-3">{children}</div>;

// ------------------------------------------------------------------ New Purchase Order

export function NewPurchaseOrderPage() {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choicesQuery = useChoices();
  const choices = choicesQuery.data;
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [form, setForm] = useState({ reference: "", date: "", deliveryDate: "", paymentTerms: "", warehouseId: "", fxRate: "", notes: "", terms: "" });
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  if (!choices) return <p className="p-6 text-[#6c718a]">Loading…</p>;
  const vendor = choices.vendors.find((v) => v.id === vendorId);
  const currency = vendor?.currency ?? "PHP";
  const warehouseId = form.warehouseId || String(choices.warehouses[0]?.id ?? "");
  const save = (issue: boolean) =>
    void action.run(async () => {
      const made = await api<{ id: number }>("/api/books/purchase_order/new", {
        body: {
          supplierId: vendorId ?? 0,
          reference: form.reference || null,
          date: form.date || choices.today,
          deliveryDate: form.deliveryDate || null,
          paymentTerms: form.paymentTerms || vendor?.paymentTerms || null,
          warehouseId: Number(warehouseId),
          fxRate: form.fxRate ? Number(form.fxRate) : null,
          notes: form.notes || null,
          terms: form.terms || null,
          issue,
          lines: toLines(rows),
        },
      });
      await queries.invalidateQueries({ queryKey: ["books"] });
      navigate(`/books/purchaseorders/${made.id}`);
    });
  return (
    <ZPage
      title="New Purchase Order"
      onClose={() => navigate("/books/purchaseorders")}
      footer={
        <>
          <Plain disabled={action.busy} onClick={() => save(false)}>
            Save as Draft
          </Plain>
          <Primary disabled={action.busy} onClick={() => save(true)}>
            Save and Issue
          </Primary>
          <Plain onClick={() => navigate("/books/purchaseorders")}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="bg-[#fbfbfe] px-5 py-3">
        <ZRow label="Vendor Name" required error={action.at("supplierId")}>
          <VendorPick choices={choices} value={vendorId} onChange={setVendorId} />
          {vendor && vendor.currency !== "PHP" && <div className="mt-1 text-[12px] text-[#6c718a]">This vendor bills in {vendor.currency}.</div>}
        </ZRow>
      </div>
      <div className="px-5 py-3">
        <ZRow label="Delivery Address" required error={action.at("warehouseId")}>
          <div className="mb-1 text-[12px] text-[#6c718a]">Warehouse</div>
          <select className={ZIN} value={warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}>
            {choices.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </ZRow>
        <ZRow label="Purchase Order#" required>
          <input className={ZIN} disabled value={choices.next.purchaseOrder} />
        </ZRow>
        <ZRow label="Reference#">
          <input className={ZIN} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </ZRow>
        <ZRow label="Date" error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </ZRow>
        <ZRow label="Delivery Date" error={action.at("deliveryDate")}>
          <input type="date" className={ZIN} value={form.deliveryDate} onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })} />
        </ZRow>
        <ZRow label="Payment Terms">
          <input className={ZIN} placeholder={vendor?.paymentTerms ?? "net"} value={form.paymentTerms} onChange={(event) => setForm({ ...form, paymentTerms: event.target.value })} />
        </ZRow>
        {currency !== "PHP" && (
          <ZRow label={`Exchange Rate (1 ${currency})`} required error={action.at("fxRate")}>
            <input className={ZIN} inputMode="decimal" placeholder="PHP" value={form.fxRate} onChange={(event) => setForm({ ...form, fxRate: event.target.value })} />
          </ZRow>
        )}
      </div>
      <Grey>
        <span className="text-[#6c718a]">Prices are {currency}, tax added on top of the rate.</span>
      </Grey>
      <ItemTable rows={rows} setRows={setRows} choices={choices} currency={currency} />
      <div className="grid gap-4 px-5 pb-6 md:grid-cols-2">
        <label className="block">
          <span className="text-[#212529]">Notes</span>
          <textarea className={`${ZIN} mt-1 h-20 py-2`} placeholder="Will be displayed on purchase order" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <label className="block">
          <span className="text-[#212529]">Terms &amp; Conditions</span>
          <textarea className={`${ZIN} mt-1 h-20 py-2`} placeholder="Enter the terms and conditions of your business to be displayed in your transaction" value={form.terms} onChange={(event) => setForm({ ...form, terms: event.target.value })} />
        </label>
      </div>
    </ZPage>
  );
}

// ------------------------------------------------------------------ Receive

const useDoc = (kind: string, id: number) => useQuery({ queryKey: ["books", kind, "doc", id], queryFn: () => api<BookDoc>(`/api/books/${kind}/${id}`) });

export function ReceivePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choices = useChoices().data;
  const order = useDoc("purchase_order", id).data;
  const [date, setDate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<Record<number, { qty: string; batchNo: string; expiresOn: string }>>({});
  if (!order || !choices) return <p className="p-6 text-[#6c718a]">Loading…</p>;
  const left = (line: BookDoc["lines"][number]) => (line.qty ?? 0) - (line.qtyDone.cancelled ?? 0) - (line.qtyDone.received ?? 0);
  const entry = (lineId: number) => entries[lineId] ?? { qty: "", batchNo: "", expiresOn: "" };
  const close = () => navigate(`/books/purchaseorders/${id}`);
  return (
    <ZPage
      title={`New Purchase Receive · ${order.number}`}
      onClose={close}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>(`/api/books/purchase_order/${id}/receive`, {
                  body: {
                    date: date || choices.today,
                    notes: notes || null,
                    warehouseId: warehouseId ? Number(warehouseId) : null,
                    lines: order.lines.map((line) => ({ lineId: line.id, qty: Number(entry(line.id).qty) || 0, batchNo: entry(line.id).batchNo || null, expiresOn: entry(line.id).expiresOn || null })),
                  },
                });
                await queries.invalidateQueries({ queryKey: ["books"] });
                navigate(`/books/purchasereceives/${made.id}`);
              })
            }
          >
            Save as Received
          </Primary>
          <Plain onClick={close}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="px-5 py-3">
        <ZRow label="Vendor Name">
          <input className={ZIN} disabled value={order.party ?? ""} />
        </ZRow>
        <ZRow label="Purchase Order#">
          <input className={ZIN} disabled value={order.number} />
        </ZRow>
        <ZRow label="Purchase Receive#" required>
          <input className={ZIN} disabled value={choices.next.receive} />
        </ZRow>
        <ZRow label="Received Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={date || choices.today} onChange={(event) => setDate(event.target.value)} />
        </ZRow>
        {!order.fields["Warehouse Name"] && (
          <ZRow label="Warehouse" required error={action.at("warehouseId")}>
            <select className={ZIN} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
              <option value="">Pick</option>
              {choices.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </ZRow>
        )}
      </div>
      <div className="px-5 pb-4">
        <table className="w-full border border-[#ebeaf2]">
          <thead>
            <tr className="border-b border-[#ebeaf2] bg-[#f9f9fb] text-left text-[11px] text-[#6c718a] uppercase">
              <th className="px-3 py-2 font-normal">Items &amp; Description</th>
              <th className="px-2 py-2 text-right font-normal">Ordered</th>
              <th className="px-2 py-2 text-right font-normal">Received</th>
              <th className="px-2 py-2 text-right font-normal">In Transit</th>
              <th className="w-28 px-2 py-2 text-right font-normal">Quantity to Receive</th>
              <th className="w-36 px-2 py-2 font-normal">Batch#</th>
              <th className="w-40 px-2 py-2 font-normal">Expiry Date</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, at) => (
              <tr key={line.id} className="border-b border-[#ebeaf2] align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{line.itemName ?? line.account}</div>
                  {line.sku && <div className="text-[11.5px] text-[#6c718a]">SKU: {line.sku}</div>}
                  {!line.medicineId && <div className="text-[11px] text-[#6c718a]">Not a medicine on the list: no stock moves</div>}
                </td>
                <td className="px-2 py-2 text-right">{zQty(line.qty)}</td>
                <td className="px-2 py-2 text-right">{zQty(line.qtyDone.received ?? 0)}</td>
                <td className="px-2 py-2 text-right">0.00</td>
                <td className="px-2 py-2">
                  <input
                    className={`${ZIN} text-right`}
                    inputMode="decimal"
                    placeholder={zQty(Math.max(0, left(line)))}
                    value={entry(line.id).qty}
                    disabled={left(line) <= 0}
                    onChange={(event) => setEntries({ ...entries, [line.id]: { ...entry(line.id), qty: event.target.value } })}
                  />
                  {action.at(`lines.${at}.qty`) && <div className="text-[11px] text-[#d6141d]">{action.at(`lines.${at}.qty`)}</div>}
                </td>
                <td className="px-2 py-2">
                  {line.medicineId && (
                    <input className={ZIN} value={entry(line.id).batchNo} onChange={(event) => setEntries({ ...entries, [line.id]: { ...entry(line.id), batchNo: event.target.value } })} />
                  )}
                  {action.at(`lines.${at}.batchNo`) && <div className="text-[11px] text-[#d6141d]">{action.at(`lines.${at}.batchNo`)}</div>}
                </td>
                <td className="px-2 py-2">
                  {line.medicineId && (
                    <input type="date" className={ZIN} value={entry(line.id).expiresOn} onChange={(event) => setEntries({ ...entries, [line.id]: { ...entry(line.id), expiresOn: event.target.value } })} />
                  )}
                  {action.at(`lines.${at}.expiresOn`) && <div className="text-[11px] text-[#d6141d]">{action.at(`lines.${at}.expiresOn`)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="mt-4 block max-w-xl">
          <span>Notes (For Internal Use)</span>
          <textarea className={`${ZIN} mt-1 h-16 py-2`} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>
    </ZPage>
  );
}

// ------------------------------------------------------------------ Bills

export function BillFromOrderPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const receiveId = Number(params.get("receive")) || null;
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choices = useChoices().data;
  const order = useDoc("purchase_order", id).data;
  const receive = useQuery({ queryKey: ["books", "purchase_receive", "doc", receiveId], enabled: Boolean(receiveId), queryFn: () => api<BookDoc>(`/api/books/purchase_receive/${receiveId}`) }).data;
  const [form, setForm] = useState({ number: "", date: "", dueDate: "", notes: "" });
  const [entries, setEntries] = useState<Record<number, { qty: string; rate: string }>>({});
  if (!order || !choices || (receiveId && !receive)) return <p className="p-6 text-[#6c718a]">Loading…</p>;
  const left = (line: BookDoc["lines"][number]) => (line.qty ?? 0) - (line.qtyDone.cancelled ?? 0) - (line.qtyDone.billed ?? 0);
  // From a receive, what came in that receive; otherwise all that is still to be billed.
  const fromReceive = (line: BookDoc["lines"][number]) => receive?.lines.filter((r) => r.fromLine === line.id).reduce((sum, r) => sum + (r.qty ?? 0), 0) ?? null;
  const entry = (line: BookDoc["lines"][number]) =>
    entries[line.id] ?? { qty: String(Math.max(0, Math.min(left(line), fromReceive(line) ?? left(line)))), rate: String(line.rate ?? 0) };
  const total = order.lines.reduce((sum, line) => sum + Math.round((Number(entry(line).qty) || 0) * (Number(entry(line).rate) || 0) * 100) * (1 + (line.taxPct ?? 0) / 100), 0);
  const close = () => navigate(`/books/purchaseorders/${id}`);
  return (
    <ZPage
      title={`New Bill · ${order.number}`}
      onClose={close}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>(`/api/books/purchase_order/${id}/bill`, {
                  body: {
                    number: form.number,
                    date: form.date || choices.today,
                    dueDate: form.dueDate || null,
                    notes: form.notes || null,
                    receiveId,
                    orderLines: order.lines.map((line) => ({ lineId: line.id, qty: Number(entry(line).qty) || 0, rate: Number(entry(line).rate) || 0 })),
                  },
                });
                await queries.invalidateQueries({ queryKey: ["books"] });
                navigate(`/books/bills/${made.id}`);
              })
            }
          >
            Save as Open
          </Primary>
          <Plain onClick={close}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="px-5 py-3">
        <ZRow label="Vendor Name">
          <input className={ZIN} disabled value={order.party ?? ""} />
        </ZRow>
        <ZRow label="Bill#" required error={action.at("number")}>
          <input className={ZIN} placeholder="The number on the vendor's invoice" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} />
        </ZRow>
        <ZRow label="Order Number">
          <input className={ZIN} disabled value={order.number} />
        </ZRow>
        <ZRow label="Bill Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </ZRow>
        <ZRow label="Due Date" error={action.at("dueDate")}>
          <input type="date" className={ZIN} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
        </ZRow>
      </div>
      <div className="px-5 pb-4">
        <table className="w-full border border-[#ebeaf2]">
          <thead>
            <tr className="border-b border-[#ebeaf2] bg-[#f9f9fb] text-left text-[11px] text-[#6c718a] uppercase">
              <th className="px-3 py-2 font-normal">Item Details</th>
              <th className="px-2 py-2 text-right font-normal">To Be Billed</th>
              <th className="w-28 px-2 py-2 text-right font-normal">Quantity</th>
              <th className="w-28 px-2 py-2 text-right font-normal">Rate</th>
              <th className="w-32 px-2 py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, at) => (
              <tr key={line.id} className="border-b border-[#ebeaf2]">
                <td className="px-3 py-2">
                  <div className="font-medium">{line.itemName ?? line.account}</div>
                  {line.account && <div className="text-[11.5px] text-[#6c718a]">{line.account}</div>}
                </td>
                <td className="px-2 py-2 text-right">{zQty(Math.max(0, left(line)))}</td>
                <td className="px-2 py-2">
                  <input className={`${ZIN} text-right`} disabled={left(line) <= 0} value={entry(line).qty} onChange={(event) => setEntries({ ...entries, [line.id]: { ...entry(line), qty: event.target.value } })} />
                  {action.at(`orderLines.${at}.qty`) && <div className="text-[11px] text-[#d6141d]">{action.at(`orderLines.${at}.qty`)}</div>}
                </td>
                <td className="px-2 py-2">
                  <input className={`${ZIN} text-right`} disabled={left(line) <= 0} value={entry(line).rate} onChange={(event) => setEntries({ ...entries, [line.id]: { ...entry(line), rate: event.target.value } })} />
                </td>
                <td className="px-2 py-2 text-right">{zMoney(Math.round((Number(entry(line).qty) || 0) * (Number(entry(line).rate) || 0) * 100), "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 ml-auto max-w-sm rounded-md bg-[#f9f9fb] p-4 text-[15px] font-semibold">
          <div className="flex justify-between">
            <span>Total ( {order.currency} )</span>
            <span>{zMoney(Math.round(total), "")}</span>
          </div>
        </div>
      </div>
    </ZPage>
  );
}

/** A bill on its own (rent, a utility, freight) or a vendor credit: vendor, number, dates, items. */
function StandalonePage({ kind }: { kind: "bill" | "vendor_credit" }) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choices = useChoices().data;
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [form, setForm] = useState({ number: "", reference: "", date: "", dueDate: "", paymentTerms: "", fxRate: "", notes: "" });
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);
  const [landedOn, setLandedOn] = useState("");
  const bill = kind === "bill";
  const list = bill ? "bills" : "vendorcredits";
  if (!choices) return <p className="p-6 text-[#6c718a]">Loading…</p>;
  const vendor = choices.vendors.find((v) => v.id === vendorId);
  const currency = vendor?.currency ?? "PHP";
  return (
    <ZPage
      title={bill ? "New Bill" : "New Vendor Credits"}
      onClose={() => navigate(`/books/${list}`)}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>(`/api/books/${kind}/new`, {
                  body: {
                    supplierId: vendorId ?? 0,
                    ...(bill ? { number: form.number, dueDate: form.dueDate || null, paymentTerms: form.paymentTerms || null } : {}),
                    reference: form.reference || null,
                    date: form.date || choices.today,
                    fxRate: form.fxRate ? Number(form.fxRate) : null,
                    notes: form.notes || null,
                    lines: toLines(rows),
                    ...(bill && landedOn ? { landedOn: Number(landedOn) } : {}),
                  },
                });
                await queries.invalidateQueries({ queryKey: ["books"] });
                await queries.invalidateQueries({ queryKey: ["inventory"] });
                navigate(`/books/${list}/${made.id}`);
              })
            }
          >
            {bill ? "Save as Open" : "Save as Open"}
          </Primary>
          <Plain onClick={() => navigate(`/books/${list}`)}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="bg-[#fbfbfe] px-5 py-3">
        <ZRow label="Vendor Name" required error={action.at("supplierId")}>
          <VendorPick choices={choices} value={vendorId} onChange={setVendorId} />
        </ZRow>
      </div>
      <div className="px-5 py-3">
        {bill ? (
          <ZRow label="Bill#" required error={action.at("number")}>
            <input className={ZIN} value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} />
          </ZRow>
        ) : (
          <ZRow label="Credit Note#" required>
            <input className={ZIN} disabled value={choices.next.vendorCredit} />
          </ZRow>
        )}
        <ZRow label={bill ? "Order Number" : "Order Number / Reference"}>
          <input className={ZIN} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </ZRow>
        <ZRow label={bill ? "Bill Date" : "Vendor Credit Date"} required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </ZRow>
        {bill && (
          <>
            <ZRow label="Due Date" error={action.at("dueDate")}>
              <input type="date" className={ZIN} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
            </ZRow>
            <ZRow label="Payment Terms">
              <input className={ZIN} placeholder={vendor?.paymentTerms ?? "Due on Receipt"} value={form.paymentTerms} onChange={(event) => setForm({ ...form, paymentTerms: event.target.value })} />
            </ZRow>
          </>
        )}
        {currency !== "PHP" && (
          <ZRow label={`Exchange Rate (1 ${currency})`} required error={action.at("fxRate")}>
            <input className={ZIN} inputMode="decimal" value={form.fxRate} onChange={(event) => setForm({ ...form, fxRate: event.target.value })} />
          </ZRow>
        )}
        {bill && (
          <ZRow label="Landed cost" error={action.at("landedOn")}>
            <select className={ZIN} value={landedOn} onChange={(event) => setLandedOn(event.target.value)}>
              <option value="">No: a bill of its own (rent, a utility, a service)</option>
              {choices.receivedOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  Part of the goods' cost on {order.number} · {order.party} · {order.date}
                </option>
              ))}
            </select>
            {landedOn && (
              <div className="mt-1 text-[12px] text-[#6c718a]">
                Freight, customs, insurance or packaging for that order: it is shared over its goods by value and each
                piece still on the shelf costs more. The bill is kept in Inventory Asset and reaches Cost of Goods Sold as they sell.
              </div>
            )}
          </ZRow>
        )}
      </div>
      <ItemTable rows={rows} setRows={setRows} choices={choices} currency={currency} />
      <div className="px-5 pb-6">
        <label className="block max-w-xl">
          <span>Notes</span>
          <textarea className={`${ZIN} mt-1 h-20 py-2`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </div>
    </ZPage>
  );
}
export const NewBillPage = () => <StandalonePage kind="bill" />;
export const NewVendorCreditPage = () => <StandalonePage kind="vendor_credit" />;

// ------------------------------------------------------------------ Payments Made

/** The vendor's bills with money owed, oldest first. */
function useOpenBills(partyId: number | null, kind: "bill" | "invoice" = "bill") {
  return useQuery({
    queryKey: ["books", kind, "open", partyId],
    enabled: Boolean(partyId),
    queryFn: async () => {
      const list = await api<BookList>(`/api/books/${kind}?party=${partyId}&perPage=200&sort=date&dir=asc`);
      // The CRM's own invoices (ids below zero) take payments on the order line.
      return list.rows.filter((row) => row.id > 0 && row.balance > 0 && !["void", "draft", "pending_approval"].includes(row.status));
    },
  });
}

function BillsTable({ bills, amounts, setAmounts, error, sales }: { bills: BookList["rows"]; amounts: Record<number, string>; setAmounts: (next: Record<number, string>) => void; error?: (at: number) => string | undefined; sales?: boolean }) {
  return (
    <table className="w-full border border-[#ebeaf2]">
      <thead>
        <tr className="border-b border-[#ebeaf2] bg-[#f9f9fb] text-left text-[11px] text-[#6c718a] uppercase">
          <th className="px-3 py-2 font-normal">Date</th>
          <th className="px-2 py-2 font-normal">{sales ? "Invoice Number" : "Bill#"}</th>
          <th className="px-2 py-2 font-normal">{sales ? "Order Number" : "PO#"}</th>
          <th className="px-2 py-2 text-right font-normal">{sales ? "Invoice Amount" : "Bill Amount"}</th>
          <th className="px-2 py-2 text-right font-normal">Amount Due</th>
          <th className="w-40 px-3 py-2 text-right font-normal">Payment</th>
        </tr>
      </thead>
      <tbody>
        {bills.map((bill, at) => (
          <tr key={bill.id} className="border-b border-[#ebeaf2]">
            <td className="px-3 py-2">
              {zDate(bill.date)}
              {bill.dueDate && <div className="text-[11px] text-[#6c718a]">Due {zDate(bill.dueDate)}</div>}
            </td>
            <td className="px-2 py-2">{bill.number}</td>
            <td className="px-2 py-2">{(sales ? bill.linked : bill.reference) ?? ""}</td>
            <td className="px-2 py-2 text-right">{zMoney(bill.total, bill.currency)}</td>
            <td className="px-2 py-2 text-right">{zMoney(bill.balance, "")}</td>
            <td className="px-3 py-2">
              <input className={`${ZIN} text-right`} inputMode="decimal" value={amounts[bill.id] ?? ""} onChange={(event) => setAmounts({ ...amounts, [bill.id]: event.target.value })} />
              <button type="button" className="mt-0.5 text-[11.5px] text-[#1c5bd9]" onClick={() => setAmounts({ ...amounts, [bill.id]: (bill.balance / 100).toFixed(2) })}>
                Pay in Full
              </button>
              {error?.(at) && <div className="text-[11px] text-[#d6141d]">{error(at)}</div>}
            </td>
          </tr>
        ))}
        {!bills.length && (
          <tr>
            <td colSpan={6} className="px-3 py-6 text-center text-[#6c718a]">
              {sales ? "There are no unpaid invoices from Zoho for this customer." : "There are no bills for this vendor."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function NewPaymentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choices = useChoices().data;
  const [vendorId, setVendorId] = useState<number | null>(Number(params.get("vendor")) || null);
  const [form, setForm] = useState({ amount: "", date: "", mode: "", paidThrough: "", reference: "", notes: "" });
  const forBill = Number(params.get("bill")) || null;
  const bills = useOpenBills(vendorId).data ?? [];
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const picked = useMemo(() => {
    const out = { ...amounts };
    const bill = bills.find((b) => b.id === forBill);
    if (bill && out[bill.id] === undefined) out[bill.id] = (bill.balance / 100).toFixed(2);
    return out;
  }, [amounts, bills, forBill]);
  if (!choices) return <p className="p-6 text-[#6c718a]">Loading…</p>;
  const used = bills.reduce((sum, bill) => sum + Math.round((Number(picked[bill.id]) || 0) * 100), 0);
  const paid = form.amount ? Math.round(Number(form.amount) * 100) : used;
  return (
    <ZPage
      title="Bill Payment"
      onClose={() => navigate("/books/paymentsmade")}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const shown = bills.filter((bill) => Number(picked[bill.id]) > 0);
                const made = await api<{ id: number }>("/api/books/vendor_payment/new", {
                  body: {
                    supplierId: vendorId ?? 0,
                    date: form.date || choices.today,
                    amount: paid,
                    mode: form.mode || null,
                    paidThrough: form.paidThrough || null,
                    reference: form.reference || null,
                    notes: form.notes || null,
                    bills: shown.map((bill) => ({ billId: bill.id, amount: Math.round(Number(picked[bill.id]) * 100) })),
                  },
                });
                await queries.invalidateQueries({ queryKey: ["books"] });
                navigate(`/books/paymentsmade/${made.id}`);
              })
            }
          >
            Save as Paid
          </Primary>
          <Plain onClick={() => navigate("/books/paymentsmade")}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="bg-[#fbfbfe] px-5 py-3">
        <ZRow label="Vendor Name" required error={action.at("supplierId")}>
          <VendorPick choices={choices} value={vendorId} onChange={setVendorId} />
        </ZRow>
      </div>
      <div className="px-5 py-3">
        <ZRow label="Payment #" required>
          <input className={ZIN} disabled value={choices.next.payment} />
        </ZRow>
        <ZRow label="Payment Made" required error={action.at("amount")}>
          <input className={ZIN} inputMode="decimal" placeholder={(used / 100).toFixed(2)} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </ZRow>
        <ZRow label="Payment Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </ZRow>
        <ZRow label="Payment Mode">
          <input className={ZIN} list="book-modes" placeholder="Bank Transfer" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} />
          <datalist id="book-modes">
            {choices.modes.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </ZRow>
        <ZRow label="Paid Through">
          <input className={ZIN} list="book-paid-through" value={form.paidThrough} onChange={(event) => setForm({ ...form, paidThrough: event.target.value })} />
          <datalist id="book-paid-through">
            {choices.paidThrough.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </ZRow>
        <ZRow label="Reference#">
          <input className={ZIN} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </ZRow>
      </div>
      <div className="px-5 pb-4">
        <BillsTable bills={bills} amounts={picked} setAmounts={setAmounts} error={(at) => action.at(`bills.${at}.amount`)} />
        <div className="mt-3 ml-auto max-w-sm space-y-1 rounded-md bg-[#f9f9fb] p-4">
          <div className="flex justify-between">
            <span>Amount Paid:</span>
            <span>{zMoney(paid, "")}</span>
          </div>
          <div className="flex justify-between">
            <span>Amount used for Payments:</span>
            <span>{zMoney(used, "")}</span>
          </div>
          <div className="flex justify-between">
            <span>Amount in Excess:</span>
            <span>{zMoney(Math.max(0, paid - used), "")}</span>
          </div>
        </div>
        <label className="mt-4 block max-w-xl">
          <span>Notes (Internal use. Not visible to vendor)</span>
          <textarea className={`${ZIN} mt-1 h-16 py-2`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </div>
    </ZPage>
  );
}

/** "Apply to Bills": a vendor credit's or a payment's unused amount put on the vendor's bills. */
export function ApplyToBills({ doc, onDone }: { doc: BookDoc; onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const choices = useChoices().data;
  const sales = doc.kind === "credit_note" || doc.kind === "customer_payment";
  const bills = useOpenBills(sales ? doc.partyId : (doc.vendor?.id ?? null), sales ? "invoice" : "bill").data ?? [];
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const used = bills.reduce((sum, bill) => sum + Math.round((Number(amounts[bill.id]) || 0) * 100), 0);
  return (
    <div className="mx-auto max-w-[820px] rounded-md border border-[#408dfb] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Apply credits to {sales ? "invoices" : "bills"} · {zMoney(doc.unused ?? doc.balance, doc.currency)} available</span>
        <button type="button" aria-label="Close" onClick={onDone} className="text-[#6c718a]">
          <X size={16} />
        </button>
      </div>
      {action.problem && <div className="mb-2 text-[#b91c1c]">{action.problem.message}</div>}
      <BillsTable bills={bills} amounts={amounts} setAmounts={setAmounts} sales={sales} />
      <div className="mt-3 flex items-center justify-end gap-3">
        <span>Amount to credit: {zMoney(used, "")}</span>
        <Primary
          disabled={action.busy || !used}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/books/${doc.kind}/${doc.id}/apply`, {
                body: { date: choices?.today, bills: bills.filter((b) => Number(amounts[b.id]) > 0).map((b) => ({ billId: b.id, amount: Math.round(Number(amounts[b.id]) * 100) })) },
              });
              await queries.invalidateQueries({ queryKey: ["books"] });
              onDone();
            })
          }
        >
          Save
        </Primary>
      </div>
    </div>
  );
}

/** Void: the document stays, its money stops counting; the reason is kept. */
export function VoidBox({ doc, onDone }: { doc: BookDoc; onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [reason, setReason] = useState("");
  return (
    <div className="mx-auto max-w-[820px] rounded-md border border-[#f76831] p-4">
      <div className="mb-2 font-medium">
        Void {doc.number}? It stays in the books, marked void{doc.kind !== "bill" ? `; what it put on ${doc.kind === "customer_payment" || doc.kind === "credit_note" ? "invoices" : "bills"} goes back onto them` : ""}.
      </div>
      <input className={ZIN} placeholder="Why" value={reason} onChange={(event) => setReason(event.target.value)} />
      {action.problem && <div className="mt-2 text-[#b91c1c]">{action.problem.message}</div>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={action.busy || !reason.trim()}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/books/${doc.kind}/${doc.id}/void`, { body: { reason } });
              await queries.invalidateQueries({ queryKey: ["books"] });
              onDone();
            })
          }
          className={`${ZBTN} bg-[#f76831] text-white disabled:opacity-50`}
        >
          Void
        </button>
        <Plain onClick={onDone}>Cancel</Plain>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ New Vendor

export function NewVendorPage() {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", mobile: "", website: "", currency: "PHP", paymentTerms: "", tin: "", country: "", billingAddress: "", shippingAddress: "" });
  const text = (key: keyof typeof form, label: string, required?: boolean) => (
    <ZRow label={label} required={required} error={action.at(key)}>
      <input className={ZIN} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
    </ZRow>
  );
  return (
    <ZPage
      title="New Vendor"
      onClose={() => navigate("/books/vendors")}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>("/api/books/vendors", { body: Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null])) });
                await queries.invalidateQueries({ queryKey: ["books"] });
                navigate(`/books/vendors/${made.id}`);
              })
            }
          >
            Save
          </Primary>
          <Plain onClick={() => navigate("/books/vendors")}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="px-5 py-3">
        {text("name", "Vendor Display Name", true)}
        {text("company", "Company Name")}
        {text("email", "Vendor Email")}
        {text("phone", "Work Phone")}
        {text("mobile", "Mobile")}
        {text("website", "Website")}
        {text("currency", "Currency")}
        {text("paymentTerms", "Payment Terms")}
        {text("tin", "TIN")}
        {text("country", "Country")}
        <ZRow label="Billing Address">
          <textarea className={`${ZIN} h-16 py-2`} value={form.billingAddress} onChange={(event) => setForm({ ...form, billingAddress: event.target.value })} />
        </ZRow>
        <ZRow label="Shipping Address">
          <textarea className={`${ZIN} h-16 py-2`} value={form.shippingAddress} onChange={(event) => setForm({ ...form, shippingAddress: event.target.value })} />
        </ZRow>
      </div>
    </ZPage>
  );
}

// ------------------------------------------------------------------ Payments Received (on Zoho's invoices)

/** A customer found by typing (there are tens of thousands). */
function CustomerPick({ value, onChange }: { value: { id: number; name: string } | null; onChange: (customer: { id: number; name: string } | null) => void }) {
  const [text, setText] = useState(value?.name ?? "");
  const found = useQuery({
    queryKey: ["books", "customers", "pick", text],
    enabled: text.trim().length >= 2 && text !== value?.name,
    queryFn: () => api<{ rows: { id: number; name: string; kind: string; receivables: number }[] }>(`/api/books/customers?q=${encodeURIComponent(text.trim())}&perPage=10`),
  }).data;
  return (
    <div className="relative">
      <input
        className={ZIN}
        placeholder="Type the customer's name"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(null);
        }}
      />
      {found && text !== value?.name && found.rows.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[#ebeaf2] bg-white shadow-lg">
          {found.rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-[#408dfb] hover:text-white"
                onClick={() => {
                  setText(c.name);
                  onChange({ id: c.id, name: c.name });
                }}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 pl-2 text-[11px] opacity-70">{c.kind} · {zMoney(c.receivables)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewReceiptPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choices = useChoices().data;
  const forInvoice = Number(params.get("invoice")) || null;
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(params.get("customer") ? { id: Number(params.get("customer")), name: params.get("name") ?? "" } : null);
  const [form, setForm] = useState({ amount: "", date: "", mode: "", depositTo: "", reference: "", notes: "" });
  const invoices = useOpenBills(customer?.id ?? null, "invoice").data ?? [];
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const picked = useMemo(() => {
    const out = { ...amounts };
    const invoice = invoices.find((b) => b.id === forInvoice);
    if (invoice && out[invoice.id] === undefined) out[invoice.id] = (invoice.balance / 100).toFixed(2);
    return out;
  }, [amounts, invoices, forInvoice]);
  if (!choices) return <p className="p-6 text-[#6c718a]">Loading…</p>;
  const used = invoices.reduce((sum, bill) => sum + Math.round((Number(picked[bill.id]) || 0) * 100), 0);
  const paid = form.amount ? Math.round(Number(form.amount) * 100) : used;
  return (
    <ZPage
      title="Record Payment"
      onClose={() => navigate("/books/paymentsreceived")}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>("/api/books/customer_payment/new", {
                  body: {
                    customerId: customer?.id ?? 0,
                    date: form.date || choices.today,
                    amount: paid,
                    mode: form.mode || null,
                    depositTo: form.depositTo || null,
                    reference: form.reference || null,
                    notes: form.notes || null,
                    invoices: invoices.filter((b) => Number(picked[b.id]) > 0).map((b) => ({ billId: b.id, amount: Math.round(Number(picked[b.id]) * 100) })),
                  },
                });
                await queries.invalidateQueries({ queryKey: ["books"] });
                navigate(`/books/paymentsreceived/${made.id}`);
              })
            }
          >
            Save as Paid
          </Primary>
          <Plain onClick={() => navigate("/books/paymentsreceived")}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="bg-[#fbfbfe] px-5 py-3">
        <ZRow label="Customer Name" required error={action.at("customerId")}>
          <CustomerPick value={customer} onChange={setCustomer} />
        </ZRow>
      </div>
      <div className="px-5 py-3">
        <ZRow label="Amount Received" required error={action.at("amount")}>
          <input className={ZIN} inputMode="decimal" placeholder={(used / 100).toFixed(2)} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </ZRow>
        <ZRow label="Payment Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </ZRow>
        <ZRow label="Payment Mode">
          <input className={ZIN} list="book-modes-in" placeholder="Bank Transfer" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} />
          <datalist id="book-modes-in">
            {["Bank Transfer", "Bank Remittance", "Cash", "Check", "GCash", "Credit Card"].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </ZRow>
        <ZRow label="Deposit To">
          <input className={ZIN} value={form.depositTo} onChange={(event) => setForm({ ...form, depositTo: event.target.value })} />
        </ZRow>
        <ZRow label="Reference#">
          <input className={ZIN} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </ZRow>
      </div>
      <div className="px-5 pb-4">
        <BillsTable bills={invoices} amounts={picked} setAmounts={setAmounts} sales error={(at) => action.at(`bills.${at}.amount`)} />
        <div className="mt-3 ml-auto max-w-sm space-y-1 rounded-md bg-[#f9f9fb] p-4">
          <div className="flex justify-between">
            <span>Amount Received:</span>
            <span>{zMoney(paid, "")}</span>
          </div>
          <div className="flex justify-between">
            <span>Amount used for Payments:</span>
            <span>{zMoney(used, "")}</span>
          </div>
          <div className="flex justify-between">
            <span>Amount in Excess:</span>
            <span>{zMoney(Math.max(0, paid - used), "")}</span>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-[#6c718a]">Invoices made on the CRM's order line take their payments there (Finance → the invoice).</p>
      </div>
    </ZPage>
  );
}
