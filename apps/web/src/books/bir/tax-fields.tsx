import type { BirTaxInput } from "@2mg/api/types";
import { useEffect, useState } from "react";
import { zMoney } from "../kinds";

const EWT_ATCS: { code: string; label: string; bp: number }[] = [
  { code: "WC850", label: "WC850 — 0.5% Direct pharma goods / e-marketplace", bp: 50 },
  { code: "WC158", label: "WC158 — 1% Goods (Company / TAMP)", bp: 100 },
  { code: "WI158", label: "WI158 — 1% Goods (Individual / TAMP)", bp: 100 },
  { code: "WC160", label: "WC160 — 2% Services (Company / TAMP)", bp: 200 },
  { code: "WI160", label: "WI160 — 2% Services (Individual / TAMP)", bp: 200 },
  { code: "WC120", label: "WC120 — 2% Contractors (Company)", bp: 200 },
  { code: "WI120", label: "WI120 — 2% Contractors (Individual)", bp: 200 },
  { code: "WC100", label: "WC100 — 5% Rent (Company)", bp: 500 },
  { code: "WI100", label: "WI100 — 5% Rent (Individual)", bp: 500 },
  { code: "WI010", label: "WI010 — 5% Professional fees (Indiv ≤ ₱3M)", bp: 500 },
  { code: "WC010", label: "WC010 — 10% Professional fees (Company ≤ ₱720k)", bp: 1000 },
  { code: "WI011", label: "WI011 — 10% Professional fees (Indiv > ₱3M)", bp: 1000 },
  { code: "WC011", label: "WC011 — 15% Professional fees (Company > ₱720k)", bp: 1500 },
  { code: "WC140", label: "WC140 — 15% Brokerage fees (Company > ₱720k)", bp: 1500 },
];

