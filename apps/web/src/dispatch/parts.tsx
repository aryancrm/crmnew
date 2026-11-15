// What Dispatch's screens share: the dialogs that pack (batch by batch, nearest expiry first),
// ship, mark delivered, say a parcel came back, and add a tracking number.

import type { PackPlan } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { todayManila } from "../finance/parts";
import { PAPER_ACCEPT, uploadPaper } from "../photo";
import { Button, count, Dialog, Field, INPUT, inPacks, Problem, useAction } from "../ui";

export const COURIERS = [
  "LBC",
  "J&T Express",
  "Lalamove",
  "Grab Express",
  "2GO",
  "AP Cargo",
  "Ninja Van",
  "Flash Express",
];

/** Runs one of Dispatch's steps and re-reads the order screens. */
export function useDispatch() {
  const queries = useQueryClient();
  const action = useAction();
  async function send(path: string, body: unknown) {
    const done = await action.run(async () => {
      await api(path, { body });
    });
    await Promise.all([
      queries.invalidateQueries({ queryKey: ["orders"] }),
      queries.invalidateQueries({ queryKey: ["inventory"] }),
      queries.invalidateQueries({ queryKey: ["dispatch"] }),
    ]);
    return done;
  }
  return { ...action, send };
}

/** The photo of the signed delivery receipt, put on the order before it is marked delivered:
 *  nothing is delivered without it, and a photo that didn't upload is simply tried again (once
 *  on the order, it isn't sent twice). An order already holding one needs no new photo. */
