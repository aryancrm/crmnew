// BIR Readiness & TAMP Audit (NABHI_FINANCE/bir_readiness.py 0.4.64 parity).
// Read-only diagnostics comparing BIR tax lists against the ledger and flagging missing TINs,
// untagged company documents, missing ATCs, unposted legacy /purchases/old rows, and empty charts.

import { sql } from "drizzle-orm";
import { mayReadLedger } from "../books/accounts";
import type { CompanyCode } from "../companies";
import { type Database, rows } from "../db/index";
import type { Me } from "../types";
import { assertBirEnabled, purchasesBetween, salesJournal, sawtReport, slpReport, slsReport } from "./reports";

export async function tampAudit(db: Database, company: CompanyCode, start: string, end: string) {
  const purchases = await purchasesBetween(db, company, start, end);
  const bySupplier = new Map<
    string,
    {
      supplierId: string;
      name: string;
      tin: string | null;
      origin: string;
      netCentavos: number;
      vatCentavos: number;
      ewtCentavos: number;
      purchases: number;
    }
  >();

  for (const pu of purchases) {
    if (pu.origin === "foreign") continue;
    const row = bySupplier.get(pu.payeeId) ?? {
      supplierId: pu.payeeId,
      name: pu.name,
      tin: pu.tin,
      origin: pu.origin ?? "unset",
      netCentavos: 0,
      vatCentavos: 0,
      ewtCentavos: 0,
      purchases: 0,
    };
    row.netCentavos += pu.netCentavos;
    row.vatCentavos += pu.vatCentavos;
    row.ewtCentavos += pu.withheldCentavos;
    if (pu.source !== "vendor_credit") row.purchases += 1;
    bySupplier.set(pu.payeeId, row);
  }

  const flagged = [...bySupplier.values()]
    .filter((r) => r.netCentavos > 0 && r.ewtCentavos === 0)
    .sort((a, b) => b.netCentavos - a.netCentavos || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  return {
    status: flagged.length ? ("review" as const) : ("ok" as const),
    unwithheldCount: flagged.length,
    unwithheldTotalCentavos: flagged.reduce((s, r) => s + r.netCentavos, 0),
    suppliers: flagged.slice(0, 50),
    note: "Read-only TAMP check (BIR Top Withholding Agent rule): compares local recorded purchases (SLP) against QAP EWT withheld per supplier so ₱0-EWT local suppliers are reviewed before filing.",
  };
}

export async function birReadiness(db: Database, me: Me, company: CompanyCode, start: string, end: string) {
  assertBirEnabled();
  mayReadLedger(me);

  const period = { start, end, label: `${start} to ${end}` };
  const [
    sls,
    slp,
    sawtAll,
    sj,
    purchases,
    tamp,
    chartCount,
    untaggedDocs,
    legacyPurchases,
    ledgerTotals,
  ] = await Promise.all([
    slsReport(db, company, period),
    slpReport(db, company, period),
    sawtReport(db, company, period, "all"),
    salesJournal(db, company, start, end),
    purchasesBetween(db, company, start, end),
    tampAudit(db, company, start, end),
    rows<{ n: number }>(db, sql`select count(*)::int as n from book_account where active`),
    rows<{ id: number; kind: string; number: string; date: string; total: number }>(
      db,
      sql`select d.id::int as id, d.kind, d.number, to_char(d.doc_date, 'YYYY-MM-DD') as date,
          round(d.total * d.fx_rate)::bigint::float8 as total
        from book_doc d
        where d.company is null
          and d.kind in ('bill', 'vendor_credit', 'expense', 'invoice', 'credit_note', 'customer_payment', 'vendor_payment')
          and d.voided_at is null and d.status not in ('void', 'draft', 'pending_approval')
          and d.doc_date between ${start}::date and ${end}::date
        order by d.doc_date desc, d.id desc limit 50`,
    ),
    rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from purchase where ordered_on between ${start}::date and ${end}::date and state <> 'cancelled'`,
    ),
    rows<{ account: string; debit: number; credit: number }>(
      db,
      sql`select lower(e.account) as account, sum(e.debit)::bigint::float8 as debit, sum(e.credit)::bigint::float8 as credit
          from book_entry e
          where e.on_date between ${start}::date and ${end}::date
            and lower(e.account) in ('tax payable', 'advance tax', 'withholding tax payable')
          group by 1`,
    ),
  ]);

  const byAcct = new Map(ledgerTotals.map((r) => [r.account, { debit: Math.round(r.debit), credit: Math.round(r.credit) }]));
  const taxPayable = byAcct.get("tax payable") ?? { debit: 0, credit: 0 };
  const advanceTax = byAcct.get("advance tax") ?? { debit: 0, credit: 0 };
  const ewtPayable = byAcct.get("withholding tax payable") ?? { debit: 0, credit: 0 };

  const missingWithholdingDocs = purchases
    .filter((pu) => pu.origin !== "foreign" && pu.held.length === 0 && !pu.noWithholdingReason && !pu.void)
    .slice(0, 50)
    .map((pu) => ({
      id: pu.id,
      kind: pu.source,
      number: pu.no,
      date: pu.on,
      supplier: pu.name,
      netCentavos: pu.netCentavos,
    }));

  const alerts: { key: string; severity: "warn" | "info"; title: string; count: number; detail: string }[] = [];
  if ((chartCount[0]?.n ?? 0) === 0) {
    alerts.push({
      key: "empty_chart",
      severity: "warn",
      title: "Chart of accounts is empty",
      count: 0,
      detail: "No active rows exist in book_account yet. Financial statements and payment account pickers need a seeded or imported chart.",
    });
  }
  if (untaggedDocs.length > 0) {
    alerts.push({
      key: "untagged_company",
      severity: "warn",
      title: "Books documents missing a company tag",
      count: untaggedDocs.length,
      detail: "Older Books bills, expenses, or invoices created before company stamping are excluded from BIR filings until tagged.",
    });
  }
  if (sls.missingTin > 0) {
    alerts.push({
      key: "missing_customer_tin",
      severity: "warn",
      title: "Customers in SLS missing a 9-digit TIN",
      count: sls.missingTin,
      detail: "BIR RELIEF SLS validation flags customers without a valid 9-digit TIN.",
    });
  }
  if (slp.missingTin > 0) {
    alerts.push({
      key: "missing_supplier_tin",
      severity: "warn",
      title: "Suppliers in SLP missing a 9-digit TIN",
      count: slp.missingTin,
      detail: "BIR RELIEF SLP and QAP validation require a valid 9-digit supplier TIN.",
    });
  }
  if (sawtAll.missingAtc > 0) {
    alerts.push({
      key: "missing_sawt_atc",
      severity: "warn",
      title: "Customer 2307 payments missing an ATC code",
      count: sawtAll.missingAtc,
      detail: "Without an ATC (e.g. WC158 vs WV010), SAWT defaults to 1702Q. Tag the ATC to separate 5% Gov't VAT (2550Q) cleanly.",
    });
  }
  if ((legacyPurchases[0]?.n ?? 0) > 0) {
    alerts.push({
      key: "legacy_purchases",
      severity: "info",
      title: "Legacy /purchases/old entries in period",
      count: legacyPurchases[0]?.n ?? 0,
      detail: "Entries in the legacy `purchase` table do not post to Books or BIR SLP/SLI. Ensure supplier bills were also recorded in Books.",
    });
  }

  return {
    company,
    from: start,
    to: end,
    taxListsSummary: {
      outputVatCentavos: sj.totals.taxCentavos,
      inputVatCentavos: slp.totals.inputTaxCentavos,
      ewtWithheldCentavos: purchases.reduce((s, pu) => s + pu.withheldCentavos, 0),
      cwtWithheldCentavos: sawtAll.totals.withheldCentavos,
    },
    consolidatedLedgerReference: {
      note: "Aryan's book_entry view is currently consolidated across both companies (2MG + GPI). Company-level ledger separation arrives in Step 2 (company_book_entry).",
      taxPayableNetCentavos: taxPayable.credit - taxPayable.debit,
      advanceTaxNetCentavos: advanceTax.debit - advanceTax.credit,
      ewtPayableNetCentavos: ewtPayable.credit - ewtPayable.debit,
    },
    alerts,
    untaggedDocs,
    missingWithholdingDocs,
    tampAudit: tamp,
  };
}
