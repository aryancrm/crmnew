// Purchase orders in this CRM's own look: the list by where each order stands, an order's page with
// its steps down the side (Ordered → Received → Billed → Paid, a tick on each one done, the picked
// one open beside them, as the Leads case and the order page draw theirs), and the new order with
// what each medicine has on the shelf, what is coming and what it cost last time.

import type { BookDoc, InventoryList, PurchaseOrderExtra } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleSlash, ClipboardList, PackageCheck, Plus, Printer, ReceiptText, RotateCcw, Trash2, Truck, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useChoices, useMay } from "../books/forms";
import { Button, count, PageHead, PageState, Pill, Problem, Tabs, useAction } from "../ui";
import { NewVendorDialog } from "./vendors";
import {
  Box,
  Dot,
  docPath,
  docState,
  Fact,
  FIELD,
  FilesBox,
  LABEL,
  money,
  orderStage,
  Pager,
  qty,
  SearchBox,
  StatePill,
  TABLE,
  TD,
  TH,
  useBookDoc,
  useBookList,
  when,
  ZohoLink,
} from "./shared";

// ------------------------------------------------------------------ the list

type ListTab = "all" | "to_receive" | "to_bill" | "draft" | "closed" | "cancelled";

export function PurchaseOrdersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const may = useMay();
  const tab = (params.get("stage") ?? params.get("view") ?? "all") as ListTab;
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 1;
  const stage = tab === "to_receive" || tab === "to_bill" ? tab : undefined;
  const view = ["draft", "closed", "cancelled"].includes(tab) ? tab : undefined;
  const query = useBookList("purchase_order", { stage, view, q, page, perPage: 50 });
  const counts = useBookList("purchase_order", { perPage: 10 }).data;
  const toReceive = useBookList("purchase_order", { stage: "to_receive", perPage: 10 }).data?.total;
  const toBill = useBookList("purchase_order", { stage: "to_bill", perPage: 10 }).data?.total;
  const viewCount = (key: string) => counts?.views.find((one) => one.key === key)?.count ?? 0;
  const set = (next: Record<string, string | undefined>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) value ? out.set(key, value) : out.delete(key);
    setParams(out, { replace: true });
  };
  const data = query.data;
  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="Purchase orders"
        sub="Every order to a vendor, Zoho's and those made here, by where it stands"
        actions={
          <>
            <ZohoLink to="/books/purchaseorders" />
            {may.order && (
              <Button variant="primary" onClick={() => navigate("/purchases/orders/new")}>
                <Plus size={16} aria-hidden="true" /> New purchase order
              </Button>
            )}
          </>
        }
      >
        <Tabs<ListTab>
          value={tab}
          onChange={(key) => set({ stage: key === "to_receive" || key === "to_bill" ? key : undefined, view: ["draft", "closed", "cancelled"].includes(key) ? key : undefined, page: undefined })}
          tabs={[
            { key: "all", label: "All", count: counts?.total },
            { key: "to_receive", label: "To receive", count: toReceive },
            { key: "to_bill", label: "Received, to bill", count: toBill },
            { key: "draft", label: "Drafts", count: viewCount("draft") },
            { key: "closed", label: "Closed", count: viewCount("closed") },
            { key: "cancelled", label: "Cancelled", count: viewCount("cancelled") },
          ]}
        />
      </PageHead>
      <div className="flex flex-wrap gap-3">
        <SearchBox value={q} onChange={(text) => set({ q: text || undefined, page: undefined })} placeholder="Search by PO number, reference or vendor" />
      </div>
      <PageState query={query} what="the purchase orders" />
      {data && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Order</th>
                  <th className={TH}>Vendor</th>
                  <th className={TH}>Where it stands</th>
                  <th className={TH}>Received · Billed</th>
                  <th className={TH}>Expected</th>
                  <th className={`${TH} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} onClick={() => navigate(docPath("purchase_order", row.id))} className="cursor-pointer hover:bg-slate-50/70">
                    <td className={TD}>
                      <Link to={docPath("purchase_order", row.id)} onClick={(event) => event.stopPropagation()} className="font-semibold text-brand hover:underline">
                        {row.number}
                      </Link>
                      <div className="text-[12px] text-slate-500">
                        {when(row.date, data.today)}
                        {row.reference ? ` · ${row.reference}` : ""}
                      </div>
                    </td>
                    <td className={`${TD} max-w-[18rem]`}>
                      <div className="truncate font-medium">{row.party}</div>
                    </td>
                    <td className={TD}>
                      <StatePill state={orderStage(row, data.today)} />
                    </td>
                    <td className={TD}>
                      <span className="flex flex-wrap gap-3">
                        <Dot state={row.received} label="Received" />
                        <Dot state={row.billed} label="Billed" />
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{when(row.dueDate, data.today)}</td>
                    <td className={`${TD} text-right font-semibold whitespace-nowrap tabular-nums`}>{money(row.total, row.currency)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      No purchase order here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} perPage={data.perPage} total={data.total} onPage={(next) => set({ page: String(next) })} />
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one order

type Step = "ordered" | "received" | "billed" | "paid";

const leftOf = (line: BookDoc["lines"][number], what: "received" | "billed") =>
  Math.max(0, (line.qty ?? 0) - (line.qtyDone.cancelled ?? 0) - (line.qtyDone[what] ?? 0));

export function PurchaseOrderPage() {
  const id = Number(useParams().id);
  const may = useMay();
  const queries = useQueryClient();
  const action = useAction();
  const query = useBookDoc("purchase_order", id);
  const extra = useQuery({ queryKey: ["books", "purchase_order", "extra", id], queryFn: () => api<PurchaseOrderExtra>(`/api/buying/orders/${id}/extra`) });
  const choices = useChoices().data;
  const [picked, setPicked] = useState<Step | null>(null);
  const navigate = useNavigate();
  const order = query.data;
  if (!order) return <PageState query={query} what="the purchase order" />;
  const today = choices?.today ?? new Date().toISOString().slice(0, 10);

  const ordered = order.lines.reduce((sum, line) => sum + Math.max(0, (line.qty ?? 0) - (line.qtyDone.cancelled ?? 0)), 0);
  const received = order.lines.reduce((sum, line) => sum + (line.qtyDone.received ?? 0), 0);
  const toReceive = order.lines.reduce((sum, line) => sum + leftOf(line, "received"), 0);
  const toBill = order.lines.reduce((sum, line) => sum + Math.max(0, (line.qtyDone.received ?? 0) - (line.qtyDone.billed ?? 0)), 0);
  const bills = order.linkedDocs.filter((doc) => doc.kind === "bill" && doc.status !== "void");
  const billed = bills.reduce((sum, bill) => sum + bill.total, 0);
  const owed = bills.reduce((sum, bill) => sum + bill.balance, 0);
  const open = !["draft", "cancelled", "closed", "void"].includes(order.status);
  const stage = orderStage(order, today);

  const steps: { key: Step; label: string; icon: typeof Check; done: boolean; sub: string }[] = [
    { key: "ordered", label: "Ordered", icon: ClipboardList, done: order.status !== "draft" && order.status !== "cancelled", sub: order.status === "draft" ? "A draft: not sent yet" : `${qty(ordered)} pieces · ${money(order.total, order.currency)}` },
    { key: "received", label: "Received", icon: PackageCheck, done: ordered > 0 && toReceive === 0 && received > 0, sub: `${qty(received)} of ${qty(ordered)} in${toReceive > 0 && open ? ` · ${qty(toReceive)} to come` : ""}` },
    { key: "billed", label: "Billed", icon: ReceiptText, done: received > 0 && toBill === 0 && order.billed === "full", sub: bills.length ? `${bills.length} ${bills.length === 1 ? "bill" : "bills"} · ${money(billed, order.currency)}` : "No bill yet" },
    { key: "paid", label: "Paid", icon: Wallet, done: bills.length > 0 && owed === 0 && order.billed === "full", sub: bills.length ? (owed ? `${money(owed, order.currency)} still to pay` : "All paid") : "Nothing billed yet" },
  ];
  // The step to open first: the first one not done.
  const first = steps.find((step) => !step.done)?.key ?? "paid";
  const at = picked ?? first;
  const refresh = async () => {
    await queries.invalidateQueries({ queryKey: ["books"] });
    await queries.invalidateQueries({ queryKey: ["inventory"] });
  };
  const setStatus = (to: "issued" | "cancelled" | "closed" | "reopen") =>
    void action.run(async () => {
      await api(`/api/books/purchase_order/${id}/status`, { body: { to } });
      await refresh();
    });

  return (
    <>
    {extra.data && <PrintedOrder order={order} extra={extra.data} />}
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4 print:hidden">
      <PageHead
        title={order.number}
        tags={<StatePill state={stage} />}
        sub={
          <>
            {order.vendor ? (
              <Link to={`/purchases/vendors/${order.vendor.id}`} className="font-medium text-brand-dark hover:underline">
                {order.vendor.name}
              </Link>
            ) : (
              order.party
            )}
            {order.fromZoho ? " · from Zoho" : ""}
          </>
        }
        actions={
          <>
            <ZohoLink to={`/books/purchaseorders/${id}`} />
            <Button onClick={() => window.print()} title="Print it, or save it as a PDF to send the vendor">
              <Printer size={16} aria-hidden="true" /> Print / PDF
            </Button>
            {may.bill && order.status !== "draft" && order.status !== "cancelled" && (
              <Button onClick={() => navigate(`/purchases/bills/new?landed=${id}`)}>
                <Plus size={16} aria-hidden="true" /> Add extra cost
              </Button>
            )}
            {may.order && order.status === "draft" && (
              <Button variant="primary" disabled={action.busy} onClick={() => setStatus("issued")}>
                <Truck size={16} aria-hidden="true" /> Send it (issued)
              </Button>
            )}
            {may.order && open && received === 0 && (order.billed ?? "none") === "none" && (
              <Button variant="danger" disabled={action.busy} onClick={() => window.confirm(`Cancel ${order.number}? Nothing came or was billed on it.`) && setStatus("cancelled")}>
                <CircleSlash size={16} aria-hidden="true" /> Cancel order
              </Button>
            )}
            {may.order && open && received > 0 && toReceive > 0 && (
              <Button disabled={action.busy} onClick={() => window.confirm(`Close ${order.number}? The ${qty(toReceive)} pieces still to come stop counting as coming.`) && setStatus("closed")}>
                <CircleSlash size={16} aria-hidden="true" /> Close the rest
              </Button>
            )}
            {may.order && order.status === "closed" && (
              <Button disabled={action.busy} onClick={() => setStatus("reopen")}>
                <RotateCcw size={16} aria-hidden="true" /> Reopen
              </Button>
            )}
          </>
        }
      />
      <Problem message={action.problem?.message} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-2xs sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Ordered on">{when(order.date, today)}</Fact>
        <Fact label="Expected">
          {order.dueDate ? <span className={order.dueDate < today && toReceive > 0 && open ? "text-rose-700" : ""}>{when(order.dueDate, today)}</span> : "—"}
        </Fact>
        <Fact label="Deliver to">{String(order.fields["Warehouse Name"] ?? "") || order.lines.find((line) => line.warehouse)?.warehouse}</Fact>
        <Fact label="Pays">{order.paymentTerms}</Fact>
        <Fact label="Currency">{order.currency === "PHP" ? "Pesos" : `${order.currency} at ₱${order.fxRate}`}</Fact>
        <Fact label="Total">
          {money(order.total, order.currency)}
          {order.currency !== "PHP" && <span className="text-[12px] text-slate-500"> · {money(Math.round(order.total * order.fxRate))}</span>}
        </Fact>
      </dl>

      <div className="grid items-start gap-4 lg:grid-cols-[17rem_1fr]">
        {/* The steps, as the Leads case draws them: a tick on each one done, the picked one open beside. */}
        <nav aria-label="Steps" className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xs lg:sticky lg:top-4">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">The order's steps</div>
          {steps.map((step, n) => {
            const Icon = step.icon;
            const now = step.key === at;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => setPicked(step.key)}
                className={`flex items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${now ? "bg-brand-tint ring-1 ring-brand/25" : "hover:bg-slate-50"}`}
              >
                <span className={`relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${step.done ? "bg-emerald-50 text-emerald-700" : now ? "bg-white text-brand" : "bg-slate-100 text-slate-500"}`}>
                  <Icon className="size-4" aria-hidden="true" />
                  <span className={`absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full text-[9px] font-bold ring-2 ring-white ${step.done ? "bg-emerald-600 text-white" : "bg-slate-300 text-white"}`}>
                    {step.done ? <Check className="size-2.5" aria-hidden="true" /> : n + 1}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-slate-900">{step.label}</span>
                  <span className="block text-[12px] text-slate-500">{step.sub}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          {at === "ordered" && <OrderedPanel order={order} />}
          {at === "received" && (
            <ReceivedPanel order={order} extra={extra.data} canReceive={may.order && open && toReceive > 0} warehouses={choices?.warehouses ?? []} today={today} onDone={refresh} />
          )}
          {at === "billed" && <BilledPanel order={order} extra={extra.data} canBill={may.bill && toBill > 0 && order.status !== "cancelled"} today={today} onDone={refresh} />}
          {at === "paid" && <PaidPanel order={order} canPay={may.pay} today={today} />}
          <ExtraCosts order={order} extra={extra.data} canAdd={may.bill && order.status !== "draft" && order.status !== "cancelled"} today={today} />
          <FilesBox doc={order} />
        </div>
      </div>
    </div>
    </>
  );
}

/** The purchase order as the vendor gets it (Print, or Save as PDF): whose order, to whom, where
 *  to deliver, what, at what price, the terms, and lines to sign. Only on paper. */
function PrintedOrder({ order, extra }: { order: BookDoc; extra: PurchaseOrderExtra }) {
  const company = extra.company;
  const warehouse = String(order.fields["Warehouse Name"] ?? "") || order.lines.find((line) => line.warehouse)?.warehouse || "";
  const terms = String(order.fields["Terms & Conditions"] ?? order.fields.terms ?? "");
  const taxed = order.lines.some((line) => line.taxPct);
  return (
    <article className="hidden bg-white text-[12.5px] text-slate-900 print:block">
      <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-4">
        <div>
          <div className="text-[18px] font-bold">{company.name}</div>
          {company.address && <div className="whitespace-pre-line text-slate-600">{company.address}</div>}
          <div className="text-slate-600">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>
          {company.tin && <div className="text-slate-600">TIN {company.tin}</div>}
        </div>
        <div className="text-right">
          <div className="text-[22px] font-bold tracking-wide">PURCHASE ORDER</div>
          <div className="mt-1 text-[14px] font-semibold">{order.number}</div>
          <div className="text-slate-600">Date: {when(order.date)}</div>
          {order.dueDate && <div className="text-slate-600">Deliver by: {when(order.dueDate)}</div>}
          {order.reference && <div className="text-slate-600">Your reference: {order.reference}</div>}
        </div>
      </header>
      <section className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[10.5px] font-bold tracking-wider text-slate-500 uppercase">Vendor</div>
          <div className="mt-1 font-semibold">{order.vendor?.name ?? order.party}</div>
          {order.vendor?.address && <div className="whitespace-pre-line text-slate-600">{order.vendor.address}</div>}
          <div className="text-slate-600">{[order.vendor?.email, order.vendor?.phone].filter(Boolean).join(" · ")}</div>
        </div>
        <div>
          <div className="text-[10.5px] font-bold tracking-wider text-slate-500 uppercase">Deliver to</div>
          <div className="mt-1 font-semibold">{warehouse || company.name}</div>
          {company.address && <div className="whitespace-pre-line text-slate-600">{company.address}</div>}
        </div>
      </section>
      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="border-y border-slate-900 text-left text-[10.5px] font-bold tracking-wider uppercase">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">Item and description</th>
            <th className="py-2 pr-2 text-right">Qty</th>
            <th className="py-2 pr-2 text-right">Rate ({order.currency})</th>
            {taxed && <th className="py-2 pr-2 text-right">Tax</th>}
            <th className="py-2 text-right">Amount ({order.currency})</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line, n) => (
            <tr key={line.id} className="border-b border-slate-200 align-top">
              <td className="py-2 pr-2">{n + 1}</td>
              <td className="py-2 pr-2">
                <div className="font-semibold">{line.medicine ?? line.itemName ?? line.account}</div>
                <div className="text-slate-600">{[line.sku && `SKU ${line.sku}`, line.description].filter(Boolean).join(" · ")}</div>
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{qty(line.qty)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{money(Math.round((line.rate ?? 0) * 100), order.currency)}</td>
              {taxed && <td className="py-2 pr-2 text-right">{line.taxPct ? `${line.taxPct}%` : ""}</td>}
              <td className="py-2 text-right font-semibold tabular-nums">{money(line.amount, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex justify-end">
        <dl className="w-72 space-y-1">
          {order.subTotal !== null && order.subTotal !== order.total && (
            <div className="flex justify-between">
              <dt>Sub total</dt>
              <dd className="tabular-nums">{money(order.subTotal, order.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t-2 border-slate-900 pt-1.5 text-[15px] font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(order.total, order.currency)}</dd>
          </div>
        </dl>
      </div>
      <section className="mt-5 grid grid-cols-2 gap-6">
        <div>
          {order.paymentTerms && (
            <p>
              <b>Payment terms:</b> {order.paymentTerms}
            </p>
          )}
          {order.notes && <p className="mt-1 whitespace-pre-line">{order.notes}</p>}
        </div>
        {terms && (
          <div>
            <div className="text-[10.5px] font-bold tracking-wider text-slate-500 uppercase">Terms and conditions</div>
            <p className="mt-1 whitespace-pre-line">{terms}</p>
          </div>
        )}
      </section>
      <section className="mt-14 grid grid-cols-2 gap-16">
        <div className="border-t border-slate-900 pt-1 text-center text-slate-600">Prepared by</div>
        <div className="border-t border-slate-900 pt-1 text-center text-slate-600">Approved by</div>
      </section>
      {company.footer && <footer className="mt-8 text-center text-[11px] text-slate-500">{company.footer}</footer>}
    </article>
  );
}

function LinesTable({ order }: { order: BookDoc }) {
  return (
    <div className="overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr>
            <th className={TH}>Item</th>
            <th className={`${TH} text-right`}>Ordered</th>
            <th className={`${TH} text-right`}>Rate</th>
            <th className={`${TH} text-right`}>Amount</th>
            <th className={`${TH} text-right`}>Received</th>
            <th className={`${TH} text-right`}>Billed</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td className={TD}>
                {line.medicineId ? (
                  <Link to={`/medicines/${line.medicineId}`} className="font-semibold text-slate-900 hover:text-brand">
                    {line.medicine ?? line.itemName}
                  </Link>
                ) : (
                  <span className="font-semibold">{line.itemName ?? line.account}</span>
                )}
                <div className="text-[12px] text-slate-500">{[line.sku, line.description].filter(Boolean).join(" · ")}</div>
              </td>
              <td className={`${TD} text-right tabular-nums`}>
                {qty(line.qty)}
                {(line.qtyDone.cancelled ?? 0) > 0 && <div className="text-[11px] text-slate-500">{qty(line.qtyDone.cancelled)} cancelled</div>}
              </td>
              <td className={`${TD} text-right tabular-nums`}>{money(Math.round((line.rate ?? 0) * 100), order.currency)}</td>
              <td className={`${TD} text-right font-semibold tabular-nums`}>{money(line.amount, order.currency)}</td>
              <td className={`${TD} text-right tabular-nums`}>{qty(line.qtyDone.received ?? 0)}</td>
              <td className={`${TD} text-right tabular-nums`}>{qty(line.qtyDone.billed ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderedPanel({ order }: { order: BookDoc }) {
  const terms = String(order.fields["Terms & Conditions"] ?? order.fields.terms ?? "");
  return (
    <>
      <Box title="What was ordered" aside={<span className="text-[12px] text-slate-500">{order.lines.length} {order.lines.length === 1 ? "line" : "lines"}</span>}>
        <LinesTable order={order} />
        <div className="flex justify-end border-t border-slate-100 px-4 py-3">
          <dl className="w-full max-w-xs space-y-1 text-[13.5px]">
            {order.subTotal !== null && order.subTotal !== order.total && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Before tax</dt>
                <dd className="tabular-nums">{money(order.subTotal, order.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-1.5 text-[15px] font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(order.total, order.currency)}</dd>
            </div>
          </dl>
        </div>
      </Box>
      {(order.notes || terms) && (
        <Box title="Notes and terms">
          <div className="grid gap-4 px-4 py-3 text-[13.5px] sm:grid-cols-2">
            {order.notes && (
              <div>
                <div className={LABEL}>Notes</div>
                <p className="mt-1 whitespace-pre-line text-slate-700">{order.notes}</p>
              </div>
            )}
            {terms && (
              <div>
                <div className={LABEL}>Terms &amp; conditions</div>
                <p className="mt-1 whitespace-pre-line text-slate-700">{terms}</p>
              </div>
            )}
          </div>
        </Box>
      )}
    </>
  );
}

function ReceivedPanel({
  order,
  extra,
  canReceive,
  warehouses,
  today,
  onDone,
}: {
  order: BookDoc;
  extra: PurchaseOrderExtra | undefined;
  canReceive: boolean;
  warehouses: { id: number; name: string }[];
  today: string;
  onDone: () => Promise<void>;
}) {
  const action = useAction();
  const [entries, setEntries] = useState<Record<number, { qty: string; batchNo: string; expiresOn: string }>>({});
  const [date, setDate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const entry = (lineId: number) => entries[lineId] ?? { qty: "", batchNo: "", expiresOn: "" };
  const set = (lineId: number, change: Partial<{ qty: string; batchNo: string; expiresOn: string }>) => setEntries({ ...entries, [lineId]: { ...entry(lineId), ...change } });
  const waiting = order.lines.filter((line) => leftOf(line, "received") > 0);
  const named = String(order.fields["Warehouse Name"] ?? "") || order.lines.find((line) => line.warehouse)?.warehouse || "";
  const known = warehouses.find((one) => one.name.toLowerCase() === named.toLowerCase());
  const needsWarehouse = !known;
  const batches = extra?.batches ?? [];
  const lineName = (lineId: number | null) => {
    const line = order.lines.find((one) => one.id === lineId);
    return line ? (line.medicine ?? line.itemName ?? line.account ?? "") : "";
  };
  return (
    <>
      {canReceive && (
        <Box title="Receive what came" aside={<span className="text-[12px] text-slate-500">Each medicine goes on the shelf in its batch</span>}>
          <div className="flex flex-col gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Received on</span>
                <input type="date" className={FIELD} value={date || today} onChange={(event) => setDate(event.target.value)} />
              </label>
              {known && (
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Into warehouse</span>
                  <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[14px]">{known.name}</div>
                </div>
              )}
              {needsWarehouse && (
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Into warehouse</span>
                  <select className={FIELD} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                    <option value="">Pick</option>
                    {warehouses.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Item</th>
                    <th className={`${TH} text-right`}>Still to come</th>
                    <th className={`${TH} w-32 text-right`}>Came now</th>
                    <th className={`${TH} w-40`}>Batch no.</th>
                    <th className={`${TH} w-44`}>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((line) => {
                    const n = order.lines.indexOf(line);
                    const wrong = action.at(`lines.${n}.qty`) ?? action.at(`lines.${n}.batchNo`) ?? action.at(`lines.${n}.expiresOn`);
                    return (
                      <tr key={line.id} className="align-top">
                        <td className={TD}>
                          <div className="font-semibold">{line.medicine ?? line.itemName ?? line.account}</div>
                          {!line.medicineId && <div className="text-[11.5px] text-slate-500">Not a medicine: no stock moves</div>}
                          {wrong && <div className="mt-1 text-[12px] text-rose-700">{wrong}</div>}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{qty(leftOf(line, "received"))}</td>
                        <td className={TD}>
                          <div className="flex items-center gap-1">
                            <input className={`${FIELD} h-10 text-right`} inputMode="numeric" placeholder="0" value={entry(line.id).qty} onChange={(event) => set(line.id, { qty: event.target.value })} />
                            <button type="button" className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand-tint" onClick={() => set(line.id, { qty: String(leftOf(line, "received")) })}>
                              All
                            </button>
                          </div>
                        </td>
                        <td className={TD}>{line.medicineId && <input className={`${FIELD} h-10 uppercase`} placeholder="On the box" value={entry(line.id).batchNo} onChange={(event) => set(line.id, { batchNo: event.target.value })} />}</td>
                        <td className={TD}>{line.medicineId && <input type="date" className={`${FIELD} h-10`} value={entry(line.id).expiresOn} onChange={(event) => set(line.id, { expiresOn: event.target.value })} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Note (optional)</span>
              <input className={FIELD} placeholder="Two boxes dented, courier's waybill…" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <Problem message={action.problem && !action.problem.field?.startsWith("lines.") ? action.problem.message : null} />
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api(`/api/books/purchase_order/${order.id}/receive`, {
                      body: {
                        date: date || today,
                        notes: notes || null,
                        warehouseId: warehouseId ? Number(warehouseId) : (known?.id ?? null),
                        lines: order.lines.map((line) => ({
                          lineId: line.id,
                          qty: Number(entry(line.id).qty) || 0,
                          batchNo: entry(line.id).batchNo || null,
                          expiresOn: entry(line.id).expiresOn || null,
                        })),
                      },
                    });
                    setEntries({});
                    setNotes("");
                    await onDone();
                  })
                }
              >
                <PackageCheck size={16} aria-hidden="true" /> {action.busy ? "Saving…" : "Put on the shelf"}
              </Button>
            </div>
          </div>
        </Box>
      )}
      <Box title="What came in" aside={<span className="text-[12px] text-slate-500">Cost of one piece: at the order's price, and now (with freight, customs…)</span>}>
        {batches.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">{order.fromZoho ? "Received in Zoho before the switch: the receives are in Zoho's view." : "Nothing came yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Receive</th>
                  <th className={TH}>Item</th>
                  <th className={TH}>Batch · expiry</th>
                  <th className={`${TH} text-right`}>Pieces</th>
                  <th className={TH}>Warehouse</th>
                  <th className={`${TH} text-right`}>At order price</th>
                  <th className={`${TH} text-right`}>Landed now</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((one) => (
                  <tr key={`${one.receiveId}-${one.lineId}-${one.batchNo}`}>
                    <td className={TD}>
                      <Link to={docPath("purchase_receive", one.receiveId)} className="font-semibold text-brand hover:underline">
                        {one.receive}
                      </Link>
                      <div className="text-[12px] text-slate-500">{when(one.date, today)}</div>
                    </td>
                    <td className={TD}>{lineName(one.lineId)}</td>
                    <td className={TD}>
                      {one.batchNo ?? "—"}
                      {one.expiresOn && <div className="text-[12px] text-slate-500">{when(one.expiresOn)}</div>}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{qty(one.qty)}</td>
                    <td className={TD}>{one.warehouse ?? "—"}</td>
                    <td className={`${TD} text-right tabular-nums`}>{money(one.orderCost)}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>
                      {one.costNow === null ? "—" : money(one.costNow)}
                      {one.costNow !== null && one.costNow > one.orderCost && <div className="text-[11.5px] font-normal text-violet-700">+{money(one.costNow - one.orderCost)} landed</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </>
  );
}

function BilledPanel({ order, extra, canBill, today, onDone }: { order: BookDoc; extra: PurchaseOrderExtra | undefined; canBill: boolean; today: string; onDone: () => Promise<void> }) {
  const action = useAction();
  const [form, setForm] = useState({ number: "", date: "", dueDate: "", notes: "" });
  const [entries, setEntries] = useState<Record<number, { qty: string; rate: string }>>({});
  const toBill = (line: BookDoc["lines"][number]) => Math.max(0, (line.qtyDone.received ?? 0) - (line.qtyDone.billed ?? 0));
  const entry = (line: BookDoc["lines"][number]) => entries[line.id] ?? { qty: String(toBill(line)), rate: String(line.rate ?? 0) };
  const total = order.lines.reduce((sum, line) => sum + Math.round((Number(entry(line).qty) || 0) * (Number(entry(line).rate) || 0) * 100 * (1 + (line.taxPct ?? 0) / 100)), 0);
  const bills = order.linkedDocs.filter((doc) => doc.kind === "bill");
  return (
    <>
      <Box title="The vendor's bills for this order">
        {bills.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-slate-500">No bill yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {bills.map((bill) => (
              <li key={bill.id}>
                <Link to={docPath("bill", bill.id)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13.5px] hover:bg-slate-50">
                  <span className="w-36 font-semibold text-brand">{bill.number}</span>
                  <span className="text-[12px] text-slate-500">{when(bill.date, today)}</span>
                  <StatePill state={docState({ status: bill.status, balance: bill.balance, total: bill.total, overdueDays: null }, "bill")} />
                  <span className="ml-auto font-semibold tabular-nums">{money(bill.total, order.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Box>
      {canBill && (
        <Box title="Enter the vendor's bill" aside={<span className="text-[12px] text-slate-500">For what came and is not billed yet</span>}>
          <div className="flex flex-col gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Their bill number *</span>
                <input className={FIELD} placeholder="As on their invoice" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} />
                {action.at("number") && <span className="text-[12px] text-rose-700">{action.at("number")}</span>}
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Bill date</span>
                <input type="date" className={FIELD} value={form.date || today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Due</span>
                <input type="date" className={FIELD} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
              </label>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Item</th>
                    <th className={`${TH} text-right`}>Received, not billed</th>
                    <th className={`${TH} w-32 text-right`}>Bill</th>
                    <th className={`${TH} w-36 text-right`}>Rate ({order.currency})</th>
                    <th className={`${TH} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line, n) => (
                    <tr key={line.id}>
                      <td className={TD}>
                        <span className="font-semibold">{line.medicine ?? line.itemName ?? line.account}</span>
                        {action.at(`orderLines.${n}.qty`) && <div className="text-[12px] text-rose-700">{action.at(`orderLines.${n}.qty`)}</div>}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{qty(toBill(line))}</td>
                      <td className={TD}>
                        <input className={`${FIELD} h-10 text-right`} inputMode="decimal" value={entry(line).qty} onChange={(event) => setEntries({ ...entries, [line.id]: { ...entry(line), qty: event.target.value } })} />
                      </td>
                      <td className={TD}>
                        <input className={`${FIELD} h-10 text-right`} inputMode="decimal" value={entry(line).rate} onChange={(event) => setEntries({ ...entries, [line.id]: { ...entry(line), rate: event.target.value } })} />
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{money(Math.round((Number(entry(line).qty) || 0) * (Number(entry(line).rate) || 0) * 100), order.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Problem message={action.problem && !action.problem.field ? action.problem.message : null} />
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-[15px] font-semibold">Bill total {money(total, order.currency)}</span>
              <Button
                variant="primary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api(`/api/books/purchase_order/${order.id}/bill`, {
                      body: {
                        number: form.number,
                        date: form.date || today,
                        dueDate: form.dueDate || null,
                        notes: form.notes || null,
                        orderLines: order.lines.map((line) => ({ lineId: line.id, qty: Number(entry(line).qty) || 0, rate: Number(entry(line).rate) || 0 })),
                      },
                    });
                    setEntries({});
                    setForm({ number: "", date: "", dueDate: "", notes: "" });
                    await onDone();
                  })
                }
              >
                <ReceiptText size={16} aria-hidden="true" /> {action.busy ? "Saving…" : "Save the bill"}
              </Button>
            </div>
          </div>
        </Box>
      )}
    </>
  );
}

