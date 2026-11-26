// Automated Intercompany Clearing rules between 2MG Incorporated ('2mg') and Getmeds Philippines
// Incorporated ('gpi').
//
// In operations, both companies share customers and payment channels: a patient may buy a 2MG item
// and a GPI item and pay both into GPI's GCash QR (or 2MG's bank). Instead of mixing legal books
// or losing track of where cash landed, we keep each legal book strictly separate and auto-generate
// balanced Due From / Due To legs mapped to Sir Rommel's "Advances to GPI" / "Advances to 2MG".
// In Consolidated (both companies) views, the opposite legs cancel cleanly to ₱0.

import { COMPANIES, type CompanyCode } from "../companies";

export type IntercompanyAccounts = {
  dueFromSister: string; // e.g. 'Advances to GPI' on 2MG, 'Advances to 2MG' on GPI
  dueToSister: string; // configurable: same net running account or dedicated liability account
};

export const DEFAULT_INTERCOMPANY_ACCOUNTS: Record<CompanyCode, IntercompanyAccounts> = {
  "2mg": { dueFromSister: "Advances to GPI", dueToSister: "Advances to GPI" },
  gpi: { dueFromSister: "Advances to 2MG", dueToSister: "Advances to 2MG" },
};

export type CrossCompanyCheck = {
  isCrossCompany: boolean;
  invoiceCompany: CompanyCode;
  bankCompany: CompanyCode | null;
  summary: string | null;
};

/** Detects whether a payment or refund crosses legal entities (`2mg` vs `gpi`). */
export function detectCrossCompany(
  documentCompany: CompanyCode,
  moneyAccountOwner: CompanyCode | null | undefined,
  moneyAccountName: string,
  amountCentavos: number,
  accountsByCompany: Record<CompanyCode, IntercompanyAccounts> = DEFAULT_INTERCOMPANY_ACCOUNTS,
): CrossCompanyCheck {
  if (!moneyAccountOwner || moneyAccountOwner === documentCompany) {
    return {
      isCrossCompany: false,
      invoiceCompany: documentCompany,
      bankCompany: moneyAccountOwner ?? null,
      summary: null,
    };
  }
  const pesos = `₱${(amountCentavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const docLabel = COMPANIES[documentCompany].short;
  const bankLabel = COMPANIES[moneyAccountOwner].short;
  const icAccount = accountsByCompany[documentCompany].dueFromSister;
  return {
    isCrossCompany: true,
    invoiceCompany: documentCompany,
    bankCompany: moneyAccountOwner,
    summary: `Cross-company payment (${docLabel} invoice -> ${bankLabel} account "${moneyAccountName}"): ${docLabel} AR clears by ${pesos}, ${bankLabel} bank receives ${pesos}, and ${pesos} posts to ${icAccount} until settled.`,
  };
}

export type CompanyLedgerLeg = {
  company: CompanyCode;
  account: string;
  debit: number;
  credit: number;
  isIntercompany: boolean;
};

/**
 * Produces balanced per-company ledger legs for a CRM customer payment (or refund) and guarantees
 * that when both companies are consolidated, the intercompany legs sum to exact ₱0.
 */
export function buildIntercompanyPaymentLegs(input: {
  invoiceCompany: CompanyCode;
  bankCompany: CompanyCode | null | undefined;
  bankAccount: string;
  arAccount?: string;
  amountCentavos: number;
  accountsByCompany?: Record<CompanyCode, IntercompanyAccounts>;
}): CompanyLedgerLeg[] {
  const accounts = input.accountsByCompany ?? DEFAULT_INTERCOMPANY_ACCOUNTS;
  const arAccount = input.arAccount ?? "Accounts Receivable";
  const amount = Math.round(input.amountCentavos);
  if (amount <= 0) return [];

  if (!input.bankCompany || input.bankCompany === input.invoiceCompany) {
    return [
      { company: input.invoiceCompany, account: input.bankAccount, debit: amount, credit: 0, isIntercompany: false },
      { company: input.invoiceCompany, account: arAccount, debit: 0, credit: amount, isIntercompany: false },
    ];
  }

  const invCo = input.invoiceCompany;
  const bankCo = input.bankCompany;
  return [
    // Invoice owner's legal books: Dr Advances to <Sister> / Cr Accounts Receivable
    { company: invCo, account: accounts[invCo].dueFromSister, debit: amount, credit: 0, isIntercompany: true },
    { company: invCo, account: arAccount, debit: 0, credit: amount, isIntercompany: false },
    // Cash-receiving sister company's legal books: Dr Bank/GCash / Cr Advances to <InvoiceOwner>
    { company: bankCo, account: input.bankAccount, debit: amount, credit: 0, isIntercompany: false },
    { company: bankCo, account: accounts[bankCo].dueToSister, debit: 0, credit: amount, isIntercompany: true },
  ];
}

export type IntercompanyItem = {
  invoiceCompany: CompanyCode;
  bankCompany: CompanyCode;
  amountCentavos: number;
  settledCentavos: number;
};

export type IntercompanySummary = {
  gpiOwes2mgCentavos: number;
  twomgOwesGpiCentavos: number;
  netDirection: "gpi_to_2mg" | "2mg_to_gpi" | "even";
  netAmountCentavos: number;
};

/** Computes gross two-way balances and net cash settlement owed between 2MG and GPI. */
export function summarizeIntercompanyPosition(items: IntercompanyItem[]): IntercompanySummary {
  let gpiOwes2mg = 0;
  let twomgOwesGpi = 0;

  for (const item of items) {
    if (item.invoiceCompany === item.bankCompany) continue;
    const open = Math.max(0, item.amountCentavos - item.settledCentavos);
    if (item.invoiceCompany === "2mg" && item.bankCompany === "gpi") gpiOwes2mg += open;
    else if (item.invoiceCompany === "gpi" && item.bankCompany === "2mg") twomgOwesGpi += open;
  }

  const diff = gpiOwes2mg - twomgOwesGpi;
  return {
    gpiOwes2mgCentavos: gpiOwes2mg,
    twomgOwesGpiCentavos: twomgOwesGpi,
    netDirection: diff > 0 ? "gpi_to_2mg" : diff < 0 ? "2mg_to_gpi" : "even",
    netAmountCentavos: Math.abs(diff),
  };
}
