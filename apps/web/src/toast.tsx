// The hub's toast: a short word at the bottom of the screen when something is done ("Approved",
// "Payment recorded"), so a press never goes by silently. Said for the work people do on orders,
// money, the warehouse and returns (worked out from the address the screen wrote to); quiet for
// the rest (marking messages read, signing in).

import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";

const DONE: [RegExp, string][] = [
  [/^\/api\/headquarters$/, "HQ made"],
  [/^\/api\/headquarters\/\d+$/, "HQ renamed"],
  [/^\/api\/headquarters\/\d+\/person$/, "Saved: who works the HQ"],
  [/^\/api\/headquarters\/\d+\/close$/, "HQ closed"],
  [/^\/api\/orders$/, "Order placed: it waits for Management"],
  [/^\/api\/orders\/\d+\/approve$/, "Approved"],
  [/^\/api\/orders\/\d+\/send_back$/, "Sent back to the MedRep"],
  [/^\/api\/orders\/\d+\/reject$/, "Rejected"],
  [/^\/api\/orders\/\d+\/hold$/, "Put on hold"],
  [/^\/api\/orders\/\d+\/exception$/, "Marked exception"],
  [/^\/api\/orders\/\d+\/resume$/, "Taken off hold"],
  [/^\/api\/orders\/\d+\/cancel$/, "Cancelled"],
  [/^\/api\/orders\/\d+\/restore$/, "Restored: back with Management"],
  [/^\/api\/orders\/\d+\/resubmit$/, "Sent again to Management"],
  [/^\/api\/orders\/\d+\/take_back$/, "Approval taken back"],
  [/^\/api\/orders\/\d+\/answer$/, "Answer sent"],
  [/^\/api\/orders\/\d+\/(change|revise)$/, "Changes saved: the MedRep is told"],
  [/^\/api\/orders\/\d+\/details$/, "Details saved"],
  [/^\/api\/orders\/\d+\/papers$/, "Added to the order"],
  [/^\/api\/orders\/\d+\/ask$/, "Question sent"],
  [/^\/api\/order-asks\/\d+\/answer$/, "Answer sent to Management"],
  [/^\/api\/orders\/\d+\/returns$/, "Sent to Management"],
  [/^\/api\/returns\/\d+\/decide$/, "Decision saved"],
  [/^\/api\/returns\/\d+\/receive$/, "Goods checked: Management credits it"],
  [/^\/api\/returns\/\d+\/credit$/, "Done"],
  [/^\/api\/returns\/\d+\/cancel$/, "Return cancelled"],
  [/^\/api\/finance\/orders\/\d+\/confirm-payment$/, "Payment confirmed"],
  [/^\/api\/finance\/orders\/\d+\/invoice$/, "Checked: it goes to Dispatch"],
  [/^\/api\/invoices\/\d+\/payments$/, "Payment recorded"],
  [/^\/api\/invoices\/\d+\/refunds$/, "Refund recorded"],
  [/^\/api\/invoices\/\d+\/credit$/, "Credit used on the invoice"],
  [/^\/api\/dispatch\/orders\/\d+\/pack$/, "Packed"],
  [/^\/api\/dispatch\/orders\/\d+\/unpack$/, "Unpacked: back on the shelf"],
  [/^\/api\/dispatch\/orders\/\d+\/ship$/, "Shipped"],
  [/^\/api\/dispatch\/orders\/\d+\/deliver$/, "Marked delivered"],
  [/^\/api\/dispatch\/orders\/\d+\/failed$/, "Back with Dispatch"],
  [/^\/api\/dispatch\/orders\/\d+\/tracking$/, "Tracking saved"],
  [/^\/api\/customers$/, "Customer added"],
  [/^\/api\/inventory\/medicines(\/\d+)?$/, "Medicine saved"],
  [/^\/api\/inventory\/medicines\/\d+\/(prices|offers)$/, "Prices saved"],
  [/^\/api\/org\/approvers\/\d+$/, "Saved"],
];

type Listener = (word: string) => void;
const listeners = new Set<Listener>();

/** Says the word for a write that went through, if it is one people do by hand. */
export function toastFor(method: string, path: string): void {
  if (method === "GET") return;
  const bare = path.split("?")[0] ?? path;
  const word = DONE.find(([pattern]) => pattern.test(bare))?.[1];
  if (word) for (const listener of listeners) listener(word);
}

/** Where the toasts show: bottom centre, a few seconds each. */
export function Toasts() {
  const [shown, setShown] = useState<{ id: number; word: string }[]>([]);
  useEffect(() => {
    let next = 0;
    const listener: Listener = (word) => {
      const id = ++next;
      setShown((all) => [...all.slice(-2), { id, word }]);
      setTimeout(() => setShown((all) => all.filter((one) => one.id !== id)), 3200);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  if (!shown.length) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4 print:hidden"
    >
      {shown.map((one) => (
        <div
          key={one.id}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          <CircleCheck className="size-4 text-emerald-400" aria-hidden="true" /> {one.word}
        </div>
      ))}
    </div>
  );
}
