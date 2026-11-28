import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Card, dayLabel, PageHead, PageState, peso, Problem, useAction } from "../ui";

type Run = {
  month: string;
  releasedAt: string;
  slips: number;
  gross: number;
  employerTotal: number;
  tax: number;
  contributions: number;
  net: number;
  journalDocId: number | null;
  journalNumber: string | null;
};

export function PayrollGlPage() {
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({
    queryKey: ["finance", "payroll-gl"],
    queryFn: () => api<{ runs: Run[]; accounts: string[] }>("/api/finance/payroll-gl"),
  });
  const data = query.data;

  const pick = (patterns: string[]) =>
    data?.accounts.find((a) => patterns.some((p) => a.toLowerCase().includes(p))) ?? data?.accounts[0] ?? "";

  const [expenseAccount, setExpenseAccount] = useState("");
  const [payableAccount, setPayableAccount] = useState("");
  const [taxAccount, setTaxAccount] = useState("");
  const [contribAccount, setContribAccount] = useState("");

  if (!data) return <PageState query={query} what="payroll journals" />;

  const exp = expenseAccount || pick(["salaries", "payroll", "wages"]);
  const pay = payableAccount || pick(["payroll payable", "accrued payroll", "salaries payable", "employee"]);
  const tax = taxAccount || pick(["withholding tax payable", "tax payable"]);
  const con = contribAccount || pick(["sss", "philhealth", "pag-ibig", "payroll", "other current liabilities"]);

  const post = (month: string) => {
    void action.run(async () => {
      await api(`/api/finance/payroll-gl/${month}/post`, {
        body: {
          expenseAccount: exp,
          payableAccount: pay,
          taxAccount: tax,
          contribAccount: con,
        },
      });
      await queries.invalidateQueries({ queryKey: ["finance", "payroll-gl"] });
      await queries.invalidateQueries({ queryKey: ["books"] });
    });
  };

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="Payroll to Books GL"
        sub="Post released HR payroll months as balanced Books journals in one click"
      />

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs font-medium text-slate-600">
            Salaries & Employer Expense (Dr)
            <select value={exp} onChange={(e) => setExpenseAccount(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm">
              {data.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Net Payroll Payable (Cr)
            <select value={pay} onChange={(e) => setPayableAccount(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm">
              {data.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Withholding Tax Payable (Cr)
            <select value={tax} onChange={(e) => setTaxAccount(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm">
              {data.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            SSS / PhilHealth / Pag-IBIG (Cr)
            <select value={con} onChange={(e) => setContribAccount(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm">
              {data.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        {action.problem && (
          <div className="mt-3">
            <Problem message={action.problem.message} />
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        {data.runs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            <BookOpenCheck className="mx-auto mb-2 size-8 text-slate-300" />
            No released HR payroll runs yet.
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Month</th>
                <th>Released</th>
                <th className="num">Payslips</th>
                <th className="num">Gross + Employer</th>
                <th className="num">1601-C Tax</th>
                <th className="num">Contributions</th>
                <th className="num">Net Pay</th>
                <th className="text-right">Books Journal</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.month}>
                  <td className="font-semibold text-slate-900">{run.month}</td>
                  <td className="text-slate-600">{dayLabel(run.releasedAt)}</td>
                  <td className="num">{run.slips}</td>
                  <td className="num font-semibold tabular-nums">{peso(run.gross + run.employerTotal)}</td>
                  <td className="num tabular-nums">{peso(run.tax)}</td>
                  <td className="num tabular-nums">{peso(run.contributions)}</td>
                  <td className="num tabular-nums">{peso(run.net)}</td>
                  <td className="text-right">
                    {run.journalDocId ? (
                      <Link
                        to={`/books/journals/${run.journalDocId}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        <CheckCircle2 size={13} /> {run.journalNumber ?? `Journal #${run.journalDocId}`}
                      </Link>
                    ) : (
                      <Button variant="primary" disabled={action.busy} onClick={() => post(run.month)}>
                        Post to Books
                      </Button>
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
