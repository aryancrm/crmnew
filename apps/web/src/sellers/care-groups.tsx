// Patient Care Groups (Rx Team & Training Playbook): the Rx CHC enrols a doctor's group (with the
// patients' consent); MD Telesales see the groups waiting with the 15-minute clock and press
// "Contacted" when they have made first contact (the group is theirs from then); a group quiet 14
// days goes back to the CHC. The coach and the Country Mentor see every group and how often the
// 15 minutes were kept.

import type { CareGroups, RxDay } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, CARD, Dialog, PageHead, PageState, Problem, useAction, useOpenOnPress } from "../ui";
import { EmptyState } from "../no-results";
import { useHqNames } from "../team/hq-name";

type Row = CareGroups["rows"][number];

const STATE: Record<Row["state"], { word: string; pill: string }> = {
  waiting: { word: "Waiting for first contact", pill: "bg-amber-50 text-amber-800" },
  late: { word: "Past the 15 minutes", pill: "bg-rose-50 text-rose-800" },
  active: { word: "Active", pill: "bg-emerald-50 text-emerald-800" },
  quiet14: { word: "Quiet 14 days: CHC to follow up", pill: "bg-amber-50 text-amber-800" },
  quiet30: { word: "Quiet 30 days", pill: "bg-rose-50 text-rose-800" },
};

const useGroups = () =>
  useQuery({ queryKey: ["care-groups"], queryFn: () => api<CareGroups>("/api/care-groups"), refetchInterval: 30_000 });

