// HR's list of positions: what a record may say as someone's position, so a typo never becomes a
// new job title. HR and the Admin add and archive (never delete); the CEO reads.

import type { HrPositions } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { FIELD } from "../org/dialogs";
import { Button, CARD, PageHead, PageState, Problem, useAction } from "../ui";

export function HrPositionsPage() {
  const queries = useQueryClient();
  const query = useQuery({
    queryKey: ["hr", "positions"],
    queryFn: () => api<HrPositions>("/api/hr/positions"),
  });
  const add = useAction();
  const toggle = useAction();
  const [name, setName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const data = query.data;
  if (!data) return <PageState query={query} what="the positions" />;
  const kept = data.positions.filter((one) => !one.archived);
  const archived = data.positions.filter((one) => one.archived);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await add.run(() => api("/api/hr/positions", { body: { name } }))) {
      setName("");
      await queries.invalidateQueries({ queryKey: ["hr", "positions"] });
    }
  }
  async function setArchived(id: number, value: boolean) {
    if (await toggle.run(() => api(`/api/hr/positions/${id}`, { body: { archived: value } })))
      await queries.invalidateQueries({ queryKey: ["hr", "positions"] });
  }
  const row = (one: HrPositions["positions"][number]) => (
    <li key={one.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span className={one.archived ? "text-slate-500" : "text-slate-900"}>{one.name}</span>
      <span className="flex items-center gap-3">
        <span className="text-xs text-slate-500 tabular-nums">
          {one.people === 0 ? "Nobody" : one.people === 1 ? "1 person" : `${one.people} people`}
        </span>
        {data.can.change && (
          <Button small disabled={toggle.busy} onClick={() => setArchived(one.id, !one.archived)}>
            {one.archived ? "Bring back" : "Archive"}
          </Button>
        )}
      </span>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Positions"
        sub="What a record may say as someone's position. Archived ones aren't offered any more; records that say them keep them."
      />
      {data.can.change && (
        <form onSubmit={submit} className={`${CARD} flex flex-wrap items-start gap-2 p-4`}>
          <label className="min-w-56 flex-1">
            <span className="sr-only">New position</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={FIELD}
              placeholder="New position, like Hospital CHC"
              maxLength={80}
            />
          </label>
          <Button type="submit" variant="primary" disabled={add.busy || !name.trim()}>
            <Plus size={15} /> Add
          </Button>
          <div className="basis-full">
            <Problem message={add.problem?.message} />
          </div>
        </form>
      )}
      <Problem message={toggle.problem?.message} />
      <section className={`${CARD} overflow-hidden`}>
        <div className="flex min-h-11 items-center justify-between border-b border-slate-100 px-4 py-2">
          <h2 className="text-sm font-semibold text-slate-900">In use ({kept.length})</h2>
        </div>
        <ul className="divide-y divide-slate-100">{kept.map(row)}</ul>
        {archived.length > 0 && (
          <div className="border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              {showArchived ? "Hide" : "Show"} {archived.length} archived
            </button>
            {showArchived && <ul className="divide-y divide-slate-100 bg-slate-50/60">{archived.map(row)}</ul>}
          </div>
        )}
      </section>
    </div>
  );
}
