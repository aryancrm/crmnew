// One payslip as a person reads it (and prints it): earnings, time not worked, gross, the
// deductions and the net pay, with the attendance it came from. HR sees the company's shares and,
// while the cut-off is a draft, adds or takes off its own lines here.

import type { Company, PayLine, Payslip } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Printer, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { Button, CARD, Dialog, Field, Problem, peso, useAction } from "../ui";
import { hours } from "./parts";

export const COMPANY_NAME: Record<Company, string> = {
  "2mg": "2MG Incorporated",
  gpi: "Getmeds Philippines Inc.",
};
export const longDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const days = (n: number) => `${n % 1 ? n.toFixed(1) : n} day${n === 1 ? "" : "s"}`;

/** What the slip's attendance came to, in a line. */
export function attendanceWords(slip: Payslip): string {
  const a = slip.attendance;
  const leave = (["vl", "sl", "other"] as const)
    .filter((key) => a.paidLeave[key] > 0)
    .map((key) => `${key === "other" ? "other leave" : key.toUpperCase()} ${a.paidLeave[key]}`);
  return [
    `${a.present} of ${a.workDays} working days in`,
    a.absent ? `${days(a.absent)} absent` : null,
    ...leave,
    a.unpaidLeave ? `${days(a.unpaidLeave)} without pay` : null,
    a.lateMinutes ? `late ${hours(a.lateMinutes)}` : null,
    a.undertimeMinutes ? `undertime ${hours(a.undertimeMinutes)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PayslipView({
  slip,
  label,
  payDay,
  draft,
  forHr,
  canAdjust,
  onPrint,
}: {
  slip: Payslip;
  label: string;
  payDay: string;
  /** Not released yet: worked out from the DTR as it stands. */
  draft?: boolean;
  /** HR's and the CEO's view: the company's shares and the rates. */
  forHr?: boolean;
  canAdjust?: boolean;
  onPrint?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const remove = useAction();
  const queries = useQueryClient();
  const removeLine = (id: number) =>
    remove.run(async () => {
      await api(`/api/hr/payroll/lines/${id}/remove`, { body: {} });
      await queries.invalidateQueries({ queryKey: ["payroll"] });
    });
  const row = (one: PayLine, minus = false) => (
    <li key={one.key} className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-slate-800">{one.label}</div>
        {one.detail && <div className="text-xs text-slate-500">{one.detail}</div>}
      </div>
      <span
        className={`shrink-0 tabular-nums ${minus ? "text-rose-700" : "text-slate-900"} ${one.amount === 0 ? "text-slate-400" : ""}`}
      >
        {minus && one.amount ? "−" : ""}
        {peso(one.amount)}
      </span>
      {canAdjust && one.adjustmentId && (
        <button
          type="button"
          aria-label={`Take off ${one.label}`}
          disabled={remove.busy}
          onClick={() => removeLine(one.adjustmentId as number)}
          className="-mr-1 grid size-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-700 print:hidden"
        >
          <X size={14} />
        </button>
      )}
    </li>
  );
  const p = slip.person;
  return (
    <article className={`${CARD} flex flex-col gap-4 p-5 print:border-0 print:shadow-none`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {COMPANY_NAME[p.company]} · Payslip{draft ? " (draft)" : ""}
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{p.name}</h2>
          <div className="text-xs text-slate-500">
            {[p.employeeCode, p.position, p.department].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-xs text-slate-500 sm:text-right">
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          <div>Pay day {longDay(payDay)}</div>
          {onPrint && (
            <Button small className="mt-2 print:hidden" onClick={() => window.print()}>
              <Printer size={14} /> Print
            </Button>
          )}
        </div>
      </header>

      <p className="text-[13px] text-slate-600">{attendanceWords(slip)}</p>

      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Earnings</h3>
          <ul className="mt-1 divide-y divide-slate-100 text-sm">
            {slip.earnings.map((one) => row(one))}
            {slip.less.map((one) => row(one, true))}
          </ul>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
            <span>Gross pay</span>
            <span className="tabular-nums">{peso(slip.gross)}</span>
          </div>
        </section>
        <section>
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Deductions
          </h3>
          <ul className="mt-1 divide-y divide-slate-100 text-sm">
            {slip.deductions.map((one) => row(one))}
          </ul>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
            <span>Total deductions</span>
            <span className="tabular-nums">{peso(slip.totalDeductions)}</span>
          </div>
        </section>
      </div>
      <Problem message={remove.problem?.message} />

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3">
        <div className="text-xs text-emerald-900">
          Taxable pay {peso(slip.taxable)}
          {forHr && (
            <div className="text-emerald-800/80">
              {peso(slip.monthlySalary)} a month · {peso(slip.dailyRate)} a day ·{" "}
              {peso(slip.hourlyRate)} an hour
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-emerald-800">Net pay</div>
          <div className="text-2xl font-bold text-emerald-900 tabular-nums">{peso(slip.net)}</div>
        </div>
      </div>

      {forHr && slip.employer && (
        <p className="text-xs text-slate-500">
          The company pays besides: SSS {peso(slip.employer.sss)} · PhilHealth{" "}
          {peso(slip.employer.philhealth)} · Pag-IBIG {peso(slip.employer.pagibig)}
          {slip.bank?.account
            ? ` · Pay to ${[slip.bank.name, slip.bank.account].filter(Boolean).join(" ")}`
            : ""}
        </p>
      )}
      {canAdjust &&
        (adding ? (
          <AddLine slip={slip} onClose={() => setAdding(false)} />
        ) : (
          <div className="print:hidden">
            <Button small onClick={() => setAdding(true)}>
              <Plus size={14} /> Add a line
            </Button>
          </div>
        ))}
    </article>
  );
}

function AddLine({ slip, onClose }: { slip: Payslip; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [kind, setKind] = useState<"earning" | "deduction">("deduction");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const pesos = Number(amount.replace(/[₱,\s]/g, ""));
    const done = await action.run(() =>
      api(`/api/hr/payroll/${slip.cutoff}/lines`, {
        body: {
          personId: slip.person.id,
          label,
          kind,
          taxable: kind === "earning" ? taxable : true,
          amount: Number.isFinite(pesos) ? Math.round(pesos * 100) : 0,
          note: note.trim() || null,
        },
      }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    }
  }
  return (
    <Dialog title={`A line on ${slip.person.name}'s payslip`} onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What it is" error={action.at("label")}>
            {(props) => (
              <input
                {...props}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={kind === "deduction" ? "Cash advance" : "Rice subsidy"}
                className="field"
              />
            )}
          </Field>
          <Field label="Amount (₱)" error={action.at("amount")}>
            {(props) => (
              <input
                {...props}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="1,000"
                className="field"
              />
            )}
          </Field>
        </div>
        <fieldset className="flex gap-2">
          {(
            [
              ["deduction", "Takes off (loan, cash advance)"],
              ["earning", "Adds (bonus, correction)"],
            ] as const
          ).map(([value, words]) => (
            <label
              key={value}
              className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${kind === value ? "border-emerald-400 bg-emerald-50 font-semibold text-emerald-900" : "border-slate-200 text-slate-700"}`}
            >
              <input
                type="radio"
                name="kind"
                checked={kind === value}
                onChange={() => setKind(value)}
                className="accent-emerald-600"
              />
              {words}
            </label>
          ))}
        </fieldset>
        {kind === "earning" && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(event) => setTaxable(event.target.checked)}
              className="size-4 accent-emerald-600"
            />
            Taxable (leave it ticked unless it is a de minimis benefit)
          </label>
        )}
        <Field label="Note (shown on the payslip)" error={action.at("note")}>
          {(props) => (
            <input
              {...props}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="2 of 5 instalments"
              className="field"
            />
          )}
        </Field>
        <Problem message={action.general(["label", "amount", "note"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Adding…" : "Add the line"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
