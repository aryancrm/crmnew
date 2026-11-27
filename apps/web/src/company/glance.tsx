// The company at a glance on the CEO's Home (Aryan, 19 Nov: "put everything about the company on
// the Home, colourful, pictures"): coloured bars and blocks for the people by department and who is
// working today, each channel against its target, the month's sales day by day, the top sellers,
// customers and medicines, the Online desk's enquiries, the orders by step, the stock by warehouse
// and the customers by kind. Each card opens its own page.

import type { CompanyGlance as Data } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";

const CARD = "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const PALETTE = ["#1f9d55", "#1d9fda", "#f59e0b", "#e11d48", "#7c3aed", "#0d9488", "#ea580c", "#0891b2", "#65a30d", "#db2777"];
const STEP: Record<string, string> = {
  pending_approval: "At Management",
  finance_check: "At Finance",
  ready_for_invoice: "Credit check",
  ready_for_dispatch: "To pack",
  packing: "Packing",
  shipped: "On the road",
  completed: "Delivered",
  on_hold: "On hold",
  exception: "Exception",
  cancelled: "Cancelled",
};
const SOURCE: Record<string, string> = { messenger: "Messenger", website: "Website", website_2mg: "2MG website", email: "Email", phone: "Phone", viber: "Viber", other: "Other" };
const KIND: Record<string, string> = { hospital: "Hospitals", government: "Government", doctor: "Doctors", patient: "Patients", distributor: "Distributors", drugstore: "Drugstores" };

function Head({ title, to, sub }: { title: string; to?: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {to ? (
        <Link to={to} className="text-[11.5px] font-semibold text-brand hover:underline">
          {sub ?? "Open"} →
        </Link>
      ) : sub ? (
        <span className="text-[11.5px] text-slate-500">{sub}</span>
      ) : null}
    </div>
  );
}

