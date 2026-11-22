// Purchases in this CRM's own look (Aryan, 18 Nov 2026: "move Purchases out of Zoho's style into
// our Inventory style, every feature, better than Zoho"). The same documents as Zoho's screens
// (/books/…, kept as they are for showing both): purchase orders, receives, bills, payments made
// and vendor credits, Zoho's history and those made here. These are the pieces every page shares.

import { LeavesArrow } from "../app-switch";
import type { BookDoc, BookKind, BookList, BookRow, DoneState } from "@2mg/api/types";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, FileText, Paperclip, Search } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMay } from "../books/forms";
import { smaller } from "../photo";
import { count, dayLabel, Pill, Problem, type Tone, useAction } from "../ui";

/** Each kind's own page and list here. */
export const PATHS: Partial<Record<BookKind, string>> = {
  purchase_order: "/purchases/orders",
  purchase_receive: "/purchases/receives",
  bill: "/purchases/bills",
  vendor_payment: "/purchases/payments",
  vendor_credit: "/purchases/credits",
};
/** The same list in Zoho's look (kept for showing both). */
export const ZOHO_PATHS: Partial<Record<BookKind, string>> = {
  purchase_order: "/books/purchaseorders",
  purchase_receive: "/books/purchasereceives",
  bill: "/books/bills",
  vendor_payment: "/books/paymentsmade",
  vendor_credit: "/books/vendorcredits",
};
export const KIND_WORD: Partial<Record<BookKind, string>> = {
  purchase_order: "Purchase order",
  purchase_receive: "Receive",
  bill: "Bill",
  vendor_payment: "Payment made",
  vendor_credit: "Vendor credit",
};
export const docPath = (kind: BookKind, id: number) => `${PATHS[kind] ?? "/purchases"}/${id}`;

/** Money in centavos of its currency: pesos as ₱, others with their code. */
export const money = (centavos: number | null | undefined, currency = "PHP") => {
  if (centavos === null || centavos === undefined) return "—";
  const text = (Math.abs(centavos) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${centavos < 0 ? "−" : ""}${currency === "PHP" ? "₱" : `${currency} `}${text}`;
};
/** A short peso figure for tiles: ₱1.2M, ₱35.4K. */
export const shortMoney = (centavos: number) => {
  const pesos = centavos / 100;
  if (Math.abs(pesos) >= 1_000_000) return `₱${(pesos / 1_000_000).toFixed(pesos >= 10_000_000 ? 1 : 2)}M`;
  if (Math.abs(pesos) >= 1_000) return `₱${(pesos / 1_000).toFixed(1)}K`;
  return `₱${pesos.toFixed(0)}`;
};
export const qty = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : Number.isInteger(value) ? count(value) : value.toLocaleString("en-PH", { maximumFractionDigits: 2 });

/** Where a purchase order stands, in one word, from its status and its received and billed dots. */
export function orderStage(row: Pick<BookRow, "status" | "received" | "billed" | "dueDate">, today: string): { word: string; tone: Tone } {
  if (row.status === "cancelled") return { word: "Cancelled", tone: "plain" };
  if (row.status === "void") return { word: "Void", tone: "plain" };
  if (row.status === "draft") return { word: "Draft", tone: "plain" };
  if (row.status === "closed") return { word: "Closed", tone: "plain" };
  if (row.received !== "full") {
    const late = Boolean(row.dueDate && row.dueDate < today);
    if (row.received === "partial") return { word: late ? "Part received · late" : "Part received", tone: late ? "bad" : "warn" };
    return { word: late ? "Late" : "Ordered", tone: late ? "bad" : "info" };
  }
  if (row.billed !== "full") return { word: "To bill", tone: "violet" };
  return { word: "Billed", tone: "good" };
}

/** A bill's, payment's, credit's or receive's state in one word. */
export function docState(row: Pick<BookRow, "status" | "balance" | "total" | "overdueDays">, kind: BookKind): { word: string; tone: Tone } {
  const status = row.status;
  if (status === "void") return { word: "Void", tone: "plain" };
  if (status === "draft") return { word: "Draft", tone: "plain" };
  if (kind === "bill") {
    if (status === "overdue") return { word: `Overdue ${row.overdueDays ?? ""}d`.trim(), tone: "bad" };
    if (status === "paid" || row.balance <= 0) return { word: "Paid", tone: "good" };
    if (status === "partially_paid" || row.balance < row.total) return { word: "Part paid", tone: "warn" };
    return { word: "To pay", tone: "info" };
  }
  if (kind === "vendor_credit") return row.balance > 0 ? { word: "Credit left", tone: "violet" } : { word: "Used", tone: "good" };
  if (kind === "vendor_payment") return row.balance > 0 ? { word: "Advance left", tone: "violet" } : { word: "Paid", tone: "good" };
  if (kind === "purchase_receive") return { word: "Received", tone: "good" };
  return { word: status.replace(/_/g, " "), tone: "plain" };
}

/** A status word as it is, coloured by what it means. */
export function plainState(status: string): { word: string; tone: Tone } {
  const word = status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  if (["void", "cancelled", "draft", "closed"].includes(status)) return { word, tone: "plain" };
  if (["paid", "received", "billed"].includes(status)) return { word, tone: "good" };
  if (status === "overdue") return { word, tone: "bad" };
  if (status.startsWith("partially")) return { word, tone: "warn" };
  return { word, tone: "info" };
}

export function StatePill({ state }: { state: { word: string; tone: Tone } }) {
  return <Pill tone={state.tone}>{state.word}</Pill>;
}

/** Received / billed as a small three-step dot: none, part, all. */
export function Dot({ state, label }: { state: DoneState | null | undefined; label: string }) {
  const tone = state === "full" ? "bg-emerald-500" : state === "partial" ? "bg-amber-400" : "bg-slate-200";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600" title={`${label}: ${state === "full" ? "all" : state === "partial" ? "part" : "none"}`}>
      <span className={`grid size-4 place-items-center rounded-full ${tone}`}>{state === "full" && <Check className="size-3 text-white" aria-hidden="true" />}</span>
      {label}
    </span>
  );
}

/** A list of one kind from the books, paged and searched (the same list Zoho's screen reads). */
export function useBookList(kind: BookKind, asked: { view?: string; q?: string; page?: number; party?: number; stage?: string; perPage?: number; sort?: string; dir?: string }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(asked)) if (value !== undefined && value !== "" && value !== null) params.set(key, String(value));
  return useQuery({
    queryKey: ["books", kind, "list", params.toString()],
    queryFn: () => api<BookList>(`/api/books/${kind}?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}
export const useBookDoc = (kind: BookKind, id: number) =>
  useQuery({ queryKey: ["books", kind, "doc", id], queryFn: () => api<BookDoc>(`/api/books/${kind}/${id}`), enabled: id > 0 });

/** The search box over a list. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
  return (
    <label className="relative block min-w-0 flex-[1_1_18rem]">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-3 pl-9 text-[14px] shadow-2xs outline-none placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15"
      />
    </label>
  );
}

/** Pages under a list: "26–50 of 1,545", back and on. */
export function Pager({ page, perPage, total, onPage }: { page: number; perPage: number; total: number; onPage: (page: number) => void }) {
  if (total <= perPage) return <div className="px-4 py-2.5 text-[12px] text-slate-500">{count(total)} in all</div>;
  const last = Math.ceil(total / perPage);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
      <span>
        {count((page - 1) * perPage + 1)}–{count(Math.min(total, page * perPage))} of {count(total)}
      </span>
      <span className="flex gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-40" aria-label="Back a page">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" disabled={page >= last} onClick={() => onPage(page + 1)} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-40" aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
      </span>
    </div>
  );
}

