// A customer's statement of account, to read on screen or print and hand over: the company's
// letterhead, the days chosen, the balance brought forward, every invoice, payment and refund with
// the running balance, and what is open now by how late.

import type { Statement } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, dayLabel, PageState, peso } from "../ui";

const KIND: Record<Statement["lines"][number]["kind"], string> = {
  invoice: "Invoice",
  payment: "Payment",
  refund: "Refund",
};

export function StatementPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const query = useQuery({
    queryKey: ["statement", id, from, to],
    queryFn: () =>
      api<Statement>(
        `/api/finance/statement/${id}?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the statement" />;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const field = "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            From
            <input
              type="date"
              value={data.from}
              onChange={(event) => set("from", event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            To
            <input
              type="date"
              value={data.to}
              onChange={(event) => set("to", event.target.value)}
              className={field}
            />
          </label>
        </div>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" /> Print
        </Button>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0">
            <div className="text-lg font-bold text-slate-900">{data.company.name}</div>
            <div className="text-xs text-slate-500">{data.company.address}</div>
            <div className="text-xs text-slate-500">
              {[data.company.phone, data.company.email].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-semibold tracking-tight text-slate-900">
              Statement of account
            </div>
            <div className="text-xs text-slate-500">
              {dayLabel(data.from)} – {dayLabel(data.to)}
            </div>
          </div>
        </header>

        <section className="mt-4 flex flex-wrap justify-between gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500">For</div>
            <div className="font-semibold text-slate-900">{data.customer.name}</div>
            {data.customer.address && (
              <div className="text-xs text-slate-500">{data.customer.address}</div>
            )}
            <div className="text-xs text-slate-500">
              {[
                data.customer.code,
                data.customer.tin && `TIN ${data.customer.tin}`,
                data.customer.terms,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Balance due</div>
            <div
              className={`text-2xl font-semibold tabular-nums ${data.closing > 0 ? "text-rose-700" : "text-emerald-700"}`}
            >
              {peso(data.closing)}
            </div>
          </div>
        </section>

        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">What</th>
              <th className="py-2 font-medium">Reference</th>
              <th className="py-2 text-right font-medium">Billed</th>
              <th className="py-2 text-right font-medium">Paid</th>
              <th className="py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="py-2 text-slate-500" colSpan={5}>
                Brought forward, before {dayLabel(data.from)}
              </td>
              <td className="py-2 text-right font-semibold tabular-nums">{peso(data.opening)}</td>
            </tr>
            {data.lines.map((line) => (
              <tr key={`${line.kind}-${line.ref}-${line.day}-${line.balance}`}>
                <td className="py-2 whitespace-nowrap text-slate-600">{dayLabel(line.day)}</td>
                <td className="py-2">{KIND[line.kind]}</td>
                <td className="py-2 text-slate-600">
                  {line.ref}
                  {line.note && <span className="text-slate-400"> · {line.note}</span>}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {line.debit ? peso(line.debit) : ""}
                </td>
                <td className="py-2 text-right text-emerald-700 tabular-nums">
                  {line.credit ? peso(line.credit) : ""}
                </td>
                <td className="py-2 text-right font-medium tabular-nums">{peso(line.balance)}</td>
              </tr>
            ))}
            {data.lines.length === 0 && (
              <tr>
                <td className="py-4 text-center text-slate-500" colSpan={6}>
                  Nothing billed or paid in these days.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <td className="py-2 font-semibold" colSpan={5}>
                Balance due on {dayLabel(data.to)}
              </td>
              <td className="py-2 text-right font-bold tabular-nums">{peso(data.closing)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="mt-5 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
          {(
            [
              ["Not due yet", data.aging.current, "text-slate-800"],
              ["1–30 days late", data.aging.d30, "text-amber-700"],
              ["31–60 days late", data.aging.d60, "text-orange-700"],
              ["Over 60 days", data.aging.older, "text-rose-700"],
            ] as const
          ).map(([label, amount, tone]) => (
            <div key={label} className="rounded-lg border border-slate-200 px-2 py-2">
              <div className="text-slate-500">{label}</div>
              <div
                className={`mt-0.5 font-semibold tabular-nums ${amount ? tone : "text-slate-300"}`}
              >
                {peso(amount)}
              </div>
            </div>
          ))}
        </section>
        {data.company.footer && (
          <p className="mt-5 text-center text-[11px] text-slate-400">{data.company.footer}</p>
        )}
      </article>
    </div>
  );
}
