// The day report (Stop working, docs/PLAN.md 22): the day's hours (start, end, breaks, work place),
// visits (planned, closed, skipped, missed, met, productive, promotional, business), business
// (the CRM orders placed at visits, chances, follow-ups, samples), expenses; each planned visit not done needs its
// reason, then the remark and "Send the day report and stop working". The team lead marks it seen.

import type { DayReport, MissReason } from "@2mg/api/mr";
import { MISS_REASONS, MISS_WORDS, WORK_WORDS } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, CARD, PageState, Problem, peso, useAction } from "../ui";
import { clockOf, dayWords, FIELD, Label, minutesWords, MrHead, PlaceLink, StatePill, whereAmI } from "./parts";

export function MrDayReportPage() {
  const [params] = useSearchParams();
  const person = params.get("person");
  const day = params.get("day");
  const queries = useQueryClient();
  const navigate = useNavigate();
  const action = useAction();
  const query = useQuery({
    queryKey: ["mr", "day-report", person, day],
    queryFn: () => api<DayReport>(`/api/mr/day/report?${new URLSearchParams({ ...(person ? { person } : {}), ...(day ? { day } : {}) })}`),
  });
  const [reasons, setReasons] = useState<Record<number, { reason: MissReason | ""; note: string }>>({});
  const [note, setNote] = useState("");
  const [seenNote, setSeenNote] = useState("");
  const data = query.data;
  if (!data) return <PageState query={query} what="the day report" />;
  const s = data.state;
  const v = data.visits;
  const send = () =>
    action.run(async () => {
      const { place } = await whereAmI();
      await api("/api/mr/day/report", {
        body: {
          missed: data.open.map((one) => ({ visitId: one.id, reason: reasons[one.id]?.reason || null, note: reasons[one.id]?.note || null })),
          note: note || null,
          place,
        },
      });
      await queries.invalidateQueries({ queryKey: ["mr"] });
      // Stopping work ends the CRM's attendance day too.
      await queries.invalidateQueries({ queryKey: ["my-day"] });
    });
  const allGiven = data.open.every((one) => reasons[one.id]?.reason && (reasons[one.id]?.reason !== "other" || reasons[one.id]?.note.trim()));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-10">
      <MrHead title="Day report" back="/field" sub={`${data.person.name} · ${dayWords(data.day)}`} />
      {!s ? (
        <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>The day hasn't started (no Start working).</div>
      ) : (
        <Box title="Attendance">
          <Grid>
            <Item label="Start">{clockOf(s.startedAt)} <PlaceLink place={s.startPlace} /></Item>
            <Item label="End">{s.endedAt ? <>{clockOf(s.endedAt)} <PlaceLink place={s.endPlace} /></> : "Still working"}</Item>
            <Item label="Hours worked">{minutesWords(data.workedMinutes)}{s.breakMinutes ? ` (breaks ${minutesWords(s.breakMinutes)})` : ""}</Item>
            <Item label="Working location">{WORK_WORDS[s.workType]}{s.workNote ? ` (${s.workNote})` : ""}{s.cities.length ? ` · ${s.cities.join(", ")}` : ""}</Item>
            {s.workingWith.length > 0 && <Item label="Working with">{s.workingWith.map((one) => one.name).join(", ")}</Item>}
          </Grid>
        </Box>
      )}
      <Box title="Visits">
        <Grid>
          <Item label="Planned">{v.planned}</Item>
          <Item label="Closed">{v.done}</Item>
          <Item label="Skipped">{v.skipped}</Item>
          <Item label="Missed">{v.missed}{v.open ? ` (+${v.open} to give a reason)` : ""}</Item>
          <Item label="Met">{v.met} met · {v.notMet} not met</Item>
          <Item label="Productive">{v.productive} yes · {v.notProductive} no · {v.pending} not sure</Item>
          <Item label="Promotional · business · both">{v.promotional} · {v.business} · {v.both}</Item>
          <Item label="Added on the day">{v.unplanned}</Item>
        </Grid>
      </Box>
      <Box title="Business">
        <Grid>
          <Item label="Orders placed at visits">{data.business.booked} · {peso(data.business.bookedAmount)}</Item>
          <Item label="Business opportunities">{data.business.chances}{data.business.chanceAmount ? ` · ${peso(data.business.chanceAmount)}` : ""}</Item>
          <Item label="Follow-ups made · due">{data.business.followUpsMade} · {data.business.followUpsDue}</Item>
          <Item label="Samples given">{data.business.samples}</Item>
        </Grid>
      </Box>
      <Box title="Expenses">
        <Grid>
          <Item label="Allowances worked out">{peso(data.expenses.generated)}</Item>
          <Item label="Claimed">{peso(data.expenses.claimed)}</Item>
        </Grid>
        <Link to="/visits/expenses" className="mt-2 inline-block text-xs font-semibold text-sky-700">Open expenses</Link>
      </Box>
      {data.closed.length + data.notDone.length > 0 && (
        <Box title="The day's calls">
          <ul className="flex flex-col gap-1.5">
            {[...data.closed, ...data.notDone].map((one) => (
              <li key={one.id}>
                <Link to={`/visits/${one.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-sky-800">
                  <span className="truncate">{one.client.name} <span className="text-xs text-slate-500">{one.skipReason ?? ""}</span></span>
                  <StatePill visit={one} />
                </Link>
              </li>
            ))}
          </ul>
        </Box>
      )}

      {data.can.send && (
        <Box title="Send the day report">
          <div className="flex flex-col gap-3">
            {data.open.map((one) => (
              <div key={one.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 text-sm font-semibold">{one.client.name} wasn't visited: why?</div>
                <div className="flex flex-wrap gap-1.5">
                  {MISS_REASONS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setReasons((all) => ({ ...all, [one.id]: { reason: key, note: all[one.id]?.note ?? "" } }))}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${reasons[one.id]?.reason === key ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                    >
                      {MISS_WORDS[key]}
                    </button>
                  ))}
                </div>
                <input className={`${FIELD} mt-2 h-9`} placeholder={reasons[one.id]?.reason === "other" ? "Say why *" : "A word (optional)"} value={reasons[one.id]?.note ?? ""} onChange={(event) => setReasons((all) => ({ ...all, [one.id]: { reason: all[one.id]?.reason ?? "", note: event.target.value } }))} />
              </div>
            ))}
            <Label text="Remarks (if any)">
              <textarea className={`${FIELD} h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} />
            </Label>
            <Problem message={action.problem?.message} />
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              The system will mark the end of today's work for you. To keep working, don't send yet.
            </div>
            <Button variant="primary" className="w-full bg-rose-600 hover:bg-rose-700" disabled={action.busy || !allGiven} onClick={send}>
              {action.busy ? "Sending…" : "Send the day report and stop working"}
            </Button>
          </div>
        </Box>
      )}
      {s && s.report.status !== "open" && (
        <Box title="Report">
          <div className="text-sm">
            Sent {s.report.sentAt ? clockOf(s.report.sentAt) : ""}{s.report.note ? ` · “${s.report.note}”` : ""}
            {s.report.status === "seen" && <div className="text-emerald-700">Seen by {s.report.seenBy}{s.report.seenNote ? `: ${s.report.seenNote}` : ""}</div>}
          </div>
          {data.can.see && (
            <div className="mt-3 flex flex-col gap-2">
              <input className={FIELD} placeholder="A word to the MR (optional)" value={seenNote} onChange={(event) => setSeenNote(event.target.value)} />
              <Button
                small
                variant="primary"
                className="w-fit"
                disabled={action.busy}
                onClick={() =>
                  action.run(async () => {
                    await api("/api/mr/day/report/seen", { body: { person: data.person.id, day: data.day, note: seenNote || null } });
                    await queries.invalidateQueries({ queryKey: ["mr"] });
                    // Back to the team's day, where what else waits is listed (one job leads to the next).
                    navigate("/field/team");
                  })
                }
              >
                Mark seen
              </Button>
              <Problem message={action.problem?.message} />
            </div>
          )}
        </Box>
      )}
    </div>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${CARD} p-4`}>
      <h2 className="mb-2 text-sm font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
function Grid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">{children}</dl>;
}
function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold text-slate-500 uppercase">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}
