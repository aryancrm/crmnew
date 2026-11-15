// What Management checks on an order, at a glance on top of its card and in the table (Aryan):
// the price against the buyer's list, the stock, the papers that kind of buyer sends (a
// hospital's own purchase order, a patient's prescription) and the customer (new, licence,
// owing). Each is a word with a dot before it, no box (Aryan): green when fine, yellow when it
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
  items?: { qty: number; listPrice: number; unitPrice: number; free: boolean }[];
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
  // A hospital's (or distributor's) purchase order is their own paper, which the MedRep brings
  // when they gave one: for information, never a problem. A patient's prescription is needed for
  // a prescription medicine.
  const paper = PAPER_FOR[card.customerKind];
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

const DOT = { ok: "bg-emerald-500", warn: "bg-amber-400", info: "bg-slate-300" };

export function Checks({
  card,
  small = false,
}: {
  card: Parameters<typeof checksOf>[0];
  /** The table's: only what needs a look, on one line ("All fine" when nothing does). */
  small?: boolean;
}) {
  const all = checksOf(card);
  const shown = small ? all.filter((one) => one.tone === "warn") : all;
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
