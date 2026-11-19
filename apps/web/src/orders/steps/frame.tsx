// The frame each of an order's steps is drawn in (orders/order.tsx): its panel with the number and
// the title, the Next button, a fact with its shape (done, now, stopped, later, skipped), a list of
// facts, and the short date they show.

import { ArrowRight } from "lucide-react";
import { type ReactNode } from "react";
import { Button } from "../../ui";

export type Shape = "done" | "now" | "stopped" | "later" | "skipped";

export const short = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));

// ---------------------------------------------------------------- frames

export function StepPanel({
  number,
  title,
  children,
  footer,
}: {
  number: number;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
          {number}
        </span>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
          {footer}
        </div>
      )}
    </section>
  );
}

export function NextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button small onClick={onClick}>
      {label} <ArrowRight className="size-4" />
    </Button>
  );
}

/** A finished or waiting fact on a step, one line. */
export function Fact({ shape, children, note }: { shape: Shape; children: ReactNode; note?: ReactNode }) {
  const tone = shape === "later" ? "text-slate-500" : "text-slate-800";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] ${tone}`}
    >
      <span
        aria-hidden="true"
        className={`font-bold ${shape === "done" || shape === "skipped" ? "text-emerald-600" : shape === "now" ? "text-amber-500" : shape === "stopped" ? "text-rose-600" : "text-slate-300"}`}
      >
        {shape === "done" || shape === "skipped" ? "✓" : shape === "stopped" ? "!" : "●"}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {note && <span className="text-right text-slate-500">{note}</span>}
    </div>
  );
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
      {rows
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([label, value]) => (
          <div key={label}>
            <dt className="text-[12px] font-semibold text-slate-600">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}
