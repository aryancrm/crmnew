// Picking a medicine, the same box everywhere a medicine is sold (the Online desk's quotation, a
// MedRep's order): a labelled "Select medicine" whose list opens on a click and narrows as you
// type (name, generic, strength, brand or code). Each row says what it is and its pack (a box of
// 30), and the buyer's price for one piece and for the pack; the row in focus shows every kind of
// buyer's price beside it (patient, hospital, doctor…), the VAT, the promo and the offers, all
// read live from Inventory. Sellers don't need the shelf's numbers: a medicine says "Out of stock"
// only when there is none (Aryan, 18 Nov).

import type { BuyerType, Catalogue, CatalogueRow } from "@2mg/api/types";
import { ChevronDown, Search } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { VAT_WORDS } from "../inventory/vat";
import { peso } from "../ui";

/** "tablet" / "tablets", from what Inventory calls one piece. */
export const unitWord = (row: Pick<CatalogueRow, "unit">, many = false) => {
  const one = (row.unit ?? "piece").toLowerCase();
  return many ? (one.endsWith("s") ? one : `${one}s`) : one;
};

/** "box of 30", from the pack's name and size. */
export const packWord = (row: Pick<CatalogueRow, "pack" | "packSize" | "unit">) => {
  const name = (row.pack ?? "").trim();
  if (name) return name.charAt(0).toLowerCase() + name.slice(1);
  return row.packSize > 1 ? `pack of ${row.packSize}` : "";
};

/** What a whole pack comes to on an order at one buyer's price: its pieces added up (orders and
 *  quotations charge by the piece). */
export const packPriceOf = (row: CatalogueRow, buyer: BuyerType) => {
  const each = row.prices[buyer];
  if (each === undefined) return undefined;
  return each * Math.max(1, row.packSize);
};

