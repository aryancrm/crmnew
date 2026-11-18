// The hub's team switch (Aryan, 17 Nov, from Subir Dey's hub page): one row at the top of a lead's
// team page — All · each team under them, by its lead ("B2B Telesales · Jessa Domino") — and one
// press turns the whole page to that team. A team with teams of its own opens the next row
// (B2B Telesales › CRR, NBD). Read from the chart (the same boxes as the sidebar), kept in the
// address (?unit=), so the dates and the rest of the page stay as they were. On every lead page
// (Aryan, 19 Nov): My team, Scorecards, Targets, Sales performance, Collections, Team orders,
// Calls, Visits, Who's working; a lead of two teams has both, "All" both together.

import type { OrgMenuUnit } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

/** The box picked on the team switch (?unit=), to send with the page's own reads: the server
 *  counts that box and every box under it (org/scope.ts). */
export function useTeamUnit(): string | null {
  const [params] = useSearchParams();
  return params.get("unit");
}

/** A read's address with the box picked on the team switch added. */
export function withUnit(path: string, unit: string | null): string {
  if (!unit) return path;
  return `${path}${path.includes("?") ? "&" : "?"}unit=${encodeURIComponent(unit)}`;
}

export function TeamSwitch({ wholeLabel = "All" }: { wholeLabel?: string }) {
  const query = useQuery({
    queryKey: ["org", "menu"],
    queryFn: () => api<{ units: OrgMenuUnit[]; openRequests: number; whole?: boolean }>("/api/org/menu"),
    staleTime: 5 * 60_000,
  });
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const units = query.data?.units ?? [];
  if (units.length < 2) return null;
  const picked = Number(params.get("unit")) || null;
  const byId = new Map(units.map((one) => [one.id, one]));
  const childrenOf = (id: number | null) =>
    units.filter((one) => (id === null ? one.level === 0 : one.parentId === id && one.level > 0));
  const tops = childrenOf(null);
  // A lead with one box: All is that box, its teams the first row. The CEO: All is the company.
  const root = tops.length === 1 ? (tops[0] as OrgMenuUnit) : null;
  // The boxes from the top down to the one picked.
  const chain: OrgMenuUnit[] = [];
  for (let at = picked ? byId.get(picked) : undefined; at; at = at.parentId ? byId.get(at.parentId) : undefined)
    chain.unshift(at);
  const go = (unit: number | null) => {
    const next = new URLSearchParams(params);
    if (unit === null || unit === root?.id) next.delete("unit");
    else next.set("unit", String(unit));
    navigate(`${location.pathname}${next.size ? `?${next}` : ""}`);
  };
  // One row per level that has teams: the first under the lead (or the company), then under each
  // box picked on the way down.
  const rows: { owner: OrgMenuUnit | null; teams: OrgMenuUnit[] }[] = [];
  const first = root ? childrenOf(root.id) : tops;
  if (first.length) rows.push({ owner: root, teams: first });
  for (const box of chain) {
    if (box.id === root?.id) continue;
    const under = childrenOf(box.id);
    if (under.length) rows.push({ owner: box, teams: under });
  }
  const active = (id: number | null) =>
    id === null ? !picked || picked === root?.id : chain.some((one) => one.id === id);
  const chip = (key: string, label: string, people: number, on: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${on ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {label} <span className="ml-0.5 tabular-nums opacity-75">({people})</span>
    </button>
  );
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Pick a team">
      {rows.map((row, n) => (
        <div
          key={row.owner?.id ?? "top"}
          className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
        >
          {n === 0
            ? chip(
                "all",
                // A lead of two teams (Honey: RX Business, MD Telesales): All is both.
                root ? `${wholeLabel} · ${root.name}` : query.data?.whole ? `${wholeLabel} · the company` : `${wholeLabel} · my ${tops.length} teams`,
                root?.people ?? tops.reduce((sum, one) => sum + one.people, 0),
                active(null),
                () => go(null),
              )
            : row.owner &&
              chip(
                `all-${row.owner.id}`,
                `All of ${row.owner.name}`,
                row.owner.people,
                picked === row.owner.id,
                () => go(row.owner?.id ?? null),
              )}
          {row.teams.map((team) =>
            chip(
              String(team.id),
              team.lead ? `${team.name} · ${team.lead}` : team.name,
              team.people,
              active(team.id) && !(n > 0 && picked === row.owner?.id),
              () => go(team.id),
            ),
          )}
        </div>
      ))}
    </div>
  );
}
