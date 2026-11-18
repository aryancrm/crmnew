// Inventory's forms. Each one is a dialog over the page that saves with one call and then
// refreshes every inventory screen.

import type { BuyerType, MedicineDetail, NewsKind, Vat, Warehouse } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../api";
import { Button, count, Dialog, dayLabel, Field, INPUT, Problem, useAction } from "../ui";

type MedicineChoice = { id: number; name: string; strength: string | null };

/** Saves, refreshes inventory everywhere, closes. */
function useSave(onClose: () => void) {
  const queries = useQueryClient();
  const action = useAction();
  const save = (work: () => Promise<unknown>) => async (event: FormEvent) => {
    event.preventDefault();
    const done = await action.run(async () => {
      await work();
    });
    if (!done) return;
    await queries.invalidateQueries({ queryKey: ["inventory"] });
    onClose();
  };
  return { ...action, save };
}

function Form({
  title,
  action,
  fields,
  submit,
  onClose,
  onSubmit,
  tabs,
  wide,
  children,
}: {
  title: string;
  action: ReturnType<typeof useSave>;
  fields: string[];
  submit: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  /** A medicine's Edit: Details · Prices · Promo · Offer, one strip on top of each form. */
  tabs?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog title={title} onClose={onClose} busy={action.busy} wide={wide}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {tabs}
        {children}
        <Problem message={action.general(fields)} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : submit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const Row = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap gap-3">{children}</div>
);
const whole = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.replace(/,/g, "")));
/** Pesos typed by a person, as centavos; null when left empty. */
const centavos = (text: string) =>
  text.trim() === "" ? null : Math.round(Number(text.replace(/,/g, "")) * 100);
const medicineName = (medicine: MedicineChoice) =>
  `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ""}`;

// ---------------------------------------------------------------- receive

