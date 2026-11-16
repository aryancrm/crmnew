// Items as Zoho Inventory lists them (docs/PLAN.md 17): "Active Items ▾", NAME, SKU, REORDER LEVEL,
// with STOCK ON HAND and RATE beside them; an item opens beside the list with Zoho's tabs —
// Overview (Zoho's details, purchase and sales information, the stock), Warehouses, Batch Details
// and Transactions. A medicine's stock is this CRM's own; Zoho's figures on the day it was read
// sit beside it. And Price Lists, as Zoho lists them.

import type { BookItem, BookItemList, BookPriceList } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImageIcon, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { kindInfo, statusClass, statusText, zDate, zMoney, zQty } from "./kinds";
import { Pager, ViewMenu } from "./list";

const VIEW_LABEL: Record<string, string> = {
  active: "Active Items",
  inactive: "Inactive Items",
  all: "All Items",
  low: "Low Stock Items",
  out: "Out of Stock Items",
  medicines: "Our Medicines",
};

export function ItemsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["view", "page", "perPage", "q", "sort", "dir"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const list = useQuery({ queryKey: ["books", "items", query.toString()], queryFn: () => api<BookItemList>(`/api/books/items?${query}`), placeholderData: keepPreviousData });
  const data = list.data;
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const search = params.toString() ? `?${params}` : "";
  const sort = params.get("sort") ?? "name";
  const dir = params.get("dir") ?? "asc";
  const header = (
    <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#ebeaf2] px-5">
      <ViewMenu views={data?.views ?? []} view={data?.view ?? "active"} plural="Items" labelOf={(key) => VIEW_LABEL[key] ?? key} onPick={(key) => set({ view: key === "active" ? null : key, page: null })} />
      <Link to="/medicines?new=1" className="flex h-[32px] items-center gap-1 rounded-[5px] bg-[#408dfb] px-2.5 text-white hover:bg-[#2f7ef0]">
        <Plus size={15} aria-hidden="true" /> New
      </Link>
    </div>
  );
  const sortable = (key: string, text: string, right?: boolean) => (
    <th className={`px-2 py-3 text-[11px] font-normal whitespace-nowrap text-[#6c718a] uppercase ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => set({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc", page: null })} className="inline-flex items-center gap-1 uppercase hover:text-[#212529]">
        {text}
        {sort === key && (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
  const pager = data && <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={(page) => set({ page: String(page) })} onPer={(per) => set({ perPage: String(per), page: null })} />;
  if (id)
    return (
      <div className="flex h-full">
        <aside className="hidden w-[340px] shrink-0 flex-col border-r border-[#ebeaf2] lg:flex">
          {header}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {(data?.rows ?? []).map((row) => (
              <li key={row.id}>
                <Link to={`/books/items/${row.id}${search}`} className={`block border-b border-[#ebeaf2] px-4 py-2.5 hover:bg-[#f1f1fa] ${String(row.id) === id ? "bg-[#f1f1fa]" : ""}`}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="shrink-0">{zMoney(row.rate)}</span>
                  </div>
                  <div className="truncate text-[12px] text-[#6c718a]">SKU: {row.sku ?? "—"}</div>
                </Link>
              </li>
            ))}
          </ul>
          {pager}
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto">
          <Item id={Number(id)} onClose={() => navigate(`/books/items${search}`)} />
        </section>
      </div>
    );
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-[#ebeaf2]">
              <th className="w-10" />
              {sortable("name", "Name")}
              {sortable("sku", "SKU")}
              {sortable("stock", "Stock on Hand", true)}
              {sortable("rate", "Rate", true)}
              {sortable("reorder", "Reorder Level", true)}
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id} onClick={() => navigate(`/books/items/${row.id}${search}`)} className="cursor-pointer border-b border-[#ebeaf2] hover:bg-[#f9f9fb]">
                <td className="py-2 pl-4">
                  <span className="flex size-8 items-center justify-center rounded border border-[#ebeaf2] text-[#c4c6d4]">
                    <ImageIcon size={14} aria-hidden="true" />
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <span className="font-medium text-[#1c5bd9]">{row.name}</span>
                  {row.medicineId && <span className="ml-2 rounded bg-[#e8f7ef] px-1.5 text-[11px] text-[#22b378]">Our medicine</span>}
                </td>
                <td className="px-2 py-2.5">{row.sku ?? ""}</td>
                <td className={`px-2 py-2.5 text-right ${row.stock !== null && row.stock <= 0 ? "text-[#f76831]" : ""}`}>{zQty(row.stock)}</td>
                <td className="px-2 py-2.5 text-right">{zMoney(row.rate)}</td>
                <td className="px-2 py-2.5 text-right">{zQty(row.reorderLevel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) =>
  children === null || children === undefined || children === "" ? null : (
    <>
      <dt className="text-[#6c718a]">{label}</dt>
      <dd className="break-words">{children}</dd>
    </>
  );

const ZOHO_STOCK: [string, string][] = [
  ["stock_on_hand", "Stock on Hand"],
  ["committed_stock", "Committed Stock"],
  ["available_for_sale_stock", "Available for Sale"],
  ["actual_available_stock", "Physical: Stock on Hand"],
  ["actual_committed_stock", "Physical: Committed"],
  ["actual_available_for_sale_stock", "Physical: Available for Sale"],
];

function Item({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ["books", "item", id], queryFn: () => api<BookItem>(`/api/books/items/${id}`) });
  const [tab, setTab] = useState<"overview" | "warehouses" | "batches" | "transactions">("overview");
  const item = query.data;
  if (!item) return <p className="p-6 text-[#6c718a]">{query.isError ? query.error.message : "Loading…"}</p>;
  const fields = Object.entries(item.fields).filter(([key, value]) => !/^(0+(\.0+)?|false)$/i.test(String(value)) && !/ ID$/.test(key));
  const label = (key: string) => key.replace(/^CF\./, "");
  const onHand = item.medicineId ? item.warehouses.reduce((sum, w) => sum + w.qty, 0) : Number(item.zohoStock.stock_on_hand ?? 0);
  return (
    <div>
      <div className="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-[#ebeaf2] bg-white px-5">
        <h1 className="text-[20px] font-medium">{item.name}</h1>
        <div className="flex items-center gap-3">
          {item.medicineId && (
            <Link to={`/medicines/${item.medicineId}`} className="text-[#1c5bd9]">
              Open in the CRM ↗
            </Link>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[#f76831] hover:bg-[#f1f1fa]">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex gap-6 border-b border-[#ebeaf2] px-5">
        {(
          [
            ["overview", "Overview"],
            ["warehouses", "Warehouses"],
            ["batches", "Batch Details"],
            ["transactions", "Transactions"],
          ] as const
        ).map(([key, word]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`py-2.5 ${tab === key ? "border-b-2 border-[#408dfb] font-medium text-[#212529]" : "text-[#6c718a]"}`}>
            {word}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <div>
              <h2 className="mb-2 font-semibold">Primary Details</h2>
              <dl className="grid grid-cols-[11rem_1fr] gap-y-1.5">
                <Row label="Item Name">{item.name}</Row>
                <Row label="Item Type">{item.itemType}</Row>
                <Row label="SKU">{item.sku}</Row>
                <Row label="Unit">{item.unit}</Row>
                <Row label="Status">{item.status}</Row>
                {item.medicine && <Row label="Medicine here">{[item.medicine.name, item.medicine.strength, item.medicine.form, item.medicine.pack].filter(Boolean).join(" · ")}</Row>}
                {item.medicine?.generic && <Row label="Generic">{item.medicine.generic}</Row>}
                {fields.map(([key, value]) => (
                  <Row key={key} label={label(key)}>
                    {String(value)}
                  </Row>
                ))}
              </dl>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h2 className="mb-2 font-semibold">Purchase Information</h2>
                <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
                  <Row label="Cost Price">{zMoney(item.purchaseRate)}</Row>
                </dl>
              </div>
              <div>
                <h2 className="mb-2 font-semibold">Sales Information</h2>
                <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
                  <Row label="Selling Price">{zMoney(item.rate)}</Row>
                </dl>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-md border border-[#ebeaf2] p-4">
              <div className="mb-2 font-semibold">{item.medicineId ? "Stock here (this CRM)" : "Stock"}</div>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1">
                <dt className="text-[#6c718a]">Stock on Hand</dt>
                <dd className="text-right font-medium">{zQty(onHand)}</dd>
                {item.medicineId && (
                  <>
                    <dt className="text-[#6c718a]">Committed (open orders)</dt>
                    <dd className="text-right">{zQty(item.committed)}</dd>
                    <dt className="text-[#6c718a]">Available for Sale</dt>
                    <dd className="text-right font-medium">{zQty(onHand - item.committed)}</dd>
                  </>
                )}
                <dt className="text-[#6c718a]">Reorder Level</dt>
                <dd className="text-right">{zQty(item.reorderLevel)}</dd>
              </dl>
            </div>
            {Object.keys(item.zohoStock).length > 0 && (
              <div className="rounded-md border border-[#ebeaf2] p-4">
                <div className="mb-2 font-semibold">Zoho's figures (when read)</div>
                <dl className="grid grid-cols-[1fr_auto] gap-y-1">
                  {ZOHO_STOCK.filter(([key]) => item.zohoStock[key] !== undefined).map(([key, word]) => (
                    <div key={key} className="contents">
                      <dt className="text-[#6c718a]">{word}</dt>
                      <dd className="text-right">{zQty(Number(item.zohoStock[key]))}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === "warehouses" && (
        <table className="m-5 w-[calc(100%-2.5rem)] border border-[#ebeaf2]">
          <thead>
            <tr className="border-b border-[#ebeaf2] bg-[#f9f9fb] text-left text-[11px] text-[#6c718a] uppercase">
              <th className="px-3 py-2 font-normal">Warehouse Name</th>
              <th className="px-3 py-2 text-right font-normal">Stock on Hand</th>
            </tr>
          </thead>
          <tbody>
            {item.warehouses.map((w) => (
              <tr key={w.name} className="border-b border-[#f2f2f7]">
                <td className="px-3 py-2">{w.name}</td>
                <td className="px-3 py-2 text-right">{zQty(w.qty)}</td>
              </tr>
            ))}
            {!item.warehouses.length && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-[#6c718a]">
                  {item.medicineId ? "None on the shelf." : "Not one of this CRM's medicines: Zoho's own figures are on Overview."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {tab === "batches" && (
        <div className="space-y-4 p-5">
          <table className="w-full border border-[#ebeaf2]">
            <thead>
              <tr className="border-b border-[#ebeaf2] bg-[#f9f9fb] text-left text-[11px] text-[#6c718a] uppercase">
                <th className="px-3 py-2 font-normal">Batch Reference#</th>
                <th className="px-3 py-2 font-normal">Expiry Date</th>
                <th className="px-3 py-2 font-normal">Warehouse</th>
                <th className="px-3 py-2 text-right font-normal">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {item.batches.map((b) => (
                <tr key={`${b.batchNo}${b.warehouse}`} className="border-b border-[#f2f2f7]">
                  <td className="px-3 py-2">{b.batchNo}</td>
                  <td className="px-3 py-2">{zDate(b.expiresOn)}</td>
                  <td className="px-3 py-2">{b.warehouse}</td>
                  <td className="px-3 py-2 text-right">{zQty(b.qty)}</td>
                </tr>
              ))}
              {!item.batches.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-[#6c718a]">
                    No batch on the shelf here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {item.zohoBatches.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[#6c718a]">Zoho's batch records ({item.zohoBatches.length})</summary>
              <ul className="mt-1 space-y-0.5 text-[12.5px]">
                {item.zohoBatches.map((b, i) => (
                  <li key={i}>{Object.entries(b).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {tab === "transactions" && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#ebeaf2] text-[11px] text-[#6c718a] uppercase">
              <th className="px-5 py-2.5 text-left font-normal">Date</th>
              <th className="px-2 py-2.5 text-left font-normal">Type</th>
              <th className="px-2 py-2.5 text-left font-normal">Number</th>
              <th className="px-2 py-2.5 text-left font-normal">Customer / Vendor</th>
              <th className="px-2 py-2.5 text-right font-normal">Quantity</th>
              <th className="px-5 py-2.5 text-left font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {item.recent.map((doc) => {
              const info = kindInfo(doc.kind);
              return (
                <tr key={`${doc.kind}${doc.id}`} className="border-b border-[#f2f2f7]">
                  <td className="px-5 py-2">{zDate(doc.date)}</td>
                  <td className="px-2 py-2">{info?.one ?? doc.kind}</td>
                  <td className="px-2 py-2">
                    {info ? (
                      <Link to={`/books/${info.path}/${doc.id}`} className="text-[#1c5bd9]">
                        {doc.number}
                      </Link>
                    ) : (
                      doc.number
                    )}
                  </td>
                  <td className="px-2 py-2">{doc.party ?? ""}</td>
                  <td className="px-2 py-2 text-right">{zQty(doc.qty)}</td>
                  <td className={`px-5 py-2 text-[12px] uppercase ${statusClass(doc.status)}`}>{statusText(doc.status)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PriceListsPage() {
  const query = useQuery({ queryKey: ["books", "pricelists"], queryFn: () => api<BookPriceList[]>("/api/books/pricelists") });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] shrink-0 items-center border-b border-[#ebeaf2] px-5 text-[16px] font-semibold text-[#212529]">All Price Lists</div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#ebeaf2] text-left text-[11px] text-[#6c718a] uppercase">
            <th className="px-5 py-3 font-normal">Name and Description</th>
            <th className="px-2 py-3 font-normal">Currency</th>
            <th className="px-2 py-3 font-normal">Details</th>
            <th className="px-2 py-3 font-normal">Pricing Scheme</th>
            <th className="px-2 py-3 font-normal">Round Off Preference</th>
            <th className="px-5 py-3 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((p) => (
            <tr key={p.id} className="border-b border-[#ebeaf2]">
              <td className="px-5 py-2.5 font-medium">{p.name}</td>
              <td className="px-2 py-2.5">{p.currency ?? "-"}</td>
              <td className="px-2 py-2.5">{p.details ?? ""}</td>
              <td className="px-2 py-2.5">{p.scheme ?? "-"}</td>
              <td className="px-2 py-2.5">{p.rounding ?? ""}</td>
              <td className="px-5 py-2.5">{p.status ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
