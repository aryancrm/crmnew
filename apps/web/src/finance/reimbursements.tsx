import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Receipt, Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Card, dayLabel, PageHead, PageState, peso, Problem, Tabs, useAction } from "../ui";

type Row = {
  id: number;
  personId: number;
  personName: string;
  day: string;
  head: string;
  headName: string;
  amount: number;
  note: string | null;
  hasFile: boolean;
  suggestedAccount: string | null;
  reimbursedDocId: number | null;
  reimbursedNumber: string | null;
  reimbursedAt: string | null;
  reimbursedBy: string | null;
};

type Resp = {
  rows: Row[];
  expenseAccounts: string[];
  paidThroughAccounts: string[];
  defaultExpenseAccount: string | null;
};

export function ReimbursementsPage() {
  const queries = useQueryClient();
  const action = useAction();
  const [view, setView] = useState<"open" | "paid">("open");
  const [picked, setPicked] = useState<number[]>([]);
  const [paidThrough, setPaidThrough] = useState("");
  const [accountName, setAccountName] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const query = useQuery({
    queryKey: ["finance", "reimbursements", view],
    queryFn: () => api<Resp>(`/api/finance/reimbursements?view=${view}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="reimbursements" />;

  const effectivePaidThrough = paidThrough || data.paidThroughAccounts[0] || "";
  const effectiveAccount = accountName || data.defaultExpenseAccount || data.expenseAccounts[0] || "";
  const selectedTotal = data.rows.filter((r) => picked.includes(r.id)).reduce((s, r) => s + r.amount, 0);

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setPicked((prev) => (prev.length === data.rows.length ? [] : data.rows.map((r) => r.id)));

  const pay = () => {
    void action.run(async () => {
      await api("/api/finance/reimbursements/pay", {
        body: {
          ids: picked,
          paidThrough: effectivePaidThrough,
          accountName: effectiveAccount,
          paidOn,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        },
      });
      setPicked([]);
      setReference("");
      setNote("");
      await queries.invalidateQueries({ queryKey: ["finance", "reimbursements"] });
      await queries.invalidateQueries({ queryKey: ["books"] });
    });
  };

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="MedRep reimbursements"
        sub="Approved field expense claims ready to pay out and post to Books in one click"
      >
        <Tabs
          value={view}
          onChange={(v) => {
            setView(v as "open" | "paid");
            setPicked([]);
          }}
          tabs={[
            { key: "open", label: "Ready to pay" },
            { key: "paid", label: "Reimbursed" },
          ]}
        />
      </PageHead>

      {view === "open" && data.rows.length > 0 && (
        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-5">
            <label className="text-xs font-medium text-slate-600">
              Paid through (Bank / Cash)
              <select
                value={effectivePaidThrough}
                onChange={(e) => setPaidThrough(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
              >
                {data.paidThroughAccounts.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Expense account
              <select
                value={effectiveAccount}
                onChange={(e) => setAccountName(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
              >
                {data.expenseAccounts.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Paid on
              <input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Reference / slip #
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="InstaPay / check #"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
              />
            </label>
            <div className="flex items-end justify-end">
              <Button variant="primary" disabled={action.busy || picked.length === 0} onClick={pay}>
                <Wallet size={15} aria-hidden="true" /> Pay {picked.length ? `${picked.length} (${peso(selectedTotal)})` : "selected"}
              </Button>
            </div>
          </div>
          {action.problem && (
            <div className="mt-3">
              <Problem message={action.problem.message} />
            </div>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto">
        {data.rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            <Receipt className="mx-auto mb-2 size-8 text-slate-300" />
            {view === "open"
              ? "No approved MedRep expenses waiting for reimbursement right now."
              : "No reimbursed MedRep expenses yet."}
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                {view === "open" && (
                  <th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={picked.length === data.rows.length && data.rows.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th>Date</th>
                <th>MedRep</th>
                <th>Expense head</th>
                <th>Notes</th>
                <th className="num">Approved</th>
                <th>{view === "open" ? "Receipt" : "Books Expense"}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  {view === "open" && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.personName} ${row.headName}`}
                        checked={picked.includes(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap text-slate-600">{dayLabel(row.day)}</td>
                  <td className="font-medium text-slate-900">{row.personName}</td>
                  <td>{row.headName}</td>
                  <td className="max-w-xs truncate text-slate-600">{row.note ?? "—"}</td>
                  <td className="num font-semibold tabular-nums">{peso(row.amount)}</td>
                  <td>
                    {view === "open" ? (
                      row.hasFile ? (
                        <a
                          href={`/api/mr/expenses/${row.id}/receipt`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-brand-dark hover:underline"
                        >
                          View receipt
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">None</span>
                      )
                    ) : (
                      <Link
                        to={`/books/expenses/${row.reimbursedDocId}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        <CheckCircle2 size={13} /> {row.reimbursedNumber ?? `EXP #${row.reimbursedDocId}`}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
