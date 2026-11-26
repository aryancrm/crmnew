// Which company a request (or a timed job) works for. Each company's data is in its own database
// (companies/registry.ts), so the code under a request never names a company: the database it is
// given is that company's. A few things outside the database follow the company too: the domain
// its login IDs end in, and the answers kept in memory for a while.
//
// With one company (COMPANIES not on, as before 26 Nov 2026) there is no company here at all, and
// everything is as it was: the login domain comes from LOGIN_DOMAIN (2mginc.com).

import { AsyncLocalStorage } from "node:async_hooks";

export type CompanyRef = {
  /** The company's account number with us: six digits. */
  orgId: string;
  name: string;
  /** Its short code, for documents: 2MG, GM. */
  code: string;
  /** What its people type after the @ to sign in: 2mginc.com, getmeds.ph. */
  loginDomain: string;
  /** The first company, in the server's own database: webhooks and the robots work for it. */
  home: boolean;
};

const current = new AsyncLocalStorage<CompanyRef>();

export const companyNow = (): CompanyRef | null => current.getStore() ?? null;

/** Runs work (a request, a timed job) as one company's. */
export const asCompany = <T>(company: CompanyRef, work: () => T): T => current.run(company, work);

/** The domain this company's login IDs end in: "hos1@2mginc.com". */
export const loginDomain = (): string =>
  companyNow()?.loginDomain ?? (process.env.LOGIN_DOMAIN ?? "2mginc.com").toLowerCase();

/** A key for an answer kept in memory, so one company's figures are never shown to another. */
export const companyKey = (key: string): string => {
  const company = companyNow();
  return company ? `${company.orgId}:${key}` : key;
};

/** Work that only the first company does (a robot or a mailbox set up on the server, not in a
 *  company's data): true with one company, and for the first of several. */
export const isHomeCompany = (): boolean => companyNow()?.home ?? true;
