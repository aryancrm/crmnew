// On a developer's own computer only (Aryan, 27 Nov: "on localhost let me straight in"): the
// company's people under the sign-in form; a click opens as that person, no password. The API has
// these routes only on such a computer (apps/api/src/auth/local-open.ts), and login.tsx shows this
// only under Vite's dev server (import.meta.hot, which no build has): online it never appears.

import type { Me } from "@2mg/api/types";
import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { type Workspace, workspaceOf } from "../workspaces";

type Person = { id: number; name: string; role: string; title: string | null; login: string | null };

export function LocalOpenList({ workspace, onOpened }: { workspace: Workspace | null; onOpened: (me: Me) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [find, setFind] = useState("");
  const [opening, setOpening] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let here = true;
    api<{ people: Person[] }>("/api/local/people")
      .then((answer) => here && setPeople(answer.people))
      .catch(() => here && setPeople(null));
    return () => {
      here = false;
    };
  }, []);

  if (!people) return null;
  const words = find.trim().toLowerCase();
  const shown = people
    .filter((one) => !workspace || workspace.roles.includes(one.role as Me["role"]))
    .filter((one) => !words || `${one.name} ${one.title ?? ""} ${one.login ?? ""}`.toLowerCase().includes(words));

  const open = async (one: Person) => {
    setOpening(one.id);
    setProblem(null);
    try {
      const answer = await api<{ me: Me }>(`/api/local/open/${one.id}`, {
        body: workspace ? { workspace: workspace.key } : {},
      });
      onOpened(answer.me);
    } catch {
      setProblem("Couldn't open. Try again.");
      setOpening(null);
    }
  };

  return (
    <section aria-label="Open as someone (this computer only)" className="mt-6 rounded-xl border border-amber-300 bg-amber-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[#1f2733]">Open as (this computer only, no password)</h2>
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">Local</span>
      </div>
      <label className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-[#d5d9e1] bg-white px-3 focus-within:border-[#f36b21]">
        <Search className="size-4 shrink-0 text-[#6b7380]" aria-hidden="true" />
        <input
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="Search name, seat or login ID"
          aria-label="Search people"
          autoComplete="off"
          className="min-w-0 flex-1 text-[13.5px] outline-none!"
        />
      </label>
      {problem && (
        <p role="alert" className="mt-2 text-[13px] text-rose-700">
          {problem}
        </p>
      )}
      <ul className="mt-2 max-h-[min(22rem,50dvh)] overflow-y-auto">
        {shown.map((one) => (
          <li key={one.id}>
            <button
              type="button"
              disabled={opening !== null}
              onClick={() => void open(one)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white focus-visible:bg-white focus-visible:outline-2 focus-visible:outline-[#f36b21] disabled:cursor-wait"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-[#1f2733]">{one.name}</span>
                <span className="block truncate text-[12px] text-[#5b6472]">
                  {[one.title, one.login, workspace ? null : workspaceOf({ role: one.role as Me["role"] }).label].filter(Boolean).join(" · ")}
                </span>
              </span>
              {opening === one.id && <LoaderCircle className="size-4 shrink-0 animate-spin text-[#6b7380]" aria-hidden="true" />}
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-2 text-[13px] text-[#5b6472]">Nobody here by that name.</li>}
      </ul>
    </section>
  );
}
