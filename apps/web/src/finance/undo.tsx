// After Finance confirms a payment, a bar at the foot of the screen offers Undo for 90 seconds
// (the hub's: a wrong tick is put right at once). It stays across pages; the API checks the time.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api";

const UNDO_SECONDS = 90;
type Confirmed = { orderId: number; code: string; until: number; sent?: boolean } | null;

let current: Confirmed = null;
const listeners = new Set<() => void>();
const tell = () => {
  for (const listen of listeners) listen();
};

/** Called when a payment is confirmed, or a credit or cash-on-delivery order is sent on to
 *  Dispatch (`sent`): the bar shows for 90 seconds. */
export function rememberConfirm(orderId: number, code: string, sent = false) {
  current = { orderId, code, until: Date.now() + UNDO_SECONDS * 1000, sent };
  tell();
}

export function UndoConfirmBar() {
  const confirmed = useSyncExternalStore(
    (listen) => {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
    () => current,
  );
  const queries = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmed) return;
    setProblem(null);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [confirmed]);
  if (!confirmed) return null;
  const left = Math.ceil((confirmed.until - now) / 1000);
  if (left <= 0) {
    current = null;
    return null;
  }
  async function undo() {
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/api/finance/orders/${confirmed.orderId}/undo-confirm`, { body: {} });
      current = null;
      tell();
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["orders"] }),
        queries.invalidateQueries({ queryKey: ["finance"] }),
      ]);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't undo it");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      role="status"
      className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-[13px] text-white shadow-lg lg:bottom-6"
    >
      <span>
        {problem ?? (
          <>
            {confirmed.sent ? "Sent to Dispatch" : "Payment confirmed"} · <b>{confirmed.code}</b>
          </>
        )}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={undo}
        className="font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
      >
        {busy ? "Undoing…" : `Undo (${left}s)`}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => {
          current = null;
          tell();
        }}
        className="text-slate-400 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
