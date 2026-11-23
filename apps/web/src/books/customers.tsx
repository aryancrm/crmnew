// Customers as Zoho Inventory lists them (docs/PLAN.md 17), a view for each kind because each is a
// different customer: NAME, COMPANY NAME, EMAIL, WORK PHONE, RECEIVABLES. A customer opens beside
// the list: what matters for its kind first (a hospital's licence, terms and doctors; a doctor's
// specialty and hospital; a patient's details from their orders), then every field Zoho kept, its
// people, and Transactions — Zoho's documents and the CRM's own, newest first.

import { LeavesArrow } from "../app-switch";
import type { BookCustomer, BookCustomerList, BookKind } from "@2mg/api/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { kindInfo, statusClass, statusText, zDate, zMoney } from "./kinds";
import { Pager, ViewMenu } from "./list";

const VIEW_LABEL: Record<string, string> = {
  all: "All Customers",
  hospital: "Hospitals",
  doctor: "Doctors",
  patient: "Patients",
  drugstore: "Drugstores",
  distributor: "Distributors",
  government: "Government",
  owing: "Customers who owe",
};
const KIND_WORD: Record<string, string> = { hospital: "Hospital", doctor: "Doctor", patient: "Patient", drugstore: "Drugstore", distributor: "Distributor", government: "Government" };
const COUNT_LABEL: Partial<Record<BookKind, string>> = {
  sales_order: "Sales Orders",
  invoice: "Invoices",
  customer_payment: "Payments Received",
  sales_return: "Sales Returns",
  credit_note: "Credit Notes",
};

