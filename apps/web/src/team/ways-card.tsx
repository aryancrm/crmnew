// How the team's orders came this month (Aryan, 27 Nov: "doctors are of two kinds, Doctor dispense
// and Doctor referral; build everything on it", PLAN 252; 28 Nov: "a guarantee letter is only a
// process of an order, for a patient who can't buy straight: don't treat it apart; where is it
// whether the patient paid COD, prepaid, on how many days' terms? In referral the patients buy, some
// through a GL, some as seniors"; "the orders each person places must show on Javed's screen",
// PLAN 260). Two ways first: Doctor referral (the patient buys; how they bought: regular, Senior /
// PWD, guarantee letter; how they paid) and Doctor dispense (the doctor buys; how they paid); the
// rest in one line. Then each person's orders this month and where the open ones stand.

import type { OrderWays, OrderWaysPart, OrderWaysPay, TeamBoard } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { exactPeso, shortPeso } from "../ceo";
import { CARD } from "../ui";

/** The other sources in plain words. */
const OTHER_WORDS: Record<string, string> = {
  "Patient order referred by patient": "patient sent by a patient",
  "Hospital PO": "hospital PO",
  "Distributor order": "distributor",
  "Bidding Order": "government bidding",
  "B2C Order": "online",
  "Emergency purchase": "emergency purchase",
  "Digital Marketing": "digital marketing",
  "Not said": "not said",
};

const day = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" });
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

function useWays(month: string) {
  return useQuery({
    queryKey: ["team", "ways", month],
    queryFn: () => api<OrderWays>(`/api/team/ways${month ? `?month=${month}` : ""}`),
    placeholderData: (previous) => previous,
  });
}

