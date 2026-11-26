// Which company this browser works in, when Bishnoi One's server has several (Aryan, 26 Nov 2026):
// its short code is shown beside Bishnoi One's name, so nobody works in one company thinking it is
// the other. Null with one company on the server, as before: then nothing is shown.

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type CompanyName = { orgId: string; name: string; code: string; loginDomain: string };

export function useCompany(): CompanyName | null {
  const found = useQuery({
    queryKey: ["company"],
    queryFn: () => api<{ company: CompanyName | null }>("/api/company"),
    // Asked again whenever the frame opens: a sign-in may have been to another company.
    staleTime: 0,
  });
  return found.data?.company ?? null;
}

/** The company's own name on screens: one company per database since the separation (Aryan, 26 Nov
 *  night: "everything separate"), so never a list of the group's companies ("2MG Inc." with one). */
export const useOwnCompanyName = (): string => useCompany()?.name ?? "2MG Inc.";
/** Its short code (2MG, GM). */
export const useOwnCompanyCode = (): string => useCompany()?.code ?? "2MG";
