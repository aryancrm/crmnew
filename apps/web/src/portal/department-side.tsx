// The department's side of the sign-in page (Aryan, 21 Nov: the form on the right, the department's
// icon and its information on the other side). Calm on purpose: one column, no cards in cards, the
// figures, what it handles and how work moves, in that order. Before signing in only counts go out:
// no money and nobody's name.

import type { PortalDepartment } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { api } from "../api";
import type { Workspace } from "../workspaces";
import { DEPARTMENTS } from "./departments";
import { TILE_GLOW, TILE_ICONS } from "./tiles";

const sectionTitle = "text-[11px] font-semibold tracking-[0.16em] text-[#7a8394] uppercase";

/** The department's mark, large, as its tile on the first screen has it. */
export function DepartmentMark({ workspace, size = "lg" }: { workspace: Workspace; size?: "lg" | "sm" }) {
  const Icon = TILE_ICONS[workspace.key];
  const color = TILE_GLOW[workspace.key] ?? "#f36b21";
  const box = size === "lg" ? "size-24 rounded-[1.8rem]" : "size-12 rounded-2xl";
  return (
    <span className={`relative grid shrink-0 place-items-center ${box}`}>
      <span aria-hidden="true" className="absolute inset-2 rounded-[2rem] opacity-35 blur-2xl" style={{ background: color }} />
      <span
        className={`relative grid place-items-center border border-white/90 bg-white/80 shadow-[0_18px_40px_-18px_rgba(20,30,50,0.3),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl ${box}`}
      >
        <span className="size-[56%]">{Icon && <Icon />}</span>
      </span>
    </span>
  );
}

export function DepartmentSide({ workspace, titleOnPhone = true }: { workspace: Workspace; titleOnPhone?: boolean }) {
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
          hint: one.hint,
          value:
            one.value === null
              ? "—"
              : one.unit === "days"
                ? one.value === 0
                  ? "Same day"
                  : `${one.value} ${one.value === 1 ? "day" : "days"}`
                : one.value.toLocaleString("en-PH"),
        })),
        { label: "Team members", hint: "on the company chart", value: page.people.toLocaleString("en-PH") },
      ].slice(0, 4)
    : [];

  return (
    <div className="grid gap-9">
      {/* Where you are. */}
      <div className={`items-center gap-5 ${titleOnPhone ? "flex" : "hidden lg:flex"}`}>
        <DepartmentMark workspace={workspace} />
        <div className="min-w-0">
          <h1 className="text-[clamp(26px,3vw,36px)] leading-tight font-semibold tracking-[-0.035em] text-[#1f2733]">{workspace.label}</h1>
          <p className="mt-1 max-w-[52ch] text-[15px] text-[#5b6472]">{info?.about ?? workspace.about}</p>
        </div>
      </div>

      {/* The last 30 days, counted. */}
      <section aria-label="Last 30 days">
        <h2 className={sectionTitle}>Last 30 days</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-l-2 pl-5" style={{ borderColor: `${color}55` }}>
          {(stats.length ? stats : [null, null, null, null]).map((one, index) =>
            one ? (
              <div key={one.label}>
                <dd className="text-[24px] leading-none font-semibold tracking-[-0.03em] text-[#1f2733] tabular-nums">{one.value}</dd>
                <dt className="mt-1 text-[13px] leading-snug font-medium text-[#3c4452]">{one.label}</dt>
                <dd className="text-[12px] leading-snug text-[#7a8394]">{one.hint}</dd>
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: four fixed places while loading
              <div key={index} className="h-[58px] animate-pulse rounded-lg bg-white/60" />
            ),
          )}
        </dl>
      </section>

      {info && (
        <section aria-label="Key functions">
          <h2 className={sectionTitle}>Key functions</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {info.handles.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[14px] text-[#3c4452]">
                <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-[#1f9d55]" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {info && (
        <section aria-label="How work moves">
          <h2 className={sectionTitle}>How work moves</h2>
          <ol className="mt-3 grid gap-2.5">
            {info.flow.map((one, index) => (
              <li key={one.step} className="flex items-center gap-3 text-[14px]">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums"
                  style={{ background: `${color}1f`, color }}
                >
                  {index + 1}
                </span>
                <span className="font-medium text-[#1f2733]">{one.step}</span>
                <span className="text-[#7a8394]">· {one.who}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
