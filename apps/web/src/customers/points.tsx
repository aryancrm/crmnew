// Customer points: the program (on or off, its rate), every customer's balance by their phone,
// one customer's history, and adjusting it by hand (the Admin and the CEO, with why).

import type { PointsAccountDetail, PointsList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, NoResults } from "../no-results";
import { avatarTone, initials } from "../look";
import {
  Button,
  count,
  Field,
  INPUT,
  PageHead,
  PageState,
  Pill,
  Problem,
  timeLabel,
  useAction,
} from "../ui";

export function PointsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts the timer
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typed.trim() !== q) setParams(typed.trim() ? { q: typed.trim() } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const query = useQuery({
    queryKey: ["points", q],
    queryFn: () => api<PointsList>(`/api/points${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the points" />;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHead title="Points" />
      <Program data={data} />
      {data.can.adjust && <AddPoints />}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-2 left-3 size-4 text-slate-400" />
            <input
              type="search"
              aria-label="Search by name or phone"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Search name or phone…"
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/70 pr-3 pl-9 text-sm focus:border-brand focus:bg-white focus:outline-none"
            />
          </div>
          <div className="text-xs text-slate-500">
            {count(data.totals.accounts)} customers · {count(data.totals.balance)} points held ·{" "}
            {count(data.totals.earned)} earned in all
          </div>
        </div>
        {data.accounts.length === 0 ? (
          q ? (
            <NoResults title="No customer matches.">Try another name or phone number.</NoResults>
          ) : (
            <EmptyState title="No one has points yet.">Each customer's points balance shows here, by their phone number.</EmptyState>
          )
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.accounts.map((account) => (
              <li key={account.id}>
                <Link
                  to={`/points/${account.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarTone(account.name)}`}
                  >
                    {initials(account.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {account.name}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {account.phone}
                      {account.lastAt ? ` · last ${timeLabel(account.lastAt)}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[15px] font-bold text-emerald-700 tabular-nums">
                      {count(account.balance)}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      earned {count(account.earned)} · used {count(account.spent)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Program({ data }: { data: PointsList }) {
  const [rate, setRate] = useState(String(data.program.rateBps / 100));
  const action = useAction();
  const queries = useQueryClient();
  async function save(enabled: boolean) {
    if (
      await action.run(async () =>
        api("/api/settings/points", { body: { enabled, rateBps: Math.round(Number(rate) * 100) } }),
      )
    )
      await queries.invalidateQueries({ queryKey: ["points"] });
  }
  return (
    <section
      className={`rounded-2xl border p-4 shadow-sm ${data.program.enabled ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/60"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-ink">
            The points program is {data.program.enabled ? "on" : "off"}
          </span>
          <Pill tone={data.program.enabled ? "good" : "warn"}>
            {data.program.enabled ? `${data.program.rateBps / 100}% earned` : "Nothing is earned"}
          </Pill>
        </div>
        {data.can.program && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Rate (%)" error={action.at("rateBps")}>
              {(field) => (
                <input
                  {...field}
                  className={`${INPUT} w-20`}
                  inputMode="decimal"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                />
              )}
            </Field>
            <Button
              small
              variant={data.program.enabled ? "plain" : "primary"}
              disabled={action.busy}
              onClick={() => save(!data.program.enabled)}
            >
              {data.program.enabled ? "Switch off" : "Switch on"}
            </Button>
            {data.program.enabled && (
              <Button
                small
                disabled={action.busy || Number(rate) * 100 === data.program.rateBps}
                onClick={() => save(true)}
              >
                Save the rate
              </Button>
            )}
          </div>
        )}
      </div>
      <Problem message={action.general(["rateBps"])} />
    </section>
  );
}

export function PointsAccountPage() {
  const id = Number(useParams().id);
  const query = useQuery({
    queryKey: ["points", "account", id],
    queryFn: () => api<PointsAccountDetail>(`/api/points/${id}`),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the points" />;
  const { account } = data;
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/points"
        className="mb-3 inline-block text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        ← Points
      </Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`flex size-11 items-center justify-center rounded-xl text-sm font-bold ${avatarTone(account.name)}`}
            >
              {initials(account.name)}
            </span>
            <div>
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">{account.name}</h1>
              <div className="text-[13px] text-slate-500">{account.phone}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-emerald-700 tabular-nums">
              {count(account.balance)}
            </div>
            <div className="text-xs text-slate-500">
              points · ₱{count(account.balance)} · earned {count(account.earned)} · used{" "}
              {count(account.spent)}
            </div>
          </div>
        </div>
        {data.can.adjust && <Adjust id={id} />}
      </section>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-[13px] font-semibold">History</h2>
        <ul className="divide-y divide-slate-100">
          {data.entries.length === 0 && (
            <li>
              <EmptyState title="Nothing yet.">Points earned, used and adjusted for this customer show here.</EmptyState>
            </li>
          )}
          {data.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
            >
              <span className="min-w-0">
                <span className="font-semibold text-ink">{entry.kindLabel}</span>
                {entry.reference && (
                  <span className="text-slate-500">
                    {" · "}
                    {entry.orderId ? (
                      <Link to={`/orders/${entry.orderId}`} className="hover:text-emerald-700">
                        {entry.reference}
                      </Link>
                    ) : (
                      entry.reference
                    )}
                  </span>
                )}
                {entry.note && (
                  <span className="block truncate text-[12px] text-slate-500">{entry.note}</span>
                )}
                <span className="block text-[11px] text-slate-400">
                  {timeLabel(entry.at)}
                  {entry.by ? ` · ${entry.by}` : ""}
                </span>
              </span>
              <span
                className={`shrink-0 font-bold tabular-nums ${entry.points < 0 ? "text-rose-700" : "text-emerald-700"}`}
              >
                {entry.points > 0 ? "+" : ""}
                {count(entry.points)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Points to a customer by their mobile number (Aryan, 19 Nov): the number of points typed is
 *  theirs (one point is one peso off); a number with no points yet gets its account. */
function AddPoints() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [points, setPoints] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const action = useAction();
  const queries = useQueryClient();
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault();
    let made: { id: number } | null = null;
    if (
      await action.run(async () => {
        made = await api<{ id: number; balance: number }>("/api/points/add", {
          body: { phone, points: Math.round(Number(points)), name: name.trim() || null, reason: reason.trim() || null },
        });
      })
    ) {
      await queries.invalidateQueries({ queryKey: ["points"] });
      const done = made as { id: number } | null;
      if (done) navigate(`/points/${done.id}`);
    }
  }
  if (!open)
    return (
      <div className="mt-4">
        <Button variant="primary" small onClick={() => setOpen(true)}>
          Add points
        </Button>
      </div>
    );
  return (
    <form
      onSubmit={submit}
      className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[10rem_7rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <Field label="Mobile number" error={action.at("phone")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            inputMode="tel"
            placeholder="0917 123 4567"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        )}
      </Field>
      <Field label="Points" error={action.at("points")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            inputMode="numeric"
            placeholder="500"
            value={points}
            onChange={(event) => setPoints(event.target.value.replace(/[^\d]/g, ""))}
          />
        )}
      </Field>
      <Field label="Name (a new number)" error={action.at("name")}>
        {(field) => (
          <input {...field} className={INPUT} value={name} onChange={(event) => setName(event.target.value)} />
        )}
      </Field>
      <Field label="Why (optional)" error={action.at("reason")}>
        {(field) => (
          <input {...field} className={INPUT} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </Field>
      <div className="flex items-end gap-1.5">
        <Button type="submit" small variant="primary" disabled={action.busy || !phone.trim() || !Number(points)}>
          Add
        </Button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-200"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-[11px] text-slate-500 sm:col-span-5">
        One point is one peso off their next order. A number with no points yet gets its points
        account, tied to the patient with that number if there is one.
      </p>
      <div className="sm:col-span-5">
        <Problem message={action.general(["phone", "points", "name", "reason"])} />
      </div>
    </form>
  );
}

function Adjust({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const action = useAction();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      await action.run(async () =>
        api(`/api/points/${id}/adjust`, { body: { points: Math.round(Number(points)), reason } }),
      )
    ) {
      setPoints("");
      setReason("");
      setOpen(false);
      await queries.invalidateQueries({ queryKey: ["points"] });
    }
  }
  if (!open)
    return (
      <div className="mt-3">
        <Button small onClick={() => setOpen(true)}>
          Add points
        </Button>
      </div>
    );
  return (
    <form
      onSubmit={submit}
      className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
    >
      <Field label="Points (−10 takes off)" error={action.at("points")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            inputMode="numeric"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
          />
        )}
      </Field>
      <Field label="Why" error={action.at("reason")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <div className="flex items-end gap-1.5">
        <Button
          type="submit"
          small
          variant="primary"
          disabled={action.busy || !points || !reason.trim()}
        >
          Save
        </Button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-200"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="sm:col-span-3">
        <Problem message={action.general(["points", "reason"])} />
      </div>
    </form>
  );
}
