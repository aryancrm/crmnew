// What Management checks on an order, at a glance on top of its card and in the table (Aryan):
// the price against the buyer's list, the stock, the papers that kind of buyer sends (a
// hospital's own purchase order, a patient's prescription) and the customer (new, licence,
// owing), and the MedRep's note when they wrote one. Each is a word with a dot before it, no box (Aryan): green when fine, yellow when it
// needs a look, grey when it is only for information; the full words are on hover.

import type { CustomerKind, OrderFinding, PaperKind } from "@2mg/api/types";

/** The paper each kind of buyer sends with an order. */
const PAPER_FOR: Partial<Record<CustomerKind, { kind: PaperKind; label: string }>> = {
  hospital: { kind: "po", label: "PO" },
  distributor: { kind: "po", label: "PO" },
  drugstore: { kind: "po", label: "PO" },
  government: { kind: "po", label: "PO" },
  patient: { kind: "prescription", label: "Rx" },
};

type Checked = { key: string; tone: "ok" | "warn" | "info"; label: string; title: string };

export function checksOf(card: {
  findings: OrderFinding[];
  papers: PaperKind[];
  customerKind: CustomerKind;
  /** An order for one patient through a hospital or a doctor: checked as a patient's. */
  patientOrder?: boolean;
  items?: { qty: number; listPrice: number; unitPrice: number; free: boolean }[];
  /** Management's own reading (Aryan, 19 Nov): papers on file count as fine only once someone
   *  looked at them by hand and said so; until then they are "to check". */
  manual?: boolean;
  papersCheckedAt?: string | null;
  papersCheckedBy?: string | null;
}): Checked[] {
  const found = (kinds: OrderFinding["kind"][]) =>
    card.findings.filter((one) => kinds.includes(one.kind));
  const one = (key: string, kinds: OrderFinding["kind"][], fine: string, fineTitle: string) => {
    const list = found(kinds);
    return list.length
      ? {
          key,
          tone: "warn" as const,
          label: list[0]?.short ?? fine,
          title: list.map((item) => item.text).join("\n"),
        }
      : { key, tone: "ok" as const, label: fine, title: fineTitle };
  };
  // How far below the buyer's list the paid lines come to, said on the price check itself.
  const paid = (card.items ?? []).filter((item) => !item.free);
  const list = paid.reduce((sum, item) => sum + item.qty * item.listPrice, 0);
  const offered = paid.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const off = list > 0 && offered < list ? Math.round((1 - offered / list) * 100) : 0;
  const price = one("price", ["price"], "Price OK", "Every medicine at this buyer's list price");
  if (off > 0) price.label = `Price ${off}% below list`;
  const out: Checked[] = [
    price,
    one("stock", ["stock"], "In stock", "Everything on it is free on the shelf"),
  ];
  // What the MedRep wrote on the order: Management reads it before approving (Aryan, 17 Nov).
  const note = found(["note"])[0];
  if (note) out.unshift({ key: "note", tone: "warn", label: note.short, title: note.text });
  // A hospital's (or distributor's) purchase order is their own paper, which the MedRep brings
  // when they gave one: for information, never a problem. A patient's prescription is needed for
  // a prescription medicine.
  // A patient's order: the prescription and the ID, which Management checks.
  const patient = card.customerKind === "patient" || card.patientOrder;
  const rx = found(["rx"]);
  const paper = patient ? undefined : PAPER_FOR[card.customerKind];
  if (patient)
    out.push(
      rx.length
        ? {
            key: "paper",
            tone: "warn",
            label: rx.map((item) => item.short).join(", "),
            title: rx.map((item) => item.text).join("\n"),
          }
        : {
            key: "paper",
            tone: "ok",
            label: "Rx & ID attached",
            title: "Prescription and ID on file",
          },
    );
  if (paper)
    out.push(
      card.papers.includes(paper.kind)
        ? {
            key: "paper",
            tone: "ok",
            label: paper.kind === "po" ? "Their PO attached" : "Rx attached",
            title:
              paper.kind === "po"
                ? "The customer's purchase order is on file"
                : "The prescription is on file",
          }
        : paper.kind === "po"
          ? {
              key: "paper",
              tone: "info",
              label: "No PO from them",
              title:
                "The customer's own purchase order (their paper asking us for these medicines) isn't attached. Optional: the MedRep adds it when they gave one.",
            }
          : {
              key: "paper",
              tone: "warn",
              label: "No prescription",
              title: "No prescription attached yet",
            },
    );
  // Management's reading: a paper on file is never fine by itself; a person reads it and says so.
  const readable = card.papers.filter((kind) => kind !== "payment_proof" && kind !== "dr");
  if (card.manual && readable.length) {
    const at = out.findIndex((item) => item.key === "paper");
    const checked: Checked = card.papersCheckedAt
      ? { key: "paper", tone: "ok", label: "Papers checked", title: `Checked by hand${card.papersCheckedBy ? ` by ${card.papersCheckedBy}` : ""}` }
      : { key: "paper", tone: "warn", label: "Papers to check", title: "Papers are on file: open each and say they are right" };
    // Something missing (a patient's prescription) stays the first thing said.
    if (at >= 0 && out[at]?.tone !== "warn") out[at] = checked;
    else if (at < 0) out.push(checked);
  }
  const proof = found(["papers"]);
  if (proof.length)
    out.push({
      key: "proof",
      tone: "warn",
      label: proof[0]?.short ?? "No payment proof",
      title: proof.map((item) => item.text).join("\n"),
    });
  out.push(
    one(
      "customer",
      ["customer", "licence", "owes", "credit"],
      "Customer OK",
      "Checked customer, licence in date, nothing overdue",
    ),
  );
  return out;
}

const DOT = { ok: "bg-good-fill", warn: "bg-amber-400", info: "bg-slate-300" };

export function Checks({
  card,
  small = false,
}: {
  card: Parameters<typeof checksOf>[0];
  /** The table's: only what needs a look, on one line ("All fine" when nothing does). */
  small?: boolean;
}) {
  const all = checksOf(card);
  // The card shows what is fine and what needs a look; information only (no PO from a hospital)
  // stays on the order's page. The table shows only what needs a look.
  const shown = all.filter((one) => (small ? one.tone === "warn" : one.tone !== "info"));
  const list: Checked[] = shown.length
    ? shown
    : [
        {
          key: "fine",
          tone: "ok",
          label: "All fine",
          title: all.map((one) => one.title).join("\n"),
        },
      ];
  return (
    <span className={`flex gap-x-3 gap-y-0.5 ${small ? "flex-nowrap" : "flex-wrap"}`}>
      {list.map((one) => (
        <span
          key={one.key}
          title={one.title}
          className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${small ? "text-[11px]" : "text-[11.5px]"} ${
            one.tone === "info" ? "text-slate-500" : "text-slate-800"
          }`}
        >
          <span className={`size-1.5 shrink-0 rounded-full ${DOT[one.tone]}`} aria-hidden="true" />
          {one.label}
        </span>
      ))}
    </span>
  );
}
