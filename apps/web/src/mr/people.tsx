// The MR App's people (docs/PLAN.md 22): its MRs and its one team lead. The Admin (or the CEO)
// names the team lead; the lead adds and takes out MRs. Taking someone out keeps their work.
// And the map: each MR's places today (start, check-ins, closes, stop), from the phone at those
// moments only.

import type { MemberPage } from "@2mg/api/mr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, CARD, PageState, Problem, useAction } from "../ui";
import { clockOf, dayWords, FIELD, MrHead, mapLink } from "./parts";

export function MrPeoplePage() {
  const queries = useQueryClient();
  const action = useAction();
  const query = useQuery({ queryKey: ["mr", "members"], queryFn: () => api<MemberPage>("/api/mr/members") });
  const [find, setFind] = useState("");
  const [person, setPerson] = useState<number | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the app's people" />;
  const words = find.trim().toLowerCase();
  const found = words ? data.candidates.filter((one) => one.name.toLowerCase().includes(words)).slice(0, 8) : [];
  const add = (role: "mr" | "lead") =>
    action.run(async () => {
      await api("/api/mr/members", { body: { personId: person, role } });
      setPerson(null);
      setFind("");
      await queries.invalidateQueries({ queryKey: ["mr"] });
    });
  const lead = data.members.find((one) => one.role === "lead" && one.active);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <MrHead title="The app's people" back="/mr" sub={`Team lead: ${lead?.name ?? "none yet"} · ${data.members.filter((one) => one.active && one.role === "mr").length} MR(s)`} />
      {(data.can.manage || data.can.setLead) && (
        <section className={`${CARD} flex flex-col gap-2 p-4`}>
          <h2 className="text-sm font-bold">Add someone</h2>
          <input className={FIELD} value={find} onChange={(event) => { setFind(event.target.value); setPerson(null); }} placeholder="Find a person by name" />
          {found.map((one) => (
            <button key={one.id} type="button" onClick={() => { setPerson(one.id); setFind(one.name); }} className={`rounded-lg px-3 py-2 text-left text-sm ${person === one.id ? "bg-sky-50 font-semibold" : "hover:bg-slate-50"}`}>
              {one.name} <span className="text-xs text-slate-500">{one.title}</span>
            </button>
          ))}
          <div className="flex gap-2">
            {data.can.manage && <Button small variant="primary" disabled={!person || action.busy} onClick={() => add("mr")}>Add as MR</Button>}
            {data.can.setLead && <Button small disabled={!person || action.busy} onClick={() => add("lead")}>Make team lead</Button>}
          </div>
          <Problem message={action.problem?.message} />
        </section>
      )}
      <ul className={`${CARD} divide-y divide-slate-100`}>
        {data.members.map((one) => (
          <li key={one.personId} className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${one.active ? "" : "opacity-50"}`}>
            <span className="min-w-0">
              <b>{one.name}</b> <span className="text-xs text-slate-500">{one.title}</span>
              <span className="block text-xs text-slate-500">
                {one.role === "lead" ? "Team lead" : "MR"} · {one.clients} clients · since {dayWords(one.addedAt.slice(0, 10))}
                {one.active ? "" : " · out of the app"}
              </span>
            </span>
            {one.active && ((one.role === "mr" && data.can.manage) || (one.role === "lead" && data.can.setLead)) && (
              <Button
                small
                variant="quiet"
                disabled={action.busy}
                onClick={() =>
                  action.run(async () => {
                    await api(`/api/mr/members/${one.personId}/remove`, { body: {} });
                    await queries.invalidateQueries({ queryKey: ["mr"] });
                  })
                }
              >
                Take out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const query = useQuery({ queryKey: ["mr", "map", person], queryFn: () => api<MapPeople>(`/api/mr/map${person ? `?person=${person}` : ""}`) });
  const data = query.data;
  if (!data) return <PageState query={query} what="the places" />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <MrHead title={person ? "Location on map" : "All on map"} back="/mr" sub={`${dayWords(data.day)} · places taken at start, I'm here, close and stop`} />
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
      {data.people.length === 0 && <div className={`${CARD} px-4 py-8 text-center text-sm text-slate-500`}>Nobody in the app yet.</div>}
    </div>
  );
}
