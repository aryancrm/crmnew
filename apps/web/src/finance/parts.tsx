// What Finance's screens share: an invoice's state as a pill, typing an amount in pesos, and
// the dialogs that move money: confirm an advance payment, record a payment, give money back,
// take a mistaken payment off.

import type { InvoiceState, OrderDetail, OrderPaper, PaymentMethod } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, FileText } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { PAPER_ACCEPT, uploadPaper } from "../photo";
import { Button, Dialog, Field, INPUT, Problem, peso, Status, useAction } from "../ui";
import { noProofWords } from "./no-proof";
import { rememberConfirm } from "./undo";

export const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "bank", label: "Bank transfer" },
  { key: "cash", label: "Cash" },
  { key: "check", label: "Check" },
  { key: "ewallet", label: "GCash / Maya" },
  { key: "other", label: "Other" },
];

/** Today in Manila, as YYYY-MM-DD. */
export const todayManila = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

export function InvoiceStatus({ state }: { state: InvoiceState }) {
  return <Status tone={state.tone === "plain" ? "plain" : state.tone}>{state.word}</Status>;
}

/** Centavos as the pesos typed in a box: 150000 → "1500.00". */
const asTyped = (centavos: number) => (centavos / 100).toFixed(2);
/** What was typed, in centavos; NaN when it isn't an amount. */
const centavos = (typed: string) => {
  const clean = typed.replace(/[₱,\s]/g, "");
  return /^\d+(\.\d{0,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : Number.NaN;
};

/** Runs one of Finance's writes and re-reads the order and money screens. */
export function useMoney() {
  const queries = useQueryClient();
  const action = useAction();
  async function run(path: string, body: unknown) {
    const done = await action.run(async () => {
      await api(path, { body });
    });
    await Promise.all([
      queries.invalidateQueries({ queryKey: ["orders"] }),
      queries.invalidateQueries({ queryKey: ["finance"] }),
    ]);
    return done;
  }
  return { ...action, send: run };
}

function AmountField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <Field label={label} error={error}>
      {(field) => (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">
            ₱
          </span>
          <input
            {...field}
            inputMode="decimal"
            className={`${INPUT} pl-7 tabular-nums`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )}
    </Field>
  );
}

function HowFields({
  method,
  setMethod,
  reference,
  setReference,
  day,
  setDay,
  dayLabel,
  at,
}: {
  method: PaymentMethod;
  setMethod: (value: PaymentMethod) => void;
  reference: string;
  setReference: (value: string) => void;
  day: string;
  setDay: (value: string) => void;
  dayLabel: string;
  at: (field: string) => string | undefined;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="How" error={at("method")}>
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {METHODS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={dayLabel} error={at("paidOn") ?? at("refundedOn")}>
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
      <Field
        label={method === "check" ? "Check number and bank" : "Reference (bank or GCash reference)"}
        error={at("reference")}
      >
        {(field) => (
          <input
            {...field}
            className={INPUT}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        )}
      </Field>
    </>
  );
}

function ProofThumb({ paper }: { paper: OrderPaper }) {
  return (
    <a
      href={`/api/papers/${paper.id}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-xl border border-line-soft bg-hover px-2.5 py-2 hover:border-emerald-300"
    >
      {paper.mime.startsWith("image/") ? (
        <img
          src={`/api/papers/${paper.id}`}
          alt={paper.name}
          className="size-12 rounded-lg object-cover"
          loading="lazy"
        />
      ) : (
        <span className="grid size-12 place-items-center rounded-lg bg-white text-slate-500">
          <FileText size={20} aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{paper.name}</span>
        <span className="text-xs text-ink-2">Added by {paper.by} · open it</span>
      </span>
    </a>
  );
}

/** An advance order: look at the slip, say what came in, tick, confirm. The order then gets its
 *  invoice and goes to Dispatch. */
export function ConfirmPaymentDialog({
  orderId,
  code,
  customer,
  total,
  onClose,
}: {
  orderId: number;
  code: string;
  customer: string;
  total: number;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["orders", "one", orderId],
    queryFn: () => api<OrderDetail>(`/api/orders/${orderId}`),
  });
  const money = useMoney();
  const [amount, setAmount] = useState(asTyped(total));
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [reference, setReference] = useState("");
  const [day, setDay] = useState(todayManila());
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const proofs = (detail.data?.papers ?? []).filter((paper) => paper.kind === "payment_proof");
  // What the invoice (made when Management approved) still lacks: points, or money received
  // before (an order brought back after a cancel), are on it already.
  const bill = detail.data?.money.invoice;
  const due = bill && bill.status !== "cancelled" ? Math.max(0, bill.total - bill.paid) : total;
  const paidBefore = bill && bill.status !== "cancelled" ? bill.paid : 0;
  const [typedByHand, setTypedByHand] = useState(false);
  useEffect(() => {
    if (!typedByHand) setAmount(asTyped(due));
  }, [due, typedByHand]);
  const typed = centavos(amount);
  const short = Number.isFinite(typed) && typed > 0 && typed < due ? due - typed : 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await money.send(`/api/finance/orders/${orderId}/confirm-payment`, {
      amount: typed,
      method,
      reference,
      paidOn: day,
      checked,
      note,
    });
    if (done) {
      rememberConfirm(orderId, code);
      onClose();
    }
  }
  const order = detail.data?.order;
  const why = order ? noProofWords(order.noProofReason, order.noProofNote) : null;

  return (
    <Dialog title={`Confirm payment · ${code}`} onClose={onClose} busy={money.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-hover px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{customer}</div>
            <div className="text-xs text-ink-2">
              Pays in advance
              {paidBefore > 0 ? ` · ${peso(paidBefore)} on the invoice already` : ""}
            </div>
          </div>
          <div className="text-lg font-bold tabular-nums">{peso(due)}</div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-600">Proof of payment</div>
          {detail.isPending ? (
            <div className="text-[13px] text-ink-2">Reading the papers…</div>
          ) : proofs.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {proofs.map((paper) => (
                <ProofThumb key={paper.id} paper={paper} />
              ))}
            </div>
          ) : (
            <div className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
              <span
                className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400"
                aria-hidden="true"
              />
              <span>
                {why ? (
                  <>
                    <b>No slip.</b> {order?.medrep ?? "The MedRep"} says: {why}
                  </>
                ) : (
                  <>
                    <b>No slip on the order.</b> Type the bank reference you checked, or hold it
                    until the MedRep adds the proof.
                  </>
                )}
              </span>
            </div>
          )}
        </div>

        <AmountField
          label="Amount received"
          value={amount}
          onChange={(value) => {
            setTypedByHand(true);
            setAmount(value);
          }}
          error={money.at("amount")}
        />
        {due === 0 && (
          <div className="-mt-2 text-[13px] text-good">
            Paid already: confirm with ₱0.00 and it goes to Dispatch.
          </div>
        )}
        {short > 0 && (
          <div className="-mt-2 text-[13px] text-amber-800">
            {peso(short)} less than the order: it stays owed on the invoice.
          </div>
        )}
        <HowFields
          method={method}
          setMethod={setMethod}
          reference={reference}
          setReference={setReference}
          day={day}
          setDay={setDay}
          dayLabel="Paid on"
          at={money.at}
        />
        <Field label="Note (optional)" error={money.at("note")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-soft px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-emerald-700"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span className="text-[13px]">
            I have checked the proof, and this money is in our account.
          </span>
        </label>
        {money.at("checked") && (
          <div className="-mt-2 text-[13px] text-bad">{money.at("checked")}</div>
        )}
        <Problem
          message={money.general(["amount", "method", "reference", "paidOn", "note", "checked"])}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={money.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={money.busy || !checked}>
            {money.busy ? "Confirming…" : "Confirm payment"}
          </Button>
        </div>
        <div className="-mt-1 text-right text-xs text-ink-2">
          The invoice is made and the order goes to Dispatch.
        </div>
      </form>
    </Dialog>
  );
}

/** Money received against an invoice, with an optional slip. */
export function RecordPaymentDialog({
  invoiceId,
  code,
  balance,
  orderId,
  proofs,
  onClose,
}: {
  invoiceId: number;
  code: string;
  balance: number;
  orderId: number;
  proofs: OrderPaper[];
  onClose: () => void;
}) {
  const money = useMoney();
  const queries = useQueryClient();
  const [amount, setAmount] = useState(asTyped(balance));
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [reference, setReference] = useState("");
  const [day, setDay] = useState(todayManila());
  const [note, setNote] = useState("");
  const [proofId, setProofId] = useState("");
  const [added, setAdded] = useState<{ id: number; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const typed = centavos(amount);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await money.send(`/api/invoices/${invoiceId}/payments`, {
      amount: typed,
      method,
      reference,
      paidOn: day,
      note,
      proofId: proofId ? Number(proofId) : null,
    });
    if (done) onClose();
  }

  return (
    <Dialog title={`Record payment · ${code}`} onClose={onClose} busy={money.busy || uploading}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl border border-line-soft bg-hover px-4 py-3 text-[13px]">
          <span>Still owed</span>
          <span className="text-lg font-bold tabular-nums">{peso(balance)}</span>
        </div>
        <AmountField
          label="Amount received"
          value={amount}
          onChange={setAmount}
          error={money.at("amount")}
        />
        <HowFields
          method={method}
          setMethod={setMethod}
          reference={reference}
          setReference={setReference}
          day={day}
          setDay={setDay}
          dayLabel="Paid on"
          at={money.at}
        />
        <Field label="Slip (optional)" error={money.at("proofId")}>
          {(field) => (
            <div className="flex flex-wrap items-center gap-2">
              <select
                {...field}
                className={`${INPUT} min-w-0 flex-1`}
                value={proofId}
                onChange={(event) => setProofId(event.target.value)}
              >
                <option value="">No slip</option>
                {[
                  ...proofs,
                  ...(added && !proofs.some((paper) => paper.id === added.id)
                    ? [{ id: added.id, name: added.name }]
                    : []),
                ].map((paper) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.name}
                  </option>
                ))}
              </select>
              <label
                className={`inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 ${uploading ? "pointer-events-none opacity-50" : ""}`}
              >
                <Camera size={15} aria-hidden="true" /> {uploading ? "Adding…" : "Add photo"}
                <input
                  type="file"
                  accept={PAPER_ACCEPT}
                  className="sr-only"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setUploading(true);
                    setUploadProblem(null);
                    try {
                      const id = await uploadPaper(orderId, "payment_proof", file);
                      setAdded({ id, name: file.name });
                      setProofId(String(id));
                      await queries.invalidateQueries({ queryKey: ["finance"] });
                    } catch (error) {
                      setUploadProblem(
                        error instanceof Error
                          ? error.message
                          : "That photo didn't upload. Try again.",
                      );
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
            </div>
          )}
        </Field>
        {uploadProblem && <Problem message={uploadProblem} />}
        <Field label="Note (optional)" error={money.at("note")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Problem
          message={money.general(["amount", "method", "reference", "paidOn", "note", "proofId"])}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={money.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={money.busy || uploading}>
            {money.busy ? "Saving…" : "Record payment"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Money given back for a cancelled order. */
export function RefundDialog({
  invoiceId,
  code,
  owed,
  onClose,
}: {
  invoiceId: number;
  code: string;
  owed: number;
  onClose: () => void;
}) {
  const money = useMoney();
  const [amount, setAmount] = useState(asTyped(owed));
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [reference, setReference] = useState("");
  const [day, setDay] = useState(todayManila());
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      await money.send(`/api/invoices/${invoiceId}/refunds`, {
        amount: centavos(amount),
        method,
        reference,
        refundedOn: day,
        note,
      })
    )
      onClose();
  }
  return (
    <Dialog title={`Give money back · ${code}`} onClose={onClose} busy={money.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl border border-line-soft bg-hover px-4 py-3 text-[13px]">
          <span>Owed back to the customer</span>
          <span className="text-lg font-bold tabular-nums">{peso(owed)}</span>
        </div>
        <AmountField
          label="Amount given back"
          value={amount}
          onChange={setAmount}
          error={money.at("amount")}
        />
        <HowFields
          method={method}
          setMethod={setMethod}
          reference={reference}
          setReference={setReference}
          day={day}
          setDay={setDay}
          dayLabel="Given back on"
          at={money.at}
        />
        <Field label="Note (optional)" error={money.at("note")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Problem message={money.general(["amount", "method", "reference", "refundedOn", "note"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={money.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={money.busy}>
            {money.busy ? "Saving…" : "Record refund"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A payment recorded by mistake: taken off with why, kept in the history. */
export function RemovePaymentDialog({
  paymentId,
  what,
  onClose,
}: {
  paymentId: number;
  what: string;
  onClose: () => void;
}) {
  const money = useMoney();
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await money.send(`/api/payments/${paymentId}/remove`, { reason })) onClose();
  }
  return (
    <Dialog title="Take off this payment" onClose={onClose} busy={money.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="text-[13px] text-ink-2">
          {what}. It stays in the history, marked taken off, and the invoice is owed again.
        </div>
        <Field label="Why" error={money.at("reason")}>
          {(field) => (
            <textarea
              {...field}
              className={`${INPUT} min-h-20`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <Problem message={money.general(["reason"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={money.busy}>
            Close
          </Button>
          <Button type="submit" variant="danger" disabled={money.busy}>
            {money.busy ? "Saving…" : "Take it off"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
