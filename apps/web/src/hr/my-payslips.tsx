// A person's own payslips: every released month, newest first, and the one picked, to read or
// print. A month HR hasn't released isn't shown.

import type { MyPayslips, PayPeriod, Payslip } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { longDay, PayslipView } from "./payslip";
import { CARD, PageHead, PageState, peso } from "../ui";

export function MyPayslipsPage() {
  const { month } = useParams();
  const list = useQuery({
    queryKey: ["payroll", "mine"],
    queryFn: () => api<MyPayslips>("/api/hr/payslips/mine"),
  });
  const picked = month ?? list.data?.slips[0]?.month ?? null;
  const slip = useQuery({
    queryKey: ["payroll", "mine", picked],
    queryFn: () => api<{ slip: Payslip; period: PayPeriod }>(`/api/hr/payslips/${picked}`),
    enabled: Boolean(picked),
  });
  const data = list.data;
  if (!data) return <PageState query={list} what="your payslips" />;
  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="My payslips"
        sub={data.slips.length ? `${data.slips.length} released` : "None released yet"}
      />
      {data.slips.length === 0 ? (
        <p className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>
          Your payslip shows here once HR releases the month: the 1st to the month's last day, paid
          on the last day.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav className={`${CARD} self-start overflow-hidden print:hidden`} aria-label="Payslips">
            <ul className="divide-y divide-slate-100">
              {data.slips.map((one) => (
                <li key={one.month}>
                  <Link
                    to={`/me/payslips/${one.month}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${one.month === picked ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900">{one.label}</span>
                      <span className="text-xs text-slate-500">Paid {longDay(one.payDay)}</span>
                    </span>
                    <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                      {peso(one.net)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {slip.data ? (
            <PayslipView
              slip={slip.data.slip}
              label={slip.data.period.label}
              payDay={slip.data.period.payDay}
              onPrint
            />
          ) : (
            <PageState query={slip} what="the payslip" />
          )}
        </div>
      )}
    </div>
  );
}
