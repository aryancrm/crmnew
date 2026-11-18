// Monthly sales targets, as cards: the whole team's target against what it sold (Finance
// invoiced) with the month's pace; then each team of the tree with one card per person: a ring of
// sold against target, the target typed in place (or last month's in one click), what is left
// and what that comes to each day still to go. The Admin and the CEO set anyone's; a team lead
// (a head too) the people under them.

import type { TargetList } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Copy, MapPin } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { exactPeso, shortPeso } from "../ceo";
import { Bars, Ring } from "../team/charts";
import { PageState, useAction } from "../ui";

const CARD = "rounded-2xl border border-slate-200/90 bg-white shadow-sm";
type Row = TargetList["rows"][number];

const shift = (month: string, by: number) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

type Tone = "on" | "behind" | "far" | "none";
const TONE: Record<Tone, { word: string; pill: string; ring: string; bar: string }> = {
  on: {
    word: "On pace",
    pill: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    ring: "#10b981",
    bar: "bg-emerald-500",
  },
  behind: {
    word: "Behind",
    pill: "bg-amber-50 text-amber-900 ring-amber-200",
    ring: "#f59e0b",
    bar: "bg-amber-400",
  },
  far: {
    word: "Far behind",
    pill: "bg-rose-50 text-rose-700 ring-rose-200",
    ring: "#f43f5e",
    bar: "bg-rose-500",
  },
  none: {
    word: "No target",
    pill: "bg-slate-50 text-slate-600 ring-slate-200",
    ring: "#94a3b8",
    bar: "bg-slate-400",
  },
};
function toneOf(sold: number, target: number | null, pace: number): Tone {
  if (!target || target <= 0) return "none";
  const share = sold / target;
  if (share >= pace) return "on";
  return pace >= 0.2 && share < pace / 2 ? "far" : "behind";
}

