// An office team that neither sells nor moves orders (IT, HR, Digital Marketing, Regulatory, the
// Executive office) is shown by its own work (Aryan, 19 Nov: "why order moves in the IT Division? IT
// does IT's work, and a little co-selling"): each person in the box with what they wrote in their
// work log on the day picked. Whatever they co-sell shows as sales, as for any team.

import type { WorkLogDay } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { NotebookPen } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { withUnit } from "./switch";

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm";

export function OfficeWork({ unit, people }: { unit: string | null; people: { id: number; name: string; title: string | null }[] }) {
  const [day, setDay] = useState("");
  const query = useQuery({
    queryKey: ["work-log", "day", day, unit],
    queryFn: () => api<WorkLogDay>(withUnit(`/api/work-log/day${day ? `?day=${day}` : ""}`, unit)),
  });
  const data = query.data;
  const byPerson = new Map((data?.entries ?? []).map((one) => [one.personId, one]));
  const wrote = people.filter((one) => byPerson.has(one.id)).length;
  return (
    <section className={CARD} aria-label="The team's work">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <NotebookPen className="size-4 text-slate-400" aria-hidden="true" /> The team's work
          <span className="font-normal text-slate-500">
            · {wrote} of {people.length} wrote their work log
          </span>
        </h2>
        {data && (
          <input type="date" className="field h-9 !w-40" value={data.day} max={data.today} onChange={(event) => setDay(event.target.value)} aria-label="Day" />
        )}
      </div>
      {!data ? (
        <p className="p-4 text-sm text-slate-500">{query.isError ? "Couldn't read the work logs." : "Reading the work logs…"}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {people.map((one) => {
            const log = byPerson.get(one.id);
            return (
              <li key={one.id} className="grid gap-1 px-4 py-2.5 text-[13px] sm:grid-cols-[14rem_1fr]">
                <div>
                  <div className="font-semibold text-slate-900">{one.name}</div>
                  <div className="text-[11.5px] text-slate-500">{one.title}</div>
                </div>
                {log ? (
                  <div className="space-y-0.5 text-slate-700">
                    {log.done && (
                      <p>
                        <b className="text-slate-500">Done:</b> {log.done}
                      </p>
                    )}
                    {log.today && (
                      <p>
                        <b className="text-slate-500">Working on:</b> {log.today}
                      </p>
                    )}
                    {log.tomorrow && (
                      <p>
                        <b className="text-slate-500">Next:</b> {log.tomorrow}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-400">No work log written.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
