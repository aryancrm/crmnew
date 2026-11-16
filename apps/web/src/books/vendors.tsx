// Vendors as Zoho Inventory lists them (docs/PLAN.md 17): "Active Vendors ▾", NAME, COMPANY NAME,
// EMAIL, WORK PHONE, PAYABLES; a vendor opens beside the list with Overview (addresses, people,
// what is owed and Zoho's other fields) and Transactions (every document with them, newest first).

import type { BookKind, VendorDetail, VendorList } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { kindInfo, statusClass, statusText, zDate, zMoney } from "./kinds";
import { Pager, ViewMenu } from "./list";

const COUNT_LABEL: Partial<Record<BookKind, string>> = {
  purchase_order: "Purchase Orders",
  purchase_receive: "Purchase Receives",
  bill: "Bills",
  vendor_payment: "Payments Made",
  vendor_credit: "Vendor Credits",
};

export function VendorsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["view", "page", "perPage", "q", "sort", "dir"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const list = useQuery({ queryKey: ["books", "vendors", query.toString()], queryFn: () => api<VendorList>(`/api/books/vendors?${query}`), placeholderData: keepPreviousData });
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
  // Zoho names the vendors' views "Active Vendors", "Inactive Vendors", "All Vendors".
  const label = (key: string) => (key === "active" ? "Active Vendors" : key === "inactive" ? "Inactive Vendors" : "All Vendors");
  const header = (
    <div className="flex h-[60px] shrink-0 items-center border-b border-[#ebeaf2] px-5">
      <ViewMenu
        views={(data?.views ?? []).map((v) => ({ ...v, key: v.key }))}
        view={data?.view ?? "active"}
        plural="Vendors"
        onPick={(key) => set({ view: key === "active" ? null : key, page: null })}
        labelOf={label}
      />
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
  if (id)
    return (
      <div className="flex h-full">
        <aside className="hidden w-[340px] shrink-0 flex-col border-r border-[#ebeaf2] lg:flex">
          {header}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {(data?.rows ?? []).map((row) => (
              <li key={row.id}>
                <Link to={`/books/vendors/${row.id}${search}`} className={`block border-b border-[#ebeaf2] px-4 py-2.5 hover:bg-[#f1f1fa] ${String(row.id) === id ? "bg-[#f1f1fa]" : ""}`}>
                  <div className="truncate font-medium">{row.name}</div>
                  <div className="text-[12px] text-[#6c718a]">{zMoney(row.payables)}</div>
                </Link>
              </li>
            ))}
          </ul>
          {data && <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={(page) => set({ page: String(page) })} onPer={(per) => set({ perPage: String(per), page: null })} />}
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto">
          <Vendor id={Number(id)} onClose={() => navigate(`/books/vendors${search}`)} />
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
              {sortable("company", "Company Name")}
              <th className="px-2 py-3 text-left text-[11px] font-normal text-[#6c718a] uppercase">Email</th>
              <th className="px-2 py-3 text-left text-[11px] font-normal text-[#6c718a] uppercase">Work Phone</th>
              {sortable("payables", "Payables", true)}
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id} onClick={() => navigate(`/books/vendors/${row.id}${search}`)} className="cursor-pointer border-b border-[#ebeaf2] hover:bg-[#f9f9fb]">
                <td />
                <td className="px-2 py-2.5 font-medium text-[#1c5bd9]">{row.name}</td>
                <td className="px-2 py-2.5">{row.company ?? ""}</td>
                <td className="px-2 py-2.5">{row.email ?? ""}</td>
                <td className="px-2 py-2.5">{row.phone ?? ""}</td>
                <td className="px-2 py-2.5 text-right">{zMoney(row.payables)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={(page) => set({ page: String(page) })} onPer={(per) => set({ perPage: String(per), page: null })} />}
    </div>
  );
}

