// How the team's orders came this month (Aryan, 27 Nov: "doctors are of two kinds, Doctor dispense
// and Doctor referral; this is the main thing: build everything on it", PLAN 252). Each order's
// Source, as the order form asks it: the doctor's two ways first, each saying what it means, then
// the rest; one bar shows the month's share of each.

import type { OrderWays } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { exactPeso, shortPeso } from "../ceo";
import { CARD } from "../ui";

/** The order form's sources in plain words: what each way is. */
const WAYS: Record<string, { name: string; means: string }> = {
  "Patient order referred by doctor": { name: "Doctor referral", means: "A doctor told the patient to buy from us" },
  "Doctor order": { name: "Doctor dispense", means: "The doctor bought from us, to pay then or later" },
  "Patient order referred by patient": { name: "Patient referral", means: "A patient sent another patient" },
  DSWD: { name: "DSWD letter", means: "A guarantee letter: the agency pays" },
  PCSO: { name: "PCSO letter", means: "A guarantee letter: the agency pays" },
  "Office of the President": { name: "Office of the President letter", means: "A guarantee letter: the agency pays" },
  IAPF: { name: "IAPF letter", means: "A guarantee letter: the agency pays" },
  "Hospital PO": { name: "Hospital PO", means: "A hospital's purchase order" },
  "Distributor order": { name: "Distributor order", means: "A distributor or drugstore bought" },
  "Bidding Order": { name: "Government bidding", means: "Won in a bid" },
  "B2C Order": { name: "Online", means: "A patient online" },
  "Emergency purchase": { name: "Emergency purchase", means: "Bought in a hurry" },
  "Digital Marketing": { name: "Digital marketing", means: "Came from the company's ads" },
  "Not said": { name: "Not said", means: "The order doesn't say how it came" },
};
const REFERRAL = "Patient order referred by doctor";
const DISPENSE = "Doctor order";
const wayOf = (source: string) => WAYS[source] ?? { name: source, means: "" };
// The bar's colours: the referral the app's blue, the dispensing teal, the rest greys.
const COLOUR: Record<string, string> = { [REFERRAL]: "bg-emerald-600", [DISPENSE]: "bg-teal-600" };
const GREYS = ["bg-slate-400", "bg-slate-300", "bg-slate-200"];

const day = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" });
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

export function OrderWaysCard({ month }: { month: string }) {
  const query = useQuery({
    queryKey: ["team", "ways", month],
    queryFn: () => api<OrderWays>(`/api/team/ways${month ? `?month=${month}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data || data.ways.length === 0) return null;
  const share = (value: number) => (data.value ? Math.round((value / data.value) * 100) : 0);
  const doctor = [REFERRAL, DISPENSE]
    .map((source) => data.ways.find((one) => one.source === source))
    .filter((one): one is OrderWays["ways"][number] => Boolean(one));
  const rest = data.ways.filter((one) => one.source !== REFERRAL && one.source !== DISPENSE);
  let grey = 0;
  const colourOf = (source: string) => COLOUR[source] ?? GREYS[Math.min(grey++, GREYS.length - 1)] ?? "bg-slate-200";
  const colours = new Map(data.ways.map((one) => [one.source, colourOf(one.source)]));
  const monthName = new Date(`${data.from}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });

  return (
    <section aria-labelledby="order-ways" className={`${CARD} min-w-0 px-4 py-4 sm:px-5`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="order-ways" className="text-base font-semibold text-slate-900">
            How {monthName}'s orders came
          </h2>
          <p className="text-[12px] text-slate-500">
            {count(data.orders, "order")} · {shortPeso(data.value)}
            {data.lastOrderOn ? ` · orders counted up to ${day(data.lastOrderOn)}` : ""}
          </p>
        </div>
      </header>

      {/* One bar: each way's share of the month. */}
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Each way's share of the month's orders">
        {data.ways.map((one) => (
          <span
            key={one.source}
            className={colours.get(one.source)}
            style={{ width: `${(one.value / (data.value || 1)) * 100}%` }}
            title={`${wayOf(one.source).name}: ${shortPeso(one.value)} (${share(one.value)}%)`}
          />
        ))}
      </div>

      {doctor.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {doctor.map((one) => (
            <div key={one.source} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${colours.get(one.source)}`} aria-hidden="true" />
                <span className="text-[14px] font-semibold text-slate-900">{wayOf(one.source).name}</span>
                <span className="ml-auto text-[12px] font-semibold text-slate-500 tabular-nums">{share(one.value)}%</span>
              </div>
              <p className="text-[12px] text-slate-500">{wayOf(one.source).means}</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums" title={exactPeso(one.value)}>
                {shortPeso(one.value)}
              </p>
              <p className="text-[12px] text-slate-600">
                {one.source === REFERRAL
                  ? `${count(one.orders, "order")} · ${count(one.buyers, "patient")} · sent by ${count(one.doctors, "doctor")}`
                  : `${count(one.orders, "order")} · ${count(one.buyers, "doctor")} bought`}
              </p>
            </div>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-[13px]">
          {rest.map((one) => (
            <li key={one.source} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
              <span className={`size-2.5 shrink-0 rounded-full ${colours.get(one.source)}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-900">{wayOf(one.source).name}</span>
                {wayOf(one.source).means && <span className="text-[12px] text-slate-500"> · {wayOf(one.source).means}</span>}
              </span>
              <span className="text-[12px] text-slate-500 tabular-nums">{count(one.orders, "order")}</span>
              <span className="w-16 text-right font-semibold text-slate-900 tabular-nums" title={exactPeso(one.value)}>
                {shortPeso(one.value)}
              </span>
              <span className="w-10 text-right text-[12px] text-slate-500 tabular-nums">{share(one.value)}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