/** Horizontal bars, each its own colour. */
function Bars({ rows, money }: { rows: { label: string; value: number; extra?: string }[]; money?: boolean }) {
  const top = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="text-[12.5px] text-slate-400">Nothing yet this month.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, at) => (
        <li key={row.label} className="text-[12.5px]">
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="truncate text-slate-700">{row.label}</span>
            <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
              {money ? shortPeso(row.value) : row.value.toLocaleString("en-PH")}
              {row.extra ? <span className="ml-1 font-normal text-slate-400">{row.extra}</span> : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, (row.value / top) * 100)}%`, background: PALETTE[at % PALETTE.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One stacked strip of shares, with its legend. */
function Stack({ rows }: { rows: { label: string; value: number }[] }) {
  const all = rows.reduce((sum, row) => sum + row.value, 0);
  if (!all) return <p className="text-[12.5px] text-slate-400">Nothing yet.</p>;
  return (
    <>
      <div className="flex h-4 overflow-hidden rounded-full">
        {rows.map((row, at) => (
          <div key={row.label} title={`${row.label}: ${row.value}`} style={{ width: `${(row.value / all) * 100}%`, background: PALETTE[at % PALETTE.length] }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        {rows.map((row, at) => (
          <li key={row.label} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[at % PALETTE.length] }} />
            <span className="truncate text-slate-600">{row.label}</span>
            <span className="ml-auto font-semibold text-slate-900 tabular-nums">{row.value.toLocaleString("en-PH")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The business part (sales, money, orders, medicines, customers) or the people part (headcount,
 *  who's in today, people by department): the CEO's Home shows the business first and the people
 *  at its foot (Aryan, 19 Nov). */
export function CompanyGlance({ part = "business" }: { part?: "business" | "people" }) {
  const query = useQuery({ queryKey: ["ceo", "company"], queryFn: () => api<Data>("/api/ceo/company"), staleTime: 60_000 });
  const data = query.data;
  if (!data) return null;
  const people = data.departments.reduce((sum, one) => sum + one.people, 0);
  const daysInMonth = new Date(Number(data.today.slice(0, 4)), Number(data.today.slice(5, 7)), 0).getDate();
  const byDay = new Map(data.days.map((one) => [one.day, one.amount]));
  const dayTop = Math.max(1, ...data.days.map((one) => one.amount));
  const monthSold = data.days.reduce((sum, one) => sum + one.amount, 0);
  const stockValue = data.stock.reduce((sum, one) => sum + one.value, 0);
  if (part === "people")
    return (
      <section aria-labelledby="company-people" className="space-y-3">
        <h2 id="company-people" className="text-base font-semibold tracking-tight text-slate-900">
          The company's people
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            ["People", people.toLocaleString("en-PH"), `${data.departments.length} departments`, "#1f9d55", "/company"],
            ["Working today", `${data.working.in} of ${data.working.all}`, "signed in for the day", "#1d9fda", "/hr/attendance"],
          ].map(([label, value, sub, colour, to]) => (
            <Link key={label} to={to as string} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300">
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: colour }} />
              <div className="text-[11.5px] font-medium text-slate-500">{label}</div>
              <div className="mt-1 text-xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</div>
              <div className="text-[11px] text-slate-400">{sub}</div>
            </Link>
          ))}
        </div>
        <Attendance data={data.attendance} />
        <div className={CARD}>
          <Head title="People by department" to="/company" sub="Chart" />
          <Bars rows={data.departments.map((one) => ({ label: one.name, value: one.people }))} />
        </div>
      </section>
    );
  return (
    <section aria-labelledby="company-glance" className="space-y-3">
      <h2 id="company-glance" className="text-base font-semibold tracking-tight text-slate-900">
        The company at a glance
      </h2>

      {/* Big numbers, each its colour. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Sold this month", shortPeso(monthSold), `${data.days.length} days with sales`, "#f59e0b", "/sales-performance"],
          ["Enquiries this month", data.enquiries.month.toLocaleString("en-PH"), `${data.enquiries.waiting} waiting for a reply`, "#e11d48", "/leads"],
          ["Stock value", shortPeso(stockValue), `${data.stock.length} warehouses`, "#7c3aed", "/inventory/overview"],
          ["Customers", data.kinds.reduce((sum, one) => sum + one.count, 0).toLocaleString("en-PH"), `${data.kinds.length} kinds`, "#0d9488", "/customers"],
        ].map(([label, value, sub, colour, to]) => (
          <Link key={label} to={to as string} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300">
            <span className="absolute inset-x-0 top-0 h-1" style={{ background: colour }} />
            <div className="text-[11.5px] font-medium text-slate-500">{label}</div>
            <div className="mt-1 text-xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</div>
            <div className="text-[11px] text-slate-400">{sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* The month's sales, day by day. */}
        <div className={`${CARD} lg:col-span-2`}>
          <Head title="Sales this month, day by day" to="/sales-performance" sub="Sales performance" />
          <div className="flex h-36 items-end gap-1" aria-label="Sales by day">
            {Array.from({ length: daysInMonth }, (_, at) => {
              const day = `${data.today.slice(0, 8)}${String(at + 1).padStart(2, "0")}`;
              const amount = byDay.get(day) ?? 0;
              const future = day > data.today;
              return (
                <div key={day} className="flex h-full flex-1 flex-col justify-end" title={`${day}: ${shortPeso(amount)}`}>
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${amount ? Math.max(4, (amount / dayTop) * 100) : 2}%`,
                      background: future ? "#e2e8f0" : amount ? (day === data.today ? "#f59e0b" : "#1f9d55") : "#cbd5e1",
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>1</span>
            <span>{Math.ceil(daysInMonth / 2)}</span>
            <span>{daysInMonth}</span>
          </div>
        </div>
        <div className={CARD}>
          <Head title="Top medicines this month" to="/medicines" />
          <Bars rows={data.medicines.map((one) => ({ label: one.name, value: one.amount }))} money />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Each channel against its target. */}
        <div className={`${CARD} lg:col-span-2`}>
          <Head title="Channels: sold against the month's target" to="/key-reports/target-sheet" sub="Target sheet" />
          <ul className="flex flex-col gap-2.5">
            {data.channels.map((one, at) => {
              const pct = one.target > 0 ? (one.sold / one.target) * 100 : null;
              return (
                <li key={one.code || one.name} className="text-[12.5px]">
                  <div className="mb-0.5 flex justify-between gap-2">
                    <span className="truncate">
                      <b className="text-slate-900">{one.code || one.name}</b> {one.code && <span className="text-slate-500">{one.name}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <b className="text-slate-900">{shortPeso(one.sold)}</b>
                      <span className="text-slate-400"> of {one.target ? shortPeso(one.target) : "no target"}</span>
                      {pct !== null && <span className="ml-1.5 font-semibold" style={{ color: PALETTE[at % PALETTE.length] }}>{pct.toFixed(1)}%</span>}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct ?? 0, one.sold ? 2 : 0))}%`, background: PALETTE[at % PALETTE.length] }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className={CARD}>
          <Head title="Orders this month, by step" to="/orders" sub="All orders" />
          <Stack rows={data.orders.map((one) => ({ label: STEP[one.status] ?? one.status, value: one.count }))} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className={CARD}>
          <Head title="Top sellers this month" to="/sales-performance" />
          <Bars rows={data.sellers.map((one) => ({ label: one.name, value: one.amount }))} money />
        </div>
        <div className={CARD}>
          <Head title="Top customers this month" to="/key-reports/customers" />
          <Bars rows={data.customers.map((one) => ({ label: one.name, value: one.amount }))} money />
        </div>
        <div className={CARD}>
          <Head title="Online enquiries this month" to="/leads" sub={`${data.enquiries.all.toLocaleString("en-PH")} in all`} />
          <Stack rows={data.enquiries.bySource.map((one) => ({ label: SOURCE[one.source] ?? one.source, value: one.count }))} />
          <p className="mt-3 text-[12px] text-slate-500">
            {data.enquiries.waiting} waiting for a reply · {data.enquiries.ordered} became orders
          </p>
        </div>
        <div className={CARD}>
          <Head title="Stock by warehouse" to="/inventory" sub="Stock" />
          <Bars rows={data.stock.map((one) => ({ label: one.name, value: one.value, extra: `${one.pieces.toLocaleString("en-PH")} pcs` }))} money />
        </div>
        <div className={CARD}>
          <Head title="Customers by kind" to="/customers" />
          <Stack rows={data.kinds.map((one) => ({ label: KIND[one.kind] ?? one.kind, value: one.count }))} />
        </div>
      </div>
    </section>
  );
}

const IN = { onTime: "#1f9d55", late: "#f59e0b", notIn: "#e11d48", onLeave: "#0ea5e9" } as const;
const IN_LABEL = { onTime: "On time", late: "Late", notIn: "Not in", onLeave: "On leave" } as const;
const KEYS = ["onTime", "late", "notIn", "onLeave"] as const;
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", { weekday: "short", timeZone: "UTC" });

/** Who came in today and when (Aryan, 19 Nov: "who came late, who came early, colourful"): the
 *  company's four counts, each department as one coloured bar, the first in and the late ones,
 *  the desks' people started now, and this week day by day. */
function Attendance({ data }: { data: Data["attendance"] }) {
  const all = data.onTime + data.late + data.notIn + data.onLeave;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className={`${CARD} lg:col-span-2`}>
        <Head title="Who's in today" to="/hr/attendance" sub="Who's working" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KEYS.map((key) => (
            <div key={key} className="rounded-xl px-3 py-2.5 text-white" style={{ background: IN[key] }}>
              <div className="text-[11px] font-semibold opacity-90">{IN_LABEL[key]}</div>
              <div className="text-2xl font-bold tabular-nums">{data[key]}</div>
              <div className="text-[10.5px] opacity-80">{all ? Math.round((data[key] / all) * 100) : 0}% of {all}</div>
            </div>
          ))}
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {data.departments.map((one) => {
            const total = KEYS.reduce((sum, key) => sum + one[key], 0) || 1;
            return (
              <li key={one.name} className="text-[12px]">
                <div className="mb-0.5 flex justify-between gap-2">
                  <span className="truncate text-slate-700">{one.name}</span>
                  <span className="shrink-0 text-slate-500 tabular-nums">
                    <b className="text-emerald-700">{one.onTime}</b> on time · <b className="text-amber-600">{one.late}</b> late ·{" "}
                    <b className="text-rose-600">{one.notIn}</b> not in{one.onLeave ? ` · ${one.onLeave} on leave` : ""}
                  </span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                  {KEYS.map((key) =>
                    one[key] ? <div key={key} title={`${IN_LABEL[key]}: ${one[key]}`} style={{ width: `${(one[key] / total) * 100}%`, background: IN[key] }} /> : null,
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className={CARD}>
          <Head title="First in today" />
          {data.first.length ? (
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {data.first.map((one) => (
                <li key={one.name} className="flex justify-between gap-2">
                  <span className="truncate text-slate-700">
                    {one.name}
                    {one.title ? <span className="text-slate-400"> · {one.title}</span> : null}
                  </span>
                  <span className="shrink-0 font-semibold text-emerald-700 tabular-nums">{one.at}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-slate-400">Nobody in yet.</p>
          )}
          <div className="mt-3 border-t border-slate-100 pt-2.5">
            <div className="mb-1 text-[12px] font-semibold text-slate-900">Came in late</div>
            {data.lateList.length ? (
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {data.lateList.map((one) => (
                  <li key={one.name} className="flex justify-between gap-2">
                    <span className="truncate text-slate-700">
                      {one.name}
                      {one.title ? <span className="text-slate-400"> · {one.title}</span> : null}
                    </span>
                    <span className="shrink-0 font-semibold text-amber-600 tabular-nums">
                      {one.at} · {one.minutes} min
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-slate-400">Nobody late.</p>
            )}
          </div>
        </div>
        <div className={CARD}>
          <Head title="At the desks now" />
          <ul className="flex flex-col gap-2 text-[12.5px]">
            {data.desks.map((desk) => (
              <li key={desk.desk}>
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-800">{desk.desk}</span>
                  <span className="text-slate-500 tabular-nums">
                    {desk.people.length} of {desk.seats} started
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {desk.people.length ? (
                    desk.people.map((one) => (
                      <span
                        key={one.name}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${one.late ? "bg-amber-500" : "bg-emerald-600"}`}
                      >
                        {one.name.split(" ")[0]} · {one.since}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11.5px] text-rose-600">Nobody started</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className={CARD}>
          <Head title="This week" sub="in on time · late · not in" />
          <div className="flex h-24 items-end gap-2">
            {data.week.map((one) => {
              const total = one.onTime + one.late + one.notIn || 1;
              return (
                <div key={one.day} className="flex h-full flex-1 flex-col items-center gap-1" title={`${one.day}: ${one.onTime} on time, ${one.late} late, ${one.notIn} not in`}>
                  <div className="flex w-full flex-1 flex-col-reverse overflow-hidden rounded-md bg-slate-100">
                    <div style={{ height: `${(one.onTime / total) * 100}%`, background: IN.onTime }} />
                    <div style={{ height: `${(one.late / total) * 100}%`, background: IN.late }} />
                    <div style={{ height: `${(one.notIn / total) * 100}%`, background: IN.notIn }} />
                  </div>
                  <span className="text-[10.5px] text-slate-500">{weekday(one.day)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