export function CustomersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["view", "page", "perPage", "q", "sort", "dir"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const list = useQuery({ queryKey: ["books", "customers", query.toString()], queryFn: () => api<BookCustomerList>(`/api/books/customers?${query}`), placeholderData: keepPreviousData });
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
      <ViewMenu views={data?.views ?? []} view={data?.view ?? "all"} plural="Customers" labelOf={(key) => VIEW_LABEL[key] ?? key} onPick={(key) => set({ view: key === "all" ? null : key, page: null })} />
      <Link to="/customers?new=1" title="Opens the CRM" className="flex h-[32px] items-center gap-1 rounded-[5px] bg-[#408dfb] px-2.5 text-white hover:bg-[#2f7ef0]">
        <Plus size={15} aria-hidden="true" /> New <LeavesArrow app="the CRM" />
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
                <Link to={`/books/customers/${row.id}${search}`} className={`block border-b border-[#ebeaf2] px-4 py-2.5 hover:bg-[#f1f1fa] ${String(row.id) === id ? "bg-[#f1f1fa]" : ""}`}>
                  <div className="truncate font-medium">{row.name}</div>
                  <div className="text-[12px] text-[#6c718a]">
                    {KIND_WORD[row.kind]} · {zMoney(row.receivables)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {pager}
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto">
          <Customer id={Number(id)} onClose={() => navigate(`/books/customers${search}`)} />
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
              <th className="px-2 py-3 text-left text-[11px] font-normal text-[#6c718a] uppercase">Company Name</th>
              <th className="px-2 py-3 text-left text-[11px] font-normal text-[#6c718a] uppercase">Email</th>
              <th className="px-2 py-3 text-left text-[11px] font-normal text-[#6c718a] uppercase">Work Phone</th>
              {sortable("city", "City")}
              {sortable("receivables", "Receivables", true)}
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id} onClick={() => navigate(`/books/customers/${row.id}${search}`)} className="cursor-pointer border-b border-[#ebeaf2] hover:bg-[#f9f9fb]">
                <td />
                <td className="px-2 py-2.5">
                  <span className="font-medium text-[#1c5bd9]">{row.name}</span>
                  {data?.view === "all" && <span className="ml-2 rounded bg-[#ededf7] px-1.5 text-[11px] text-[#6c718a]">{KIND_WORD[row.kind]}</span>}
                </td>
                <td className="px-2 py-2.5">{row.company ?? ""}</td>
                <td className="px-2 py-2.5">{row.email ?? ""}</td>
                <td className="px-2 py-2.5">{row.phone ?? ""}</td>
                <td className="px-2 py-2.5">{row.city ?? ""}</td>
                <td className="px-2 py-2.5 text-right">{zMoney(row.receivables)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

/** Zoho's address of one side (Billing, Shipping), as one block. */
const zohoAddress = (fields: Record<string, unknown>, side: "Billing" | "Shipping") =>
  [`${side} Attention`, `${side} Address`, `${side} Street2`, `${side} City`, `${side} State`, `${side} Code`, `${side} Country`]
    .map((key) => fields[key])
    .filter((value) => value && String(value).trim())
    .join(", ");

const Item = ({ label, children }: { label: string; children: ReactNode }) =>
  children === null || children === undefined || children === "" ? null : (
    <>
      <dt className="text-[#6c718a]">{label}</dt>
      <dd className="break-words">{children}</dd>
    </>
  );

function Customer({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useQuery({ queryKey: ["books", "customer", id], queryFn: () => api<BookCustomer>(`/api/books/customers/${id}`) });
  const [tab, setTab] = useState<"overview" | "transactions">("overview");
  const c = query.data;
  if (!c) return <p className="p-6 text-[#6c718a]">{query.isError ? query.error.message : "Loading…"}</p>;
  const terms = c.paymentTerms === "days" ? `${c.paymentDays} days` : c.paymentTerms === "cod" ? "Cash on delivery" : "Paid in advance";
  const zoho = Object.entries(c.zohoFields).filter(([key, value]) => !(/ ID$/.test(key) && !key.startsWith("CF.")) && !/^(0+(\.0+)?|false)$/i.test(String(value)));
  return (
    <div>
      <div className="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-[#ebeaf2] bg-white px-5">
        <h1 className="text-[20px] font-medium">
          {c.name} <span className="ml-2 rounded bg-[#ededf7] px-2 py-0.5 align-middle text-[12px] font-normal text-[#6c718a]">{KIND_WORD[c.kind]}</span>
        </h1>
        <div className="flex items-center gap-3">
          <Link to={`/customers/${c.id}`} className="text-[#1c5bd9]">
            Open in the CRM ↗
          </Link>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[#f76831] hover:bg-[#f1f1fa]">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex gap-6 border-b border-[#ebeaf2] px-5">
        {(["overview", "transactions"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`py-2.5 capitalize ${tab === key ? "border-b-2 border-[#408dfb] font-medium text-[#212529]" : "text-[#6c718a]"}`}>
            {key}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="grid gap-6 p-5 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <div>
              <div className="font-medium">{c.company ?? c.name}</div>
              {c.email && <div className="text-[#4b4f63]">{c.email}</div>}
              {c.phone && <div className="text-[#4b4f63]">{c.phone}</div>}
              {(c.address || zohoAddress(c.zohoFields, "Billing")) && <div className="mt-1 whitespace-pre-wrap text-[#4b4f63]">{c.address || zohoAddress(c.zohoFields, "Billing")}</div>}
              {zohoAddress(c.zohoFields, "Shipping") && zohoAddress(c.zohoFields, "Shipping") !== zohoAddress(c.zohoFields, "Billing") && (
                <div className="mt-2">
                  <div className="text-[11px] text-[#6c718a] uppercase">Shipping Address</div>
                  <div className="whitespace-pre-wrap text-[#4b4f63]">{zohoAddress(c.zohoFields, "Shipping")}</div>
                </div>
              )}
              {c.city && <div className="text-[#4b4f63]">{c.city}</div>}
            </div>
            <div>
              <div className="mb-1 text-[11px] text-[#6c718a] uppercase">About this {KIND_WORD[c.kind]?.toLowerCase()}</div>
              <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
                <Item label="Customer code">{c.code}</Item>
                {c.kind === "doctor" && <Item label="Specialty">{c.specialty}</Item>}
                {c.kind === "doctor" && <Item label="PRC licence">{c.licenceNo}</Item>}
                {c.kind === "doctor" && c.worksAt && (
                  <Item label="Hospital">
                    <Link to={`/books/customers/${c.worksAt.id}`} className="text-[#1c5bd9]">
                      {c.worksAt.name}
                    </Link>
                  </Item>
                )}
                {c.kind !== "doctor" && c.kind !== "patient" && <Item label="FDA licence (LTO)">{c.licenceNo ? `${c.licenceNo}${c.licenceExpires ? ` · until ${zDate(c.licenceExpires)}` : ""}` : null}</Item>}
                {c.kind !== "doctor" && c.kind !== "patient" && <Item label="Business permit">{c.permitNo ? `${c.permitNo}${c.permitExpires ? ` · until ${zDate(c.permitExpires)}` : ""}` : null}</Item>}
                <Item label="TIN">{c.tin}</Item>
                <Item label="Payment terms">{terms}</Item>
                <Item label="Credit limit">{c.creditLimit ? zMoney(c.creditLimit) : null}</Item>
                <Item label="Area">{c.area}</Item>
                <Item label="Customer since">{zDate(c.createdOn)}</Item>
                <Item label="Note">{c.note}</Item>
              </dl>
            </div>
            {c.patient && Object.keys(c.patient).length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-[#6c718a] uppercase">From their latest order</div>
                <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
                  {Object.entries(c.patient).map(([label, value]) => (
                    <Item key={label} label={label}>
                      {/^https?:\/\//.test(value) ? (
                        <a href={value} target="_blank" rel="noreferrer" className="text-[#1c5bd9]">
                          Open
                        </a>
                      ) : (
                        value
                      )}
                    </Item>
                  ))}
                </dl>
              </div>
            )}
            {c.doctors.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-[#6c718a] uppercase">Doctors here ({c.doctors.length})</div>
                {c.doctors.map((d) => (
                  <Link key={d.id} to={`/books/customers/${d.id}`} className="block py-0.5 text-[#1c5bd9]">
                    {d.name}
                    {d.specialty ? <span className="text-[#6c718a]"> · {d.specialty}</span> : null}
                  </Link>
                ))}
              </div>
            )}
            {c.people.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-[#6c718a] uppercase">Contact Persons ({c.people.length})</div>
                {c.people.map((p) => (
                  <div key={p.id} className="border-b border-[#f2f2f7] py-1.5">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[12px] text-[#6c718a]">{[p.designation, p.email, p.phone ?? p.mobile].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>
            )}
            {zoho.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[11px] text-[#6c718a] uppercase">Everything Zoho kept ({zoho.length})</summary>
                <dl className="mt-1 grid grid-cols-[9rem_1fr] gap-y-1">
                  {zoho.map(([key, value]) => (
                    <Item key={key} label={key.replace(/^CF\./, "")}>
                      {String(value)}
                    </Item>
                  ))}
                </dl>
              </details>
            )}
          </div>
          <div className="space-y-4">
            <div className="rounded-md border border-[#ebeaf2]">
              <div className="border-b border-[#ebeaf2] px-4 py-2 font-medium">Receivables</div>
              <div className="grid grid-cols-2 gap-4 px-4 py-3">
                <div>
                  <div className="text-[#6c718a]">Outstanding Receivables</div>
                  <div className="text-[15px] font-semibold">{zMoney(c.receivables)}</div>
                </div>
                <div>
                  <div className="text-[#6c718a]">Unused Credits</div>
                  <div className="text-[15px] font-semibold">{zMoney(c.credits)}</div>
                </div>
              </div>
            </div>
            <div className="rounded-md border border-[#ebeaf2]">
              <div className="border-b border-[#ebeaf2] px-4 py-2 font-medium">With this customer</div>
              <ul className="divide-y divide-[#f2f2f7]">
                {c.counts.map((n, i) => (
                  <li key={`${n.kind}${i}`} className="flex justify-between px-4 py-2">
                    <span>
                      {COUNT_LABEL[n.kind] ?? n.kind} <span className="text-[#6c718a]">({n.count})</span>
                    </span>
                    <span>{zMoney(n.total)}</span>
                  </li>
                ))}
                {!c.counts.length && <li className="px-4 py-2 text-[#6c718a]">Nothing yet.</li>}
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
            {c.recent.map((doc) => {
              const info = kindInfo(doc.kind);
              return (
                <tr key={`${doc.kind}${doc.id}`} className="border-b border-[#f2f2f7]">
                  <td className="px-5 py-2">{zDate(doc.date)}</td>
                  <td className="px-2 py-2">
                    {info?.one ?? doc.kind}
                    {doc.id < 0 && <span className="ml-1 text-[11px] text-[#6c718a]">(CRM)</span>}
                  </td>
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
                  <td className="px-5 py-2 text-right">{doc.kind === "invoice" || doc.kind === "credit_note" ? zMoney(doc.balance, doc.currency) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
