// Goods that come back after delivery: asked on the order (by who sold it, or Management),
// approved by Management, checked by Dispatch (good back on the shelf, damaged written off), and
// the bill credited. The order shows its returns; /returns lists them for each desk.

import type { OrderReturns, ReturnOutcome, ReturnReason, ReturnRow } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, count, Dialog, Field, INPUT, Problem, peso, timeLabel, useAction } from "../ui";

export const REASONS: { value: ReturnReason; label: string }[] = [
  { value: "expired", label: "Expired" },
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "not_needed", label: "Not needed" },
  { value: "other", label: "Other" },
];

const DOT: Record<ReturnRow["status"], string> = {
  requested: "bg-amber-400",
  approved: "bg-sky-500",
  received: "bg-emerald-500",
  rejected: "bg-rose-500",
  cancelled: "bg-slate-300",
};

/** One return, read in a few lines, with what this person may do on it. */
export function ReturnCard({ row, showOrder = false }: { row: ReturnRow; showOrder?: boolean }) {
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [receiving, setReceiving] = useState(false);
  const action = useAction();
  const queries = useQueryClient();
  async function cancel() {
    if (
      await action.run(async () => {
        await api(`/api/returns/${row.id}/cancel`, { body: {} });
      })
    )
      await queries.invalidateQueries();
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-slate-900">{row.code}</b>
            {showOrder && (
              <Link
                to={`/orders/${row.orderId}`}
                className="font-semibold text-emerald-700 hover:underline"
              >
                {row.orderCode}
              </Link>
            )}
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
              <span className={`size-1.5 rounded-full ${DOT[row.status]}`} aria-hidden="true" />
              {row.statusLabel}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-slate-500">
            {showOrder ? `${row.customer} · ${row.medrep} · ` : ""}
            {row.reasonLabel}
            {row.note ? `: ${row.note}` : ""} · asked by {row.requestedBy},{" "}
            {timeLabel(row.requestedAt)}
          </div>
        </div>
        {row.status === "received" && (
          <span className="text-right">
            <span className="block font-bold text-slate-900 tabular-nums">{peso(row.credit)}</span>
            <span className="block text-[11px] text-slate-500">credited</span>
          </span>
        )}
      </div>
      <ul className="mt-2 flex flex-col gap-0.5">
        {row.lines.map((line) => (
          <li key={line.id} className="flex justify-between gap-2 text-slate-700">
            <span>
              {line.medicine} × {count(line.qty)}
            </span>
            <span className="text-[12px] text-slate-500">
              {line.outcome === "restocked"
                ? "Back on the shelf"
                : line.outcome === "damaged"
                  ? "Damaged, written off"
                  : line.outcome === "missing"
                    ? "Not received"
                    : peso(line.qty * line.unitPrice)}
            </span>
          </li>
        ))}
      </ul>
      {row.decidedNote && (
        <div className="mt-1.5 text-[12px] text-slate-600">
          {row.decidedBy}: {row.decidedNote}
        </div>
      )}
      {(row.can.decide || row.can.receive || row.can.cancel) && (
        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-slate-100 pt-2.5">
          {row.can.decide && (
            <>
              <Button small variant="primary" onClick={() => setDeciding("approve")}>
                Approve
              </Button>
              <Button small onClick={() => setDeciding("reject")}>
                Don't approve
              </Button>
            </>
          )}
          {row.can.receive && (
            <Button small variant="primary" onClick={() => setReceiving(true)}>
              Check the goods
            </Button>
          )}
          {row.can.cancel && (
            <Button small variant="plain" onClick={cancel} disabled={action.busy}>
              Cancel return
            </Button>
          )}
        </div>
      )}
      <Problem message={action.problem?.message} />
      {deciding && (
        <DecideDialog
          row={row}
          approve={deciding === "approve"}
          onClose={() => setDeciding(null)}
        />
      )}
      {receiving && <ReceiveDialog row={row} onClose={() => setReceiving(false)} />}
    </div>
  );
}

