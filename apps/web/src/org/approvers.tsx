// Who approves what (the hub's Management (Approval) → Edit access): each Management person
// approves every division, or only the ones ticked. Their piles and queue then hold only those
// orders, and approving another division's order is refused. Set by the CEO or the Admin.

import type { Approvers } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Button, CARD, PageState, Problem, useAction } from "../ui";

export function ApproversTab() {
  const query = useQuery({
    queryKey: ["org", "approvers"],
    queryFn: () => api<Approvers>("/api/org/approvers"),
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="who approves what" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-slate-600">
        Each Management person approves every division, or only the ones ticked: their piles hold
        only those orders, and another division's order can't be approved by them. An order with
        no division is for those who approve everything.
      </p>
      {data.people.length === 0 ? (
        <div className={`${CARD} p-5 text-sm text-slate-500`}>No one in Management yet.</div>
      ) : (
        data.people.map((person) => (
          <ApproverRow key={person.id} person={person} divisions={data.divisions} />
        ))
      )}
    </div>
  );
}

function ApproverRow({
  person,
  divisions,
}: {
  person: Approvers["people"][number];
  divisions: string[];
}) {
  const [all, setAll] = useState(person.approves === null);
  const [picked, setPicked] = useState<string[]>(person.approves ?? []);
  const action = useAction();
  const queries = useQueryClient();
  const changed =
    all !== (person.approves === null) ||
    (!all && [...picked].sort().join() !== [...(person.approves ?? [])].sort().join());
  async function save() {
    if (
      await action.run(async () => {
        await api(`/api/org/approvers/${person.id}`, { body: { approves: all ? null : picked } });
      })
    )
      await queries.invalidateQueries({ queryKey: ["org", "approvers"] });
  }
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <b className="text-slate-900">{person.name}</b>
          <span className="text-[13px] text-slate-500">
            {" "}
            · {person.title ?? "Management"}
            {person.unit ? ` · ${person.unit}` : ""}
          </span>
        </div>
        <span className="text-[12px] font-semibold text-slate-600">
          {person.approves === null
            ? "Approves every division"
            : person.approves.length === 0
              ? "Approves nothing"
              : `Approves ${person.approves.join(", ")}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 text-[13px]">
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" checked={all} onChange={() => setAll(true)} className="accent-emerald-600" />
          Every division
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" checked={!all} onChange={() => setAll(false)} className="accent-emerald-600" />
          Only these
        </label>
      </div>
      {!all && (
        <div className="flex flex-wrap gap-1.5">
          {divisions.map((division) => {
            const on = picked.includes(division);
            return (
              <button
                key={division}
                type="button"
                onClick={() =>
                  setPicked(on ? picked.filter((one) => one !== division) : [...picked, division])
                }
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                {division}
              </button>
            );
          })}
        </div>
      )}
      <Problem message={action.problem?.message} />
      {changed && (
        <div>
          <Button small variant="primary" onClick={save} disabled={action.busy}>
            {action.busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </section>
  );
}
