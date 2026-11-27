// Headquarters (Aryan, 27-28 Nov, PLAN 257 and 261): "RX Business, and inside it the main thing, the
// HQs: write them across the top (NCL, SL NORTH, SL SOUTH, CEBU NORTH, CEBU SOUTH, DAVAO, TAFT, EAST
// AVE, RODRIGUEZ, KALAW, ORTIGAS/TMC), a line under each to the person working it. Press the person:
// the doctor referral's and the doctor dispense's data, the doctor's name on top and the hospital they
// work at a little under it. Press the doctor: all their past data, how many orders came from them,
// what happened, how much they took, how much money is pending." Each channel a row of its HQs, as
// the team's sheet has them; no Zoho names on the screen ("we are ending Zoho").

import type { DoctorHistory, Headquarters, HqDoctor, HqDoctors } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { exactPeso, monthName, shiftMonth, shortPeso } from "../ceo";
import { CARD, Dialog, PageHead, PageState } from "../ui";

const day = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

type Hq = Headquarters["channels"][number]["hqs"][number];

export function HeadquartersPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("month") ?? "";
  const query = useQuery({
    queryKey: ["headquarters", asked],
    queryFn: () => api<Headquarters>(`/api/headquarters${asked ? `?month=${asked}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const [picked, setPicked] = useState<number | null>(null);
  const [doctor, setDoctor] = useState<HqDoctor | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the headquarters" />;
  const current = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 7);
  const goTo = (month: string) => setParams(month >= current ? {} : { month }, { replace: true });
  const arrow = "grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent";
  const count_ = data.channels.reduce((sum, one) => sum + one.hqs.length, 0);

  return (
    <div className={`mx-auto w-full max-w-6xl space-y-4 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      <PageHead
        title="Headquarters"
        sub="Each HQ and who works it. Press a person for their doctors, then a doctor for all their orders."
        actions={
          <nav aria-label="Month" className={`${CARD} flex items-center p-0.5`}>
            <button type="button" aria-label="Month before" onClick={() => goTo(shiftMonth(data.month, -1))} className={arrow}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-32 px-1 text-center text-sm font-semibold text-slate-900">{monthName(data.month)}</span>
            <button type="button" aria-label="Month after" disabled={data.month >= current} onClick={() => goTo(shiftMonth(data.month, 1))} className={arrow}>
              <ChevronRight className="size-4" />
            </button>
          </nav>
        }
      />

      {count_ === 0 ? (
        <section className={`${CARD} px-5 py-8 text-center text-sm text-slate-500`}>No headquarters in your team yet.</section>
      ) : (
        data.channels.map((channel) => {
          const chosen = channel.hqs.find((one) => one.seatId === picked) ?? null;
          return (
            <section key={channel.unitId} className={`${CARD} min-w-0`}>
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
                <h2 className="text-[17px] font-semibold text-slate-900">
                  {channel.name}
                  {channel.manager && <span className="text-[13px] font-normal text-slate-500"> · Manager: {channel.manager}</span>}
                </h2>
                <span className="text-[12.5px] text-slate-500">
                  {count(channel.hqs.length, "HQ")} · {shortPeso(channel.sold)} sold in {monthName(data.month).split(" ")[0]}
                </span>
              </header>

              <Row hqs={channel.hqs} picked={picked} onPick={(seatId) => setPicked(picked === seatId ? null : seatId)} />

              {chosen ? (
                <Doctors hq={chosen} month={asked} onDoctor={setDoctor} />
              ) : (
                <p className="border-t border-slate-100 px-5 py-3 text-[12.5px] text-slate-500">Press a person to see their doctors.</p>
              )}
            </section>
          );
        })
      )}

      {doctor && <History doctor={doctor} onClose={() => setDoctor(null)} />}
    </div>
  );
}

/** The channel's HQs across, a line from each down to the person working it. */
function Row({ hqs, picked, onPick }: { hqs: Hq[]; picked: number | null; onPick: (seatId: number) => void }) {
  const half = `${50 / Math.max(1, hqs.length)}%`;
  return (
    <div className="overflow-x-auto px-4 pt-5 pb-4 sm:px-5">
      <div className="relative grid gap-2" style={{ gridTemplateColumns: `repeat(${hqs.length}, minmax(84px, 1fr))` }}>
        {/* The line joining the HQs, from the first one's middle to the last one's. */}
        {hqs.length > 1 && <span className="absolute top-0 h-px bg-slate-300" style={{ left: half, right: half }} aria-hidden="true" />}
        {hqs.map((hq) => {
          const on = picked === hq.seatId;
          return (
            <div key={hq.seatId} className="flex flex-col items-center">
              <span className="h-3 w-px bg-slate-300" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onPick(hq.seatId)}
                className={`w-full rounded-xl border px-2 py-2 text-center transition-colors ${on ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                aria-pressed={on}
              >
                <span className="block text-[12.5px] leading-tight font-bold tracking-tight break-words text-slate-900">{hq.hq}</span>
                <span className="block text-[11px] text-slate-500 tabular-nums" title={exactPeso(hq.sold)}>
                  {hq.sold ? shortPeso(hq.sold) : "—"}
                </span>
              </button>
              <span className="h-4 w-px bg-slate-300" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onPick(hq.seatId)}
                className={`w-full rounded-lg px-1.5 py-1.5 text-center text-[12.5px] leading-snug transition-colors ${on ? "bg-emerald-600 font-semibold text-white" : hq.person ? "bg-slate-100 font-medium text-slate-800 hover:bg-slate-200" : "bg-rose-50 font-semibold text-rose-600"}`}
                aria-pressed={on}
              >
                {hq.person ?? "Empty"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The person's doctors: who sent patients (referral) and who bought (dispense). */
function Doctors({ hq, month, onDoctor }: { hq: Hq; month: string; onDoctor: (doctor: HqDoctor) => void }) {
  const query = useQuery({
    queryKey: ["headquarters", hq.seatId, "doctors", month],
    queryFn: () => api<HqDoctors>(`/api/headquarters/${hq.seatId}/doctors${month ? `?month=${month}` : ""}`),
  });
  const data = query.data;
  return (
    <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[15px] font-semibold text-slate-900">
          {hq.hq} · {hq.person ?? "Empty"}
        </h3>
        <p className="text-[12px] text-slate-500">
          {hq.person && hq.since ? `Since ${day(hq.since)}` : ""}
          {hq.before.length ? ` · before: ${hq.before.map((one) => one.name).join(", ")}` : ""}
          {` · ${shortPeso(hq.sold)} sold this month · ${count(hq.hospitals, "hospital")}`}
        </p>
      </div>
      {!data ? (
        <p className="mt-3 text-[13px] text-slate-500">{query.isError ? "Their doctors couldn't be read." : "Reading their doctors…"}</p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <DoctorList title="Doctor referral" line="Doctors who sent patients to us" doctors={data.referral} onDoctor={onDoctor} />
          <DoctorList title="Doctor dispense" line="Doctors who bought from us" doctors={data.dispense} onDoctor={onDoctor} />
        </div>
      )}
    </div>
  );
}

function DoctorList({ title, line, doctors, onDoctor }: { title: string; line: string; doctors: HqDoctor[]; onDoctor: (doctor: HqDoctor) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? doctors : doctors.slice(0, 10);
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="text-[14px] font-semibold text-slate-900">
          {title} <span className="font-normal text-slate-500">· {count(doctors.length, "doctor")}</span>
        </p>
        <p className="text-[11.5px] text-slate-500">{line}, the last 12 months; this month on the right</p>
      </div>
      {doctors.length === 0 ? (
        <p className="px-3 py-3 text-[12.5px] text-slate-500">None in the last 12 months.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((one) => (
            <li key={one.key}>
              <button type="button" onClick={() => onDoctor(one)} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">{one.name}</span>
                  {one.hospital && <span className="block truncate text-[11.5px] text-slate-500">{one.hospital}</span>}
                </span>
                <span className="shrink-0 text-right text-[12px] tabular-nums">
                  <span className="block font-semibold text-slate-900" title={exactPeso(one.month.value)}>
                    {one.month.orders ? `${shortPeso(one.month.value)} · ${count(one.month.orders, "order")}` : "—"}
                  </span>
                  <span className="block text-slate-500">
                    {shortPeso(one.value)} in 12 months
                    {one.pending >= 100 && <span className="font-semibold text-amber-700"> · {shortPeso(one.pending)} pending</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {doctors.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="w-full border-t border-slate-100 px-3 py-2 text-[12.5px] font-semibold text-emerald-700 hover:bg-slate-50">
          Show all {doctors.length}
        </button>
      )}
    </div>
  );
}

/** A doctor's whole history in the team: how many orders came from them, what happened to each,
 *  how much they took, and what is still pending. */
function History({ doctor, onClose }: { doctor: HqDoctor; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["headquarters", "doctor", doctor.key],
    queryFn: () => api<DoctorHistory>(`/api/headquarters/doctor?key=${encodeURIComponent(doctor.key)}`),
  });
  const data = query.data;
  const WAY: Record<DoctorHistory["orders"][number]["way"], string> = { dispense: "Dispense", referral: "Referral", other: "Other" };
  return (
    <Dialog title={doctor.name} sub={doctor.hospital ?? "Hospital not known"} onClose={onClose} wide>
      {!data ? (
        <p className="text-[13px] text-slate-500">{query.isError ? "Their orders couldn't be read." : "Reading their orders…"}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Fact label="Orders from them" value={data.total.orders.toLocaleString("en-PH")} />
            <Fact label="Taken" value={shortPeso(data.total.value)} title={exactPeso(data.total.value)} />
            <Fact label="Pending" value={shortPeso(data.total.pending)} title={exactPeso(data.total.pending)} warn={data.total.pending >= 100} />
          </div>
          <p className="text-[12.5px] text-slate-600">
            Dispense: {count(data.dispense.orders, "order")} · {shortPeso(data.dispense.value)} — Referral: {count(data.referral.orders, "order")} ·{" "}
            {shortPeso(data.referral.value)}
          </p>
          <div className="max-h-[55dvh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[600px] text-[12.5px]">
              <thead className="sticky top-0 bg-slate-50 text-left text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Order</th>
                  <th className="px-2 py-2">Bought by</th>
                  <th className="px-2 py-2">HQ</th>
                  <th className="px-2 py-2 text-right">Value</th>
                  <th className="px-2 py-2">What happened</th>
                  <th className="px-2 py-2 text-right">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.orders.map((order) => (
                  <tr key={`${order.code}-${order.day}`}>
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{day(order.day)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {order.orderId ? (
                        <Link to={`/orders/${order.orderId}`} className="font-medium text-emerald-700 hover:underline">
                          {order.code}
                        </Link>
                      ) : (
                        <span className="font-medium">{order.code}</span>
                      )}
                      <span className="block text-[11px] text-slate-500">{WAY[order.way]}</span>
                    </td>
                    <td className="max-w-[9rem] truncate px-2 py-1.5 text-slate-700">{order.buyer ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{order.hq ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{shortPeso(order.value)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{order.status}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${order.pending >= 100 ? "font-semibold text-amber-700" : "text-slate-400"}`}>
                      {order.pending >= 100 ? shortPeso(order.pending) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Fact({ label, value, title, warn }: { label: string; value: string; title?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-[18px] font-semibold tabular-nums ${warn ? "text-amber-700" : "text-slate-900"}`} title={title}>
        {value}
      </p>
    </div>
  );
}
