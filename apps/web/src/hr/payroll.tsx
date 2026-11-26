// Payroll, one a month: HR's months and each one's register. A month not yet released is worked
// out from the DTR as it stands (a day HR puts right shows at once); HR adds its own lines on a
// payslip and releases the month once it has ended, which freezes the payslips. The CEO reads the same pages
// and changes nothing. The law's rates are on their own page.

import type { PayRuleRow, PayrollList, PayrollMonth, Payslip } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Scale, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { RegisterCompareBox } from "./pay-register";
import { longDay, PayslipView } from "./payslip";
import {
  Button,
  CARD,
  Dialog,
  PageHead,
  PageState,
  Pill,
  Problem,
  peso,
  Tile,
  type Tone,
  useAction,
} from "../ui";

/** The Manila calendar day of a moment the API sent (UTC). */
const manilaDayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));
const STATUS: Record<PayrollMonth["status"], [string, Tone]> = {
  running: ["Running", "info"],
  ready: ["Ready to release", "warn"],
  released: ["Released", "good"],
};
const lineOf = (slip: Payslip, key: string) =>
  slip.deductions.find((one) => one.key === key)?.amount ?? 0;
const others = (slip: Payslip) =>
  slip.deductions.filter((one) => one.adjustmentId).reduce((sum, one) => sum + one.amount, 0);
const timeOff = (slip: Payslip) => slip.less.reduce((sum, one) => sum + one.amount, 0);