/** The table frame every list uses: a card, a header row, rows that open their page. */
export const TABLE = "w-full border-collapse text-[13.5px]";
export const TH = "border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase first:pl-4 last:pr-4";
export const TD = "border-b border-slate-100 px-3 py-3 align-middle first:pl-4 last:pr-4";

/** "Books view": the same records in the books' own look, kept to show both. */
export function ZohoLink({ to }: { to: string }) {
  return (
    <Link to={to} className="inline-flex h-10 items-center gap-1 rounded-[10px] px-3 text-[13px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="The same records in the books' own look">
      Books view <LeavesArrow app="Books" />
    </Link>
  );
}

export const when = (day: string | null | undefined, today?: string) => (day ? dayLabel(day, today?.slice(0, 4)) : "—");

/** A box with a heading and an optional count and buttons, used down the side of a document. */
export function Box({ title, aside, children, className = "" }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-20px_rgba(15,23,42,0.2)] ${className}`}>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">{title}</h2>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A fact under a label. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-[14px] font-medium text-slate-900">{children || "—"}</dd>
    </div>
  );
}

/** The papers on a document — the vendor's invoice on its bill, a waybill or customs entry on its
 *  order, a delivery photo — Zoho's and those added here. A photo is made smaller first. */
export function FilesBox({ doc }: { doc: BookDoc }) {
  const may = useMay();
  const queries = useQueryClient();
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const files = doc.files ?? [];
  return (
    <Box
      title={
        <>
          Papers{" "}
          {files.length > 0 && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{files.length}</span>}
        </>
      }
      aside={
        may.bill ? (
          <>
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(event) => {
                const picked = [...(event.target.files ?? [])];
                event.target.value = "";
                if (!picked.length) return;
                void action.run(async () => {
                  for (const file of picked) {
                    const form = new FormData();
                    form.set("file", await smaller(file));
                    await api(`/api/books/${doc.kind}/${doc.id}/files`, { body: form });
                  }
                  await queries.invalidateQueries({ queryKey: ["books", doc.kind, "doc", doc.id] });
                });
              }}
            />
            <button
              type="button"
              disabled={action.busy}
              onClick={() => input.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              <Paperclip className="size-3.5" aria-hidden="true" /> {action.busy ? "Adding…" : "Attach"}
            </button>
          </>
        ) : undefined
      }
    >
      {files.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-slate-500">
          {doc.kind === "bill" ? "The vendor's invoice goes here: a photo or the PDF." : "Their invoice, a waybill, customs papers, a photo of the delivery."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {files.map((file) => (
            <li key={file.id}>
              <a href={`/api/books/files/${file.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-slate-50">
                <FileText className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium text-brand-dark">{file.name}</span>
                <span className="shrink-0 text-[11.5px] text-slate-500">{[file.uploadedBy, file.uploadedOn && /^\d{4}-\d{2}-\d{2}/.test(file.uploadedOn) ? when(file.uploadedOn.slice(0, 10)) : file.uploadedOn].filter(Boolean).join(" · ")}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {action.problem && (
        <div className="px-4 pb-3">
          <Problem message={action.problem.message} />
        </div>
      )}
    </Box>
  );
}

export const FIELD =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[14px] text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";
export const LABEL = "text-[12px] font-semibold text-slate-600";
