// Which company this browser works in, when Bishnoi One's server has several (Aryan, 26 Nov 2026):
// its short code is shown beside Bishnoi One's name, so nobody works in one company thinking it is
// the other. Null with one company on the server, as before: then nothing is shown.

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type CompanyName = { orgId: string; name: string; code: string; loginDomain: string };

type CompanyAnswer = { company: CompanyName | null; inside?: boolean };

const useCompanyAnswer = () =>
  useQuery({
    queryKey: ["company"],
    queryFn: () => api<CompanyAnswer>("/api/company"),
    // Asked again whenever the frame opens: a sign-in may have been to another company.
    staleTime: 0,
  });

export function useCompany(): CompanyName | null {
  return useCompanyAnswer().data?.company ?? null;
}

/** This browser is inside its company (Aryan, 27 Nov: "signing out of an app leaves the app, not
 *  the company"): it signed in there, so signing out of one system goes back to the company's
 *  systems, not to its sign-in. Undefined while asked. */
export function useInsideCompany(): boolean | undefined {
  const answer = useCompanyAnswer();
  return answer.data ? answer.data.inside !== false : answer.isError ? false : undefined;
}

/** The company's own name on screens: one company per database since the separation (Aryan, 26 Nov
 *  night: "everything separate"), so never a list of the group's companies ("2MG Inc." with one). */
export const useOwnCompanyName = (): string => useCompany()?.name ?? "2MG Inc.";
/** Its short code (2MG, GM). */
export const useOwnCompanyCode = (): string => useCompany()?.code ?? "2MG";
