// The day's places on the map (docs/PLAN.md 22): each field person's places today (start, I'm here,
// close, stop), taken from the phone at those moments only. A team lead sees their team (the team
// switch narrows it), the head and the CEO everyone under them.

import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TeamSwitch, useTeamUnit, withUnit } from "../team/switch";
import { CARD, PageState } from "../ui";
import { clockOf, dayWords, MrHead, mapLink } from "./parts";

type MapPeople = {
  day: string;
  people: {
    id: number;
    name: string;
    points: { at: string; what: string; place: string; client: string | null }[];
  }[];
};

export function MrMapPage() {
  const [params] = useSearchParams();
  const person = params.get("person");
  const unit = useTeamUnit();
  const query = useQuery({
    queryKey: ["mr", "map", person, unit],
    queryFn: () => api<MapPeople>(withUnit(`/api/mr/map${person ? `?person=${person}` : ""}`, unit)),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the places" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title={person ? "Location on map" : "Team on the map"} sub={`${dayWords(data.day)} · places taken at start, I'm here, close and stop`} />
      {!person && <TeamSwitch />}
      {data.people.map((one) => {
        const last = one.points[one.points.length - 1];
        return (
          <section key={one.id} className={`${CARD} p-4`}>
            <div className="flex items-center justify-between gap-2">
              <b>{one.name}</b>
              {last ? (
                <a href={mapLink(last.place)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700">
                  <MapPin size={14} /> Last: {clockOf(last.at)}
                </a>
              ) : (
                <span className="text-sm text-slate-400">No place today</span>
              )}
            </div>
            {one.points.length > 0 && (
              <ol className="mt-2 text-[13px] text-slate-700">
                {one.points.map((point) => (
                  <li key={`${point.at}-${point.what}`}>
                    {clockOf(point.at)} · {point.what}{point.client ? ` · ${point.client}` : ""} ·{" "}
                    <a className="text-sky-700 hover:underline" href={mapLink(point.place)} target="_blank" rel="noreferrer">map</a>
                  </li>
                ))}
              </ol>
            )}
            {one.points.length > 1 && (
              <a
                className="mt-2 inline-block text-xs font-semibold text-sky-700"
                target="_blank"
                rel="noreferrer"
                href={`https://www.google.com/maps/dir/${one.points.map((point) => point.place).join("/")}`}
              >
                The day's route on the map
              </a>
            )}
          </section>
        );
      })}
      {data.people.length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>Nobody in the field today.</div>}
    </div>
  );
}