/** Every extra cost on these goods — freight, airfare, travel, customs, insurance, anything — as
 *  bills that are part of what the goods cost (landed cost): shared over the order's goods by
 *  value; the part for goods still to come waits for them. */
function ExtraCosts({ order, extra, canAdd, today }: { order: BookDoc; extra: PurchaseOrderExtra | undefined; canAdd: boolean; today: string }) {
  const landed = (extra?.landed ?? []).filter((bill) => bill.status !== "void");
  const total = landed.reduce((sum, bill) => sum + bill.amount, 0);
  const waiting = landed.reduce((sum, bill) => sum + bill.pending, 0);
  return (
    <Box
      title={
        <>
          Extra costs on these goods
          {total > 0 && <span className="ml-2 text-[13px] font-semibold text-violet-700">{money(total)}</span>}
        </>
      }
      aside={
        canAdd ? (
          <Link to={`/purchases/bills/new?landed=${order.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-semibold text-white hover:bg-brand-dark">
            <Plus className="size-3.5" aria-hidden="true" /> Add extra cost
          </Link>
        ) : undefined
      }
    >
      {landed.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-slate-500">
          Freight, airfare, travel, customs, insurance, packaging — any extra paid for these goods. Added here, it is shared over the goods by value and each piece costs more, so the margin on every sale is right. It can be added before the goods come.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {extra?.landed.map((bill) => (
              <li key={bill.id}>
                <Link to={docPath("bill", bill.id)} className="flex flex-wrap items-center gap-x-4 px-4 py-3 text-[13.5px] hover:bg-slate-50">
                  <span className="w-36 font-semibold text-brand">{bill.number}</span>
                  <span className="min-w-0 flex-1 truncate">{bill.vendor}</span>
                  <span className="text-[12px] text-slate-500">{when(bill.date, today)}</span>
                  {bill.status === "void" && <Pill>Void</Pill>}
                  {bill.pending > 0 && bill.status !== "void" && <span className="text-[12px] text-amber-700">{money(bill.pending)} waits for the goods</span>}
                  <span className="font-semibold tabular-nums">{money(bill.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {waiting > 0 && (
            <p className="border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
              {money(waiting)} goes on the goods still to come, as each delivery is received.
            </p>
          )}
        </>
      )}
    </Box>
  );
}

function PaidPanel({ order, canPay, today }: { order: BookDoc; canPay: boolean; today: string }) {
  const bills = order.linkedDocs.filter((doc) => doc.kind === "bill" && doc.status !== "void");
  const vendorId = order.vendor?.id;
  return (
    <Box title="Paying the vendor" aside={<span className="text-[12px] text-slate-500">Finance records each payment</span>}>
      {bills.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-slate-500">Nothing to pay before the vendor's bill is entered (step 3).</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {bills.map((bill) => (
            <li key={bill.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[13.5px]">
              <Link to={docPath("bill", bill.id)} className="w-36 font-semibold text-brand hover:underline">
                {bill.number}
              </Link>
              <span className="text-[12px] text-slate-500">{when(bill.date, today)}</span>
              <span className="tabular-nums">{money(bill.total, order.currency)}</span>
              <span className={`ml-auto font-semibold tabular-nums ${bill.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {bill.balance > 0 ? `${money(bill.balance, order.currency)} to pay` : "Paid"}
              </span>
              {canPay && bill.balance > 0 && vendorId && (
                <Link to={`/purchases/payments/new?vendor=${vendorId}&bill=${bill.id}`} className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12.5px] font-semibold text-white hover:bg-brand-dark">
                  Record payment
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}

// ------------------------------------------------------------------ a new order

type Row = { key: number; medicineId: number | null; text: string; qty: string; rate: string; taxPct: string };
let rowKey = 0;
const blank = (): Row => ({ key: ++rowKey, medicineId: null, text: "", qty: "", rate: "", taxPct: "" });

export function NewPurchaseOrder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choicesQuery = useChoices();
  const choices = choicesQuery.data;
  const stock = useQuery({ queryKey: ["inventory", "list"], queryFn: () => api<InventoryList>("/api/inventory") });
  const [vendorId, setVendorId] = useState<number | null>(Number(params.get("vendor")) || null);
  const [vendorText, setVendorText] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ reference: "", date: "", deliveryDate: "", paymentTerms: "", warehouseId: "", fxRate: "", notes: "", terms: "" });
  const [rows, setRows] = useState<Row[]>(() => {
    const first = blank();
    const asked = Number(params.get("medicine"));
    return [asked ? { ...first, medicineId: asked } : first];
  });
  const rates = useQuery({
    queryKey: ["books", "rates", vendorId],
    queryFn: () => api<Record<number, { rate: number; currency: string; on: string; vendor: string | null }>>(`/api/buying/rates${vendorId ? `?supplierId=${vendorId}` : ""}`),
  });
  const anyRates = useQuery({
    queryKey: ["books", "rates", null],
    queryFn: () => api<Record<number, { rate: number; currency: string; on: string; vendor: string | null }>>("/api/buying/rates"),
  });
  const byId = useMemo(() => new Map((stock.data?.medicines ?? []).map((row) => [row.id, row])), [stock.data]);
  const vendorCurrency = choices?.vendors.find((one) => one.id === vendorId)?.currency ?? "PHP";
  // A line that came with its medicine (from "Buy again") gets the price paid last time, once known.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the prices arrive
  useEffect(() => {
    if (!rates.data || !anyRates.data) return;
    setRows((now) =>
      now.map((row) => {
        if (!row.medicineId || row.rate) return row;
        const price = rates.data?.[row.medicineId] ?? anyRates.data?.[row.medicineId];
        return price && price.currency === vendorCurrency ? { ...row, rate: String(price.rate) } : row;
      }),
    );
  }, [rates.data, anyRates.data, vendorCurrency]);
  if (!choices) return <PageState query={choicesQuery} what="the vendors" />;
  const vendor = choices.vendors.find((one) => one.id === vendorId);
  const currency = vendor?.currency ?? "PHP";
  const warehouseId = form.warehouseId || String(choices.warehouses[0]?.id ?? "");
  const nameOf = (id: number) => choices.medicines.find((one) => one.id === id)?.name ?? "";
  const set = (key: number, change: Partial<Row>) => setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const amount = (row: Row) => Math.round((Number(row.qty) || 0) * (Number(row.rate) || 0) * 100);
  const tax = (row: Row) => Math.round((amount(row) * (Number(row.taxPct) || 0)) / 100);
  const subTotal = rows.reduce((sum, row) => sum + amount(row), 0);
  const taxTotal = rows.reduce((sum, row) => sum + tax(row), 0);
  const last = (medicineId: number | null) => (medicineId ? (rates.data?.[medicineId] ?? anyRates.data?.[medicineId]) : undefined);
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
          lines: rows
            .filter((row) => row.medicineId || row.text.trim())
            .map((row) => ({
              medicineId: row.medicineId,
              itemName: row.medicineId ? null : row.text.trim(),
              qty: Number(row.qty) || 0,
              rate: Number(row.rate) || 0,
              taxPct: row.taxPct ? Number(row.taxPct) : null,
            })),
        },
      });
      await queries.invalidateQueries({ queryKey: ["books"] });
      await queries.invalidateQueries({ queryKey: ["inventory"] });
      navigate(docPath("purchase_order", made.id));
    });
  const card = "rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-18px_rgba(15,23,42,0.18)]";
  const head = (n: number, title: string, sub: string) => (
    <div className="flex items-center gap-3 rounded-t-2xl border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-5 py-3.5">
      <span className="grid size-7 place-items-center rounded-full bg-slate-800 text-[12px] font-bold text-white">{n}</span>
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        <p className="text-[12px] text-slate-500">{sub}</p>
      </div>
    </div>
  );
  const vendorName = vendor?.name ?? vendorText;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-4">
      <PageHead
        title="New purchase order"
        sub={`Number ${choices.next.purchaseOrder} · what we buy, from whom, delivered where`}
        actions={<ZohoLink to="/books/purchaseorders/new" />}
      />
      <section className={card}>
        {head(1, "Vendor and delivery", "Who sells it, where it comes, when and how we pay")}
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={LABEL}>Vendor *</span>
            <div className="flex gap-2">
              <input
                className={FIELD}
                list="buy-vendors"
                placeholder="Type the vendor's name"
                value={vendorName}
                onChange={(event) => {
                  setVendorText(event.target.value);
                  const found = choices.vendors.find((one) => one.name.toLowerCase() === event.target.value.trim().toLowerCase());
                  setVendorId(found?.id ?? null);
                }}
              />
              <Button onClick={() => setAdding(true)}>
                <Plus size={16} aria-hidden="true" /> New vendor
              </Button>
            </div>
            <datalist id="buy-vendors">
              {choices.vendors.map((one) => (
                <option key={one.id} value={one.name} />
              ))}
            </datalist>
            {action.at("supplierId") && <span className="text-[12px] text-rose-700">{action.at("supplierId")}</span>}
            {vendor && (
              <span className="text-[12px] text-slate-500">
                Bills in {vendor.currency}
                {vendor.paymentTerms ? ` · usually pays ${vendor.paymentTerms}` : ""} ·{" "}
                <Link to={`/purchases/vendors/${vendor.id}`} className="font-semibold text-brand-dark hover:underline" target="_blank">
                  what we buy from them
                </Link>
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Deliver to *</span>
            <select className={FIELD} value={warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}>
              {choices.warehouses.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Their reference (optional)</span>
            <input className={FIELD} placeholder="Proforma, quotation no." value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Order date</span>
            <input type="date" className={FIELD} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Expected</span>
            <input type="date" className={FIELD} value={form.deliveryDate} onChange={(event) => setForm({ ...form, deliveryDate: event.target.value })} />
            {action.at("deliveryDate") && <span className="text-[12px] text-rose-700">{action.at("deliveryDate")}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Payment terms</span>
            <input className={FIELD} placeholder={vendor?.paymentTerms ?? "Net 30, advance…"} value={form.paymentTerms} onChange={(event) => setForm({ ...form, paymentTerms: event.target.value })} />
          </label>
          {currency !== "PHP" && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Pesos for one {currency} *</span>
              <input className={FIELD} inputMode="decimal" placeholder="57.20" value={form.fxRate} onChange={(event) => setForm({ ...form, fxRate: event.target.value })} />
              {action.at("fxRate") && <span className="text-[12px] text-rose-700">{action.at("fxRate")}</span>}
            </label>
          )}
        </div>
      </section>

      <section className={card}>
        {head(2, "What we buy", `Prices in ${currency}, for one piece. The last price paid fills in by itself.`)}
        <datalist id="buy-medicines">
          {choices.medicines.map((one) => (
            <option key={one.id} value={one.name}>
              {one.sku ?? ""}
            </option>
          ))}
        </datalist>
        <div className="flex flex-col divide-y divide-slate-100">
          {rows.map((row, n) => {
            const info = row.medicineId ? byId.get(row.medicineId) : undefined;
            const before = last(row.medicineId);
            const wrong = action.at(`lines.${n}.medicineId`) ?? action.at(`lines.${n}.qty`) ?? action.at(`lines.${n}.rate`);
            return (
              <div key={row.key} className="flex flex-col gap-2 px-5 py-4">
                <div className="grid items-end gap-3 md:grid-cols-[1fr_7rem_8rem_5rem_8rem_2.5rem]">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Medicine or item</span>
                    <input
                      className={FIELD}
                      list="buy-medicines"
                      placeholder="Type a medicine (or any item: packaging, styro box…)"
                      value={row.medicineId ? nameOf(row.medicineId) : row.text}
                      onChange={(event) => {
                        const found = choices.medicines.find((one) => one.name.toLowerCase() === event.target.value.trim().toLowerCase());
                        const price = found ? (rates.data?.[found.id] ?? anyRates.data?.[found.id]) : undefined;
                        set(row.key, {
                          medicineId: found?.id ?? null,
                          text: event.target.value,
                          rate: found && !row.rate && price && price.currency === currency ? String(price.rate) : row.rate,
                        });
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Pieces</span>
                    <input className={`${FIELD} text-right`} inputMode="numeric" placeholder="0" value={row.qty} onChange={(event) => set(row.key, { qty: event.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Price a piece</span>
                    <input className={`${FIELD} text-right`} inputMode="decimal" placeholder="0.00" value={row.rate} onChange={(event) => set(row.key, { rate: event.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Tax %</span>
                    <input className={`${FIELD} text-right`} inputMode="decimal" placeholder="0" value={row.taxPct} onChange={(event) => set(row.key, { taxPct: event.target.value })} />
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className={LABEL}>Amount</span>
                    <div className="flex h-11 items-center justify-end rounded-xl bg-slate-50 px-3 text-[14px] font-semibold tabular-nums">{money(amount(row), currency)}</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove this line"
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((one) => one.key !== row.key))}
                    className="grid h-11 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {(info || before) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500">
                    {info && (
                      <>
                        <span>
                          Free on the shelf <b className={info.free <= info.reorderLevel ? "text-rose-700" : "text-slate-700"}>{count(info.free)}</b>
                        </span>
                        {info.reorderLevel > 0 && <span>Low at {count(info.reorderLevel)}</span>}
                        {info.coming && <span className="text-sky-700">{count(info.coming.qty)} already coming</span>}
                        {info.packSize > 1 && info.pack && <span>{info.pack}</span>}
                      </>
                    )}
                    {before && (
                      <span>
                        Last bought at <b className="text-slate-700">{money(Math.round(before.rate * 100), before.currency)}</b>
                        {before.vendor && before.vendor !== vendor?.name ? ` from ${before.vendor}` : ""} · {when(before.on, choices.today)}
                      </span>
                    )}
                  </div>
                )}
                {row.text && !row.medicineId && <div className="text-[12px] text-slate-500">Not a medicine on the list: it is bought, no stock moves for it.</div>}
                {wrong && <div className="text-[12px] text-rose-700">{wrong}</div>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-slate-100 px-5 py-4">
          <Button onClick={() => setRows([...rows, blank()])}>
            <Plus size={16} aria-hidden="true" /> Add a line
          </Button>
          <dl className="w-full max-w-xs space-y-1 text-[13.5px]">
            <div className="flex justify-between">
              <dt className="text-slate-500">Before tax</dt>
              <dd className="tabular-nums">{money(subTotal, currency)}</dd>
            </div>
            {taxTotal > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Tax</dt>
                <dd className="tabular-nums">{money(taxTotal, currency)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-1.5 text-[16px] font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(subTotal + taxTotal, currency)}</dd>
            </div>
            {currency !== "PHP" && Number(form.fxRate) > 0 && (
              <div className="flex justify-between text-[12px] text-slate-500">
                <dt>In pesos</dt>
                <dd className="tabular-nums">{money(Math.round((subTotal + taxTotal) * Number(form.fxRate)))}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <section className={card}>
        {head(3, "Notes and terms", "Printed on the order the vendor gets")}
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Notes</span>
            <textarea className={`${FIELD} h-24 py-2.5`} placeholder="Ship by air, cold chain…" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Terms &amp; conditions</span>
            <textarea className={`${FIELD} h-24 py-2.5`} placeholder="Shelf life at least 18 months on arrival…" value={form.terms} onChange={(event) => setForm({ ...form, terms: event.target.value })} />
          </label>
        </div>
      </section>

      <Problem message={action.problem && !action.problem.field ? action.problem.message : action.general(["supplierId", "deliveryDate", "fxRate"])} />
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.35)] backdrop-blur">
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-500">Total · {rows.filter((row) => row.medicineId || row.text.trim()).length} lines</span>
          <span className="text-xl font-bold tabular-nums">{money(subTotal + taxTotal, currency)}</span>
        </div>
        <span className="flex-1" />
        <Button onClick={() => navigate("/purchases/orders")}>Cancel</Button>
        <Button disabled={action.busy} onClick={() => save(false)}>
          Save as draft
        </Button>
        <Button variant="primary" disabled={action.busy} onClick={() => save(true)}>
          <Truck size={16} aria-hidden="true" /> {action.busy ? "Saving…" : "Save and send"}
        </Button>
      </div>
      {adding && (
        <NewVendorDialog
          onClose={() => setAdding(false)}
          onSaved={async (id, name) => {
            await queries.invalidateQueries({ queryKey: ["books", "choices"] });
            setVendorId(id);
            setVendorText(name);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

export const Hint = ({ children }: { children: ReactNode }) => <p className="text-[12px] text-slate-500">{children}</p>;
