// The small pieces every screen is made of, and how money and days are written.

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiFailure } from "./api";

// ---------------------------------------------------------------- words

const pesoWhole = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const pesoCents = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

/** Centavos as pesos: ₱1,300, or ₱1,300.50 when there are centavos. */
export const peso = (centavos: number) =>
  centavos % 100 === 0 ? pesoWhole.format(centavos / 100) : pesoCents.format(centavos / 100);

export const count = (value: number) => value.toLocaleString("en-PH");

/** Pieces as packs: "35 packs", "34 packs + 12". Empty when a pack is one piece. */
export function inPacks(pieces: number, packSize: number): string {
  if (packSize <= 1 || pieces <= 0) return "";
  const packs = Math.floor(pieces / packSize);
  const loose = pieces % packSize;
  if (packs === 0) return `${count(loose)} loose`;
  return `${count(packs)} ${packs === 1 ? "pack" : "packs"}${loose ? ` + ${count(loose)}` : ""}`;
}

/** What a whole pack costs: its own price where one was set, else its pieces added up. */
export const packPrice = (piece: number, own: number | undefined, packSize: number) =>
  own ?? piece * packSize;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-20" as "20 Nov 2026" (or "20 Nov" in the given year). */
export function dayLabel(day: string, thisYear?: string): string {
  const [year, month, date] = day.split("-");
  const text = `${Number(date)} ${MONTHS[Number(month) - 1]}`;
  return thisYear && year === thisYear.slice(0, 4) ? text : `${text} ${year}`;
}

/** The Manila day (YYYY-MM-DD) of an ISO time. Its first ten letters are the UTC day: a day early
 *  for anything done between midnight and 8 in the morning here (23 Nov). A plain day stays. */
export const manilaDay = (iso: string) =>
  iso.length <= 10
    ? iso
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** An ISO time as "14 Nov, 5:30 PM" in Manila. */
export const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));

