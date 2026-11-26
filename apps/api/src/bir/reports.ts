// Philippine BIR books, returns, summary lists, and filing log (NABHI_FINANCE 0.4.65 parity).
// Reads only canonical tables (`invoice`, `sales_return`, `payment`, `book_doc`, `book_line`,
// `book_doc_tax_meta`, `payslip`) and strictly filters by `company` ('2mg' | 'gpi').
// Never modifies CRM order workflows or reads legacy `past_invoice` / `past_payment` tables.

import { sql } from "drizzle-orm";
import { mayReadLedger } from "../books/accounts";
import { COMPANY_CODES, type CompanyCode } from "../companies";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { Me } from "../types";
import { CWT_STATUTORY_BP, NO_WITHHOLDING, PURCHASE_TYPES, sawtFormForAtc, WITHHOLDING, type PurchaseType } from "./ewt";
import { type BirPeriod, calendarQuarter, monthPeriod, monthSlotInQuarter, monthsOf, quarter } from "./periods";

export function assertBirEnabled(): void {
  if (process.env.FINANCE_BIR_ENABLED === "false") {
    throw new Refusal(403, "disabled", "BIR compliance module is temporarily turned off.");
  }
}

export function parseCompany(raw?: string | null): CompanyCode {
  const code = (raw ?? "2mg").trim().toLowerCase();
  if ((COMPANY_CODES as readonly string[]).includes(code)) return code as CompanyCode;
  throw new Refusal(400, "invalid", "Pick a valid company (2mg or gpi).", "company");
}

export type TaxpayerProfile = {
  company: CompanyCode;
  registeredName: string;
  tradeName: string;
  tin: string | null;
  branchCode: string;
  rdoCode: string | null;
  address: string | null;
  regime: "vat" | "non_vat";
  fiscalMonthEnd: number;
  isTamp: boolean;
};

export async function taxpayerProfile(db: Database, company: CompanyCode): Promise<TaxpayerProfile> {
  const [row] = await rows<{
    company: CompanyCode;
    registeredName: string;
    tradeName: string;
    tin: string | null;
    branchCode: string;
    rdoCode: string | null;
    address: string | null;
    regime: "vat" | "non_vat";
    fiscalMonthEnd: number;
    isTamp: boolean;
  }>(
    db,
    sql`select company, registered_name as "registeredName", trade_name as "tradeName", tin,
        branch_code as "branchCode", rdo_code as "rdoCode", registered_address as address,
        regime, fiscal_month_end as "fiscalMonthEnd", is_tamp as "isTamp"
      from bir_taxpayer_profile where company = ${company}`,
  );
  if (row) return row;
  return {
    company,
    registeredName: company === "2mg" ? "2MG Incorporated" : "Getmeds Philippines Incorporated",
    tradeName: company === "2mg" ? "2MG Inc." : "GetMeds Philippines Inc.",
    tin: null,
    branchCode: "00000",
    rdoCode: null,
    address: null,
    regime: "vat",
    fiscalMonthEnd: 12,
    isTamp: true,
  };
}

export async function birSettings(db: Database, me: Me) {
  assertBirEnabled();
  mayReadLedger(me);
  const [profiles, atcs, accountMap] = await Promise.all([
    Promise.all(COMPANY_CODES.map((code) => taxpayerProfile(db, code))),
    rows<{ code: string; description: string; rateBp: number; category: string; birForm: string; active: boolean }>(
      db,
      sql`select code, description, rate_bps as "rateBp", category, bir_form as "birForm", active
          from bir_atc_rate order by category, rate_bps, code`,
    ),
    rows<{ company: CompanyCode; roleKey: string; accountName: string }>(
      db,
      sql`select company, role_key as "roleKey", account_name as "accountName"
          from finance_account_map order by company, role_key`,
    ),
  ]);
  return {
    profiles,
    atcs,
    accountMap,
    noWithholdingReasons: Object.entries(NO_WITHHOLDING)
      .filter(([k]) => k !== "foreign")
      .map(([key, label]) => ({ key, label })),
  };
}

export async function saveTaxpayerProfile(
  db: Database,
  me: Me,
  company: CompanyCode,
  input: {
    registeredName: string;
    tradeName: string;
    tin?: string | null;
    branchCode?: string | null;
    rdoCode?: string | null;
    address?: string | null;
    regime?: "vat" | "non_vat";
    fiscalMonthEnd?: number;
    isTamp?: boolean;
  },
): Promise<TaxpayerProfile> {
  assertBirEnabled();
  mayReadLedger(me);
  const tinDigits = (input.tin ?? "").replace(/\D/g, "");
  if (tinDigits && tinDigits.length !== 9) {
    throw new Refusal(400, "invalid", "TIN must have 9 main digits (the 5-digit branch goes separately).", "tin");
  }
  const branch = (input.branchCode ?? "00000").replace(/\D/g, "").padStart(5, "0").slice(0, 5);
  const rdo = (input.rdoCode ?? "").trim().toUpperCase() || null;
  if (rdo && !/^\d{2,3}[0-9A-Z]?$/.test(rdo)) {
    throw new Refusal(400, "invalid", "RDO code should be 3 characters (e.g. 053).", "rdoCode");
  }
  await db.execute(
    sql`insert into bir_taxpayer_profile (company, registered_name, trade_name, tin, branch_code, rdo_code, registered_address, regime, fiscal_month_end, is_tamp, updated_by, updated_at)
        values (${company}, ${input.registeredName.trim()}, ${input.tradeName.trim()}, ${tinDigits || null}, ${branch},
          ${rdo}, ${input.address?.trim() || null}, ${input.regime ?? "vat"}, ${input.fiscalMonthEnd ?? 12},
          ${input.isTamp ?? true}, ${me.id}, now())
        on conflict (company) do update set
          registered_name = excluded.registered_name,
          trade_name = excluded.trade_name,
          tin = excluded.tin,
          branch_code = excluded.branch_code,
          rdo_code = excluded.rdo_code,
          registered_address = excluded.registered_address,
          regime = excluded.regime,
          fiscal_month_end = excluded.fiscal_month_end,
          is_tamp = excluded.is_tamp,
          updated_by = excluded.updated_by,
          updated_at = now()`,
  );
  return taxpayerProfile(db, company);
}

export async function saveAccountMap(
  db: Database,
  me: Me,
  company: CompanyCode,
  entries: { roleKey: string; accountName: string }[],
): Promise<void> {
  assertBirEnabled();
  mayReadLedger(me);
  await db.transaction(async (tx) => {
    for (const one of entries) {
      const roleKey = one.roleKey.trim();
      const accountName = one.accountName.trim();
      if (!roleKey || !accountName) continue;
      await tx.execute(
        sql`insert into finance_account_map (company, role_key, account_name, updated_by, updated_at)
            values (${company}, ${roleKey}, ${accountName}, ${me.id}, now())
            on conflict (company, role_key) do update set
              account_name = excluded.account_name,
              updated_by = excluded.updated_by,
              updated_at = now()`,
      );
    }
  });
}

// ------------------------------------------------------------------ Sales & Output VAT (SLS / Sales Journal)

export type SalesRow = {
  date: string;
  number: string;
  source: "crm_invoice" | "crm_return" | "book_invoice" | "book_credit_note";
  customer: string;
  tin: string | null;
  address: string | null;
  void: boolean;
  grossCentavos: number;
  taxableSalesCentavos: number;
  taxCentavos: number;
  zeroRatedSalesCentavos: number;
  exemptSalesCentavos: number;
  nonTaxableSalesCentavos: number;
};