export function PayrollPage() {
  const query = useQuery({
    queryKey: ["payroll", "list"],
    queryFn: () => api<PayrollList>("/api/hr/payroll"),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="payroll" />;
  const lastReleased = data.periods.findIndex((one) => one.status === "released");
  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Payroll"
        sub="The 1st to the month's last day, paid on the last day"
        actions={
          <Link to="/hr/payroll/rates">
            <Button small>
              <Scale size={14} /> Rates
            </Button>
          </Link>
        }
      />
      <section className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Month</th>
                <th className="px-3 py-2">Pay day</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">People</th>
                <th className="px-3 py-2 text-right">Gross pay</th>
                <th className="px-4 py-2 text-right">Net pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.periods.map((one, at) => {
                // An ended month older than one released (or than last month) was never run
                // here: it isn't waiting on anyone.
                const stale =
                  one.status === "ready" && ((lastReleased >= 0 && at > lastReleased) || at > 1);
                const [word, tone]: [string, Tone] = stale
                  ? ["Not released", "plain"]
                  : STATUS[one.status];
                return (
                  <tr key={one.key} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/hr/payroll/${one.key}`}
                        className="font-semibold text-slate-900 hover:text-emerald-700"
                      >
                        {one.label}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                      {longDay(one.payDay)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={tone}>{word}</Pill>
                      {one.released && (
                        <span className="ml-2 text-xs text-slate-500">by {one.released.by}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {one.people ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {one.gross !== null ? (
                        peso(one.gross)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {one.net !== null ? (
                        peso(one.net)
                      ) : (
                        <span className="font-normal text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function PayrollMonthPage() {
  const { month = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const picked = Number(params.get("person")) || null;
  const query = useQuery({
    queryKey: ["payroll", month],
    queryFn: () => api<PayrollMonth>(`/api/hr/payroll/${month}`),
    placeholderData: (previous) => previous,
  });
  const [q, setQ] = useState("");
  const [releasing, setReleasing] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the month" />;
  const [word, tone] = STATUS[data.status];
  const words = q.trim().toLowerCase();
  const rows = data.slips.filter(
    (one) =>
      !words ||
      `${one.person.name} ${one.person.employeeCode ?? ""} ${one.person.department ?? ""}`
        .toLowerCase()
        .includes(words),
  );
  const open = data.slips.find((one) => one.person.id === picked) ?? null;
  const pick = (id: number | null) => {
    const out = new URLSearchParams(params);
    if (id) out.set("person", String(id));
    else out.delete("person");
    setParams(out, { replace: true });
  };
  const t = data.totals;

  return (
    <div className={`flex flex-col gap-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title={`Payroll · ${data.label}`}
        tags={<Pill tone={tone}>{word}</Pill>}
        sub={
          data.released
            ? `Pay day ${longDay(data.payDay)} · released by ${data.released.by} on ${longDay(manilaDayOf(data.released.at))}`
            : `Pay day ${longDay(data.payDay)} · a draft from the DTR as it stands`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1">
              <Button
                small
                variant="quiet"
                aria-label="The month before"
                onClick={() => navigate(`/hr/payroll/${data.before}`)}
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                small
                variant="quiet"
                aria-label="The month after"
                disabled={!data.after}
                onClick={() => data.after && navigate(`/hr/payroll/${data.after}`)}
              >
                <ChevronRight size={16} />
              </Button>
            </span>
            {data.slips.length > 0 && (
              <>
                <a href={`/api/hr/payroll/${data.key}/register.xlsx`} download>
                  <Button small>
                    <Download size={14} /> Excel
                  </Button>
                </a>
                <a href={`/api/hr/payroll/${data.key}/register.csv`} download>
                  <Button small>
                    <Download size={14} /> CSV
                  </Button>
                </a>
              </>
            )}
            {data.can.release && (
              <Button small variant="primary" onClick={() => setReleasing(true)}>
                Release payslips
              </Button>
            )}
          </div>
        }
      >
        {data.whyNotRelease && <p className="text-xs text-slate-500">{data.whyNotRelease}</p>}
      </PageHead>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile
          label="People paid"
          value={t.people}
          sub={
            data.noSalary.length
              ? `${data.noSalary.length} without a salary on record`
              : "Everyone has a salary"
          }
          tone={data.noSalary.length ? "warn" : "plain"}
        />
        <Tile label="Gross pay" value={peso(t.gross)} sub="after time not worked" />
        <Tile label="Deductions" value={peso(t.deductions)} sub={`${peso(t.tax)} of it tax`} />
        <Tile
          label="Net pay"
          value={peso(t.net)}
          tone="good"
          sub="what the bank pays out"
        />
        <Tile
          label="Company's shares"
          value={peso(t.employer)}
          sub="SSS, PhilHealth and Pag-IBIG on top"
        />
      </div>

      {data.noSalary.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          Not paid here until their salary is on their record:{" "}
          {data.noSalary.map((one, at) => (
            <span key={one.id}>
              {at > 0 && ", "}
              <Link to={`/hr/people/${one.id}`} className="font-semibold underline">
                {one.name}
              </Link>
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
        <section className={`${CARD} overflow-hidden self-start`}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <label className="relative flex items-center">
              <Search size={15} className="pointer-events-none absolute left-3 text-slate-400" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Find a person"
                className="h-9 w-56 max-w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm [&_td]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-2">Person</th>
                  <th className="px-3 py-2 text-right">Days in</th>
                  <th className="px-3 py-2 text-right">Time off</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">SSS</th>
                  <th className="px-3 py-2 text-right">PhilHealth</th>
                  <th className="px-3 py-2 text-right">Pag-IBIG</th>
                  <th className="px-3 py-2 text-right">Tax</th>
                  <th className="px-3 py-2 text-right">Other</th>
                  <th className="px-4 py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((one) => {
                  const off = timeOff(one);
                  const other = others(one);
                  return (
                    <tr
                      key={one.person.id}
                      onClick={() => pick(one.person.id === picked ? null : one.person.id)}
                      className={`cursor-pointer ${one.person.id === picked ? "bg-emerald-50/70" : "hover:bg-slate-50/70"}`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">{one.person.name}</div>
                        <div className="text-xs text-slate-500">
                          {[one.person.employeeCode, one.person.position]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {one.attendance.present}
                        <span className="text-slate-400">/{one.attendance.workDays}</span>
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${off ? "text-rose-700" : "text-slate-400"}`}
                      >
                        {off ? `−${peso(off)}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{peso(one.gross)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                        {peso(lineOf(one, "sss"))}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                        {peso(lineOf(one, "philhealth"))}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                        {peso(lineOf(one, "pagibig"))}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">
                        {peso(lineOf(one, "tax"))}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${other ? "text-slate-700" : "text-slate-400"}`}
                      >
                        {other ? peso(other) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {peso(one.net)}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-500">
                      {data.slips.length
                        ? "Nobody by that name."
                        : "Nobody has a salary on record."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {open ? (
          <div className="self-start">
            <PayslipView
              slip={open}
              label={data.label}
              payDay={data.payDay}
              draft={data.status !== "released"}
              forHr
              canAdjust={data.can.adjust}
              onPrint
            />
          </div>
        ) : (
          <p className={`${CARD} self-start px-4 py-6 text-center text-sm text-slate-500`}>
            Pick a person to see their payslip
            {data.can.adjust ? " and add a line (cash advance, loan, correction)" : ""}.
          </p>
        )}
      </div>
      <RegisterCompareBox month={data.key} />
      {releasing && <ReleaseDialog data={data} onClose={() => setReleasing(false)} />}
    </div>
  );
}

function ReleaseDialog({ data, onClose }: { data: PayrollMonth; onClose: () => void }) {
  const action = useAction();
  const queries = useQueryClient();
  return (
    <Dialog title={`Release ${data.label}?`} onClose={onClose} busy={action.busy}>
      <div className="flex flex-col gap-4 text-sm text-slate-700">
        <p>
          {data.totals.people} payslips, {peso(data.totals.net)} net pay, paid{" "}
          {longDay(data.payDay)}. Each person is told and can read their own. Once released, the
          payslips stay as they are: a later change goes on the next month.
        </p>
        {data.noSalary.length > 0 && (
          <p className="text-amber-800">
            {data.noSalary.length} {data.noSalary.length === 1 ? "person has" : "people have"} no
            salary on record and get no payslip.
          </p>
        )}
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={action.busy}
            onClick={async () => {
              const done = await action.run(() =>
                api(`/api/hr/payroll/${data.key}/release`, { body: {} }),
              );
              if (done) {
                await queries.invalidateQueries({ queryKey: ["payroll"] });
                onClose();
              }
            }}
          >
            {action.busy ? "Releasing…" : "Release payslips"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ the rates

const pct = (bps: number) => `${bps / 100}%`;
type Rule = Record<string, number> & { rows?: { over: number; base: number; rateBps: number }[] };
function ruleWords(kind: PayRuleRow["kind"], rule: Rule): string[] {
  if (kind === "sss")
    return [
      `Monthly salary credit ${peso(rule.mscMin as number)} to ${peso(rule.mscMax as number)}, in ${peso(rule.step as number)} steps`,
      `Employee ${pct(rule.employeeBps as number)} · employer ${pct(rule.employerBps as number)}`,
      `EC on the employer: ${peso(rule.ecLow as number)} below a ${peso(rule.ecBreak as number)} credit, ${peso(rule.ecHigh as number)} from it`,
    ];
  if (kind === "philhealth")
    return [
      `${pct(rule.rateBps as number)} of the monthly salary, counted between ${peso(rule.floor as number)} and ${peso(rule.ceiling as number)}`,
      "Shared equally by the employee and the company",
    ];
  if (kind === "pagibig")
    return [
      `Employee ${pct(rule.employeeBps as number)} · employer ${pct(rule.employerBps as number)} of the salary, up to ${peso(rule.maxBase as number)}`,
    ];
  return (rule.rows ?? []).map((row) =>
    row.rateBps === 0
      ? `Up to ${peso(rule.rows?.[1]?.over ?? 0)} a month: no tax`
      : `Over ${peso(row.over)}: ${peso(row.base)} plus ${pct(row.rateBps)} of the excess`,
  );
}
const KIND_WORDS: Record<PayRuleRow["kind"], string> = {
  sss: "SSS",
  philhealth: "PhilHealth",
  pagibig: "Pag-IBIG",
  tax: "Withholding tax (monthly)",
};

export function PayRatesPage() {
  const query = useQuery({
    queryKey: ["payroll", "rules"],
    queryFn: () => api<{ rules: PayRuleRow[] }>("/api/hr/payroll/rules"),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the rates" />;
  const kinds = ["sss", "philhealth", "pagibig", "tax"] as const;
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Pay rates" sub="The law's rates, each from the day it starts" />
      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((kind) => {
          const list = data.rules.filter((one) => one.kind === kind);
          const [now, ...older] = list;
          if (!now) return null;
          return (
            <section key={kind} className={`${CARD} flex flex-col gap-2 p-4`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{KIND_WORDS[kind]}</h2>
                <span className="text-xs text-slate-500">from {longDay(now.startsOn)}</span>
              </div>
              <ul className="list-disc pl-5 text-[13px] text-slate-700">
                {ruleWords(kind, now.rule as Rule).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {older.length > 0 && (
                <p className="text-xs text-slate-400">
                  Before: {older.map((one) => `from ${longDay(one.startsOn)}`).join(" · ")}
                </p>
              )}
            </section>
          );
        })}
        <section className={`${CARD} flex flex-col gap-2 p-4 lg:col-span-2`}>
          <h2 className="text-sm font-semibold text-slate-900">The company's own rules</h2>
          <ul className="list-disc pl-5 text-[13px] text-slate-700">
            <li>
              One payroll a month, the 1st to the last day, with the monthly salary and allowance
            </li>
            <li>A day's pay is the monthly salary × 12 ÷ 313; an hour's is a day's ÷ 8</li>
            <li>
              Absent, leave without pay, late and undertime come off at those rates (late and
              undertime in 15-minute blocks)
            </li>
            <li>SSS on what was earned in the month; PhilHealth and Pag-IBIG on the salary</li>
            <li>
              Approved overtime by its type, its first 8 hours and past them: a working day or
              broken time 125%; a rest day 130% (169% past 8); a special day +30% (169% past 8); a
              regular holiday +100% (260% past 8); a special day on a rest day 150% (195%); a regular
              holiday on a rest day 260% (338%). The monthly pay already carries a holiday's 100%
            </li>
            <li>
              A holiday worked with no overtime form adds 100% (regular) or 30% (special) of the
              day. Each person's holidays are the national ones and their town's or province's
            </li>
            <li>Night differential (10 PM to 6 AM) is shown on the payslip, not paid</li>
            <li>
              Paid on the month's last day; a weekend or holiday moves it to the working day before
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
