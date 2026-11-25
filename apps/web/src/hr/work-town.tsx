// A person's work town on their HR record, picked from the CRM's town list (with its province):
// their local holidays follow it (docs/HR-PLAN.md step 4).

import { MapPin, X } from "lucide-react";
import { useMemo, useState } from "react";
import { type Town, useTowns } from "../mr/towns";
import { FIELD } from "../org/dialogs";

export type WorkTown = { town: string; province: string } | null;

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function WorkTownPicker({
  value,
  onChange,
}: {
  value: WorkTown;
  onChange: (next: WorkTown) => void;
}) {
  const towns = useTowns();
  const [typed, setTyped] = useState("");
  const find = plain(typed);
  const found = useMemo(() => {
    if (find.length < 2) return [];
    const starts: Town[] = [];
    const within: Town[] = [];
    for (const town of towns.data ?? []) {
      const name = plain(town[0]);
      if (name.startsWith(find)) starts.push(town);
      else if (name.includes(find) || plain(town[1]).startsWith(find)) within.push(town);
    }
    starts.sort((a, b) => b[2] - a[2]);
    return [...starts, ...within].slice(0, 8);
  }, [find, towns.data]);
  if (value)
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-sky-600 py-1.5 pr-1.5 pl-3 text-[13px] font-semibold text-white">
        <MapPin size={13} /> {value.town}, {value.province}
        <button
          type="button"
          aria-label="Clear the work town"
          onClick={() => onChange(null)}
          className="grid size-5 place-items-center rounded-full hover:bg-white/20"
        >
          <X size={13} />
        </button>
      </span>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <input
        className={FIELD}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder="Search a town or city: type two letters"
        aria-label="Search the work town"
      />
      {towns.isError && <span className="text-xs text-rose-700">The list of towns didn't load.</span>}
      {find.length >= 2 && (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {found.map((town) => (
            <li key={`${town[0]}|${town[1]}`} className="border-b border-slate-100 last:border-0">
              <button
                type="button"
                onClick={() => {
                  setTyped("");
                  onChange({ town: town[0], province: town[1] });
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-sky-50"
              >
                <span className="font-semibold text-slate-800">{town[0]}</span>
                <span className="shrink-0 text-xs text-slate-500">{town[1]}</span>
              </button>
            </li>
          ))}
          {towns.isSuccess && found.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">No town by that name.</li>
          )}
        </ul>
      )}
    </div>
  );
}
