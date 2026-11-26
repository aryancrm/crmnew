// Guarantee letters' money (Aryan, 26 Nov): the medicine goes to the patient first; the agency pays
// after the claim, often months later and often less than its letter, and the patient may pay the
// rest. The PAP person follows each one up and marks what came in, with its proof; Finance confirms
// each mark against the bank (only then is it a payment) or refuses it, saying why, and alone lets
// the rest go. One page for both, the CEO and the Admin: every letter by where its money stands.

import type { GlMark, GlMoneyList, GlMoneyRow, GlStage, PaymentMethod } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Dialog, Field, INPUT, PageHead, PageState, Problem, peso, useAction } from "../ui";
import { HowFields, todayManila, useMoneyAccount } from "./parts";

type Tab = GlStage | "confirm" | "all";

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "confirm", label: "To confirm", hint: "Money PAP marked as received: check it in the bank, then confirm it, or say why not." },
  { key: "claim", label: "Claim to send", hint: "Delivered: the claim goes to the agency (PAP or Finance marks it sent)." },
  { key: "agency", label: "Waiting for the agency", hint: "Claim sent, nothing paid yet. Agencies take weeks, often months: not the patient's debt meanwhile." },
  { key: "short", label: "Paid short", hint: "The agency paid less than its letter: the patient pays the rest, or Finance lets it go." },
  { key: "deliver", label: "Not delivered yet", hint: "The medicine is on its way: the claim goes after the delivery." },
  { key: "done", label: "Done", hint: "Nothing owed." },
  { key: "all", label: "All", hint: "Every guarantee letter." },
];
const AGENCY: Record<string, string> = { dswd: "DSWD", pcso: "PCSO", ovp: "OVP", op: "OP" };
const dayWords = (day: string | null) =>
  day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "—";

export function GlMoneyPage() {
  const query = useQuery({ queryKey: ["finance", "gl"], queryFn: () => api<GlMoneyList>("/api/finance/gl") });
  const [picked, setPicked] = useState<Tab | null>(null);
  const [marking, setMarking] = useState<GlMoneyRow | null>(null);
  const [confirming, setConfirming] = useState<{ row: GlMoneyRow; mark: GlMark } | null>(null);
  const [refusing, setRefusing] = useState<GlMark | null>(null);
  const data = query.data;
  if (!data) return <PageState query={query} what="the guarantee letters" />;
  const tab: Tab = picked ?? (data.counts.confirm > 0 ? "confirm" : "agency");
  const shown = data.rows.filter((row) =>
    tab === "all" ? true : tab === "confirm" ? row.marks.some((mark) => mark.state === "waiting") : row.stage === tab,
  );
  const owed = shown.reduce((sum, row) => sum + Math.max(0, row.owed), 0);
  return (
    <div className="mx-auto max-w-[80rem]">
      <PageHead
        title="Guarantee letters"
        sub="The medicine goes first; the agency pays later, often months later and often less than its letter. PAP marks what comes in, Finance confirms it against the bank."
      />
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((one) => {
          const count = one.key === "all" ? data.rows.length : data.counts[one.key];
          return (
            <Button key={one.key} small role="tab" aria-selected={tab === one.key} variant={tab === one.key ? "primary" : "plain"} onClick={() => setPicked(one.key)}>
              {one.label}
              {count > 0 ? ` · ${count}` : ""}
            </Button>
          );
        })}
      </div>
      <p className="mb-3 text-[13px] text-slate-600">
        {TABS.find((one) => one.key === tab)?.hint}
        {shown.length > 0 && owed > 0 ? ` Still owed here: ${peso(owed)}.` : ""}
      </p>
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">Nothing here.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[64rem] text-[13px]">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2">Order · patient</th>
                <th className="px-3 py-2">Agency · letter</th>
                <th className="px-3 py-2">Delivered · claim</th>
                <th className="px-3 py-2 text-right">On the letter</th>
                <th className="px-3 py-2 text-right">Agency paid</th>
                <th className="px-3 py-2 text-right">Patient paid</th>
                <th className="px-3 py-2 text-right">Let go</th>
                <th className="px-3 py-2 text-right">Still owed</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <Row
                  key={row.orderId}
                  row={row}
                  can={data.can}
                  onMark={() => setMarking(row)}
                  onConfirm={(mark) => setConfirming({ row, mark })}
                  onRefuse={setRefusing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {marking && <MarkDialog row={marking} onClose={() => setMarking(null)} />}
      {confirming && <ConfirmDialog row={confirming.row} mark={confirming.mark} onClose={() => setConfirming(null)} />}
      {refusing && <RefuseDialog mark={refusing} onClose={() => setRefusing(null)} />}
    </div>
  );
}

