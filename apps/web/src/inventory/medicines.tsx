// All medicines: one row per medicine with everything known about it: what it is, who makes
// it, every price, the running promo, what is in stock and (for those who may see it) its cost.

import type { Catalogue, CatalogueRow } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { MedicineDialog } from "./dialogs";
import { MedicineRequestDialog, MyRequests } from "./requests";
import {
  Button,
  Card,
  count,
  dayLabel,
  INPUT,
  inPacks,
  PageHead,
  PageState,
  Pill,
  packPrice,
  peso,
} from "../ui";
import { Figure } from "../home/figures";
import { StatusPill } from "./inventory";
import { NoResults } from "../no-results";

const VAT = { exempt: "Exempt", vat12: "12%", zero: "Zero-rated" };

/** A promo or an offer (Buy X Take Y, a special price) running today on the medicine (28 Nov: the
 *  tile counted the promos alone and said none while offers ran). */
const onOffer = (row: CatalogueRow) => Boolean(row.promo) || row.offers.length > 0;

/** The small tag on a medicine with an offer running: its name, every one on hover. */
function OfferTag({ row }: { row: CatalogueRow }) {
  const first = row.offers[0];
  if (!first) return null;
  return (
    <span title={row.offers.map((offer) => offer.name).join(" · ")}>
      <Pill tone="violet">
        {first.name}
        {row.offers.length > 1 ? ` +${row.offers.length - 1}` : ""}
      </Pill>
    </span>
  );
}

/** A cell of a set width that wraps to two lines: one long molecule or maker must not stretch
 *  the whole table (Aryan, 18 Nov). The full text is on hover. */
function Wrap({ width, text }: { width: string; text: string | null | undefined }) {
  if (!text) return <Blank />;
  return (
    <div className={`${width} line-clamp-2 whitespace-normal`} title={text}>
      {text}
    </div>
  );
}

