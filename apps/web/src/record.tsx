// The pieces every record page is built from, taken from the old CRM's case page (the one a lead
// opens into): the head card (avatar, name, chips, a line of facts, the contact line, a box on
// the right), a "glance" box inside it in place of the case journey, the left column's list of
// sections drawn as the case's STEPS, the section's panel with its icon tile, and the small
// side cards (Money). Hospitals, doctors, patients and medicines all use these, so every page
// reads like the case page.

import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Check } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

/** "← Back · Hospitals › Details", as the case page starts. */
export function Crumbs({ list, to }: { list: string; to: string }) {
  const navigate = useNavigate();
  return (
    <nav aria-label="Where you are" className="flex items-center gap-1.5 text-xs text-slate-500">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(to))}
        className="inline-flex items-center gap-1 font-medium hover:text-slate-800"
      >
        <ArrowLeft className="size-3.5" /> Back
      </button>
      <Link to={to} className="hover:text-slate-800">
        {list}
      </Link>
      <span aria-hidden="true" className="text-slate-300">
        ›
      </span>
      <span className="font-medium text-slate-700">Details</span>
    </nav>
  );
}

/** A chip on the head's first line: the record's number. */
export function CodeChip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold text-slate-700">
      {children}
    </span>
  );
}

const BADGES = {
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  teal: "border-teal-200 bg-teal-50 text-teal-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
} as const;
export type BadgeTone = keyof typeof BADGES;