function Row({
  row,
  can,
  onMark,
  onConfirm,
  onRefuse,
}: {
  row: GlMoneyRow;
  can: GlMoneyList["can"];
  onMark: () => void;
  onConfirm: (mark: GlMark) => void;
  onRefuse: (mark: GlMark) => void;
}) {
  const waiting = row.marks.filter((mark) => mark.state === "waiting");
  const refused = row.marks.filter((mark) => mark.state === "refused");
  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-3 py-2">
          <Link to={`/orders/${row.orderId}`} className="font-semibold text-brand hover:underline">
            {row.orderCode}
          </Link>
          <div className="font-medium text-slate-900">{row.patient}</div>
          <div className="text-[11px] text-slate-500">
            {row.papBy ? `PAP: ${row.papBy}` : "PAP"}
            {row.seller ? ` · sale: ${row.seller}` : ""}
            {row.leadId ? (
              <>
                {" · "}
                <Link to={`/leads/${row.leadId}`} className="hover:underline">
                  {row.caseCode}
                </Link>
              </>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="font-medium">{row.agency ? AGENCY[row.agency] : "Agency"}</div>
          <div className="text-[11px] text-slate-500">{row.letterNo ? `Letter ${row.letterNo}` : "No letter number"}</div>
        </td>
        <td className="px-3 py-2">
          <div>{row.deliveredOn ? `Delivered ${dayWords(row.deliveredOn)}` : "Not delivered yet"}</div>
          <div className="text-[11px] text-slate-500">
            {row.claimSentOn ? `Claim sent ${dayWords(row.claimSentOn)}${row.claimRef ? ` · ${row.claimRef}` : ""}` : row.deliveredOn ? "Claim not sent" : ""}
          </div>
          {row.waitingDays !== null && (
            <div className={`text-[11px] font-semibold ${row.waitingDays > 60 ? "text-bad" : "text-amber-700"}`}>
              Waiting {row.waitingDays} {row.waitingDays === 1 ? "day" : "days"}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{row.letterAmount != null ? peso(row.letterAmount) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.agencyPaid ? peso(row.agencyPaid) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.patientPaid ? peso(row.patientPaid) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.letGo ? peso(row.letGo) : "—"}</td>
        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.owed > 0 ? "text-slate-900" : "text-good"}`}>
          {row.owed > 0 ? peso(row.owed) : "Paid"}
        </td>
        <td className="px-3 py-2 text-right">
          {can.mark && row.stage !== "deliver" && row.owed > 0 && (
            <Button small onClick={onMark}>
              Money received
            </Button>
          )}
        </td>
      </tr>
      {[...waiting, ...refused].map((mark) => (
        <tr key={mark.id} className="bg-amber-50/60 text-[12px]">
          <td className="px-3 py-1.5" colSpan={8}>
            <span className="font-semibold">
              {mark.payer === "agency" ? "The agency" : "The patient"} paid {peso(mark.amount)} on {dayWords(mark.paidOn)}
            </span>
            {mark.reference ? ` · ${mark.reference}` : ""}
            {mark.proofId ? (
              <>
                {" · "}
                <a href={`/api/papers/${mark.proofId}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  proof
                </a>
              </>
            ) : (
              " · no proof"
            )}
            {mark.note ? ` · ${mark.note}` : ""}
            <span className="text-slate-500"> · marked by {mark.by}</span>
            {mark.state === "waiting" ? (
              <span className="ml-2 font-semibold text-amber-800">Waiting for Finance</span>
            ) : (
              <span className="ml-2 font-semibold text-bad">
                Not confirmed by {mark.decidedBy}: {mark.reason}
              </span>
            )}
          </td>
          <td className="px-3 py-1.5 text-right whitespace-nowrap">
            {can.confirm && mark.state === "waiting" && (
              <span className="inline-flex gap-1">
                <Button small variant="primary" onClick={() => onConfirm(mark)}>
                  Confirm
                </Button>
                <Button small onClick={() => onRefuse(mark)}>
                  Not in the bank
                </Button>
              </span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

const centavos = (text: string) => Math.round(Number(text.replace(/,/g, "")) * 100);

/** The PAP person marks money that came in, the agency's or the patient's, with its proof. */
function MarkDialog({ row, onClose }: { row: GlMoneyRow; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const waiting = row.marks.filter((mark) => mark.state === "waiting").reduce((sum, mark) => sum + mark.amount, 0);
  const [payer, setPayer] = useState<"agency" | "patient">(row.agencyPaid > 0 ? "patient" : "agency");
  const [amount, setAmount] = useState(((row.owed - waiting) / 100).toFixed(2));
  const [paidOn, setPaidOn] = useState(todayManila());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      let proofId: number | null = null;
      if (proof) {
        const form = new FormData();
        form.set("kind", "payment_proof");
        form.set("file", proof);
        proofId = (await api<{ id: number }>(`/api/orders/${row.orderId}/papers`, { method: "POST", body: form })).id;
      }
      await api(`/api/finance/gl/${row.orderId}/mark`, {
        body: { payer, amount: centavos(amount) || 0, paidOn, reference: reference.trim() || null, note: note.trim() || null, proofId },
      });
    });
    if (!ok) return;
    await queries.invalidateQueries({ queryKey: ["finance", "gl"] });
    onClose();
  }
  return (
    <Dialog
      title={`Money received · ${row.orderCode}`}
      sub={`${row.patient}: ${peso(row.owed)} still owed${waiting ? `, ${peso(waiting)} of it waiting for Finance` : ""}. Finance confirms it against the bank.`}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Who paid" error={action.at("payer")}>
          {(field) => (
            <select {...field} className={INPUT} value={payer} onChange={(event) => setPayer(event.target.value as "agency" | "patient")}>
              <option value="agency">The agency ({row.agency ? AGENCY[row.agency] : "its letter"})</option>
              <option value="patient">The patient (the rest)</option>
            </select>
          )}
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field label="Amount (₱)" error={action.at("amount")}>
            {(field) => <input {...field} inputMode="decimal" className={`${INPUT} tabular-nums`} value={amount} onChange={(event) => setAmount(event.target.value)} />}
          </Field>
          <Field label="Paid on" error={action.at("paidOn")}>
            {(field) => <input {...field} type="date" max={todayManila()} className={INPUT} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />}
          </Field>
        </div>
        <Field label="Check number or bank reference" error={action.at("reference")}>
          {(field) => <input {...field} className={INPUT} value={reference} onChange={(event) => setReference(event.target.value)} />}
        </Field>
        <Field label="Proof (a photo of the check or the deposit slip)" error={action.at("file") ?? action.at("proofId")}>
          {(field) => (
            <input {...field} type="file" accept="image/*,application/pdf" className="text-sm" onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
          )}
        </Field>
        <Field label="Note (optional)" error={action.at("note")}>
          {(field) => <input {...field} className={INPUT} value={note} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        <Problem message={action.general(["payer", "amount", "paidOn", "reference", "file", "proofId", "note"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Sending…" : "Send to Finance"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Finance confirms a mark: it is recorded as the payment, the agency's or the patient's. */
function ConfirmDialog({ row, mark, onClose }: { row: GlMoneyRow; mark: GlMark; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [method, setMethod] = useState<PaymentMethod>(mark.payer === "agency" ? "check" : "cash");
  const [day, setDay] = useState(mark.paidOn);
  const [reference, setReference] = useState(mark.reference ?? "");
  const account = useMoneyAccount(method);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!account.ready()) return;
    const ok = await action.run(async () => {
      await api(`/api/finance/gl/marks/${mark.id}/confirm`, {
        body: { method, moneyAccount: account.value || null, paidOn: day, reference: reference.trim() || null },
      });
    });
    if (!ok) return;
    await queries.invalidateQueries({ queryKey: ["finance"] });
    await queries.invalidateQueries({ queryKey: ["orders"] });
    onClose();
  }
  return (
    <Dialog
      title={`Confirm ${peso(mark.amount)} · ${row.orderCode}`}
      sub={`${mark.payer === "agency" ? "The agency" : "The patient"} paid it, marked by ${mark.by}. Confirm it once it is in the bank: it is recorded as the payment.`}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <HowFields
          method={method}
          setMethod={setMethod}
          reference={reference}
          setReference={setReference}
          day={day}
          setDay={setDay}
          dayLabel="Paid on"
          at={action.at}
          account={account}
        />
        <Problem message={action.general(["method", "moneyAccount", "paidOn", "reference"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Recording…" : "Confirm and record"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RefuseDialog({ mark, onClose }: { mark: GlMark; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await action.run(async () => {
      await api(`/api/finance/gl/marks/${mark.id}/refuse`, { body: { reason } });
    });
    if (!ok) return;
    await queries.invalidateQueries({ queryKey: ["finance", "gl"] });
    onClose();
  }
  return (
    <Dialog title={`Not confirmed: ${peso(mark.amount)}`} sub={`${mark.by} reads why, on this page and on the order.`} onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Why (not in the bank yet, a different amount…)" error={action.at("reason")}>
          {(field) => <input {...field} className={INPUT} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <Problem message={action.general(["reason"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy || !reason.trim()}>
            Send
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
