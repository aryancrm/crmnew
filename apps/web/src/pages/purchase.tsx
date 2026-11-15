// One purchase: what was ordered from a supplier, every cost on the way in, and what each
// medicine cost to land. The form shows the landed cost while it is typed, worked out by
// the same function the API uses.

import { COST_KINDS, type CostKind, landedCosts } from "@2mg/api/landed";
import type { PurchaseChoices, PurchaseDetail } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import {
  Button,
  Card,
  count,
  Dialog,
  dayLabel,
  Facts,
  Field,
  INPUT,
  inPacks,
  PageHead,
  PageState,
  Pill,
  Problem,
  peso,
  timeLabel,
  useAction,
} from "../ui";

const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.replace(/,/g, "")));
const centavos = (text: string) => Math.round(number(text) * 100);
const kindLabel = (kind: string) => COST_KINDS.find((entry) => entry.key === kind)?.label ?? kind;
const foreign = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export function Purchase() {
  const param = useParams().id ?? "";
  const isNew = param === "new";
  const id = Number(param);
  const detail = useQuery({
    queryKey: ["inventory", "purchase", id],
    queryFn: () => api<PurchaseDetail>(`/api/purchases/${id}`),
    enabled: !isNew,
  });
  const choices = useQuery({
    queryKey: ["inventory", "purchase-choices"],
    queryFn: () => api<PurchaseChoices>("/api/purchases/choices"),
    enabled: isNew,
  });
  const [editing, setEditing] = useState(false);

  if (isNew) {
    if (!choices.data) return <PageState query={choices} what="the purchase form" />;
    return (
      <Frame title="New purchase">
        <PurchaseForm
          choices={choices.data}
          today={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date())}
        />
      </Frame>
    );
  }
  if (!detail.data) return <PageState query={detail} what="this purchase" />;
  const data = detail.data;
  if (editing)
    return (
      <Frame
        title={`${data.purchase.code} · ${data.purchase.state === "received" ? "costs" : "edit"}`}
      >
        <PurchaseForm
          choices={data.choices}
          today={data.today}
          detail={data}
          onDone={() => setEditing(false)}
        />
      </Frame>
    );
  return <PurchaseView data={data} onEdit={() => setEditing(true)} />;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Link
        to="/purchases"
        className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-ink-2 hover:text-brand"
      >
        <ArrowLeft size={15} aria-hidden="true" /> Purchases
      </Link>
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- the form

type LineDraft = { key: number; medicineId: string; qty: string; unitCost: string };
type CostDraft = { key: number; kind: CostKind; amount: string; note: string };
let nextKey = 1;

