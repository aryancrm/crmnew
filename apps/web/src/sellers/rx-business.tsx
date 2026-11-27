// Prescription sales (Aryan, 19 Nov; renamed 27 Nov, PLAN 250; built on the two doctor ways and the
// HQs 28 Nov, PLAN 262: "Prescription Sales counts both doctor ways"; "a guarantee letter is only a
// process of an order: don't treat it apart"; "no Zoho on a screen"). This month's sales through
// doctors: Doctor referral (the patients they sent, a guarantee letter's among them) and Doctor
// dispense (what they bought), how many doctors wrote and how many for the first time; each HQ with
// who works it; the doctors bringing the most, by way, through which HQ (a press opens all their
// orders). A CHC sees their own ("My prescriptions"); a lead their team.

import type { RxBusiness } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { exactPeso, shortPeso } from "../ceo";
import { History } from "../team/headquarters";
import { withUnit } from "../team/switch";
import { CARD, PageHead, PageState } from "../ui";
import { EmptyState } from "../no-results";

const day = (value: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" }) : "—";
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;
const LEADS = ["team_lead", "manager", "ceo", "admin"];

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
            ? "This month's sales through your doctors: the patients they sent (referral) and what they bought (dispense)."
            : "This month's sales through doctors: the patients they sent (referral, guarantee letters too) and what they bought (dispense), HQ by HQ."
        }
        actions={query.data.summary.lastOrderOn ? <span className="text-[12px] text-slate-500">Orders counted up to {day(query.data.summary.lastOrderOn)}</span> : undefined}
      />
      <Business data={query.data} />
    </div>
  );
}

/** On a Home: a CHC's own, or the head's RX channel for one box. */
export function RxBusinessCard({ unit = null }: { unit?: number | null }) {
  const query = useRx(unit);
  if (!query.data || (query.data.ways.orders === 0 && query.data.doctors.length === 0)) return null;
  return <Business data={query.data} compact />;
}

function Business({ data, compact }: { data: RxBusiness; compact?: boolean }) {
  const w = data.ways;
  const s = data.summary;
  return (
    <div className="space-y-3">
      <section aria-label="This month at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          colour="bg-emerald-600"
          label="Doctor referral"
          value={shortPeso(w.referral.value)}
          title={exactPeso(w.referral.value)}
          hint={`${count(w.referral.orders, "order")} · ${count(w.referral.patients, "patient")}${w.referral.roads.gl.value ? ` · ${shortPeso(w.referral.roads.gl.value)} by guarantee letter` : ""}`}
        />
        <Tile
          colour="bg-teal-600"
          label="Doctor dispense"
          value={shortPeso(w.dispense.value)}
          title={exactPeso(w.dispense.value)}
          hint={`${count(w.dispense.orders, "order")} · ${count(w.dispense.doctors, "doctor")} bought`}
        />
        <Tile label="Doctors prescribing" value={s.prescribers.toLocaleString("en-PH")} hint="wrote for us at least once this month" />
        <Tile label="New doctors" value={s.newPrescribers.toLocaleString("en-PH")} hint="their first order with us, this month" />
      </section>

      {w.people.length > 1 && <EachHq data={data} />}

      <Doctors data={data} compact={compact} />
    </div>
  );
}

function Tile({ label, value, hint, title, colour }: { label: string; value: string; hint: string; title?: string; colour?: string }) {
  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600">
        {colour && <span className={`size-2.5 rounded-full ${colour}`} aria-hidden="true" />}
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums" title={title}>
        {value}
      </p>
      <p className="text-[11.5px] leading-snug text-slate-500">{hint}</p>
    </div>
  );
}

/** A section's head: what it is, and one line saying what it shows. */
function Head({ title, line }: { title: string; line: string }) {
  return (
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <p className="mt-0.5 text-[12px] text-slate-500">{line}</p>
    </header>
  );
}

const TH = "px-3 py-2 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase";

