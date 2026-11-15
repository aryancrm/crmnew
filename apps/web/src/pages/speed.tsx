// Speed: how long each desk keeps an order and who is slow, for the days picked. One card per step
// (Management, Finance, Dispatch, the road, a MedRep fixing a sent-back order) with its average
// against its limit and how many were late; what waits right now; placed to delivered; the
// average by day; each person who did a step, slowest first, against the limit (a step card picks
// one step); and the couriers.

import type { SpeedReport, SpeedStep } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Hourglass, PackageCheck, Truck, Undo2, UserCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Lines, Ring } from "../team/charts";
import { RangePicker, short } from "../team/range";
import { PageState } from "../ui";

const CARD = "rounded-2xl border border-slate-200/90 bg-white shadow-sm";

/** Minutes in words: "<1m", "45m", "3h 20m", "2d 4h". */
export function took(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 1) return "<1m";
  if (whole < 60) return `${whole}m`;
  if (whole < 1440) return `${Math.floor(whole / 60)}h${whole % 60 ? ` ${whole % 60}m` : ""}`;
  const hours = Math.floor((whole % 1440) / 60);
  return `${Math.floor(whole / 1440)}d${hours ? ` ${hours}h` : ""}`;
}

export const STEP: Record<
  SpeedStep,
  { label: string; who: string; icon: ReactNode; color: string; tint: string }
> = {
  management: {
    label: "Management approval",
    who: "Management",
    icon: <UserCheck className="size-5" />,
    color: "#8b5cf6",
    tint: "bg-violet-50 text-violet-700",
  },
  finance: {
    label: "Finance check & invoice",
    who: "Finance",
    icon: <Wallet className="size-5" />,
    color: "#f59e0b",
    tint: "bg-amber-50 text-amber-700",
  },
  dispatch: {
    label: "Packing & shipping",
    who: "Dispatch",
    icon: <PackageCheck className="size-5" />,
    color: "#0ea5e9",
    tint: "bg-sky-50 text-sky-700",
  },
  road: {
    label: "On the road",
    who: "Courier / rider",
    icon: <Truck className="size-5" />,
    color: "#14b8a6",
    tint: "bg-teal-50 text-teal-700",
  },
  fix: {
    label: "Fixing a sent-back order",
    who: "MedRep",
    icon: <Undo2 className="size-5" />,
    color: "#e11d48",
    tint: "bg-rose-50 text-rose-700",
  },
};

/** Green under half the limit, amber under the limit, red over it. */
const toneOf = (minutes: number, limit: number) =>
  minutes > limit
    ? { text: "text-rose-600", bar: "bg-rose-500", ring: "#f43f5e" }
    : minutes > limit / 2
      ? { text: "text-amber-700", bar: "bg-amber-400", ring: "#f59e0b" }
      : { text: "text-emerald-700", bar: "bg-emerald-500", ring: "#10b981" };

