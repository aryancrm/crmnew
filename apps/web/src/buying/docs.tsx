// Bills, payments made, vendor credits and receives in this CRM's own look: each list by its state,
// each document's page (what it is for, its lines, what it is linked to, what can be done with it),
// and the forms — a bill (rent, a utility, or freight and customs added to a purchase order's goods),
// a payment on one or more bills (the rest stays an advance), a vendor credit, putting a credit or
// an advance on bills, and void.

import type { BookDoc, BookKind } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useChoices, useMay } from "../books/forms";
import { Button, count, PageHead, PageState, Problem, Tabs, useAction } from "../ui";
import {
  Box,
  docPath,
  docState,
  Fact,
  FIELD,
  KIND_WORD,
  LABEL,
  money,
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
  ZOHO_PATHS,
  ZohoLink,
} from "./shared";

type DocKind = "bill" | "vendor_payment" | "vendor_credit" | "purchase_receive";

const LIST: Record<DocKind, { title: string; sub: string; search: string }> = {
  bill: { title: "Bills", sub: "What vendors billed us: to pay, overdue and paid", search: "Search by bill number, PO or vendor" },
  vendor_payment: { title: "Payments made", sub: "Money paid to vendors and the bills it went on", search: "Search by payment number, reference or vendor" },
  vendor_credit: { title: "Vendor credits", sub: "What vendors owe us back (goods returned, short or damaged, overcharged), to use on their next bills", search: "Search by credit number or vendor" },
  purchase_receive: { title: "Receives", sub: "Each delivery put on the shelf, by purchase order", search: "Search by receive number, PO or vendor" },
};
const VIEW_WORD: Record<string, string> = {
  open: "To pay",
  overdue: "Overdue",
  partially_paid: "Part paid",
  paid: "Paid",
  void: "Void",
  draft: "Drafts",
  closed: "Used",
  received: "Received",
};

