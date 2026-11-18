// One medicine: its stock by warehouse and batch, every price, what is coming, what moved.
// Aryan kept this layout (15 Nov): the prices and promos sit at the top of the right column so
// they are seen without scrolling.

import type { MedicineDetail } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ClipboardCheck, Megaphone, PackagePlus, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import {
  CountDialog,
  MedicineDialog,
  MoveDialog,
  NewsDialog,
  PricesDialog,
  OfferDialog,
  PromoDialog,
  ReceiveDialog,
} from "../inventory/dialogs";
import { NewsList } from "../inventory/news";
import {
  Button,
  Card,
  count,
  dayLabel,
  daysBetween,
  Facts,
  inPacks,
  PageHead,
  PageState,
  Pill,
  packPrice,
  peso,
  timeLabel,
} from "../ui";
import { StatusPill } from "./inventory";

type Line = MedicineDetail["batches"][number];
type Open =
  | { kind: "receive" | "move" | "edit" | "prices" | "promo" | "offer" | "news" }
  | { kind: "count"; line?: Line }
  | null;

const VAT = { exempt: "VAT exempt", vat12: "VAT 12%", zero: "Zero-rated" };
const MOVE: Record<string, string> = {
  receive: "Received",
  move_out: "Moved out",
  move_in: "Moved in",
  count: "Stock count",
  deliver: "Packed for an order",
  return: "Back from an order",
};

type EditKind = "edit" | "prices" | "promo" | "offer";

/** One Edit for a medicine (Aryan, 18 Nov: "Edit shows nothing about the doctor's, hospital's,
 *  patient's price, or where a promo runs"): its details, what each buyer pays, a promo price for
 *  everyone, an offer (Buy X Take Y, or a price for one kind of buyer). Each part saves on its own. */
function EditTabs({
  now,
  can,
  onPick,
}: {
  now: EditKind;
  can: MedicineDetail["can"];
  onPick: (kind: EditKind) => void;
}) {
  const tabs: { kind: EditKind; label: string; allowed: boolean }[] = [
    { kind: "edit", label: "Details", allowed: can.catalogue },
    { kind: "prices", label: "Prices", allowed: can.price },
    { kind: "promo", label: "Promo", allowed: can.price },
    { kind: "offer", label: "Buy X Take Y", allowed: can.price },
  ];
  return (
    <div className="-mt-1 flex flex-col gap-1.5">
      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={tab.kind === now}
            disabled={!tab.allowed}
            onClick={() => onPick(tab.kind)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap ${
              tab.kind === now
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : tab.allowed
                  ? "text-slate-600 hover:bg-white/70"
                  : "cursor-not-allowed text-slate-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {!can.price && (
        <div className="text-[12px] text-slate-500">
          Prices, promos and offers are set by Management, the CEO or the Admin.
        </div>
      )}
    </div>
  );
}