/** What kind of record it is, as the case's "Enquiry" pill. */
export function KindBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${BADGES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Where it belongs, as the case's grey capital source pill ("HOSP · HOS | PASAY"). */
export function PlacePill({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium tracking-wide text-slate-600 uppercase"
    >
      {children}
    </span>
  );
}

/** A small state on the head ("Checked", "Licence expired"). */
export function StatePill({
  tone,
  children,
}: {
  tone: "good" | "warn" | "bad" | "plain";
  children: ReactNode;
}) {
  const style = {
    good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-300",
    bad: "bg-rose-50 text-rose-700 ring-rose-200",
    plain: "bg-white text-slate-600 ring-slate-200",
  }[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ${style}`}
    >
      {children}
    </span>
  );
}

/** The head's small button (the case's "Case details"): amber while something is missing. */
export function HeadButton({
  icon: Icon,
  children,
  onClick,
  missing,
}: {
  icon: LucideIcon;
  children: ReactNode;
  onClick: () => void;
  missing?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 transition ${
        missing
          ? "bg-amber-50 text-amber-900 ring-amber-300 hover:bg-amber-100"
          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

/** The head card (no initials tile beside the name, at Aryan's word): the first line of chips, the lines under it, a box on the right, and
 *  what sits inside the card under them (the glance). */
export function RecordHead({
  name,
  avatar,
  chips,
  lines,
  right,
  children,
  tone,
}: {
  name: string;
  /** An icon instead of initials (a medicine). */
  avatar?: LucideIcon;
  chips?: ReactNode;
  lines?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  tone?: "lost";
}) {
  const Avatar = avatar;
  return (
    <header
      className={`rounded-2xl border p-4.5 shadow-2xs ${tone === "lost" ? "border-rose-200 bg-rose-50/60" : "border-slate-200/90 bg-white"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          {Avatar && (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 shadow-2xs">
              <Avatar className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1
                title={name}
                className="max-w-[260px] truncate text-lg font-bold tracking-tight text-slate-900 sm:max-w-md md:text-xl"
              >
                {name}
              </h1>
              {chips}
            </div>
            {lines}
          </div>
        </div>
        {right && (
          <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2.5 sm:w-auto">
            {right}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

/** A line of small facts under the name ("Customer since …", "Looked after by …"). */
export function HeadLine({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">{children}</div>
  );
}

/** The contact line under the name: phone, email, address. */
export function ContactLine({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {children}
    </div>
  );
}

/** The box on the head's right (as the case's payment road): a few facts side by side. */
export function HeadBox({
  cells,
  note,
}: {
  cells: { label: string; value: ReactNode; tone?: "bad" | "good" }[];
  note?: ReactNode;
}) {
  return (
    <div className="w-full min-w-0 shrink-0 rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-2xs sm:w-[21rem]">
      <div className="grid grid-cols-3 gap-1">
        {cells.map((cell) => (
          <div key={cell.label} className="min-w-0 rounded-lg bg-slate-50 px-2 py-1.5">
            <div className="truncate text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
              {cell.label}
            </div>
            <div
              className={`truncate text-sm font-bold tabular-nums ${
                cell.tone === "bad"
                  ? "text-rose-700"
                  : cell.tone === "good"
                    ? "text-emerald-700"
                    : "text-slate-900"
              }`}
            >
              {cell.value}
            </div>
          </div>
        ))}
      </div>
      {note && (
        <div className="mt-1 flex h-7 items-center gap-1.5 px-1 text-[11px] font-semibold text-slate-500">
          {note}
        </div>
      )}
    </div>
  );
}

/** The box inside the head where the case journey sits: a capital title and figures. */
export function Glance({
  title,
  actions,
  tiles,
}: {
  title: string;
  actions?: ReactNode;
  tiles: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "good" | "warn" }[];
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-xs font-bold tracking-wider text-stone-500 uppercase">{title}</h2>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      <dl className="grid grid-cols-2 border-t border-slate-100 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="min-w-0 border-r border-b border-slate-100 px-4 py-3 last:border-r-0"
          >
            <dt className="truncate text-[11px] font-semibold text-slate-500">{tile.label}</dt>
            <dd
              className={`mt-0.5 truncate text-lg font-bold tracking-tight tabular-nums ${
                tile.tone === "bad"
                  ? "text-rose-700"
                  : tile.tone === "good"
                    ? "text-emerald-700"
                    : tile.tone === "warn"
                      ? "text-amber-700"
                      : "text-slate-900"
              }`}
            >
              {tile.value}
            </dd>
            {tile.sub && <div className="truncate text-[11px] text-slate-400">{tile.sub}</div>}
          </div>
        ))}
      </dl>
    </div>
  );
}

export type Section<K extends string> = {
  key: K;
  label: string;
  icon: LucideIcon;
  count?: number;
  done?: boolean;
};

/** The left column's list of the page's parts, drawn as the case's STEPS. */
export function SectionRail<K extends string>({
  title = "Sections",
  sections,
  value,
  onChange,
  footer,
}: {
  title?: string;
  sections: Section<K>[];
  value: K;
  onChange: (key: K) => void;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-sm">
      <nav aria-label={title}>
        <p className="px-2.5 pt-1 pb-2 text-xs font-semibold tracking-[0.12em] text-slate-400 uppercase">
          {title}
        </p>
        {sections.map((section) => {
          const selected = section.key === value;
          const Icon = section.icon;
          return (
            <button
              key={section.key}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => onChange(section.key)}
              className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left transition ${
                selected
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-transparent hover:border-slate-200 hover:bg-slate-50"
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                  section.done
                    ? "border-emerald-700 bg-emerald-700 text-white"
                    : selected
                      ? "border-emerald-700 bg-white text-emerald-800 ring-4 ring-emerald-100"
                      : "border-slate-300 bg-white text-slate-500"
                }`}
              >
                {section.done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
              </span>
              <span
                className={`min-w-0 flex-1 text-sm font-semibold leading-snug ${selected ? "text-emerald-950" : "text-slate-800"}`}
              >
                {section.label}
              </span>
              {section.count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    selected ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {section.count.toLocaleString("en-PH")}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {footer && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 px-1 pt-2.5">
          {footer}
        </div>
      )}
    </div>
  );
}

/** One part of the page in the right-hand column, as the case's step panel. */
export function SectionPanel({
  icon: Icon,
  title,
  actions,
  footer,
  children,
  flush,
}: {
  icon: LucideIcon;
  title: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** The content runs to the panel's edges (a table). */
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
          <Icon className="size-4" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-900">{title}</h3>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={flush ? "" : "space-y-4 p-4 sm:p-5"}>{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 sm:px-5">
          {footer}
        </div>
      )}
    </section>
  );
}

/** A small card in the left column (the case's Money card). */
export function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
      <h2 className="border-b border-slate-100 pb-2.5 text-sm font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Label and value rows, as the case's Money card lists them. */
export function SideRows({
  rows,
}: {
  rows: [ReactNode, ReactNode, ("bad" | "good" | "strong")?][];
}) {
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {rows.map(([label, value, tone], index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows
          key={index}
          className={`flex justify-between gap-3 ${tone === "strong" ? "mt-1 border-t border-slate-100 pt-1.5 font-semibold" : ""}`}
        >
          <dt className={tone === "strong" ? "" : "text-slate-600"}>{label}</dt>
          <dd
            className={`text-right tabular-nums ${tone === "bad" ? "text-rose-700" : tone === "good" ? "text-emerald-700" : ""}`}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The page's two columns: the rail and side cards on the left, the open section on the right. */
export function TwoColumns({ left, children }: { left: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
      <aside className="space-y-3 xl:sticky xl:top-[4.5rem]">{left}</aside>
      <section className="min-w-0 space-y-4">{children}</section>
    </div>
  );
}

/** Nothing in a section yet, said plainly. */
export function Nothing({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
