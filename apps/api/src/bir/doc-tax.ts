// Saves optional Philippine BIR tax metadata (ATC, local/foreign origin, manual VAT override,
// SLI customs fields, or no-withholding reason) on Books bills and expenses inside the same DB tx.

import { sql } from "drizzle-orm";
import { rows } from "../db/index";
import { Refusal } from "../http";
import type { Runner } from "../inventory/service";
import type { BirTaxInput, Me } from "../types";
import { originByName, share, WITHHOLDING, withholdingDecision } from "./ewt";

const clean = (v?: string | null) => v?.trim() || null;

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

  // If a partial-VAT utility bill (e.g. Meralco) was entered as a single gross line with no % tax,
  // split that line into net + manualVat so Tax Payable in book_entry matches SLP/2550Q to the centavo.
  if (manualVat != null && fx === 1) {
    const docLines = await rows<{ id: number; amount: number; taxAmount: number }>(
      tx,
      sql`select id::int as id, coalesce(amount, 0)::bigint::float8 as amount, coalesce(tax_amount, 0)::bigint::float8 as "taxAmount"
          from book_line where doc_id = ${docId}`,
    );
    if (docLines.length === 1 && docLines[0]!.taxAmount === 0 && Math.round(docLines[0]!.amount) === totalPhp) {
      const netLine = totalPhp - manualVat;
      if (doc.kind === "bill") {
        await tx.execute(sql`update book_line set amount = ${netLine}, tax_amount = ${manualVat || null} where id = ${docLines[0]!.id}`);
        await tx.execute(sql`update book_doc set sub_total = ${netLine} where id = ${docId}`);
      } else {
        await tx.execute(sql`update book_line set tax_amount = ${manualVat || null} where id = ${docLines[0]!.id}`);
        await tx.execute(
          sql`update book_doc set sub_total = ${netLine}, fields = fields || jsonb_build_object('Is Inclusive Tax', 'true') where id = ${docId}`,
        );
      }
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