export function DocListPage({ kind }: { kind: DocKind }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const may = useMay();
  const view = params.get("view") ?? "all";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 1;
  const query = useBookList(kind, { view: view === "all" ? undefined : view, q, page, perPage: 50 });
  const all = useBookList(kind, { perPage: 10 }).data;
  const set = (next: Record<string, string | undefined>) => {
    const out = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) value ? out.set(key, value) : out.delete(key);
    setParams(out, { replace: true });
  };
  const data = query.data;
  const word = LIST[kind];
  const newPath =
    kind === "bill" && may.bill ? "/purchases/bills/new" : kind === "vendor_payment" && may.pay ? "/purchases/payments/new" : kind === "vendor_credit" && may.pay ? "/purchases/credits/new" : null;
  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title={word.title}
        sub={word.sub}
        actions={
          <>
            <ZohoLink to={ZOHO_PATHS[kind] ?? "/books"} />
            {newPath && (
              <Button variant="primary" onClick={() => navigate(newPath)}>
                <Plus size={16} aria-hidden="true" /> {kind === "bill" ? "New bill" : kind === "vendor_payment" ? "Record payment" : "New vendor credit"}
              </Button>
            )}
          </>
        }
      >
        {all && all.views.length > 1 && (
          <Tabs
            value={view}
            onChange={(key) => set({ view: key === "all" ? undefined : key, page: undefined })}
            tabs={[{ key: "all", label: "All", count: all.total }, ...all.views.map((one) => ({ key: one.key, label: VIEW_WORD[one.key] ?? one.key.replace(/_/g, " "), count: one.count }))]}
          />
        )}
      </PageHead>
      <div className="flex">
        <SearchBox value={q} onChange={(text) => set({ q: text || undefined, page: undefined })} placeholder={word.search} />
      </div>
      <PageState query={query} what={word.title.toLowerCase()} />
      {data && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>{KIND_WORD[kind]}</th>
                  <th className={TH}>Vendor</th>
                  {kind === "bill" && <th className={TH}>Due</th>}
                  {kind === "vendor_payment" && <th className={TH}>How · on bills</th>}
                  {kind === "purchase_receive" && <th className={TH}>Purchase order</th>}
                  {kind !== "purchase_receive" && <th className={TH}>State</th>}
                  <th className={`${TH} text-right`}>{kind === "purchase_receive" ? "Pieces" : "Amount"}</th>
                  {kind !== "purchase_receive" && <th className={`${TH} text-right`}>{kind === "bill" ? "Still to pay" : "Not used yet"}</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} onClick={() => navigate(docPath(kind, row.id))} className="cursor-pointer hover:bg-slate-50/70">
                    <td className={TD}>
                      <Link to={docPath(kind, row.id)} onClick={(event) => event.stopPropagation()} className="font-semibold text-brand hover:underline">
                        {row.number}
                      </Link>
                      <div className="text-[12px] text-slate-500">{when(row.date, data.today)}</div>
                    </td>
                    <td className={`${TD} max-w-[18rem]`}>
                      <div className="truncate font-medium">{row.party}</div>
                      {kind === "bill" && row.reference && <div className="truncate text-[12px] text-slate-500">{row.reference}</div>}
                    </td>
                    {kind === "bill" && <td className={`${TD} whitespace-nowrap ${row.status === "overdue" ? "font-semibold text-rose-700" : ""}`}>{when(row.dueDate, data.today)}</td>}
                    {kind === "vendor_payment" && (
                      <td className={`${TD} max-w-[16rem] text-[12.5px] text-slate-600`}>
                        <div className="truncate">{[row.mode, row.linked].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                    )}
                    {kind === "purchase_receive" && <td className={TD}>{row.linked ?? row.reference ?? "—"}</td>}
                    {kind !== "purchase_receive" && (
                      <td className={TD}>
                        <StatePill state={docState(row, kind)} />
                      </td>
                    )}
                    <td className={`${TD} text-right font-semibold whitespace-nowrap tabular-nums`}>{kind === "purchase_receive" ? qty(row.qty) : money(row.total, row.currency)}</td>
                    {kind !== "purchase_receive" && (
                      <td className={`${TD} text-right whitespace-nowrap tabular-nums ${(kind === "bill" ? row.balance : (row.unused ?? row.balance)) > 0 ? (kind === "bill" ? "font-semibold text-rose-700" : "font-semibold text-violet-700") : "text-slate-400"}`}>
                        {row.status === "void" ? "—" : money(kind === "bill" ? row.balance : (row.unused ?? row.balance), row.currency)}
                      </td>
                    )}
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      Nothing here.
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

// ------------------------------------------------------------------ one document

export function DocPage({ kind }: { kind: DocKind }) {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const may = useMay();
  const query = useBookDoc(kind, id);
  const choices = useChoices().data;
  const [box, setBox] = useState<"apply" | "void" | null>(null);
  const doc = query.data;
  if (!doc) return <PageState query={query} what={(KIND_WORD[kind] ?? "it").toLowerCase()} />;
  const today = choices?.today ?? new Date().toISOString().slice(0, 10);
  const state = docState(doc, kind);
  const landedOn = typeof doc.fields["Landed cost on"] === "string" ? (doc.fields["Landed cost on"] as string) : null;
  const left = kind === "bill" ? doc.balance : (doc.unused ?? doc.balance);
  const canVoid =
    doc.status !== "void" &&
    ((kind === "bill" && may.bill && doc.balance === doc.total) || ((kind === "vendor_payment" || kind === "vendor_credit") && may.pay));
  const canApply = (kind === "vendor_payment" || kind === "vendor_credit") && may.pay && left > 0 && doc.status !== "void";
  const paidThrough = String(doc.fields["Paid Through"] ?? doc.fields.paid_through_account_name ?? "");
  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title={`${KIND_WORD[kind]} ${doc.number}`}
        tags={kind !== "purchase_receive" ? <StatePill state={state} /> : undefined}
        sub={
          <>
            {doc.vendor ? (
              <Link to={`/purchases/vendors/${doc.vendor.id}`} className="font-medium text-brand-dark hover:underline">
                {doc.vendor.name}
              </Link>
            ) : (
              doc.party
            )}
            {doc.fromZoho ? " · from Zoho" : ""}
          </>
        }
        actions={
          <>
            <ZohoLink to={`${ZOHO_PATHS[kind]}/${id}`} />
            {kind === "bill" && may.pay && doc.balance > 0 && doc.status !== "void" && doc.vendor && (
              <Button variant="primary" onClick={() => navigate(`/purchases/payments/new?vendor=${doc.vendor?.id}&bill=${id}`)}>
                <Wallet size={16} aria-hidden="true" /> Record payment
              </Button>
            )}
            {canApply && (
              <Button variant="primary" onClick={() => setBox("apply")}>
                Use on bills
              </Button>
            )}
            {canVoid && (
              <Button variant="danger" onClick={() => setBox("void")}>
                <Ban size={16} aria-hidden="true" /> Void
              </Button>
            )}
          </>
        }
      />
      {landedOn && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-[13.5px] text-violet-900">
          Landed cost on{" "}
          <Link to={`/purchases/orders?q=${encodeURIComponent(landedOn)}`} className="font-semibold underline">
            {landedOn}
          </Link>
          : shared over its goods by value, each piece on the shelf costs more. Kept in Inventory Asset, it reaches Cost of Goods Sold as they sell.
        </div>
      )}
      {doc.status === "void" && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13.5px] text-slate-700">Void: it stays here, its money no longer counts.</div>
      )}
      {box === "apply" && <ApplyBox doc={doc} kind={kind as "vendor_payment" | "vendor_credit"} today={today} onDone={() => setBox(null)} />}
      {box === "void" && <VoidPanel doc={doc} kind={kind} onDone={() => setBox(null)} />}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-2xs sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Date">{when(doc.date, today)}</Fact>
        {kind === "bill" && <Fact label="Due">{when(doc.dueDate, today)}</Fact>}
        {kind === "bill" && <Fact label="Pays">{doc.paymentTerms}</Fact>}
        {kind === "vendor_payment" && <Fact label="How">{doc.mode}</Fact>}
        {kind === "vendor_payment" && <Fact label="Paid from">{paidThrough}</Fact>}
        <Fact label="Reference">{doc.reference}</Fact>
        {kind !== "purchase_receive" && <Fact label="Amount">{money(doc.total, doc.currency)}</Fact>}
        {kind !== "purchase_receive" && (
          <Fact label={kind === "bill" ? "Still to pay" : "Not used yet"}>
            <span className={left > 0 ? (kind === "bill" ? "text-rose-700" : "text-violet-700") : "text-slate-500"}>{money(left, doc.currency)}</span>
          </Fact>
        )}
        {doc.currency !== "PHP" && <Fact label="Rate">₱{doc.fxRate} a {doc.currency}</Fact>}
      </dl>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
        {doc.lines.length > 0 ? (
          <Box title={kind === "purchase_receive" ? "What came" : "Lines"}>
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Item</th>
                    {kind === "purchase_receive" ? <th className={TH}>Batch · expiry</th> : <th className={TH}>Account</th>}
                    <th className={`${TH} text-right`}>Qty</th>
                    {kind !== "purchase_receive" && <th className={`${TH} text-right`}>Rate</th>}
                    {kind !== "purchase_receive" && <th className={`${TH} text-right`}>Amount</th>}
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((line) => {
                    const batch = line.batches[0] as Record<string, unknown> | undefined;
                    return (
                      <tr key={line.id}>
                        <td className={TD}>
                          {line.medicineId ? (
                            <Link to={`/medicines/${line.medicineId}`} className="font-semibold text-slate-900 hover:text-brand">
                              {line.medicine ?? line.itemName}
                            </Link>
                          ) : (
                            <span className="font-semibold">{line.itemName ?? line.account}</span>
                          )}
                          {line.description && <div className="text-[12px] text-slate-500">{line.description}</div>}
                        </td>
                        {kind === "purchase_receive" ? (
                          <td className={TD}>
                            {batch ? `${String(batch["Batch Reference#"] ?? batch.batch_number ?? "")}${batch["Expiry Date"] ? ` · ${when(String(batch["Expiry Date"]))}` : ""}` : "—"}
                            {line.warehouse && <div className="text-[12px] text-slate-500">{line.warehouse}</div>}
                          </td>
                        ) : (
                          <td className={`${TD} text-[12.5px] text-slate-600`}>{line.account ?? "—"}</td>
                        )}
                        <td className={`${TD} text-right tabular-nums`}>{qty(line.qty)}</td>
                        {kind !== "purchase_receive" && <td className={`${TD} text-right tabular-nums`}>{money(Math.round((line.rate ?? 0) * 100), doc.currency)}</td>}
                        {kind !== "purchase_receive" && <td className={`${TD} text-right font-semibold tabular-nums`}>{money(line.amount, doc.currency)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {kind !== "purchase_receive" && (
              <div className="flex justify-end border-t border-slate-100 px-4 py-3 text-[15px] font-semibold">
                Total&nbsp;<span className="tabular-nums">{money(doc.total, doc.currency)}</span>
              </div>
            )}
          </Box>
        ) : (
          <Box title="Lines">
            <p className="px-4 py-6 text-center text-[13px] text-slate-500">{kind === "vendor_payment" ? "A payment has no lines: see the bills it went on." : "No lines."}</p>
          </Box>
        )}
        <div className="flex flex-col gap-4">
          <Box title="Linked">
            {doc.linkedDocs.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-slate-500">Nothing linked.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {doc.linkedDocs.map((one) => (
                  <li key={`${one.kind}-${one.id}-${one.direction}`}>
                    <Link to={docPath(one.kind, one.id)} className="flex flex-col px-4 py-2.5 text-[13px] hover:bg-slate-50">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-brand">
                          {KIND_WORD[one.kind] ?? one.kind} {one.number}
                        </span>
                        {one.amount !== null && <span className="font-semibold tabular-nums">{money(one.amount, doc.currency)}</span>}
                      </span>
                      <span className="text-[12px] text-slate-500">{when(one.on ?? one.date, today)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Box>
          {doc.notes && (
            <Box title="Notes">
              <p className="px-4 py-3 text-[13.5px] whitespace-pre-line text-slate-700">{doc.notes}</p>
            </Box>
          )}
        </div>
      </div>
    </div>
  );
}

/** A vendor's open bills (Zoho's and those made here), oldest first, to put money on. */
function useOpenBills(vendorId: number | null) {
  const list = useBookList("bill", { party: vendorId ?? undefined, perPage: 200, sort: "date", dir: "asc" });
  return useMemo(
    () => (vendorId ? (list.data?.rows ?? []).filter((row) => row.id > 0 && row.balance > 0 && !["void", "draft"].includes(row.status)) : []),
    [list.data, vendorId],
  );
}

function BillPicker({ bills, amounts, setAmounts, error, today }: { bills: ReturnType<typeof useOpenBills>; amounts: Record<number, string>; setAmounts: (next: Record<number, string>) => void; error?: (at: number) => string | undefined; today: string }) {
  if (!bills.length) return <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-[13px] text-slate-500">No unpaid bill for this vendor.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className={TABLE}>
        <thead>
          <tr>
            <th className={TH}>Bill</th>
            <th className={TH}>Due</th>
            <th className={`${TH} text-right`}>Amount</th>
            <th className={`${TH} text-right`}>Still to pay</th>
            <th className={`${TH} w-44 text-right`}>Put on it</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((bill, at) => (
            <tr key={bill.id}>
              <td className={TD}>
                <span className="font-semibold">{bill.number}</span>
                {bill.reference && <div className="text-[12px] text-slate-500">{bill.reference}</div>}
              </td>
              <td className={`${TD} whitespace-nowrap ${bill.status === "overdue" ? "font-semibold text-rose-700" : ""}`}>{when(bill.dueDate, today)}</td>
              <td className={`${TD} text-right tabular-nums`}>{money(bill.total, bill.currency)}</td>
              <td className={`${TD} text-right font-semibold tabular-nums`}>{money(bill.balance, bill.currency)}</td>
              <td className={TD}>
                <div className="flex items-center gap-1">
                  <input className={`${FIELD} h-10 text-right`} inputMode="decimal" placeholder="0.00" value={amounts[bill.id] ?? ""} onChange={(event) => setAmounts({ ...amounts, [bill.id]: event.target.value })} />
                  <button type="button" className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand-tint" onClick={() => setAmounts({ ...amounts, [bill.id]: (bill.balance / 100).toFixed(2) })}>
                    All
                  </button>
                </div>
                {error?.(at) && <div className="text-[11.5px] text-rose-700">{error(at)}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApplyBox({ doc, kind, today, onDone }: { doc: BookDoc; kind: "vendor_payment" | "vendor_credit"; today: string; onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const bills = useOpenBills(doc.vendor?.id ?? null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const used = bills.reduce((sum, bill) => sum + Math.round((Number(amounts[bill.id]) || 0) * 100), 0);
  const available = doc.unused ?? doc.balance;
  return (
    <Box title={`Use ${money(available, doc.currency)} on their bills`} aside={<Button small onClick={onDone}>Close</Button>}>
      <div className="flex flex-col gap-3 p-4">
        <BillPicker bills={bills} amounts={amounts} setAmounts={setAmounts} today={today} />
        <Problem message={action.problem?.message} />
        <div className="flex items-center justify-end gap-3">
          <span className={`text-[13.5px] ${used > available ? "font-semibold text-rose-700" : "text-slate-600"}`}>
            Putting {money(used, doc.currency)} of {money(available, doc.currency)}
          </span>
          <Button
            variant="primary"
            disabled={action.busy || used <= 0}
            onClick={() =>
              void action.run(async () => {
                await api(`/api/books/${kind}/${doc.id}/apply`, {
                  body: { date: today, bills: bills.filter((bill) => Number(amounts[bill.id]) > 0).map((bill) => ({ billId: bill.id, amount: Math.round(Number(amounts[bill.id]) * 100) })) },
                });
                await queries.invalidateQueries({ queryKey: ["books"] });
                onDone();
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Box>
  );
}

function VoidPanel({ doc, kind, onDone }: { doc: BookDoc; kind: BookKind; onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [reason, setReason] = useState("");
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
      <div className="text-[14px] font-semibold text-rose-900">
        Void {doc.number}? It stays here, marked void
        {kind === "bill" ? "; a landed cost comes off its goods again" : "; what it put on bills goes back onto them"}.
      </div>
      <input className={FIELD} placeholder="Why (kept with it)" value={reason} onChange={(event) => setReason(event.target.value)} />
      <Problem message={action.problem?.message} />
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="!bg-rose-600 hover:!bg-rose-700"
          disabled={action.busy || !reason.trim()}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/books/${kind}/${doc.id}/void`, { body: { reason } });
              await queries.invalidateQueries({ queryKey: ["books"] });
              await queries.invalidateQueries({ queryKey: ["inventory"] });
              onDone();
            })
          }
        >
          Void it
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ forms

type Line = { key: number; medicineId: number | null; text: string; account: string; description: string; qty: string; rate: string; taxPct: string };
let lineKey = 0;
const freshLine = (): Line => ({ key: ++lineKey, medicineId: null, text: "", account: "", description: "", qty: "1", rate: "", taxPct: "" });

function VendorField({ vendors, value, onChange, error }: { vendors: { id: number; name: string; currency: string }[]; value: number | null; onChange: (id: number | null) => void; error?: string }) {
  const [text, setText] = useState(vendors.find((one) => one.id === value)?.name ?? "");
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>Vendor *</span>
      <input
        className={FIELD}
        list="docs-vendors"
        placeholder="Type the vendor's name"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(vendors.find((one) => one.name.toLowerCase() === event.target.value.trim().toLowerCase())?.id ?? null);
        }}
      />
      <datalist id="docs-vendors">
        {vendors.map((one) => (
          <option key={one.id} value={one.name} />
        ))}
      </datalist>
      {error && <span className="text-[12px] text-rose-700">{error}</span>}
    </label>
  );
}

function LinesEditor({ lines, setLines, currency, accounts, medicines, errorAt }: { lines: Line[]; setLines: (lines: Line[]) => void; currency: string; accounts: string[]; medicines: { id: number; name: string }[]; errorAt: (n: number) => string | undefined }) {
  const set = (key: number, change: Partial<Line>) => setLines(lines.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const amount = (line: Line) => Math.round((Number(line.qty) || 0) * (Number(line.rate) || 0) * 100);
  const tax = (line: Line) => Math.round((amount(line) * (Number(line.taxPct) || 0)) / 100);
  const total = lines.reduce((sum, line) => sum + amount(line) + tax(line), 0);
  return (
    <div className="flex flex-col">
      <datalist id="docs-accounts">
        {accounts.map((one) => (
          <option key={one} value={one} />
        ))}
      </datalist>
      <datalist id="docs-medicines">
        {medicines.map((one) => (
          <option key={one.id} value={one.name} />
        ))}
      </datalist>
      {lines.map((line, n) => (
        <div key={line.key} className="flex flex-col gap-1.5 border-b border-slate-100 py-3 last:border-b-0">
          <div className="grid items-end gap-3 md:grid-cols-[1fr_12rem_5.5rem_7.5rem_4.5rem_7.5rem_2.5rem]">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Item or service</span>
              <input
                className={FIELD}
                list="docs-medicines"
                placeholder="Air freight, airfare, travel, customs, rent…"
                value={line.medicineId ? (medicines.find((one) => one.id === line.medicineId)?.name ?? line.text) : line.text}
                onChange={(event) => set(line.key, { text: event.target.value, medicineId: medicines.find((one) => one.name.toLowerCase() === event.target.value.trim().toLowerCase())?.id ?? null })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Account</span>
              <input className={FIELD} list="docs-accounts" placeholder="Freight, Rent…" value={line.account} onChange={(event) => set(line.key, { account: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Qty</span>
              <input className={`${FIELD} text-right`} inputMode="decimal" value={line.qty} onChange={(event) => set(line.key, { qty: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Rate</span>
              <input className={`${FIELD} text-right`} inputMode="decimal" placeholder="0.00" value={line.rate} onChange={(event) => set(line.key, { rate: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Tax %</span>
              <input className={`${FIELD} text-right`} inputMode="decimal" placeholder="0" value={line.taxPct} onChange={(event) => set(line.key, { taxPct: event.target.value })} />
            </label>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Amount</span>
              <div className="flex h-11 items-center justify-end rounded-xl bg-slate-50 px-3 text-[14px] font-semibold tabular-nums">{money(amount(line), currency)}</div>
            </div>
            <button type="button" aria-label="Remove this line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((one) => one.key !== line.key))} className="grid h-11 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30">
              <Trash2 className="size-4" />
            </button>
          </div>
          <input className="rounded-lg border border-transparent px-2 py-1 text-[12.5px] text-slate-600 outline-none hover:border-slate-200 focus:border-brand" placeholder="Add a description (optional)" value={line.description} onChange={(event) => set(line.key, { description: event.target.value })} />
          {errorAt(n) && <span className="text-[12px] text-rose-700">{errorAt(n)}</span>}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <Button onClick={() => setLines([...lines, freshLine()])}>
          <Plus size={16} aria-hidden="true" /> Add a line
        </Button>
        <span className="text-[16px] font-bold tabular-nums">Total {money(total, currency)}</span>
      </div>
    </div>
  );
}
const toLines = (lines: Line[]) =>
  lines
    .filter((line) => line.medicineId || line.text.trim() || line.account.trim())
    .map((line) => ({
      medicineId: line.medicineId,
      itemName: line.medicineId ? null : line.text.trim() || null,
      account: line.account.trim() || null,
      description: line.description.trim() || null,
      qty: Number(line.qty) || 0,
      rate: Number(line.rate) || 0,
      taxPct: line.taxPct ? Number(line.taxPct) : null,
    }));

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-18px_rgba(15,23,42,0.18)]";

/** A bill: rent, a utility, a service — or freight, customs, insurance on a purchase order's
 *  goods (landed cost). A vendor credit: what a vendor owes us back. */
export function NewBillOrCredit({ kind }: { kind: "bill" | "vendor_credit" }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choicesQuery = useChoices();
  const choices = choicesQuery.data;
  const [vendorId, setVendorId] = useState<number | null>(Number(params.get("vendor")) || null);
  const [form, setForm] = useState({ number: "", reference: "", date: "", dueDate: "", paymentTerms: "", fxRate: "", notes: "" });
  const [landedOn, setLandedOn] = useState(params.get("landed") ?? "");
  const [lines, setLines] = useState<Line[]>([freshLine()]);
  if (!choices) return <PageState query={choicesQuery} what="the vendors" />;
  const vendor = choices.vendors.find((one) => one.id === vendorId);
  const currency = vendor?.currency ?? "PHP";
  const bill = kind === "bill";
  // An extra cost bigger than the goods themselves is most likely a typing slip: say so.
  const order = choices.receivedOrders.find((one) => String(one.id) === landedOn);
  const pesos = Math.round(toLines(lines).reduce((sum, line) => sum + Math.round(line.qty * line.rate * 100), 0) * (currency === "PHP" ? 1 : Number(form.fxRate) || 0));
  const tooBig = Boolean(bill && order && order.worth > 0 && pesos > order.worth);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-4">
      <PageHead
        title={bill ? (landedOn ? "Extra cost on goods" : "New bill") : "New vendor credit"}
        sub={
          bill
            ? landedOn
              ? "Freight, airfare, travel, customs, insurance — paid for an order's goods: each piece of them costs more"
              : "A vendor's bill that is not for a purchase order's goods: rent, a utility, a service"
            : `Number ${choices.next.vendorCredit} · what the vendor owes us back, used on their next bills`
        }
        actions={<ZohoLink to={bill ? "/books/bills/new" : "/books/vendorcredits/new"} />}
      />
      <section className={CARD}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <VendorField vendors={choices.vendors} value={vendorId} onChange={setVendorId} error={action.at("supplierId")} />
          </div>
          {bill && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Their bill number *</span>
              <input className={FIELD} value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} />
              {action.at("number") && <span className="text-[12px] text-rose-700">{action.at("number")}</span>}
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Reference</span>
            <input className={FIELD} placeholder={bill ? "Their invoice, waybill…" : "Their credit memo, the return…"} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Date</span>
            <input type="date" className={FIELD} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          {bill && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Due</span>
              <input type="date" className={FIELD} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
              {action.at("dueDate") && <span className="text-[12px] text-rose-700">{action.at("dueDate")}</span>}
            </label>
          )}
          {currency !== "PHP" && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Pesos for one {currency} *</span>
              <input className={FIELD} inputMode="decimal" value={form.fxRate} onChange={(event) => setForm({ ...form, fxRate: event.target.value })} />
              {action.at("fxRate") && <span className="text-[12px] text-rose-700">{action.at("fxRate")}</span>}
            </label>
          )}
          {bill && (
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={LABEL}>Is it an extra cost on goods we ordered? (freight, airfare, travel, customs, insurance…)</span>
              <select className={FIELD} value={landedOn} onChange={(event) => setLandedOn(event.target.value)}>
                <option value="">No: a bill of its own (rent, a utility, a service, travel not for goods)</option>
                {choices.receivedOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    Yes, on {order.number} · {order.party} · {when(order.date, choices.today)}
                  </option>
                ))}
              </select>
              {landedOn && (
                <span className="text-[12px] text-violet-800">
                  Shared over that order's goods by value: each piece costs more. The part for goods not received yet waits and goes on them as they come. Kept in Inventory Asset, it reaches Cost of Goods Sold as they sell.
                </span>
              )}
              {action.at("landedOn") && <span className="text-[12px] text-rose-700">{action.at("landedOn")}</span>}
            </label>
          )}
        </div>
      </section>
      <section className={CARD}>
        <LinesEditor
          lines={lines}
          setLines={setLines}
          currency={currency}
          accounts={choices.accounts}
          medicines={choices.medicines}
          errorAt={(n) => action.at(`lines.${n}.medicineId`) ?? action.at(`lines.${n}.qty`) ?? action.at(`lines.${n}.rate`)}
        />
        <label className="mt-4 flex flex-col gap-1">
          <span className={LABEL}>Notes</span>
          <textarea className={`${FIELD} h-20 py-2.5`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </section>
      {tooBig && order && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          This extra cost ({money(pesos)}) is more than the goods on {order.number} cost ({money(order.worth)}). Check the amount before saving.
        </div>
      )}
      <Problem message={action.general(["supplierId", "number", "dueDate", "fxRate", "landedOn"])} />
      <div className="sticky bottom-2 z-10 flex justify-end gap-2 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.35)] backdrop-blur">
        <Button onClick={() => navigate(bill ? "/purchases/bills" : "/purchases/credits")}>Cancel</Button>
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            (!tooBig || window.confirm("The extra cost is more than the goods cost. Save it anyway?")) &&
            void action.run(async () => {
              const made = await api<{ id: number }>(`/api/books/${kind}/new`, {
                body: {
                  supplierId: vendorId ?? 0,
                  ...(bill ? { number: form.number, dueDate: form.dueDate || null, paymentTerms: form.paymentTerms || null, ...(landedOn ? { landedOn: Number(landedOn) } : {}) } : {}),
                  reference: form.reference || null,
                  date: form.date || choices.today,
                  fxRate: form.fxRate ? Number(form.fxRate) : null,
                  notes: form.notes || null,
                  lines: toLines(lines),
                },
              });
              await queries.invalidateQueries({ queryKey: ["books"] });
              await queries.invalidateQueries({ queryKey: ["inventory"] });
              navigate(docPath(kind, made.id));
            })
          }
        >
          {action.busy ? "Saving…" : bill ? "Save the bill" : "Save the credit"}
        </Button>
      </div>
    </div>
  );
}

/** Money paid to a vendor, on one or more of their bills; what is left over stays as an advance. */
export function NewVendorPayment() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const choicesQuery = useChoices();
  const choices = choicesQuery.data;
  const [vendorId, setVendorId] = useState<number | null>(Number(params.get("vendor")) || null);
  const [form, setForm] = useState({ amount: "", date: "", mode: "", paidThrough: "", reference: "", notes: "" });
  const forBill = Number(params.get("bill")) || null;
  const bills = useOpenBills(vendorId);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const picked = useMemo(() => {
    const out = { ...amounts };
    const bill = bills.find((one) => one.id === forBill);
    if (bill && out[bill.id] === undefined) out[bill.id] = (bill.balance / 100).toFixed(2);
    return out;
  }, [amounts, bills, forBill]);
  if (!choices) return <PageState query={choicesQuery} what="the vendors" />;
  const used = bills.reduce((sum, bill) => sum + Math.round((Number(picked[bill.id]) || 0) * 100), 0);
  const paid = form.amount ? Math.round(Number(form.amount) * 100) : used;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-4">
      <PageHead title="Record a payment to a vendor" sub="What was paid, from which account, and on which of their bills" actions={<ZohoLink to="/books/paymentsmade/new" />} />
      <section className={CARD}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <VendorField vendors={choices.vendors} value={vendorId} onChange={setVendorId} error={action.at("supplierId")} />
          </div>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Amount paid (₱)</span>
            <input className={FIELD} inputMode="decimal" placeholder={(used / 100).toFixed(2)} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            {action.at("amount") && <span className="text-[12px] text-rose-700">{action.at("amount")}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Paid on</span>
            <input type="date" className={FIELD} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>How</span>
            <input className={FIELD} list="pay-modes" placeholder="Bank Transfer" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} />
            <datalist id="pay-modes">
              {choices.modes.map((one) => (
                <option key={one} value={one} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Paid from (account)</span>
            <input className={FIELD} list="pay-through" placeholder="BDO - Getmeds…" value={form.paidThrough} onChange={(event) => setForm({ ...form, paidThrough: event.target.value })} />
            <datalist id="pay-through">
              {choices.paidThrough.map((one) => (
                <option key={one} value={one} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Reference</span>
            <input className={FIELD} placeholder="Bank reference, cheque no." value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
          </label>
        </div>
      </section>
      <section className={CARD}>
        <h2 className="mb-3 text-[15px] font-semibold">Their unpaid bills</h2>
        {vendorId ? <BillPicker bills={bills} amounts={picked} setAmounts={setAmounts} error={(at) => action.at(`bills.${at}.amount`)} today={choices.today} /> : <p className="text-[13px] text-slate-500">Pick the vendor first.</p>}
        <dl className="mt-4 ml-auto w-full max-w-sm space-y-1 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="text-slate-500">Paid</dt>
            <dd className="font-semibold tabular-nums">{money(paid)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">On bills</dt>
            <dd className="tabular-nums">{money(used)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-1.5">
            <dt className="text-slate-500">Left as an advance</dt>
            <dd className={`tabular-nums ${paid - used > 0 ? "font-semibold text-violet-700" : ""}`}>{money(Math.max(0, paid - used))}</dd>
          </div>
        </dl>
        <label className="mt-4 flex flex-col gap-1">
          <span className={LABEL}>Notes (for us only)</span>
          <textarea className={`${FIELD} h-16 py-2.5`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </section>
      <Problem message={action.general(["supplierId", "amount"])} />
      <div className="sticky bottom-2 z-10 flex items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.35)] backdrop-blur">
        <span className="mr-auto text-[13px] text-slate-500">{count(Object.values(picked).filter((value) => Number(value) > 0).length)} bills</span>
        <Button onClick={() => navigate("/purchases/payments")}>Cancel</Button>
        <Button
          variant="primary"
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
              navigate(docPath("vendor_payment", made.id));
            })
          }
        >
          <Wallet size={16} aria-hidden="true" /> {action.busy ? "Saving…" : "Save the payment"}
        </Button>
      </div>
    </div>
  );
}
