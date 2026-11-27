// Prescription sales (Aryan, 19 Nov: "press RX: Honey, her whole team, what the team is doing and
// where, right now; the sales they made, A to Z"; 27 Nov: "the name is wrong, nobody understands
// what it is; make it look clear, so one sees what is going on", PLAN 250). The orders that came
// with a doctor's prescription this month: how much, which doctors wrote them, through whom, and
// the guarantee letters (a government agency pays for the patient's medicine). Each part says in
// one line what it is. A CHC sees their own ("My prescriptions"); a lead their team.

import type { RxBusiness } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { exactPeso, shortPeso } from "../ceo";
import { withUnit } from "../team/switch";
import { CARD, PageHead, PageState } from "../ui";
import { EmptyState, NoInvoicesArt } from "../no-results";

const day = (value: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-PH")} ${count === 1 ? one : many}`;

function useRx(unit: number | null = null) {
  return useQuery({
    queryKey: ["rx", "business", unit ?? ""],
    queryFn: () => api<RxBusiness>(withUnit("/api/rx/business", unit ? String(unit) : null)),
  });
}

export function RxBusinessPage() {
  const me = useMe().data;
  const query = useRx();
  if (!query.data) return <PageState query={query} what="the prescription sales" />;
  const own = me?.role === "medrep";
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <PageHead
        title={own ? "My prescriptions" : "Prescription sales"}
        sub={
          own
            ? "Your orders that came with a doctor's prescription: how much, and which doctors wrote them."
            : "Orders that came with a doctor's prescription: how much, which doctors wrote them, and through whom."
        }
        actions={<Freshness on={query.data.summary.lastOrderOn} />}
      />
      <Business data={query.data} />
    </div>
  );
}

/** How fresh the figures are: the latest order counted. */
function Freshness({ on }: { on: string | null }) {
  if (!on) return null;
  return <span className="text-[12px] text-slate-500">Orders counted up to {day(on)}</span>;
}

/** On a Home: a CHC's own, or the head's RX channel for one box. */
export function RxBusinessCard({ unit = null }: { unit?: number | null }) {
  const query = useRx(unit);
  if (!query.data || (query.data.people.length === 0 && query.data.doctors.length === 0)) return null;
  return <Business data={query.data} compact />;
}

/** The area's own words, when they add something to the seat's title ("RX | Cebu" → "Cebu"). */
const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const placeOf = (person: RxBusiness["people"][number]) => {
  const place = person.area?.split("|").slice(1, 2).join("").trim() || null;
  return place && plain(place) !== plain(person.name) ? place : null;
};

function Business({ data, compact }: { data: RxBusiness; compact?: boolean }) {
  const s = data.summary;
  const many = data.people.length > 1;
  const lettersThisMonth = data.people.reduce((sum, one) => sum + one.letters, 0);
  return (
    <div className="space-y-3">
      <section aria-label="This month at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Prescription sales"
          value={shortPeso(s.value)}
          title={exactPeso(s.value)}
          hint={`${plural(s.prescriptions, "order")} with a prescription, this month`}
        />
        <Tile label="Doctors prescribing" value={s.prescribers.toLocaleString("en-PH")} hint="wrote for us at least once this month" />
        <Tile label="New doctors" value={s.newPrescribers.toLocaleString("en-PH")} hint="their first prescription for us, this month" />
        <Tile
          label="Guarantee letters"
          value={lettersThisMonth.toLocaleString("en-PH")}
          hint={s.glOpen ? `this month · ${shortPeso(s.glOpenAmount)} still to be paid by agencies` : "this month · none waiting for an agency"}
        />
      </section>

      {many && <People data={data} />}

      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Doctors data={data} compact={compact} />
        <Letters data={data} compact={compact} />
      </div>
    </div>
  );
}

function Tile({ label, value, hint, title }: { label: string; value: string; hint: string; title?: string }) {
  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className="text-[12.5px] font-medium text-slate-600">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums" title={title}>
        {value}
      </p>
      <p className="text-[11.5px] leading-snug text-slate-500">{hint}</p>
    </div>
  );
}

/** A section's head: what it is, in a few words, and one line saying what it shows. */
function Head({ title, line }: { title: string; line: string }) {
  return (
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-[12px] text-slate-500">{line}</p>
    </header>
  );
}

const TH = "px-3 py-2 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase";

