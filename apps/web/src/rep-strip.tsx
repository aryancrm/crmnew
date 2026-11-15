// Who the listed work is from: one chip per MedRep with how many they have in the list, so
// Management can tell the many MedReps' work apart and pick one to see only theirs. The
// Orders boards and the customer lists draw it under their search.

import { avatarTone, initials } from "./look";
import { count } from "./ui";

export type StripRep = {
  id: number;
  name: string;
  channel: string | null;
  area: string | null;
  count: number;
  /** What the chip says on hover, beyond who it is. */
  more?: string;
};

export function RepStrip({
  reps,
  everyone = [],
  picked,
  total,
  noun,
  onPick,
}: {
  reps: StripRep[];
  /** Everyone who could be picked, to name a picked MedRep who has nothing in this list. */
  everyone?: { id: number; name: string }[];
  /** The picked MedRep's id, "" for everyone. */
  picked: string;
  /** How many the list holds for everyone. */
  total: number;
  /** "order" or "customer", for the hover text. */
  noun: string;
  onPick: (id: string) => void;
}) {
  const pickedId = Number(picked) || 0;
  // A MedRep picked who has nothing here still shows, at 0, so the pick can be undone.
  const shown: StripRep[] =
    pickedId && !reps.some((rep) => rep.id === pickedId)
      ? [
          ...reps,
          {
            id: pickedId,
            name: everyone.find((one) => one.id === pickedId)?.name ?? "MedRep",
            channel: null,
            area: null,
            count: 0,
          },
        ]
      : reps;
  if (shown.length === 0) return null;
  const sum = reps.reduce((all, rep) => all + rep.count, 0);
  const chip = (on: boolean) =>
    `inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border pr-2.5 pl-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
      on
        ? "border-slate-300 bg-white text-slate-900 shadow-sm ring-2 ring-brand/20"
        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
    }`;
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">By MedRep</legend>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        <button
          type="button"
          aria-pressed={!pickedId}
          onClick={() => onPick("")}
          className={`${chip(!pickedId)} pl-2.5`}
        >
          <span className="font-semibold">Every MedRep</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 tabular-nums">
            {count(pickedId ? sum : total)}
          </span>
        </button>
        {shown.map((rep) => {
          const on = rep.id === pickedId;
          return (
            <button
              key={rep.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? "" : String(rep.id))}
              title={`${rep.name}${rep.channel ? ` · ${rep.channel}` : ""}${rep.area ? ` · ${rep.area}` : ""}: ${rep.count} ${rep.count === 1 ? noun : `${noun}s`}${rep.more ? `, ${rep.more}` : ""}`}
              className={chip(on)}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${avatarTone(rep.name)}`}
              >
                {initials(rep.name)}
              </span>
              <span className="max-w-[9rem] truncate font-semibold">{rep.name}</span>
              {rep.channel && (
                <span className="rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500">
                  {rep.channel}
                </span>
              )}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${on ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {count(rep.count)}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
