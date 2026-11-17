// The CRM's one pace rule and its colours, shared by My team, the sales organisation and the map:
// on pace, behind, far behind (under half the pace), no target, vacant.

export type Tone = "on" | "behind" | "far" | "none" | "vacant";
export const TONE: Record<Tone, { word: string; pill: string; bar: string; ring: string }> = {
  on: {
    word: "On pace",
    pill: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    bar: "bg-emerald-500",
    ring: "#10b981",
  },
  behind: {
    word: "Behind",
    pill: "bg-amber-50 text-amber-900 ring-amber-200",
    bar: "bg-amber-400",
    ring: "#f59e0b",
  },
  far: {
    word: "Far behind",
    pill: "bg-rose-50 text-rose-700 ring-rose-200",
    bar: "bg-rose-500",
    ring: "#f43f5e",
  },
  none: {
    word: "No target",
    pill: "bg-slate-50 text-slate-600 ring-slate-200",
    bar: "bg-slate-400",
    ring: "#94a3b8",
  },
  vacant: {
    word: "Vacant",
    pill: "bg-amber-100 text-amber-900 ring-amber-300",
    bar: "bg-slate-300",
    ring: "#cbd5e1",
  },
};

/** The CRM's one pace rule: on pace, behind, or far behind (under half the pace). */
export function toneOf(sold: number, target: number | null, pace: number): Exclude<Tone, "vacant"> {
  if (!target || target <= 0) return "none";
  const share = sold / target;
  if (share >= pace) return "on";
  return pace >= 0.2 && share < pace / 2 ? "far" : "behind";
}

