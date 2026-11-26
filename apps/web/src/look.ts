// Small pieces of the old CRM's look, lifted as they are (frontend/lib/format.ts,
// frontend/lib/lead-desk.ts), so the new screens draw the same.

const AVATARS = [
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
];

/** The same name always gets the same colour. */
export function avatarTone(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return AVATARS[h % AVATARS.length] ?? AVATARS[0] ?? "";
}

/** A bold avatar colour with white initials (Aryan, 26 Nov: the Home's My customers), chosen
 *  from the name the same way, so a customer keeps its colour. */
const SOLID = ["bg-[#1d9fda]", "bg-[#e8505b]", "bg-[#22b378]", "bg-[#7c5cff]", "bg-[#f59e0b]", "bg-[#0ea5e9]", "bg-[#3f8f8b]", "bg-[#ec4899]"];
export function avatarSolid(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return `${SOLID[h % SOLID.length] ?? SOLID[0]} text-white`;
}

export function initials(name: string): string {
  return (
    name
      .replace(/^(dr\.?|dra\.?)\s+/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/** "2026-11-14" as "Sat, Nov 14, 2026", the way the Leads desk heads a day. */
export const dayHeading = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(`${day}T00:00:00+08:00`));

/** The old CRM's primary button (`btn-primary`) at the Leads page's size. */
export const PRIMARY_SM =
  "inline-flex items-center justify-center gap-2 rounded-[10px] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark hover:shadow-md disabled:pointer-events-none disabled:opacity-50";

/** The old CRM's Export / Import buttons. */
export const QUIET_SM =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50";
