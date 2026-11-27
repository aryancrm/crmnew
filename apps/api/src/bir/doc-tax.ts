// Saves optional Philippine BIR tax metadata (ATC, local/foreign origin, manual VAT override,
// SLI customs fields, or no-withholding reason) on Books bills and expenses inside the same DB tx.

import { sql } from "drizzle-orm";
import { rows } from "../db/index";
import { Refusal } from "../http";
import type { Runner } from "../inventory/service";
import type { BirTaxInput, Me } from "../types";
import { originByName, share, WITHHOLDING, withholdingDecision } from "./ewt";

const clean = (v?: string | null) => v?.trim() || null;

/** Whole centavos shared out by the weights (equally when they are all 0); the last share takes the
 *  rounding, so the shares always add up to the whole. */
export function spread(whole: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let given = 0;
  weights.forEach((weight, n) => {
    const part = n === weights.length - 1 ? whole - given : Math.round(sum ? (whole * weight) / sum : whole / weights.length);
    out.push(part);
    given += part;
  });
  return out;
}

export async function saveDocBirTaxMeta(
  tx: Runner,
  me: Me,
  docId: number,
  doc: {
    kind: "bill" | "expense";
    totalCentavos: number;
    subTotalCentavos: number;
    fxRate: number;
    partyName?: string | null;
  },
  birTax?: BirTaxInput | null,
): Promise<void> {
  if (!birTax) return;
  const hasAny =
    Boolean(birTax.supplierOrigin) ||
    Boolean(birTax.vatKind) ||
    birTax.manualVatCentavos != null ||
    Boolean(birTax.purchaseType) ||
    Boolean(clean(birTax.atcCode)) ||
    Boolean(birTax.noWithholdingReason) ||
    Boolean(clean(birTax.importIeirdNo)) ||
    birTax.importVatCentavos != null;
  if (!hasAny) return;

  const origin = birTax.supplierOrigin ?? originByName(doc.partyName);
  const { code, reason, note } = withholdingDecision(
    origin,
    birTax.atcCode,
    birTax.noWithholdingReason,
    birTax.noWithholdingNote,
    false,
  );

  const fx = doc.fxRate > 0 ? doc.fxRate : 1;
  const totalPhp = Math.round(doc.totalCentavos * fx);
  const manualVat = birTax.manualVatCentavos != null ? Math.round(birTax.manualVatCentavos) : null;
  if (manualVat != null && (manualVat < 0 || manualVat > totalPhp)) {
    throw new Refusal(400, "invalid", "Manual Input VAT cannot exceed the document total.", "manualVatCentavos");
  }

  const importVat = birTax.importVatCentavos != null ? Math.max(0, Math.round(birTax.importVatCentavos)) : null;
  const importDutiable = birTax.importDutiableCentavos != null ? Math.max(0, Math.round(birTax.importDutiableCentavos)) : null;
  const importDate = clean(birTax.importAssessmentDate);
  if (importDate && !/^\d{4}-\d{2}-\d{2}$/.test(importDate)) {
    throw new Refusal(400, "invalid", "Pick a valid YYYY-MM-DD customs assessment date.", "importAssessmentDate");
  }

  // The VAT typed for a partial-VAT bill (Meralco and the like) is the document's VAT, in the books
  // too (Aryan, 27 Nov; the accountant to confirm): the total stays as the supplier billed it, the
  // typed VAT is spread over the lines by their size, and each line's own amount takes the rest. So
  // Tax Payable in book_entry (a bill's: its total less its lines; an expense's: its lines' tax)
  // equals SLP / 2550Q to the centavo.
  if (manualVat != null && fx === 1) {
    const docLines = await rows<{ id: number; amount: number; taxAmount: number; inclusive: boolean }>(
      tx,
      sql`select l.id::int as id, coalesce(l.amount, 0)::bigint::float8 as amount, coalesce(l.tax_amount, 0)::bigint::float8 as "taxAmount",
            coalesce(d.fields->>'Is Inclusive Tax', '') = 'true' as inclusive
          from book_line l join book_doc d on d.id = l.doc_id where l.doc_id = ${docId} order by l.n`,
    );
    if (docLines.length) {
      const inclusive = doc.kind === "expense" && docLines[0]!.inclusive;
      // A line's whole size: an inclusive expense's amount has its tax in it already.
      const gross = docLines.map((line) => (inclusive ? line.amount : line.amount + line.taxAmount));
      const taxes = spread(manualVat, gross);
      const nets = spread(totalPhp - manualVat, gross);
      for (const [n, line] of docLines.entries()) {
        // A bill's line holds its net; an expense's keeps its own way (inclusive: the whole, tax inside).
        const amount = doc.kind === "bill" ? nets[n]! : inclusive ? line.amount : gross[n]! - taxes[n]!;
        await tx.execute(sql`update book_line set amount = ${amount}, tax_amount = ${taxes[n] || null} where id = ${line.id}`);
      }
      await tx.execute(sql`update book_doc set sub_total = ${totalPhp - manualVat} where id = ${docId}`);
    }
  }

  const netPhp =
    manualVat != null
      ? Math.max(0, totalPhp - manualVat)
      : birTax.purchaseType === "importation" && importVat != null
        ? Math.max(0, totalPhp - importVat)
        : Math.round(doc.subTotalCentavos * fx);

  let ewtBasePhp = 0;
  let ewtPhp = 0;
  if (code) {
    const rateBp = WITHHOLDING[code]![1];
    ewtBasePhp = birTax.ewtBaseCentavos != null && birTax.ewtBaseCentavos > 0 ? Math.round(birTax.ewtBaseCentavos) : netPhp;
    ewtPhp = birTax.ewtCentavos != null && birTax.ewtCentavos >= 0 ? Math.round(birTax.ewtCentavos) : share(ewtBasePhp, rateBp);
  }

  const docWithheld = fx !== 1 ? Math.round(ewtPhp / fx) : ewtPhp;
  if (docWithheld > 0 && docWithheld >= doc.totalCentavos) {
    throw new Refusal(400, "invalid", "Withholding tax cannot equal or exceed the document total.", "ewtCentavos");
  }

  await tx.execute(
    sql`insert into book_doc_tax_meta (
          doc_id, supplier_origin, vat_kind, manual_vat_centavos, purchase_type,
          atc_code, ewt_base_centavos, ewt_centavos,
          no_withholding_reason, no_withholding_note,
          import_ieird_no, import_assessment_date, import_dutiable_centavos, import_vat_centavos,
          updated_by, updated_at
        ) values (
          ${docId}, ${origin}, ${birTax.vatKind ?? null}, ${manualVat}, ${birTax.purchaseType ?? null},
          ${code}, ${ewtBasePhp}, ${ewtPhp},
          ${reason}, ${note},
          ${clean(birTax.importIeirdNo)}, ${importDate}::date, ${importDutiable}, ${importVat},
          ${me.id}, now()
        )
        on conflict (doc_id) do update set
          supplier_origin = excluded.supplier_origin,
          vat_kind = excluded.vat_kind,
          manual_vat_centavos = excluded.manual_vat_centavos,
          purchase_type = excluded.purchase_type,
          atc_code = excluded.atc_code,
          ewt_base_centavos = excluded.ewt_base_centavos,
          ewt_centavos = excluded.ewt_centavos,
          no_withholding_reason = excluded.no_withholding_reason,
          no_withholding_note = excluded.no_withholding_note,
          import_ieird_no = excluded.import_ieird_no,
          import_assessment_date = excluded.import_assessment_date,
          import_dutiable_centavos = excluded.import_dutiable_centavos,
          import_vat_centavos = excluded.import_vat_centavos,
          updated_by = excluded.updated_by,
          updated_at = now()`,
  );

  if (docWithheld > 0 && code) {
    const heldPesos = (docWithheld / 100).toFixed(2);
    if (doc.kind === "bill") {
      await tx.execute(
        sql`update book_doc
            set withheld = ${docWithheld},
                balance = greatest(0, balance - ${docWithheld}),
                fields = fields || jsonb_build_object('CF.ATC', ${code}::text, 'Withholding Tax Amount', ${heldPesos}::text)
            where id = ${docId}`,
      );
    } else {
      await tx.execute(
        sql`update book_doc
            set withheld = ${docWithheld},
                fields = fields || jsonb_build_object('CF.ATC', ${code}::text, 'Withholding Tax Amount', ${heldPesos}::text)
            where id = ${docId}`,
      );
    }
  }
}
