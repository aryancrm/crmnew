// What Finance's screens share: an invoice's state as a pill, typing an amount in pesos, and
// the dialogs that move money: confirm an advance payment, record a payment, give money back,
// take a mistaken payment off.

import type {
  CustomerCredit,
  MoneyAccounts,
  InvoiceState,
  OrderDetail,
  OrderPaper,
  PaymentMethod,
} from "@2mg/api/types";
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
export const asTyped = (centavos: number) => (centavos / 100).toFixed(2);
/** What was typed, in centavos; NaN when it isn't an amount. */
export const centavos = (typed: string) => {
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

export function AmountField({
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

/** The bank, cash or e-wallet account the money went through (the books' Banking accounts): picked
 *  on every payment and refund, remembered per way of paying on this computer. */
export function useMoneyAccount(method: PaymentMethod) {
  const key = `crm:money-account:${method}`;
  const read = () => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  };
  const [value, setValue] = useState(read);
  const [missing, setMissing] = useState(false);
  // The books' bank, cash and e-wallet accounts (the form's list reads the same answer).
  const accounts = useQuery({
    queryKey: ["finance", "money-accounts"],
    queryFn: () => api<MoneyAccounts>("/api/finance/money-accounts"),
    staleTime: 10 * 60_000,
  });
  // Books with no bank or cash account yet (a new database): there is nothing to pick, so the
  // money is recorded without one instead of the form stopping for ever.
  const none = accounts.data?.accounts.length === 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new way of paying brings its own last account
  useEffect(() => setValue(read()), [key]);
  return {
    value: none ? "" : value,
    missing,
    none,
    set(next: string) {
      setValue(next);
      setMissing(false);
      try {
        if (next) localStorage.setItem(key, next);
      } catch {}
    },
    /** True when one is picked; else the form says so. */
    ready() {
      if (none) return true;
      setMissing(!value);
      return Boolean(value);
    },
  };
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
  account,
  accountLabel = "Into account",
}: {
  method: PaymentMethod;
  setMethod: (value: PaymentMethod) => void;
  reference: string;
  setReference: (value: string) => void;
  day: string;
  setDay: (value: string) => void;
  dayLabel: string;
  at: (field: string) => string | undefined;
  account: ReturnType<typeof useMoneyAccount>;
  accountLabel?: string;
}) {
  const accounts = useQuery({
    queryKey: ["finance", "money-accounts"],
    queryFn: () => api<MoneyAccounts>("/api/finance/money-accounts"),
    staleTime: 10 * 60_000,
  });
  const list = accounts.data?.accounts ?? [];
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
        label={accountLabel}
        error={account.missing ? "Pick the account the money went through." : at("moneyAccount")}
      >
        {(field) => (
          <select
            {...field}
            className={INPUT}
            value={account.value}
            onChange={(event) => account.set(event.target.value)}
          >
            <option value="">Pick the bank, cash or e-wallet account…</option>
            {account.value && !list.some((one) => one.name === account.value) && (
              <option value={account.value}>{account.value}</option>
            )}
            {(["bank", "cash", "payment_clearing", "credit_card"] as const).map((type) => {
              const here = list.filter((one) => one.type === type);
              return here.length ? (
                <optgroup key={type} label={{ bank: "Banks and e-wallets", cash: "Cash", payment_clearing: "Clearing", credit_card: "Cards" }[type]}>
                  {here.map((one) => (
                    <option key={one.name} value={one.name}>
                      {one.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        )}
      </Field>
      {account.none && (
        <p className="-mt-2 text-xs text-slate-500">
          Books has no bank, cash or e-wallet account yet (Books → Chart of accounts): it is recorded
          without one.
        </p>
      )}
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
  const account = useMoneyAccount(method);
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
    if (typed > 0 && !account.ready()) return;
    const done = await money.send(`/api/finance/orders/${orderId}/confirm-payment`, {
      amount: typed,
      method,
      moneyAccount: account.value || null,
      reference,
      paidOn: day,
      checked,
      note,
    });
    if (done) {
      // Only a whole payment sends it on (and offers Undo); a part stays with Finance.
      if (short === 0) rememberConfirm(orderId, code);
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
                    until {order?.medrep ?? "the seller"} adds the proof.
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
            {peso(short)} less than the order. It is paid first, so this part is put on the invoice
            and the order stays here: it goes to Dispatch once the whole amount is in.
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
          account={account}
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
          message={money.general(["amount", "method", "reference", "paidOn", "note", "moneyAccount", "checked"])}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={money.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={money.busy || !checked}>
            {money.busy ? "Confirming…" : short > 0 ? "Record this part" : "Confirm payment"}
          </Button>
        </div>
        <div className="-mt-1 text-right text-xs text-ink-2">
          {short > 0
            ? `The money goes on ${bill?.code ?? "its invoice"}; the order waits here for the other ${peso(short)}.`
            : `The money goes on ${bill?.code ?? "its invoice"} and the order goes to Dispatch.`}
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
  const account = useMoneyAccount(method);
  const [reference, setReference] = useState("");
  const [day, setDay] = useState(todayManila());
  const [note, setNote] = useState("");
  const [proofId, setProofId] = useState("");
  const [added, setAdded] = useState<{ id: number; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  // Tax the customer withheld (EWT) with its BIR Form 2307: it settles the invoice too.
  const [withheld, setWithheld] = useState("");
  const [form2307, setForm2307] = useState("");
  // What the customer deducted (a chain's near-expiry return kept, a listing fee…), why, and their memo.
  const [deducted, setDeducted] = useState("");
  const [deductionKind, setDeductionKind] = useState("");
  const [deductionRef, setDeductionRef] = useState("");
  // A guarantee letter's order (Aryan, 22 Nov): the agency often pays less than its letter; the
  // patient pays the rest, or it is let go. Finance says who paid each part.
  const about = useQuery({
    queryKey: ["orders", "kind", orderId],
    queryFn: () => api<{ order: { type: string | null; glAmount: number | null; glNumber: string | null } }>(`/api/orders/${orderId}`),
  });
  const gl = about.data?.order.type === "gl";
  const letter = about.data?.order.glAmount ?? null;
  const [payer, setPayer] = useState<"agency" | "patient">("agency");
  const typed = amount.trim() ? centavos(amount) : 0;
  const withheldTyped = withheld.trim() ? centavos(withheld) : 0;
  const deductedTyped = deducted.trim() ? centavos(deducted) : 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Nothing in cash (a shortfall let go, tax withheld only) went through no account.
    if (typed > 0 && !account.ready()) return;
    const done = await money.send(`/api/invoices/${invoiceId}/payments`, {
      amount: typed,
      payer: gl ? payer : null,
      method,
      moneyAccount: account.value,
      reference,
      paidOn: day,
      note,
      proofId: proofId ? Number(proofId) : null,
      withheld: Number.isFinite(withheldTyped) && withheldTyped > 0 ? withheldTyped : null,
      form2307: form2307.trim() || null,
      deducted: Number.isFinite(deductedTyped) && deductedTyped > 0 ? deductedTyped : null,
      deductionKind: deductionKind || null,
      deductionRef: deductionRef.trim() || null,
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
        {gl && (
          <div className="flex flex-col gap-2 rounded-xl bg-sky-50 px-4 py-3 text-[13px] text-sky-950">
            <span>
              <b>Guarantee letter{about.data?.order.glNumber ? ` ${about.data.order.glNumber}` : ""}:</b>{" "}
              {letter != null ? `${peso(letter)} written on the letter.` : "the letter's amount isn't written on the order yet."} If the
              agency pays less, record what it paid, then the rest as the patient's payment, or let it go below
              (type 0 as the amount received).
            </span>
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Who paid this</span>
              <select className={INPUT} style={{ width: "auto" }} value={payer} onChange={(event) => setPayer(event.target.value as "agency" | "patient")}>
                <option value="agency">The agency</option>
                <option value="patient">The patient</option>
              </select>
            </label>
          </div>
        )}
        <AmountField
          label="Amount received"
          value={amount}
          onChange={setAmount}
          error={money.at("amount")}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tax withheld, 2307 (optional)" error={money.at("withheld")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                inputMode="decimal"
                placeholder="₱0.00"
                value={withheld}
                onChange={(event) => setWithheld(event.target.value)}
              />
            )}
          </Field>
          <Field label="Form 2307 number" error={money.at("form2307")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                disabled={!withheld.trim()}
                value={form2307}
                onChange={(event) => setForm2307(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={gl ? "Let go / deducted (optional)" : "Deducted by them (optional)"} error={money.at("deducted")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                inputMode="decimal"
                placeholder="₱0.00"
                value={deducted}
                onChange={(event) => setDeducted(event.target.value)}
              />
            )}
          </Field>
          <Field label="Why" error={money.at("deductionKind")}>
            {(field) => (
              <select {...field} className={INPUT} disabled={!deducted.trim()} value={deductionKind} onChange={(event) => setDeductionKind(event.target.value)}>
                <option value="">Pick…</option>
                {gl && <option value="gl_waived">Guarantee letter shortfall let go</option>}
                <option value="near_expiry">Near-expiry goods kept</option>
                <option value="listing_fee">Listing fee</option>
                <option value="promo">Promo / rebate</option>
                <option value="penalty">Penalty</option>
                <option value="other">Other</option>
              </select>
            )}
          </Field>
          <Field label="Their debit memo #" error={money.at("deductionRef")}>
            {(field) => (
              <input {...field} className={INPUT} disabled={!deducted.trim()} value={deductionRef} onChange={(event) => setDeductionRef(event.target.value)} />
            )}
          </Field>
        </div>
        {(withheldTyped > 0 || deductedTyped > 0) && Number.isFinite(withheldTyped) && Number.isFinite(deductedTyped) && Number.isFinite(typed) && (
          <div className="-mt-2 text-[13px] text-ink-2">
            Settles {peso(typed + withheldTyped + deductedTyped)} of the {peso(balance)} owed (money
            {withheldTyped > 0 ? ", the tax withheld" : ""}
            {deductedTyped > 0 ? ", what they deducted" : ""}).
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
          account={account}
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
          message={money.general(["amount", "method", "reference", "paidOn", "note", "moneyAccount", "proofId", "deducted", "deductionKind", "deductionRef"])}
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
  // Finance gives it back, or keeps it as the customer's credit for their next invoice (as Zoho's
  // open credit notes did).
  const [keep, setKeep] = useState(false);
  const account = useMoneyAccount(method);
  const [reference, setReference] = useState("");
  const [day, setDay] = useState(todayManila());
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!keep && !account.ready()) return;
    if (
      await money.send(`/api/invoices/${invoiceId}/refunds`, {
        amount: centavos(amount),
        method: keep ? "credit" : method,
        moneyAccount: keep ? null : account.value,
        reference: keep ? null : reference,
        refundedOn: day,
        note,
      })
    )
      onClose();
  }
  const choice = (value: boolean, label: string) => (
    <label
      className={`flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border px-3 py-2 text-center text-sm font-semibold ${keep === value ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-line text-slate-600 hover:bg-hover"}`}
    >
      <input
        type="radio"
        name="keep"
        className="sr-only"
        checked={keep === value}
        onChange={() => setKeep(value)}
      />
      {label}
    </label>
  );
  return (
    <Dialog title={`Money owed back · ${code}`} onClose={onClose} busy={money.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl border border-line-soft bg-hover px-4 py-3 text-[13px]">
          <span>Owed back to the customer</span>
          <span className="text-lg font-bold tabular-nums">{peso(owed)}</span>
        </div>
        <div className="flex gap-2">
          {choice(false, "Give the money back")}
          {choice(true, "Keep as their credit")}
        </div>
        <AmountField
          label={keep ? "Amount kept as credit" : "Amount given back"}
          value={amount}
          onChange={setAmount}
          error={money.at("amount")}
        />
        {keep ? (
          <div className="text-[13px] text-ink-2">
            No money goes out: it is the customer's credit, used on their next invoice.
          </div>
        ) : (
          <HowFields
            method={method}
            setMethod={setMethod}
            reference={reference}
            setReference={setReference}
            day={day}
            setDay={setDay}
            dayLabel="Given back on"
            at={money.at}
            account={account}
            accountLabel="Out of account"
          />
        )}
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
        <Problem message={money.general(["amount", "method", "reference", "refundedOn", "note", "moneyAccount"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={money.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={money.busy}>
            {money.busy ? "Saving…" : keep ? "Keep as credit" : "Record refund"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Finance uses the customer's credit (a Zoho credit note, or money kept from a bill) on an invoice. */
export function UseCreditDialog({
  invoiceId,
  code,
  owed,
  customerId,
  onClose,
}: {
  invoiceId: number;
  code: string;
  owed: number;
  customerId: number;
  onClose: () => void;
}) {
  const money = useMoney();
  const query = useQuery({
    queryKey: ["finance", "credit", customerId],
    queryFn: () => api<CustomerCredit>(`/api/customers/${customerId}/credit`),
  });
  const sources = query.data?.sources ?? [];
  const [picked, setPicked] = useState("");
  const source = sources.find((one) => `${one.kind}:${one.id}` === picked) ?? sources[0];
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (source) setAmount(asTyped(Math.min(source.left, owed)));
  }, [source, owed]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!source) return;
    if (
      await money.send(`/api/invoices/${invoiceId}/credit`, {
        kind: source.kind,
        sourceId: source.id,
        amount: centavos(amount),
      })
    )
      onClose();
  }
  return (
    <Dialog title={`Use the customer's credit · ${code}`} onClose={onClose} busy={money.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl border border-line-soft bg-hover px-4 py-3 text-[13px]">
          <span>Still owed on {code}</span>
          <span className="text-lg font-bold tabular-nums">{peso(owed)}</span>
        </div>
        {!query.data ? (
          <div className="text-[13px] text-ink-2">Reading their credit…</div>
        ) : sources.length === 0 ? (
          <div className="text-[13px] text-ink-2">No credit left for this customer.</div>
        ) : (
          <>
            <Field label="From" error={money.at("sourceId")}>
              {(field) => (
                <select
                  {...field}
                  className={INPUT}
                  value={source ? `${source.kind}:${source.id}` : ""}
                  onChange={(event) => setPicked(event.target.value)}
                >
                  {sources.map((one) => (
                    <option key={`${one.kind}:${one.id}`} value={`${one.kind}:${one.id}`}>
                      {one.kind === "zoho" ? `Credit note ${one.number}` : `Kept from ${one.number}`} ·{" "}
                      {peso(one.left)} left
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <AmountField
              label="Amount to use"
              value={amount}
              onChange={setAmount}
              error={money.at("amount")}
            />
          </>
        )}
        <Problem message={money.general(["sourceId", "amount"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={money.busy}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={money.busy || !source}>
            {money.busy ? "Saving…" : "Use the credit"}
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