export async function salesJournal(db: Database, company: CompanyCode, start: string, end: string) {
  const [crmInvoices, crmReturns, bookSales] = await Promise.all([
    rows<{
      date: string;
      number: string;
      customer: string;
      tin: string | null;
      address: string | null;
      status: string;
      total: number;
      credited: number;
      vatable: number;
      vat: number;
      exempt: number;
      zeroRated: number;
      retVat: number;
    }>(
      db,
      sql`select to_char(i.issued_on, 'YYYY-MM-DD') as date, i.code as number, c.name as customer,
          c.tin, coalesce(nullif(trim(c.address), ''), nullif(trim(c.city), '')) as address,
          i.status, i.total::bigint::float8 as total, i.credited::bigint::float8 as credited,
          i.vatable::bigint::float8 as vatable, i.vat::bigint::float8 as vat,
          i.exempt::bigint::float8 as exempt, i.zero_rated::bigint::float8 as "zeroRated",
          coalesce((
            select sum(round(coalesce(l.qty::bigint * l.unit_price, 0) * 12 / 112.0))::bigint
            from sales_return r join sales_return_line l on l.return_id = r.id and l.outcome <> 'missing'
              join medicine m on m.id = l.medicine_id left join order_item oi on oi.id = l.order_item_id
            where r.order_id = i.order_id and r.credited_at is not null and r.credit > 0
              and coalesce(oi.vat_then, m.vat) = 'vat12'
          ), 0)::float8 as "retVat"
        from invoice i join customer c on c.id = i.customer_id
        where i.invoice_from = ${company} and i.issued_on between ${start}::date and ${end}::date
        order by i.issued_on, i.code`,
    ),
    rows<{
      date: string;
      number: string;
      customer: string;
      tin: string | null;
      address: string | null;
      credit: number;
      vat: number;
    }>(
      db,
      sql`select to_char((r.credited_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as date,
          coalesce(r.code, 'RET-' || r.id) as number, c.name as customer, c.tin,
          coalesce(nullif(trim(c.address), ''), nullif(trim(c.city), '')) as address,
          r.credit::bigint::float8 as credit,
          coalesce(sum(round(coalesce(l.qty::bigint * l.unit_price, 0) * 12 / 112.0))
            filter (where coalesce(oi.vat_then, m.vat) = 'vat12'), 0)::bigint::float8 as vat
        from sales_return r
          join sales_order o on o.id = r.order_id
          join invoice i on i.order_id = o.id and i.invoice_from = ${company} and i.status <> 'cancelled'
          join customer c on c.id = o.customer_id
          join sales_return_line l on l.return_id = r.id and l.outcome <> 'missing'
          join medicine m on m.id = l.medicine_id
          left join order_item oi on oi.id = l.order_item_id
        where r.credited_at is not null and r.credit > 0
          and (r.credited_at at time zone 'Asia/Manila')::date between ${start}::date and ${end}::date
        group by r.id, r.code, r.credited_at, c.name, c.tin, c.address, c.city, r.credit
        order by 1, 2`,
    ),
    rows<{
      date: string;
      number: string;
      kind: "invoice" | "credit_note";
      customer: string;
      tin: string | null;
      address: string | null;
      voided: boolean;
      gross: number;
      tax: number;
    }>(
      db,
      sql`select to_char(d.doc_date, 'YYYY-MM-DD') as date, d.number, d.kind,
          coalesce(c.name, d.party_name, 'Customer') as customer,
          c.tin, coalesce(nullif(trim(c.address), ''), nullif(trim(c.city), '')) as address,
          (d.voided_at is not null or d.status = 'void') as voided,
          round(d.total * d.fx_rate)::bigint::float8 as gross,
          coalesce((select sum(round(coalesce(l.tax_amount, 0) * d.fx_rate)) from book_line l where l.doc_id = d.id), 0)::bigint::float8 as tax
        from book_doc d left join customer c on c.id = d.customer_id
        where d.kind in ('invoice', 'credit_note') and d.company = ${company}
          and d.status not in ('draft', 'pending_approval')
          and d.doc_date between ${start}::date and ${end}::date
        order by d.doc_date, d.number`,
    ),
  ]);

  const out: SalesRow[] = [];
  for (const inv of crmInvoices) {
    const isVoid = inv.status === "cancelled";
    const gross = isVoid ? 0 : Math.round(inv.total + inv.credited);
    const vat = isVoid ? 0 : Math.round(inv.vat + inv.retVat);
    const taxable = isVoid ? 0 : Math.max(0, gross - vat - Math.round(inv.exempt) - Math.round(inv.zeroRated));
    out.push({
      date: inv.date,
      number: inv.number,
      source: "crm_invoice",
      customer: inv.customer,
      tin: inv.tin,
      address: inv.address,
      void: isVoid,
      grossCentavos: gross,
      taxableSalesCentavos: taxable,
      taxCentavos: vat,
      zeroRatedSalesCentavos: isVoid ? 0 : Math.round(inv.zeroRated),
      exemptSalesCentavos: isVoid ? 0 : Math.round(inv.exempt),
      nonTaxableSalesCentavos: 0,
    });
  }

  for (const ret of crmReturns) {
    const gross = Math.round(ret.credit);
    const vat = Math.round(ret.vat);
    out.push({
      date: ret.date,
      number: ret.number,
      source: "crm_return",
      customer: ret.customer,
      tin: ret.tin,
      address: ret.address,
      void: false,
      grossCentavos: -gross,
      taxableSalesCentavos: -(gross - vat),
      taxCentavos: -vat,
      zeroRatedSalesCentavos: 0,
      exemptSalesCentavos: 0,
      nonTaxableSalesCentavos: 0,
    });
  }

  for (const b of bookSales) {
    const sign = b.kind === "credit_note" ? -1 : 1;
    const gross = b.voided ? 0 : sign * Math.round(b.gross);
    const tax = b.voided ? 0 : sign * Math.round(b.tax);
    const taxable = b.voided ? 0 : gross - tax;
    out.push({
      date: b.date,
      number: b.number,
      source: b.kind === "credit_note" ? "book_credit_note" : "book_invoice",
      customer: b.customer,
      tin: b.tin,
      address: b.address,
      void: b.voided,
      grossCentavos: gross,
      taxableSalesCentavos: taxable,
      taxCentavos: tax,
      zeroRatedSalesCentavos: 0,
      exemptSalesCentavos: 0,
      nonTaxableSalesCentavos: 0,
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const totals = out.reduce(
    (acc, r) => ({
      grossCentavos: acc.grossCentavos + r.grossCentavos,
      taxableSalesCentavos: acc.taxableSalesCentavos + r.taxableSalesCentavos,
      taxCentavos: acc.taxCentavos + r.taxCentavos,
      zeroRatedSalesCentavos: acc.zeroRatedSalesCentavos + r.zeroRatedSalesCentavos,
      exemptSalesCentavos: acc.exemptSalesCentavos + r.exemptSalesCentavos,
      nonTaxableSalesCentavos: acc.nonTaxableSalesCentavos + r.nonTaxableSalesCentavos,
    }),
    {
      grossCentavos: 0,
      taxableSalesCentavos: 0,
      taxCentavos: 0,
      zeroRatedSalesCentavos: 0,
      exemptSalesCentavos: 0,
      nonTaxableSalesCentavos: 0,
    },
  );
  return { rows: out, totals };
}

export async function slsReport(db: Database, company: CompanyCode, period: BirPeriod) {
  const sj = await salesJournal(db, company, period.start, period.end);
  const by = new Map<
    string,
    {
      tin: string | null;
      name: string;
      address: string | null;
      exemptCentavos: number;
      zeroRatedCentavos: number;
      taxableCentavos: number;
      outputTaxCentavos: number;
      grossTaxableCentavos: number;
    }
  >();

  for (const r of sj.rows) {
    if (r.void) continue;
    const key = `${(r.tin ?? "").trim()}::${r.customer.trim().toUpperCase()}`;
    const row = by.get(key) ?? {
      tin: r.tin,
      name: r.customer,
      address: r.address,
      exemptCentavos: 0,
      zeroRatedCentavos: 0,
      taxableCentavos: 0,
      outputTaxCentavos: 0,
      grossTaxableCentavos: 0,
    };
    row.exemptCentavos += r.exemptSalesCentavos + r.nonTaxableSalesCentavos;
    row.zeroRatedCentavos += r.zeroRatedSalesCentavos;
    row.taxableCentavos += r.taxableSalesCentavos;
    row.outputTaxCentavos += r.taxCentavos;
    row.grossTaxableCentavos += r.taxableSalesCentavos + r.taxCentavos;
    by.set(key, row);
  }

  const list = [...by.values()].sort((a, b) => a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
  const totals = list.reduce(
    (acc, r) => ({
      exemptCentavos: acc.exemptCentavos + r.exemptCentavos,
      zeroRatedCentavos: acc.zeroRatedCentavos + r.zeroRatedCentavos,
      taxableCentavos: acc.taxableCentavos + r.taxableCentavos,
      outputTaxCentavos: acc.outputTaxCentavos + r.outputTaxCentavos,
      grossTaxableCentavos: acc.grossTaxableCentavos + r.grossTaxableCentavos,
    }),
    { exemptCentavos: 0, zeroRatedCentavos: 0, taxableCentavos: 0, outputTaxCentavos: 0, grossTaxableCentavos: 0 },
  );
  const missingTin = list.filter((r) => !r.tin || r.tin.replace(/\D/g, "").length < 9).length;
  return { rows: list, totals, missingTin };
}

// ------------------------------------------------------------------ Customer Withholding (SAWT)

export async function sawtReport(
  db: Database,
  company: CompanyCode,
  period: BirPeriod,
  form: "all" | "1702Q" | "2550Q" = "all",
) {
  const [crmWithheld, bookWithheld] = await Promise.all([
    rows<{
      tin: string | null;
      payor: string;
      atc: string | null;
      sawtForm: "1702Q" | "2550Q" | null;
      certificate: string | null;
      withheld: number;
      invTotal: number;
      invVat: number;
    }>(
      db,
      sql`select c.tin, c.name as payor, p.tax_atc as atc, p.sawt_form as "sawtForm",
          p.reference as certificate, p.amount::bigint::float8 as withheld,
          i.total::bigint::float8 as "invTotal", i.vat::bigint::float8 as "invVat"
        from payment p
          join invoice i on i.id = p.invoice_id
          join customer c on c.id = p.customer_id
        where p.active and p.method = 'withholding'
          and i.invoice_from = ${company}
          and p.paid_on between ${period.start}::date and ${period.end}::date
        order by p.paid_on, p.id`,
    ),
    rows<{
      tin: string | null;
      payor: string;
      atc: string | null;
      certificate: string | null;
      withheld: number;
      docTotal: number;
    }>(
      db,
      sql`select c.tin, coalesce(c.name, d.party_name, 'Customer') as payor,
          nullif(trim(d.fields->>'CF.ATC'), '') as atc,
          coalesce(nullif(trim(d.reference), ''), d.number) as certificate,
          round(coalesce(d.withheld, 0) * d.fx_rate)::bigint::float8 as withheld,
          round(d.total * d.fx_rate)::bigint::float8 as "docTotal"
        from book_doc d left join customer c on c.id = d.customer_id
        where d.kind = 'customer_payment' and d.company = ${company}
          and d.voided_at is null and d.status not in ('void', 'draft', 'pending_approval')
          and coalesce(d.withheld, 0) > 0
          and d.doc_date between ${period.start}::date and ${period.end}::date
        order by d.doc_date, d.id`,
    ),
  ]);

  const by = new Map<
    string,
    {
      tin: string | null;
      payor: string;
      atc: string;
      form: "1702Q" | "2550Q";
      incomePaymentCentavos: number;
      withheldCentavos: number;
      rateBp: number | null;
      certificates: string[];
    }
  >();

  const addItem = (
    tin: string | null,
    payor: string,
    rawAtc: string | null,
    explicitForm: "1702Q" | "2550Q" | null,
    withheld: number,
    base: number,
    certificate: string | null,
  ) => {
    const atc = (rawAtc ?? "").trim().toUpperCase();
    const itemForm = sawtFormForAtc(atc, explicitForm);
    if (form !== "all" && itemForm !== form) return;

    let adjustedBase = Math.round(base);
    const expectedBp = CWT_STATUTORY_BP[atc];
    if (expectedBp && adjustedBase > 0) {
      const rawBp = Math.round((withheld * 10_000) / adjustedBase);
      if (rawBp !== expectedBp && (![50, 100, 200, 500, 1000, 1500].includes(rawBp) || atc === "WV010")) {
        adjustedBase = Math.round((withheld * 10_000) / expectedBp);
      }
    }

    const key = `${(tin ?? "").trim()}::${payor.trim().toUpperCase()}::${atc}::${itemForm}`;
    const row = by.get(key) ?? {
      tin,
      payor,
      atc,
      form: itemForm,
      incomePaymentCentavos: 0,
      withheldCentavos: 0,
      rateBp: null,
      certificates: [],
    };
    row.incomePaymentCentavos += adjustedBase;
    row.withheldCentavos += Math.round(withheld);
    if (certificate) row.certificates.push(certificate);
    by.set(key, row);
  };

  for (const p of crmWithheld) {
    const fallbackBase = p.invTotal > 0 ? p.invTotal - p.invVat : p.withheld;
    addItem(p.tin, p.payor, p.atc, p.sawtForm, p.withheld, fallbackBase, p.certificate);
  }
  for (const b of bookWithheld) {
    const base = Math.round((b.docTotal + b.withheld) / 1.12);
    addItem(b.tin, b.payor, b.atc, null, b.withheld, base, b.certificate);
  }

  const list = [...by.values()]
    .map((r) => ({
      ...r,
      rateBp: r.incomePaymentCentavos > 0 ? Math.round((r.withheldCentavos * 10_000) / r.incomePaymentCentavos) : null,
    }))
    .sort((a, b) => a.payor.toUpperCase().localeCompare(b.payor.toUpperCase()) || a.atc.localeCompare(b.atc));

  const missingTin = list.filter((r) => !r.tin || r.tin.replace(/\D/g, "").length < 9).length;
  const missingAtc = list.filter((r) => !/^[A-Z]{2}\d{3}$/.test(r.atc)).length;

  return {
    form,
    rows: list,
    totals: {
      incomePaymentCentavos: list.reduce((s, r) => s + r.incomePaymentCentavos, 0),
      withheldCentavos: list.reduce((s, r) => s + r.withheldCentavos, 0),
    },
    missingTin,
    missingAtc,
  };
}

// ------------------------------------------------------------------ Purchases, Input VAT & Supplier EWT

export type BirPurchase = {
  id: number;
  source: "bill" | "vendor_credit" | "expense";
  on: string;
  no: string;
  reference: string;
  payeeId: string;
  name: string;
  tin: string | null;
  address: string | null;
  origin: "local" | "foreign" | null;
  void: boolean;
  netCentavos: number;
  vatCentavos: number;
  withheldCentavos: number;
  byKind: { vatable: number; zeroRated: number; exempt: number; nonVat: number };
  byType: Record<PurchaseType, { netCentavos: number; vatCentavos: number }>;
  held: { atc: string; rateBp: number; baseCentavos: number; taxCentavos: number }[];
  noWithholdingReason: string | null;
  importation: {
    ieirdNo: string | null;
    assessmentDate: string | null;
    dutiableCentavos: number;
    vatCentavos: number;
  } | null;
};

export async function purchasesBetween(
  db: Database,
  company: CompanyCode,
  start: string,
  end: string,
  opts: { withVoid?: boolean; supplierId?: number | null; docId?: number | null } = {},
): Promise<BirPurchase[]> {
  const docs = await rows<{
    id: number;
    kind: "bill" | "vendor_credit" | "expense";
    on: string;
    number: string;
    reference: string | null;
    supplierId: number | null;
    partyName: string | null;
    supplierName: string | null;
    supplierCompany: string | null;
    supplierTin: string | null;
    supplierAddress: string | null;
    supplierCountry: string | null;
    voided: boolean;
    total: number;
    fxRate: number;
    withheld: number;
    metaOrigin: "local" | "foreign" | null;
    metaVatKind: "vat" | "zero" | "exempt" | "none" | null;
    metaPurchaseType: PurchaseType | null;
    metaAtc: string | null;
    metaAtcBp: number | null;
    metaEwtBase: number;
    metaEwt: number;
    metaNoReason: string | null;
    ieirdNo: string | null;
    assessmentDate: string | null;
    dutiable: number;
    importVat: number;
  }>(
    db,
    sql`select d.id::int as id, d.kind, to_char(d.doc_date, 'YYYY-MM-DD') as "on", d.number, d.reference,
        d.supplier_id::int as "supplierId", d.party_name as "partyName",
        s.name as "supplierName", s.company_name as "supplierCompany", s.tin as "supplierTin",
        coalesce(nullif(trim(s.billing_address), ''), nullif(trim(s.shipping_address), '')) as "supplierAddress",
        s.country as "supplierCountry",
        (d.voided_at is not null or d.status = 'void') as voided,
        round(d.total * d.fx_rate)::bigint::float8 as total,
        d.fx_rate::float8 as "fxRate",
        round(coalesce(d.withheld, 0) * d.fx_rate)::bigint::float8 as withheld,
        m.supplier_origin as "metaOrigin", m.vat_kind as "metaVatKind", m.purchase_type as "metaPurchaseType",
        m.atc_code as "metaAtc", r.rate_bps as "metaAtcBp",
        coalesce(m.ewt_base_centavos, 0)::bigint::float8 as "metaEwtBase",
        coalesce(m.ewt_centavos, 0)::bigint::float8 as "metaEwt",
        m.no_withholding_reason as "metaNoReason",
        m.import_ieird_no as "ieirdNo",
        to_char(m.import_assessment_date, 'YYYY-MM-DD') as "assessmentDate",
        coalesce(m.import_dutiable_centavos, 0)::bigint::float8 as dutiable,
        coalesce(m.import_vat_centavos, 0)::bigint::float8 as "importVat"
      from book_doc d
        left join supplier s on s.id = d.supplier_id
        left join book_doc_tax_meta m on m.doc_id = d.id
        left join bir_atc_rate r on r.code = m.atc_code
      where d.kind in ('bill', 'vendor_credit', 'expense')
        and d.company = ${company}
        and d.status not in ('draft', 'pending_approval')
        and (${Boolean(opts.withVoid)} or (d.voided_at is null and d.status <> 'void'))
        and d.doc_date between ${start}::date and ${end}::date
        ${opts.supplierId ? sql`and d.supplier_id = ${opts.supplierId}` : sql``}
        ${opts.docId ? sql`and d.id = ${opts.docId}` : sql``}
      order by d.doc_date, d.id`,
  );

  if (!docs.length) return [];
  const docIds = docs.map((d) => d.id);
  const lines = await rows<{
    docId: number;
    amount: number;
    taxAmount: number;
    taxName: string | null;
    taxPct: number | null;
    medicineId: number | null;
  }>(
    db,
    sql`select l.doc_id::int as "docId", coalesce(l.amount, 0)::bigint::float8 as amount,
        coalesce(l.tax_amount, 0)::bigint::float8 as "taxAmount", l.tax_name as "taxName",
        l.tax_pct::float8 as "taxPct", l.medicine_id::int as "medicineId"
      from book_line l where l.doc_id in (${sql.join(docIds.map((id) => sql`${id}`), sql`, `)})
      order by l.doc_id, l.n`,
  );

  const byDoc = new Map<number, typeof lines>();
  for (const ln of lines) {
    const list = byDoc.get(ln.docId) ?? [];
    list.push(ln);
    byDoc.set(ln.docId, list);
  }

  return docs.map((d) => {
    const sign = d.kind === "vendor_credit" ? -1 : 1;
    const docLines = byDoc.get(d.id) ?? [];
    const hasLines = docLines.length > 0;
    const lineSum = Math.round(docLines.reduce((s, l) => s + l.amount * d.fxRate, 0));
    const lineTax = Math.round(docLines.reduce((s, l) => s + l.taxAmount * d.fxRate, 0));
    const extraTax = hasLines ? Math.max(0, Math.round(d.total) - lineSum) : 0;
    const totalVat =
      d.metaPurchaseType === "importation" && d.importVat > 0
        ? Math.round(d.importVat)
        : hasLines
          ? Math.max(lineTax, extraTax)
          : d.metaVatKind === "vat"
            ? Math.round((Math.round(d.total) * 12) / 112)
            : 0;
    const net = Math.max(0, Math.round(d.total) - totalVat);

    const vatKind = d.metaVatKind ?? (totalVat > 0 ? "vat" : "none");
    const pType: PurchaseType =
      d.metaPurchaseType ??
      (docLines.some((l) => l.medicineId !== null) ? "other_goods" : d.kind === "expense" ? "services" : "other_goods");

    const byKind = { vatable: 0, zeroRated: 0, exempt: 0, nonVat: 0 };
    if (vatKind === "vat") byKind.vatable = sign * net;
    else if (vatKind === "zero") byKind.zeroRated = sign * net;
    else if (vatKind === "exempt") byKind.exempt = sign * net;
    else byKind.nonVat = sign * net;

    const byType: Record<PurchaseType, { netCentavos: number; vatCentavos: number }> = {
      services: { netCentavos: 0, vatCentavos: 0 },
      capital_goods: { netCentavos: 0, vatCentavos: 0 },
      other_goods: { netCentavos: 0, vatCentavos: 0 },
      importation: { netCentavos: 0, vatCentavos: 0 },
    };
    byType[pType] = { netCentavos: sign * net, vatCentavos: sign * totalVat };

    const ewtTax = Math.round(d.metaEwt > 0 ? d.metaEwt : d.withheld);
    const ewtBase = Math.round(d.metaEwtBase > 0 ? d.metaEwtBase : net);
    const held =
      d.metaAtc && ewtTax > 0
        ? [
            {
              atc: d.metaAtc,
              rateBp: d.metaAtcBp ?? WITHHOLDING[d.metaAtc]?.[1] ?? 0,
              baseCentavos: sign * ewtBase,
              taxCentavos: sign * ewtTax,
            },
          ]
        : [];

    const name = (d.supplierCompany || d.supplierName || d.partyName || "Supplier").trim();
    const origin =
      d.metaOrigin ??
      (d.supplierCountry && !/philippines|\bph\b/i.test(d.supplierCountry) ? "foreign" : /\b(ltd|limited)\b/i.test(name) ? "foreign" : "local");

    return {
      id: d.id,
      source: d.kind,
      on: d.on,
      no: d.number,
      reference: d.reference ?? "",
      payeeId: d.supplierId ? String(d.supplierId) : `party:${name.toUpperCase()}`,
      name,
      tin: d.supplierTin,
      address: d.supplierAddress,
      origin,
      void: d.voided,
      netCentavos: sign * net,
      vatCentavos: sign * totalVat,
      withheldCentavos: sign * ewtTax,
      byKind,
      byType,
      held,
      noWithholdingReason: d.metaNoReason,
      importation:
        pType === "importation" || d.ieirdNo
          ? {
              ieirdNo: d.ieirdNo,
              assessmentDate: d.assessmentDate,
              dutiableCentavos: Math.round(d.dutiable),
              vatCentavos: Math.round(d.importVat > 0 ? d.importVat : totalVat),
            }
          : null,
    };
  });
}

export async function purchaseJournal(db: Database, company: CompanyCode, start: string, end: string) {
  const list = await purchasesBetween(db, company, start, end, { withVoid: true });
  const out = list.map((pu) => ({
    id: pu.id,
    date: pu.on,
    no: pu.no,
    source: pu.source,
    supplierInvoiceNo: pu.reference,
    supplier: pu.name,
    tin: pu.tin,
    void: pu.void,
    atc: pu.held.map((h) => h.atc).join(", ") || null,
    totalCentavos: pu.void ? 0 : pu.netCentavos + pu.vatCentavos,
    vatableCentavos: pu.void ? 0 : pu.byKind.vatable,
    inputTaxCentavos: pu.void ? 0 : pu.vatCentavos,
    zeroRatedCentavos: pu.void ? 0 : pu.byKind.zeroRated,
    exemptCentavos: pu.void ? 0 : pu.byKind.exempt + pu.byKind.nonVat,
    ewtCentavos: pu.void ? 0 : pu.withheldCentavos,
    payableCentavos: pu.void ? 0 : pu.netCentavos + pu.vatCentavos - pu.withheldCentavos,
  }));
  const totals = out.reduce(
    (acc, r) => ({
      totalCentavos: acc.totalCentavos + r.totalCentavos,
      vatableCentavos: acc.vatableCentavos + r.vatableCentavos,
      inputTaxCentavos: acc.inputTaxCentavos + r.inputTaxCentavos,
      zeroRatedCentavos: acc.zeroRatedCentavos + r.zeroRatedCentavos,
      exemptCentavos: acc.exemptCentavos + r.exemptCentavos,
      ewtCentavos: acc.ewtCentavos + r.ewtCentavos,
      payableCentavos: acc.payableCentavos + r.payableCentavos,
    }),
    {
      totalCentavos: 0,
      vatableCentavos: 0,
      inputTaxCentavos: 0,
      zeroRatedCentavos: 0,
      exemptCentavos: 0,
      ewtCentavos: 0,
      payableCentavos: 0,
    },
  );
  return { rows: out, totals };
}

export async function slpReport(db: Database, company: CompanyCode, period: BirPeriod) {
  const list = await purchasesBetween(db, company, period.start, period.end);
  const by = new Map<
    string,
    {
      tin: string | null;
      name: string;
      address: string | null;
      exemptCentavos: number;
      zeroRatedCentavos: number;
      taxableCentavos: number;
      inputTaxCentavos: number;
      grossTaxableCentavos: number;
      servicesCentavos: number;
      servicesInputTaxCentavos: number;
      capitalGoodsCentavos: number;
      capitalGoodsInputTaxCentavos: number;
      otherGoodsCentavos: number;
      otherGoodsInputTaxCentavos: number;
      importationCentavos: number;
      importationInputTaxCentavos: number;
    }
  >();

  for (const pu of list) {
    const key = `${(pu.tin ?? "").trim()}::${pu.name.toUpperCase()}`;
    const row = by.get(key) ?? {
      tin: pu.tin,
      name: pu.name,
      address: pu.address,
      exemptCentavos: 0,
      zeroRatedCentavos: 0,
      taxableCentavos: 0,
      inputTaxCentavos: 0,
      grossTaxableCentavos: 0,
      servicesCentavos: 0,
      servicesInputTaxCentavos: 0,
      capitalGoodsCentavos: 0,
      capitalGoodsInputTaxCentavos: 0,
      otherGoodsCentavos: 0,
      otherGoodsInputTaxCentavos: 0,
      importationCentavos: 0,
      importationInputTaxCentavos: 0,
    };
    row.exemptCentavos += pu.byKind.exempt + pu.byKind.nonVat;
    row.zeroRatedCentavos += pu.byKind.zeroRated;
    row.taxableCentavos += pu.byKind.vatable;
    row.inputTaxCentavos += pu.vatCentavos;
    row.grossTaxableCentavos += pu.byKind.vatable + pu.vatCentavos;
    row.servicesCentavos += pu.byType.services.netCentavos;
    row.servicesInputTaxCentavos += pu.byType.services.vatCentavos;
    row.capitalGoodsCentavos += pu.byType.capital_goods.netCentavos;
    row.capitalGoodsInputTaxCentavos += pu.byType.capital_goods.vatCentavos;
    row.otherGoodsCentavos += pu.byType.other_goods.netCentavos;
    row.otherGoodsInputTaxCentavos += pu.byType.other_goods.vatCentavos;
    row.importationCentavos += pu.byType.importation.netCentavos;
    row.importationInputTaxCentavos += pu.byType.importation.vatCentavos;
    by.set(key, row);
  }

  const out = [...by.values()].sort((a, b) => a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
  const totals = out.reduce(
    (acc, r) => ({
      exemptCentavos: acc.exemptCentavos + r.exemptCentavos,
      zeroRatedCentavos: acc.zeroRatedCentavos + r.zeroRatedCentavos,
      taxableCentavos: acc.taxableCentavos + r.taxableCentavos,
      inputTaxCentavos: acc.inputTaxCentavos + r.inputTaxCentavos,
      grossTaxableCentavos: acc.grossTaxableCentavos + r.grossTaxableCentavos,
      servicesCentavos: acc.servicesCentavos + r.servicesCentavos,
      servicesInputTaxCentavos: acc.servicesInputTaxCentavos + r.servicesInputTaxCentavos,
      capitalGoodsCentavos: acc.capitalGoodsCentavos + r.capitalGoodsCentavos,
      capitalGoodsInputTaxCentavos: acc.capitalGoodsInputTaxCentavos + r.capitalGoodsInputTaxCentavos,
      otherGoodsCentavos: acc.otherGoodsCentavos + r.otherGoodsCentavos,
      otherGoodsInputTaxCentavos: acc.otherGoodsInputTaxCentavos + r.otherGoodsInputTaxCentavos,
      importationCentavos: acc.importationCentavos + r.importationCentavos,
      importationInputTaxCentavos: acc.importationInputTaxCentavos + r.importationInputTaxCentavos,
    }),
    {
      exemptCentavos: 0,
      zeroRatedCentavos: 0,
      taxableCentavos: 0,
      inputTaxCentavos: 0,
      grossTaxableCentavos: 0,
      servicesCentavos: 0,
      servicesInputTaxCentavos: 0,
      capitalGoodsCentavos: 0,
      capitalGoodsInputTaxCentavos: 0,
      otherGoodsCentavos: 0,
      otherGoodsInputTaxCentavos: 0,
      importationCentavos: 0,
      importationInputTaxCentavos: 0,
    },
  );
  return { rows: out, totals, missingTin: out.filter((r) => !r.tin || r.tin.replace(/\D/g, "").length < 9).length };
}

export async function sliReport(db: Database, company: CompanyCode, period: BirPeriod) {
  const list = (await purchasesBetween(db, company, period.start, period.end)).filter((pu) => pu.importation);
  const out = list.map((pu) => ({
    id: pu.id,
    date: pu.on,
    number: pu.no,
    supplier: pu.name,
    ieirdNo: pu.importation?.ieirdNo ?? null,
    assessmentDate: pu.importation?.assessmentDate ?? null,
    dutiableCentavos: pu.importation?.dutiableCentavos ?? 0,
    vatCentavos: pu.importation?.vatCentavos ?? pu.vatCentavos,
    landedTotalCentavos: pu.netCentavos + pu.vatCentavos,
  }));
  return {
    rows: out,
    totals: {
      dutiableCentavos: out.reduce((s, r) => s + r.dutiableCentavos, 0),
      vatCentavos: out.reduce((s, r) => s + r.vatCentavos, 0),
      landedTotalCentavos: out.reduce((s, r) => s + r.landedTotalCentavos, 0),
    },
    missingIeird: out.filter((r) => !r.ieirdNo).length,
  };
}

// ------------------------------------------------------------------ Cash Receipts & Disbursements Books

export async function cashReceiptsBook(db: Database, company: CompanyCode, start: string, end: string) {
  const list = await rows<{
    date: string;
    invoice: string;
    customer: string;
    tin: string | null;
    method: string;
    reference: string | null;
    cashCentavos: number;
    cwtCentavos: number;
    atc: string | null;
  }>(
    db,
    sql`select to_char(p.paid_on, 'YYYY-MM-DD') as date, i.code as invoice, c.name as customer, c.tin,
        p.method, p.reference,
        case when p.method in ('cash', 'bank', 'check', 'ewallet', 'other') then p.amount else 0 end::bigint::float8 as "cashCentavos",
        case when p.method = 'withholding' then p.amount else 0 end::bigint::float8 as "cwtCentavos",
        p.tax_atc as atc
      from payment p join invoice i on i.id = p.invoice_id join customer c on c.id = p.customer_id
      where p.active and i.invoice_from = ${company}
        and p.paid_on between ${start}::date and ${end}::date
      order by p.paid_on, p.id`,
  );
  const cash = list.reduce((s, r) => s + Math.round(r.cashCentavos), 0);
  const cwt = list.reduce((s, r) => s + Math.round(r.cwtCentavos), 0);
  return {
    rows: list.map((r) => ({
      ...r,
      cashCentavos: Math.round(r.cashCentavos),
      cwtCentavos: Math.round(r.cwtCentavos),
      receivablesCentavos: Math.round(r.cashCentavos) + Math.round(r.cwtCentavos),
    })),
    totals: { cashCentavos: cash, cwtCentavos: cwt, receivablesCentavos: cash + cwt },
  };
}

export async function cashDisbursementsBook(db: Database, company: CompanyCode, start: string, end: string) {
  const list = await rows<{
    date: string;
    number: string;
    kind: string;
    party: string;
    reference: string | null;
    fromAccount: string;
    amountCentavos: number;
  }>(
    db,
    sql`select to_char(d.doc_date, 'YYYY-MM-DD') as date, d.number, d.kind,
        coalesce(s.name, d.party_name, 'Payee') as party, d.reference,
        coalesce(d.money_account, 'Petty Cash') as "fromAccount",
        round(d.total * d.fx_rate)::bigint::float8 as "amountCentavos"
      from book_doc d left join supplier s on s.id = d.supplier_id
      where d.kind in ('vendor_payment', 'expense', 'refund')
        and d.company = ${company}
        and d.voided_at is null and d.status not in ('void', 'draft', 'pending_approval')
        and d.doc_date between ${start}::date and ${end}::date
      order by d.doc_date, d.id`,
  );
  const rowsOut = list.map((r) => ({ ...r, amountCentavos: Math.round(r.amountCentavos) }));
  return { rows: rowsOut, totals: { amountCentavos: rowsOut.reduce((s, r) => s + r.amountCentavos, 0) } };
}

// ------------------------------------------------------------------ 2550Q / 2551Q VAT Return

export async function vatReturn2550q(db: Database, company: CompanyCode, year: number, q: number) {
  const profile = await taxpayerProfile(db, company);
  const p = quarter(year, q, profile.fiscalMonthEnd);
  const months = monthsOf(p);

  const monthRows = [];
  for (const m of months) {
    const [sj, slp] = await Promise.all([salesJournal(db, company, m.start, m.end), slpReport(db, company, m)]);
    monthRows.push({
      label: m.label,
      start: m.start,
      end: m.end,
      taxableSalesCentavos: sj.totals.taxableSalesCentavos,
      zeroRatedSalesCentavos: sj.totals.zeroRatedSalesCentavos,
      exemptSalesCentavos: sj.totals.exemptSalesCentavos,
      taxCentavos: sj.totals.taxCentavos,
      purchasesCentavos: slp.totals.taxableCentavos + slp.totals.exemptCentavos + slp.totals.zeroRatedCentavos,
      inputTaxCentavos: slp.totals.inputTaxCentavos,
    });
  }

  const [sj, slp, sawt2550] = await Promise.all([
    salesJournal(db, company, p.start, p.end),
    slpReport(db, company, p),
    sawtReport(db, company, p, "2550Q"),
  ]);

  if (profile.regime === "non_vat") {
    const gross = sj.totals.grossCentavos;
    const rateBp = 300;
    const due = Math.round((gross * rateBp) / 10_000);
    return {
      form: "2551Q" as const,
      title: "Quarterly percentage tax return",
      company,
      year,
      quarter: q,
      period: p,
      taxpayer: profile,
      months: monthRows,
      lines: [
        { key: "gross", label: "Gross sales or receipts", amountCentavos: gross },
        { key: "rate", label: "Tax rate", rateBp },
        { key: "due", label: "Percentage tax due", amountCentavos: due },
      ],
      notes: ["Non-VAT taxpayer profile selected."],
    };
  }

  const output = sj.totals.taxCentavos;
  const input = slp.totals.inputTaxCentavos;
  const govVatCredited = sawt2550.totals.withheldCentavos;
  const netVat = output - input - govVatCredited;

  return {
    form: "2550Q" as const,
    title: "Quarterly value-added tax return",
    company,
    year,
    quarter: q,
    period: p,
    taxpayer: profile,
    months: monthRows,
    sawtVatWithheldCentavos: govVatCredited,
    totals: {
      taxableSalesCentavos: sj.totals.taxableSalesCentavos,
      zeroRatedSalesCentavos: sj.totals.zeroRatedSalesCentavos,
      exemptSalesCentavos: sj.totals.exemptSalesCentavos,
      outputVatCentavos: output,
      vatablePurchasesCentavos: slp.totals.taxableCentavos,
      otherPurchasesCentavos: slp.totals.zeroRatedCentavos + slp.totals.exemptCentavos,
      inputVatCentavos: input,
      govVatWithheldCentavos: govVatCredited,
      netVatPayableCentavos: netVat,
    },
    lines: [
      { key: "taxable", label: "VATable sales", amountCentavos: sj.totals.taxableSalesCentavos },
      { key: "zero_rated", label: "Zero-rated sales", amountCentavos: sj.totals.zeroRatedSalesCentavos },
      { key: "exempt", label: "VAT-exempt sales", amountCentavos: sj.totals.exemptSalesCentavos },
      {
        key: "total_sales",
        label: "Total sales",
        amountCentavos: sj.totals.taxableSalesCentavos + sj.totals.zeroRatedSalesCentavos + sj.totals.exemptSalesCentavos,
      },
      { key: "output", label: "Output VAT", amountCentavos: output },
      { key: "purchases", label: "VATable purchases (net of VAT)", amountCentavos: slp.totals.taxableCentavos },
      {
        key: "purchases_other",
        label: "Zero-rated, exempt and non-VAT purchases",
        amountCentavos: slp.totals.zeroRatedCentavos + slp.totals.exemptCentavos,
      },
      { key: "input", label: "Input VAT on purchases", amountCentavos: input },
      { key: "gov_vat", label: "Less: 5% Creditable VAT withheld (SAWT 2550Q / WV*)", amountCentavos: govVatCredited },
      ...Object.entries(PURCHASE_TYPES).flatMap(([kind, label]) => {
        const camel = kind.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
        const t = slp.totals as Record<string, number>;
        return [
          { key: `${kind}_purchases`, label: `${label}: purchases before VAT`, amountCentavos: t[`${camel}Centavos`] ?? 0 },
          { key: `${kind}_input`, label: `${label}: input VAT`, amountCentavos: t[`${camel}InputTaxCentavos`] ?? 0 },
        ];
      }),
      {
        key: "payable",
        label: netVat >= 0 ? "Net VAT payable" : "Excess input VAT, carried over",
        amountCentavos: Math.abs(netVat),
      },
    ],
    notes: [
      "Strictly filtered by company. Only 5% Gov't Creditable VAT (WV*) is credited here; 1%/2% EWT belongs on 1702Q.",
      "Review prior-quarter excess input VAT and actual remittances before electronic filing.",
    ],
  };
}

// ------------------------------------------------------------------ EWT Returns: 0619-E, 1601-EQ, QAP, 1604-E, 2307

function groupByAtc(purchases: BirPurchase[]) {
  const by = new Map<string, { atc: string; nature: string; rateBp: number; baseCentavos: number; taxCentavos: number }>();
  for (const pu of purchases) {
    for (const h of pu.held) {
      const key = `${h.atc}::${h.rateBp}`;
      const row = by.get(key) ?? {
        atc: h.atc,
        nature: WITHHOLDING[h.atc]?.[0] ?? h.atc,
        rateBp: h.rateBp,
        baseCentavos: 0,
        taxCentavos: 0,
      };
      row.baseCentavos += h.baseCentavos;
      row.taxCentavos += h.taxCentavos;
      by.set(key, row);
    }
  }
  return [...by.values()].sort((a, b) => a.atc.localeCompare(b.atc) || a.rateBp - b.rateBp);
}

function groupByPayee(purchases: BirPurchase[]) {
  const by = new Map<
    string,
    { supplierId: string; tin: string | null; payee: string; address: string | null; atc: string; nature: string; rateBp: number; baseCentavos: number; taxCentavos: number }
  >();
  for (const pu of purchases) {
    for (const h of pu.held) {
      const key = `${pu.payeeId}::${h.atc}::${h.rateBp}`;
      const row = by.get(key) ?? {
        supplierId: pu.payeeId,
        tin: pu.tin,
        payee: pu.name,
        address: pu.address,
        atc: h.atc,
        nature: WITHHOLDING[h.atc]?.[0] ?? h.atc,
        rateBp: h.rateBp,
        baseCentavos: 0,
        taxCentavos: 0,
      };
      row.baseCentavos += h.baseCentavos;
      row.taxCentavos += h.taxCentavos;
      by.set(key, row);
    }
  }
  return [...by.values()].sort((a, b) => a.payee.toUpperCase().localeCompare(b.payee.toUpperCase()) || a.atc.localeCompare(b.atc));
}

export async function form0619e(db: Database, company: CompanyCode, year: number, month: number) {
  const profile = await taxpayerProfile(db, company);
  const p = monthPeriod(year, month);
  const purchases = (await purchasesBetween(db, company, p.start, p.end)).filter((pu) => pu.held.length > 0);
  const rowsOut = groupByAtc(purchases);
  return {
    form: "0619E" as const,
    title: "Monthly remittance of expanded withholding tax",
    company,
    year,
    month,
    period: p,
    taxpayer: profile,
    rows: rowsOut,
    totalCentavos: rowsOut.reduce((s, r) => s + r.taxCentavos, 0),
  };
}

export async function form1601eq(db: Database, company: CompanyCode, year: number, q: number) {
  const profile = await taxpayerProfile(db, company);
  // BIR withholding quarters are strictly calendar quarters (fiscal_month_end = 12).
  const p = calendarQuarter(year, q);
  const months = monthsOf(p);
  const purchases = (await purchasesBetween(db, company, p.start, p.end)).filter((pu) => pu.held.length > 0);
  const rowsOut = groupByAtc(purchases);

  const remitted = [];
  for (const m of months.slice(0, 2)) {
    const mNum = Number(m.start.slice(5, 7));
    const mData = await form0619e(db, company, year, mNum);
    remitted.push({ label: m.label, amountCentavos: null, calculatedWithholdingCentavos: mData.totalCentavos });
  }

  return {
    form: "1601EQ" as const,
    title: "Quarterly remittance return of creditable income taxes withheld (expanded)",
    company,
    year,
    quarter: q,
    period: p,
    taxpayer: profile,
    rows: rowsOut,
    totalCentavos: rowsOut.reduce((s, r) => s + r.taxCentavos, 0),
    remitted,
    dueCentavos: null,
    notes: [
      "Calendar quarter enforced (NABHI_FINANCE 0.4.62). Monthly withholding is calculated from the books, not proof of BIR remittance.",
    ],
  };
}

export async function qapReport(db: Database, company: CompanyCode, year: number, q: number) {
  const p = calendarQuarter(year, q);
  const purchases = (await purchasesBetween(db, company, p.start, p.end)).filter((pu) => pu.held.length > 0);
  const rowsOut = groupByPayee(purchases);
  return {
    period: p,
    rows: rowsOut,
    totals: {
      baseCentavos: rowsOut.reduce((s, r) => s + r.baseCentavos, 0),
      taxCentavos: rowsOut.reduce((s, r) => s + r.taxCentavos, 0),
    },
    missingTin: rowsOut.filter((r) => !r.tin || r.tin.replace(/\D/g, "").length < 9).length,
  };
}

export async function form1604e(db: Database, company: CompanyCode, year: number) {
  const profile = await taxpayerProfile(db, company);
  const p: BirPeriod = { start: `${year}-01-01`, end: `${year}-12-31`, label: `Year ${year}` };
  const purchases = (await purchasesBetween(db, company, p.start, p.end)).filter((pu) => pu.held.length > 0);
  const payees = groupByPayee(purchases);
  return {
    form: "1604E" as const,
    title: "Annual information return of creditable income taxes withheld (expanded)",
    company,
    year,
    period: p,
    taxpayer: profile,
    payees,
    byAtc: groupByAtc(purchases),
    totals: {
      baseCentavos: payees.reduce((s, r) => s + r.baseCentavos, 0),
      taxCentavos: payees.reduce((s, r) => s + r.taxCentavos, 0),
    },
  };
}

export async function withheldSuppliers(db: Database, company: CompanyCode, year: number, q: number) {
  const p = calendarQuarter(year, q);
  const purchases = (await purchasesBetween(db, company, p.start, p.end)).filter((pu) => pu.held.length > 0);
  const seen = new Map<string, { id: string; name: string; tin: string | null; taxCentavos: number }>();
  for (const pu of purchases) {
    const row = seen.get(pu.payeeId) ?? { id: pu.payeeId, name: pu.name, tin: pu.tin, taxCentavos: 0 };
    row.taxCentavos += pu.held.reduce((s, h) => s + h.taxCentavos, 0);
    seen.set(pu.payeeId, row);
  }
  return [...seen.values()].sort((a, b) => a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
}

export async function form2307(
  db: Database,
  company: CompanyCode,
  opts: { year: number; q: number; month?: number | null; supplierId?: string | null; docId?: number | null },
) {
  const profile = await taxpayerProfile(db, company);
  const qPeriod = calendarQuarter(opts.year, opts.q);
  const months = monthsOf(qPeriod);

  let effectivePeriod = qPeriod;
  if (opts.month != null) {
    const matching = months.find((m) => Number(m.start.slice(5, 7)) === opts.month);
    if (!matching) {
      throw new Refusal(400, "invalid", "Pick a month belonging to the selected quarter.", "month");
    }
    effectivePeriod = matching;
  }

  const numericSupplier = opts.supplierId && /^\d+$/.test(opts.supplierId) ? Number(opts.supplierId) : null;
  const purchases = (
    await purchasesBetween(db, company, effectivePeriod.start, effectivePeriod.end, {
      supplierId: numericSupplier,
      docId: opts.docId ?? null,
    })
  ).filter((pu) => pu.held.length > 0 && (!opts.supplierId || pu.payeeId === opts.supplierId));

  const by = new Map<
    string,
    { atc: string; nature: string; rateBp: number; months: [number, number, number]; baseCentavos: number; taxCentavos: number }
  >();
  for (const pu of purchases) {
    const slot = monthSlotInQuarter(pu.on, months);
    if (slot < 0) continue;
    for (const h of pu.held) {
      const key = `${h.atc}::${h.rateBp}`;
      const row = by.get(key) ?? {
        atc: h.atc,
        nature: WITHHOLDING[h.atc]?.[0] ?? h.atc,
        rateBp: h.rateBp,
        months: [0, 0, 0],
        baseCentavos: 0,
        taxCentavos: 0,
      };
      row.months[slot]! += h.baseCentavos;
      row.baseCentavos += h.baseCentavos;
      row.taxCentavos += h.taxCentavos;
      by.set(key, row);
    }
  }

  let payee: { id: string | null; name: string | null; tin: string | null; address: string | null; branchCode: string } = {
    id: opts.supplierId ?? null,
    name: purchases[0]?.name ?? null,
    tin: purchases[0]?.tin ?? null,
    address: purchases[0]?.address ?? null,
    branchCode: "00000",
  };
  if (numericSupplier) {
    const [sup] = await rows<{ name: string; companyName: string | null; tin: string | null; address: string | null }>(
      db,
      sql`select name, company_name as "companyName", tin,
          coalesce(nullif(trim(billing_address), ''), nullif(trim(shipping_address), '')) as address
        from supplier where id = ${numericSupplier}`,
    );
    if (sup) {
      payee = {
        id: String(numericSupplier),
        name: (sup.companyName || sup.name).trim(),
        tin: sup.tin,
        address: sup.address,
        branchCode: "00000",
      };
    }
  }

  const rowsOut = [...by.values()].sort((a, b) => a.atc.localeCompare(b.atc));
  return {
    form: "2307" as const,
    title: "Certificate of creditable tax withheld at source",
    company,
    year: opts.year,
    quarter: opts.q,
    month: opts.month ?? null,
    period: effectivePeriod,
    taxpayer: profile,
    certificate: {
      payee,
      monthLabels: months.map((m) => m.label),
      rows: rowsOut,
      totals: {
        baseCentavos: rowsOut.reduce((s, r) => s + r.baseCentavos, 0),
        taxCentavos: rowsOut.reduce((s, r) => s + r.taxCentavos, 0),
      },
    },
  };
}

// ------------------------------------------------------------------ 1702Q Income Tax & 1601-C Compensation

export async function incomeTax1702q(
  db: Database,
  company: CompanyCode,
  year: number,
  q: number,
  rateBp = 2500,
) {
  if (![1, 2, 3].includes(q)) {
    throw new Refusal(400, "invalid", "BIR Form 1702Q covers Q1, Q2, and Q3 only; Q4 is filed on 1702-RT.", "quarter");
  }
  if (![2000, 2500].includes(rateBp)) {
    throw new Refusal(400, "invalid", "Corporate income tax rate must be 20% or 25%.", "rateBp");
  }
  const profile = await taxpayerProfile(db, company);
  const p = quarter(year, q, profile.fiscalMonthEnd);

  const [sj, slp, sawt1702, cogsRow, payrollRow] = await Promise.all([
    salesJournal(db, company, p.start, p.end),
    slpReport(db, company, p),
    sawtReport(db, company, p, "1702Q"),
    rows<{ cogs: number }>(
      db,
      sql`select coalesce(sum((-m.qty)::bigint * coalesce(m.unit_cost, b.unit_cost)), 0)::bigint::float8 as cogs
          from stock_move m
            join batch b on b.id = m.batch_id
            join sales_order o on o.code = m.ref and o.invoice_from = ${company}
          where m.kind in ('deliver', 'return') and coalesce(m.ref, '') <> 'GO-LIVE'
            and coalesce(m.unit_cost, b.unit_cost) > 0
            and (m.at at time zone 'Asia/Manila')::date between ${p.start}::date and ${p.end}::date`,
    ),
    rows<{ gross: number }>(
      db,
      sql`select coalesce(sum(ps.gross), 0)::bigint::float8 as gross
          from payslip ps join pay_run pr on pr.id = ps.run_id
          where ps.company = ${company} and pr.period_to between ${p.start}::date and ${p.end}::date`,
    ),
  ]);

  const grossSales = sj.totals.taxableSalesCentavos + sj.totals.zeroRatedSalesCentavos + sj.totals.exemptSalesCentavos;
  const crmCogs = Math.max(0, Math.round(cogsRow[0]?.cogs ?? 0));
  const purchaseGoods = slp.totals.otherGoodsCentavos;
  const costOfSales = crmCogs > 0 ? crmCogs : purchaseGoods;
  const opexPurchases = slp.totals.servicesCentavos;
  const payrollCost = Math.round(payrollRow[0]?.gross ?? 0);
  const operatingExpenses = opexPurchases + payrollCost;

  const grossIncome = grossSales - costOfSales;
  const netBookIncome = grossIncome - operatingExpenses;
  const taxableIncome = Math.max(0, netBookIncome);
  const rcit = Math.round((taxableIncome * rateBp) / 10_000);
  const mcitBp = 200;
  const mcit = Math.round((Math.max(0, grossIncome) * mcitBp) / 10_000);
  const taxDue = Math.max(rcit, mcit);
  // Strictly uses 1702Q SAWT so 5% WV* VAT withholding never inflates CWT credits.
  const cwtCredits = sawt1702.totals.withheldCentavos;
  const netPayable = taxDue - cwtCredits;

  return {
    form: "1702Q" as const,
    title: "Quarterly income tax return (corporations)",
    company,
    year,
    quarter: q,
    period: p,
    taxpayer: profile,
    rateBp,
    mcitRateBp: mcitBp,
    lines: [
      { key: "gross_sales", label: "Sales / revenues / receipts / fees (net of VAT)", amountCentavos: grossSales },
      { key: "cost_of_sales", label: "Less: Cost of sales / services", amountCentavos: costOfSales },
      { key: "gross_income", label: "Gross income from operations", amountCentavos: grossIncome },
      { key: "operating_expenses", label: "Less: Operating expenses (services + released payroll)", amountCentavos: operatingExpenses },
      { key: "net_book_income", label: "Net income / (loss) per books", amountCentavos: netBookIncome },
      { key: "taxable_income", label: "Taxable income (this quarter)", amountCentavos: taxableIncome },
      { key: "rcit", label: `Regular corporate income tax (${rateBp / 100}%)`, amountCentavos: rcit },
      { key: "mcit", label: "Minimum corporate income tax (2% of gross income)", amountCentavos: mcit },
      { key: "tax_due", label: "Income tax due (higher of RCIT or MCIT)", amountCentavos: taxDue },
      { key: "cwt_credits", label: "Less: Creditable withholding tax (SAWT 1702Q only)", amountCentavos: cwtCredits },
      {
        key: "net_payable",
        label: netPayable >= 0 ? "Net income tax payable / (overpayment)" : "Excess tax credits / (overpayment)",
        amountCentavos: netPayable,
      },
    ],
    totals: {
      grossSalesCentavos: grossSales,
      costOfSalesCentavos: costOfSales,
      grossIncomeCentavos: grossIncome,
      operatingExpensesCentavos: operatingExpenses,
      netBookIncomeCentavos: netBookIncome,
      taxableIncomeCentavos: taxableIncome,
      rcitCentavos: rcit,
      mcitCentavos: mcit,
      taxDueCentavos: taxDue,
      cwtCreditsCentavos: cwtCredits,
      netPayableCentavos: netPayable,
    },
    notes: [
      "Working draft computed strictly for the selected company. Only 1702Q SAWT (excluding 5% WV* VAT withholding) is credited here.",
      "Review manual journal expenses, depreciation, and prior-quarter excess MCIT/credits before filing.",
    ],
  };
}

export async function compensation1601c(db: Database, company: CompanyCode, year: number, month: number) {
  const profile = await taxpayerProfile(db, company);
  const p = monthPeriod(year, month);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  const slips = await rows<{
    personId: number;
    name: string;
    tin: string | null;
    gross: number;
    tax: number;
    net: number;
    slip: {
      deductions?: { key: string; amount: number }[];
      earnings?: { key: string; label?: string; amount: number; taxable?: boolean }[];
    } | string;
  }>(
    db,
    sql`select ps.person_id::int as "personId", p.name, e.tin,
        ps.gross::bigint::float8 as gross, ps.tax::bigint::float8 as tax,
        ps.net::bigint::float8 as net, ps.slip
      from payslip ps
        join person p on p.id = ps.person_id
        left join employee e on e.person_id = ps.person_id
      where ps.company = ${company} and ps.month = ${monthKey}
      order by p.name`,
  );

  const out = slips.map((s) => {
    const parsed = typeof s.slip === "string" ? JSON.parse(s.slip) : s.slip;
    const ded = parsed?.deductions ?? [];
    const stat = ded
      .filter((d: { key: string }) => ["sss", "philhealth", "pagibig"].includes(d.key))
      .reduce((sum: number, d: { amount: number }) => sum + Math.round(d.amount ?? 0), 0);
    const gross = Math.round(s.gross);
    const tax = Math.round(s.tax);
    const taxable = Math.max(0, gross - stat);
    return {
      personId: s.personId,
      name: s.name,
      tin: s.tin,
      grossCentavos: gross,
      nonTaxableStatCentavos: stat,
      taxableCentavos: taxable,
      taxWithheldCentavos: tax,
      netCentavos: Math.round(s.net),
    };
  });

  return {
    form: "1601C" as const,
    title: "Monthly remittance return of income taxes withheld on compensation",
    company,
    year,
    month,
    monthKey,
    period: p,
    taxpayer: profile,
    rows: out,
    totals: {
      employees: out.length,
      grossCentavos: out.reduce((s, r) => s + r.grossCentavos, 0),
      nonTaxableStatCentavos: out.reduce((s, r) => s + r.nonTaxableStatCentavos, 0),
      taxableCentavos: out.reduce((s, r) => s + r.taxableCentavos, 0),
      taxWithheldCentavos: out.reduce((s, r) => s + r.taxWithheldCentavos, 0),
    },
    notes: out.length
      ? ["Read directly from HR's released monthly payslips for this company."]
      : ["No released HR payslips found for this company and month."],
  };
}

// ------------------------------------------------------------------ Filing Log

export async function filingLogList(db: Database, me: Me, company: CompanyCode) {
  assertBirEnabled();
  mayReadLedger(me);
  return rows<{
    id: number;
    company: CompanyCode;
    formCode: string;
    periodLabel: string;
    periodFrom: string;
    periodTo: string;
    filedOn: string | null;
    referenceNo: string | null;
    amountDueCentavos: number | null;
    status: string;
    notes: string | null;
    byPerson: string | null;
    at: string;
  }>(
    db,
    sql`select l.id::int as id, l.company, l.form_code as "formCode", l.period_label as "periodLabel",
        to_char(l.period_from, 'YYYY-MM-DD') as "periodFrom",
        to_char(l.period_to, 'YYYY-MM-DD') as "periodTo",
        to_char(l.filed_on, 'YYYY-MM-DD') as "filedOn",
        l.reference_no as "referenceNo", l.amount_due_centavos::float8 as "amountDueCentavos",
        l.status, l.notes, p.name as "byPerson", l.at::text as at
      from bir_filing_log l left join person p on p.id = l.by_person
      where l.company = ${company}
      order by l.period_from desc, l.id desc limit 100`,
  );
}

export async function saveFilingLog(
  db: Database,
  me: Me,
  input: {
    company: CompanyCode;
    formCode: string;
    periodLabel: string;
    periodFrom: string;
    periodTo: string;
    filedOn?: string | null;
    referenceNo?: string | null;
    amountDueCentavos?: number | null;
    status: "draft" | "filed" | "paid" | "amended";
    notes?: string | null;
  },
): Promise<{ id: number }> {
  assertBirEnabled();
  mayReadLedger(me);
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into bir_filing_log (company, form_code, period_label, period_from, period_to, filed_on, reference_no, amount_due_centavos, status, notes, by_person)
        values (${input.company}, ${input.formCode.trim()}, ${input.periodLabel.trim()},
          ${input.periodFrom}::date, ${input.periodTo}::date,
          ${input.filedOn ? sql`${input.filedOn}::date` : sql`null`},
          ${input.referenceNo?.trim() || null},
          ${input.amountDueCentavos ?? null},
          ${input.status}, ${input.notes?.trim() || null}, ${me.id})
        returning id::int as id`,
  );
  return { id: made?.id as number };
}