export function Targets() {
  const [params, setParams] = useSearchParams();
  const queries = useQueryClient();
  const copy = useAction();
  const [copied, setCopied] = useState<number | null>(null);
  const asked = params.get("month") ?? "";
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["targets", asked, unit],
    queryFn: () => api<TargetList>(withUnit(`/api/targets?month=${asked}`, unit)),
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the targets" />;
  const pace = data.daysInMonth ? data.daysGone / data.daysInMonth : 1;
  const daysLeft = data.daysInMonth - data.daysGone;
  const total = data.rows.reduce((sum, row) => sum + (row.target ?? 0), 0);
  const sold = data.rows.reduce((sum, row) => sum + row.sold, 0);
  const placed = data.rows.reduce((sum, row) => sum + row.placed, 0);
  const set = data.rows.filter((row) => row.target !== null).length;
  const canCopy = data.rows.some((row) => row.target === null && row.lastTarget !== null);
  const tone = toneOf(sold, total || null, pace);
  const groups = [
    ...data.units.map((unit) => ({
      key: String(unit.id),
      name: unit.name,
      rows: data.rows.filter((row) => row.unitId === unit.id),
    })),
    { key: "none", name: "No seat yet", rows: data.rows.filter((row) => row.unitId === null) },
  ].filter((group) => group.rows.length);

  async function copyLast() {
    if (!data) return;
    await copy.run(async () => {
      const answer = await api<{ copied: number }>("/api/targets/copy", {
        body: { month: data.month },
      });
      setCopied(answer.copied);
      await queries.invalidateQueries({ queryKey: ["targets"] });
    });
  }

  return (
    <div
      className={`mx-auto w-full max-w-screen-2xl space-y-5 ${query.isPlaceholderData ? "opacity-60" : ""}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Targets</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            A target counts what was sold: the person's orders Finance invoiced in the month.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCopy && (
            <button
              type="button"
              onClick={copyLast}
              disabled={copy.busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <Copy className="size-4" />{" "}
              {copy.busy ? "Copying…" : "Use last month's for the empty ones"}
            </button>
          )}
          <div className={`${CARD} flex items-center gap-1 p-1`}>
            <button
              type="button"
              aria-label="Month before"
              onClick={() =>
                setParams((now) => {
                  now.set("month", shift(data.month, -1));
                  return now;
                })
              }
              className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-32 text-center text-sm font-semibold">{data.monthLabel}</span>
            <button
              type="button"
              aria-label="Month after"
              onClick={() =>
                setParams((now) => {
                  now.set("month", shift(data.month, 1));
                  return now;
                })
              }
              className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </header>
      <TeamSwitch />
      {copied !== null && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-900">
          {copied
            ? `Last month's target copied for ${copied} ${copied === 1 ? "person" : "people"}.`
            : "Nobody without a target had one last month."}
        </p>
      )}
      {copy.problem && <p className="text-[13px] text-rose-700">{copy.problem.message}</p>}

      <section className={`${CARD} flex flex-wrap items-center gap-6 p-5`}>
        <Ring share={total ? sold / total : null} pace={pace} color={TONE[tone].ring} size={96}>
          <span className="text-base">{total ? `${Math.round((sold / total) * 100)}%` : "—"}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums"
              title={exactPeso(sold)}
            >
              {shortPeso(sold)}
            </span>
            <span className="text-sm text-slate-500">
              sold of {total ? shortPeso(total) : "no target yet"}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${TONE[tone].pill}`}
            >
              {TONE[tone].word}
            </span>
          </div>
          <div className="relative mt-3 h-2.5 rounded-full bg-slate-100">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${TONE[tone].bar}`}
              style={{ width: `${Math.min(100, total ? (sold / total) * 100 : 0)}%` }}
            />
            {pace > 0 && pace < 1 && (
              <div
                className="absolute -top-1 h-4.5 w-0.5 rounded bg-slate-600"
                style={{ left: `${pace * 100}%` }}
                title="Where the team should be today"
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>
              Targets set for <b className="text-slate-800">{set}</b> of {data.rows.length}
            </span>
            <span>
              Placed <b className="text-slate-800">{shortPeso(placed)}</b>
            </span>
            {total > sold && daysLeft > 0 && (
              <span>
                <b className="text-slate-800">{shortPeso(total - sold)}</b> to go ·{" "}
                {shortPeso((total - sold) / daysLeft)} a day for {daysLeft} days
              </span>
            )}
          </div>
        </div>
      </section>

      {data.rows.some((row) => row.target !== null || row.sold > 0) && (
        <section className={`${CARD} p-5`}>
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Sold against target</h2>
          <Bars
            rows={[...data.rows]
              .sort((a, b) => b.sold - a.sold)
              .map((row) => ({
                key: row.personId,
                label: row.name,
                sub: [row.login, row.area].filter(Boolean).join(" · "),
                value: row.sold,
                mark: row.target,
                tone: TONE[toneOf(row.sold, row.target, pace)].bar,
              }))}
          />
        </section>
      )}

      {data.rows.length === 0 ? (
        <div className={`${CARD} px-5 py-8 text-center text-sm text-slate-500`}>
          Nobody under you sells yet.
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{group.name}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {shortPeso(group.rows.reduce((sum, row) => sum + row.sold, 0))} of{" "}
                {shortPeso(group.rows.reduce((sum, row) => sum + (row.target ?? 0), 0))}
              </span>
              <span className="h-px min-w-6 flex-1 bg-slate-200/70" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {group.rows.map((row) => (
                <TargetCard
                  key={row.personId}
                  row={row}
                  month={data.month}
                  pace={pace}
                  daysLeft={daysLeft}
                />
              ))}
            </div>
          </section>
        ))
      )}
      {data.emptySeats.length > 0 && (
        // Seats nobody holds: their target waits for whoever takes the seat.
        <section className="space-y-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Empty seats</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {data.emptySeats.length} · {shortPeso(data.emptySeats.reduce((sum, seat) => sum + (seat.target ?? 0), 0))} of target waiting
            </span>
            <span className="h-px min-w-6 flex-1 bg-slate-200/70" />
          </div>
          <div className={`${CARD} divide-y divide-slate-100`}>
            {data.emptySeats.map((seat) => (
              <SeatTargetRow key={seat.seatId} seat={seat} month={data.month} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SeatTargetRow({ seat, month }: { seat: TargetList["emptySeats"][number]; month: string }) {
  const queries = useQueryClient();
  const action = useAction();
  const shown = seat.target === null ? "" : String(seat.target / 100);
  const [typed, setTyped] = useState(shown);
  const changed = typed.trim() !== shown;
  async function save() {
    const text = typed.replace(/[,₱\s]/g, "");
    const done = await action.run(() =>
      api("/api/targets/seat", { body: { seatId: seat.seatId, month, amount: text === "" ? null : Math.round(Number(text) * 100) } }),
    );
    if (done) await queries.invalidateQueries({ queryKey: ["targets"] });
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]">
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-slate-900">{seat.area ?? seat.title}</div>
        <div className="truncate text-[11.5px] text-slate-500">
          {seat.unit} · {seat.title}
          {seat.lastTarget !== null ? ` · last month ${shortPeso(seat.lastTarget)}` : ""}
        </div>
      </div>
      <input
        inputMode="decimal"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && changed && void save()}
        placeholder="Target, ₱"
        aria-label={`Target for ${seat.area ?? seat.title}`}
        className="field h-8 w-36 text-right tabular-nums"
      />
      <button
        type="button"
        disabled={!changed || action.busy}
        onClick={() => void save()}
        className="h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}

function TargetCard({
  row,
  month,
  pace,
  daysLeft,
}: {
  row: Row;
  month: string;
  pace: number;
  daysLeft: number;
}) {
  const queries = useQueryClient();
  const action = useAction();
  const shown = row.target === null ? "" : String(row.target / 100);
  const [typed, setTyped] = useState(shown);
  const [saved, setSaved] = useState(false);
  const changed = typed.trim() !== shown;
  const tone = toneOf(row.sold, row.target, pace);
  const share = row.target ? row.sold / row.target : null;
  const left = row.target ? Math.max(0, row.target - row.sold) : 0;

  async function save(value: string) {
    const text = value.replace(/[,₱\s]/g, "");
    const done = await action.run(async () => {
      await api("/api/targets", {
        body: {
          personId: row.personId,
          month,
          amount: text === "" ? null : Math.round(Number(text) * 100),
        },
      });
    });
    if (done) {
      setSaved(true);
      await queries.invalidateQueries({ queryKey: ["targets"] });
      await queries.invalidateQueries({ queryKey: ["team"] });
      await queries.invalidateQueries({ queryKey: ["orders", "mine"] });
    }
  }

  return (
    <article className={`${CARD} flex min-w-0 flex-col gap-3 p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">{row.name}</h3>
          <div className="truncate text-[11px] font-medium text-slate-500">
            {row.login && (
              <span className="font-mono font-semibold text-slate-700">{row.login} · </span>
            )}
            {row.title ?? row.roleLabel}
          </div>
          {row.area && (
            <div className="mt-1 inline-flex max-w-full items-center gap-0.5 truncate text-[10px] text-slate-500">
              <MapPin className="size-2.5 shrink-0 text-slate-400" /> {row.area}
            </div>
          )}
        </div>
        <Ring share={share} pace={pace} color={TONE[tone].ring} size={56}>
          {share === null ? "—" : `${Math.round(share * 100)}%`}
        </Ring>
      </div>
      <dl className="grid grid-cols-3 gap-1 text-center">
        {[
          ["Sold", shortPeso(row.sold)],
          ["Placed", shortPeso(row.placed)],
          ["Left", row.target ? shortPeso(left) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-1 py-1.5">
            <dt className="text-[10px] text-slate-500">{label}</dt>
            <dd className="text-[13px] font-semibold text-slate-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <label
          className="text-[11px] font-semibold text-slate-600"
          htmlFor={`target-${row.personId}`}
        >
          Target for the month (₱)
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id={`target-${row.personId}`}
            inputMode="decimal"
            value={typed}
            placeholder="No target"
            onChange={(event) => {
              setTyped(event.target.value);
              setSaved(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && changed) save(typed);
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm tabular-nums focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
          />
          {changed ? (
            <button
              type="button"
              onClick={() => save(typed)}
              disabled={action.busy}
              className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {action.busy ? "Saving…" : "Save"}
            </button>
          ) : saved ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <Check className="size-3.5" /> Saved
            </span>
          ) : null}
        </div>
        {row.target === null && row.lastTarget !== null && (
          <button
            type="button"
            onClick={() => {
              const value = String((row.lastTarget as number) / 100);
              setTyped(value);
              save(value);
            }}
            className="mt-1.5 text-[11px] font-semibold text-emerald-700 hover:underline"
          >
            Same as last month: {shortPeso(row.lastTarget)}
          </button>
        )}
        {action.problem && (
          <div className="mt-1 text-xs text-rose-700">{action.problem.message}</div>
        )}
      </div>
      <CountTargets row={row} month={month} />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${TONE[tone].pill}`}>
          {TONE[tone].word}
        </span>
        {row.target && left > 0 && daysLeft > 0 ? (
          <span>
            {shortPeso(left / daysLeft)} a day for {daysLeft} days
          </span>
        ) : row.setBy ? (
          <span>Set by {row.setBy}</span>
        ) : null}
      </div>
    </article>
  );
}

/** TLB (different SKUs) and billing efficiency (different customers) targets beside the peso one:
 *  the daily sales performance reads them (18 Nov). They ride on the peso target's month. */
function CountTargets({ row, month }: { row: Row; month: string }) {
  const queries = useQueryClient();
  const action = useAction();
  const [tlb, setTlb] = useState(row.tlbTarget === null ? "" : String(row.tlbTarget));
  const [billed, setBilled] = useState(row.billedTarget === null ? "" : String(row.billedTarget));
  const changed = tlb !== (row.tlbTarget === null ? "" : String(row.tlbTarget)) || billed !== (row.billedTarget === null ? "" : String(row.billedTarget));
  const box = "h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm tabular-nums focus:border-emerald-600 focus:outline-none disabled:bg-slate-50";
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-slate-600">
          TLB (SKUs)
          <input className={box} inputMode="numeric" disabled={row.target === null} value={tlb} onChange={(event) => setTlb(event.target.value.replace(/\D/g, ""))} placeholder="—" />
        </label>
        <label className="text-[11px] font-semibold text-slate-600">
          Billing (customers)
          <input className={box} inputMode="numeric" disabled={row.target === null} value={billed} onChange={(event) => setBilled(event.target.value.replace(/\D/g, ""))} placeholder="—" />
        </label>
      </div>
      {row.target === null ? (
        <p className="mt-1 text-[10px] text-slate-400">Set the peso target first.</p>
      ) : (
        changed && (
          <button
            type="button"
            disabled={action.busy}
            className="mt-1.5 h-7 rounded-lg bg-brand px-3 text-xs font-semibold text-white disabled:opacity-50"
            onClick={() =>
              void action.run(async () => {
                await api("/api/targets", { body: { personId: row.personId, month, amount: row.target, tlb: tlb === "" ? null : Number(tlb), billed: billed === "" ? null : Number(billed) } });
                await queries.invalidateQueries({ queryKey: ["targets"] });
                await queries.invalidateQueries({ queryKey: ["sales-performance"] });
              })
            }
          >
            Save counts
          </button>
        )
      )}
      {action.problem && <div className="mt-1 text-xs text-rose-700">{action.problem.message}</div>}
    </div>
  );
}
