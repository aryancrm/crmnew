// A person's leave credits on HR's page of them: the year's ledger for vacation and sick leave
// (opening days, HR's adjustments, used, waiting, left), HR's lines (each with its reason, a wrong
// one reversed by another, never changed), and the second approver of their leave. And the
// year-end report: each person's unused vacation leave and the half that converts to pay.

import type { LeaveBalance, LeaveCredits, VlConversion } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Undo2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { FIELD } from "../org/dialogs";
import { Button, CARD, Dialog, PageHead, PageState, Problem, peso, useAction } from "../ui";

const daysWords = (days: number) => `${days} ${Math.abs(days) === 1 ? "day" : "days"}`;
const signed = (days: number) => (days > 0 ? `+${days}` : String(days));
const at = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" });

function Ledger({ label, balance }: { label: string; balance: LeaveBalance }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-100 p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 tabular-nums">
        {balance.left} <span className="text-sm font-normal text-slate-500">left</span>
      </div>
      <div className="text-xs text-slate-500">
        {balance.opening} opening
        {balance.adjusted ? ` ${balance.adjusted > 0 ? "+" : "−"} ${Math.abs(balance.adjusted)} by HR` : ""} ·{" "}
        {balance.used} used{balance.asked ? ` · ${balance.asked} waiting` : ""}
      </div>
    </div>
  );
}

