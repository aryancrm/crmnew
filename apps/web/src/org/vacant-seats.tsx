// Vacant seats (docs/HR-PLAN.md, "Moves and vacant seats"): every seat nobody sits in, how long it
// has been empty, who covers it and what waits in it. A team lead sees their own boxes and gives a
// vacant area to one of their people until a day: added work, no KPI for them (the sale counts for
// the vacant seat, the team's), each sale keeping the email ID it was sold as. HR, the CEO and the
// Admin see every seat. Empty 7 days with nobody covering: flagged to the lead; 14: to the head and HR.

import type { VacantSeats } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRoundPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { shortPeso } from "../ceo";
import { manilaToday } from "../team/range";
import { Button, CARD, Dialog, PageHead, PageState, Problem, useAction } from "../ui";
import { FIELD } from "./dialogs";

type Seat = VacantSeats["seats"][number];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function Flag({ seat, data }: { seat: Seat; data: VacantSeats }) {
  if (seat.cover)
    return (
      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
        {seat.cover.name} covers{seat.cover.until ? ` until ${seat.cover.until}` : ""}
      </span>
    );
  if (seat.promised)
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
        {seat.promised.name} starts {seat.promised.startsOn}
      </span>
    );
  if (seat.alert === "up")
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 ring-1 ring-red-200">
        Nobody covering past {data.upDays} days: head and HR told
      </span>
    );
  if (seat.alert === "lead")
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
        Nobody covering past {data.leadDays} days
      </span>
    );
  return <span className="text-xs text-slate-500">Waits with {seat.lead ?? "the lead above"}</span>;
}

export function VacantSeatsPage() {
  const queries = useQueryClient();
  const query = useQuery({ queryKey: ["org", "vacant"], queryFn: () => api<VacantSeats>("/api/org/vacant") });
  const [giving, setGiving] = useState<Seat | null>(null);
  const back = useAction();
  const data = query.data;
  if (!data) return <PageState query={query} what="the vacant seats" />;
  const late = data.seats.filter((seat) => seat.alert !== "none").length;

  async function takeBack(seat: Seat) {
    if (!seat.cover) return;
    if (await back.run(() => api(`/api/org/vacant/covers/${seat.cover?.holdingId}/end`, { body: {} })))
      await queries.invalidateQueries({ queryKey: ["org", "vacant"] });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Vacant seats"
        sub={`${plural(data.seats.length, "seat")} nobody sits in${
          late ? `, ${late} with nobody covering too long` : ""
        }. A vacant area's quota stays on its seat: give it to one of your people as added work, with no KPI for them.`}
      />
      <Problem message={back.problem?.message} />
      {data.seats.length === 0 ? (
        <p className={`${CARD} px-4 py-6 text-center text-sm text-slate-500`}>Every seat has someone in it.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.seats.map((seat) => (
            <li key={seat.seatId} className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to={`/my-team/seat/${seat.seatId}`}
                    className="font-semibold text-slate-900 hover:underline"
                  >
                    {seat.title}
                    {seat.area ? ` · ${seat.area}` : ""}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {seat.team}
                    {seat.login ? ` · ${seat.login}` : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">
                  {seat.days === 0 ? "Since today" : plural(seat.days, "day")}
                </span>
              </div>
              <Flag seat={seat} data={data} />
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">Customers</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">{seat.customers}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Open orders</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">{seat.open}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">This month</dt>
                  <dd className="font-medium text-slate-900 tabular-nums">
                    {shortPeso(seat.sold)}
                    {seat.quota ? <span className="text-slate-500"> / {shortPeso(seat.quota)}</span> : null}
                  </dd>
                </div>
              </dl>
              {seat.soldCovering > 0 && (
                <p className="text-xs text-slate-500">
                  {shortPeso(seat.soldCovering)} of it sold covering: the seat's, kept with the email ID each was sold as.
                </p>
              )}
              {data.can.cover && (
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {seat.cover ? (
                    <Button small disabled={back.busy} onClick={() => takeBack(seat)}>
                      Take the cover back
                    </Button>
                  ) : (
                    <Button small variant="primary" onClick={() => setGiving(seat)}>
                      <UserRoundPlus size={14} /> Give to one of my people
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {giving && <GiveDialog seat={giving} data={data} onClose={() => setGiving(null)} />}
    </div>
  );
}

function GiveDialog({ seat, data, onClose }: { seat: Seat; data: VacantSeats; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [personId, setPersonId] = useState("");
  const [until, setUntil] = useState(addDays(manilaToday(), 30));
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(() =>
      api(`/api/org/vacant/${seat.seatId}/cover`, { body: { personId: Number(personId) || 0, until, reason: reason || null } }),
    );
    if (done) {
      await queries.invalidateQueries({ queryKey: ["org", "vacant"] });
      onClose();
    }
  }
  return (
    <Dialog
      title={`Give ${seat.title}${seat.area ? ` · ${seat.area}` : ""}`}
      sub="Added work until the day picked: they see its customers and sell to them. The sales count for this seat and the team, not for their own KPI."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">To *</span>
          <select value={personId} onChange={(event) => setPersonId(event.target.value)} className={FIELD}>
            <option value="">Pick one of your people</option>
            {data.people.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name} · {one.seat}
              </option>
            ))}
          </select>
          {action.at("personId") && <span className="text-xs text-red-700">{action.at("personId")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Until *</span>
          <input
            type="date"
            value={until}
            min={manilaToday()}
            onChange={(event) => setUntil(event.target.value)}
            className={FIELD}
          />
          {action.at("until") && <span className="text-xs text-red-700">{action.at("until")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Note</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD}
            placeholder="Until the new MedRep joins"
            maxLength={200}
          />
        </label>
        <Problem message={action.general(["personId", "until"])} />
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy || !personId}>
            {action.busy ? "Saving…" : "Give it"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
