// The parts every HR paper shares (docs/HR-PLAN.md, "Documents, imports and reports"): the
// employer's letterhead with the paper's number, and the signers' boxes with their signatures.
// One look for the leave and form printouts and HR's documents, like the finance papers.

import type { Letterhead, Printout } from "@2mg/api/types";

const when = (at: string) =>
  new Date(at).toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Manila" });

/** The company's name and details on top, the paper's title and number under a rule. */
export function LetterheadBlock({
  letterhead,
  title,
  code,
  sub,
}: {
  letterhead: Letterhead;
  title: string;
  /** Its number; a report has none. */
  code?: string;
  sub?: string;
}) {
  const contact = [letterhead.phone, letterhead.email].filter(Boolean).join(" · ");
  return (
    <header className="border-b-2 border-slate-900 pb-3">
      <div className="text-center">
        <div className="text-base font-bold tracking-wide uppercase">{letterhead.name}</div>
        {letterhead.address && <div className="text-xs text-slate-600">{letterhead.address}</div>}
        {(contact || letterhead.tin) && (
          <div className="text-xs text-slate-600">
            {[contact, letterhead.tin ? `TIN ${letterhead.tin}` : ""].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="text-right text-xs text-slate-600">
          {code && <div className="font-mono font-semibold text-slate-900">No. {code}</div>}
          {sub && <div>{sub}</div>}
        </div>
      </div>
    </header>
  );
}

/** The signers' boxes: the signature they had when they signed, their name, their part, the day. */
export function SignerBoxes({ signers }: { signers: Printout["signers"] }) {
  const columns = signers.length >= 3 ? "sm:grid-cols-3 print:grid-cols-3" : "sm:grid-cols-2 print:grid-cols-2";
  return (
    <section className={`mt-6 grid gap-6 ${columns}`}>
      {signers.map((signer) => (
        <div key={signer.box} className="flex flex-col items-center text-center">
          <div className="flex h-16 w-full items-end justify-center">
            {signer.image && (
              <img src={signer.image} alt={`${signer.name ?? signer.box}'s signature`} className="max-h-16 max-w-full object-contain" />
            )}
          </div>
          <div className="w-full border-t border-slate-900 pt-1 font-semibold">{signer.name ?? " "}</div>
          <div className="text-xs text-slate-600">{signer.box}</div>
          <div className="text-xs text-slate-500">{signer.at ? when(signer.at) : "Date: __________"}</div>
        </div>
      ))}
    </section>
  );
}

/** The foot line the Admin keeps in Company details, on every paper. */
export function PaperFoot({ letterhead }: { letterhead: Letterhead }) {
  if (!letterhead.footer) return null;
  return <footer className="mt-8 border-t border-slate-300 pt-2 text-center text-[11px] text-slate-500">{letterhead.footer}</footer>;
}

/** The grey page with Back and Print above a white sheet, outside the app's frame so it prints clean. */
export function PaperPage({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex max-w-[48rem] flex-wrap justify-end gap-2 px-4 print:hidden">{actions}</div>
      <article className="mx-auto flex max-w-[48rem] flex-col gap-5 bg-white p-10 text-[13px] text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {children}
      </article>
    </div>
  );
}
