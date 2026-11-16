// An Rx CHC's doctors (Rx CHC Play Book): their doctor list in three tiers (as long as their work) with the month's
// visits done against due, each doctor's light for today's route, and the doctors of the area
// not on the list yet (put one in a tier with a click). The Home shows today's route (eight
// calls: red, then yellow, then the green behind on visits), the tiers in one line and the PAP
// applications.

import type { RxDay } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartHandshake, Phone, Route } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { CARD, count, dayLabel, PageHead, PageState, Problem, useAction } from "../ui";

type Doctor = RxDay["doctors"][number];

const LIGHT: Record<Doctor["light"], { dot: string; word: string }> = {
  red: { dot: "bg-rose-500", word: "Refill due" },
  yellow: { dot: "bg-amber-400", word: "Missing this month" },
  green: { dot: "bg-emerald-500", word: "On track" },
};

const useRxDay = () => useQuery({ queryKey: ["rx", "day"], queryFn: () => api<RxDay>("/api/rx/day") });

/** Today's eight calls: red first, then yellow, then listed doctors furthest behind on visits. */
export function routeOf(doctors: Doctor[]): Doctor[] {
  const rank = (doctor: Doctor) => (doctor.light === "red" ? 0 : doctor.light === "yellow" ? 1 : 2);
  return doctors
    .filter((doctor) => doctor.tier || doctor.light !== "green")
    .filter((doctor) => doctor.light !== "green" || doctor.visits < doctor.due)
    .sort((a, b) => rank(a) - rank(b) || (a.tier ?? 9) - (b.tier ?? 9) || b.due - b.visits - (a.due - a.visits))
    .slice(0, 8);
}

function Light({ light }: { light: Doctor["light"] }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
      <span className={`size-2 rounded-full ${LIGHT[light].dot}`} /> {LIGHT[light].word}
    </span>
  );
}

