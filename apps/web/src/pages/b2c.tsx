// A B2C CHC's Home (B2C CHC Playbook v1.3), in the order of their morning: the 8:00 pulse (six
// questions, green or red, each with what to do), the enquiries waiting for a reply (oldest first,
// the 15-minute clock, open the case), the refills due (Call, New order), and the orders by where
// they stand with the day-3 check-ins due. The coach's B2C desk card is here too.

import type { B2cDay, B2cTeam } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock, Inbox, MessageCircle, Phone, Pill, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { shortPeso } from "../ceo";
import { Button, CARD, dayLabel, Dialog, Problem, useAction } from "../ui";
import { greeting, todayWords } from "./home";

const SOURCE: Record<string, string> = {
  messenger: "Messenger",
  facebook: "Facebook",
  instagram: "Instagram",
  website_2mg: "2MG website",
  website_capsandpills: "Caps & Pills",
  phone: "Phone",
  walk_in: "Walk-in",
  referral: "Referral",
  email: "Email",
  other: "Other",
};

const waited = (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / 1440)} days`);

export function B2cHome() {
  const me = useMe().data;
  const query = useQuery({ queryKey: ["b2c", "day"], queryFn: () => api<B2cDay>("/api/b2c/day"), refetchInterval: 60_000 });
  const [checking, setChecking] = useState<B2cDay["day3"][number] | null>(null);
  const data = query.data;
  if (!me) return null;
  return (
    <div className="mx-auto max-w-screen-xl space-y-4">
      <div>
        <div className="text-xs text-slate-500">{todayWords()}</div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {greeting()}, {me.name.split(" ")[0]}
        </h1>
        <div className="mt-0.5 text-xs text-slate-500">B2C CHC · every new enquiry answered within {data?.replyMinutes ?? 15} minutes</div>
      </div>
      {!data ? (
        <div className="p-8 text-center text-slate-500">Loading your day…</div>
      ) : (
        <>
          <section aria-label="Morning pulse" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {data.pulse.map((one) => (
              <Link
                key={one.key}
                to={one.to}
                className={`block rounded-2xl bg-white px-4 py-3 shadow-2xs ring-1 hover:bg-slate-50 ${one.green ? "ring-emerald-200" : "ring-rose-200"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-slate-600">{one.question}</span>
                  {one.green ? <CheckCircle2 className="size-4 text-emerald-600" /> : <CircleAlert className="size-4 text-rose-600" />}
                </div>
                <div className={`text-xl font-bold tabular-nums ${one.green ? "text-slate-900" : "text-rose-700"}`}>{one.value}</div>
                <div className="text-[11.5px] text-slate-500">{one.action}</div>
              </Link>
            ))}
          </section>

          <section className={`${CARD} min-w-0`}>
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <Inbox className="size-4 text-slate-500" /> Waiting for a reply
              </h3>
              <span className="text-[11px] text-slate-500">Oldest first · new prospects are marked · reply within {data.replyMinutes} minutes</span>
            </header>
            {data.waiting.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-slate-500">Every enquiry is answered.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.waiting.map((row) => (
                  <li key={row.leadId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-slate-900">{row.name}</span>
                        {row.prospect && <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-sky-800">New prospect</span>}
                        {row.unassigned && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-600">Nobody's yet</span>}
                      </span>
                      <span className="block truncate text-[11.5px] text-slate-500">
                        {SOURCE[row.source] ?? row.source} · {row.lastMessage ?? "—"}
                      </span>
                    </span>
                    <span className={`inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums ${row.minutes > data.replyMinutes ? "text-rose-700" : "text-amber-700"}`}>
                      <Clock className="size-3" /> {waited(row.minutes)}
                    </span>
                    <Link to={`/leads/${row.leadId}`} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white">
                      <MessageCircle className="size-3" /> Reply
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section className={`${CARD} min-w-0`}>
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <Pill className="size-4 text-slate-500" /> Refills due
                </h3>
                <span className="text-[11px] text-slate-500">Call or message every one before 12:00 noon</span>
              </header>
              {data.refills.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-slate-500">No refill due today or in the next two days.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.refills.map((row) => (
                    <li key={row.customerId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <Link to={`/customers/${row.customerId}`} className="block truncate text-[13px] font-semibold text-slate-900 hover:underline">
                          {row.name}
                        </Link>
                        <span className="block truncate text-[11.5px] text-slate-500">
                          {row.expectedOn <= data.today ? "Due now" : `Due ${dayLabel(row.expectedOn)}`} · every {row.usual} days ·{" "}
                          {row.lastItems ?? `last order ${shortPeso(row.lastTotal)}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        {row.phone && row.phone.replace(/\D/g, "").length >= 7 && (
                          <a
                            href={`tel:${row.phone.replace(/\s/g, "")}`}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                          >
                            <Phone className="size-3" /> Call
                          </a>
                        )}
                        <Link
                          to={`/orders/new?customer=${row.customerId}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[12px] font-semibold text-white"
                        >
                          <ShoppingCart className="size-3" /> New order
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`${CARD} min-w-0 p-4`}>
              <h3 className="text-sm font-bold text-slate-900">My orders now</h3>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-center">
                {(
                  [
                    ["Quoted, not ordered", data.orders.quoted, "/leads"],
                    ["With Management or Finance", data.orders.atFinance, "/orders?stage=finance"],
                    ["Packing or on the way", data.orders.toShip, "/orders?stage=dispatch"],
                    ["Day-3 check-ins due", data.orders.day3, ""],
                  ] as const
                ).map(([label, value, to]) => (
                  <Link key={label} to={to || "#day3"} className="rounded-lg bg-slate-50 px-2 py-1.5 hover:bg-slate-100">
                    <dd className="text-lg font-semibold text-slate-900 tabular-nums">{value}</dd>
                    <dt className="text-[11px] text-slate-500">{label}</dt>
                  </Link>
                ))}
              </dl>
              {data.day3.length > 0 && (
                <ul id="day3" className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                  {data.day3.map((row) => (
                    <li key={row.orderId} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                      <span className="min-w-0 truncate">
                        <b className="text-slate-900">{row.customer}</b> · delivered {dayLabel(row.deliveredOn)}
                      </span>
                      <button type="button" onClick={() => setChecking(row)} className="shrink-0 font-semibold text-emerald-700 hover:underline">
                        Checked in
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/my/score" className="mt-3 block text-center text-[12.5px] font-semibold text-emerald-700 hover:underline">
                My score
              </Link>
            </section>
          </div>
        </>
      )}
      {checking && <Day3Dialog order={checking} onClose={() => setChecking(null)} />}
    </div>
  );
}

function Day3Dialog({ order, onClose }: { order: B2cDay["day3"][number]; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [note, setNote] = useState("");
  return (
    <Dialog title={`Day-3 check-in: ${order.customer}`} sub="Did it arrive, is it helping, when is the next refill?" onClose={onClose} busy={action.busy}>
      <textarea
        className="field min-h-24 w-full"
        value={note}
        placeholder="Arrived, taking it well, next refill in about 25 days"
        onChange={(event) => setNote(event.target.value)}
      />
      <Problem message={action.problem?.message} />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/api/b2c/day3/${order.orderId}`, { method: "POST", body: { note } });
              await queries.invalidateQueries({ queryKey: ["b2c"] });
              onClose();
            })
          }
        >
          Save the check-in
        </Button>
      </div>
    </Dialog>
  );
}

/** The coach's card: each B2C CHC's desk now (three late replies today: red, the playbook's alarm). */
export function B2cDeskCard() {
  const query = useQuery({ queryKey: ["b2c", "team"], queryFn: () => api<B2cTeam>("/api/b2c/team"), refetchInterval: 60_000 });
  const data = query.data;
  if (!data || data.rows.length === 0) return null;
  return (
    <section className={`${CARD} min-w-0 overflow-x-auto`}>
      <header className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-900">B2C desk now</h2>
        <span className="text-xs text-slate-500">Replies within 15 minutes · three late in a day comes to you</span>
      </header>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            <th className="px-4 py-2 sm:px-5">B2C CHC</th>
            <th className="px-3 py-2 text-right">Waiting for a reply</th>
            <th className="px-3 py-2 text-right">Late today</th>
            <th className="px-4 py-2">Invoices</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.rows.map((row) => (
            <tr key={row.personId} className={row.alarm ? "bg-rose-50/50" : "hover:bg-slate-50/60"}>
              <td className="px-4 py-2.5 font-semibold text-slate-900 sm:px-5">
                <Link to={`/my/score?person=${row.personId}`} className="hover:underline">
                  {row.name}
                </Link>
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${row.waiting ? "font-semibold text-amber-700" : "text-slate-500"}`}>{row.waiting}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${row.alarm ? "font-bold text-rose-700" : "text-slate-600"}`}>{row.lateToday}</td>
              <td className="px-4 py-2.5 text-[12px]">
                {row.invoicesToday} today
                {!row.invoicedLastDay && <div className="text-rose-700">none on the last working day</div>}
                {row.noInvoiceYet && <div className="text-rose-700">no invoice by 2:30 PM</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
