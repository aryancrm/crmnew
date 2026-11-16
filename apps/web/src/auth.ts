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
        return (await api<{ me: Me }>("/api/me")).me;
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
