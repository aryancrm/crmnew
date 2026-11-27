// Writing the books, drawn as Zoho Books draws its forms (docs/BOOKS-PLAN.md A and B): Record Expense
// (with Zoho's Cost Centre, Type, PIC, Department, Voucher, OR Number), New Journal (debits and
// credits, Difference, Save as Draft / Save and Publish, Reverse Journal Date), Transfer Fund,
// Deposit, New Credit Note, a refund, Transaction Locking and a new account.

import type { BookDoc, BookLocks, LedgerChoices, LockModule } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { useAction } from "../ui";
import { Plain, Primary, ZIN, ZPage, ZRow } from "./forms";
import { LEDGER_ROLES, zDate, zMoney } from "./kinds";
import { BirBillTaxSection, useBirTaxDraft } from "./bir/tax-fields";

export const useLedgerChoices = () =>
  useQuery({ queryKey: ["books", "ledger-choices"], queryFn: () => api<LedgerChoices>("/api/books-ledger-choices"), staleTime: 60_000 });
export const useMayLedger = () => LEDGER_ROLES.includes(useMe().data?.role ?? "");

/** "1,234.50" typed → centavos (0 when blank or not a number). */
const cents = (text: string) => {
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};
const Problem = ({ message }: { message?: string | null }) =>
  message ? <div className="mx-5 mt-3 rounded-md border border-[#f5c2c0] bg-[#fdf2f2] px-3 py-2 text-[#b91c1c]">{message}</div> : null;

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: string[]; placeholder: string }) {
  return (
    <select className={ZIN} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** Accounts grouped by type, as Zoho's account picker groups them. */
function AccountSelect({ choices, value, onChange, money, placeholder = "Select an account" }: { choices: LedgerChoices; value: string; onChange: (value: string) => void; money?: boolean; placeholder?: string }) {
  const list = money ? choices.accounts.filter((a) => choices.moneyAccounts.some((m) => m.name === a.name)) : choices.accounts;
  const groups = new Map<string, string[]>();
  for (const account of list) groups.set(account.type, [...(groups.get(account.type) ?? []), account.name]);
  return (
    <select className={ZIN} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {[...groups].map(([type, names]) => (
        <optgroup key={type} label={type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function useDone(list: string) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  return async (id: number) => {
    await queries.invalidateQueries({ queryKey: ["books"] });
    navigate(`/books/${list}/${id}`);
  };
}

function Loading({ children }: { children?: ReactNode }) {
  return <p className="p-6 text-[#6c718a]">{children ?? "Loading…"}</p>;
}

// ------------------------------------------------------------------ Record Expense

export function NewExpensePage() {
  const navigate = useNavigate();
  const action = useAction();
  const done = useDone("expenses");
  const choices = useLedgerChoices().data;
  const [itemize, setItemize] = useState(false);
  const [rows, setRows] = useState([{ account: "", amount: "", description: "", taxId: "" }]);
  const [form, setForm] = useState({
    date: "",
    paidThrough: "",
    taxInclusive: true,
    reference: "",
    notes: "",
    costCentre: "",
    voucher: "",
    orNumber: "",
    type: "Goods",
    pic: "",
    department: "",
    supplierId: "",
  });
  const pickedSupplier = choices?.vendors.find((v) => String(v.id) === form.supplierId);
  const birTax = useBirTaxDraft("services", pickedSupplier?.name ?? null);
  if (!choices) return <Loading />;
  const shown = itemize ? rows : rows.slice(0, 1);
  const subTotal = shown.reduce((sum, row) => {
    const amount = cents(row.amount);
    const tax = choices.taxes.find((t) => String(t.id) === row.taxId);
    const taxAmt = tax ? Math.round(form.taxInclusive ? (amount * tax.pct) / (100 + tax.pct) : (amount * tax.pct) / 100) : 0;
    return sum + amount - (form.taxInclusive ? taxAmt : 0);
  }, 0);
  const total = shown.reduce((sum, row) => {
    const amount = cents(row.amount);
    const tax = choices.taxes.find((t) => String(t.id) === row.taxId);
    return sum + amount + (tax && !form.taxInclusive ? Math.round((amount * tax.pct) / 100) : 0);
  }, 0);
  const set = (key: keyof typeof form, value: string | boolean) => setForm({ ...form, [key]: value });
  const setRow = (at: number, key: string, value: string) => setRows(rows.map((row, i) => (i === at ? { ...row, [key]: value } : row)));
  return (
    <ZPage
      title="Record Expense"
      onClose={() => navigate("/books/expenses")}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>("/api/books/expense/new", {
                  body: {
                    date: form.date || choices.today,
                    lines: shown.map((row) => ({ account: row.account, amount: cents(row.amount), description: row.description || null, taxId: row.taxId ? Number(row.taxId) : null })),
                    taxInclusive: form.taxInclusive,
                    paidThrough: form.paidThrough,
                    supplierId: form.supplierId ? Number(form.supplierId) : null,
                    reference: form.reference || null,
                    notes: form.notes || null,
                    costCentre: form.costCentre,
                    type: form.type,
                    department: form.department,
                    pic: form.pic,
                    voucher: form.voucher || null,
                    orNumber: form.orNumber || null,
                    birTax: birTax.toPayload(subTotal, total),
                  },
                });
                await done(made.id);
              })
            }
          >
            Save
          </Primary>
          <Plain onClick={() => navigate("/books/expenses")}>Cancel</Plain>
          <span className="ml-auto text-[13px] text-[#6c718a]">Expense# {choices.next.expense}</span>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="px-5 py-3">
        <ZRow label="Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => set("date", event.target.value)} />
        </ZRow>
        {!itemize ? (
          <>
            <ZRow label="Expense Account" required error={action.at("lines.0.account")}>
              <AccountSelect choices={choices} value={rows[0]?.account ?? ""} onChange={(value) => setRow(0, "account", value)} />
              <button type="button" className="mt-1 text-[12px] text-[#1c5bd9]" onClick={() => setItemize(true)}>
                ☰ Itemize
              </button>
            </ZRow>
            <ZRow label="Amount" required error={action.at("lines.0.amount")}>
              <div className="flex">
                <span className="flex h-[34px] items-center rounded-l-md border border-r-0 border-[#d7d5e2] bg-[#f7f7fe] px-2 text-[12px]">PHP</span>
                <input className={`${ZIN} rounded-l-none`} inputMode="decimal" value={rows[0]?.amount ?? ""} onChange={(event) => setRow(0, "amount", event.target.value)} />
              </div>
            </ZRow>
          </>
        ) : (
          <div className="my-2 max-w-[860px] overflow-x-auto rounded-md border border-[#ebeaf2]">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-[#f9f9fb] text-[11px] text-[#6c718a] uppercase">
                <tr>
                  <th className="px-2 py-2 text-left font-normal">Expense Account</th>
                  <th className="px-2 py-2 text-left font-normal">Notes</th>
                  <th className="px-2 py-2 text-left font-normal">Tax</th>
                  <th className="px-2 py-2 text-right font-normal">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, at) => (
                  <tr key={at} className="border-t border-[#ebeaf2]">
                    <td className="p-1.5">
                      <AccountSelect choices={choices} value={row.account} onChange={(value) => setRow(at, "account", value)} />
                    </td>
                    <td className="p-1.5">
                      <input className={ZIN} value={row.description} onChange={(event) => setRow(at, "description", event.target.value)} />
                    </td>
                    <td className="p-1.5">
                      <select className={ZIN} value={row.taxId} onChange={(event) => setRow(at, "taxId", event.target.value)}>
                        <option value="">No tax</option>
                        {choices.taxes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} [{t.pct}%]
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input className={`${ZIN} text-right`} inputMode="decimal" value={row.amount} onChange={(event) => setRow(at, "amount", event.target.value)} />
                    </td>
                    <td className="p-1.5">
                      {rows.length > 1 && (
                        <button type="button" aria-label="Remove line" className="text-[#d6141d]" onClick={() => setRows(rows.filter((_, i) => i !== at))}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="flex items-center gap-1 px-3 py-2 text-[#1c5bd9]" onClick={() => setRows([...rows, { account: "", amount: "", description: "", taxId: "" }])}>
              <Plus size={14} /> Add New Row
            </button>
          </div>
        )}
        <ZRow label="Amount Is">
          <div className="flex gap-4 pt-1.5">
            {[
              [true, "Tax Inclusive"],
              [false, "Tax Exclusive"],
            ].map(([value, label]) => (
              <label key={String(label)} className="flex items-center gap-1.5">
                <input type="radio" checked={form.taxInclusive === value} onChange={() => set("taxInclusive", value as boolean)} /> {label as string}
              </label>
            ))}
          </div>
        </ZRow>
        <ZRow label="Paid Through" required error={action.at("paidThrough")}>
          <AccountSelect choices={choices} money value={form.paidThrough} onChange={(value) => set("paidThrough", value)} />
        </ZRow>
        {!itemize && (
          <ZRow label="Tax" error={action.at("lines.0.taxId")}>
            <select className={ZIN} value={rows[0]?.taxId ?? ""} onChange={(event) => setRow(0, "taxId", event.target.value)}>
              <option value="">Select a Tax</option>
              {choices.taxes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} [{t.pct}%]
                </option>
              ))}
            </select>
          </ZRow>
        )}
        <ZRow label="Vendor" error={action.at("supplierId")}>
          <select className={ZIN} value={form.supplierId} onChange={(event) => set("supplierId", event.target.value)}>
            <option value="">Select a vendor</option>
            {choices.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </ZRow>
        <ZRow label="Reference#">
          <input className={ZIN} value={form.reference} onChange={(event) => set("reference", event.target.value)} />
        </ZRow>
        <ZRow label="Notes">
          <textarea className={`${ZIN} h-16 py-2`} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </ZRow>
      </div>
      <BirBillTaxSection draft={birTax.draft} setDraft={birTax.setDraft} subTotalCentavos={subTotal} totalCentavos={total} />
      <div className="border-t border-[#ebeaf2] px-5 py-3">
        <ZRow label="Cost Centre" required error={action.at("costCentre")}>
          <Select value={form.costCentre} onChange={(value) => set("costCentre", value)} options={choices.options["Cost Centre"] ?? []} placeholder="Select" />
        </ZRow>
        <ZRow label="Voucher">
          <input className={ZIN} value={form.voucher} onChange={(event) => set("voucher", event.target.value)} />
        </ZRow>
        <ZRow label="OR Number">
          <input className={ZIN} value={form.orNumber} onChange={(event) => set("orNumber", event.target.value)} />
        </ZRow>
        <ZRow label="Type" required error={action.at("type")}>
          <Select value={form.type} onChange={(value) => set("type", value)} options={choices.options.Type ?? []} placeholder="Select" />
        </ZRow>
        <ZRow label="PIC" required error={action.at("pic")}>
          <input className={ZIN} list="pic-people" placeholder="Who is in charge" value={form.pic} onChange={(event) => set("pic", event.target.value)} />
          <datalist id="pic-people">
            {choices.people.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </ZRow>
        <ZRow label="Department" required error={action.at("department")}>
          <Select value={form.department} onChange={(value) => set("department", value)} options={choices.options.Department ?? []} placeholder="Select" />
        </ZRow>
        <ZRow label="Total">
          <div className="pt-1.5 text-[15px] font-semibold">{zMoney(total)}</div>
        </ZRow>
      </div>
    </ZPage>
  );
}

// ------------------------------------------------------------------ New Journal

export function NewJournalPage() {
  const navigate = useNavigate();
  const action = useAction();
  const done = useDone("journals");
  const choices = useLedgerChoices().data;
  const blank = { account: "", description: "", contact: "", debit: "", credit: "" };
  const [rows, setRows] = useState([blank, blank]);
  const [form, setForm] = useState({ date: "", reverseOn: "", number: "", reference: "", notes: "", department: "", company: "", pic: "" });
  if (!choices) return <Loading />;
  const debit = rows.reduce((sum, row) => sum + cents(row.debit), 0);
  const credit = rows.reduce((sum, row) => sum + cents(row.credit), 0);
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const setRow = (at: number, key: string, value: string) => setRows(rows.map((row, i) => (i === at ? { ...row, [key]: value } : row)));
  const save = (publish: boolean) =>
    void action.run(async () => {
      const made = await api<{ id: number }>("/api/books/journal/new", {
        body: {
          date: form.date || choices.today,
          number: form.number || null,
          reference: form.reference || null,
          notes: form.notes,
          department: form.department,
          company: form.company,
          pic: form.pic || null,
          reverseOn: form.reverseOn || null,
          publish,
          lines: rows.map((row) => ({ account: row.account, description: row.description || null, contact: row.contact || null, debit: cents(row.debit), credit: cents(row.credit) })),
        },
      });
      await done(made.id);
    });
  return (
    <ZPage
      title="New Journal"
      onClose={() => navigate("/books/journals")}
      footer={
        <>
          <Primary disabled={action.busy} onClick={() => save(true)}>
            Save and Publish
          </Primary>
          <Plain disabled={action.busy} onClick={() => save(false)}>
            Save as Draft
          </Plain>
          <Plain onClick={() => navigate("/books/journals")}>Cancel</Plain>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="px-5 py-3">
        <ZRow label="Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => set("date", event.target.value)} />
        </ZRow>
        <ZRow label="Reverse Journal Date" error={action.at("reverseOn")}>
          <input type="date" className={ZIN} value={form.reverseOn} onChange={(event) => set("reverseOn", event.target.value)} />
        </ZRow>
        <ZRow label="Journal#" error={action.at("number")}>
          <input className={ZIN} placeholder={choices.next.journal} value={form.number} onChange={(event) => set("number", event.target.value)} />
        </ZRow>
        <ZRow label="Reference#">
          <input className={ZIN} value={form.reference} onChange={(event) => set("reference", event.target.value)} />
        </ZRow>
        <ZRow label="Notes" required error={action.at("notes")}>
          <textarea className={`${ZIN} h-16 py-2`} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </ZRow>
        <ZRow label="Department" required error={action.at("department")}>
          <Select value={form.department} onChange={(value) => set("department", value)} options={choices.options.Department ?? []} placeholder="Select" />
        </ZRow>
        <ZRow label="Company" required error={action.at("company")}>
          <Select value={form.company} onChange={(value) => set("company", value)} options={choices.options.Company ?? []} placeholder="Select" />
        </ZRow>
        <ZRow label="PIC">
          <input className={ZIN} value={form.pic} onChange={(event) => set("pic", event.target.value)} />
        </ZRow>
      </div>
      <div className="px-5 pb-3">
        <div className="max-w-[1000px] overflow-x-auto rounded-md border border-[#ebeaf2]">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="bg-[#f9f9fb] text-[11px] text-[#6c718a] uppercase">
              <tr>
                <th className="px-2 py-2 text-left font-normal">Account</th>
                <th className="px-2 py-2 text-left font-normal">Description</th>
                <th className="px-2 py-2 text-left font-normal">Contact (PHP)</th>
                <th className="px-2 py-2 text-right font-normal">Debits</th>
                <th className="px-2 py-2 text-right font-normal">Credits</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, at) => (
                <tr key={at} className="border-t border-[#ebeaf2]">
                  <td className="w-[260px] p-1.5">
                    <AccountSelect choices={choices} value={row.account} onChange={(value) => setRow(at, "account", value)} />
                  </td>
                  <td className="p-1.5">
                    <input className={ZIN} value={row.description} onChange={(event) => setRow(at, "description", event.target.value)} />
                  </td>
                  <td className="p-1.5">
                    <input className={ZIN} value={row.contact} onChange={(event) => setRow(at, "contact", event.target.value)} />
                  </td>
                  <td className="w-[130px] p-1.5">
                    <input className={`${ZIN} text-right`} inputMode="decimal" value={row.debit} disabled={!!row.credit} onChange={(event) => setRow(at, "debit", event.target.value)} />
                  </td>
                  <td className="w-[130px] p-1.5">
                    <input className={`${ZIN} text-right`} inputMode="decimal" value={row.credit} disabled={!!row.debit} onChange={(event) => setRow(at, "credit", event.target.value)} />
                  </td>
                  <td className="p-1.5">
                    {rows.length > 2 && (
                      <button type="button" aria-label="Remove line" className="text-[#d6141d]" onClick={() => setRows(rows.filter((_, i) => i !== at))}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="flex items-center gap-1 px-3 py-2 text-[#1c5bd9]" onClick={() => setRows([...rows, blank])}>
            <Plus size={14} /> Add New Row
          </button>
        </div>
        <div className="mt-3 ml-auto grid max-w-[420px] grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 rounded-md bg-[#f9f9fb] p-3 text-right">
          <span className="text-left">Total (PHP)</span>
          <span>{zMoney(debit, "")}</span>
          <span>{zMoney(credit, "")}</span>
          <span className={`text-left ${debit === credit ? "" : "text-[#d6141d]"}`}>Difference</span>
          <span className={`col-span-2 ${debit === credit ? "" : "text-[#d6141d]"}`}>{zMoney(Math.abs(debit - credit), "")}</span>
        </div>
      </div>
    </ZPage>
  );
}

// ------------------------------------------------------------------ Transfer Fund and Deposit

export function NewMovePage({ kind }: { kind: "transfer_fund" | "deposit" }) {
  const navigate = useNavigate();
  const action = useAction();
  const list = kind === "transfer_fund" ? "transfers" : "deposits";
  const done = useDone(list);
  const choices = useLedgerChoices().data;
  const [form, setForm] = useState({ date: "", from: "", to: "", amount: "", reference: "", notes: "", payer: "" });
  if (!choices) return <Loading />;
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const transfer = kind === "transfer_fund";
  return (
    <ZPage
      title={transfer ? "Transfer Fund" : "Record Deposit"}
      onClose={() => navigate(`/books/${list}`)}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>(`/api/books/${kind}/new`, {
                  body: { date: form.date || choices.today, from: form.from, to: form.to, amount: cents(form.amount), reference: form.reference || null, notes: form.notes || null, payer: form.payer || null },
                });
                await done(made.id);
              })
            }
          >
            Save
          </Primary>
          <Plain onClick={() => navigate(`/books/${list}`)}>Cancel</Plain>
          <span className="ml-auto text-[13px] text-[#6c718a]">{transfer ? choices.next.transfer : choices.next.deposit}</span>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="px-5 py-3">
        <ZRow label={transfer ? "From Account" : "Received From (account)"} required error={action.at("from")}>
          <AccountSelect choices={choices} money={transfer} value={form.from} onChange={(value) => set("from", value)} />
          {!transfer && <p className="mt-1 text-[12px] text-[#6c718a]">Other income, interest income, or the owner's equity for a contribution.</p>}
        </ZRow>
        <ZRow label="To Account" required error={action.at("to")}>
          <AccountSelect choices={choices} money value={form.to} onChange={(value) => set("to", value)} />
        </ZRow>
        <ZRow label="Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => set("date", event.target.value)} />
        </ZRow>
        <ZRow label="Amount" required error={action.at("amount")}>
          <input className={ZIN} inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value)} />
        </ZRow>
        {!transfer && (
          <ZRow label="Received From (who)">
            <input className={ZIN} value={form.payer} onChange={(event) => set("payer", event.target.value)} />
          </ZRow>
        )}
        <ZRow label="Reference#">
          <input className={ZIN} value={form.reference} onChange={(event) => set("reference", event.target.value)} />
        </ZRow>
        <ZRow label="Description">
          <textarea className={`${ZIN} h-16 py-2`} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </ZRow>
      </div>
    </ZPage>
  );
}
export const NewTransferPage = () => <NewMovePage kind="transfer_fund" />;
export const NewDepositPage = () => <NewMovePage kind="deposit" />;

// ------------------------------------------------------------------ New Credit Note

export function NewCreditNotePage() {
  const navigate = useNavigate();
  const action = useAction();
  const done = useDone("creditnotes");
  const choices = useLedgerChoices().data;
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [text, setText] = useState("");
  const blank = { itemName: "", account: "Sales", qty: "1", rate: "", taxId: "" };
  const [rows, setRows] = useState([blank]);
  const [form, setForm] = useState({ date: "", reference: "", reason: "", notes: "" });
  const found = useQuery({
    queryKey: ["books", "customers", "pick", text],
    enabled: text.trim().length >= 2 && text !== customer?.name,
    queryFn: () => api<{ rows: { id: number; name: string; kind: string }[] }>(`/api/books/customers?q=${encodeURIComponent(text.trim())}&perPage=10`),
  }).data;
  if (!choices) return <Loading />;
  const lineTotal = (row: typeof blank) => {
    const amount = Math.round(Number(row.qty || 0) * cents(row.rate));
    const tax = choices.taxes.find((t) => String(t.id) === row.taxId);
    return amount + (tax ? Math.round((amount * tax.pct) / 100) : 0);
  };
  const total = rows.reduce((sum, row) => sum + lineTotal(row), 0);
  const setRow = (at: number, key: string, value: string) => setRows(rows.map((row, i) => (i === at ? { ...row, [key]: value } : row)));
  return (
    <ZPage
      title="New Credit Note"
      onClose={() => navigate("/books/creditnotes")}
      footer={
        <>
          <Primary
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const made = await api<{ id: number }>("/api/books/credit_note/new", {
                  body: {
                    customerId: customer?.id ?? 0,
                    date: form.date || choices.today,
                    reference: form.reference || null,
                    reason: form.reason,
                    notes: form.notes || null,
                    lines: rows.map((row) => ({ itemName: row.itemName || null, account: row.account || null, qty: Number(row.qty || 0), rate: Number(row.rate.replace(/,/g, "") || 0), taxId: row.taxId ? Number(row.taxId) : null })),
                  },
                });
                await done(made.id);
              })
            }
          >
            Save as Open
          </Primary>
          <Plain onClick={() => navigate("/books/creditnotes")}>Cancel</Plain>
          <span className="ml-auto text-[13px] text-[#6c718a]">Credit Note# {choices.next.creditNote}</span>
        </>
      }
    >
      <Problem message={action.problem?.message} />
      <div className="bg-[#fbfbfe] px-5 py-3">
        <ZRow label="Customer Name" required error={action.at("customerId")}>
          <div className="relative">
            <input
              className={ZIN}
              placeholder="Type the customer's name"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCustomer(null);
              }}
            />
            {found && text !== customer?.name && found.rows.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[#ebeaf2] bg-white shadow-lg">
                {found.rows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left hover:bg-[#408dfb] hover:text-white"
                      onClick={() => {
                        setText(c.name);
                        setCustomer({ id: c.id, name: c.name });
                      }}
                    >
                      {c.name} <span className="text-[11px] opacity-70">{c.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ZRow>
      </div>
      <div className="px-5 py-3">
        <ZRow label="Credit Note Date" required error={action.at("date")}>
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </ZRow>
        <ZRow label="Reference#">
          <input className={ZIN} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </ZRow>
        <ZRow label="Reason" required error={action.at("reason")}>
          <input className={ZIN} placeholder="Price corrected, goods returned, …" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
        </ZRow>
      </div>
      <div className="px-5 pb-3">
        <div className="max-w-[1000px] overflow-x-auto rounded-md border border-[#ebeaf2]">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="bg-[#f9f9fb] text-[11px] text-[#6c718a] uppercase">
              <tr>
                <th className="px-2 py-2 text-left font-normal">Item Details</th>
                <th className="px-2 py-2 text-left font-normal">Account</th>
                <th className="px-2 py-2 text-right font-normal">Quantity</th>
                <th className="px-2 py-2 text-right font-normal">Rate</th>
                <th className="px-2 py-2 text-left font-normal">Tax</th>
                <th className="px-2 py-2 text-right font-normal">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, at) => (
                <tr key={at} className="border-t border-[#ebeaf2]">
                  <td className="p-1.5">
                    <input className={ZIN} placeholder="What is credited" value={row.itemName} onChange={(event) => setRow(at, "itemName", event.target.value)} />
                  </td>
                  <td className="w-[200px] p-1.5">
                    <AccountSelect choices={choices} value={row.account} onChange={(value) => setRow(at, "account", value)} />
                  </td>
                  <td className="w-[90px] p-1.5">
                    <input className={`${ZIN} text-right`} inputMode="decimal" value={row.qty} onChange={(event) => setRow(at, "qty", event.target.value)} />
                  </td>
                  <td className="w-[120px] p-1.5">
                    <input className={`${ZIN} text-right`} inputMode="decimal" value={row.rate} onChange={(event) => setRow(at, "rate", event.target.value)} />
                  </td>
                  <td className="w-[150px] p-1.5">
                    <select className={ZIN} value={row.taxId} onChange={(event) => setRow(at, "taxId", event.target.value)}>
                      <option value="">No tax</option>
                      {choices.taxes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} [{t.pct}%]
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1.5 text-right">{zMoney(lineTotal(row), "")}</td>
                  <td className="p-1.5">
                    {rows.length > 1 && (
                      <button type="button" aria-label="Remove line" className="text-[#d6141d]" onClick={() => setRows(rows.filter((_, i) => i !== at))}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="flex items-center gap-1 px-3 py-2 text-[#1c5bd9]" onClick={() => setRows([...rows, blank])}>
            <Plus size={14} /> Add New Row
          </button>
        </div>
        <div className="mt-3 ml-auto max-w-[360px] rounded-md bg-[#f9f9fb] p-3 text-right text-[15px] font-semibold">Total (PHP) {zMoney(total, "")}</div>
        <label className="mt-3 block max-w-xl">
          <span>Customer Notes</span>
          <textarea className={`${ZIN} mt-1 h-16 py-2`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </div>
    </ZPage>
  );
}

// ------------------------------------------------------------------ on a document: refund, publish

export function RefundBox({ doc, onDone }: { doc: BookDoc; onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const choices = useLedgerChoices().data;
  const [form, setForm] = useState({ date: "", amount: (doc.balance / 100).toFixed(2), from: "", mode: "", reference: "" });
  if (!choices) return <Loading />;
  return (
    <div className="mx-auto max-w-[820px] rounded-md border border-[#408dfb] p-4">
      <div className="mb-2 font-medium">Refund from {doc.number} (left: {zMoney(doc.balance)})</div>
      {action.problem && <div className="mb-2 text-[#b91c1c]">{action.problem.message}</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          Date
          <input type="date" className={ZIN} value={form.date || choices.today} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </label>
        <label>
          Amount
          <input className={ZIN} inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </label>
        <label>
          Paid Through
          <AccountSelect choices={choices} money value={form.from} onChange={(value) => setForm({ ...form, from: value })} />
        </label>
        <label>
          Mode
          <input className={ZIN} placeholder="Bank Transfer, GCash, Cash" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} />
        </label>
        <label className="sm:col-span-2">
          Reference#
          <input className={ZIN} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Primary
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/books/${doc.kind}/${doc.id}/refund`, {
                body: { date: form.date || choices.today, amount: cents(form.amount), from: form.from, mode: form.mode || null, reference: form.reference || null },
              });
              await queries.invalidateQueries({ queryKey: ["books"] });
              onDone();
            })
          }
        >
          Save Refund
        </Primary>
        <Plain onClick={onDone}>Cancel</Plain>
      </div>
    </div>
  );
}

export function PublishButton({ doc, className }: { doc: BookDoc; className: string }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <button
      type="button"
      disabled={action.busy}
      className={className}
      title={action.problem?.message}
      onClick={() =>
        void action.run(async () => {
          await api(`/api/books/journal/${doc.id}/publish`, { body: {} });
          await queries.invalidateQueries({ queryKey: ["books"] });
        })
      }
    >
      {action.problem ? `⚠ ${action.problem.message}` : "Publish"}
    </button>
  );
}

// ------------------------------------------------------------------ Transaction Locking

const MODULES: { key: LockModule; label: string; what: string }[] = [
  { key: "sales", label: "Sales", what: "Invoices, payments received, credit notes, refunds" },
  { key: "purchases", label: "Purchases", what: "Bills, payments made, vendor credits, expenses" },
  { key: "banking", label: "Banking", what: "Transfers and deposits" },
  { key: "accountant", label: "Accountant", what: "Manual journals" },
  { key: "all", label: "All Transactions", what: "Every module at once" },
];

export function LockingPage() {
  const queries = useQueryClient();
  const action = useAction();
  const data = useQuery({ queryKey: ["books", "locks"], queryFn: () => api<BookLocks>("/api/books-locks") }).data;
  const [editing, setEditing] = useState<{ module: LockModule; unlock: boolean } | null>(null);
  const [form, setForm] = useState({ lockDate: "", reason: "" });
  const save = () =>
    void action.run(async () => {
      if (!editing) return;
      await api(`/api/books-locks/${editing.module}${editing.unlock ? "/unlock" : ""}`, { body: editing.unlock ? { reason: form.reason } : { lockDate: form.lockDate, reason: form.reason || null } });
      await queries.invalidateQueries({ queryKey: ["books"] });
      setEditing(null);
      setForm({ lockDate: "", reason: "" });
    });
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] shrink-0 items-center border-b border-[#ebeaf2] px-5">
        <h1 className="text-[20px] font-medium text-[#212529]">Transaction Locking</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="max-w-2xl text-[#4b4f63]">
          Locking stops anyone from making, changing or voiding a module's transactions dated on or before the lock day. Unlocking needs a reason, and every lock and unlock is kept below.
        </p>
        {action.problem && <div className="mt-3 max-w-2xl rounded-md border border-[#f5c2c0] bg-[#fdf2f2] px-3 py-2 text-[#b91c1c]">{action.problem.message}</div>}
        <div className="mt-4 grid max-w-3xl gap-3">
          {MODULES.map((m) => {
            const lock = data?.locks.find((l) => l.module === m.key);
            const open = editing?.module === m.key;
            return (
              <div key={m.key} className="rounded-md border border-[#ebeaf2] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      {lock ? <Lock size={15} className="text-[#f76831]" /> : <LockOpen size={15} className="text-[#6c718a]" />} {m.label}
                    </div>
                    <div className="text-[12px] text-[#6c718a]">{m.what}</div>
                    <div className="mt-1 text-[13px]">
                      {lock ? `Locked up to ${zDate(lock.lockDate)}${lock.reason ? ` · ${lock.reason}` : ""}${lock.by ? ` · by ${lock.by}` : ""}` : "You have not locked the transactions in this module."}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="h-[32px] rounded-[5px] border border-[#d7d5e2] px-3" onClick={() => setEditing({ module: m.key, unlock: false })}>
                      {lock ? "Edit Lock" : "Lock"}
                    </button>
                    {lock && (
                      <button type="button" className="h-[32px] rounded-[5px] border border-[#d7d5e2] px-3" onClick={() => setEditing({ module: m.key, unlock: true })}>
                        Unlock
                      </button>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
                    {!editing?.unlock && (
                      <label>
                        Lock Date
                        <input type="date" className={ZIN} value={form.lockDate} onChange={(event) => setForm({ ...form, lockDate: event.target.value })} />
                      </label>
                    )}
                    <label className={editing?.unlock ? "sm:col-span-2" : ""}>
                      Reason{editing?.unlock ? "*" : ""}
                      <input className={ZIN} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
                    </label>
                    <div className="flex gap-2">
                      <Primary disabled={action.busy} onClick={save}>
                        {editing?.unlock ? "Unlock" : "Lock"}
                      </Primary>
                      <Plain onClick={() => setEditing(null)}>Cancel</Plain>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!!data?.log.length && (
          <div className="mt-6 max-w-3xl">
            <h2 className="mb-2 font-semibold">History</h2>
            <ul className="divide-y divide-[#ebeaf2] rounded-md border border-[#ebeaf2]">
              {data.log.map((entry, at) => (
                <li key={at} className="px-3 py-2 text-[13px]">
                  {entry.at.slice(0, 16).replace("T", " ")} · {entry.by ?? "—"} {entry.action === "lock" ? `locked ${entry.module} up to ${zDate(entry.lockDate)}` : `unlocked ${entry.module}`}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ New Account

const TYPES: [string, string][] = [
  ["bank", "Bank"], ["cash", "Cash"], ["credit_card", "Credit Card"], ["other_current_asset", "Other Current Asset"], ["fixed_asset", "Fixed Asset"], ["other_asset", "Other Asset"],
  ["stock", "Stock"], ["other_current_liability", "Other Current Liability"], ["long_term_liability", "Long Term Liability"], ["other_liability", "Other Liability"],
  ["equity", "Equity"], ["income", "Income"], ["other_income", "Other Income"], ["expense", "Expense"], ["other_expense", "Other Expense"], ["cost_of_goods_sold", "Cost Of Goods Sold"],
];

export function NewAccountBox({ onDone }: { onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const choices = useLedgerChoices().data;
  const [form, setForm] = useState({ name: "", code: "", type: "expense", parentId: "", description: "" });
  const parents = choices?.accounts.filter((a) => a.type === form.type) ?? [];
  return (
    <div className="m-5 max-w-[640px] rounded-md border border-[#408dfb] p-4">
      <div className="mb-2 font-medium">New Account</div>
      {action.problem && <div className="mb-2 text-[#b91c1c]">{action.problem.message}</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          Account Type*
          <select className={ZIN} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value, parentId: "" })}>
            {TYPES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Account Name*
          <input className={ZIN} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          Account Code
          <input className={ZIN} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
        </label>
        <label>
          Sub-account of
          <select className={ZIN} value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}>
            <option value="">None</option>
            {parents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          Description
          <input className={ZIN} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Primary
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("/api/books/accounts", {
                body: { name: form.name, code: form.code || null, type: form.type, parentId: form.parentId ? Number(form.parentId) : null, description: form.description || null },
              });
              await queries.invalidateQueries({ queryKey: ["books"] });
              onDone();
            })
          }
        >
          Save
        </Primary>
        <Plain onClick={onDone}>Cancel</Plain>
      </div>
    </div>
  );
}

export function AccountActiveButton({ id, active }: { id: number; active: boolean }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <button
      type="button"
      disabled={action.busy}
      className="h-[32px] rounded-[5px] border border-[#d7d5e2] px-3 text-[13px]"
      title={action.problem?.message}
      onClick={() =>
        void action.run(async () => {
          await api(`/api/books/accounts/${id}`, { body: { active: !active } });
          await queries.invalidateQueries({ queryKey: ["books"] });
        })
      }
    >
      {active ? "Mark as Inactive" : "Mark as Active"}
    </button>
  );
}

// ------------------------------------------------------------------ a recurring profile

/** On a recurring expense or bill: run it here from a day (stop it in Zoho the same day), stop or
 *  start it, and what it made here. */
export function RecurringPanel({ doc }: { doc: BookDoc }) {
  const queries = useQueryClient();
  const action = useAction();
  const mayLedger = useMayLedger();
  const [from, setFrom] = useState("");
  const made = useQuery({
    queryKey: ["books", "recurring", doc.id],
    queryFn: () => api<{ id: number; number: string; date: string; total: number; status: string }[]>(`/api/books-recurring/${doc.id}/made`),
    enabled: mayLedger,
  }).data;
  if (!mayLedger) return null;
  const crmFrom = (doc.fields["CRM From"] as string | undefined) ?? null;
  const active = doc.status.toLowerCase() === "active";
  const list = doc.kind === "recurring_expense" ? "expenses" : "bills";
  return (
    <div className="mx-auto max-w-[820px] rounded-md border border-[#ebeaf2] p-4">
      <div className="font-medium">Made here</div>
      <p className="text-[13px] text-[#6c718a]">
        {crmFrom
          ? `This profile's ${list} are made here from ${zDate(crmFrom)} (each day once).`
          : "The old system still makes this profile's documents. Pick the day this CRM takes over, and stop the profile there on the same day."}
      </p>
      {action.problem && <div className="mt-2 text-[#b91c1c]">{action.problem.message}</div>}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {!crmFrom && active && (
          <>
            <label>
              From
              <input type="date" className={ZIN} value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <Primary
              disabled={action.busy || !from}
              onClick={() =>
                void action.run(async () => {
                  await api(`/api/books/${doc.kind}/${doc.id}/take-over`, { body: { from } });
                  await queries.invalidateQueries({ queryKey: ["books"] });
                })
              }
            >
              Run it here
            </Primary>
          </>
        )}
        <Plain
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/books/${doc.kind}/${doc.id}/recurring`, { body: { active: !active } });
              await queries.invalidateQueries({ queryKey: ["books"] });
            })
          }
        >
          {active ? "Stop" : "Resume"}
        </Plain>
      </div>
      {!!made?.length && (
        <ul className="mt-3 divide-y divide-[#ebeaf2] rounded-md border border-[#ebeaf2]">
          {made.map((one) => (
            <li key={one.id} className="flex justify-between px-3 py-1.5 text-[13px]">
              <a className="text-[#1c5bd9]" href={`/books/${list}/${one.id}`}>
                {one.number}
              </a>
              <span>{zDate(one.date)}</span>
              <span>{zMoney(one.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