export function OrderWaysCard({ month }: { month: string }) {
  const data = useWays(month).data;
  if (!data || data.orders === 0) return null;
  const share = (value: number) => (data.value ? Math.round((value / data.value) * 100) : 0);
  const monthName = new Date(`${data.from}T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", timeZone: "UTC" });
  const bar = [
    { key: "referral", colour: "bg-emerald-600", value: data.referral.value, name: "Doctor referral" },
    { key: "dispense", colour: "bg-teal-600", value: data.dispense.value, name: "Doctor dispense" },
    { key: "others", colour: "bg-slate-300", value: data.others.value, name: "Others" },
  ];

  return (
    <section aria-labelledby="order-ways" className={`${CARD} min-w-0 px-4 py-4 sm:px-5`}>
      <header>
        <h2 id="order-ways" className="text-base font-semibold text-slate-900">
          How {monthName}'s orders came
        </h2>
        <p className="text-[12px] text-slate-500">
          {count(data.orders, "order")} · {shortPeso(data.value)}
          {data.lastOrderOn ? ` · orders counted up to ${day(data.lastOrderOn)}` : ""}
        </p>
      </header>

      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Each way's share of the month's orders">
        {bar.map((one) => (
          <span
            key={one.key}
            className={one.colour}
            style={{ width: `${(one.value / (data.value || 1)) * 100}%` }}
            title={`${one.name}: ${shortPeso(one.value)} (${share(one.value)}%)`}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Way
          colour="bg-emerald-600"
          name="Doctor referral"
          means="The patient buys: a doctor sent them to us"
          part={data.referral}
          share={share(data.referral.value)}
          detail={`${count(data.referral.orders, "order")} · ${count(data.referral.patients, "patient")} · sent by ${count(data.referral.doctors, "doctor")}`}
        >
          <Split
            title="How they bought"
            rows={[
              ["Regular", data.referral.roads.regular],
              ["Senior / PWD", data.referral.roads.senior],
              ["Guarantee letter", data.referral.roads.gl],
            ]}
            whole={data.referral.value}
          />
          <Paid pay={data.referral.pay} whole={data.referral.value} />
        </Way>
        <Way
          colour="bg-teal-600"
          name="Doctor dispense"
          means="The doctor buys from us, and pays then or later"
          part={data.dispense}
          share={share(data.dispense.value)}
          detail={`${count(data.dispense.orders, "order")} · ${count(data.dispense.doctors, "doctor")} bought`}
        >
          <Paid pay={data.dispense.pay} whole={data.dispense.value} />
        </Way>
      </div>

      {data.others.orders > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[12.5px] text-slate-600">
          <span className="size-2.5 rounded-full bg-slate-300" aria-hidden="true" />
          <b className="text-slate-900">Others {shortPeso(data.others.value)}</b>
          <span className="text-slate-500">({share(data.others.value)}%):</span>
          {data.others.list.map((one) => `${OTHER_WORDS[one.source] ?? one.source} ${one.orders}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

function Way({
  colour,
  name,
  means,
  part,
  share,
  detail,
  children,
}: {
  colour: string;
  name: string;
  means: string;
  part: OrderWaysPart;
  share: number;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`size-2.5 shrink-0 rounded-full ${colour}`} aria-hidden="true" />
        <span className="text-[15px] font-semibold text-slate-900">{name}</span>
        <span className="ml-auto text-[12px] font-semibold text-slate-500 tabular-nums">{share}%</span>
      </div>
      <p className="text-[12px] text-slate-500">{means}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums" title={exactPeso(part.value)}>
        {shortPeso(part.value)}
      </p>
      <p className="text-[12px] text-slate-600">{detail}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

/** A way's split: each row its value with a thin bar and its orders. */
function Split({ title, rows, whole }: { title: string; rows: [string, OrderWaysPart][]; whole: number }) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{title}</p>
      <ul className="mt-1 space-y-1">
        {rows.map(([label, figures]) => (
          <li key={label} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-2 text-[12.5px]">
            <span className="truncate text-slate-700">{label}</span>
            <span className="h-1.5 rounded-full bg-slate-100" aria-hidden="true">
              <span className="block h-full rounded-full bg-slate-400" style={{ width: `${whole ? (figures.value / whole) * 100 : 0}%` }} />
            </span>
            <span className="text-right tabular-nums text-slate-900" title={exactPeso(figures.value)}>
              {shortPeso(figures.value)} <span className="text-[11px] text-slate-500">· {count(figures.orders, "order")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How a way paid: prepaid, COD, on credit by the number of days. */
function Paid({ pay, whole }: { pay: OrderWaysPay; whole: number }) {
  const rows: [string, OrderWaysPart][] = [
    ["Prepaid", pay.prepaid],
    ["COD", pay.cod],
    ["On terms", pay.terms],
  ];
  if (pay.unknown.orders) rows.push(["Terms not known", pay.unknown]);
  return (
    <div>
      <Split title="How they paid" rows={rows} whole={whole} />
      {pay.terms.byDays.length > 0 && (
        <p className="mt-1 text-[11.5px] text-slate-500">
          On terms: {pay.terms.byDays.map((one) => `${one.days} days ${count(one.orders, "order")}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** Each person's orders this month, by way, and where their open orders stand now (Aryan, 28 Nov:
 *  "how many orders which person placed must show on Javed's screen, like the Orders tab"). */
export function OrdersByPerson({ month, board }: { month: string; board: TeamBoard | undefined }) {
  const data = useWays(month).data;
  if (!data || data.people.length === 0) return null;
  const stagesOf = (seatId: number) => board?.seats.find((one) => one.seatId === seatId)?.stages ?? null;
  const STAGES: [keyof NonNullable<ReturnType<typeof stagesOf>>, string][] = [
    ["management", "Management"],
    ["finance", "Finance"],
    ["dispatch", "Dispatch"],
    ["road", "On the road"],
    ["held", "On hold"],
    ["sentBack", "Sent back"],
  ];
  const TH = "px-3 py-2 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase";
  return (
    <section aria-labelledby="orders-by-person" className={`${CARD} min-w-0 overflow-x-auto`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-2 sm:px-5">
        <div>
          <h2 id="orders-by-person" className="text-base font-semibold text-slate-900">
            Orders by person
          </h2>
          <p className="text-[12px] text-slate-500">Each HQ's orders this month, by way, and where their open orders stand now</p>
        </div>
        <Link to="/orders" className="text-[12.5px] font-semibold text-emerald-700 hover:underline">
          All orders
        </Link>
      </header>
      <table className="w-full min-w-[760px] text-[13px]">
        <thead>
          <tr className="border-y border-slate-100 text-left">
            <th className={`${TH} pl-4 sm:pl-5`}>HQ</th>
            <th className={`${TH} text-right`}>Orders</th>
            <th className={`${TH} text-right`}>Value</th>
            <th className={`${TH} text-right`}>Referral</th>
            <th className={`${TH} text-right`}>Dispense</th>
            <th className={`${TH} text-right`}>Others</th>
            <th className={`${TH} pr-4 sm:pr-5`}>Open now</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.people.map((one) => {
            const stages = stagesOf(one.seatId);
            const open = stages ? STAGES.filter(([key]) => stages[key] > 0) : [];
            return (
              <tr key={one.seatId}>
                <td className="px-4 py-2.5 sm:px-5">
                  <span className="block font-semibold text-slate-900">{one.hq}</span>
                  <span className="block text-[11.5px] text-slate-500">{one.person ?? "Empty"}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{one.orders || "—"}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums" title={exactPeso(one.value)}>
                  {one.value ? shortPeso(one.value) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{one.referral.orders || "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{one.dispense.orders || "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{one.others.orders || "—"}</td>
                <td className="px-3 py-2.5 pr-4 text-[12px] sm:pr-5">
                  {open.length ? (
                    <span className="flex flex-wrap gap-1">
                      {open.map(([key, label]) => (
                        <span key={key} className={`rounded px-1.5 py-0.5 ${key === "held" || key === "sentBack" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`}>
                          {label} {stages?.[key]}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-slate-400">None open</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