function DecideDialog({
  row,
  approve,
  onClose,
}: {
  row: ReturnRow;
  approve: boolean;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const action = useAction();
  const queries = useQueryClient();
  async function save() {
    const done = await action.run(async () => {
      await api(`/api/returns/${row.id}/decide`, { body: { approve, note: note.trim() || null } });
    });
    if (!done) return;
    await queries.invalidateQueries();
    onClose();
  }
  return (
    <Dialog
      title={`${approve ? "Approve" : "Don't approve"} return ${row.code}`}
      sub={`${row.orderCode} · ${row.customer}`}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-4">
        <Field label={approve ? "A word (optional)" : "Why"} error={action.at("note")}>
          {(field) => (
            <textarea
              {...field}
              className={`${INPUT} min-h-20`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Problem message={action.general(["note"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Close
          </Button>
          <Button variant={approve ? "primary" : "danger"} onClick={save} disabled={action.busy}>
            {approve ? "Approve" : "Don't approve"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const OUTCOMES: { value: ReturnOutcome; label: string }[] = [
  { value: "restocked", label: "Good: back on the shelf" },
  { value: "damaged", label: "Damaged: write off" },
  { value: "missing", label: "Not received" },
];

function ReceiveDialog({ row, onClose }: { row: ReturnRow; onClose: () => void }) {
  const [outcomes, setOutcomes] = useState<Record<number, ReturnOutcome>>(() =>
    Object.fromEntries(row.lines.map((line) => [line.id, "restocked" as ReturnOutcome])),
  );
  const action = useAction();
  const queries = useQueryClient();
  const credit = row.lines.reduce(
    (sum, line) => sum + (outcomes[line.id] === "missing" ? 0 : line.qty * line.unitPrice),
    0,
  );
  async function save() {
    const done = await action.run(async () => {
      await api(`/api/returns/${row.id}/receive`, {
        body: {
          lines: row.lines.map((line) => ({ lineId: line.id, outcome: outcomes[line.id] })),
        },
      });
    });
    if (!done) return;
    await queries.invalidateQueries();
    onClose();
  }
  return (
    <Dialog
      title={`Goods back · ${row.code}`}
      sub={`${row.orderCode} · ${row.customer}`}
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-3">
        {row.lines.map((line) => (
          <div
            key={line.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-[13px]"
          >
            <span className="font-semibold text-slate-900">
              {line.medicine} × {count(line.qty)}
            </span>
            <select
              aria-label={`What came back of ${line.medicine}`}
              value={outcomes[line.id]}
              onChange={(event) =>
                setOutcomes((all) => ({ ...all, [line.id]: event.target.value as ReturnOutcome }))
              }
              className={`${INPUT} h-9 max-w-56`}
            >
              {OUTCOMES.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex justify-between text-[13px]">
          <span className="text-slate-600">Credited on the bill</span>
          <b className="tabular-nums">{peso(credit)}</b>
        </div>
        <Problem message={action.problem?.message} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Close
          </Button>
          <Button variant="primary" onClick={save} disabled={action.busy}>
            {action.busy ? "Saving…" : "Goods checked"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The order's returns, and "Return goods" for who may ask. */
export function OrderReturnsBox({ orderId }: { orderId: number }) {
  const query = useQuery({
    queryKey: ["orders", "returns", orderId],
    queryFn: () => api<OrderReturns>(`/api/orders/${orderId}/returns`),
  });
  const [asking, setAsking] = useState(false);
  const data = query.data;
  if (!data || (!data.returns.length && !data.can.ask)) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Returns</h2>
        {data.can.ask && (
          <Button small onClick={() => setAsking(true)}>
            <Undo2 className="size-3.5" aria-hidden="true" /> Return goods
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {data.returns.map((row) => (
          <ReturnCard key={row.id} row={row} />
        ))}
        {!data.returns.length && (
          <div className="text-[13px] text-slate-500">Nothing has come back.</div>
        )}
      </div>
      {asking && <AskDialog orderId={orderId} data={data} onClose={() => setAsking(false)} />}
    </section>
  );
}

function AskDialog({
  orderId,
  data,
  onClose,
}: {
  orderId: number;
  data: OrderReturns;
  onClose: () => void;
}) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<ReturnReason | "">("");
  const [note, setNote] = useState("");
  const action = useAction();
  const queries = useQueryClient();
  const lines = data.left.filter((line) => line.left > 0);
  async function save() {
    const done = await action.run(async () => {
      await api(`/api/orders/${orderId}/returns`, {
        body: {
          reason,
          note: note.trim() || null,
          lines: lines.map((line) => ({
            orderItemId: line.orderItemId,
            qty: Math.max(0, Math.floor(Number(qty[line.orderItemId]) || 0)),
          })),
        },
      });
    });
    if (!done) return;
    await queries.invalidateQueries();
    onClose();
  }
  return (
    <Dialog
      title="Return goods"
      sub="What comes back, how many and why. Management approves it, then Dispatch checks the goods."
      onClose={onClose}
      busy={action.busy}
    >
      <div className="flex flex-col gap-3">
        {lines.map((line) => (
          <div
            key={line.orderItemId}
            className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
          >
            <span>
              <b className="text-slate-900">{line.medicine}</b>
              {line.free && <span className="ml-1 text-emerald-700">(Free)</span>}
              <span className="block text-[11px] text-slate-500">
                Up to {count(line.left)} · {peso(line.unitPrice)} each
              </span>
            </span>
            <input
              aria-label={`How many ${line.medicine} come back`}
              inputMode="numeric"
              placeholder="0"
              value={qty[line.orderItemId] ?? ""}
              onChange={(event) =>
                setQty((all) => ({
                  ...all,
                  [line.orderItemId]: event.target.value.replace(/\D/g, ""),
                }))
              }
              className={`${INPUT} h-9 w-24 text-right`}
            />
          </div>
        ))}
        <Field label="Why" error={action.at("reason")}>
          {(field) => (
            <select
              {...field}
              className={INPUT}
              value={reason}
              onChange={(event) => setReason(event.target.value as ReturnReason)}
            >
              <option value="">Pick why…</option>
              {REASONS.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="A word (optional)" error={action.at("note")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Problem message={action.general(["reason", "note"])} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={action.busy}>
            Close
          </Button>
          <Button variant="primary" onClick={save} disabled={action.busy || !reason}>
            {action.busy ? "Sending…" : "Ask for the return"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