export function Medicines() {
  const query = useQuery({
    queryKey: ["inventory", "catalogue"],
    queryFn: () => api<Catalogue>("/api/inventory/medicines"),
  });
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const search = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const stock = params.get("stock") ?? "";
  const letter = params.get("letter") ?? "";
  const [asking, setAsking] = useState(false);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const data = query.data;
  const shown = useMemo(() => {
    if (!data) return [];
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return data.rows.filter((row) => {
      if (category && row.category !== category) return false;
      if (stock === "low" && row.status === "ok") return false;
      if (stock === "out" && row.status !== "out") return false;
      if (stock === "promo" && !onOffer(row)) return false;
      if (letter && !row.name.toUpperCase().startsWith(letter)) return false;
      const text = [
        row.name,
        row.strength,
        row.generic,
        row.sku,
        row.code,
        row.manufacturer,
        row.brand,
        row.category,
        row.form,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [data, search, category, stock, letter]);

  if (!data) return <PageState query={query} what="the medicines" />;
  const { can, buyerTypes } = data;
  const low = data.rows.filter((row) => row.status === "low").length;
  const out = data.rows.filter((row) => row.status === "out").length;
  const promos = data.rows.filter(onOffer).length;
  const head =
    "border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase";

  return (
    <div className="mx-auto flex max-w-[96rem] flex-col gap-4">
      <PageHead
        title="Medicines & stock"
        sub="What is in stock, what each buyer pays for one piece, and what each medicine is"
        actions={
          // Adding medicines is Inventory's work; everyone else asks Inventory for one.
          can.catalogue ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Add medicine
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 shadow-2xs hover:bg-amber-100"
            >
              <MessageSquarePlus size={16} aria-hidden="true" /> Medicine not available
            </button>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Medicines"
          value={count(data.rows.length)}
          sub={`${count(data.categories.length)} ${data.categories.length === 1 ? "category" : "categories"}`}
          to="?"
        />
        <Figure
          label="Low on stock"
          value={count(low)}
          sub={low ? "at or under the reorder level" : "none"}
          tone={low ? "warn" : undefined}
          to="?stock=low"
        />
        <Figure
          label="Out of stock"
          value={count(out)}
          sub={out ? "nothing sellable" : "none"}
          tone={out ? "bad" : undefined}
          to="?stock=out"
        />
        <Figure
          label="Promos running"
          value={count(promos)}
          sub={promos ? "today" : "none today"}
          to="?stock=promo"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-0 flex-[3_1_16rem]">
          <Search
            size={17}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2"
            aria-hidden="true"
          />
          <input
            aria-label="Search a medicine"
            placeholder="Search by name, molecule, SKU or maker"
            value={search}
            onChange={(event) => set("q", event.target.value)}
            className="field pl-10"
          />
        </div>
        {data.categories.length > 0 && (
          <select
            aria-label="Category"
            className={`${INPUT} flex-[1_1_12rem]`}
            value={category}
            onChange={(event) => set("category", event.target.value)}
          >
            <option value="">All categories</option>
            {data.categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        {stock && (
          <button
            type="button"
            onClick={() => set("stock", "")}
            className="h-10 shrink-0 rounded-lg px-3 text-xs font-semibold text-emerald-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {stock === "promo" ? "Promos only" : stock === "out" ? "Out of stock only" : "Low and out only"} · Show all
          </button>
        )}
      </div>

      {/* A to Z, as the old CRM had: a letter shows the medicines starting with it. */}
      <nav
        aria-label="Medicines by first letter"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
      >
        <button
          type="button"
          aria-pressed={!letter}
          onClick={() => set("letter", "")}
          className={`h-8 shrink-0 rounded-lg px-3 text-xs font-semibold ${!letter ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300" : "text-slate-600 hover:bg-slate-100"}`}
        >
          All
        </button>
        {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((one) => {
          const has = data.rows.some((row) => row.name.toUpperCase().startsWith(one));
          return (
            <button
              key={one}
              type="button"
              disabled={!has}
              aria-pressed={letter === one}
              onClick={() => set("letter", letter === one ? "" : one)}
              className={`h-8 w-8 shrink-0 rounded-lg text-xs font-semibold tabular-nums ${
                letter === one
                  ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
                  : has
                    ? "text-slate-700 hover:bg-slate-100"
                    : "cursor-default text-slate-300"
              }`}
            >
              {one}
            </button>
          );
        })}
      </nav>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-2xs lg:block">
        <table className="w-full border-collapse text-[13px] whitespace-nowrap">
          <thead>
            <tr className="text-left">
              <th className={`sticky left-0 z-10 ${head} px-5`}>Medicine</th>
              <th className={`${head} text-right`}>In stock</th>
              <th className={head}>Status</th>
              <th className={head}>Molecule</th>
              <th className={head}>Form · pack</th>
              <th className={head}>Category</th>
              <th className={head}>Maker</th>
              <th className={head}>Type</th>
              {buyerTypes.map((type) => (
                <th key={type.key} className={`${head} text-right`}>
                  {type.label}
                </th>
              ))}
              <th className={`${head} text-right`}>Promo</th>
              {can.cost && <th className={`${head} text-right`}>Cost</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/medicines/${row.id}`)}
                className="group cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-hover"
              >
                <td className="sticky left-0 z-10 bg-white px-5 py-3 group-hover:bg-hover">
                  {/* A set width: one long name must not stretch every row (Aryan, 18 Nov). */}
                  <div className="w-56 whitespace-normal">
                    <Link
                      to={`/medicines/${row.id}`}
                      className="line-clamp-2 font-semibold hover:text-brand"
                      onClick={(event) => event.stopPropagation()}
                      title={`${row.name} ${row.strength ?? ""}`.trim()}
                    >
                      {row.name} {row.strength}
                    </Link>
                    <div className="truncate text-xs text-ink-2">{row.sku ?? row.code}</div>
                    {row.offers.length > 0 && (
                      <div className="mt-1">
                        <OfferTag row={row} />
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {count(row.total)}
                  <div className="text-xs font-normal text-ink-2">
                    {inPacks(row.total, row.packSize)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <StatusPill row={{ status: row.status, expiringSoon: false }} />
                </td>
                <td className="px-3 py-3">
                  <Wrap width="w-48" text={row.generic} />
                </td>
                <td className="px-3 py-3">
                  <Wrap width="w-40" text={[row.form, row.pack].filter(Boolean).join(" · ")} />
                </td>
                <td className="px-3 py-3">
                  <Wrap width="w-36" text={row.category} />
                </td>
                <td className="px-3 py-3">
                  <Wrap width="w-40" text={row.manufacturer} />
                </td>
                <td className="px-3 py-3">
                  <div className="w-36 whitespace-normal">
                    {row.rx ? "Rx" : "OTC"} · VAT {VAT[row.vat]}
                    {row.coldChain && <span className="text-sky-700"> · Cold chain</span>}
                    {row.coldBox && <span className="text-sky-700"> · Cold-chain box</span>}
                  </div>
                </td>
                {buyerTypes.map((type) => (
                  <td key={type.key} className="px-3 py-3 text-right">
                    {row.prices[type.key] === undefined ? (
                      <Blank />
                    ) : (
                      <>
                        {peso(row.prices[type.key] as number)}
                        {row.packSize > 1 && (
                          <div className="text-xs text-ink-2">
                            {peso(
                              packPrice(
                                row.prices[type.key] as number,
                                row.packPrices[type.key],
                                row.packSize,
                              ),
                            )}{" "}
                            a pack
                          </div>
                        )}
                      </>
                    )}
                  </td>
                ))}
                <td className="px-3 py-3 text-right">
                  {row.promo ? (
                    <>
                      <span className="font-semibold text-brand-dark">
                        {peso(row.promo.amount)}
                      </span>
                      <div className="text-xs text-ink-2">
                        to {dayLabel(row.promo.endsOn, data.today)}
                      </div>
                    </>
                  ) : (
                    <Blank />
                  )}
                </td>
                {can.cost && (
                  <td className="px-3 py-3 text-right">
                    {row.cost === null ? <Blank /> : peso(row.cost)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <NoResults title="No medicine matches.">Try another filter, or check the spelling of the search.</NoResults>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:hidden">
        {shown.map((row) => (
          <MedicineCard key={row.id} row={row} data={data} />
        ))}
        {shown.length === 0 && (
          <Card>
            <NoResults title="No medicine matches.">Try another filter, or check the spelling of the search.</NoResults>
          </Card>
        )}
      </div>

      <div className="text-[13px] text-ink-2">
        {shown.length === data.rows.length
          ? `${count(shown.length)} medicines`
          : `${count(shown.length)} of ${count(data.rows.length)} medicines`}
        {" · every price is for one piece (a tablet, a vial); the pack price is under it"}
      </div>

      {!can.catalogue && <MyRequests />}

      {asking && <MedicineRequestDialog catalogue={data} onClose={() => setAsking(false)} />}

      {adding && (
        <MedicineDialog
          onClose={() => setAdding(false)}
          onSaved={(id) => navigate(`/medicines/${id}`)}
        />
      )}
    </div>
  );
}

const Blank = () => <span className="text-ink-2">—</span>;

function MedicineCard({ row, data }: { row: CatalogueRow; data: Catalogue }) {
  return (
    <Link
      to={`/medicines/${row.id}`}
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-white p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">
            {row.name} {row.strength}
          </div>
          <div className="text-xs text-ink-2">
            {[row.sku ?? row.code, row.generic].filter(Boolean).join(" · ")}
          </div>
        </div>
        <StatusPill row={{ status: row.status, expiringSoon: false }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <OfferTag row={row} />
        {row.form && <Pill>{row.form}</Pill>}
        {row.pack && <Pill>{row.pack}</Pill>}
        {row.category && <Pill>{row.category}</Pill>}
        <Pill>{row.rx ? "Rx" : "OTC"}</Pill>
        {row.coldChain && <Pill>Cold chain</Pill>}
        {row.coldBox && <Pill>Cold-chain box</Pill>}
        {row.manufacturer && <Pill>{row.manufacturer}</Pill>}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-line-soft pt-2.5 text-[13px]">
        {data.buyerTypes
          .filter((type) => row.prices[type.key] !== undefined)
          .map((type) => (
            <div key={type.key} className="flex justify-between gap-2">
              <dt className="text-ink-2">{type.label}</dt>
              <dd className="font-medium">
                {peso(row.prices[type.key] as number)}
                {row.packSize > 1 && (
                  <span className="font-normal text-ink-2">
                    {" "}
                    ·{" "}
                    {peso(
                      packPrice(
                        row.prices[type.key] as number,
                        row.packPrices[type.key],
                        row.packSize,
                      ),
                    )}{" "}
                    pack
                  </span>
                )}
              </dd>
            </div>
          ))}
        {row.promo && (
          <div className="flex justify-between gap-2">
            <dt className="font-semibold text-brand-dark">Promo</dt>
            <dd className="font-semibold">{peso(row.promo.amount)}</dd>
          </div>
        )}
        {row.cost !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-ink-2">Cost</dt>
            <dd className="font-medium">{peso(row.cost)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-ink-2">In stock</dt>
          <dd className="font-semibold">
            {count(row.total)}
            {inPacks(row.total, row.packSize) && (
              <span className="font-normal text-ink-2"> · {inPacks(row.total, row.packSize)}</span>
            )}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
