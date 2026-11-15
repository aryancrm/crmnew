// Dispatch's Board view (the order list's third look, beside Cards and Table): the warehouse's
// day as it is worked, three columns in order. 1 Pack: what to pick and how many, by when, any
// note. 2 Ship: where it goes and to whom, what is in the box batch by batch, cash to collect,
// the receipt to print. 3 On the road: with which courier or rider, since when; Delivered or Came
// back. Delivered today under them. Loaded only when someone picks Board (lazy), with its own read.
// On a phone the three columns are three tabs.

import type { DispatchBoard, DispatchCard } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, MapPin, Phone, Printer, StickyNote } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMe } from "../auth";
import { type DispatchAsk, DispatchDialogs } from "../dispatch/parts";
import { ReasonDialog, waited } from "../orders/parts";
import { count, dayLabel, inPacks, PageState, peso, useAction } from "../ui";
import { useWorkClock } from "../work-clock";

type Lane = "pack" | "ship" | "road";

const LANES: { key: Lane; number: number; title: string; hint: string }[] = [
  { key: "pack", number: 1, title: "Pack", hint: "Pick by batch, first expiry first" },
  { key: "ship", number: 2, title: "Ship", hint: "Print the receipt, hand it to the courier" },
  { key: "road", number: 3, title: "On the road", hint: "Confirm when the customer has it" },
];

const MAIN =
  "h-9 flex-1 rounded-lg bg-brand text-xs font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50";
const QUIET =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/** The time of day in Manila: "3:41 PM". */
const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));

const hoursSince = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : 0);