function useReceipt(orderId: number) {
  const [photo, setPhotoState] = useState<File | null>(null);
  const [sent, setSent] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload(): Promise<boolean> {
    setProblem(null);
    if (!photo || sent === photo) return true;
    setBusy(true);
    try {
      await uploadPaper(orderId, "dr", photo);
      setSent(photo);
      return true;
    } catch (error) {
      setProblem(
        `The photo didn't upload (${error instanceof Error ? error.message : "no connection"}). Press the button again to retry.`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    photo,
    sent: Boolean(photo) && sent === photo,
    setPhoto: (file: File | null) => {
      setPhotoState(file);
      setProblem(null);
    },
    upload,
    problem,
    busy,
  };
}

function ReceiptPicker({
  receipt,
  error,
}: {
  receipt: ReturnType<typeof useReceipt>;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[10px] border bg-white px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 ${error ? "border-rose-400" : "border-line"}`}
        >
          <Camera size={15} aria-hidden="true" />{" "}
          {receipt.photo ? "Change photo" : "Photo of the signed receipt *"}
          <input
            type="file"
            accept={PAPER_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              receipt.setPhoto(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
        </label>
        {receipt.photo && (
          <span className="truncate text-[13px] text-ink-2">
            {receipt.photo.name}
            {receipt.sent && <span className="text-emerald-700"> · on the order</span>}
          </span>
        )}
      </div>
      {error && <span className="text-xs font-medium text-rose-700">{error}</span>}
    </div>
  );
}

const expiry = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** Pick each line's batches (nearest expiry first is filled in), then pack: the pieces come off
 *  the shelf into the box. */
export function PackDialog({
  orderId,
  code,
  onClose,
}: {
  orderId: number;
  code: string;
  onClose: () => void;
}) {
  const plan = useQuery({
    queryKey: ["dispatch", "pack", orderId],
    queryFn: () => api<PackPlan>(`/api/dispatch/orders/${orderId}/pack`),
  });
  const work = useDispatch();
  const [picks, setPicks] = useState<Record<number, { batchId: number; qty: string }[]>>({});
  useEffect(() => {
    if (plan.data)
      setPicks(
        Object.fromEntries(
          plan.data.lines.map((line) => [
            line.itemId,
            line.suggested.map((pick) => ({ batchId: pick.batchId, qty: String(pick.qty) })),
          ]),
        ),
      );
  }, [plan.data]);
  const data = plan.data;
  const short = data?.lines.filter((line) => line.short > 0) ?? [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = Object.entries(picks).flatMap(([itemId, rows]) =>
      rows.map((row) => ({ itemId: Number(itemId), batchId: row.batchId, qty: Number(row.qty) })),
    );
    if (await work.send(`/api/dispatch/orders/${orderId}/pack`, { picks: body })) onClose();
  }

  return (
    <Dialog title={`Pack · ${code}`} onClose={onClose} busy={work.busy}>
      {!data ? (
        <div className="text-[13px] text-ink-2">
          {plan.isError
            ? plan.error instanceof Error
              ? plan.error.message
              : "Couldn't read the shelf."
            : "Reading the shelf…"}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="text-[13px] text-ink-2">
            From <span className="font-semibold text-ink">{data.warehouse}</span>. The batch that
            expires first is filled in; change it if the customer needs a longer expiry.
          </div>
          {data.lines.map((line, index) => {
            const rows = picks[line.itemId] ?? [];
            const picked = rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
            const set = (next: { batchId: number; qty: string }[]) =>
              setPicks({ ...picks, [line.itemId]: next });
            return (
              <div key={line.itemId} className="rounded-xl border border-line-soft p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-semibold">{line.medicine}</div>
                  <div
                    className={`text-[13px] tabular-nums ${picked === line.qty ? "text-good" : "text-amber-800"}`}
                  >
                    {count(picked)} of {count(line.qty)} picked
                    {inPacks(line.qty, line.packSize)
                      ? ` · ${inPacks(line.qty, line.packSize)}`
                      : ""}
                  </div>
                </div>
                {line.short > 0 && (
                  <div className="mt-1.5 text-[13px] text-bad">
                    Only {count(line.qty - line.short)} in {data.warehouse} that haven't expired.
                    Move stock there first, or ask Management to ship it from another warehouse.
                  </div>
                )}
                <div className="mt-2 flex flex-col gap-2">
                  {rows.map((row, at) => (
                    <div key={`${row.batchId}-${at}`} className="flex items-center gap-2">
                      <select
                        aria-label={`Batch for ${line.medicine}`}
                        className={`${INPUT} min-w-0 flex-1`}
                        value={row.batchId}
                        onChange={(event) =>
                          set(
                            rows.map((item, i) =>
                              i === at ? { ...item, batchId: Number(event.target.value) } : item,
                            ),
                          )
                        }
                      >
                        {line.batches.map((option) => (
                          <option key={option.batchId} value={option.batchId}>
                            {option.batchNo} · expires {expiry(option.expiresOn)} ·{" "}
                            {count(option.onShelf)} on the shelf
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Pieces"
                        inputMode="numeric"
                        className={`${INPUT} w-24 tabular-nums`}
                        value={row.qty}
                        onChange={(event) =>
                          set(
                            rows.map((item, i) =>
                              i === at
                                ? { ...item, qty: event.target.value.replace(/\D/g, "") }
                                : item,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="Remove this batch"
                        onClick={() => set(rows.filter((_, i) => i !== at))}
                        className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-hover hover:text-slate-700"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {line.batches.length > rows.length && (
                    <button
                      type="button"
                      onClick={() =>
                        set([
                          ...rows,
                          {
                            batchId:
                              line.batches.find(
                                (option) => !rows.some((row) => row.batchId === option.batchId),
                              )?.batchId ??
                              line.batches[0]?.batchId ??
                              0,
                            qty: String(Math.max(0, line.qty - picked)),
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 self-start text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      <Plus size={13} aria-hidden="true" /> Another batch
                    </button>
                  )}
                </div>
                {work.at(`lines.${index}`) && (
                  <div className="mt-1.5 text-[13px] text-bad">{work.at(`lines.${index}`)}</div>
                )}
              </div>
            );
          })}
          <Problem message={work.general(data.lines.map((_, index) => `lines.${index}`))} />
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Button onClick={onClose} disabled={work.busy}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={work.busy || short.length > 0}>
              {work.busy ? "Packing…" : "Packed"}
            </Button>
          </div>
          <div className="-mt-1 text-right text-xs text-ink-2">
            These pieces come off the shelf now.
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Who has it: a courier (tracking can follow), our rider, or it was picked up here. */
export function ShipDialog({
  orderId,
  code,
  onClose,
}: {
  orderId: number;
  code: string;
  onClose: () => void;
}) {
  const work = useDispatch();
  const [method, setMethod] = useState<"courier" | "rider" | "pickup">("courier");
  const [courier, setCourier] = useState(COURIERS[0] as string);
  const [other, setOther] = useState("");
  const [tracking, setTracking] = useState("");
  const [rider, setRider] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [day, setDay] = useState(todayManila());
  const receipt = useReceipt(orderId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (method === "pickup" && !(await receipt.upload())) return;
    const done =
      method === "pickup"
        ? await work.send(`/api/dispatch/orders/${orderId}/deliver`, {
            receivedBy,
            deliveredOn: day,
          })
        : await work.send(`/api/dispatch/orders/${orderId}/ship`, {
            method,
            courier: courier === "Other" ? other : courier,
            tracking,
            rider,
          });
    if (done) onClose();
  }

  const choice = (key: typeof method, label: string) => (
    <label
      className={`flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border px-3 py-2 text-sm font-semibold ${method === key ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-line text-slate-600 hover:bg-hover"}`}
    >
      <input
        type="radio"
        name="method"
        className="sr-only"
        checked={method === key}
        onChange={() => setMethod(key)}
      />
      {label}
    </label>
  );

  return (
    <Dialog title={`Ship · ${code}`} onClose={onClose} busy={work.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex gap-2">
          {choice("courier", "Courier")}
          {choice("rider", "Our rider")}
          {choice("pickup", "Picked up here")}
        </div>
        {method === "courier" && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Field label="Courier" error={work.at("courier")}>
                {(field) => (
                  <select
                    {...field}
                    className={INPUT}
                    value={courier}
                    onChange={(event) => setCourier(event.target.value)}
                  >
                    {[...COURIERS, "Other"].map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                )}
              </Field>
              {courier === "Other" && (
                <Field label="Which courier" error={work.at("courier")}>
                  {(field) => (
                    <input
                      {...field}
                      className={INPUT}
                      value={other}
                      onChange={(event) => setOther(event.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
            <Field label="Tracking number (can be added later)" error={work.at("tracking")}>
              {(field) => (
                <input
                  {...field}
                  className={`${INPUT} font-mono`}
                  value={tracking}
                  onChange={(event) => setTracking(event.target.value)}
                />
              )}
            </Field>
          </>
        )}
        {method === "rider" && (
          <Field label="Rider's name" error={work.at("rider")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                value={rider}
                onChange={(event) => setRider(event.target.value)}
              />
            )}
          </Field>
        )}
        {method === "pickup" && (
          <ReceiptPicker receipt={receipt} error={receipt.problem ?? work.at("proof")} />
        )}
        {method === "pickup" && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Field label="Picked up by" error={work.at("receivedBy")}>
              {(field) => (
                <input
                  {...field}
                  className={INPUT}
                  value={receivedBy}
                  onChange={(event) => setReceivedBy(event.target.value)}
                />
              )}
            </Field>
            <Field label="On" error={work.at("deliveredOn")}>
              {(field) => (
                <input
                  {...field}
                  type="date"
                  max={todayManila()}
                  className={INPUT}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        <Problem
          message={work.general([
            "courier",
            "tracking",
            "rider",
            "receivedBy",
            "deliveredOn",
            "proof",
          ])}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={work.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={work.busy || receipt.busy}>
            {receipt.busy
              ? "Uploading photo…"
              : work.busy
                ? "Saving…"
                : method === "pickup"
                  ? "Picked up"
                  : "Shipped"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The customer has it: who received it, when, and the photo of the signed delivery receipt. */
export function DeliverDialog({
  orderId,
  code,
  onClose,
}: {
  orderId: number;
  code: string;
  onClose: () => void;
}) {
  const work = useDispatch();
  const [receivedBy, setReceivedBy] = useState("");
  const [day, setDay] = useState(todayManila());
  const [note, setNote] = useState("");
  const receipt = useReceipt(orderId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // The photo goes on the order first: if it fails, nothing is marked and the button retries.
    if (!(await receipt.upload())) return;
    if (
      !(await work.send(`/api/dispatch/orders/${orderId}/deliver`, {
        receivedBy,
        deliveredOn: day,
        note,
      }))
    )
      return;
    onClose();
  }

  return (
    <Dialog title={`Delivered · ${code}`} onClose={onClose} busy={work.busy || receipt.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field label="Received by" error={work.at("receivedBy")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                placeholder="Name on the signed receipt"
                value={receivedBy}
                onChange={(event) => setReceivedBy(event.target.value)}
              />
            )}
          </Field>
          <Field label="Delivered on" error={work.at("deliveredOn")}>
            {(field) => (
              <input
                {...field}
                type="date"
                max={todayManila()}
                className={INPUT}
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            )}
          </Field>
        </div>
        <ReceiptPicker receipt={receipt} error={receipt.problem ?? work.at("proof")} />
        <Field label="Note (optional)" error={work.at("note")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Problem message={work.general(["receivedBy", "deliveredOn", "note", "proof"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={work.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={work.busy || receipt.busy}>
            {receipt.busy ? "Uploading photo…" : work.busy ? "Saving…" : "Delivered"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A short form with one box: why a parcel came back, why a box is opened, a tracking number. */
export function OneLineDialog({
  title,
  label,
  hint,
  path,
  field: name,
  button,
  danger,
  onClose,
}: {
  title: string;
  label: string;
  hint?: string;
  path: string;
  field: "reason" | "tracking";
  button: string;
  danger?: boolean;
  onClose: () => void;
}) {
  const work = useDispatch();
  const [value, setValue] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await work.send(path, { [name]: value })) onClose();
  }
  return (
    <Dialog title={title} onClose={onClose} busy={work.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {hint && <div className="text-[13px] text-ink-2">{hint}</div>}
        <Field label={label} error={work.at(name)}>
          {(field) => (
            <input
              {...field}
              className={`${INPUT} ${name === "tracking" ? "font-mono" : ""}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </Field>
        <Problem message={work.general([name])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={work.busy}>
            Close
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={work.busy}>
            {work.busy ? "Saving…" : button}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Which of Dispatch's dialogs is open over a screen. */
export type DispatchAsk = {
  what: "pack" | "ship" | "deliver" | "failed" | "unpack" | "tracking";
  orderId: number;
  code: string;
} | null;

export function DispatchDialogs({ ask, onClose }: { ask: DispatchAsk; onClose: () => void }) {
  if (!ask) return null;
  const { what, orderId, code } = ask;
  if (what === "pack") return <PackDialog orderId={orderId} code={code} onClose={onClose} />;
  if (what === "ship") return <ShipDialog orderId={orderId} code={code} onClose={onClose} />;
  if (what === "deliver") return <DeliverDialog orderId={orderId} code={code} onClose={onClose} />;
  if (what === "failed")
    return (
      <OneLineDialog
        title={`Didn't reach the customer · ${code}`}
        label="What happened"
        hint="The parcel is back with us, still packed. It can be shipped again or unpacked."
        path={`/api/dispatch/orders/${orderId}/failed`}
        field="reason"
        button="It came back"
        danger
        onClose={onClose}
      />
    );
  if (what === "unpack")
    return (
      <OneLineDialog
        title={`Unpack · ${code}`}
        label="Why (optional)"
        hint="Its pieces go back on the shelf they came from, and it waits to be packed again."
        path={`/api/dispatch/orders/${orderId}/unpack`}
        field="reason"
        button="Unpack"
        onClose={onClose}
      />
    );
  return (
    <OneLineDialog
      title={`Tracking number · ${code}`}
      label="Tracking number"
      path={`/api/dispatch/orders/${orderId}/tracking`}
      field="tracking"
      button="Save"
      onClose={onClose}
    />
  );
}