function People({ data }: { data: RxBusiness }) {
  const people = [...data.people].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const top = Math.max(1, ...people.map((one) => one.value));
  // Today's visits only when someone has any (they are Field visits' own; here as a glance).
  const visits = people.some((one) => one.visitsToday > 0 || one.lastCheckIn);
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <Head title="Each person this month" line="Their prescription sales, the doctors who wrote for them and the new ones. Highest first." />
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left">
            <th className={`${TH} pl-4`}>Person</th>
            <th className={`${TH} w-[28%]`}>Prescription sales</th>
            <th className={`${TH} text-right`}>Orders</th>
            <th className={`${TH} text-right`}>Doctors</th>
            <th className={`${TH} text-right`}>New doctors</th>
            <th className={`${TH} text-right`}>Letters</th>
            {visits && <th className={TH}>Today</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {people.map((one) => {
            const none = one.prescriptions === 0;
            return (
              <tr key={one.seatId} className={none ? "text-slate-400" : ""}>
                <td className="px-4 py-2.5">
                  <span className={`font-semibold ${none ? "text-slate-500" : "text-slate-900"}`}>{one.name}</span>
                  <span className="block text-[11.5px] text-slate-500">{[one.title, placeOf(one)].filter(Boolean).join(" · ")}</span>
                </td>
                <td className="px-3 py-2.5">
                  {none ? (
                    <span className="text-[12px]">No prescription this month</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-right font-semibold text-slate-900 tabular-nums" title={exactPeso(one.value)}>
                        {shortPeso(one.value)}
                      </span>
                      <span className="h-1.5 min-w-0 flex-1 rounded-full bg-slate-100" aria-hidden="true">
                        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(3, (one.value / top) * 100)}%` }} />
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{none ? "—" : one.prescriptions}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{none ? "—" : one.prescribers}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{none ? "—" : one.newPrescribers}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{one.letters || "—"}</td>
                {visits && (
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap">
                    {one.visitsToday ? `${one.doneToday} of ${one.visitsToday} visits` : "No visit planned"}
                    {one.lastCheckIn && (
                      <span className="block text-[11px] text-slate-500">
                        last at {one.lastCheckIn} · {one.lastCheckInAt}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Doctors({ data, compact }: { data: RxBusiness; compact?: boolean }) {
  const [all, setAll] = useState(!compact);
  const doctors = all ? data.doctors : data.doctors.slice(0, 8);
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <Head title="Top doctors" line="The doctors whose prescriptions brought the most sales in the last 90 days, and through whom." />
      {data.doctors.length === 0 ? (
        <EmptyState title="No prescription in 90 days.">The doctors whose prescriptions bring the most sales show here.</EmptyState>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left">
              <th className={`${TH} pl-4`}>Doctor</th>
              <th className={TH}>Through</th>
              <th className={`${TH} text-right`}>Orders</th>
              <th className={`${TH} text-right`}>Sales</th>
              <th className={TH}>Last order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {doctors.map((one) => (
              <tr key={`${one.name}-${one.firstOn}`}>
                <td className="px-4 py-2.5">
                  {one.customerId ? (
                    <Link to={`/customers/${one.customerId}`} className="font-semibold text-slate-900 hover:text-emerald-700 hover:underline">
                      {one.name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-900">{one.name}</span>
                  )}
                  <span className="block text-[11.5px] text-slate-500">
                    {[one.specialty, one.city, `first order ${day(one.firstOn)}`].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{one.seller ?? "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{one.orders}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums" title={exactPeso(one.value)}>
                  {shortPeso(one.value)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{day(one.lastOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.doctors.length > doctors.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50"
        >
          Show all {data.doctors.length}
        </button>
      )}
    </section>
  );
}

function Letters({ data, compact }: { data: RxBusiness; compact?: boolean }) {
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <Head
        title="Guarantee letters"
        line="A government agency (DSWD, PCSO, the Office of the President…) pays for the patient's medicine: we deliver, the agency pays us later. The last 12 months."
      />
      {data.letters.length === 0 ? (
        <EmptyState art={<NoInvoicesArt size={72} />} title="No guarantee letter in 12 months.">
          Letters from DSWD, PCSO and the other agencies show here.
        </EmptyState>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left">
              <th className={`${TH} pl-4`}>Agency</th>
              <th className={`${TH} text-right`}>Letters</th>
              <th className={`${TH} text-right`}>Value</th>
              <th className={`${TH} text-right`}>Still to be paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.letters.map((one) => {
              const stages = [one.received, one.serving, one.billed, one.paid, one.zoho];
              const count = stages.reduce((sum, stage) => sum + stage.count, 0);
              const value = stages.reduce((sum, stage) => sum + stage.amount, 0);
              const waiting = one.received.amount + one.serving.amount + one.billed.amount;
              // Where this CRM's letters stand (the older ones are counted in Letters; no "Zoho" on a
              // screen, Aryan 28 Nov: "we are ending Zoho").
              const where = [
                one.received.count ? `${one.received.count} received` : null,
                one.serving.count ? `${one.serving.count} being delivered` : null,
                one.billed.count ? `${one.billed.count} billed` : null,
                one.paid.count ? `${one.paid.count} paid` : null,
              ].filter(Boolean);
              return (
                <tr key={one.programme}>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-slate-900">{one.programme}</span>
                    {where.length > 0 && <span className="block text-[11.5px] text-slate-500">{where.join(" · ")}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{count}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums" title={exactPeso(value)}>
                    {shortPeso(value)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {waiting ? <span className="font-semibold text-amber-700">{shortPeso(waiting)}</span> : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {compact && (
        <Link to="/rx/business" className="block border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50">
          Open prescription sales
        </Link>
      )}
    </section>
  );
}