/** Whole days from one "YYYY-MM-DD" to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// ---------------------------------------------------------------- pieces

export type Tone = "plain" | "brand" | "good" | "warn" | "bad" | "info" | "violet";

// Solid colours, no tinted glass (Aryan, 15 Nov): a status is a filled pill.
const TONES: Record<Tone, string> = {
  plain: "bg-slate-200 text-slate-800 border-transparent",
  brand: "bg-brand text-white border-transparent",
  good: "bg-emerald-600 text-white border-transparent",
  warn: "bg-amber-500 text-white border-transparent",
  bad: "bg-rose-600 text-white border-transparent",
  info: "bg-sky-600 text-white border-transparent",
  violet: "bg-violet-600 text-white border-transparent",
};

/** A status as a small filled pill. */
export function Pill({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-px text-xs font-semibold whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const TEXT_TONES: Record<Tone, string> = {
  plain: "text-ink-2",
  brand: "text-brand-dark",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  violet: "text-violet-700",
};
const DOT_TONES: Record<Tone, string> = {
  plain: "bg-ink-2",
  brand: "bg-brand",
  good: "bg-good-fill",
  warn: "bg-warn-fill",
  bad: "bg-bad-fill",
  info: "bg-info-fill",
  violet: "bg-violet-500",
};

/** A status inside a table row: a coloured dot and the word. */
export function Status({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${TEXT_TONES[tone]}`}
    >
      <span className={`size-2 rounded-full ${DOT_TONES[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** A box of the page, drawn as the old CRM's case page draws its boxes: a fine slate border,
 *  a 16px radius, a whisper of shadow. Every page's boxes are this one. */
export const CARD = "rounded-2xl border border-slate-200/90 bg-white shadow-2xs";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`${CARD} ${className}`}>{children}</section>;
}

/** A small grey capital heading over a box's content ("CASE JOURNEY", "STEPS"). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`text-xs font-bold tracking-wider text-stone-500 uppercase ${className}`}>
      {children}
    </h2>
  );
}

/** A card with a title line: the box most of a screen is made of. */
export function Panel({
  title,
  count: counted,
  actions,
  children,
  className = "",
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          {title}
          {counted !== undefined && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums">
              {count(counted)}
            </span>
          )}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

const BUTTONS = {
  primary: "bg-brand text-white shadow-sm hover:bg-brand-dark",
  plain: "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
  quiet: "text-slate-600 hover:bg-head hover:text-ink",
  danger: "text-rose-700 hover:bg-rose-50",
};

export function Button({
  variant = "plain",
  small,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTONS;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${
        small ? "h-8 px-2.5 text-[length:var(--button-small,13px)]" : "h-10 px-4 text-sm"
      } pointer-coarse:h-11 ${BUTTONS[variant]} ${className}`}
    />
  );
}

export const INPUT = "field";

/** The page's top band: its title, what it holds, its buttons, and tabs under it. */
export function PageHead({
  title,
  sub,
  tags,
  actions,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  tags?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
            {tags}
          </div>
          {sub && <div className="text-sm text-slate-500">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A list's views as pills with their counts; the picked one is filled. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        const picked = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={picked}
            onClick={() => onChange(tab.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              picked
                ? "bg-brand text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${picked ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}
              >
                {count(tab.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A figure to act on: the number, what it counts, and where a click goes. */
export function Tile({
  label,
  value,
  sub,
  tone = "plain",
  icon: Icon,
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">{label}</div>
        {Icon && (
          <Icon
            size={18}
            strokeWidth={1.8}
            className={tone === "plain" ? "text-slate-400" : TEXT_TONES[tone]}
          />
        )}
      </div>
      <div
        className={`mt-2 text-[28px] leading-none font-semibold tracking-tight ${tone === "plain" ? "text-ink" : TEXT_TONES[tone]}`}
      >
        {value}
      </div>
      <div className="mt-1.5 min-h-[1.2em] text-xs text-ink-2">{sub}</div>
    </>
  );
  const frame = `flex min-w-0 flex-col p-4 transition-shadow ${CARD}`;
  return to ? (
    <Link to={to} className={`${frame} hover:border-slate-300 hover:shadow-sm`}>
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}

/** Facts in the page's top band: a small label over each value, side by side. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(
    ([, value]) => value !== null && value !== undefined && value !== "" && value !== false,
  );
  if (shown.length === 0) return null;
  return (
    <dl className={`flex flex-wrap gap-x-10 gap-y-3 px-4.5 py-4 ${CARD}`}>
      {shown.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="text-sm font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-slate-600">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": error ? `${id}-error` : undefined,
      })}
      {error && (
        <div id={`${id}-error`} className="text-[13px] text-bad">
          {error}
        </div>
      )}
    </div>
  );
}

/** A dialog over the page, as the old CRM's Case details draws it: a bordered white card with
 *  the title (and a line under it), the form, then its buttons. Esc and the X close it; it
 *  can't be closed while `busy`. */
export function Dialog({
  title,
  sub,
  onClose,
  busy,
  wide,
  children,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  /** 48rem instead of 40rem: a form with two columns of long fields. */
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // Opening puts the cursor on the X; a form's first field is where typing should go.
      dialog.querySelector<HTMLElement>("input, select, textarea")?.focus();
    }
    return () => dialog?.close();
  }, []);
  // A tap on the dimmed page behind closes it too (Aryan): only when the press began there, so
  // dragging a selection out of a field doesn't.
  const pressedOutside = useRef(false);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (onCancel); the click is the dimmed page behind.
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget && !busy) onClose();
        pressedOutside.current = false;
      }}
      className={`m-auto ${wide ? "w-[min(48rem,calc(100vw-2rem))]" : "w-[min(40rem,calc(100vw-2rem))]"} max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/40`}
    >
      <div className="p-5 text-sm sm:p-6">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function Problem({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-[10px] border border-red-200 bg-bad-tint px-3 py-2 text-[13px] text-bad"
    >
      {message}
    </div>
  );
}

/** Runs a write: busy while it runs, the refusal's message and field if it is refused. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{
    message: string;
    field?: string;
    fields?: Record<string, string>;
  } | null>(null);
  async function run(work: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      return true;
    } catch (error) {
      setProblem(
        error instanceof ApiFailure
          ? { message: error.message, field: error.field, fields: error.fields }
          : { message: "That didn't work. Try again." },
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  /** The message for a field, or the general message when the refusal names no shown field. */
  const at = (field: string) =>
    problem?.fields?.[field] ?? (problem?.field === field ? problem.message : undefined);
  const general = (fields: string[]) =>
    problem && !fields.includes(problem.field ?? "") ? problem.message : null;
  return { busy, problem, run, at, general };
}

export function PageState({
  query,
  what,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
  what: string;
}) {
  if (query.isPending) return <div className="p-8 text-center text-ink-2">Loading {what}…</div>;
  // Not this person's page: say so, and lead back home (asking again changes nothing).
  if (query.isError && query.error instanceof ApiFailure && query.error.status === 403)
    return (
      <Card className="mx-auto flex max-w-md flex-col items-center gap-3 p-6 text-center">
        <div className="font-semibold">Not part of your desk</div>
        <div className="text-ink-2">{query.error.message}</div>
        <a href="/" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">
          Back to my Home
        </a>
      </Card>
    );
  if (query.isError)
    return (
      <Card className="mx-auto flex max-w-md flex-col items-center gap-3 p-6 text-center">
        <div className="font-semibold">Couldn't load {what}</div>
        <div className="text-ink-2">
          {query.error instanceof Error ? query.error.message : "Try again."}
        </div>
        <Button variant="primary" onClick={() => query.refetch()}>
          Try again
        </Button>
      </Card>
    );
  return null;
}

/** A small switch between looks of the same thing. */
export function LookSwitch<T extends string>({
  legend,
  looks,
  value,
  onPick,
}: {
  legend: string;
  looks: readonly (readonly [T, string])[];
  value: T;
  onPick: (key: T) => void;
}) {
  return (
    <fieldset className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
      <legend className="sr-only">{legend}</legend>
      {looks.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onPick(key)}
          className={`rounded-md px-2.5 py-1 transition-colors ${
            value === key
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

/** A look picked once and remembered on this computer. */
export function useLook<T extends string>(key: string, looks: readonly (readonly [T, string])[]) {
  const first = (looks[0] as readonly [T, string])[0];
  const [look, setLook] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return looks.find(([one]) => one === saved)?.[0] ?? first;
    } catch {
      return first;
    }
  });
  const pick = (next: T) => {
    setLook(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // A private window: the pick lasts until the page is left.
    }
  };
  return [look, pick] as const;
}