function PurchaseForm({
  choices,
  today,
  detail,
  onDone,
}: {
  choices: PurchaseChoices;
  today: string;
  detail?: PurchaseDetail;
  onDone?: () => void;
}) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const action = useAction();
  const purchase = detail?.purchase;
  /** Once received only the rate, the costs and the notes change. */
  const received = purchase?.state === "received";
  const suppliers = choices.suppliers.filter(
    (supplier) => supplier.active || supplier.id === purchase?.supplierId,
  );

  const [supplierId, setSupplierId] = useState(String(purchase?.supplierId ?? ""));
  const [warehouseId, setWarehouseId] = useState(
    String(purchase?.warehouseId ?? choices.warehouses[0]?.id ?? ""),
  );
  const [orderedOn, setOrderedOn] = useState(purchase?.orderedOn ?? today);
  const [expectedOn, setExpectedOn] = useState(purchase?.expectedOn ?? "");
  const [currency, setCurrency] = useState(purchase?.currency ?? "USD");
  const [fxRate, setFxRate] = useState(purchase ? String(purchase.fxRate) : "");
  const [supplierRef, setSupplierRef] = useState(purchase?.supplierRef ?? "");
  const [note, setNote] = useState(purchase?.note ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    () =>
      detail?.lines.map((line) => ({
        key: nextKey++,
        medicineId: String(line.medicineId),
        qty: String(received ? (line.receivedQty ?? 0) : line.qty),
        unitCost: String(line.unitCost),
      })) ?? [{ key: nextKey++, medicineId: "", qty: "", unitCost: "" }],
  );
  const [costs, setCosts] = useState<CostDraft[]>(
    () =>
      detail?.costs.map((cost) => ({
        key: nextKey++,
        kind: cost.kind,
        amount: String(cost.amount / 100),
        note: cost.note ?? "",
      })) ?? [{ key: nextKey++, kind: "freight", amount: "", note: "" }],
  );

  const setLine = (key: number, change: Partial<LineDraft>) =>
    setLines((now) => now.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const setCost = (key: number, change: Partial<CostDraft>) =>
    setCosts((now) => now.map((cost) => (cost.key === key ? { ...cost, ...change } : cost)));

  // The landed cost as typed so far. Anything not yet a number counts as zero.
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  const extras = costs.reduce((sum, cost) => sum + safe(centavos(cost.amount)), 0);
  const landed = landedCosts(
    lines.map((line) => ({ qty: safe(number(line.qty)), unitCost: safe(number(line.unitCost)) })),
    safe(number(fxRate)),
    extras,
  );
  const goods = landed.reduce((sum, line) => sum + line.goods, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    let saved = purchase?.id;
    const done = await action.run(async () => {
      const result = await api<{ id: number }>(
        purchase ? `/api/purchases/${purchase.id}` : "/api/purchases",
        {
          body: {
            supplierId: Number(supplierId),
            warehouseId: Number(warehouseId),
            orderedOn,
            expectedOn,
            currency,
            fxRate: number(fxRate),
            supplierRef: supplierRef || null,
            note: note || null,
            lines: (received ? (detail?.lines ?? []) : lines).map((line) => ({
              medicineId: Number(line.medicineId),
              qty: typeof line.qty === "number" ? line.qty : number(line.qty),
              unitCost: typeof line.unitCost === "number" ? line.unitCost : number(line.unitCost),
            })),
            costs: costs
              .filter((cost) => cost.amount.trim() !== "")
              .map((cost) => ({
                kind: cost.kind,
                amount: centavos(cost.amount),
                note: cost.note || null,
              })),
          },
        },
      );
      saved = result.id;
    });
    if (!done) return;
    await queries.invalidateQueries({ queryKey: ["inventory"] });
    if (onDone) onDone();
    else navigate(`/purchases/${saved}`, { replace: true });
  }

  /** The typed pieces as packs of the line's medicine, to check against the supplier's boxes. */
  const packsOf = (line: LineDraft) => {
    const medicine = choices.medicines.find((entry) => String(entry.id) === line.medicineId);
    const pieces = number(line.qty);
    return medicine && Number.isFinite(pieces) ? inPacks(pieces, medicine.packSize) : "";
  };

  const medicineName = (medicineId: string) => {
    const medicine = choices.medicines.find((entry) => String(entry.id) === medicineId);
    return medicine ? `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ""}` : "";
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap gap-3">
          <Field label="Supplier" error={action.at("supplierId")}>
            {(field) => (
              <select
                {...field}
                className={INPUT}
                value={supplierId}
                disabled={received}
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  const picked = suppliers.find(
                    (supplier) => String(supplier.id) === event.target.value,
                  );
                  if (picked) setCurrency(picked.currency);
                }}
              >
                <option value="">Pick a supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                    {supplier.country ? ` · ${supplier.country}` : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Comes into" error={action.at("warehouseId")}>
            {(field) => (
              <select
                {...field}
                className={INPUT}
                value={warehouseId}
                disabled={received}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                {choices.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Ordered on" error={action.at("orderedOn")}>
            {(field) => (
              <input
                {...field}
                type="date"
                className={INPUT}
                value={orderedOn}
                disabled={received}
                onChange={(event) => setOrderedOn(event.target.value)}
              />
            )}
          </Field>
          <Field label="Expected on" error={action.at("expectedOn")}>
            {(field) => (
              <input
                {...field}
                type="date"
                className={INPUT}
                value={expectedOn}
                disabled={received}
                onChange={(event) => setExpectedOn(event.target.value)}
              />
            )}
          </Field>
          <Field label="Currency" error={action.at("currency")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={currency}
                disabled={received}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label={`Pesos for 1 ${currency || "unit"}`} error={action.at("fxRate")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                inputMode="decimal"
                placeholder="58.20"
                value={fxRate}
                onChange={(event) => setFxRate(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Supplier's invoice or reference (optional)">
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={supplierRef}
                onChange={(event) => setSupplierRef(event.target.value)}
              />
            )}
          </Field>
          <Field label="Note (optional)">
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-bold">Medicines</h2>
        {received && (
          <div className="text-[13px] text-ink-2">
            Received: the medicines and quantities can't change any more.
          </div>
        )}
        {lines.map((line, index) => (
          <div
            key={line.key}
            className="flex flex-wrap items-end gap-3 border-b border-line-soft pb-3 last:border-b-0 last:pb-0"
          >
            <div className="min-w-0 flex-[3_1_14rem]">
              <Field label="Medicine" error={action.at(`lines.${index}.medicineId`)}>
                {(field) =>
                  received ? (
                    <input
                      {...field}
                      className={INPUT}
                      value={medicineName(line.medicineId)}
                      disabled
                    />
                  ) : (
                    <select
                      {...field}
                      className={INPUT}
                      value={line.medicineId}
                      onChange={(event) => setLine(line.key, { medicineId: event.target.value })}
                    >
                      <option value="">Pick a medicine</option>
                      {choices.medicines.map((medicine) => (
                        <option key={medicine.id} value={medicine.id}>
                          {medicine.name} {medicine.strength}
                          {medicine.pack ? ` · ${medicine.pack}` : ""}
                        </option>
                      ))}
                    </select>
                  )
                }
              </Field>
            </div>
            <div className="flex-[1_1_6rem]">
              <Field
                label={
                  received
                    ? "Received (pieces)"
                    : `Pieces${packsOf(line) ? ` · ${packsOf(line)}` : ""}`
                }
                error={action.at(`lines.${index}.qty`)}
              >
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    inputMode="numeric"
                    value={line.qty}
                    disabled={received}
                    onChange={(event) => setLine(line.key, { qty: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="flex-[1_1_8rem]">
              <Field
                label={`Price of one piece (${currency || "currency"})`}
                error={action.at(`lines.${index}.unitCost`)}
              >
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    inputMode="decimal"
                    value={line.unitCost}
                    disabled={received}
                    onChange={(event) => setLine(line.key, { unitCost: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="flex h-11 flex-[1_1_9rem] flex-col justify-center">
              <div className="text-xs text-ink-2">Lands at</div>
              <div className="font-semibold">
                {landed[index]?.landedUnit ? `${peso(landed[index].landedUnit)} each` : "—"}
              </div>
            </div>
            {!received && lines.length > 1 && (
              <button
                type="button"
                aria-label="Remove this medicine"
                onClick={() => setLines((now) => now.filter((entry) => entry.key !== line.key))}
                className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-bad-tint hover:text-bad"
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {action.at("lines") && <div className="text-[13px] text-bad">{action.at("lines")}</div>}
        {!received && (
          <Button
            className="self-start"
            onClick={() =>
              setLines((now) => [...now, { key: nextKey++, medicineId: "", qty: "", unitCost: "" }])
            }
          >
            <Plus size={16} aria-hidden="true" /> Add a medicine
          </Button>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-base font-bold">Other costs, in pesos</h2>
          <div className="text-[13px] text-ink-2">
            The flight, packaging, customs and anything else paid to bring it in. They are shared
            over the medicines by value.
          </div>
        </div>
        {costs.map((cost, index) => (
          <div key={cost.key} className="flex flex-wrap items-end gap-3">
            <div className="flex-[2_1_11rem]">
              <Field label="Cost">
                {(field) => (
                  <select
                    {...field}
                    className={INPUT}
                    value={cost.kind}
                    onChange={(event) =>
                      setCost(cost.key, { kind: event.target.value as CostKind })
                    }
                  >
                    {COST_KINDS.map((kind) => (
                      <option key={kind.key} value={kind.key}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div className="flex-[1_1_8rem]">
              <Field label="Amount (₱)" error={action.at(`costs.${index}.amount`)}>
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    inputMode="decimal"
                    value={cost.amount}
                    onChange={(event) => setCost(cost.key, { amount: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="flex-[3_1_12rem]">
              <Field label="Note (optional)">
                {(field) => (
                  <input
                    {...field}
                    className={INPUT}
                    value={cost.note}
                    onChange={(event) => setCost(cost.key, { note: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <button
              type="button"
              aria-label="Remove this cost"
              onClick={() => setCosts((now) => now.filter((entry) => entry.key !== cost.key))}
              className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-bad-tint hover:text-bad"
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </div>
        ))}
        <Button
          className="self-start"
          onClick={() =>
            setCosts((now) => [...now, { key: nextKey++, kind: "other", amount: "", note: "" }])
          }
        >
          <Plus size={16} aria-hidden="true" /> Add a cost
        </Button>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <Totals goods={goods} extras={extras} />
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => (onDone ? onDone() : navigate("/purchases"))}
            disabled={action.busy}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : purchase ? "Save" : "Place purchase"}
          </Button>
        </div>
        <div className="basis-full empty:hidden">
          <Problem
            message={action.problem && !action.problem.fields ? action.problem.message : null}
          />
        </div>
      </Card>
    </form>
  );
}

function Totals({ goods, extras }: { goods: number; extras: number }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2">
      <div>
        <dt className="text-xs text-ink-2">Goods</dt>
        <dd className="font-semibold">{peso(goods)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-2">Other costs</dt>
        <dd className="font-semibold">{peso(extras)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-2">Landed total</dt>
        <dd className="text-xl font-bold">{peso(goods + extras)}</dd>
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------- reading one

function PurchaseView({ data, onEdit }: { data: PurchaseDetail; onEdit: () => void }) {
  const { purchase, lines, costs, can } = data;
  const queries = useQueryClient();
  const action = useAction();
  const [receiving, setReceiving] = useState(false);
  const ordered = purchase.state === "ordered";

  async function cancel() {
    const done = await action.run(async () => {
      await api(`/api/purchases/${purchase.id}/cancel`, { method: "POST" });
    });
    if (done) await queries.invalidateQueries({ queryKey: ["inventory"] });
  }

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title={purchase.code}
        tags={
          ordered ? (
            <Pill tone={purchase.late ? "bad" : "info"}>{purchase.late ? "Late" : "Issued"}</Pill>
          ) : (
            <Pill tone={purchase.state === "received" ? "good" : "plain"}>
              {purchase.state === "received" ? "Received" : "Cancelled"}
            </Pill>
          )
        }
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <Link to="/purchases" className="text-brand-dark hover:underline">
              Purchase orders
            </Link>
            <span>/</span>
            {purchase.supplier}
            {purchase.country ? ` · ${purchase.country}` : ""}
          </span>
        }
        actions={
          can.purchase &&
          purchase.state !== "cancelled" && (
            <>
              {ordered && (
                <Button variant="primary" onClick={() => setReceiving(true)}>
                  <PackageCheck size={16} aria-hidden="true" /> Receive
                </Button>
              )}
              <Button onClick={onEdit}>
                <Pencil size={16} aria-hidden="true" /> {ordered ? "Edit" : "Change costs"}
              </Button>
              {ordered && (
                <Button variant="danger" onClick={cancel} disabled={action.busy}>
                  Cancel order
                </Button>
              )}
            </>
          )
        }
      >
        <Facts
          rows={[
            ["Order", ordered ? "Issued" : purchase.state === "received" ? "Closed" : "Cancelled"],
            [
              "Receive",
              purchase.state === "received" ? "Received" : ordered ? "Yet to be received" : "—",
            ],
            ["Order date", dayLabel(purchase.orderedOn, data.today)],
            [ordered ? "Delivery date" : "Was due", dayLabel(purchase.expectedOn, data.today)],
            ["Receive into", purchase.warehouse],
            ["Rate", `1 ${purchase.currency} = ₱${purchase.fxRate}`],
            ["Supplier's reference", purchase.supplierRef],
            ["Placed by", purchase.createdBy],
            [
              "Received by",
              purchase.receivedBy && purchase.receivedAt
                ? `${purchase.receivedBy} · ${timeLabel(purchase.receivedAt)}`
                : null,
            ],
            ["Note", purchase.note],
          ]}
        />
      </PageHead>

      {ordered && can.purchase && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-info-fill/30 bg-info-tint px-4 py-2.5">
          <span className="font-bold text-info">What's next?</span>
          <span className="min-w-0 flex-1 basis-60">
            When the goods arrive, receive them: type each batch and its expiry, and the stock and
            its landed cost are in.
          </span>
          <Button variant="primary" small onClick={() => setReceiving(true)}>
            Receive
          </Button>
        </div>
      )}
      <Problem message={action.problem?.message} />

      <Card className="p-4">
        <Totals goods={purchase.goodsTotal} extras={purchase.extrasTotal} />
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-base font-bold">Medicines</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse">
            <thead>
              <tr className="text-left text-xs text-ink-2">
                <th className="border-b border-line py-2 pr-3 font-medium">Medicine</th>
                <th className="border-b border-line px-3 py-2 text-right font-medium">
                  {ordered ? "Ordered" : "Received"}
                </th>
                <th className="border-b border-line px-3 py-2 text-right font-medium">
                  Price of one
                </th>
                <th className="border-b border-line px-3 py-2 text-right font-medium">Goods</th>
                <th className="border-b border-line px-3 py-2 text-right font-medium">
                  Share of costs
                </th>
                <th className="border-b border-line py-2 pl-3 text-right font-medium">Lands at</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line-soft last:border-b-0">
                  <td className="py-2.5 pr-3">
                    <Link
                      to={`/medicines/${line.medicineId}`}
                      className="font-semibold hover:text-brand"
                    >
                      {line.medicine}
                    </Link>
                    {line.batchNo && (
                      <div className="text-xs text-ink-2">
                        Batch {line.batchNo} · expires{" "}
                        {line.expiresOn ? dayLabel(line.expiresOn) : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {count(line.receivedQty ?? line.qty)}
                    {line.receivedQty !== null && line.receivedQty !== line.qty && (
                      <div className="text-xs text-warn">of {count(line.qty)} ordered</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {foreign(line.unitCost, purchase.currency)}
                  </td>
                  <td className="px-3 py-2.5 text-right">{peso(line.goods)}</td>
                  <td className="px-3 py-2.5 text-right">{peso(line.extras)}</td>
                  <td className="py-2.5 pl-3 text-right font-semibold">
                    {line.landedUnit ? `${peso(line.landedUnit)} each` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-base font-bold">Other costs</h2>
        {costs.length === 0 ? (
          <div className="text-ink-2">None recorded.</div>
        ) : (
          <ul className="flex flex-col">
            {costs.map((cost, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed while shown
              <li
                key={index}
                className="flex justify-between gap-4 border-b border-line-soft py-2 last:border-b-0"
              >
                <span>
                  {kindLabel(cost.kind)}
                  {cost.note ? <span className="text-ink-2"> · {cost.note}</span> : null}
                </span>
                <span className="font-medium">{peso(cost.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {receiving && <ReceivePurchase data={data} onClose={() => setReceiving(false)} />}
    </div>
  );
}

function ReceivePurchase({ data, onClose }: { data: PurchaseDetail; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [rows, setRows] = useState(() =>
    data.lines.map((line) => ({
      lineId: line.id,
      medicine: line.medicine,
      qty: String(line.qty),
      batchNo: "",
      expiresOn: "",
    })),
  );
  const set = (lineId: number, change: Partial<(typeof rows)[number]>) =>
    setRows((now) => now.map((row) => (row.lineId === lineId ? { ...row, ...change } : row)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(`/api/purchases/${data.purchase.id}/receive`, {
        body: {
          lines: rows.map((row) => ({
            lineId: row.lineId,
            qty: number(row.qty),
            batchNo: row.batchNo,
            expiresOn: row.expiresOn || null,
          })),
        },
      });
    });
    if (!done) return;
    await queries.invalidateQueries({ queryKey: ["inventory"] });
    onClose();
  }

  return (
    <Dialog title={`Receive ${data.purchase.code}`} onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="text-[13px] text-ink-2">
          Type what arrived, from the boxes. Type 0 for a medicine that didn't come. It goes into{" "}
          {data.purchase.warehouse}.
        </div>
        {rows.map((row, index) => (
          <div
            key={row.lineId}
            className="flex flex-col gap-2 border-b border-line-soft pb-4 last:border-b-0 last:pb-0"
          >
            <div className="font-semibold">{row.medicine}</div>
            <div className="flex flex-wrap gap-3">
              <div className="flex-[1_1_5rem]">
                <Field label="Arrived" error={action.at(`lines.${index}.qty`)}>
                  {(field) => (
                    <input
                      {...field}
                      className={INPUT}
                      inputMode="numeric"
                      value={row.qty}
                      onChange={(event) => set(row.lineId, { qty: event.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="flex-[2_1_8rem]">
                <Field label="Batch number" error={action.at(`lines.${index}.batchNo`)}>
                  {(field) => (
                    <input
                      {...field}
                      className={INPUT}
                      value={row.batchNo}
                      onChange={(event) => set(row.lineId, { batchNo: event.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="flex-[2_1_9rem]">
                <Field label="Expiry date" error={action.at(`lines.${index}.expiresOn`)}>
                  {(field) => (
                    <input
                      {...field}
                      type="date"
                      className={INPUT}
                      value={row.expiresOn}
                      onChange={(event) => set(row.lineId, { expiresOn: event.target.value })}
                    />
                  )}
                </Field>
              </div>
            </div>
          </div>
        ))}
        <Problem
          message={
            action.problem &&
            !Object.keys(action.problem.fields ?? {}).length &&
            !/^lines\.\d/.test(action.problem.field ?? "")
              ? action.problem.message
              : null
          }
        />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Receiving…" : "Receive into stock"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