/** Each HQ this month: who works it, what came by referral and by dispense, its doctors. */
function EachHq({ data }: { data: RxBusiness }) {
  const doctorsOf = new Map(data.people.map((one) => [one.seatId, one]));
  const rows = [...data.ways.people].sort(
    (a, b) => b.referral.value + b.dispense.value - (a.referral.value + a.dispense.value) || a.hq.localeCompare(b.hq),
  );
  const top = Math.max(1, ...rows.map((one) => one.referral.value + one.dispense.value));
  const money = (part: { orders: number; value: number }) =>
    part.orders ? (
      <>
        <span className="font-semibold text-slate-900" title={exactPeso(part.value)}>
          {shortPeso(part.value)}
        </span>
        <span className="block text-[11px] text-slate-500">{count(part.orders, "order")}</span>
      </>
    ) : (
      <span className="text-slate-300">—</span>
    );
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <Head title="Each HQ this month" line="Who works it, what came by referral and by dispense, its doctors. Highest first." />
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="text-left">
            <th className={`${TH} pl-4`}>HQ</th>
            <th className={`${TH} w-[22%]`} aria-label="Share" />
            <th className={`${TH} text-right`}>Doctor referral</th>
            <th className={`${TH} text-right`}>Doctor dispense</th>
            <th className={`${TH} text-right`}>Doctors</th>
            <th className={`${TH} pr-4 text-right`}>New doctors</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((one) => {
            const whole = one.referral.value + one.dispense.value;
            const doctors = doctorsOf.get(one.seatId);
            return (
              <tr key={one.seatId} className={whole ? "" : "text-slate-400"}>
                <td className="px-4 py-2.5">
                  <span className="block font-bold text-slate-900">{one.hq}</span>
                  <span className="block text-[11.5px] text-slate-500">{one.person ?? "Empty"}</span>
                </td>
                <td className="px-3 py-2.5">
                  {/* Referral then dispense, against the HQ bringing the most. */}
                  <span className="flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <span className="bg-emerald-600" style={{ width: `${(one.referral.value / top) * 100}%` }} />
                    <span className="bg-teal-600" style={{ width: `${(one.dispense.value / top) * 100}%` }} />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(one.referral)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(one.dispense)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{doctors?.prescribers || "—"}</td>
                <td className="px-3 py-2.5 pr-4 text-right tabular-nums">{doctors?.newPrescribers || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The doctors bringing the most in the last 90 days, by way, through which HQ; a press opens all
 *  their orders (a lead's view). */
function Doctors({ data, compact }: { data: RxBusiness; compact?: boolean }) {
  const me = useMe().data;
  const canOpen = Boolean(me && LEADS.includes(me.role));
  const [all, setAll] = useState(!compact);
  const [open, setOpen] = useState<RxBusiness["doctors"][number] | null>(null);
  const doctors = all ? data.doctors : data.doctors.slice(0, 8);
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <Head
        title="Top doctors"
        line={`The doctors bringing the most in the last 90 days: the patients they sent and what they bought.${canOpen ? " Press one for all their orders." : ""}`}
      />
      {data.doctors.length === 0 ? (
        <EmptyState title="No order through a doctor in 90 days.">The doctors bringing the most show here.</EmptyState>
      ) : (
        <table className="w-full min-w-[680px] text-[13px]">
          <thead>
            <tr className="text-left">
              <th className={`${TH} pl-4`}>Doctor</th>
              <th className={TH}>HQ</th>
              <th className={`${TH} text-right`}>Doctor referral</th>
              <th className={`${TH} text-right`}>Doctor dispense</th>
              <th className={`${TH} pr-4`}>Last order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {doctors.map((one) => (
              <tr
                key={one.key}
                className={canOpen ? "cursor-pointer hover:bg-slate-50" : ""}
                onClick={canOpen ? () => setOpen(one) : undefined}
              >
                <td className="px-4 py-2.5">
                  <span className="block font-semibold text-slate-900">{one.name}</span>
                  {(one.specialty || one.city) && (
                    <span className="block text-[11.5px] text-slate-500">{[one.specialty, one.city].filter(Boolean).join(" · ")}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="block font-medium text-slate-800">{one.hq ?? "—"}</span>
                  {one.seller && <span className="block text-[11.5px] text-slate-500">{one.seller}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" title={exactPeso(one.referral)}>
                  {one.referral ? <span className="font-semibold text-slate-900">{shortPeso(one.referral)}</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums" title={exactPeso(one.dispense)}>
                  {one.dispense ? <span className="font-semibold text-slate-900">{shortPeso(one.dispense)}</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 pr-4 whitespace-nowrap">{day(one.lastOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.doctors.length > doctors.length && (
        <button type="button" onClick={() => setAll(true)} className="w-full border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50">
          Show all {data.doctors.length}
        </button>
      )}
      {compact && (
        <Link to="/rx/business" className="block border-t border-slate-100 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50">
          Open prescription sales
        </Link>
      )}
      {open && <History doctor={{ key: open.key, name: open.name, hospital: null }} onClose={() => setOpen(null)} />}
    </section>
  );
}
