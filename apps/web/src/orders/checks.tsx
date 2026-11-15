// What Management checks on an order, at a glance on top of its card and in the table (Aryan):
// the price against the buyer's list, the stock, the papers that kind of buyer sends (a
// hospital's PO, a patient's prescription) and the customer (new, licence, owing). Each is a
// small chip: green when fine, amber when it needs a look; the full words are on hover.

import type { CustomerKind, OrderFinding, PaperKind } from "@2mg/api/types";
import { Check, TriangleAlert } from "lucide-react";

/** The paper each kind of buyer sends with an order. */
const PAPER_FOR: Partial<Record<CustomerKind, { kind: PaperKind; label: string }>> = {
  hospital: { kind: "po", label: "PO" },
  distributor: { kind: "po", label: "PO" },
  drugstore: { kind: "po", label: "PO" },
  government: { kind: "po", label: "PO" },
  patient: { kind: "prescription", label: "Rx" },
};

type Checked = { key: string; ok: boolean; label: string; title: string };

export function checksOf(card: {
  findings: OrderFinding[];
  papers: PaperKind[];
  customerKind: CustomerKind;
}): Checked[] {
  const found = (kinds: OrderFinding["kind"][]) =>
    card.findings.filter((one) => kinds.includes(one.kind));
  const one = (key: string, kinds: OrderFinding["kind"][], fine: string, fineTitle: string) => {
    const list = found(kinds);
    return list.length
      ? {
          key,
          ok: false,
          label: list[0]?.short ?? fine,
          title: list.map((item) => item.text).join("\n"),
        }
      : { key, ok: true, label: fine, title: fineTitle };
  };
  const out: Checked[] = [
    one("price", ["price"], "Price OK", "Every medicine at this buyer's list price"),
    one("stock", ["stock"], "In stock", "Everything on it is free on the shelf"),
  ];
  const paper = PAPER_FOR[card.customerKind];
  if (paper)
    out.push(
      card.papers.includes(paper.kind)
        ? { key: "paper", ok: true, label: paper.label, title: `${paper.label} on file` }
        : {
            key: "paper",
            ok: false,
            label: `No ${paper.label}`,
            title: `No ${paper.label === "Rx" ? "prescription" : "purchase order"} attached yet`,
          },
    );
  const proof = found(["papers"]);
  if (proof.length)
    out.push({
      key: "proof",
      ok: false,
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

export function Checks({
  card,
  small = false,
}: {
  card: Parameters<typeof checksOf>[0];
  /** The table's: only what needs a look, on one line ("All fine" when nothing does). */
  small?: boolean;
}) {
  const all = checksOf(card);
  const shown = small ? all.filter((one) => !one.ok) : all;
  const list = shown.length
    ? shown
    : [{ key: "fine", ok: true, label: "All fine", title: all.map((one) => one.title).join("\n") }];
  return (
    <span className={`flex gap-1 ${small ? "flex-nowrap" : "flex-wrap"}`}>
      {list.map((one) => (
        <span
          key={one.key}
          title={one.title}
          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold whitespace-nowrap ${small ? "text-[10px]" : "text-[10.5px]"} ${
            one.ok
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
              : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
          }`}
        >
          {one.ok ? (
            <Check className="size-3" aria-hidden="true" />
          ) : (
            <TriangleAlert className="size-3" aria-hidden="true" />
          )}
          {one.label}
        </span>
      ))}
    </span>
  );
}