export function Medicine() {
  const id = Number(useParams().id);
  const query = useQuery({
    queryKey: ["inventory", "medicine", id],
    queryFn: () => api<MedicineDetail>(`/api/inventory/medicines/${id}`),
  });
  const queries = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  const data = query.data;
  if (!data) return <PageState query={query} what="this medicine" />;
  const { medicine, can, warehouses, today } = data;
  const place = (warehouseId: number) =>
    warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? "";
  const sellableIn = (warehouseId: number) =>
    data.batches
      .filter((line) => line.warehouseId === warehouseId && line.state !== "expired")
      .reduce((sum, line) => sum + line.qty, 0);
  const expiringSoon = data.batches.some((line) => line.state === "soon");
  const promoNow = data.promos.find((promo) => promo.state === "now");
  const size = medicine.packSize ?? 1;
  const piece = medicine.unit ?? "piece";
  const choice = [{ id: medicine.id, name: medicine.name, strength: medicine.strength ?? null }];

  async function endOffer(offerId: number) {
    await api(`/api/inventory/offers/${offerId}/end`, { method: "POST" }).catch(() => undefined);
    await queries.invalidateQueries({ queryKey: ["inventory"] });
  }
  async function endPromo(promoId: number) {
    await api(`/api/inventory/promos/${promoId}/end`, { method: "POST" }).catch(() => undefined);
    await queries.invalidateQueries({ queryKey: ["inventory"] });
  }

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title={`${medicine.name} ${medicine.strength ?? ""}`.trim()}
        tags={<StatusPill row={{ status: data.status, expiringSoon }} />}
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <Link to="/medicines" className="text-brand-dark hover:underline">
              All medicines
            </Link>
            <span>/</span>
            {medicine.sku ?? medicine.code}
          </span>
        }
        actions={
          <>
            {can.stock && (
              <>
                <Button variant="primary" onClick={() => setOpen({ kind: "receive" })}>
                  <PackagePlus size={16} aria-hidden="true" /> Add stock (not bought)
                </Button>
                <Button
                  onClick={() => setOpen({ kind: "move" })}
                  disabled={data.batches.length === 0 || warehouses.length < 2}
                >
                  <ArrowLeftRight size={16} aria-hidden="true" /> Transfer
                </Button>
                <Button onClick={() => setOpen({ kind: "news" })}>
                  <Megaphone size={16} aria-hidden="true" /> Post news
                </Button>
              </>
            )}
            {(can.catalogue || can.price) && (
              <Button onClick={() => setOpen({ kind: can.catalogue ? "edit" : "prices" })}>
                <Pencil size={16} aria-hidden="true" /> {can.price ? "Edit · prices · promos" : "Edit"}
              </Button>
            )}
          </>
        }
      >
        <Facts
          rows={[
            ["SKU", medicine.sku ?? medicine.code],
            ["Pack", medicine.pack],
            ["Form", medicine.form],
            ["Type", medicine.rx ? "Prescription" : "Over the counter"],
            [
              "Storage",
              medicine.coldBox
                ? "Cold-chain box: priced by Management on each order"
                : medicine.coldChain
                  ? "Cold chain (packed cold)"
                  : "Room temperature",
            ],
            ["VAT", VAT[medicine.vat]],
            [
              "Low-stock level",
              medicine.reorderLevel > 0 ? count(medicine.reorderLevel) : "Not set",
            ],
          ]}
        />
      </PageHead>

      <Card className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Figure
            label={`Free to sell${size > 1 ? ` · ${inPacks(data.total, size) || "0 packs"}` : ""}`}
            value={count(data.total)}
            strong
          />
          {warehouses.map((warehouse) => (
            <Figure
              key={warehouse.id}
              label={`${warehouse.name}${inPacks(sellableIn(warehouse.id), size) ? ` · ${inPacks(sellableIn(warehouse.id), size)}` : ""}`}
              value={count(sellableIn(warehouse.id))}
            />
          ))}
          {data.expired > 0 && (
            <Figure label="Expired, on the shelf" value={count(data.expired)} tone="bad" />
          )}
          <Figure
            label={medicine.reorderLevel > 0 ? "Low-stock level" : "Low-stock level not set"}
            value={medicine.reorderLevel > 0 ? count(medicine.reorderLevel) : "—"}
          />
        </div>

        {data.news.length > 0 && (
          <div className="border-t border-slate-100 pt-2">
            <NewsList news={data.news} canClose={can.stock} />
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_34rem] flex-col gap-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">Batches</h2>
              {can.stock && data.batches.length > 0 && (
                <Button small onClick={() => setOpen({ kind: "count" })}>
                  <ClipboardCheck size={15} aria-hidden="true" /> Stock count
                </Button>
              )}
            </div>
            {data.batches.length === 0 ? (
              <div className="py-6 text-center text-slate-500">Nothing on the shelf.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                      <th className="border-b border-slate-200 py-2 pr-3">Batch</th>
                      <th className="border-b border-slate-200 px-3 py-2">Warehouse</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Quantity</th>
                      <th className="border-b border-slate-200 px-3 py-2">Expiry</th>
                      {can.cost && (
                        <th className="border-b border-slate-200 py-2 pl-3 text-right">
                          Cost of one
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.batches.map((line) => (
                      <tr
                        key={`${line.batchId}:${line.warehouseId}`}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="py-2.5 pr-3 font-semibold">{line.batchNo}</td>
                        <td className="px-3 py-2.5">{place(line.warehouseId)}</td>
                        <td className="px-3 py-2.5 text-right">{count(line.qty)}</td>
                        <td className="px-3 py-2.5">
                          <span className="mr-2">{dayLabel(line.expiresOn)}</span>
                          {line.state === "expired" && <Pill tone="bad">Expired</Pill>}
                          {line.state === "soon" && (
                            <Pill tone="warn">In {daysBetween(today, line.expiresOn)} days</Pill>
                          )}
                        </td>
                        {can.cost && (
                          <td className="py-2.5 pl-3 text-right">
                            {line.unitCost === null ? (
                              <span className="text-slate-500">Not known</span>
                            ) : (
                              peso(line.unitCost)
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.coming.length > 0 && (
              <div className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Coming</div>
                {data.coming.map((row) => (
                  <div key={row.to} className="flex flex-wrap justify-between gap-x-4">
                    <span>
                      {count(row.qty)} into {row.warehouse} · {row.supplier} ·{" "}
                      {can.cost ? (
                        <Link
                          to={row.to}
                          className="font-medium text-brand"
                        >
                          {row.code}
                        </Link>
                      ) : (
                        row.code
                      )}
                    </span>
                    <span className={row.late ? "font-semibold text-bad" : "text-slate-500"}>
                      {row.late ? "Late · was due " : "Due "}
                      {dayLabel(row.expectedOn, today)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
              What moved
            </h2>
            {data.moves.length === 0 ? (
              <div className="py-6 text-center text-slate-500">No movement yet.</div>
            ) : (
              <ul className="flex flex-col">
                {data.moves.map((move) => (
                  <li
                    key={move.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-slate-100 py-2 last:border-b-0"
                  >
                    <span className="w-28 shrink-0 text-slate-500">{timeLabel(move.at)}</span>
                    <span className="font-medium">{MOVE[move.kind] ?? move.kind}</span>
                    <span
                      className={
                        move.qty < 0 ? "font-semibold text-bad" : "font-semibold text-good"
                      }
                    >
                      {move.qty > 0 ? "+" : "−"}
                      {count(Math.abs(move.qty))}
                    </span>
                    <span className="text-slate-500">
                      {move.batchNo} · {move.warehouse}
                      {move.ref ? ` · ${move.ref}` : ""}
                      {move.note ? ` · ${move.note}` : ""}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">{move.by}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-4">
          {/* Prices and promos first: what a seller looks for, seen without scrolling. */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-2.5">
              <h2 className="text-sm font-semibold tracking-tight text-slate-900">
                Prices & promos{" "}
                <span className="text-xs font-normal text-slate-500">for one {piece}</span>
              </h2>
              {can.price && (
                <Button small onClick={() => setOpen({ kind: "prices" })}>
                  <Pencil size={14} aria-hidden="true" /> Edit prices
                </Button>
              )}
            </div>
            <dl className="flex flex-col">
              {data.buyerTypes.map(({ key, label }) => (
                <div
                  key={key}
                  className="flex justify-between gap-4 border-b border-slate-100 py-2"
                >
                  <dt className="text-slate-500">{label}</dt>
                  <dd
                    className={
                      data.prices[key] === undefined ? "text-slate-500" : "text-right font-medium"
                    }
                  >
                    {data.prices[key] === undefined ? "Not set" : peso(data.prices[key] as number)}
                    {size > 1 && data.prices[key] !== undefined && (
                      <div className="text-xs font-normal text-slate-500">
                        {peso(packPrice(data.prices[key] as number, data.packPrices[key], size))}{" "}
                        for {medicine.pack ?? `a pack of ${size}`}
                      </div>
                    )}
                    {data.cost && data.prices[key] !== undefined && (
                      <Margin
                        price={data.prices[key] as number}
                        cost={data.cost.average}
                        vat={medicine.vat}
                      />
                    )}
                  </dd>
                </div>
              ))}
              {promoNow && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="font-semibold text-brand-dark">
                    {promoNow.name} · to {dayLabel(promoNow.endsOn, today)}
                  </dt>
                  <dd className="text-right font-semibold">
                    {peso(promoNow.amount)}
                    {data.cost && (
                      <Margin price={promoNow.amount} cost={data.cost.average} vat={medicine.vat} />
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {data.cost && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px]">
                <div className="font-semibold">
                  Landed cost of one {piece}:{" "}
                  {data.cost.min === data.cost.max
                    ? peso(data.cost.min)
                    : `${peso(data.cost.min)} to ${peso(data.cost.max)}`}
                </div>
                <div className="text-slate-500">
                  Average on the shelf {peso(data.cost.average)}. The margin beside each price is
                  against this average
                  {medicine.vat === "vat12" ? ", with the 12% VAT taken out of the price" : ""}.
                </div>
              </div>
            )}
            <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-500">Promos</div>
                {can.price && (
                  <button
                    type="button"
                    onClick={() => setOpen({ kind: "promo" })}
                    className="text-[13px] font-medium text-brand"
                  >
                    Add a promo
                  </button>
                )}
              </div>
              {data.promos.length === 0 && <div className="text-slate-500">No promo.</div>}
              {data.promos.map((promo) => (
                <div
                  key={promo.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                >
                  <span>
                    {promo.name} · {peso(promo.amount)}
                    <span className="text-slate-500">
                      {" "}
                      · {dayLabel(promo.startsOn, today)} to {dayLabel(promo.endsOn, today)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill tone={promo.state === "now" ? "brand" : "plain"}>
                      {promo.state === "now"
                        ? "Running"
                        : promo.state === "later"
                          ? "Not started"
                          : "Ended"}
                    </Pill>
                    {can.price && promo.state !== "ended" && (
                      <button
                        type="button"
                        onClick={() => endPromo(promo.id)}
                        className="text-[13px] font-medium text-bad"
                      >
                        End
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {/* Offers (the hub's Buy 1 Take 1, the Christmas offers): orders take them by themselves. */}
            <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-500">Offers</div>
                {can.price && (
                  <button
                    type="button"
                    onClick={() => setOpen({ kind: "offer" })}
                    className="text-[13px] font-medium text-brand"
                  >
                    Add an offer
                  </button>
                )}
              </div>
              {data.offers.length === 0 && <div className="text-slate-500">No offer.</div>}
              {data.offers.map((offer) => (
                <div key={offer.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span>
                    {offer.name}
                    {offer.price !== null ? ` · ${peso(offer.price)} a piece` : ""}
                    <span className="text-slate-500">
                      {" "}
                      · {offer.buyerLabel} · from {dayLabel(offer.startsOn, today)}
                      {offer.endsOn ? ` to ${dayLabel(offer.endsOn, today)}` : ", until ended"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill tone={offer.state === "now" ? "brand" : "plain"}>
                      {offer.state === "now" ? "Running" : offer.state === "later" ? "Not started" : "Ended"}
                    </Pill>
                    {can.price && offer.state !== "ended" && (
                      <button
                        type="button"
                        onClick={() => endOffer(offer.id)}
                        className="text-[13px] font-medium text-bad"
                      >
                        End
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
              Details
            </h2>
            <dl className="flex flex-col">
              {(
                [
                  ["Molecule", medicine.generic],
                  ["Strength", medicine.strength],
                  ["Form", medicine.form],
                  ["Pack", medicine.pack],
                  ["One piece is a", medicine.unit],
                  ["Pieces in a pack", size > 1 ? count(size) : null],
                  ["Category", medicine.category],
                  ["Maker", medicine.manufacturer],
                  ["Our brand", medicine.brand],
                  ["SKU", medicine.sku],
                  ["System code", medicine.code],
                ] as const
              )
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0"
                  >
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
            </dl>
          </Card>

          {can.price && data.priceChanges.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
                Price history
              </h2>
              <ul className="flex flex-col">
                {data.priceChanges.map((change) => (
                  <li key={change.id} className="border-b border-slate-100 py-2 last:border-b-0">
                    <div>
                      {change.what}: {change.old === null ? "none" : peso(change.old)} →{" "}
                      {change.new === null ? "none" : peso(change.new)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {change.by} · {timeLabel(change.at)}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {open?.kind === "receive" && (
        <ReceiveDialog
          warehouses={warehouses}
          medicines={choice}
          medicineId={medicine.id}
          canCost={can.cost}
          onClose={close}
        />
      )}
      {open?.kind === "move" && <MoveDialog detail={data} onClose={close} />}
      {open?.kind === "count" && <CountDialog detail={data} start={open.line} onClose={close} />}
      {open?.kind === "edit" && (
        <MedicineDialog medicine={medicine} onClose={close} tabs={<EditTabs now="edit" can={can} onPick={(kind) => setOpen({ kind })} />} />
      )}
      {open?.kind === "prices" && (
        <PricesDialog detail={data} onClose={close} tabs={<EditTabs now="prices" can={can} onPick={(kind) => setOpen({ kind })} />} />
      )}
      {open?.kind === "promo" && (
        <PromoDialog detail={data} onClose={close} tabs={<EditTabs now="promo" can={can} onPick={(kind) => setOpen({ kind })} />} />
      )}
      {open?.kind === "offer" && (
        <OfferDialog detail={data} onClose={close} tabs={<EditTabs now="offer" can={can} onPick={(kind) => setOpen({ kind })} />} />
      )}
      {open?.kind === "news" && (
        <NewsDialog medicines={choice} medicineId={medicine.id} onClose={close} />
      )}
    </div>
  );
}

/** What is left of a price after the landed cost, in pesos and as a share of the price. */
/** What is left of a price after the cost; a VAT-inclusive price counts without its VAT (the VAT
 *  is the government's, not margin). */
function Margin({ price, cost, vat }: { price: number; cost: number; vat?: string }) {
  const net = vat === "vat12" ? Math.round(price / 1.12) : price;
  const margin = net - cost;
  const share = net > 0 ? Math.round((margin / net) * 100) : 0;
  return (
    <div className={`text-xs font-normal ${margin < 0 ? "text-bad" : "text-good"}`}>
      {margin < 0 ? "−" : "+"}
      {peso(Math.abs(margin))} · {share}%
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "bad";
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-xl border p-3 ${
        tone === "bad"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : strong
            ? "border-emerald-200 bg-emerald-50/70"
            : "border-slate-200 bg-white"
      }`}
    >
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <span
        className={`text-lg font-bold tracking-tight tabular-nums ${tone === "bad" ? "" : strong ? "text-emerald-800" : "text-slate-900"}`}
      >
        {value}
      </span>
    </div>
  );
}