const pesosToCents = (raw: string): number | null => {
  const clean = raw.replace(/[₱,\s]/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

const shareBp = (cents: number, bp: number) => Math.floor((cents * bp + 5_000) / 10_000);

export type BirTaxDraft = {
  supplierOrigin: "local" | "foreign";
  originTouched: boolean;
  vatKind: "" | "vat" | "zero" | "exempt" | "none";
  manualVat: string;
  purchaseType: "" | "services" | "capital_goods" | "other_goods" | "importation";
  atcCode: string;
  ewtOverride: string;
  noWithholdingReason: "" | "not_covered" | "government" | "exempt_charge" | "other";
  noWithholdingNote: string;
  importIeirdNo: string;
  importAssessmentDate: string;
  importDutiable: string;
  importVat: string;
};

export function useBirTaxDraft(defaultPurchaseType: "other_goods" | "services" = "other_goods", partyName?: string | null) {
  const [draft, setDraft] = useState<BirTaxDraft>({
    supplierOrigin: "local",
    originTouched: false,
    vatKind: "",
    manualVat: "",
    purchaseType: defaultPurchaseType,
    atcCode: "",
    ewtOverride: "",
    noWithholdingReason: "",
    noWithholdingNote: "",
    importIeirdNo: "",
    importAssessmentDate: "",
    importDutiable: "",
    importVat: "",
  });

  useEffect(() => {
    if (draft.originTouched || !partyName) return;
    const inferred = /\b(ltd|limited)\b/i.test(partyName) ? "foreign" : "local";
    setDraft((prev) => ({
      ...prev,
      supplierOrigin: inferred,
      atcCode: inferred === "foreign" ? "" : prev.atcCode,
    }));
  }, [partyName, draft.originTouched]);

  function toPayload(netSubTotalCentavos: number, grossTotalCentavos: number): BirTaxInput | null {
    const manualVatCentavos = pesosToCents(draft.manualVat);
    const importVatCentavos = pesosToCents(draft.importVat);
    const importDutiableCentavos = pesosToCents(draft.importDutiable);
    const baseNet =
      manualVatCentavos != null
        ? Math.max(0, grossTotalCentavos - manualVatCentavos)
        : draft.purchaseType === "importation" && importVatCentavos != null
          ? Math.max(0, grossTotalCentavos - importVatCentavos)
          : netSubTotalCentavos;
    const atc = draft.supplierOrigin === "foreign" ? null : draft.atcCode || null;
    const bp = atc ? (EWT_ATCS.find((a) => a.code === atc)?.bp ?? 0) : 0;
    const computedEwt = atc ? shareBp(baseNet, bp) : 0;
    const overrideEwt = pesosToCents(draft.ewtOverride);

    return {
      supplierOrigin: draft.supplierOrigin,
      vatKind: draft.vatKind || null,
      manualVatCentavos,
      purchaseType: draft.purchaseType || null,
      atcCode: atc,
      ewtBaseCentavos: atc ? baseNet : null,
      ewtCentavos: atc ? (overrideEwt ?? computedEwt) : null,
      noWithholdingReason: draft.supplierOrigin === "foreign" ? "foreign" : atc ? null : draft.noWithholdingReason || null,
      noWithholdingNote: draft.noWithholdingNote.trim() || null,
      importIeirdNo: draft.purchaseType === "importation" ? draft.importIeirdNo.trim() || null : null,
      importAssessmentDate: draft.purchaseType === "importation" ? draft.importAssessmentDate || null : null,
      importDutiableCentavos: draft.purchaseType === "importation" ? importDutiableCentavos : null,
      importVatCentavos: draft.purchaseType === "importation" ? importVatCentavos : null,
    };
  }

  return { draft, setDraft, toPayload };
}

const INPUT_CLS = "h-[34px] w-full rounded-[5px] border border-[#d7d5e2] bg-white px-2.5 text-[13px] text-[#212529] outline-none focus:border-[#408dfb]";

export function BirBillTaxSection({
  draft,
  setDraft,
  subTotalCentavos,
  totalCentavos,
}: {
  draft: BirTaxDraft;
  setDraft: (next: BirTaxDraft) => void;
  subTotalCentavos: number;
  totalCentavos: number;
}) {
  const manualVatCents = pesosToCents(draft.manualVat);
  const importVatCents = pesosToCents(draft.importVat);
  const ewtBase =
    manualVatCents != null
      ? Math.max(0, totalCentavos - manualVatCents)
      : draft.purchaseType === "importation" && importVatCents != null
        ? Math.max(0, totalCentavos - importVatCents)
        : subTotalCentavos;
  const activeAtc = EWT_ATCS.find((a) => a.code === draft.atcCode);
  const autoEwt = draft.supplierOrigin === "local" && activeAtc ? shareBp(ewtBase, activeAtc.bp) : 0;
  const effectiveEwt = draft.supplierOrigin === "local" && activeAtc ? (pesosToCents(draft.ewtOverride) ?? autoEwt) : 0;

  return (
    <div className="mx-5 my-3 rounded-md border border-[#ebeaf2] bg-[#fbfbfe] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-[#212529]">BIR Tax, EWT (Form 2307) & SLP / SLI Classification</div>
          <div className="text-[11.5px] text-[#6c718a]">
            Click an ATC to auto-compute Expanded Withholding Tax net of VAT, or enter an exact VAT override for partial-VAT bills (e.g. Meralco).
          </div>
        </div>
        {effectiveEwt > 0 && (
          <div className="rounded bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800">
            EWT ({draft.atcCode}): -{zMoney(effectiveEwt)} · Net Payable: {zMoney(Math.max(0, totalCentavos - effectiveEwt))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
          Supplier Origin
          <select
            className={INPUT_CLS}
            value={draft.supplierOrigin}
            onChange={(e) => {
              const origin = e.target.value as "local" | "foreign";
              setDraft({ ...draft, supplierOrigin: origin, originTouched: true, atcCode: origin === "foreign" ? "" : draft.atcCode });
            }}
          >
            <option value="local">Local (PH — subject to EWT/TAMP)</option>
            <option value="foreign">Foreign (No PH EWT)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
          Purchase Type (SLP / SLI)
          <select
            className={INPUT_CLS}
            value={draft.purchaseType}
            onChange={(e) => setDraft({ ...draft, purchaseType: e.target.value as BirTaxDraft["purchaseType"] })}
          >
            <option value="other_goods">Other Goods (Medicines / Supplies)</option>
            <option value="services">Services (Utilities / Rent / Freight)</option>
            <option value="capital_goods">Capital Goods</option>
            <option value="importation">Importation (BOC / SLI)</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
          VAT Classification
          <select
            className={INPUT_CLS}
            value={draft.vatKind}
            onChange={(e) => setDraft({ ...draft, vatKind: e.target.value as BirTaxDraft["vatKind"] })}
          >
            <option value="">Auto from line tax</option>
            <option value="vat">VAT-able (12%)</option>
            <option value="zero">Zero-Rated (0%)</option>
            <option value="exempt">VAT-Exempt</option>
            <option value="none">Non-VAT Supplier</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
          Manual Input VAT Override (₱, optional)
          <input
            className={INPUT_CLS}
            inputMode="decimal"
            placeholder="e.g. exact Meralco VAT"
            value={draft.manualVat}
            onChange={(e) => setDraft({ ...draft, manualVat: e.target.value })}
          />
        </label>
      </div>

      {draft.supplierOrigin === "local" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
            Withholding Tax Code (ATC — Form 2307)
            <select
              className={INPUT_CLS}
              value={draft.atcCode}
              onChange={(e) => setDraft({ ...draft, atcCode: e.target.value, ewtOverride: "" })}
            >
              <option value="">No EWT withheld on this document</option>
              {EWT_ATCS.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
            </select>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {[
                ["WC158", "1% Goods"],
                ["WC160", "2% Services"],
                ["WC850", "0.5% Pharma"],
                ["WC100", "5% Rent"],
              ].map(([code, short]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setDraft({ ...draft, atcCode: draft.atcCode === code ? "" : (code as string), ewtOverride: "" })}
                  className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                    draft.atcCode === code ? "border-[#408dfb] bg-[#408dfb] text-white" : "border-[#d7d5e2] bg-white text-[#4b4f63] hover:bg-[#f1f1fa]"
                  }`}
                >
                  {code} · {short}
                </button>
              ))}
            </div>
          </label>

          {draft.atcCode ? (
            <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
              EWT Amount (₱, auto: {(autoEwt / 100).toFixed(2)} on {zMoney(ewtBase)} net)
              <input
                className={INPUT_CLS}
                inputMode="decimal"
                placeholder={(autoEwt / 100).toFixed(2)}
                value={draft.ewtOverride}
                onChange={(e) => setDraft({ ...draft, ewtOverride: e.target.value })}
              />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
                Reason if No EWT Withheld (TAMP Audit)
                <select
                  className={INPUT_CLS}
                  value={draft.noWithholdingReason}
                  onChange={(e) => setDraft({ ...draft, noWithholdingReason: e.target.value as BirTaxDraft["noWithholdingReason"] })}
                >
                  <option value="">Leave unset / withhold on payment</option>
                  <option value="not_covered">Payee not covered or tax-exempt</option>
                  <option value="government">Government / statutory agency</option>
                  <option value="exempt_charge">Reimbursement / exempt pass-through</option>
                  <option value="other">Other (specify note)</option>
                </select>
              </label>
              {draft.noWithholdingReason === "other" && (
                <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
                  Exemption Note
                  <input
                    className={INPUT_CLS}
                    placeholder="Explain why no EWT applies"
                    value={draft.noWithholdingNote}
                    onChange={(e) => setDraft({ ...draft, noWithholdingNote: e.target.value })}
                  />
                </label>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[#6c718a]">
          Foreign supplier selected — excluded from local TAMP EWT withholding checks automatically.
        </p>
      )}

      {draft.purchaseType === "importation" && (
        <div className="mt-3 grid gap-3 border-t border-[#ebeaf2] pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
            BOC Import Entry / IEIRD #
            <input className={INPUT_CLS} value={draft.importIeirdNo} onChange={(e) => setDraft({ ...draft, importIeirdNo: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
            BOC Assessment Date
            <input type="date" className={INPUT_CLS} value={draft.importAssessmentDate} onChange={(e) => setDraft({ ...draft, importAssessmentDate: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
            Dutiable Value (₱)
            <input className={INPUT_CLS} inputMode="decimal" placeholder="0.00" value={draft.importDutiable} onChange={(e) => setDraft({ ...draft, importDutiable: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#4b4f63]">
            BOC Import VAT Paid (₱)
            <input className={INPUT_CLS} inputMode="decimal" placeholder="0.00" value={draft.importVat} onChange={(e) => setDraft({ ...draft, importVat: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