function Vendor({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ["books", "vendor", id], queryFn: () => api<VendorDetail>(`/api/books/vendors/${id}`) });
  const [tab, setTab] = useState<"overview" | "transactions">("overview");
  const v = query.data;
  if (!v) return <p className="p-6 text-[#6c718a]">{query.isError ? query.error.message : "Loading…"}</p>;
  return (
    <div>
      <div className="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-[#ebeaf2] bg-white px-5">
        <h1 className="text-[20px] font-medium">{v.name}</h1>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[#f76831] hover:bg-[#f1f1fa]">
          <X size={18} />
        </button>
      </div>
      <div className="flex gap-6 border-b border-[#ebeaf2] px-5">
        {(["overview", "transactions"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`py-2.5 capitalize ${tab === key ? "border-b-2 border-[#408dfb] font-medium text-[#212529]" : "text-[#6c718a]"}`}>
            {key}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="grid gap-6 p-5 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <div>
              <div className="font-medium">{v.company ?? v.name}</div>
              {v.email && <div className="text-[#4b4f63]">{v.email}</div>}
              {v.phone && <div className="text-[#4b4f63]">{v.phone}</div>}
              {v.mobile && <div className="text-[#4b4f63]">{v.mobile}</div>}
              {v.website && <div className="text-[#4b4f63]">{v.website}</div>}
            </div>
            <div>
              <div className="text-[11px] text-[#6c718a] uppercase">Billing Address</div>
              <div className="whitespace-pre-wrap">{v.billingAddress ?? "No billing address"}</div>
            </div>
            <div>
              <div className="text-[11px] text-[#6c718a] uppercase">Shipping Address</div>
              <div className="whitespace-pre-wrap">{v.shippingAddress ?? "No shipping address"}</div>
            </div>
            <div>
              <div className="text-[11px] text-[#6c718a] uppercase">Other Details</div>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
                <dt className="text-[#6c718a]">Currency</dt>
                <dd>{v.currency}</dd>
                {v.tin && (
                  <>
                    <dt className="text-[#6c718a]">TIN</dt>
                    <dd>{v.tin}</dd>
                  </>
                )}
                {v.paymentTerms && (
                  <>
                    <dt className="text-[#6c718a]">Payment Terms</dt>
                    <dd>{v.paymentTerms}</dd>
                  </>
                )}
                {Object.entries(v.fields)
                  // Zoho's own record numbers (Contact Address ID…) say nothing to a person.
                  .filter(([key, value]) => !(/ ID$/.test(key) && !key.startsWith("CF.")) && !/^(0+(\.0+)?|false)$/i.test(String(value)))
                  .map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-[#6c718a]">{key.replace(/^CF\./, "")}</dt>
                    <dd className="break-words">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {v.people.length > 0 && (
              <div>
                <div className="text-[11px] text-[#6c718a] uppercase">Contact Persons ({v.people.length})</div>
                {v.people.map((p) => (
                  <div key={p.id} className="border-b border-[#f2f2f7] py-1.5">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[12px] text-[#6c718a]">{[p.designation, p.email, p.phone ?? p.mobile].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="rounded-md border border-[#ebeaf2]">
              <div className="border-b border-[#ebeaf2] px-4 py-2 font-medium">Payables</div>
              <div className="grid grid-cols-2 gap-4 px-4 py-3">
                <div>
                  <div className="text-[#6c718a]">Outstanding Payables</div>
                  <div className="text-[15px] font-semibold">{zMoney(v.payables)}</div>
                </div>
                <div>
                  <div className="text-[#6c718a]">Unused Credits</div>
                  <div className="text-[15px] font-semibold">{zMoney(v.credits)}</div>
                </div>
              </div>
            </div>
            <div className="rounded-md border border-[#ebeaf2]">
              <div className="border-b border-[#ebeaf2] px-4 py-2 font-medium">With this vendor</div>
              <ul className="divide-y divide-[#f2f2f7]">
                {v.counts.map((c) => {
                  const info = kindInfo(c.kind);
                  return (
                    <li key={c.kind} className="flex justify-between px-4 py-2">
                      <span>
                        {COUNT_LABEL[c.kind] ?? c.kind} <span className="text-[#6c718a]">({c.count})</span>
                      </span>
                      <span>{info ? zMoney(c.total) : ""}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#ebeaf2] text-[11px] text-[#6c718a] uppercase">
              <th className="px-5 py-2.5 text-left font-normal">Date</th>
              <th className="px-2 py-2.5 text-left font-normal">Type</th>
              <th className="px-2 py-2.5 text-left font-normal">Number</th>
              <th className="px-2 py-2.5 text-left font-normal">Status</th>
              <th className="px-2 py-2.5 text-right font-normal">Amount</th>
              <th className="px-5 py-2.5 text-right font-normal">Balance</th>
            </tr>
          </thead>
          <tbody>
            {v.recent.map((doc) => {
              const info = kindInfo(doc.kind);
              return (
                <tr key={doc.id} className="border-b border-[#f2f2f7]">
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
                  <td className={`px-2 py-2 text-[12px] uppercase ${statusClass(doc.status)}`}>{statusText(doc.status, doc.overdueDays)}</td>
                  <td className="px-2 py-2 text-right">{zMoney(doc.total, doc.currency)}</td>
                  <td className="px-5 py-2 text-right">{doc.kind === "bill" || doc.kind === "vendor_credit" ? zMoney(doc.balance, doc.currency) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
