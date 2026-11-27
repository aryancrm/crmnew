// Where the team is now: each field person's last place from their phone while their working day
// runs (a team lead's team, everyone for the CEO), the visit they are at, and a link to the map.
// A place older than half an hour, or from a day already ended, isn't shown as where they are.
// Today's places are here too (Aryan, 28 Nov: "are this many pages needed? how many repeat?",
// PLAN 270): under each person, the day's places (start, I'm here, close, stop) and its route, as
// the separate Today's places page had them.

import type { LivePeople } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, NoResults } from "../no-results";
import type { MapPeople } from "../mr/map";
import { clockOf, mapLink } from "../mr/parts";
import { useHqNames } from "../team/hq-name";
import { CARD, PageHead, PageState } from "../ui";

const ago = (iso: string | null) => {
  if (!iso) return null;
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
};

export function FieldLivePage() {
  const query = useQuery({
    queryKey: ["field", "live"],
    queryFn: () => api<LivePeople>("/api/field/where"),
    refetchInterval: 60_000,
  });
  // The day's places of each person (the phone's at start, I'm here, close and stop).
  const places = useQuery({ queryKey: ["mr", "map", null, null], queryFn: () => api<MapPeople>("/api/mr/map"), refetchInterval: 60_000 });
  const dayOf = new Map((places.data?.people ?? []).map((one) => [one.id, one.points]));
  // Each person after their HQ (Aryan's phase 5, PLAN 269); found by it too.
  const { named } = useHqNames();
  const [q, setQ] = useState("");
  const data = query.data;
  if (!data) return <PageState query={query} what="where the team is" />;
  const words = q.trim().toLowerCase();
  const rows = data.people
    .filter((one) => !words || `${named(one.personId, one.name)} ${one.team ?? ""}`.toLowerCase().includes(words))
    .sort(
      (a, b) => Number(Boolean(b.place)) - Number(Boolean(a.place)) || a.name.localeCompare(b.name),
    );
  const seen = data.people.filter((one) => one.place).length;
  const working = data.people.filter((one) => one.working).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Where the team is"
        sub={`${seen} of ${data.people.length} sharing a place now · ${working} working · each one's places today under them`}
      />
      <label className="relative flex max-w-xs items-center">
        <Search size={15} className="pointer-events-none absolute left-3 text-slate-400" />
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Find a person or team"
          className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm"
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((one) => (
          <article key={one.personId} className={`${CARD} flex flex-col gap-2 p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to={`/visits?person=${one.personId}`}
                  className="font-semibold text-slate-900 hover:text-emerald-700"
                >
                  {named(one.personId, one.name)}
                </Link>
                <div className="text-xs text-slate-500">{one.team ?? "No team"}</div>
              </div>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${
                  one.place
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : one.working
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : "bg-slate-100 text-slate-600 ring-slate-200"
                }`}
              >
                {one.place ? "Live" : one.working ? "Working · no place" : "Not working"}
              </span>
            </div>
            {one.atVisit && (
              <div className="text-[13px] text-slate-700">
                At <span className="font-semibold">{one.atVisit}</span>
              </div>
            )}
            {one.place ? (
              <a
                href={`https://www.google.com/maps?q=${one.place}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 hover:underline"
              >
                <MapPin size={14} /> Open on the map
                <span className="font-normal text-slate-500">
                  · {ago(one.at)}
                  {one.accuracyM ? ` · within ${one.accuracyM} m` : ""}
                </span>
              </a>
            ) : (
              <div className="text-xs text-slate-500">
                {one.at ? `Last place ${ago(one.at)}` : "No place shared yet"}
              </div>
            )}
            <TodaysPlaces points={dayOf.get(one.personId) ?? []} />
          </article>
        ))}
        {rows.length === 0 && (
          <div className={`${CARD} md:col-span-2 xl:col-span-3`}>
            {words ? (
              <NoResults title="Nobody here.">No one by that name or team. Try other words.</NoResults>
            ) : (
              <EmptyState title="Nobody here.">Each field person shows here with their last place while their day runs.</EmptyState>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        A phone shares its place every few minutes while its person's day is started and the app is
        open; it stops when they end their day.
      </p>
    </div>
  );
}

/** One person's places today: the time, what it was (start, I'm here, close, stop), the customer,
 *  each on the map, and the day's route when there are more. */
function TodaysPlaces({ points }: { points: MapPeople["people"][number]["points"] }) {
  if (!points.length) return <div className="border-t border-slate-100 pt-2 text-xs text-slate-400">No place today</div>;
  return (
    <div className="border-t border-slate-100 pt-2">
      <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Today's places</p>
      <ol className="mt-1 space-y-0.5 text-[12.5px] text-slate-700">
        {points.map((point) => (
          <li key={`${point.at}-${point.what}`}>
            {clockOf(point.at)} · {point.what}
            {point.client ? ` · ${point.client}` : ""} ·{" "}
            <a className="text-sky-700 hover:underline" href={mapLink(point.place)} target="_blank" rel="noreferrer">
              map
            </a>
          </li>
        ))}
      </ol>
      {points.length > 1 && (
        <a
          className="mt-1 inline-block text-xs font-semibold text-sky-700 hover:underline"
          target="_blank"
          rel="noreferrer"
          href={`https://www.google.com/maps/dir/${points.map((point) => point.place).join("/")}`}
        >
          The day's route on the map
        </a>
      )}
    </div>
  );
}
