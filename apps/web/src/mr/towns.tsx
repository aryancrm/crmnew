// The day's town, picked not typed (Aryan, 23 Nov): every city and municipality of the Philippines
// with its province (public/places/ph-towns.json, from the PSGC), searched as one types two
// letters. The towns the MedRep's own customers are in, and the tour plan's, come first as one-tap
// pills. A place not on the list can still be kept as typed, so nobody is ever stuck.

import { townKey } from "@2mg/api/mr";
import { useQuery } from "@tanstack/react-query";
import { MapPin, X } from "lucide-react";
import { useMemo, useState } from "react";
import { FIELD } from "./parts";

export type Town = [name: string, province: string, city: 0 | 1];

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function useTowns() {
  return useQuery({
    queryKey: ["ph-towns"],
    queryFn: async () => {
      const got = await fetch("/places/ph-towns.json");
      if (!got.ok) throw new Error("The list of towns didn't load.");
      return ((await got.json()) as { towns: Town[] }).towns;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function TownPicker({
  value,
  onChange,
  suggested = [],
  many = true,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Towns to offer first (the tour plan's, the customers'). */
  suggested?: string[];
  many?: boolean;
}) {
  const towns = useTowns();
  const [typed, setTyped] = useState("");
  // A name in several provinces (San Jose, San Fernando…) is kept with its province.
  const repeated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const [name] of towns.data ?? []) seen.set(name, (seen.get(name) ?? 0) + 1);
    return seen;
  }, [towns.data]);
  const kept = (town: Town) => ((repeated.get(town[0]) ?? 0) > 1 ? `${town[0]}, ${town[1]}` : town[0]);
  const has = (name: string) => value.some((one) => townKey(one) === townKey(name) && (one.includes(",") ? one === name : true));
  const add = (name: string) => {
    setTyped("");
    if (has(name)) return;
    onChange(many ? [...value, name] : [name]);
  };
  const find = plain(typed);
  const found = useMemo(() => {
    if (find.length < 2) return [];
    const starts: Town[] = [];
    const within: Town[] = [];
    const inProvince: Town[] = [];
    for (const town of towns.data ?? []) {
      const name = plain(town[0]);
      if (name.startsWith(find)) starts.push(town);
      else if (name.includes(find)) within.push(town);
      else if (plain(town[1]).startsWith(find)) inProvince.push(town);
    }
    // Among towns of one name, the city first (San Fernando City before the five San Fernandos).
    starts.sort((a, b) => b[2] - a[2]);
    return [...starts, ...within, ...inProvince].slice(0, 8);
  }, [find, towns.data]);
  const offer = [...new Set(suggested)].filter((one) => !has(one)).slice(0, 10);
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((one) => (
            <span key={one} className="inline-flex items-center gap-1 rounded-full bg-sky-600 py-1.5 pr-1.5 pl-3 text-[13px] font-semibold text-white">
              <MapPin size={13} /> {one}
              <button type="button" aria-label={`Remove ${one}`} onClick={() => onChange(value.filter((v) => v !== one))} className="grid size-5 place-items-center rounded-full hover:bg-white/20">
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      {offer.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {offer.map((one) => (
            <button key={one} type="button" onClick={() => add(one)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:border-sky-400">
              {one}
            </button>
          ))}
        </div>
      )}
      <input
        className={FIELD}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        placeholder={value.length && many ? "Add another town: type two letters" : "Search any town or city: type two letters"}
        aria-label="Search a town or city"
      />
      {find.length >= 2 && (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {found.map((town) => (
            <li key={`${town[0]}|${town[1]}`} className="border-b border-slate-100 last:border-0">
              <button type="button" onClick={() => add(kept(town))} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-sky-50">
                <span className="font-semibold text-slate-800">{town[0]}</span>
                <span className="shrink-0 text-xs text-slate-500">{town[1]}</span>
              </button>
            </li>
          ))}
          {towns.isSuccess && found.length === 0 && (
            <li>
              <button type="button" onClick={() => add(typed.trim())} className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-sky-50">
                Not on the list. Keep <b>{typed.trim()}</b> as typed
              </button>
            </li>
          )}
          {towns.isError && (
            <li>
              <button type="button" onClick={() => add(typed.trim())} className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-sky-50">
                The list didn't load. Keep <b>{typed.trim()}</b> as typed
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
