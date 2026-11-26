// Since the separation (Aryan, 26 Nov night) each company on Bishnoi One has its own database, and
// inside it there is one company: itself (companies/context.ts ownCompanyName; its papers print its
// own Company details). Every order, invoice, employee record and document carries OWN; the codes
// below stay for the rows made before (the database's checks know them). Earlier note:
// The group's companies, one list for the whole system (26 Nov: the same company was "getmeds" on
// orders and invoices and "gpi" on HR and payroll; documents must never carry the wrong company).
// Every order, invoice, employee record and payslip carries one of these codes; screens, prints
// and invoices take the name from here. The web app reads it too (`@2mg/api/companies`).
// Adding a company: a code here, its invoice series, and its counter row (migration 0159's way).

export const COMPANY_CODES = ["2mg", "gpi"] as const;
export type CompanyCode = (typeof COMPANY_CODES)[number];

/** The code every row carries since the separation: "this company". */
export const OWN: CompanyCode = "2mg";

export const COMPANIES: Record<
  CompanyCode,
  {
    /** The registered name: on invoices, payslips, printed forms. */
    name: string;
    /** Where room is short (a table column, a chip). */
    short: string;
    /** Its sales invoices' numbers: the series, then six digits (2MG-SI-000123, INV-000045). Never
     *  changed once invoices are out. */
    invoiceSeries: string;
  }
> = {
  "2mg": { name: "2MG Incorporated", short: "2MG", invoiceSeries: "2MG-SI-" },
  gpi: { name: "Getmeds Philippines Incorporated", short: "GPI", invoiceSeries: "INV-" },
};

/** A company's registered name from its code (the code itself if it isn't one of ours). */
export const companyName = (code: string | null | undefined): string =>
  code && code in COMPANIES ? COMPANIES[code as CompanyCode].name : (code ?? "");

/** Both companies' names in one line ("2MG Incorporated and Getmeds Philippines Incorporated"). */
export const allCompanyNames = (joiner = " and "): string => COMPANY_CODES.map((code) => COMPANIES[code].name).join(joiner);