export function DispatchLanes() {
  const me = useMe().data;
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const [params, setParams] = useSearchParams();
  const lane = (params.get("lane") ?? "pack") as Lane;
  const [asking, setAsking] = useState<DispatchAsk>(null);
  const [holding, setHolding] = useState<DispatchCard | null>(null);
  const board = useQuery({
    queryKey: ["dispatch", "board"],
    queryFn: () => api<DispatchBoard>("/api/dispatch/board"),
    refetchInterval: 30_000,
  });
  const data = board.data;
  if (!me) return null;
  if (!data) return <PageState query={board} what="the warehouse's work" />;
  const work = data.can.work;
  const ask = (what: NonNullable<DispatchAsk>["what"], card: DispatchCard) =>
    setAsking({ what, orderId: card.id, code: card.code });
  async function take(card: DispatchCard, release: boolean) {
    await action.run(() => api(`/api/dispatch/orders/${card.id}/take`, { body: { release } }));
    await queries.invalidateQueries({ queryKey: ["dispatch"] });
  }
  const cards: Record<Lane, DispatchCard[]> = {
    pack: data.toPack,
    ship: data.toShip,
    road: data.road,
  };
  const counts: Record<Lane, number> = {
    pack: data.counts.toPack,
    ship: data.counts.toShip,
    road: data.counts.road,
  };
  const open = (card: DispatchCard) => navigate(`/orders/${card.id}`);

  const column = (key: Lane) => {
    const meta = LANES.find((one) => one.key === key) as (typeof LANES)[number];
    const list = cards[key];
    return (
      <section key={key} aria-label={meta.title} className="flex min-w-0 flex-col gap-3">
        <header className="flex items-center gap-2.5 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-2xs">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700">
            {meta.number}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">{meta.title}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 tabular-nums">
                {count(counts[key])}
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-500">{meta.hint}</p>
          </div>
        </header>
        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-xs text-slate-500">
            {key === "pack"
              ? "Nothing to pack."
              : key === "ship"
                ? "Nothing packed and waiting."
                : "Nothing on the road."}
          </div>
        ) : (
          list.map((card) => (
            <WorkCard
              key={card.id}
              card={card}
              lane={key}
              today={data.today}
              mine={card.dispatchById === me.id}
              onOpen={() => open(card)}
            >
              {work &&
                (key === "pack" ? (
                  <>
                    <button
                      type="button"
                      className={MAIN}
                      disabled={action.busy}
                      onClick={() => ask("pack", card)}
                    >
                      Pack
                    </button>
                    <button type="button" className={QUIET} onClick={() => setHolding(card)}>
                      Hold
                    </button>
                  </>
                ) : key === "ship" ? (
                  <>
                    <button type="button" className={MAIN} onClick={() => ask("ship", card)}>
                      {card.cameBack ? "Ship again" : "Ship"}
                    </button>
                    <Link
                      to={`/orders/${card.id}/receipt`}
                      onClick={(event) => event.stopPropagation()}
                      className={`${QUIET} inline-flex items-center gap-1.5`}
                    >
                      <Printer className="size-3.5" /> Receipt
                    </Link>
                  </>
                ) : (
                  <>
                    <button type="button" className={MAIN} onClick={() => ask("deliver", card)}>
                      Delivered
                    </button>
                    {/* A courier parcel with no tracking yet can still come back. */}
                    {card.method === "courier" && !card.tracking && (
                      <button type="button" className={QUIET} onClick={() => ask("tracking", card)}>
                        Add tracking
                      </button>
                    )}
                    <button type="button" className={QUIET} onClick={() => ask("failed", card)}>
                      Came back
                    </button>
                  </>
                ))}
              {work && (key === "pack" || key === "ship") && (
                <TakeButton
                  card={card}
                  mine={card.dispatchById === me.id}
                  busy={action.busy}
                  onTake={(release) => take(card, release)}
                />
              )}
            </WorkCard>
          ))
        )}
        {counts[key] > list.length && (
          <Link
            to={`/dispatch?tab=${key === "pack" ? "to_pack" : key === "ship" ? "to_ship" : "road"}`}
            className="text-center text-xs font-semibold text-emerald-700 hover:underline"
          >
            {count(counts[key] - list.length)} more →
          </Link>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {data.counts.held > 0 && (
            <Link
              to="/dispatch/hold"
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-semibold text-rose-700 hover:border-rose-300"
            >
              <span className="size-1.5 rounded-full bg-rose-500" /> {count(data.counts.held)} on
              hold
            </Link>
          )}
          {data.counts.coming > 0 && (
            <Link
              to="/dispatch?tab=upstream"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 shadow-2xs hover:border-slate-300"
            >
              <span className="size-1.5 rounded-full bg-sky-500" /> {count(data.counts.coming)}{" "}
              coming from Finance
            </Link>
          )}
        </div>
      </div>

      {action.problem && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
        >
          {action.problem.message}
        </div>
      )}

      {/* A phone: the three steps as tabs. */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 xl:hidden">
        {LANES.map((one) => (
          <button
            key={one.key}
            type="button"
            aria-pressed={lane === one.key}
            onClick={() =>
              setParams(
                (old) => {
                  const next = new URLSearchParams(old);
                  if (one.key === "pack") next.delete("lane");
                  else next.set("lane", one.key);
                  return next;
                },
                { replace: true },
              )
            }
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold ${
              lane === one.key
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600"
            }`}
          >
            {one.number}. {one.title}
            <span className="rounded-full bg-slate-200/70 px-1.5 text-[10px] tabular-nums">
              {count(counts[one.key])}
            </span>
          </button>
        ))}
      </div>
      <div className="xl:hidden">{column(lane)}</div>
      <div className="hidden items-start gap-4 xl:grid xl:grid-cols-3">
        {LANES.map((one) => column(one.key))}
      </div>

      {/* Delivered today. */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
        <h2 className="mb-2.5 flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
          <CheckCheck className="size-4 text-emerald-600" /> Delivered today
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 tabular-nums">
            {count(data.counts.delivered)}
          </span>
        </h2>
        {data.delivered.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing delivered yet today.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            {data.delivered.map((card) => (
              <li key={card.id} className="flex min-w-0 items-center justify-between gap-2">
                <Link to={`/orders/${card.id}`} className="min-w-0 truncate hover:underline">
                  <span className="font-semibold text-slate-900">{card.customer}</span>{" "}
                  <span className="text-slate-500">· {card.code}</span>
                </Link>
                <span className="shrink-0 text-xs text-slate-500">
                  {card.receivedBy ? `${card.receivedBy} · ` : ""}
                  {card.deliveredAt ? clock(card.deliveredAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DispatchDialogs ask={asking} onClose={() => setAsking(null)} />
      {holding && (
        <ReasonDialog
          orderId={holding.id}
          code={holding.code}
          what="hold"
          onClose={() => setHolding(null)}
        />
      )}
    </div>
  );
}

/** One order on the work board: its step's facts only, and its buttons. */
function WorkCard({
  card,
  lane,
  today,
  mine,
  onOpen,
  children,
}: {
  card: DispatchCard;
  lane: Lane;
  today: string;
  mine: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const late = card.expectedOn !== null && card.expectedOn < today;
  const dueToday = card.expectedOn === today;
  // On the road: three days on the clock; at Dispatch: past a working day, in working hours.
  const { lateAt } = useWorkClock();
  const slow =
    lane === "road" ? hoursSince(card.shippedAt) >= 72 : lateAt(card.status, card.stepSince);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the card holds buttons, so it can't be one link
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) onOpen();
      }}
      className={`flex cursor-pointer flex-col gap-2.5 rounded-2xl border p-3.5 shadow-2xs transition-[border-color,box-shadow] hover:shadow-md ${
        card.cameBack
          ? "border-rose-200 bg-rose-50/40 hover:border-rose-300"
          : mine
            ? "border-sky-200 bg-sky-50/30 hover:border-sky-300"
            : "border-slate-200/90 bg-white hover:border-emerald-300"
      }`}
    >
      {/* Who and which order, and how long it has waited at this step. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            className="truncate text-sm font-semibold tracking-tight text-slate-900"
            title={card.customer}
          >
            {card.customer}
          </h3>
          <div className="truncate text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">{card.code}</span> · {card.medrep}
            {card.warehouse && lane === "pack" ? ` · from ${card.warehouse}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`text-[11px] font-semibold tabular-nums ${slow ? "text-rose-700" : "text-slate-500"}`}
          >
            {lane === "road" && card.shippedAt
              ? `out ${waited(card.shippedAt)}`
              : waited(card.stepSince)}
          </span>
          {lane !== "road" && (late || dueToday) && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${late ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-900 ring-1 ring-amber-300"}`}
            >
              {late ? `Late · ${dayLabel(card.expectedOn as string)}` : "Wanted today"}
            </span>
          )}
          {lane !== "road" && card.expectedOn && !late && !dueToday && (
            <span className="text-[10px] text-slate-500">wanted {dayLabel(card.expectedOn)}</span>
          )}
        </div>
      </div>

      {card.cameBack && card.cameBackReason && (
        <div className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] text-rose-900">
          <span className="font-semibold">
            Came back{card.cameBackCount > 1 ? ` ${card.cameBackCount} times` : ""}:
          </span>{" "}
          {card.cameBackReason}
        </div>
      )}

      {lane === "pack" ? (
        // What to pick.
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-slate-50/50 text-[12px]">
          {card.items.map((item) => (
            <li
              key={`${item.name}-${item.free}`}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate font-medium text-slate-800">
                {item.name}
                {item.free && (
                  <span className="ml-1 text-[10px] font-semibold text-emerald-700">free</span>
                )}
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="font-semibold text-slate-900">{count(item.qty)}</span>{" "}
                <span className="text-slate-500">{item.unit ? `${item.unit}s` : "pcs"}</span>
                {inPacks(item.qty, item.packSize) && (
                  <span className="block text-[10px] text-slate-500">
                    {inPacks(item.qty, item.packSize)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        // Where it goes and to whom.
        <div className="space-y-1 text-[12px] text-slate-700">
          <p className="flex gap-1.5">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-2">
              {card.receiver && (
                <span className="font-semibold text-slate-900">{card.receiver} · </span>
              )}
              {card.address ?? "No address"}
            </span>
          </p>
          {card.receiverPhone && (
            <a
              href={`tel:${card.receiverPhone.replace(/[^\d+]/g, "")}`}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900"
            >
              <Phone className="size-3.5 text-slate-400" />{" "}
              <span className="tabular-nums">{card.receiverPhone}</span>
            </a>
          )}
        </div>
      )}

      {lane === "ship" &&
        (card.picks.length > 0 ? (
          // What is in the box, batch by batch.
          <ul className="space-y-0.5 rounded-lg border border-slate-200/80 bg-slate-50/50 px-2.5 py-1.5 text-[11px] text-slate-600">
            {card.picks.map((pick) => (
              <li key={`${pick.medicine}-${pick.batchNo}`} className="flex justify-between gap-2">
                <span className="truncate">
                  {pick.medicine} ·{" "}
                  <span className="font-medium text-slate-700">{pick.batchNo}</span> · exp{" "}
                  {dayLabel(pick.expiresOn)}
                </span>
                <span className="shrink-0 font-semibold text-slate-800 tabular-nums">
                  {count(pick.qty)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-slate-500">{count(card.pieces)} pieces in the box</p>
        ))}

      {lane === "road" && (
        <p className="text-[12px] text-slate-700">
          <span className="font-semibold">
            {card.method === "rider"
              ? `Our rider ${card.rider ?? ""}`
              : card.method === "pickup"
                ? "Picked up"
                : (card.courier ?? "Courier")}
          </span>
          {card.method === "courier" &&
            (card.tracking ? (
              <span className="text-slate-500"> · {card.tracking}</span>
            ) : (
              <span className="text-amber-700"> · no tracking yet</span>
            ))}
        </p>
      )}

      {card.collect !== null && card.collect > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-900">
          Collect {peso(card.collect)} cash on delivery
        </div>
      )}

      {card.note && lane !== "road" && (
        <p className="flex gap-1.5 rounded-lg bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-950">
          <StickyNote className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span className="line-clamp-2">{card.note}</span>
        </p>
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps a button's click off the card */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside have their own keys */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** Who has the order in hand, so two people don't pack the same one. */
function TakeButton({
  card,
  mine,
  busy,
  onTake,
}: {
  card: DispatchCard;
  mine: boolean;
  busy: boolean;
  onTake: (release: boolean) => void;
}) {
  if (mine)
    return (
      <span className="ml-auto inline-flex items-center gap-1 text-[11px]">
        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-800 ring-1 ring-sky-200">
          You have it
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onTake(true)}
          className="font-medium text-slate-500 hover:text-slate-900"
        >
          Let go
        </button>
      </span>
    );
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-[11px]">
      {card.dispatchBy && <span className="text-slate-500">{card.dispatchBy} has it</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => onTake(false)}
        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      >
        {card.dispatchBy ? "Take over" : "Take it"}
      </button>
    </span>
  );
}