function StepCard({ step }: { step: SpeedReport["steps"][number] }) {
  const look = STEP[step.step];
  const tone = toneOf(step.avgMinutes, step.lateAfterMinutes);
  const lateShare = step.orders ? step.late / step.orders : 0;
  return (
    <article className={`${CARD} flex min-w-0 flex-col gap-3 p-4`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${look.tint}`}>
          {look.icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{look.label}</div>
          <div className="text-[11px] text-slate-500">
            {look.who} · limit {took(step.lateAfterMinutes)}
          </div>
        </div>
      </div>
      {step.orders ? (
        <>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[11px] text-slate-500">Average</div>
              <div className={`text-2xl font-semibold tracking-tight tabular-nums ${tone.text}`}>
                {took(step.avgMinutes)}
              </div>
            </div>
            <Ring share={lateShare} color="#f43f5e" size={52}>
              <span className="text-[10px]">{Math.round(lateShare * 100)}%</span>
            </Ring>
          </div>
          <div
            className="relative h-2 rounded-full bg-slate-100"
            title={`Average ${took(step.avgMinutes)} against a limit of ${took(step.lateAfterMinutes)}`}
          >
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
              style={{
                width: `${Math.min(100, (step.avgMinutes / step.lateAfterMinutes) * 100)}%`,
              }}
            />
          </div>
          <dl className="grid grid-cols-3 gap-1 text-center text-[11px]">
            {[
              ["Orders", String(step.orders)],
              ["Half took", took(step.medianMinutes)],
              ["Slowest 10%", took(step.p90Minutes)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-1 py-1.5">
                <dt className="text-slate-500">{label}</dt>
                <dd className="font-semibold text-slate-900 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div
            className={`text-xs ${step.late ? "font-semibold text-rose-600" : "text-emerald-700"}`}
          >
            {step.late ? `${step.late} late (over ${took(step.lateAfterMinutes)})` : "None late"}
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400">No order passed this step in these days.</p>
      )}
    </article>
  );
}

export function SpeedPage() {
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ["speed", params.get("from") ?? "", params.get("to") ?? ""],
    queryFn: () => {
      const asked = new URLSearchParams();
      for (const key of ["from", "to"])
        if (params.get(key)) asked.set(key, params.get(key) as string);
      return api<SpeedReport>(`/api/speed?${asked}`);
    },
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="how fast orders move" />;
  // A step card picked (?step=) shows that desk's people only: who takes how long there.
  const picked = params.get("step");
  const groups = (["management", "finance", "dispatch", "fix"] as const)
    .filter((step) => !picked || step === picked)
    .map((step) => ({ step, people: data.people.filter((person) => person.step === step) }))
    .filter((group) => group.people.length);
  const pick = (step: string | null) => {
    const next = new URLSearchParams(params);
    if (step) next.set("step", step);
    else next.delete("step");
    return `/speed${next.size ? `?${next}` : ""}`;
  };

  return (
    <div
      className={`mx-auto w-full max-w-screen-2xl space-y-5 ${query.isPlaceholderData ? "opacity-60" : ""}`}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Speed</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            How long each desk keeps an order, and who is late · {data.scope} ·{" "}
            {data.from === data.to ? short(data.from) : `${short(data.from)} – ${short(data.to)}`}
          </p>
        </div>
      </header>
      <RangePicker />

      <section
        aria-label="Waiting right now"
        className={`${CARD} flex flex-wrap items-stretch divide-x divide-slate-100 overflow-hidden`}
      >
        <div className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-900">
          <Hourglass className="size-4 text-slate-400" /> Waiting right now
        </div>
        {data.waitingNow.map((one) => (
          <div key={one.step} className="flex min-w-36 flex-1 flex-col px-4 py-3">
            <span className="text-[11px] text-slate-500">{STEP[one.step].who}</span>
            <span className="text-lg font-semibold text-slate-900 tabular-nums">{one.orders}</span>
            <span
              className={`text-[11px] ${one.late ? "font-semibold text-rose-600" : "text-slate-500"}`}
            >
              {one.orders
                ? `oldest ${took(one.oldestMinutes)}${one.late ? ` · ${one.late} late` : ""}`
                : "nothing"}
            </span>
          </div>
        ))}
      </section>

      <section aria-label="Each step" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {data.steps.map((step) => (
          <Link
            key={step.step}
            to={pick(picked === step.step ? null : step.step)}
            replace
            className={`block rounded-2xl transition-shadow ${picked === step.step ? "ring-2 ring-emerald-600 ring-offset-2" : "hover:ring-1 hover:ring-slate-300"}`}
            title="See who takes how long at this step"
          >
            <StepCard step={step} />
          </Link>
        ))}
      </section>

      <section className={`${CARD} min-w-0 p-5`}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {picked && picked in STEP
                ? `${STEP[picked as keyof typeof STEP].label}: who takes how long`
                : "Who takes how long, at each step"}
            </h2>
            <p className="text-xs text-slate-500">
              Each person's average time, slowest first; the red line is the step's limit. Click a
              step above to see only its people.
            </p>
          </div>
          {picked && (
            <Link
              to={pick(null)}
              replace
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Show every step
            </Link>
          )}
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500">No order moved on in these days.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {groups.map((group) => {
              const limit =
                data.steps.find((step) => step.step === group.step)?.lateAfterMinutes ?? 60;
              const top = Math.max(limit * 1.2, ...group.people.map((person) => person.avgMinutes));
              return (
                <div key={group.step}>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: STEP[group.step].color }}
                    />{" "}
                    {STEP[group.step].label}
                  </h3>
                  <ul className="grid gap-2.5">
                    {group.people.map((person, n) => {
                      const tone = toneOf(person.avgMinutes, limit);
                      return (
                        <li
                          key={person.personId}
                          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-800">
                              {person.name}
                              {group.people.length > 1 && n === 0 && (
                                <span className="ml-1 text-[10px] font-semibold text-rose-600">
                                  slowest
                                </span>
                              )}
                              {group.people.length > 1 && n === group.people.length - 1 && (
                                <span className="ml-1 text-[10px] font-semibold text-emerald-700">
                                  fastest
                                </span>
                              )}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              {person.orders} orders · half within {took(person.medianMinutes)}
                            </span>
                          </span>
                          <span className="relative h-3 rounded-full bg-slate-100">
                            <span
                              className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
                              style={{ width: `${(person.avgMinutes / top) * 100}%` }}
                            />
                            <span
                              className="absolute -top-1 h-5 w-0.5 rounded bg-rose-500"
                              style={{ left: `${(limit / top) * 100}%` }}
                              title={`Limit ${took(limit)}`}
                            />
                          </span>
                          <span className="text-right">
                            <span className={`block font-semibold tabular-nums ${tone.text}`}>
                              {took(person.avgMinutes)}
                            </span>
                            <span
                              className={`block text-[10px] ${person.late ? "font-semibold text-rose-600" : "text-slate-400"}`}
                            >
                              {person.late ? `${person.late} late` : "none late"}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className={`${CARD} min-w-0 p-5`}>
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Average time at each desk, day by day
          </h2>
          <Lines
            days={data.daily.map((one) => one.day)}
            series={(["management", "finance", "dispatch"] as const).map((step) => ({
              label: STEP[step].who,
              color: STEP[step].color,
              values: data.daily.map((one) => one[step]),
            }))}
            format={took}
            limit={{ value: 4 * 60, label: "Management's limit (4h)" }}
          />
        </section>
        <section className={`${CARD} flex flex-col justify-center gap-3 p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <Clock3 className="size-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Placed to delivered</div>
              <div className="text-[11px] text-slate-500">
                {data.endToEnd.orders} orders delivered in these days
              </div>
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {data.endToEnd.orders ? took(data.endToEnd.avgMinutes) : "—"}
          </div>
          <div className="text-xs text-slate-500">
            {data.endToEnd.orders
              ? `on average; half were delivered within ${took(data.endToEnd.medianMinutes)}`
              : "No order was delivered in these days."}
          </div>
          <div className="mt-2 grid gap-1.5">
            {data.steps
              .filter((step) => step.step !== "fix" && step.orders)
              .map((step) => (
                <div key={step.step} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-slate-600">{STEP[step.step].who}</span>
                  <span className="relative h-2 flex-1 rounded-full bg-slate-100">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        background: STEP[step.step].color,
                        width: `${Math.min(100, (step.avgMinutes / Math.max(1, data.endToEnd.avgMinutes || step.avgMinutes)) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="w-14 text-right font-semibold text-slate-800 tabular-nums">
                    {took(step.avgMinutes)}
                  </span>
                </div>
              ))}
          </div>
        </section>
      </div>

      <section className={`${CARD} min-w-0 p-5`}>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          On the road, by courier or rider
        </h2>
        {data.couriers.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing was delivered in these days.</p>
        ) : (
          <ul className="grid gap-2.5">
            {data.couriers.map((one) => {
              const tone = toneOf(one.avgMinutes, 72 * 60);
              const top = Math.max(72 * 60, ...data.couriers.map((row) => row.avgMinutes));
              return (
                <li
                  key={one.how}
                  className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{one.how}</span>
                    <span className="block text-[11px] text-slate-400">{one.orders} delivered</span>
                  </span>
                  <span className="relative h-3 rounded-full bg-slate-100">
                    <span
                      className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
                      style={{ width: `${(one.avgMinutes / top) * 100}%` }}
                    />
                  </span>
                  <span className="text-right">
                    <span className={`block font-semibold tabular-nums ${tone.text}`}>
                      {took(one.avgMinutes)}
                    </span>
                    <span
                      className={`block text-[10px] ${one.late ? "font-semibold text-rose-600" : "text-slate-400"}`}
                    >
                      {one.late ? `${one.late} late` : "none late"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