/** "4 Dec 2026", from "2026-12-04". */
const dayWords = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function MedicineFinder({
  catalogue,
  failed,
  onRetry,
  buyer,
  taken = [],
  takenWhy = "Already added",
  asked,
  missing,
  onPick,
  id = "medicine-finder",
}: {
  catalogue?: Catalogue;
  failed?: boolean;
  onRetry?: () => void;
  /** Whose price leads: the patient's on the Online desk, the customer's kind on an order. */
  buyer: BuyerType;
  /** Medicines already on it (can't be added twice). */
  taken?: number[];
  takenWhy?: string;
  /** What the customer asked for, as typed: those medicines come first, marked. */
  asked?: string | null;
  /** What to offer when nothing matches (e.g. ask Inventory to buy it in). */
  missing?: (text: string) => ReactNode;
  onPick: (row: CatalogueRow) => void;
  id?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const keyed = useRef(false);
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = catalogue?.rows ?? [];
  const matching = all.filter((row) =>
    words.every((word) =>
      [row.name, row.generic, row.strength, row.code, row.brand, row.sku]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(word),
    ),
  );
  const askedText = (asked ?? "").toLowerCase();
  const wanted = (row: CatalogueRow) =>
    askedText.length > 0 &&
    [row.name, row.generic].some(
      (name) => name && name.length > 3 && askedText.includes(name.toLowerCase()),
    );
  const blocked = (row: CatalogueRow) =>
    taken.includes(row.id)
      ? takenWhy
      : row.prices[buyer] === undefined
        ? "No price for this buyer yet: ask Inventory"
        : null;
  // What was asked for first, then what can be sold now, then the rest; by name.
  const rank = (row: CatalogueRow) =>
    blocked(row) ? 3 : wanted(row) ? 0 : row.free > 0 ? 1 : 2;
  const found = [...matching]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, 40);
  const focus = found[at] ?? null;

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => setAt(0), [text]);
  // The list opens below the box: near the page's foot, it is brought into view at once.
  useEffect(() => {
    if (open && catalogue) list.current?.scrollIntoView({ block: "nearest" });
  }, [open, catalogue]);
  // The arrow keys move the focus; the list (never the page) scrolls to keep it in view.
  useEffect(() => {
    if (!keyed.current) return;
    keyed.current = false;
    const ul = list.current?.querySelector("ul");
    const li = ul?.querySelector<HTMLElement>(`[data-row="${at}"]`);
    if (!ul || !li) return;
    if (li.offsetTop < ul.scrollTop) ul.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight)
      ul.scrollTop = li.offsetTop + li.offsetHeight - ul.clientHeight;
  }, [at]);

  const pick = (row: CatalogueRow) => {
    if (blocked(row)) return;
    onPick(row);
    setText("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-slate-700">
        Select medicine
        <span className="ml-1 font-normal text-slate-400">
          · click for the list, or type a name, generic or strength
        </span>
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          autoComplete="off"
          value={text}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              keyed.current = true;
              setAt((n) => Math.min(n + 1, found.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              keyed.current = true;
              setAt((n) => Math.max(n - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (focus) pick(focus);
            } else if (event.key === "Escape") setOpen(false);
          }}
          placeholder={
            failed
              ? "Couldn't load the medicines"
              : catalogue
                ? `Select a medicine (${all.length} in the list)`
                : "Loading the medicines…"
          }
          className="h-11 w-full rounded-[10px] border border-slate-300 bg-white py-2 pr-9 pl-9 text-sm shadow-2xs placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        <ChevronDown
          className={`pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </div>
      {failed && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 text-xs font-semibold text-emerald-700 hover:underline"
        >
          Try again
        </button>
      )}
      {open && catalogue && (
        <div
          ref={list}
          className="absolute right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop"
        >
          <div className="grid md:grid-cols-[minmax(0,1fr)_17.5rem]">
            <ul id={`${id}-list`} role="listbox" className="max-h-96 overflow-y-auto p-1">
              {found.map((row, index) => {
                const each = row.prices[buyer];
                const pack = packPriceOf(row, buyer);
                const why = blocked(row);
                const on = index === at;
                return (
                  <li
                    key={row.id}
                    data-row={index}
                    role="option"
                    aria-selected={on}
                    aria-disabled={Boolean(why)}
                  >
                    <button
                      type="button"
                      disabled={Boolean(why)}
                      onMouseEnter={() => setAt(index)}
                      onFocus={() => setAt(index)}
                      onClick={() => pick(row)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55 ${on ? (why ? "bg-slate-50" : "bg-emerald-50") : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-slate-900">
                            {[row.name, row.strength].filter(Boolean).join(" ")}
                          </span>
                          {wanted(row) && !why && <Tag tone="green">Asked for</Tag>}
                          {row.rx && <Tag tone="sky">Rx</Tag>}
                          {row.promo && <Tag tone="amber">Promo</Tag>}
                          {row.free <= 0 && <Tag tone="rose">Out of stock</Tag>}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {why ??
                            [row.generic, row.form, packWord(row)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-semibold text-slate-900 tabular-nums">
                          {each === undefined ? "—" : peso(each)}
                          <span className="text-[11px] font-normal text-slate-500">
                            {" "}
                            / {unitWord(row)}
                          </span>
                        </span>
                        {pack !== undefined && row.packSize > 1 && (
                          <span className="block text-[11px] text-slate-500 tabular-nums">
                            {peso(pack)} / {packWord(row) || "pack"}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {found.length === 0 && (
                <li className="px-3 py-4 text-[13px] text-slate-600">
                  {missing && text.trim().length >= 2 ? (
                    missing(text.trim())
                  ) : (
                    <>No medicine matches "{text.trim()}". Check the spelling, or ask Inventory.</>
                  )}
                </li>
              )}
            </ul>
            {focus && <Details row={focus} buyer={buyer} catalogue={catalogue} />}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
            <span>
              {matching.length} {matching.length === 1 ? "medicine" : "medicines"}
              {matching.length > found.length
                ? `, first ${found.length} shown: type more to narrow`
                : ""}
            </span>
            <span className="hidden sm:inline">↑ ↓ to move · Enter to add · Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ tone, children }: { tone: "green" | "sky" | "amber" | "rose"; children: ReactNode }) {
  const look = {
    green: "bg-emerald-100 text-emerald-800",
    sky: "bg-sky-100 text-sky-800",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-700",
  }[tone];
  return (
    <span className={`shrink-0 rounded px-1 text-[10px] font-bold ${look}`}>{children}</span>
  );
}

/** The medicine in focus: its pack, every kind of buyer's price for one piece and for the pack,
 *  the VAT, the promo and the offers. */
function Details({
  row,
  buyer,
  catalogue,
}: {
  row: CatalogueRow;
  buyer: BuyerType;
  catalogue: Catalogue;
}) {
  const types = catalogue.buyerTypes.filter((type) => row.prices[type.key] !== undefined);
  const pack = packWord(row);
  return (
    <aside className="hidden max-h-96 overflow-y-auto border-l border-slate-100 bg-slate-50/60 p-3 text-[12px] md:block">
      <div className="font-semibold text-slate-900">
        {[row.name, row.strength].filter(Boolean).join(" ")}
      </div>
      <div className="text-[11px] text-slate-500">
        {[row.generic, row.form].filter(Boolean).join(" · ")}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
        {row.packSize > 1 && (
          <>
            <dt className="text-slate-500">Pack</dt>
            <dd className="text-slate-800">
              {pack ? `${pack.charAt(0).toUpperCase()}${pack.slice(1)}` : "Pack"}
              {pack.includes(String(row.packSize)) ? "" : ` (${row.packSize})`}{" "}
              {unitWord(row, true)}
            </dd>
          </>
        )}
        <dt className="text-slate-500">VAT</dt>
        <dd className="text-slate-800">{VAT_WORDS[row.vat ?? ""] ?? row.vat}</dd>
        <dt className="text-slate-500">Sold</dt>
        <dd className="text-slate-800">{row.rx ? "With a prescription" : "Over the counter"}</dd>
        {row.free <= 0 && (
          <>
            <dt className="text-slate-500">Stock</dt>
            <dd className="font-semibold text-rose-700">Out of stock</dd>
          </>
        )}
      </dl>
      <table className="mt-2.5 w-full text-[11px]">
        <thead className="text-slate-500">
          <tr>
            <th className="py-0.5 text-left font-medium">Price for</th>
            <th className="py-0.5 text-right font-medium">1 {unitWord(row)}</th>
            {row.packSize > 1 && <th className="py-0.5 text-right font-medium">1 {pack.split(" ")[0] || "pack"}</th>}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => {
            const mine = type.key === buyer;
            return (
              <tr
                key={type.key}
                className={mine ? "font-semibold text-emerald-800" : "text-slate-700"}
              >
                <td className="py-0.5">
                  {type.label}
                  {mine && <span className="font-normal text-emerald-700"> · this one</span>}
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {peso(row.prices[type.key] as number)}
                </td>
                {row.packSize > 1 && (
                  <td className="py-0.5 text-right tabular-nums">
                    {peso(packPriceOf(row, type.key) as number)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* A box price Inventory keeps apart from the pieces (orders still charge by the piece). */}
      {row.packSize > 1 &&
        row.packPrices[buyer] !== undefined &&
        row.packPrices[buyer] !== packPriceOf(row, buyer) && (
          <p className="mt-1.5 text-[11px] text-slate-500">
            Inventory's own {pack.split(" ")[0] || "pack"} price: {peso(row.packPrices[buyer] as number)}
          </p>
        )}
      {row.promo && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
          Promo: {peso(row.promo.amount)} / {unitWord(row)} until {dayWords(row.promo.endsOn)}
        </p>
      )}
      {row.offers.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 text-[11px] text-violet-900">
          {row.offers.map((offer) => (
            <li key={offer.id} className="rounded-md bg-violet-50 px-2 py-1">
              {offer.name}
              {offer.buyerKind ? ` · ${offer.buyerKind}` : ""}
              {offer.price !== null ? ` · ${peso(offer.price)} / ${unitWord(row)}` : ""}
              {offer.endsOn ? ` · until ${dayWords(offer.endsOn)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
