// Who is signed in. Asked once and kept; refreshed when the window is looked at again.

import type { Me } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { ApiFailure, api } from "./api";

export const ME = ["me"] as const;

/** `null` = nobody is signed in. A failure of any other kind stays an error. */
export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async (): Promise<Me | null> => {
      try {
        const me = (await api<{ me: Me }>("/api/me")).me;
        rememberPerson(me.id);
        return me;
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: (count, error) =>
      !(error instanceof ApiFailure && error.status < 500 && error.status !== 0) && count < 2,
  });
}

const LAST_PERSON = "bo:person";

/** The person last signed in on this browser. */
export function rememberPerson(id: number): void {
  try {
    localStorage.setItem(LAST_PERSON, String(id));
  } catch {
    // Storage blocked (a private window): every sign-in then starts at Home, nothing else changes.
  }
}

/** Where a sign-in returns to: the page that was open when the session ended, if it was this same
 *  person's; someone else starts at their own Home (Aryan, 19 Nov: after signing out, the next one
 *  landed on Leads & enquiries, the page the last one had open). */
export function returnTo(id: number, from: string): string {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_PERSON);
  } catch {
    return "/";
  }
  return last === null || last === String(id) ? from : "/";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}

/** The Online channel's MedRep works in the office: a MedRep who also works the Online desk. */
export const officeMedrep = (me: { role: string; channel?: { code: string } | null } | null | undefined) =>
  me?.role === "medrep" && me.channel?.code === "ONLINE";
/** Works the Online desk: its own desk role, or the Online channel's MedRep. */
export const onlineDesk = (me: { role: string; channel?: { code: string } | null } | null | undefined) =>
  me?.role === "online" || officeMedrep(me);
/** Sees the Online desk itself (Leads & enquiries, the Inbox): the desk, the CEO and the Admin, as
 *  the API's LEAD_DESK_ROLES. Management reads a case from its order (Aryan, 19 Nov). */
export const readsOnlineDesk = (me: { role: string; channel?: { code: string } | null } | null | undefined) =>
  onlineDesk(me) || me?.role === "admin" || me?.role === "ceo";
/** Places orders, as the API's ORDER_PLACE_ROLES: the field, the Online desk and the Admin. Not
 *  Management (Aryan, 19 Nov: "why would Management create an order?"), nor the CEO. */
export const placesOrders = (me: { role: string } | null | undefined) =>
  ["medrep", "team_lead", "manager", "online", "admin"].includes(me?.role ?? "");
