// A bank account's statement and its reconciliation (docs/BOOKS-PLAN.md C), in Zoho's Banking frame:
// Import Statement (a CSV from the bank), the lines still to do with what in the books matches
// them, Categorize (expense, deposit, transfer) or Exclude; and Reconcile: the statement's last day
// and closing balance, tick what cleared, the difference must be 0.00.

import type { BankReconcileView, BankStatement } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState } from "../no-results";
import { useAction } from "../ui";
import { Plain, Primary, ZIN } from "./forms";
import { kindInfo, zDate, zMoney } from "./kinds";
import { useLedgerChoices } from "./ledger";

const cents = (text: string) => {
  const value = Number(text.replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

/** A CSV line split on commas outside quotes. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** The bank's day as typed in the file → YYYY-MM-DD. */
function isoDay(text: string, order: "mdy" | "dmy"): string | null {
  const value = text.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parts = value.split(/[/.-]/).map((part) => part.trim());
  if (parts.length !== 3) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed + 8 * 3_600_000).toISOString().slice(0, 10);
  }
  let [a, b, c] = parts as [string, string, string];
  if (c.length === 2) c = `20${c}`;
  const [m, d] = order === "mdy" ? [a, b] : [b, a];
  if (!/^\d+$/.test(m) || !/^\d+$/.test(d) || !/^\d{4}$/.test(c)) return null;
  return `${c}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

type Parsed = { date: string; description: string | null; reference: string | null; amount: number }[];
function parseStatement(text: string, order: "mdy" | "dmy"): { rows: Parsed; problem: string | null } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headerAt = lines.findIndex((line) => /date/i.test(line));
  if (headerAt < 0) return { rows: [], problem: "The file needs a header row with a Date column." };
  const header = splitCsv(lines[headerAt] as string).map((h) => h.toLowerCase());
  const find = (...words: string[]) => header.findIndex((h) => words.some((w) => h.includes(w)));
  const dateCol = find("date");
  const descCol = find("description", "particular", "details", "narration", "payee");
  const refCol = find("reference", "ref", "check", "cheque");
  const amountCol = header.findIndex((h) => h === "amount");
  const inCol = find("deposit", "credit", "money in");
  const outCol = find("withdraw", "debit", "money out");
  if (amountCol < 0 && (inCol < 0 || outCol < 0)) return { rows: [], problem: "The file needs an Amount column, or Deposits and Withdrawals (Credit and Debit) columns." };
  const rows: Parsed = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitCsv(line);
    const date = isoDay(cells[dateCol] ?? "", order);
    if (!date) continue;
    const amount = amountCol >= 0 ? cents(cells[amountCol] ?? "") : cents(cells[inCol] ?? "") - cents(cells[outCol] ?? "");
    if (!amount) continue;
    rows.push({ date, description: descCol >= 0 ? cells[descCol] || null : null, reference: refCol >= 0 ? cells[refCol] || null : null, amount });
  }
  return { rows, problem: rows.length ? null : "No lines with a day and an amount were found." };
}

function Tabs({ account, at }: { account: string; at: "statement" | "reconcile" }) {
  const q = `account=${encodeURIComponent(account)}`;
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-4 border-b border-[#ebeaf2] px-5">
      <h1 className="mr-auto text-[20px] font-medium text-[#212529]">{account}</h1>
      <Link to={`/books/bankstatement?${q}`} className={at === "statement" ? "font-semibold text-[#408dfb]" : "text-[#4b4f63]"}>
        Bank Statement
      </Link>
      <Link to={`/books/reconcile?${q}`} className={at === "reconcile" ? "font-semibold text-[#408dfb]" : "text-[#4b4f63]"}>
        Reconcile
      </Link>
      <Link to="/books/banking" className="text-[#1c5bd9]">
        ← Banking
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ statement

export function BankStatementPage() {
  const [params, setParams] = useSearchParams();
  const account = params.get("account") ?? "";
  const view = params.get("view") ?? "uncategorized";
  const queries = useQueryClient();
  const action = useAction();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [order, setOrder] = useState<"mdy" | "dmy">("mdy");
  const [open, setOpen] = useState<number | null>(null);
  const data = useQuery({
    queryKey: ["books", "bank", account, view],
    queryFn: () => api<BankStatement>(`/api/books-bank/${encodeURIComponent(account)}/statement?view=${view}`),
    enabled: !!account,
  });
  const parsed = useMemo(() => (file ? parseStatement(file.text, order) : null), [file, order]);
  const refresh = () => queries.invalidateQueries({ queryKey: ["books"] });
  if (!account) return <p className="p-6">Open an account from Banking.</p>;
  const s = data.data;
  return (
    <div className="flex h-full flex-col">
      <Tabs account={account} at="statement" />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {action.problem && <div className="mb-3 rounded-md border border-[#f5c2c0] bg-[#fdf2f2] px-3 py-2 text-[#b91c1c]">{action.problem.message}</div>}
        <div className="mb-4 rounded-md border border-[#ebeaf2] p-4">
          <div className="font-medium">Import Statement</div>
          <p className="text-[12px] text-[#6c718a]">A CSV from the bank with a Date column and either Amount, or Deposits and Withdrawals. A line imported twice is kept once.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const picked = event.target.files?.[0];
                if (picked) setFile({ name: picked.name, text: await picked.text() });
              }}
            />
            <label className="flex items-center gap-1.5">
              Dates as
              <select className="rounded border border-[#d7d5e2] px-2 py-1" value={order} onChange={(event) => setOrder(event.target.value as "mdy" | "dmy")}>
                <option value="mdy">MM/DD/YYYY</option>
                <option value="dmy">DD/MM/YYYY</option>
              </select>
            </label>
            {parsed && (
              <span className={parsed.problem ? "text-[#b91c1c]" : "text-[#4b4f63]"}>
                {parsed.problem ?? `${parsed.rows.length} lines, ${zMoney(parsed.rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0))} in, ${zMoney(-parsed.rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0))} out`}
              </span>
            )}
            {parsed && !parsed.problem && (
              <Primary
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const result = await api<{ added: number; skipped: number }>(`/api/books-bank/${encodeURIComponent(account)}/import`, { body: { fileName: file?.name ?? null, rows: parsed.rows } });
                    setFile(null);
                    await refresh();
                    window.alert(`${result.added} lines added${result.skipped ? `, ${result.skipped} already here` : ""}.`);
                  })
                }
              >
                Import
              </Primary>
            )}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-4">
          {["uncategorized", "matched", "categorized", "excluded", "all"].map((key) => (
            <button key={key} type="button" onClick={() => setParams({ account, ...(key === "uncategorized" ? {} : { view: key }) })} className={view === key ? "font-semibold text-[#408dfb]" : "text-[#4b4f63]"}>
              {key[0]?.toUpperCase()}
              {key.slice(1)} {key !== "all" && s ? `(${s.counts[key] ?? 0})` : ""}
            </button>
          ))}
          {s && <span className="ml-auto text-[13px] text-[#6c718a]">Amount in the books: {zMoney(s.booksBalance)}</span>}
        </div>
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#ebeaf2] text-[11px] text-[#6c718a] uppercase">
              <th className="py-2 text-left font-normal">Date</th>
              <th className="py-2 text-left font-normal">Statement Details</th>
              <th className="py-2 text-right font-normal">Deposits</th>
              <th className="py-2 text-right font-normal">Withdrawals</th>
              <th className="py-2 pl-4 text-left font-normal">In the books</th>
            </tr>
          </thead>
          <tbody>
            {(s?.lines ?? []).map((line) => (
              <LineRow key={line.id} line={line} open={open === line.id} onOpen={() => setOpen(open === line.id ? null : line.id)} />
            ))}
          </tbody>
        </table>
        {s && !s.lines.length && <EmptyState title="Nothing in this view.">Lines from an imported bank statement show here, under the tab they belong to.</EmptyState>}
        {data.isPending && <p className="py-10 text-center text-[#6c718a]">Loading…</p>}
      </div>
    </div>
  );
}

function LineRow({ line, open, onOpen }: { line: BankStatement["lines"][number]; open: boolean; onOpen: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const run = (path: string, body: unknown) =>
    void action.run(async () => {
      await api(path, { body });
      await queries.invalidateQueries({ queryKey: ["books"] });
    });
  return (
    <>
      <tr className="border-b border-[#ebeaf2] align-top hover:bg-[#f9f9fb]">
        <td className="py-2 whitespace-nowrap">{zDate(line.date)}</td>
        <td className="py-2">
          <div>{line.description ?? ""}</div>
          {line.reference && <div className="text-[12px] text-[#6c718a]">Ref# {line.reference}</div>}
        </td>
        <td className="py-2 text-right">{line.amount > 0 ? zMoney(line.amount) : ""}</td>
        <td className="py-2 text-right">{line.amount < 0 ? zMoney(-line.amount) : ""}</td>
        <td className="py-2 pl-4">
          {line.status === "uncategorized" ? (
            <div className="space-y-1">
              {(line.suggestions ?? []).map((one) => (
                <button
                  key={one.key}
                  type="button"
                  disabled={action.busy}
                  onClick={() => run(`/api/books-bank/line/${line.id}/match`, { entryKey: one.key, ...(one.feeDiff ? { recordBankCharge: true } : {}) })}
                  className="block text-left text-[#1c5bd9] hover:underline"
                >
                  Match: {one.number ?? one.kind} · {one.party ?? ""} · {zDate(one.date)}
                  {one.matchReason === "reference" ? " · Ref# match" : ""}
                  {one.feeDiff ? ` · Record ${zMoney(one.feeDiff)} bank fee` : ""}
                </button>
              ))}
              <div className="flex gap-3">
                <button type="button" className="text-[#1c5bd9]" onClick={onOpen}>
                  Categorize
                </button>
                <button type="button" className="text-[#6c718a]" onClick={() => run(`/api/books-bank/line/${line.id}/status`, { to: "excluded" })}>
                  Exclude
                </button>
              </div>
              {action.problem && <div className="text-[#b91c1c]">{action.problem.message}</div>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] uppercase">{line.status}</span>
              {line.entryKey?.startsWith("books:") && line.docKind && (
                <Link className="text-[#1c5bd9]" to={`/books/${kindInfo(line.docKind)?.path ?? "journals"}/${line.entryKey.slice(6)}`}>
                  open
                </Link>
              )}
              {line.reconciled ? (
                <span className="text-[12px] text-[#22b378]">Reconciled</span>
              ) : (
                <button type="button" className="text-[12px] text-[#6c718a]" onClick={() => run(`/api/books-bank/line/${line.id}/status`, { to: "uncategorized" })}>
                  Undo
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[#ebeaf2] bg-[#fbfbfe]">
          <td colSpan={5} className="p-3">
            <Categorize line={line} onDone={onOpen} />
          </td>
        </tr>
      )}
    </>
  );
}

function Categorize({ line, onDone }: { line: BankStatement["lines"][number]; onDone: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const choices = useLedgerChoices().data;
  const out = line.amount < 0;
  const [as, setAs] = useState<"expense" | "deposit" | "transfer">(out ? "expense" : "deposit");
  const [form, setForm] = useState({ account: "", costCentre: "", type: "Services", department: "", pic: "", other: "", from: "" });
  if (!choices) return <p>Loading…</p>;
  const pick = (key: keyof typeof form, list: string[], label: string) => (
    <label>
      {label}
      <select className={ZIN} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })}>
        <option value="">Select</option>
        {list.map((one) => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </select>
    </label>
  );
  const allNames = choices.accounts.map((a) => a.name);
  const moneyNames = choices.moneyAccounts.map((a) => a.name);
  return (
    <div>
      <div className="mb-2 flex gap-4">
        {(out ? ["expense", "transfer"] : ["deposit", "transfer"]).map((one) => (
          <label key={one} className="flex items-center gap-1.5">
            <input type="radio" checked={as === one} onChange={() => setAs(one as typeof as)} /> {one === "expense" ? "Expense" : one === "deposit" ? "Deposit (other income, owner's contribution)" : out ? "Transfer to another account" : "Transfer from another account"}
          </label>
        ))}
      </div>
      {action.problem && <div className="mb-2 text-[#b91c1c]">{action.problem.message}</div>}
      <div className="grid gap-2 sm:grid-cols-3">
        {as === "expense" && (
          <>
            {pick("account", allNames, "Expense Account*")}
            {pick("costCentre", choices.options["Cost Centre"] ?? [], "Cost Centre*")}
            {pick("type", choices.options.Type ?? [], "Type*")}
            {pick("department", choices.options.Department ?? [], "Department*")}
            <label>
              PIC*
              <input className={ZIN} value={form.pic} onChange={(event) => setForm({ ...form, pic: event.target.value })} />
            </label>
          </>
        )}
        {as === "deposit" && pick("from", allNames, "Received from (account)*")}
        {as === "transfer" && pick("other", moneyNames, out ? "To account*" : "From account*")}
      </div>
      <div className="mt-3 flex gap-2">
        <Primary
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const body =
                as === "expense"
                  ? { as, expense: { account: form.account, taxInclusive: true, costCentre: form.costCentre, type: form.type, department: form.department, pic: form.pic } }
                  : as === "deposit"
                    ? { as, from: form.from }
                    : { as, other: form.other };
              await api(`/api/books-bank/line/${line.id}/categorize`, { body });
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

// ------------------------------------------------------------------ reconcile

export function ReconcilePage() {
  const [params] = useSearchParams();
  const account = params.get("account") ?? "";
  const queries = useQueryClient();
  const action = useAction();
  const [end, setEnd] = useState("");
  const [closing, setClosing] = useState("");
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const data = useQuery({
    queryKey: ["books", "reconcile", account, end],
    queryFn: () => api<BankReconcileView>(`/api/books-bank/${encodeURIComponent(account)}/reconcile${end ? `?end=${end}` : ""}`),
    enabled: !!account,
  }).data;
  const keys = ticked ?? new Set((data?.entries ?? []).filter((e) => e.onStatement).map((e) => e.key));
  const cleared = (data?.opening ?? 0) + (data?.entries ?? []).filter((e) => keys.has(e.key)).reduce((sum, e) => sum + e.amount, 0);
  const difference = cents(closing) - cleared;
  if (!account) return <p className="p-6">Open an account from Banking.</p>;
  return (
    <div className="flex h-full flex-col">
      <Tabs account={account} at="reconcile" />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {action.problem && <div className="mb-3 rounded-md border border-[#f5c2c0] bg-[#fdf2f2] px-3 py-2 text-[#b91c1c]">{action.problem.message}</div>}
        <div className="mb-4 flex flex-wrap items-end gap-4 rounded-md border border-[#ebeaf2] p-4">
          <label>
            Statement's last day
            <input type="date" className={ZIN} value={end || data?.end || ""} onChange={(event) => { setEnd(event.target.value); setTicked(null); }} />
          </label>
          <label>
            Closing balance (statement)
            <input className={ZIN} inputMode="decimal" value={closing} onChange={(event) => setClosing(event.target.value)} />
          </label>
          <div className="text-[13px]">
            <div>Opening {zMoney(data?.opening ?? 0)}{data?.start ? ` (reconciled up to ${zDate(data.start)})` : ""}</div>
            <div>Cleared {zMoney(cleared)}</div>
            <div className={difference ? "font-semibold text-[#d6141d]" : "font-semibold text-[#22b378]"}>Difference {zMoney(difference)}</div>
          </div>
          <Primary
            disabled={action.busy || difference !== 0 || !closing}
            onClick={() =>
              void action.run(async () => {
                await api(`/api/books-bank/${encodeURIComponent(account)}/reconcile`, { body: { end: end || data?.end, closing: cents(closing), keys: [...keys] } });
                setTicked(null);
                setClosing("");
                await queries.invalidateQueries({ queryKey: ["books"] });
              })
            }
          >
            Finish Reconciliation
          </Primary>
        </div>
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#ebeaf2] text-[11px] text-[#6c718a] uppercase">
              <th className="w-8 py-2" />
              <th className="py-2 text-left font-normal">Date</th>
              <th className="py-2 text-left font-normal">Transaction</th>
              <th className="py-2 text-right font-normal">Deposits</th>
              <th className="py-2 text-right font-normal">Withdrawals</th>
            </tr>
          </thead>
          <tbody>
            {(data?.entries ?? []).map((e) => (
              <tr key={e.key} className="border-b border-[#ebeaf2] hover:bg-[#f9f9fb]">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={keys.has(e.key)}
                    onChange={() => {
                      const next = new Set(keys);
                      if (next.has(e.key)) next.delete(e.key);
                      else next.add(e.key);
                      setTicked(next);
                    }}
                    aria-label={`Cleared ${e.number ?? e.key}`}
                  />
                </td>
                <td className="py-2 whitespace-nowrap">{zDate(e.date)}</td>
                <td className="py-2">
                  {e.number ?? e.kind} {e.party ? `· ${e.party}` : ""} {e.onStatement && <span className="ml-1 text-[11px] text-[#22b378]">on statement</span>}
                </td>
                <td className="py-2 text-right">{e.amount > 0 ? zMoney(e.amount) : ""}</td>
                <td className="py-2 text-right">{e.amount < 0 ? zMoney(-e.amount) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!!data?.history.length && (
          <div className="mt-6">
            <h2 className="mb-2 font-semibold">Reconciliation History</h2>
            <ul className="divide-y divide-[#ebeaf2] rounded-md border border-[#ebeaf2]">
              {data.history.map((r, at) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
                  <span>
                    {zDate(r.start)} – {zDate(r.end)}
                  </span>
                  <span>Closing {zMoney(r.closing)}</span>
                  <span className={r.status === "done" ? "text-[#22b378]" : "text-[#6c718a]"}>{r.status === "done" ? "Reconciled" : "Undone"}</span>
                  <span className="text-[#6c718a]">{r.by ?? ""}</span>
                  {r.status === "done" && at === data.history.findIndex((h) => h.status === "done") && (
                    <button
                      type="button"
                      className="ml-auto text-[#d6141d]"
                      onClick={() =>
                        void action.run(async () => {
                          await api(`/api/books-bank/reconciliation/${r.id}/undo`, { body: {} });
                          await queries.invalidateQueries({ queryKey: ["books"] });
                        })
                      }
                    >
                      Undo
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
