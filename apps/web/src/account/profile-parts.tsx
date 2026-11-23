// What the profile's two pages share.

import type { ReactNode } from "react";

export const PROFILE = ["profile"] as const;

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-ink-2">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