/** Minutes ticking since enrolment, for the 15-minute clock. */
function Clock15({ since, limit }: { since: string; limit: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  const late = minutes > limit;
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums ${late ? "text-rose-700" : "text-amber-700"}`}>
      <Clock className="size-3" /> {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}
      {late ? " · late" : ` of ${limit}`}
    </span>
  );
}

function ContactButton({ row }: { row: Row }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <>
      <Button
        small
        variant="primary"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await api(`/api/care-groups/${row.id}/contact`, { method: "POST", body: {} });
            await queries.invalidateQueries({ queryKey: ["care-groups"] });
            await queries.invalidateQueries({ queryKey: ["my", "pulse"] });
          })
        }
      >
        <Check className="size-3.5" /> Contacted
      </Button>
      {action.problem && <span className="text-[11.5px] text-rose-700">{action.problem.message}</span>}
    </>
  );
}

/** The CHC or the group's telesales notes that the group talked today (it stays out of "quiet"). */
function ActivityButton({ id }: { id: number }) {
  const queries = useQueryClient();
  const action = useAction();
  return (
    <button
      type="button"
      disabled={action.busy}
      className="font-semibold text-emerald-700 hover:underline"
      onClick={() =>
        void action.run(async () => {
          await api(`/api/care-groups/${id}/activity`, { method: "POST", body: {} });
          await queries.invalidateQueries({ queryKey: ["care-groups"] });
        })
      }
    >
      {action.problem ? action.problem.message : "Activity today"}
    </button>
  );
}

/** The groups waiting for first contact, for MD Telesales' Home and the page. */
export function WaitingGroups({ data, limit = 8 }: { data: CareGroups; limit?: number }) {
  // Each person after their HQ ("TAFT · Marwin Dy").
  const { named } = useHqNames();
  const waiting = data.rows.filter((row) => row.state === "waiting" || row.state === "late").slice(0, limit);
  return (
    <section className={`${CARD} min-w-0`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Users className="size-4 text-slate-500" /> New groups waiting
        </h3>
        <span className="text-[11px] text-slate-500">First contact within {data.firstContactMinutes} minutes of enrolment; the first to contact takes the group</span>
      </header>
      {waiting.length === 0 ? (
        <EmptyState title="No group is waiting.">New groups an Rx CHC enrols show here, waiting for first contact.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {waiting.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-900">{row.doctor}</span>
                <span className="block text-[11.5px] text-slate-500">
                  Enrolled by {named(row.chcId, row.chc)} · {row.patients} patient{row.patients === 1 ? "" : "s"}
                </span>
              </span>
              <Clock15 since={row.enrolledAt} limit={data.firstContactMinutes} />
              {data.can.contact && <ContactButton row={row} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The heads' one-glance card: waiting now, the 15 minutes kept this month, quiet groups. On the
 *  Care groups page itself (`onPage`) it has no Open link, which would only open the same page. */
export function GroupsGlance({ data, onPage = false }: { data: CareGroups; onPage?: boolean }) {
  const c = data.counts;
  const kept = c.contactedThisMonth ? Math.round((c.contactedInTime / c.contactedThisMonth) * 100) : null;
  return (
    <section className={`${CARD} min-w-0 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Users className="size-4 text-slate-500" /> Patient Care Groups
        </h2>
        {!onPage && (
          <Link to="/care-groups" className="text-[12px] font-semibold text-emerald-700 hover:underline">
            Open
          </Link>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {(
          [
            ["Waiting now", c.waiting + c.late, c.late ? "text-rose-700" : "text-slate-900"],
            ["15 min kept", kept === null ? "—" : `${kept}%`, kept === null ? "text-slate-400" : kept >= 90 ? "text-emerald-700" : "text-amber-700"],
            // The month's counts include groups since closed, which the list (open groups) doesn't
            // show: said here, so the glance and the list agree.
            [
              c.closedThisMonth ? `Enrolled this month, ${c.closedThisMonth} since closed` : "Enrolled this month",
              c.enrolledThisMonth,
              "text-slate-900",
            ],
            ["Quiet 14+ days", c.quiet14 + c.quiet30, c.quiet14 + c.quiet30 ? "text-amber-700" : "text-slate-900"],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-2 py-1.5">
            <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
            <div className="text-[11px] text-slate-500">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Rx CHC enrols a doctor's group: the doctor, how many patients, and the consent asked. */
export function EnrolDialog({ onClose, doctorId }: { onClose: () => void; doctorId?: number }) {
  const queries = useQueryClient();
  const action = useAction();
  const doctors = useQuery({ queryKey: ["rx", "day"], queryFn: () => api<RxDay>("/api/rx/day") });
  const [picked, setPicked] = useState<number | "">(doctorId ?? "");
  const [patients, setPatients] = useState("1");
  const [consent, setConsent] = useState(false);
  return (
    <Dialog title="Enrol a care group" sub="MD Telesales will be asked to make first contact within 15 minutes" onClose={onClose} busy={action.busy}>
      <label className="block text-[12.5px] font-semibold text-slate-600">
        Doctor
        <select className="field h-10 w-full" value={picked} onChange={(event) => setPicked(event.target.value ? Number(event.target.value) : "")}>
          <option value="">Pick the doctor</option>
          {(doctors.data?.doctors ?? []).map((doctor) => (
            <option key={doctor.customerId} value={doctor.customerId}>
              {doctor.name}
              {doctor.tier ? ` · Tier ${doctor.tier}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-[12.5px] font-semibold text-slate-600">
        Patients in the group
        <input className="field h-10 w-full" inputMode="numeric" value={patients} onChange={(event) => setPatients(event.target.value)} />
      </label>
      <label className="mt-3 flex items-start gap-2 text-[13px] text-slate-700">
        <input type="checkbox" className="mt-0.5 accent-emerald-600" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        Each patient agreed to be added to the group (consent is required before anyone is enrolled).
      </label>
      <Problem message={action.problem?.message} />
      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          disabled={action.busy || !picked}
          onClick={() =>
            void action.run(async () => {
              await api("/api/care-groups", { method: "POST", body: { doctorId: picked, patients: Number(patients) || 0, consent } });
              await queries.invalidateQueries({ queryKey: ["care-groups"] });
              onClose();
            })
          }
        >
          Enrol the group
        </Button>
      </div>
    </Dialog>
  );
}

export function CareGroupsPage() {
  const query = useGroups();
  const [enrolling, setEnrolling] = useState(false);
  // Each person after their HQ ("TAFT · Marwin Dy"); a group's row opens its doctor, as its name does.
  const { named } = useHqNames();
  const open = useOpenOnPress();
  const data = query.data;
  if (!data) return <PageState query={query} what="the care groups" />;
  const rest = data.rows.filter((row) => row.state !== "waiting" && row.state !== "late");
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHead
        title="Patient Care Groups"
        sub={`${data.counts.active} active · ${data.counts.quiet14 + data.counts.quiet30} quiet 14 days or more · enrolled by the Rx CHC, answered by MD Telesales`}
        actions={
          data.can.enrol ? (
            <Button variant="primary" onClick={() => setEnrolling(true)}>
              <Plus className="size-4" /> Enrol a group
            </Button>
          ) : undefined
        }
      />
      {!data.can.enrol && !data.can.contact && <GroupsGlance data={data} onPage />}
      <WaitingGroups data={data} limit={50} />
      <section className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5">Group</th>
              <th className="px-3 py-2.5">CHC · MD Telesales</th>
              <th className="px-3 py-2.5 text-right">Patients</th>
              <th className="px-3 py-2.5">First contact</th>
              <th className="px-4 py-2.5">Now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rest.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No group answered yet.">Groups show here once MD Telesales has made first contact.</EmptyState>
                </td>
              </tr>
            )}
            {rest.map((row) => (
              <tr key={row.id} onClick={open(`/customers/${row.doctorId}`)} className="cursor-pointer hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <Link to={`/customers/${row.doctorId}`} className="font-semibold text-slate-900 hover:underline">
                    {row.doctor}
                  </Link>
                  <div className="text-[11.5px] text-slate-500">{row.name}</div>
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {named(row.chcId, row.chc)}
                  <div className="text-[11.5px] text-slate-400">{row.telesales ? named(row.telesalesId, row.telesales) : "—"}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.patients}</td>
                <td className={`px-3 py-2.5 tabular-nums ${row.contactMinutes !== null && row.contactMinutes > data.firstContactMinutes ? "text-rose-700" : "text-slate-600"}`}>
                  {row.contactMinutes === null ? "—" : `in ${row.contactMinutes} min`}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${STATE[row.state].pill}`}>{STATE[row.state].word}</span>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    {row.quietDays === 0 ? "activity today" : `last activity ${row.quietDays} day${row.quietDays === 1 ? "" : "s"} ago`}
                    {(row.mine || data.can.enrol) && row.quietDays > 0 && <ActivityButton id={row.id} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {enrolling && <EnrolDialog onClose={() => setEnrolling(false)} />}
    </div>
  );
}
