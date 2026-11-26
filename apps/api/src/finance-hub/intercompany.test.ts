import { describe, expect, it } from "vitest";
import {
  buildIntercompanyPaymentLegs,
  detectCrossCompany,
  summarizeIntercompanyPosition,
} from "./intercompany";

describe("Intercompany clearing (2MG <-> GPI)", () => {
  it("flags cross-company payments clearly and generates balanced per-company legs that eliminate to 0", () => {
    const same = detectCrossCompany("2mg", "2mg", "2MG BDO", 200_000);
    expect(same.isCrossCompany).toBe(false);
    expect(same.summary).toBeNull();

    const cross = detectCrossCompany("2mg", "gpi", "GPI GCash QR", 200_000);
    expect(cross.isCrossCompany).toBe(true);
    expect(cross.summary).toContain("Advances to GPI");
    expect(cross.summary).toContain("2MG invoice -> GPI account");

    // Combined ₱5,000 GCash transfer into GPI's GCash settling ₱3,000 GPI + ₱2,000 2MG:
    const gpiLegs = buildIntercompanyPaymentLegs({
      invoiceCompany: "gpi",
      bankCompany: "gpi",
      bankAccount: "GPI GCash QR",
      amountCentavos: 300_000,
    });
    const crossLegs = buildIntercompanyPaymentLegs({
      invoiceCompany: "2mg",
      bankCompany: "gpi",
      bankAccount: "GPI GCash QR",
      amountCentavos: 200_000,
    });
    const all = [...gpiLegs, ...crossLegs];

    // 1. GPI's GCash receives full ₱5,000 (bank recon balances to the centavo)
    const gpiCashNet = all
      .filter((l) => l.company === "gpi" && l.account === "GPI GCash QR")
      .reduce((s, l) => s + l.debit - l.credit, 0);
    expect(gpiCashNet).toBe(500_000);

    // 2. 2MG's books balance independently (Dr Advances to GPI ₱2,000 / Cr AR ₱2,000)
    const twomgNet = all.filter((l) => l.company === "2mg").reduce((s, l) => s + l.debit - l.credit, 0);
    expect(twomgNet).toBe(0);

    // 3. GPI's books balance independently
    const gpiNet = all.filter((l) => l.company === "gpi").reduce((s, l) => s + l.debit - l.credit, 0);
    expect(gpiNet).toBe(0);

    // 4. Consolidated intercompany accounts eliminate to ₱0
    const icConsolidatedNet = all.filter((l) => l.isIntercompany).reduce((s, l) => s + l.debit - l.credit, 0);
    expect(icConsolidatedNet).toBe(0);
  });

  it("summarizes two-way unsettled balances and net transfer direction", () => {
    const summary = summarizeIntercompanyPosition([
      { invoiceCompany: "2mg", bankCompany: "gpi", amountCentavos: 200_000, settledCentavos: 0 },
      { invoiceCompany: "2mg", bankCompany: "gpi", amountCentavos: 100_000, settledCentavos: 100_000 },
      { invoiceCompany: "gpi", bankCompany: "2mg", amountCentavos: 75_000, settledCentavos: 0 },
      { invoiceCompany: "gpi", bankCompany: "gpi", amountCentavos: 300_000, settledCentavos: 0 },
    ]);
    expect(summary).toEqual({
      gpiOwes2mgCentavos: 200_000,
      twomgOwesGpiCentavos: 75_000,
      netDirection: "gpi_to_2mg",
      netAmountCentavos: 125_000,
    });
  });
});
