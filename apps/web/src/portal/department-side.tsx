// The department's side of the sign-in page (Aryan, 21 Nov, after a split sign-in screen he liked):
// a tinted panel the whole height of the window, the department's icon large in the middle as its
// picture, its name and line under it, then its last 30 days and what it handles. The form has the
// other side to itself. Before signing in only counts go out: no money and nobody's name.

import type { PortalDepartment } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import type { CSSProperties } from "react";
import { api } from "../api";
import type { Workspace } from "../workspaces";
import { DEPARTMENTS } from "./departments";
import { TILE_GLOW, TILE_ICONS } from "./tiles";

/** The department's mark as its tile on the first screen has it; "sm" for headings. */
export function DepartmentMark({ workspace, size = "sm" }: { workspace: Workspace; size?: "sm" | "xl" }) {
  const Icon = TILE_ICONS[workspace.key];
  const color = TILE_GLOW[workspace.key] ?? "#f36b21";
  const box = size === "xl" ? "size-36 rounded-[2.4rem]" : "size-12 rounded-2xl";
  return (
    <span className={`relative grid shrink-0 place-items-center ${box}`}>
      <span aria-hidden="true" className="absolute inset-2 rounded-[2rem] opacity-40 blur-2xl" style={{ background: color }} />
      <span
        className={`relative grid place-items-center border border-white bg-white/90 shadow-[0_24px_50px_-20px_rgba(20,30,50,0.35),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl ${box}`}
      >
        <span className="size-[56%]">{Icon && <Icon />}</span>
      </span>
    </span>
  );
}

/** Soft squares around the icon, in the department's colour: the panel's picture. */
const SQUARES: { at: CSSProperties; size: number; alpha: string }[] = [
  { at: { top: "6%", left: "8%" }, size: 22, alpha: "33" },
  { at: { top: "14%", right: "6%" }, size: 34, alpha: "26" },
  { at: { bottom: "12%", left: "2%" }, size: 30, alpha: "22" },
  { at: { bottom: "4%", right: "14%" }, size: 18, alpha: "40" },
  { at: { top: "46%", right: "-2%" }, size: 14, alpha: "4d" },
  { at: { top: "40%", left: "-4%" }, size: 12, alpha: "40" },
];

function Picture({ workspace, color }: { workspace: Workspace; color: string }) {
  return (
    <div className="relative mx-auto grid h-64 w-full max-w-sm place-items-center" aria-hidden="true">
      {/* The floor the icon stands on. */}
      <span className="absolute bottom-6 h-24 w-72 rotate-[-8deg] skew-x-[-30deg] rounded-3xl opacity-60" style={{ background: `${color}1a` }} />
      <span className="absolute bottom-10 h-16 w-52 rotate-[-8deg] skew-x-[-30deg] rounded-2xl" style={{ background: `${color}24` }} />
      {SQUARES.map((one) => (
        <span
          key={JSON.stringify(one.at)}
          className="absolute rotate-45 rounded-md"
          style={{ ...one.at, width: one.size, height: one.size, background: `${color}${one.alpha}` }}
        />
      ))}
      <span className="relative -translate-y-3">
        <DepartmentMark workspace={workspace} size="xl" />
      </span>
    </div>
  );
}

export function DepartmentPanel({ workspace }: { workspace: Workspace }) {
  const info = DEPARTMENTS[workspace.key];
  const color = TILE_GLOW[workspace.key] ?? "#f36b21";
  const data = useQuery({
    queryKey: ["portal", "department", workspace.key],
    queryFn: () => api<PortalDepartment>(`/api/portal/departments/${workspace.key}`),
    staleTime: 60_000,
    retry: 1,
  });
  const page = data.data;
  const stats = page
    ? [
        ...page.stats.map((one) => ({
          label: one.label,
          value:
            one.value === null
              ? "—"
              : one.unit === "days"
                ? one.value === 0
                  ? "Same day"
                  : `${one.value} ${one.value === 1 ? "day" : "days"}`
                : one.value.toLocaleString("en-PH"),
        })),
        { label: "Team members", value: page.people.toLocaleString("en-PH") },
      ].slice(0, 4)
    : [];

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="hidden lg:block">
        <Picture workspace={workspace} color={color} />
      </div>

      <div className="text-center">
        <h2 className="text-[clamp(24px,2.4vw,32px)] leading-tight font-semibold tracking-[-0.035em] text-[#1f2733]">{workspace.label}</h2>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[15px] text-[#5b6472]">{info?.about ?? workspace.about}</p>
      </div>

      {/* The last 30 days, counted. */}
      <dl aria-label="Last 30 days" className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/70 sm:grid-cols-4">
        {(stats.length ? stats : [null, null, null, null]).map((one, index) =>
          one ? (
            <div key={one.label} className="flex flex-col bg-white/80 px-3 py-3 text-center">
              <dt className="order-2 mt-1 text-[12px] leading-snug text-[#5b6472]">{one.label}</dt>
              <dd className="order-1 text-[20px] leading-none font-semibold tracking-[-0.03em] text-[#1f2733] tabular-nums">{one.value}</dd>
            </div>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed places while loading
            <div key={index} className="h-[66px] animate-pulse bg-white/60" />
          ),
        )}
      </dl>
      <p className="mt-2 text-center text-[11px] text-[#7a8394]">Last 30 days</p>

      {info && (
        <ul aria-label="Key functions" className="mt-6 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {info.handles.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[13px] text-[#3c4452]">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color }} aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
