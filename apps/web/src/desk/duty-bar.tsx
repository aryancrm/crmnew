// Management's or Finance's team on its screen (Aryan, 18 Nov): every waiting order is given to one
// of the desk's people automatically (fewest open first, someone on leave skipped) and names them
// on its card; here, each person with what they have open and have done today, and "Everyone's" or
// "Mine" for the cards below. Anyone can still take an order over on its card.

import type { DeskDuty } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useEffect } from "react";
import { api } from "../api";

export function DutyBar({
  desk,
  mine,
  onMine,
}: {
  desk: "management" | "finance";
  /** Showing only one's own orders. */
  mine: boolean;
  onMine: (mine: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ["desk", desk, "team"],
    queryFn: () => api<DeskDuty>(`/api/desk/${desk}/team`),
    refetchInterval: 60_000,
  });
  const team = query.data;
  // Orders just given out (opening the screen shares out what waits): the cards show their names.
  const queries = useQueryClient();
  const given = team?.people.map((one) => one.open).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the counts changing only
  useEffect(() => {
    if (given !== undefined) void queries.invalidateQueries({ queryKey: ["orders"] });
  }, [given]);
  if (!team) return null;

  return (
    <section aria-label="The team" className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-brand" aria-hidden="true" />
          <span className="text-[14px] font-semibold text-slate-900">The team</span>
          <span className="text-[12px] text-slate-500">
            each order goes to one of you automatically · {team.waiting} waiting
            {team.unassigned ? ` · ${team.unassigned} not given yet` : ""}
          </span>
        </div>
        {team.mine && (
          <span className="ml-auto flex rounded-lg border border-slate-200 p-0.5 text-[12px] font-semibold" role="group" aria-label="Show">
            {(
              [
                [false, "Everyone's"],
                [true, "Mine"],
              ] as const
            ).map(([value, word]) => (
              <button
                key={word}
                type="button"
                aria-pressed={mine === value}
                onClick={() => onMine(value)}
                className={`rounded-md px-2.5 py-1 ${mine === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {word}
              </button>
            ))}
          </span>
        )}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {team.people.map((one) => (
          <li
            key={one.id}
            className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] ${one.away ? "border-slate-200 bg-slate-50 text-slate-500" : "border-emerald-200 bg-emerald-50"}`}
          >
            <span className={`size-2 rounded-full ${one.away ? "bg-slate-300" : "bg-emerald-500"}`} aria-hidden="true" />
            <span className="font-semibold text-slate-800">{one.name}</span>
            <span className="tabular-nums">{one.away ? "on leave" : `${one.open} open · ${one.doneToday} done today`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
