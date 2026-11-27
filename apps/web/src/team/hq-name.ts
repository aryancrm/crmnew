// An HQ's name in a word (Aryan, 27-28 Nov: "the main thing is the Headquarter"; PLAN 257, 264-265),
// as the server names it (apps/api/src/team/hq-name.ts): the territory's last part that isn't the
// person's own name ("RX | TAFT" → TAFT), ON SITE when there is none. Never the territory's whole
// name ("RX | TAFT" is the Zoho-era name: "we are ending Zoho").

import type { TeamHqs } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";

const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

export const ON_SITE = "ON SITE";

export function hqName(area: string | null, person: string | null): string {
  const own = person ? plain(person) : null;
  const parts = (area ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && plain(part) !== own);
  if (parts.some((part) => plain(part) === "on site")) return ON_SITE;
  return parts.length > 1 ? (parts[parts.length - 1] as string) : ON_SITE;
}

/** A seat's HQ: a selling seat's, from its territory; none for a lead's seat or a seat with no
 *  territory (those show their person). */
export function hqOfSeat(seat: { lead?: boolean; area: { name: string } | null; person: { name: string } | null }): string | null {
  if (seat.lead || !seat.area) return null;
  return hqName(seat.area.name, seat.person?.name ?? null);
}

/** "TAFT · Marwin Dy": a person's name after their HQ, or the name alone. */
export const withHq = (hq: string | null | undefined, name: string) => (hq ? `${hq} · ${name}` : name);

/** Each person's HQ in the team in view, read once (PLAN 269): `named(id, name)` gives
 *  "TAFT · Marwin Dy", the name alone for someone with no HQ (a lead). */
export function useHqNames(): { hqOf: (personId: number | null | undefined) => string | null; named: (personId: number | null | undefined, name: string) => string } {
  const query = useQuery({ queryKey: ["team", "hqs"], queryFn: () => api<TeamHqs>("/api/team/hqs"), staleTime: 5 * 60_000 });
  return useMemo(() => {
    const byPerson = new Map((query.data?.people ?? []).map((one) => [one.personId, one.hq]));
    const hqOf = (personId: number | null | undefined) => (personId ? (byPerson.get(personId) ?? null) : null);
    return { hqOf, named: (personId, name) => withHq(hqOf(personId), name) };
  }, [query.data]);
}