export function ReceiveDialog(props: {
  warehouses: Warehouse[];
  medicines: MedicineChoice[];
  /** Receiving for one medicine (its page). */
  medicineId?: number;
  /** Whether this person may record what the stock cost. */
  canCost?: boolean;
  onClose: () => void;
}) {
  const action = useSave(props.onClose);
  const [medicineId, setMedicineId] = useState(String(props.medicineId ?? ""));
  const [warehouseId, setWarehouseId] = useState(String(props.warehouses[0]?.id ?? ""));
  const [batchNo, setBatchNo] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [qty, setQty] = useState("");
  const [ref, setRef] = useState("");
  const [cost, setCost] = useState("");
  const fixed = Boolean(props.medicineId);

  return (
    <Form
      title="Add stock without a purchase"
      action={action}
      fields={["medicineId", "warehouseId", "batchNo", "expiresOn", "qty", "unitCost"]}
      submit="Add stock"
      onClose={props.onClose}
      onSubmit={action.save(() =>
        api("/api/inventory/receive", {
          body: {
            medicineId: Number(medicineId),
            warehouseId: Number(warehouseId),
            batchNo,
            expiresOn,
            qty: whole(qty),
            ref: ref || null,
            unitCost: props.canCost ? centavos(cost) : null,
          },
        }),
      )}
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
        Only for stock that was not bought: opening stock, goods found in a count, a correction.
        Bought from a vendor? Receive it on its purchase order (Purchases → Purchase orders →
        Receive): that keeps the vendor, the bill and the cost, and nothing is entered twice.{" "}
        <a href="/books/purchaseorders" className="font-semibold underline">
          Open purchase orders
        </a>
      </div>
      <Field label="Medicine" error={action.at("medicineId")}>
        {(field) => (
          <select
            {...field}
            className={INPUT}
            value={medicineId}
            disabled={fixed}
            onChange={(event) => setMedicineId(event.target.value)}
          >
            <option value="">Pick a medicine</option>
            {props.medicines.map((medicine) => (
              <option key={medicine.id} value={medicine.id}>
                {medicineName(medicine)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Row>
        <Field label="Into warehouse" error={action.at("warehouseId")}>
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              {props.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Quantity" error={action.at("qty")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              inputMode="numeric"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Batch number on the box" error={action.at("batchNo")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={batchNo}
              onChange={(event) => setBatchNo(event.target.value)}
            />
          )}
        </Field>
        <Field label="Expiry date" error={action.at("expiresOn")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              type="date"
              value={expiresOn}
              onChange={(event) => setExpiresOn(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Why (optional)">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="Opening stock"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
            />
          )}
        </Field>
        {props.canCost && (
          <Field label="Cost of one, landed (₱, optional)" error={action.at("unitCost")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                inputMode="decimal"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
            )}
          </Field>
        )}
      </Row>
    </Form>
  );
}

// ---------------------------------------------------------------- move and count

type Line = MedicineDetail["batches"][number];
const lineKey = (line: Line) => `${line.batchId}:${line.warehouseId}`;

function LineSelect(props: {
  detail: MedicineDetail;
  value: string;
  onChange: (value: string) => void;
  field: { id: string };
}) {
  const place = (id: number) =>
    props.detail.warehouses.find((warehouse) => warehouse.id === id)?.name ?? "";
  return (
    <select
      {...props.field}
      className={INPUT}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      <option value="">Pick a batch</option>
      {props.detail.batches.map((line) => (
        <option key={lineKey(line)} value={lineKey(line)}>
          {line.batchNo} · {place(line.warehouseId)} · {count(line.qty)} · expires{" "}
          {dayLabel(line.expiresOn)}
        </option>
      ))}
    </select>
  );
}

export function MoveDialog({ detail, onClose }: { detail: MedicineDetail; onClose: () => void }) {
  const action = useSave(onClose);
  const [line, setLine] = useState(detail.batches[0] ? lineKey(detail.batches[0]) : "");
  const [batchId, from] = line.split(":").map(Number);
  const others = detail.warehouses.filter((warehouse) => warehouse.id !== from);
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const target = to && Number(to) !== from ? to : String(others[0]?.id ?? "");

  return (
    <Form
      title="Move between warehouses"
      action={action}
      fields={["batchId", "toWarehouseId", "qty"]}
      submit="Move"
      onClose={onClose}
      onSubmit={action.save(() =>
        api("/api/inventory/move", {
          body: { batchId, fromWarehouseId: from, toWarehouseId: Number(target), qty: whole(qty) },
        }),
      )}
    >
      <Field label="Batch, and where it is now" error={action.at("batchId")}>
        {(field) => <LineSelect detail={detail} value={line} onChange={setLine} field={field} />}
      </Field>
      <Row>
        <Field label="Move to" error={action.at("toWarehouseId")}>
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={target}
              onChange={(event) => setTo(event.target.value)}
            >
              {others.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Quantity" error={action.at("qty")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              inputMode="numeric"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
            />
          )}
        </Field>
      </Row>
    </Form>
  );
}

export function CountDialog({
  detail,
  start,
  onClose,
}: {
  detail: MedicineDetail;
  start?: Line;
  onClose: () => void;
}) {
  const action = useSave(onClose);
  const [line, setLine] = useState(
    start ? lineKey(start) : detail.batches[0] ? lineKey(detail.batches[0]) : "",
  );
  const [batchId, warehouseId] = line.split(":").map(Number);
  const onShelf = detail.batches.find((entry) => lineKey(entry) === line)?.qty ?? 0;
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const differs = counted.trim() !== "" && whole(counted) !== onShelf;

  return (
    <Form
      title="Stock count"
      action={action}
      fields={["batchId", "counted", "reason"]}
      submit="Save count"
      onClose={onClose}
      onSubmit={action.save(() =>
        api("/api/inventory/count", {
          body: { batchId, warehouseId, counted: whole(counted), reason: reason || null },
        }),
      )}
    >
      <Field label="Batch, and where it is" error={action.at("batchId")}>
        {(field) => <LineSelect detail={detail} value={line} onChange={setLine} field={field} />}
      </Field>
      <Row>
        <Field
          label={`You counted (the system has ${count(onShelf)})`}
          error={action.at("counted")}
        >
          {(field) => (
            <input
              {...field}
              className={INPUT}
              inputMode="numeric"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
            />
          )}
        </Field>
      </Row>
      {differs && (
        <Field label="Why it differs" error={action.at("reason")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- the medicine itself

export function MedicineDialog({
  medicine,
  onClose,
  onSaved,
  tabs,
}: {
  medicine?: MedicineDetail["medicine"];
  onClose: () => void;
  onSaved?: (id: number) => void;
  tabs?: ReactNode;
}) {
  const action = useSave(onClose);
  const [name, setName] = useState(medicine?.name ?? "");
  const [generic, setGeneric] = useState(medicine?.generic ?? "");
  const [strength, setStrength] = useState(medicine?.strength ?? "");
  const [form, setForm] = useState(medicine?.form ?? "");
  const [pack, setPack] = useState(medicine?.pack ?? "");
  const [sku, setSku] = useState(medicine?.sku ?? "");
  const [unit, setUnit] = useState(medicine?.unit ?? "");
  const [packSize, setPackSize] = useState(String(medicine?.packSize ?? 1));
  const [category, setCategory] = useState(medicine?.category ?? "");
  const [manufacturer, setManufacturer] = useState(medicine?.manufacturer ?? "");
  const [brand, setBrand] = useState(medicine?.brand ?? "");
  const [rx, setRx] = useState(medicine?.rx ?? true);
  const [storage, setStorage] = useState<"room" | "cold" | "box">(
    medicine?.coldBox ? "box" : medicine?.coldChain ? "cold" : "room",
  );
  const [vat, setVat] = useState<Vat>(medicine?.vat ?? "exempt");
  const [noSamples, setNoSamples] = useState(medicine?.noSamples ?? false);
  const [reorder, setReorder] = useState(String(medicine?.reorderLevel ?? 0));

  return (
    <Form
      title={medicine ? "Edit medicine" : "Add medicine"}
      tabs={tabs}
      action={action}
      fields={["name", "strength", "sku", "packSize", "reorderLevel"]}
      submit={medicine ? "Save" : "Add medicine"}
      onClose={onClose}
      onSubmit={action.save(async () => {
        const saved = await api<{ id: number }>(
          medicine ? `/api/inventory/medicines/${medicine.id}` : "/api/inventory/medicines",
          {
            body: {
              name,
              sku,
              generic,
              strength,
              form,
              pack,
              unit,
              packSize: whole(packSize),
              category,
              manufacturer,
              brand,
              rx,
              coldChain: storage === "cold",
              coldBox: storage === "box",
              noSamples,
              vat,
              reorderLevel: whole(reorder),
            },
          },
        );
        onSaved?.(saved.id);
      })}
    >
      <Row>
        <Field label="Name" error={action.at("name")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Strength" error={action.at("strength")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="1 mg"
              value={strength}
              onChange={(event) => setStrength(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Molecule (generic name)">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={generic}
              onChange={(event) => setGeneric(event.target.value)}
            />
          )}
        </Field>
        <Field label="SKU" error={action.at("sku")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="GM-4524"
              value={sku}
              onChange={(event) => setSku(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Form">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="Tablet, injection…"
              value={form}
              onChange={(event) => setForm(event.target.value)}
            />
          )}
        </Field>
        <Field label="One piece is a">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="tablet, capsule, vial"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Pieces in a pack" error={action.at("packSize")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              inputMode="numeric"
              placeholder="30"
              value={packSize}
              onChange={(event) => setPackSize(event.target.value)}
            />
          )}
        </Field>
        <Field label="The pack is called">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="Box of 30"
              value={pack}
              onChange={(event) => setPack(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <div className="-mt-2 text-[13px] text-ink-2">
        Stock, costs and prices are all kept for one piece. Use 1 when it is only sold whole.
      </div>
      <Field label="Category">
        {(field) => (
          <input
            {...field}
            className={INPUT}
            placeholder="Cancer Therapy"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        )}
      </Field>
      <Row>
        <Field label="Maker">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={manufacturer}
              onChange={(event) => setManufacturer(event.target.value)}
            />
          )}
        </Field>
        <Field label="Our brand">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="2MG"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Prescription">
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={rx ? "yes" : "no"}
              onChange={(event) => setRx(event.target.value === "yes")}
            >
              <option value="yes">Needs a prescription</option>
              <option value="no">Over the counter</option>
            </select>
          )}
        </Field>
        <Field label="VAT">
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={vat}
              onChange={(event) => setVat(event.target.value as Vat)}
            >
              <option value="exempt">VAT exempt</option>
              <option value="vat12">VAT 12%</option>
              <option value="zero">Zero-rated</option>
            </select>
          )}
        </Field>
      </Row>
      <Field label="Storage">
        {(field) => (
          <select
            {...field}
            className={INPUT}
            value={storage}
            onChange={(event) => setStorage(event.target.value as typeof storage)}
          >
            <option value="room">Room temperature</option>
            <option value="cold">Cold chain: kept cold to the customer (packed in a styro box with ice)</option>
            <option value="box">A cold-chain box (styro): Management types its price on each order</option>
          </select>
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={noSamples} onChange={(event) => setNoSamples(event.target.checked)} />
        Never given as a sample (antimicrobials); gifts may still be given
      </label>
      <Field
        label="Low-stock level, in pieces (0 = never flag as low)"
        error={action.at("reorderLevel")}
      >
        {(field) => (
          <input
            {...field}
            className={INPUT}
            inputMode="numeric"
            value={reorder}
            onChange={(event) => setReorder(event.target.value)}
          />
        )}
      </Field>
    </Form>
  );
}

export function PricesDialog({
  detail,
  onClose,
  tabs,
}: {
  detail: MedicineDetail;
  onClose: () => void;
  tabs?: ReactNode;
}) {
  const action = useSave(onClose);
  const size = detail.medicine.packSize ?? 1;
  const piece = detail.medicine.unit ?? "piece";
  const packName = detail.medicine.pack ?? `pack of ${size}`;
  const pesos = (value: number | undefined) => (value === undefined ? "" : String(value / 100));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(detail.buyerTypes.map(({ key }) => [key, pesos(detail.prices[key])])),
  );
  const [packs, setPacks] = useState<Record<string, string>>(() =>
    Object.fromEntries(detail.buyerTypes.map(({ key }) => [key, pesos(detail.packPrices[key])])),
  );
  const fields = detail.buyerTypes.flatMap(({ key }) => [`prices.${key}`, `packPrices.${key}`]);
  const added = (key: string) => {
    const one = Number((values[key] ?? "").replace(/,/g, ""));
    return values[key]?.trim() && Number.isFinite(one)
      ? String(Math.round(one * size * 100) / 100)
      : "";
  };
  const cell =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-[14px] tabular-nums shadow-2xs outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <Form
      title="Edit medicine"
      tabs={tabs}
      action={action}
      fields={fields}
      submit="Save prices"
      onClose={onClose}
      onSubmit={action.save(() =>
        api(`/api/inventory/medicines/${detail.medicine.id}/prices`, {
          body: {
            prices: Object.fromEntries(
              detail.buyerTypes.map(({ key }) => [key, centavos(values[key] ?? "")]),
            ),
            packPrices: Object.fromEntries(
              detail.buyerTypes.map(({ key }) => [
                key,
                size > 1 ? centavos(packs[key] ?? "") : null,
              ]),
            ),
          },
        }),
      )}
    >
      <div className="text-[13px] text-ink-2">
        What each kind of buyer pays, in pesos. Every order takes its price from here.
        {size > 1
          ? ` The pack price is only for when the ${packName} has its own price; left empty, it is ${size} × the ${piece} price.`
          : ""}{" "}
        Leave a buyer empty if they aren't sold to.
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div
          className={`grid items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase ${size > 1 ? "grid-cols-[1fr_9rem_9rem]" : "grid-cols-[1fr_10rem]"}`}
        >
          <span>Buyer</span>
          <span className="text-right">One {piece} (₱)</span>
          {size > 1 && <span className="text-right">Whole {packName} (₱)</span>}
        </div>
        {detail.buyerTypes.map(({ key, label }) => {
          const wrong = action.at(`prices.${key}`) ?? action.at(`packPrices.${key}`);
          return (
            <div key={key} className="border-b border-slate-100 px-4 py-2 last:border-b-0">
              <div
                className={`grid items-center gap-3 ${size > 1 ? "grid-cols-[1fr_9rem_9rem]" : "grid-cols-[1fr_10rem]"}`}
              >
                <label htmlFor={`price-${key}`} className="text-[14px] font-medium text-slate-800">
                  {label}
                </label>
                <input
                  id={`price-${key}`}
                  className={cell}
                  inputMode="decimal"
                  placeholder="Not sold"
                  value={values[key as BuyerType] ?? ""}
                  onChange={(event) => setValues((now) => ({ ...now, [key]: event.target.value }))}
                />
                {size > 1 && (
                  <input
                    aria-label={`${label}, whole ${packName}`}
                    className={cell}
                    inputMode="decimal"
                    placeholder={added(key)}
                    value={packs[key as BuyerType] ?? ""}
                    onChange={(event) => setPacks((now) => ({ ...now, [key]: event.target.value }))}
                  />
                )}
              </div>
              {wrong && <div className="pt-1 text-right text-[12px] text-rose-700">{wrong}</div>}
            </div>
          );
        })}
      </div>
    </Form>
  );
}

export function PromoDialog({
  detail,
  onClose,
  tabs,
}: {
  detail: MedicineDetail;
  onClose: () => void;
  tabs?: ReactNode;
}) {
  const action = useSave(onClose);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [startsOn, setStartsOn] = useState(detail.today);
  const [endsOn, setEndsOn] = useState("");

  return (
    <Form
      title={tabs ? "Edit medicine" : "Add a promo price"}
      tabs={tabs}
      action={action}
      fields={["name", "amount", "startsOn", "endsOn"]}
      submit="Add promo"
      onClose={onClose}
      onSubmit={action.save(() =>
        api(`/api/inventory/medicines/${detail.medicine.id}/promos`, {
          body: { name, amount: centavos(amount), startsOn, endsOn },
        }),
      )}
    >
      <div className="text-[13px] text-ink-2">
        One price for every buyer between two days (a month's promo). For free pieces (Buy 1 Take 1)
        or a price for one kind of buyer only, use Buy X Take Y.
      </div>
      <Row>
        <Field label="Promo name" error={action.at("name")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder="November promo"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Promo price (₱)" error={action.at("amount")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="From" error={action.at("startsOn")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          )}
        </Field>
        <Field label="To" error={action.at("endsOn")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          )}
        </Field>
      </Row>
    </Form>
  );
}

/** An offer (the hub's Buy 1 Take 1, the Christmas offers): for a kind of buyer or every buyer,
 *  Buy X Take Y and / or a special price per piece bought, between two days. */
export function OfferDialog({
  detail,
  onClose,
  tabs,
}: {
  detail: MedicineDetail;
  onClose: () => void;
  tabs?: ReactNode;
}) {
  const action = useSave(onClose);
  const [buyerKind, setBuyerKind] = useState("");
  const [buy, setBuy] = useState("1");
  const [take, setTake] = useState("1");
  const [price, setPrice] = useState("");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState(detail.today);
  const [endsOn, setEndsOn] = useState("");
  const buying = Math.max(1, Number(buy) || 1);
  const free = Math.max(0, Number(take) || 0);
  return (
    <Form
      title={tabs ? "Edit medicine" : "Add an offer"}
      tabs={tabs}
      action={action}
      fields={["buyerKind", "buy", "take", "price", "name", "startsOn", "endsOn"]}
      submit="Add offer"
      onClose={onClose}
      onSubmit={action.save(() =>
        api(`/api/inventory/medicines/${detail.medicine.id}/offers`, {
          body: {
            buyerKind: buyerKind || null,
            buy: buying,
            take: free,
            price: price.trim() ? centavos(price) : null,
            name: name.trim() || null,
            startsOn,
            // None: it runs until someone ends it.
            endsOn: endsOn || null,
          },
        }),
      )}
    >
      <Row>
        <Field label="For" error={action.at("buyerKind")}>
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={buyerKind}
              onChange={(event) => setBuyerKind(event.target.value)}
            >
              <option value="">Every buyer</option>
              <option value="hospital">Hospitals</option>
              <option value="drugstore">Drugstores</option>
              <option value="doctor">Doctors</option>
              <option value="distributor">Distributors</option>
              <option value="patient">Patients</option>
              <option value="government">Government buyers</option>
            </select>
          )}
        </Field>
        <Field label="Name (optional)" error={action.at("name")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              placeholder={free > 0 ? `Buy ${buying} Take ${free}` : "Special price"}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <Row>
        <Field label="Buy" error={action.at("buy")}>
          {(field) => (
            <input {...field} className={INPUT} inputMode="numeric" value={buy} onChange={(event) => setBuy(event.target.value)} />
          )}
        </Field>
        <Field label="Take free" error={action.at("take")}>
          {(field) => (
            <input {...field} className={INPUT} inputMode="numeric" value={take} onChange={(event) => setTake(event.target.value)} />
          )}
        </Field>
        <Field label="Price a piece (₱, optional)" error={action.at("price")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              inputMode="decimal"
              placeholder="Their own price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          )}
        </Field>
      </Row>
      <div className="text-[12px] text-slate-500">
        {free > 0
          ? `Every ${buying} bought, ${free} more free: an order of ${buying * 10} gets ${free * 10} free, added by itself.`
          : "No free pieces: a special price only."}
      </div>
      <Row>
        <Field label="From" error={action.at("startsOn")}>
          {(field) => (
            <input {...field} className={INPUT} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
          )}
        </Field>
        <Field label="To (optional: until ended)" error={action.at("endsOn")}>
          {(field) => (
            <input {...field} className={INPUT} type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          )}
        </Field>
      </Row>
    </Form>
  );
}

// ---------------------------------------------------------------- news and deliveries

const NEWS: { key: NewsKind; label: string }[] = [
  { key: "out", label: "Out of stock" },
  { key: "low", label: "Low stock" },
  { key: "back", label: "Back in stock" },
  { key: "note", label: "A note" },
];

export function NewsDialog(props: {
  medicines: MedicineChoice[];
  medicineId?: number;
  onClose: () => void;
}) {
  const action = useSave(props.onClose);
  const [medicineId, setMedicineId] = useState(String(props.medicineId ?? ""));
  const [kind, setKind] = useState<NewsKind>("out");
  const [message, setMessage] = useState("");

  return (
    <Form
      title="Post stock news"
      action={action}
      fields={["medicineId", "message"]}
      submit="Post"
      onClose={props.onClose}
      onSubmit={action.save(() =>
        api("/api/stock-news", {
          body: { medicineId: Number(medicineId), kind, message: message || null },
        }),
      )}
    >
      <div className="text-[13px] text-ink-2">
        Every MedRep sees this on Home. A new notice replaces the medicine's last one.
      </div>
      <Row>
        <Field label="Medicine" error={action.at("medicineId")}>
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={medicineId}
              disabled={Boolean(props.medicineId)}
              onChange={(event) => setMedicineId(event.target.value)}
            >
              <option value="">Pick a medicine</option>
              {props.medicines.map((medicine) => (
                <option key={medicine.id} value={medicine.id}>
                  {medicineName(medicine)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="What">
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={kind}
              onChange={(event) => setKind(event.target.value as NewsKind)}
            >
              {NEWS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Row>
      <Field label="Message (optional)" error={action.at("message")}>
        {(field) => (
          <input
            {...field}
            className={INPUT}
            placeholder="Back on 22 Nov"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        )}
      </Field>
    </Form>
  );
}
