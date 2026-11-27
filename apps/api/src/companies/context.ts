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

/** The other companies a browser has accounts in (27 Nov: "add another account" with another
 *  company's email): set by the company router, so one company's sign-in can show, end and switch to
 *  a session kept in another's database. Null with one company. */
export type OtherCompanies = {
  whoIs: (orgId: string, token: string) => Promise<import("../types").Me | null>;
  end: (orgId: string, token: string) => Promise<void>;
  code: (orgId: string) => string | null;
};
let others: OtherCompanies | null = null;
export const setOtherCompanies = (hook: OtherCompanies | null): void => {
  others = hook;
};
export const otherCompanies = (): OtherCompanies | null => others;

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

// One company per database (Aryan, 26 Nov night: "2MG and GetMeds separate: no 'invoice from 2MG or
// GetMeds', no 'employer 2MG or GPI'; everything separate"). Inside a company everything is its own.
/** The company's name for labels: Bishnoi One's list's ("2MG Inc." with one company). Papers print
 *  the name in its Company details (settings/service.ts companyInfo). */
export const ownCompanyName = (): string => companyNow()?.name ?? "2MG Inc.";
/** Its short code (the panel's: 2MG, GM). */
export const ownCompanyCode = (): string => companyNow()?.code ?? "2MG";
/** 2MG's invoice series from before the separation (its invoices out keep their numbers); any other
 *  company types its own in Company details before its first invoice. */
export const homeInvoiceSeries = (): string | null => (isHomeCompany() ? "2MG-SI-" : null);

/** A new company's details before its Admin fills them: its name, nothing of another company's. */
export const blankDetails = (name: string) => ({
  name,
  address: "",
  phone: "",
  email: "",
  tin: "",
  vat: true,
  licence: "",
  footer: "",
  signatory: "",
  signatoryTitle: "",
  invoiceSeries: "",
});