/** The top of the Rx CHC's Home. */
export function RxHome() {
  const query = useRxDay();
  const data = query.data;
  if (!data) return null;
  const route = routeOf(data.doctors);
  return (
    <>
      <section aria-label="My doctors at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.tiers.map((tier) => (
          <Link key={tier.tier} to="/rx/doctors" className={`${CARD} block px-4 py-3 hover:bg-slate-50`}>
            <div className="text-[11px] font-semibold text-slate-500">
              Tier {tier.tier} · {tier.doctors} doctor{tier.doctors === 1 ? "" : "s"}
            </div>
            <div className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 tabular-nums">
              {tier.visitsDone}/{tier.visitsDue}
            </div>
            <div className="text-[11px] text-slate-400">visits this month ({tier.tier === 1 ? 4 : tier.tier === 2 ? 2 : 1} each)</div>
          </Link>
        ))}
        <div className={`${CARD} px-4 py-3`}>
          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <HeartHandshake className="size-3.5" /> PAP applications
          </div>
          <div className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 tabular-nums">
            {data.pap.approved} <span className="text-sm font-semibold text-slate-400">approved</span>
          </div>
          <div className="text-[11px] text-slate-400">{data.pap.pending} waiting for the letter</div>
        </div>
      </section>
      <section className={`${CARD} min-w-0`}>
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Route className="size-4 text-slate-500" /> Today's route
          </h3>
          <span className="text-[11px] text-slate-500">Eight calls: refill due first, then missing this month, then Tier 1 behind on visits</span>
        </header>
        {route.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-slate-500">
            {data.doctors.some((doctor) => doctor.tier) ? "Every doctor is on track." : "Put your doctors in tiers first: "}
            {!data.doctors.some((doctor) => doctor.tier) && (
              <Link to="/rx/doctors" className="font-semibold text-emerald-700 hover:underline">
                My doctors
              </Link>
            )}
          </p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {route.map((doctor, n) => (
              <li key={doctor.customerId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">{n + 1}</span>
                <span className="min-w-0 flex-1">
                  <Link to={`/customers/${doctor.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
                    {doctor.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
                    <Light light={doctor.light} />
                    {doctor.tier && (
                      <span>
                        Tier {doctor.tier} · {doctor.visits}/{doctor.due} visits
                      </span>
                    )}
                    {doctor.refillOn && <span>refill {dayLabel(doctor.refillOn)}</span>}
                  </span>
                </span>
                {doctor.phone && doctor.phone.replace(/\D/g, "").length >= 7 && (
                  <a
                    href={`tel:${doctor.phone.replace(/\s/g, "")}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  >
                    <Phone className="size-3" /> Call
                  </a>
                )}
                <Link to="/visits" className="rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white">
                  Log the call
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export function RxDoctorsPage() {
  const queries = useQueryClient();
  const query = useRxDay();
  const action = useAction();
  const [picked, setShow] = useState<"listed" | "others" | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="your doctors" />;
  const listed = data.doctors.filter((doctor) => doctor.tier);
  const others = data.doctors.filter((doctor) => !doctor.tier);
  // An empty list opens on the doctors of the area, to pick from.
  const show = picked ?? (listed.length ? "listed" : "others");
  const shown = show === "listed" ? listed : others;
  const setTier = (customerId: number, tier: 1 | 2 | 3 | null) =>
    void action.run(async () => {
      await api("/api/rx/doctors", { method: "POST", body: { customerId, tier } });
      await queries.invalidateQueries({ queryKey: ["rx"] });
    });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHead
        title="My doctors"
        sub={`${listed.length} doctor${listed.length === 1 ? "" : "s"} on my list · Tier 1 seen four times a month, Tier 2 twice, Tier 3 once · the list stays with the seat`}
      />
      <div className="mb-3 grid grid-cols-3 gap-3">
        {data.tiers.map((tier) => (
          <div key={tier.tier} className={`${CARD} px-4 py-3`}>
            <div className="text-[11px] font-semibold text-slate-500">Tier {tier.tier}</div>
            <div className="text-lg font-bold text-slate-900 tabular-nums">{tier.doctors}</div>
            <div className="text-[11px] text-slate-500">
              {tier.visitsDone} of {tier.visitsDue} visits done
            </div>
          </div>
        ))}
      </div>
      <div className="mb-3 flex gap-1">
        {(
          [
            ["listed", `On my list (${count(listed.length)})`],
            ["others", `Doctors of my area not listed (${count(others.length)})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setShow(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${show === key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <Problem message={action.problem?.message} />
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Doctor</th>
              <th className="px-3 py-2.5">Today</th>
              <th className="px-3 py-2.5 text-right">Visits</th>
              <th className="px-3 py-2.5">Last order · refill</th>
              <th className="px-4 py-2.5">Tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  {show === "listed" ? "No doctor on the list yet: pick them from the doctors of your area." : "Every doctor of your area is on the list."}
                </td>
              </tr>
            )}
            {shown.map((doctor) => (
              <tr key={doctor.customerId} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link to={`/customers/${doctor.customerId}`} className="font-semibold text-slate-900 hover:underline">
                    {doctor.name}
                  </Link>
                  <div className="text-[11.5px] text-slate-500">{[doctor.specialty, doctor.city].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="px-3 py-2.5">
                  <Light light={doctor.light} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {doctor.tier ? `${doctor.visits}/${doctor.due}` : doctor.visits}
                  <div className="text-[11px] text-slate-400">{doctor.nextVisit ? `next ${dayLabel(doctor.nextVisit)}` : doctor.lastVisit ? `last ${dayLabel(doctor.lastVisit)}` : "never visited"}</div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                  {doctor.lastOrder ? dayLabel(doctor.lastOrder) : "No order yet"}
                  {doctor.refillOn && <div className="text-[11px] text-slate-400">refill {dayLabel(doctor.refillOn)}</div>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="inline-flex gap-1">
                    {([1, 2, 3] as const).map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        disabled={action.busy}
                        onClick={() => doctor.tier !== tier && setTier(doctor.customerId, tier)}
                        title={doctor.tier === tier ? `In Tier ${tier}` : `Put in Tier ${tier}`}
                        className={`size-7 rounded-md text-[12px] font-bold ring-1 ${doctor.tier === tier ? "bg-brand text-white ring-brand" : "text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
                      >
                        {tier}
                      </button>
                    ))}
                    {doctor.tier && (
                      <button
                        type="button"
                        disabled={action.busy}
                        onClick={() => setTier(doctor.customerId, null)}
                        title="Take off my list"
                        className="ml-1 rounded-md px-2 text-[11.5px] font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
