// Vendors in this CRM's own look: the list with what we owe each one and their unused credits, a
// vendor's page (who they are, what we buy from them and at what price last time, every order,
// bill, payment and credit), and the form to add or change one.

import type { BookKind, VendorDetail, VendorItems, VendorList } from "@2mg/api/types";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Pencil, Phone, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMay } from "../books/forms";
import { EmptyState, NoResults } from "../no-results";
import { Button, count, Dialog, PageHead, PageState, Problem, Tabs, useAction } from "../ui";
import { Box, docPath, docState, Fact, FIELD, KIND_WORD, LABEL, money, orderStage, Pager, qty, SearchBox, StatePill, TABLE, TD, TH, useBookList, when, ZohoLink } from "./shared";

// ------------------------------------------------------------------ the list

export function VendorsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const may = useMay();
  const [adding, setAdding] = useState(false);
  const view = params.get("view") ?? "active";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 1;
  const search = new URLSearchParams({ view, page: String(page), perPage: "50", ...(q ? { q } : {}), sort: "payables", dir: "desc" });
  const query = useQuery({
    queryKey: ["books", "vendors", search.toString()],
    queryFn: () => api<VendorList>(`/api/books/vendors?${search.toString()}`),
    placeholderData: keepPreviousData,
  });
  const set = (next: Record<string, string | undefined>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) value ? out.set(key, value) : out.delete(key);
    setParams(out, { replace: true });
  };
  const data = query.data;
  const viewCount = (key: string) => data?.views.find((one) => one.key === key)?.count;
  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="Vendors"
        sub="Who we buy from, what we owe each one, and their credits not used yet"
        actions={
          <>
            <ZohoLink to="/books/vendors" />
            {may.order && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden="true" /> New vendor
              </Button>
            )}
          </>
        }
      >
        <Tabs
          value={view}
          onChange={(key) => set({ view: key, page: undefined })}
          tabs={[
            { key: "active", label: "Active", count: viewCount("active") },
            { key: "inactive", label: "Inactive", count: viewCount("inactive") },
            { key: "all", label: "All", count: viewCount("all") },
          ]}
        />
      </PageHead>
      <div className="flex">
        <SearchBox value={q} onChange={(text) => set({ q: text || undefined, page: undefined })} placeholder="Search a vendor by name, company, email or phone" />
      </div>
      <PageState query={query} what="the vendors" />
      {data && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Vendor</th>
                  <th className={TH}>Contact</th>
                  <th className={`${TH} text-right`}>We owe</th>
                  <th className={`${TH} text-right`}>Their credits</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} onClick={() => navigate(`/purchases/vendors/${row.id}`)} className="cursor-pointer hover:bg-slate-50/70">
                    <td className={`${TD} max-w-[22rem]`}>
                      <Link to={`/purchases/vendors/${row.id}`} onClick={(event) => event.stopPropagation()} className="block truncate font-semibold text-slate-900 hover:text-brand">
                        {row.name}
                      </Link>
                      {row.company && row.company !== row.name && <div className="truncate text-[12px] text-slate-500">{row.company}</div>}
                    </td>
                    <td className={`${TD} text-[12.5px] text-slate-600`}>{[row.email, row.phone].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums ${row.payables > 0 ? "text-slate-900" : "text-slate-400"}`}>{money(row.payables)}</td>
                    <td className={`${TD} text-right tabular-nums ${row.credits > 0 ? "font-semibold text-violet-700" : "text-slate-400"}`}>{money(row.credits)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <NoResults title="No vendor matches.">Try another name, company, email or phone, or another tab.</NoResults>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={(next) => set({ page: String(next) })} />
        </section>
      )}
      {adding && <NewVendorDialog onClose={() => setAdding(false)} onSaved={(id) => navigate(`/purchases/vendors/${id}`)} />}
    </div>
  );
}

// ------------------------------------------------------------------ one vendor

const DOC_TABS: { key: BookKind; label: string }[] = [
  { key: "purchase_order", label: "Purchase orders" },
  { key: "bill", label: "Bills" },
  { key: "vendor_payment", label: "Payments made" },
  { key: "vendor_credit", label: "Vendor credits" },
];

export function VendorPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const may = useMay();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<BookKind>("purchase_order");
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["books", "vendor", id], queryFn: () => api<VendorDetail>(`/api/books/vendors/${id}`) });
  const items = useQuery({ queryKey: ["books", "vendor", id, "items"], queryFn: () => api<VendorItems>(`/api/buying/vendors/${id}/items`) });
  const docs = useBookList(tab, { party: id, page, perPage: 25 });
  const vendor = query.data;
  if (!vendor) return <PageState query={query} what="the vendor" />;
  const counted = (kind: BookKind) => vendor.counts.find((one) => one.kind === kind)?.count;
  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title={vendor.name}
        tags={!vendor.active ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Inactive</span> : undefined}
        sub={vendor.company && vendor.company !== vendor.name ? vendor.company : `Bills in ${vendor.currency}`}
        actions={
          <>
            <ZohoLink to={`/books/vendors/${id}`} />
            {may.order && (
              <Button onClick={() => setEditing(true)}>
                <Pencil size={16} aria-hidden="true" /> Edit
              </Button>
            )}
            {may.pay && vendor.payables > 0 && (
              <Button onClick={() => navigate(`/purchases/payments/new?vendor=${id}`)}>Record payment</Button>
            )}
            {may.order && (
              <Button variant="primary" onClick={() => navigate(`/purchases/orders/new?vendor=${id}`)}>
                <Plus size={16} aria-hidden="true" /> New purchase order
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="text-[12px] font-semibold text-slate-500">We owe them</div>
              <div className={`mt-1.5 text-[17px] leading-tight font-bold break-all tabular-nums ${vendor.payables > 0 ? "text-slate-900" : "text-slate-400"}`}>{money(vendor.payables)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="text-[12px] font-semibold text-slate-500">Their credits</div>
              <div className={`mt-1.5 text-[17px] leading-tight font-bold break-all tabular-nums ${vendor.credits > 0 ? "text-violet-700" : "text-slate-400"}`}>{money(vendor.credits)}</div>
            </div>
          </section>
          <Box title="Who they are">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
              <Fact label="Currency">{vendor.currency}</Fact>
              <Fact label="Pays">{vendor.paymentTerms}</Fact>
              <Fact label="TIN">{vendor.tin}</Fact>
              <Fact label="Country">{vendor.country}</Fact>
            </dl>
            <div className="flex flex-col gap-1.5 border-t border-slate-100 px-4 py-3 text-[13.5px]">
              {vendor.email && (
                <a href={`mailto:${vendor.email}`} className="inline-flex items-center gap-2 text-brand-dark hover:underline">
                  <Mail className="size-4" aria-hidden="true" /> {vendor.email}
                </a>
              )}
              {(vendor.phone || vendor.mobile) && (
                <span className="inline-flex items-center gap-2 text-slate-700">
                  <Phone className="size-4 text-slate-400" aria-hidden="true" /> {[vendor.phone, vendor.mobile].filter(Boolean).join(" · ")}
                </span>
              )}
              {vendor.billingAddress && <p className="whitespace-pre-line text-slate-600">{vendor.billingAddress}</p>}
              {!vendor.email && !vendor.phone && !vendor.mobile && !vendor.billingAddress && <span className="text-slate-400">No contact on file.</span>}
            </div>
            {vendor.people.length > 0 && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {vendor.people.map((one) => (
                  <li key={one.id} className="px-4 py-2.5 text-[13px]">
                    <div className="font-semibold">{one.name}</div>
                    <div className="text-slate-500">{[one.designation, one.email, one.phone ?? one.mobile].filter(Boolean).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            )}
          </Box>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Box title="What we buy from them" aside={<span className="text-[12px] text-slate-500">The price last time, to compare before ordering</span>}>
            {(items.data?.items ?? []).length === 0 ? (
              items.isPending ? (
                <p className="px-4 py-6 text-center text-[13px] text-slate-500">Loading…</p>
              ) : (
                <EmptyState title="Nothing bought from them yet.">What we buy from them shows here, with the price last time.</EmptyState>
              )
            ) : (
              <div className="max-h-[22rem] overflow-auto">
                <table className={TABLE}>
                  <thead className="sticky top-0">
                    <tr>
                      <th className={TH}>Item</th>
                      <th className={`${TH} text-right`}>Orders</th>
                      <th className={`${TH} text-right`}>Pieces in all</th>
                      <th className={`${TH} text-right`}>Price last time</th>
                      <th className={TH}>Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.data?.items.map((item) => (
                      <tr key={`${item.medicineId}-${item.name}`}>
                        <td className={TD}>
                          {item.medicineId ? (
                            <Link to={`/medicines/${item.medicineId}`} className="font-semibold text-slate-900 hover:text-brand">
                              {item.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{item.name}</span>
                          )}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{count(item.orders)}</td>
                        <td className={`${TD} text-right tabular-nums`}>{qty(item.qty)}</td>
                        <td className={`${TD} text-right font-semibold tabular-nums`}>{item.lastRate === null ? "—" : money(Math.round(item.lastRate * 100), item.currency ?? "PHP")}</td>
                        <td className={`${TD} whitespace-nowrap text-slate-500`}>{when(item.lastOn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Box>
          <Box title="Their records">
            <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
              {DOC_TABS.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  onClick={() => {
                    setTab(one.key);
                    setPage(1);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${tab === one.key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {one.label}
                  {counted(one.key) !== undefined && <span className="ml-1.5 opacity-75">{count(counted(one.key) ?? 0)}</span>}
                </button>
              ))}
            </div>
            {docs.data && (
              <>
                <ul className="divide-y divide-slate-100">
                  {docs.data.rows.map((row) => (
                    <li key={row.id}>
                      <Link to={docPath(tab, row.id)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13.5px] hover:bg-slate-50">
                        <span className="w-32 font-semibold text-brand">{row.number}</span>
                        <span className="text-[12px] text-slate-500">{when(row.date, docs.data.today)}</span>
                        <StatePill state={tab === "purchase_order" ? orderStage(row, docs.data.today) : docState(row, tab)} />
                        <span className="ml-auto font-semibold tabular-nums">{money(row.total, row.currency)}</span>
                        {tab === "bill" && row.balance > 0 && <span className="w-28 text-right text-[12px] text-rose-700 tabular-nums">{money(row.balance, row.currency)} due</span>}
                      </Link>
                    </li>
                  ))}
                  {docs.data.rows.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-slate-500">No {(KIND_WORD[tab] ?? "").toLowerCase()} with them.</li>}
                </ul>
                <Pager page={docs.data.page} perPage={docs.data.perPage} total={docs.data.total} onPage={setPage} />
              </>
            )}
          </Box>
        </div>
      </div>
      {editing && <NewVendorDialog vendor={vendor} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ add or change a vendor

export function NewVendorDialog({
  vendor,
  onClose,
  onSaved,
}: {
  vendor?: VendorDetail;
  onClose: () => void;
  onSaved: (id: number, name: string) => void | Promise<void>;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const [form, setForm] = useState({
    name: vendor?.name ?? "",
    company: vendor?.company ?? "",
    email: vendor?.email ?? "",
    phone: vendor?.phone ?? "",
    mobile: vendor?.mobile ?? "",
    website: vendor?.website ?? "",
    currency: vendor?.currency ?? "PHP",
    paymentTerms: vendor?.paymentTerms ?? "",
    tin: vendor?.tin ?? "",
    country: vendor?.country ?? "",
    billingAddress: vendor?.billingAddress ?? "",
    shippingAddress: vendor?.shippingAddress ?? "",
  });
  const field = (key: keyof typeof form, label: string, placeholder = "") => (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <input className={FIELD} placeholder={placeholder} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
      {action.at(key) && <span className="text-[12px] text-rose-700">{action.at(key)}</span>}
    </label>
  );
  return (
    <Dialog title={vendor ? `Change ${vendor.name}` : "New vendor"} onClose={onClose} busy={action.busy} wide>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const body = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null]));
            const saved = await api<{ id: number }>(vendor ? `/api/books/vendors/${vendor.id}` : "/api/books/vendors", { body: { ...body, name: form.name.trim(), currency: (form.currency.trim() || "PHP").toUpperCase() } });
            await queries.invalidateQueries({ queryKey: ["books"] });
            await onSaved(saved.id, form.name.trim());
          });
        }}
      >
        <div className="flex flex-wrap gap-3">
          {field("name", "Name *", "As on their invoices")}
          {field("company", "Company")}
        </div>
        <div className="flex flex-wrap gap-3">
          {field("email", "Email")}
          {field("phone", "Phone")}
          {field("mobile", "Mobile")}
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={LABEL}>Currency they bill in</span>
            <select className={FIELD} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
              {["PHP", "USD", "INR", "EUR", "CNY", "SGD"].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          {field("paymentTerms", "Payment terms", "Net 30, advance…")}
          {field("tin", "TIN")}
        </div>
        <div className="flex flex-wrap gap-3">
          {field("country", "Country")}
          {field("website", "Website")}
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Address</span>
          <textarea className={`${FIELD} h-20 py-2.5`} value={form.billingAddress} onChange={(event) => setForm({ ...form, billingAddress: event.target.value })} />
        </label>
        <Problem message={action.general(["name", "company", "email", "phone", "mobile", "currency", "paymentTerms", "tin", "country", "website"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : vendor ? "Save" : "Add vendor"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
