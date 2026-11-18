// Bishnoi One's workspace icons for the launcher: one bold, flat mark per workspace, in the manner
// of an app launcher. Original drawings, 64×64.

import type { ReactNode } from "react";

const Mark = ({ children, label }: { children: ReactNode; label: string }) => (
  <svg viewBox="0 0 64 64" role="img" aria-label={label} className="h-full w-full">
    {children}
  </svg>
);

export const TILE_ICONS: Record<string, () => ReactNode> = {
  sales: () => (
    <Mark label="Sales and field">
      <circle cx="32" cy="32" r="30" fill="#34b261" />
      <path d="M32 14a11 11 0 0 1 11 11c0 9-11 20-11 20S21 34 21 25a11 11 0 0 1 11-11z" fill="#fff" />
      <circle cx="32" cy="25" r="4.5" fill="#34b261" />
      <path d="M20 50h24" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
    </Mark>
  ),
  management: () => (
    <Mark label="Management">
      <path d="M5 34l14-14 14 14-14 14z" fill="#2f6fe4" />
      <path d="M21 47L51 17l8 8-30 30z" fill="#4c9bff" />
    </Mark>
  ),
  finance: () => (
    <Mark label="Finance">
      <rect x="8" y="34" width="12" height="24" rx="6" fill="#a259ff" />
      <rect x="26" y="21" width="12" height="37" rx="6" fill="#1abcfe" />
      <rect x="44" y="7" width="12" height="51" rx="6" fill="#f36b21" />
    </Mark>
  ),
  inventory: () => (
    <Mark label="Inventory">
      <path d="M32 6l24 12v28L32 58 8 46V18z" fill="#f59e0b" />
      <path d="M32 6l24 12-24 12L8 18z" fill="#fbbf24" />
      <path d="M32 30v28L8 46V18z" fill="#d97706" />
    </Mark>
  ),
  dispatch: () => (
    <Mark label="Dispatch">
      <rect x="4" y="15" width="36" height="29" rx="5" fill="#ff7a59" />
      <path d="M40 24h11l9 10v10H40z" fill="#ff9f84" />
      <circle cx="16" cy="48" r="7" fill="#33475b" />
      <circle cx="48" cy="48" r="7" fill="#33475b" />
      <circle cx="16" cy="48" r="2.5" fill="#fff" />
      <circle cx="48" cy="48" r="2.5" fill="#fff" />
    </Mark>
  ),
  online: () => (
    <Mark label="Online desk">
      <circle cx="22" cy="30" r="16" fill="#7c5cff" />
      <circle cx="42" cy="30" r="16" fill="#9a7dff" />
      <path d="M30 40l2 17 7-15z" fill="#7c5cff" />
    </Mark>
  ),
  hr: () => (
    <Mark label="HR">
      <circle cx="32" cy="32" r="30" fill="#1d6fd8" />
      <path d="M17 25a17 17 0 0 1 30 0" stroke="#ffb020" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="34" r="6.5" fill="#fff" />
      <path d="M19 51c2-7 7-10.5 13-10.5S43 44 45 51" fill="#fff" />
    </Mark>
  ),
  regulatory: () => (
    <Mark label="Regulatory">
      <path d="M32 4l24 9v17c0 16-11 27-24 31C19 57 8 46 8 30V13z" fill="#0f9d8a" />
      <path d="M21 31l8 8 15-16" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Mark>
  ),
  office: () => (
    <Mark label="Office staff">
      <rect x="9" y="6" width="38" height="52" rx="8" fill="#33475b" />
      <circle cx="20" cy="47" r="4" fill="#fff" />
      <circle cx="32" cy="47" r="4" fill="#fff" />
      <path d="M19 18h20M19 28h14" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M50 13l8 8-14 14h-8v-8z" fill="#f36b21" />
    </Mark>
  ),
  ceo: () => (
    <Mark label="CEO">
      <path d="M3 57L24 14l12 24 8-14 17 33z" fill="#e5322d" />
      <path d="M24 14l12 24-8 19H3z" fill="#ff5a4e" />
      <path d="M44 6v16" stroke="#33475b" strokeWidth="3" strokeLinecap="round" />
      <path d="M44 6h13l-4 4.5 4 4.5H44z" fill="#ffb020" />
    </Mark>
  ),
  books: () => (
    <Mark label="Books">
      <path d="M8 12c8-4 16-4 24 2v42c-8-6-16-6-24-2z" fill="#22b378" />
      <path d="M56 12c-8-4-16-4-24 2v42c8-6 16-6 24-2z" fill="#34d399" />
      <path d="M14 22c4-1.5 8-1.5 12 0M14 30c4-1.5 8-1.5 12 0M38 22c4-1.5 8-1.5 12 0M38 30c4-1.5 8-1.5 12 0" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Mark>
  ),
  admin: () => (
    <Mark label="Administration">
      <circle cx="32" cy="32" r="30" fill="#3a3f8f" />
      <path
        d="M29 13h6l1 5 4 2 4-3 4 4-3 4 2 4 5 1v6l-5 1-2 4 3 4-4 4-4-3-4 2-1 5h-6l-1-5-4-2-4 3-4-4 3-4-2-4-5-1v-6l5-1 2-4-3-4 4-4 4 3 4-2z"
        fill="#fff"
      />
      <circle cx="32" cy="32" r="6" fill="#3a3f8f" />
    </Mark>
  ),
};

/** The colour of each workspace's soft glow behind its tile. */
export const TILE_GLOW: Record<string, string> = {
  sales: "#34b261",
  management: "#2f6fe4",
  finance: "#a259ff",
  inventory: "#f59e0b",
  dispatch: "#ff7a59",
  online: "#7c5cff",
  hr: "#1d6fd8",
  regulatory: "#0f9d8a",
  office: "#33475b",
  ceo: "#e5322d",
  admin: "#3a3f8f",
  books: "#22b378",
};
