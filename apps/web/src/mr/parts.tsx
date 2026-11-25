// The MR App's small pieces (docs/PLAN.md 22): the phone's place, the action sheets SEFMED opens on
// a tap (a list to pick one from), a client's line, a visit's state, the page's top line.

import type { ClientCard, MrMe, VisitCard, VisitState } from "@2mg/api/mr";
import { STATE_WORDS, stateOf } from "@2mg/api/mr";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Dialog } from "../ui";

export { FIELD } from "../org/dialogs";

/** The phone's place as "lat,lng" (and how sure), or nulls when it isn't shared in eight seconds. */
export function whereAmI(): Promise<{ place: string | null; accuracy: number | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ place: null, accuracy: null });
    navigator.geolocation.getCurrentPosition(
      (at) =>
        resolve({
          place: `${at.coords.latitude.toFixed(5)},${at.coords.longitude.toFixed(5)}`,
          accuracy: Math.round(at.coords.accuracy),
        }),
      () => resolve({ place: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export const mapLink = (place: string) => `https://www.google.com/maps?q=${place}`;
export const directions = (client: { pin?: string | null; name: string; city: string | null; address?: string | null }) =>
  client.pin
    ? `https://www.google.com/maps/dir/?api=1&destination=${client.pin}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([client.name, client.address, client.city].filter(Boolean).join(", "))}`;

export const clockOf = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso))
    : "";
export const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const monthWords = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
export const shiftDay = (day: string, by: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
export const minutesWords = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
export const distanceWords = (metres: number) => (metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`);

/** How the app stands for this person: MR, team lead, a viewer (CEO, Admin), or not in it. */
export function useMrMe() {
  return useQuery({ queryKey: ["mr", "me"], queryFn: () => api<MrMe>("/api/mr/me"), staleTime: 60_000 });
}

const STATE_TONE: Record<VisitState, string> = {
  new: "bg-sky-600 text-white",
  at: "bg-amber-500 text-white",
  closed: "bg-emerald-600 text-white",
  skipped: "bg-slate-400 text-white",
  missed: "bg-rose-600 text-white",
};

export function StatePill({ visit }: { visit: Pick<VisitCard, "status" | "checkedInAt"> }) {
  const state = stateOf(visit);
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_TONE[state]}`}>{STATE_WORDS[state]}</span>
  );
}

/** The round letter SEFMED shows beside a name. */
export function Initial({ name }: { name: string }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-sky-200 bg-sky-50 text-sm font-bold text-sky-700">
      {name.replace(/^(dr\.?|dra\.?)\s+/i, "").charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export const clientLine = (client: Pick<ClientCard, "code" | "specialty" | "detail" | "city" | "category">) =>
  [client.code, client.category ? `Category ${client.category}` : null, client.specialty, client.detail, client.city]
    .filter(Boolean)
    .join(" · ");

/** A pick-one sheet (SEFMED's radio dialog on a tap): each choice a big row. */
export function ActionSheet({
  title,
  sub,
  actions,
  onClose,
}: {
  title: string;
  sub?: ReactNode;
  actions: { label: string; hint?: string; onPick: () => void; hidden?: boolean; danger?: boolean }[];
  onClose: () => void;
}) {
  return (
    <Dialog title={title} sub={sub} onClose={onClose}>
      <ul className="-mx-2 flex flex-col">
        {actions
          .filter((one) => !one.hidden)
          .map((one) => (
            <li key={one.label}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  one.onPick();
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium hover:bg-slate-50 ${one.danger ? "text-rose-700" : "text-slate-800"}`}
              >
                <span>{one.label}</span>
                {one.hint && <span className="text-xs text-slate-500">{one.hint}</span>}
              </button>
            </li>
          ))}
      </ul>
    </Dialog>
  );
}

/** The app's page top: a back arrow, the title, a line under it, buttons on the right. */
export function MrHead({ title, sub, actions }: { title: string; sub?: ReactNode; back?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-slate-900">{title}</h1>
          {sub && <div className="mt-0.5 text-sm text-slate-500">{sub}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A place on the map, as a small link. */
export function PlaceLink({ place, label = "Map" }: { place: string | null; label?: string }) {
  if (!place) return <span className="text-slate-400">no place shared</span>;
  return (
    <a href={mapLink(place)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-700 hover:underline">
      <MapPin size={12} /> {label}
    </a>
  );
}

/** A labelled field. */
export function Label({ text, error, children }: { text: string; error?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control comes in as the children.
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600">{text}</span>
      {children}
      {error && <span className="text-xs font-medium text-rose-700">{error}</span>}
    </label>
  );
}

/** Pills to pick one (or several) from. */
export function Choices<T extends string>({
  options,
  value,
  onChange,
  many,
}: {
  options: { key: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  many?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((one) => {
        const on = value.includes(one.key);
        return (
          <button
            key={one.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(many ? (on ? value.filter((v) => v !== one.key) : [...value, one.key]) : [one.key])}
            className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${on ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-sky-400"}`}
          >
            {one.label}
          </button>
        );
      })}
    </div>
  );
}

/** A line to open a page (a card made a link). */
export function Row({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs hover:border-sky-300">
      {children}
    </Link>
  );
}
