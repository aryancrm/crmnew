// The desk's people in the left menu of Management's (or Finance's) common screen (Aryan, 18 Nov):
// one screen for the whole desk; each person from the chart presses Start when they begin and Stop
// when they end. The waiting orders are shared out among the people started (fewest open first),
// and what is done on an order is written in its person's name. A name opens that person's page.

import type { DeskDuty } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAction } from "../ui";

const at = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

export function DeskPeople({ desk, onPick }: { desk: "management" | "finance" | "dispatch"; onPick?: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const navigate = useNavigate();
  const location = useLocation();
  // The person whose page is open is marked in the list.
  const who = Number(location.pathname.match(/^\/desk\/person\/(\d+)/)?.[1]) || 0;
  const query = useQuery({
    queryKey: ["desk", desk, "team"],
    queryFn: () => api<DeskDuty>(`/api/desk/${desk}/team`),
    refetchInterval: 60_000,
  });
  const team = query.data;
  // The ones started are listed; the rest open with a press (a long list stays short at the top).
  const [everyone, setEveryone] = useState(false);
  // When orders were just given out, the cards show their names.
  const given = team?.people.map((one) => `${one.id}:${one.open}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the counts changing only
  useEffect(() => {
    if (given !== undefined) void queries.invalidateQueries({ queryKey: ["orders"] });
  }, [given]);
  if (!team) return null;

  const start = (id: number, on: boolean) =>
    void action.run(async () => {
      await api(`/api/desk/${desk}/people/${id}/start`, { body: { on }, asPerson: on ? id : undefined });
      await queries.invalidateQueries({ queryKey: ["desk", desk] });
      await queries.invalidateQueries({ queryKey: ["orders"] });
    });

  return (
    <section aria-label="On the desk today" className="mx-3 mb-3 rounded-xl border border-slate-200 bg-white/80 p-1.5 shadow-2xs">
      <div className="flex items-center justify-between px-1.5 pt-0.5 pb-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          On the desk today · {team.people.filter((one) => one.startedAt).length} of {team.people.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {team.people.filter((one) => everyone || one.startedAt || !team.people.some((other) => other.startedAt)).map((one) => {
          const on = Boolean(one.startedAt);
          return (
            <li
              key={one.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${who === one.id ? "bg-white shadow-2xs ring-1 ring-slate-200" : "hover:bg-white/70"}`}
            >
              <button
                type="button"
                onClick={() => {
                  navigate(`/desk/person/${one.id}`);
                  onPick?.();
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={`${one.name}: what they have and what they did`}
              >
                <span className={`relative grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${on ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                  {one.name.slice(0, 1)}
                  {on && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-emerald-400 ring-2 ring-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-slate-800">{one.name}</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {on && one.startedAt ? `since ${at(one.startedAt)} · ${one.open} open` : "not started"}
                  </span>
                </span>
              </button>
              {team.canStart && (
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => start(one.id, !on)}
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${on ? "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                >
                  {on ? "Stop" : "Start"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {team.people.some((one) => one.startedAt) && team.people.some((one) => !one.startedAt) && (
        <button
          type="button"
          onClick={() => setEveryone(!everyone)}
          className="mt-0.5 w-full rounded-lg px-2 py-1 text-left text-[11.5px] font-semibold text-brand hover:bg-slate-50"
        >
          {everyone ? "Only those started" : `+ ${team.people.filter((one) => !one.startedAt).length} not started: Start someone`}
        </button>
      )}
      {action.problem && <p className="px-2 pt-1 text-[11px] text-rose-700">{action.problem.message}</p>}
    </section>
  );
}