export function LeaveCreditsBox({ personId }: { personId: number }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const query = useQuery({
    queryKey: ["hr", "credits", personId, year],
    queryFn: () => api<LeaveCredits>(`/api/hr/people/${personId}/credits?year=${year}`),
  });
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState<LeaveCredits["lines"][number] | null>(null);
  const data = query.data;
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-slate-900">Leave credits</h2>
          <Button small variant="quiet" aria-label="The year before" onClick={() => setYear(year - 1)}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-sm font-semibold tabular-nums text-slate-700">{year}</span>
          <Button small variant="quiet" aria-label="The year after" onClick={() => setYear(year + 1)}>
            <ChevronRight size={14} />
          </Button>
        </div>
        {data?.can.adjust && (
          <Button small onClick={() => setAdding(true)}>
            <Plus size={14} /> Adjust credits
          </Button>
        )}
      </div>
      {!data ? (
        <PageState query={query} what="the credits" />
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Ledger label="Vacation leave" balance={data.vl} />
            <Ledger label="Sick leave" balance={data.sl} />
          </div>
          <SecondApprover data={data} />
          {data.lines.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
              {data.lines.map((line) => (
                <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <span className={`font-semibold tabular-nums ${line.days > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {signed(line.days)} {line.kind.toUpperCase()}
                    </span>{" "}
                    <span className="text-slate-700">{line.reason}</span>
                    <div className="text-xs text-slate-500">
                      {line.by} · {at(line.at)}
                      {line.reverses ? " · reverses an earlier line" : ""}
                      {line.reversedBy ? " · reversed" : ""}
                    </div>
                  </div>
                  {data.can.adjust && !line.reverses && !line.reversedBy && (
                    <Button small variant="quiet" onClick={() => setReversing(line)}>
                      <Undo2 size={14} /> Reverse
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {adding && data && <AdjustDialog data={data} onClose={() => setAdding(false)} />}
      {reversing && <ReverseDialog line={reversing} onClose={() => setReversing(null)} />}
    </section>
  );
}

function SecondApprover({ data }: { data: LeaveCredits }) {
  const queries = useQueryClient();
  const action = useAction();
  const pick = (value: string) =>
    action.run(async () => {
      await api(`/api/hr/people/${data.personId}/second-approver`, {
        body: { personId: value ? Number(value) : null },
      });
      await queries.invalidateQueries({ queryKey: ["hr", "credits", data.personId] });
    });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500">Second approver of leave:</span>
      {data.can.adjust ? (
        <select
          value={data.secondApprover?.id ?? ""}
          disabled={action.busy}
          onChange={(event) => void pick(event.target.value)}
          className={`${FIELD} max-w-64`}
        >
          <option value="">None</option>
          {data.approvers.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="font-medium text-slate-900">{data.secondApprover?.name ?? "None"}</span>
      )}
      <span className="text-xs text-slate-500">They decide this person's leave too; the first to decide closes it.</span>
      <Problem message={action.problem?.message} />
    </div>
  );
}

function AdjustDialog({ data, onClose }: { data: LeaveCredits; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [kind, setKind] = useState<"vl" | "sl">("vl");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(`/api/hr/people/${data.personId}/credits`, {
        body: { year: data.year, kind, days: Number(days), reason },
      });
    });
    if (done) {
      await queries.invalidateQueries({ queryKey: ["hr", "credits", data.personId] });
      onClose();
    }
  }
  return (
    <Dialog
      title={`Adjust ${data.name}'s ${data.year} credits`}
      sub="Add days (2) or take them off (-1); half days allowed. A wrong line is reversed, never changed."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Kind *</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as "vl" | "sl")} className={FIELD}>
              <option value="vl">Vacation leave</option>
              <option value="sl">Sick leave</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Days (+ or −) *</span>
            <input
              type="number"
              step="0.5"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className={FIELD}
            />
            {action.at("days") && <span className="text-xs text-rose-700">{action.at("days")}</span>}
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Why *</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Carried from HR's leave tracker"
            className={FIELD}
          />
          {action.at("reason") && <span className="text-xs text-rose-700">{action.at("reason")}</span>}
        </label>
        <Problem message={action.general(["days", "reason"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : `Save ${daysWords(Number(days) || 0)}`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReverseDialog({ line, onClose }: { line: LeaveCredits["lines"][number]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() => api(`/api/hr/credits/${line.id}/reverse`, { body: { reason } }));
    if (done) {
      await queries.invalidateQueries({ queryKey: ["hr", "credits"] });
      onClose();
    }
  }
  return (
    <Dialog
      title="Reverse this adjustment"
      sub={`${signed(line.days)} ${line.kind.toUpperCase()}: ${line.reason}. A line of ${signed(-line.days)} is added; both stay on record.`}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Why *</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} className={FIELD} />
        </label>
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            Reverse it
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Year-end: unused vacation leave and the half of it that converts to pay (a report only). */
export function VlConversionPage() {
  const [params, setParams] = useSearchParams();
  const year = Number(params.get("year")) || new Date().getFullYear();
  const query = useQuery({
    queryKey: ["hr", "conversion", year],
    queryFn: () => api<VlConversion>(`/api/hr/leave/conversion?year=${year}`),
  });
  const data = query.data;
  const go = (next: number) => setParams({ year: String(next) }, { replace: true });
  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Vacation leave to convert"
        sub="Half of each person's unused vacation leave, at their day rate (monthly × 12 ÷ 313). A report for HR: payroll doesn't pay it."
        actions={
          <div className="flex items-center gap-1">
            <Button small variant="quiet" aria-label="The year before" onClick={() => go(year - 1)}>
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-14 text-center text-sm font-semibold text-slate-800">{year}</span>
            <Button small variant="quiet" aria-label="The year after" onClick={() => go(year + 1)}>
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />
      {!data ? (
        <PageState query={query} what="the report" />
      ) : (
        <section className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Person</th>
                <th className="px-3 py-2 text-right">VL in the year</th>
                <th className="px-3 py-2 text-right">Used</th>
                <th className="px-3 py-2 text-right">Unused</th>
                <th className="px-3 py-2 text-right">To convert</th>
                <th className="px-3 py-2 text-right">A day</th>
                <th className="px-4 py-2 text-right">Comes to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.people.map((one) => (
                <tr key={one.personId}>
                  <td className="px-4 py-2 font-medium text-slate-900">{one.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.used}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.unused}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{daysWords(one.convertDays)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{one.perDay === null ? "No salary" : peso(one.perDay)}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {one.amount === null ? "—" : peso(one.amount)}
                  </td>
                </tr>
              ))}
              {data.people.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Nobody with vacation leave this year.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t border-slate-200 font-semibold">
              <tr>
                <td className="px-4 py-2" colSpan={4}>
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{daysWords(data.totals.convertDays)}</td>
                <td />
                <td className="px-4 py-2 text-right tabular-nums">{peso(data.totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </div>
  );
}
