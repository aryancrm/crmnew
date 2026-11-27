// Thin lines (Aryan, 26 Nov: not bold). "Nothing found", drawn (Aryan, 26 Nov, after an empty state from his other system): a blue card
// with the three coloured dots, a filled magnifying glass searching over it, a dashed arc turning
// and a soft shadow underneath, all gently moving (still for people who turn motion off). The
// moves are in styles.css (no-results-*).

import type { ReactNode } from "react";

/** The picture alone. */
export function NoResultsArt({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 100" width={size} height={(size * 100) / 120} aria-hidden="true" className="no-results">
      {/* The shadow breathes with the card. */}
      <ellipse className="no-results__shadow" cx="56" cy="92" rx="36" ry="5" fill="#dbe6fb" />

      {/* The card, floating. */}
      <g className="no-results__card">
        <line x1="38" y1="14" x2="38" y2="26" stroke="#1f2937" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="70" y1="14" x2="70" y2="26" stroke="#1f2937" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="22" y="20" width="64" height="56" rx="9" fill="#ffffff" stroke="#1f2937" strokeWidth="1.6" />
        <path d="M22 35h64" stroke="#1f2937" strokeWidth="1.6" />
        <circle className="no-results__dot" cx="31" cy="28" r="2.6" fill="#ea4335" />
        <circle className="no-results__dot no-results__dot--2" cx="38.5" cy="28" r="2.6" fill="#fbbc05" />
        <circle className="no-results__dot no-results__dot--3" cx="46" cy="28" r="2.6" fill="#34a853" />
        <rect x="31" y="44" width="34" height="5" rx="2.5" fill="#dbe6fb" />
        <rect x="31" y="54" width="24" height="5" rx="2.5" fill="#dbe6fb" />
        <rect x="31" y="64" width="29" height="5" rx="2.5" fill="#e8f6fc" />
      </g>

      {/* The magnifying glass, looking around: a filled blue lens with a white question mark. */}
      <g className="no-results__glass">
        <line x1="86" y1="70" x2="96" y2="80" stroke="#1f2937" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="78" cy="62" r="14" fill="#1d9fda" stroke="#ffffff" strokeWidth="2" />
        <path
          d="M74.2 58.6a3.9 3.9 0 1 1 5.6 3.5c-1.1.6-1.8 1.4-1.8 2.6v.7"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="78" cy="69" r="1.6" fill="#ffffff" />
      </g>

      {/* The dashed arc, turning. */}
      <path className="no-results__arc" d="M96 18a14 14 0 0 1 6 18" fill="none" stroke="#93b4f5" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="3 4" />
    </svg>
  );
}

/** The picture with a title and a line under it, centred. */
export function NoResults({ title, children, size }: { title: ReactNode; children?: ReactNode; size?: number }) {
  return (
    <div className="flex flex-col items-center px-4 py-5 text-center">
      <NoResultsArt size={size} />
      <p className="mt-3 text-[15px] font-semibold text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-slate-500">{children}</p>}
    </div>
  );
}

/** "No invoices", drawn for an empty table (Aryan, 26 Nov: not the search picture): a blank receipt
 *  with a torn edge, floating, a peso coin turning over beside it, two sparkles. Moves gently, as
 *  the search picture does (styles.css no-invoices-*). */
export function NoInvoicesArt({ size = 112 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 100" width={size} height={(size * 100) / 120} aria-hidden="true" className="no-results">
      <ellipse className="no-results__shadow" cx="54" cy="93" rx="30" ry="4.5" fill="#dbe6fb" />
      {/* The receipt, its bottom edge torn. */}
      <g className="no-invoices__paper">
        <path
          d="M30 12h48a5 5 0 0 1 5 5v67l-5.8-4-5.8 4-5.8-4-5.8 4-5.8-4-5.8 4-5.8-4-5.8 4-5.8-4-5.8 4V17a5 5 0 0 1 5-5z"
          fill="#ffffff"
          stroke="#1f2937"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <rect x="35" y="22" width="22" height="5" rx="2.5" fill="#1d9fda" />
        <rect x="35" y="34" width="38" height="4" rx="2" fill="#dbe6fb" />
        <rect x="35" y="43" width="30" height="4" rx="2" fill="#dbe6fb" />
        <rect x="35" y="52" width="34" height="4" rx="2" fill="#dbe6fb" />
        <path d="M35 63h38" stroke="#dbe6fb" strokeWidth="2" strokeDasharray="3 3" />
        <rect x="55" y="68" width="18" height="5" rx="2.5" fill="#e8f6fc" />
      </g>
      {/* The peso coin, turning over. */}
      <g className="no-invoices__coin">
        <circle cx="92" cy="30" r="13" fill="#fbbc05" stroke="#e0a400" strokeWidth="1.6" />
        <text x="92" y="35.5" textAnchor="middle" fontSize="15" fontWeight="700" fill="#ffffff" fontFamily="system-ui, sans-serif">
          ₱
        </text>
      </g>
      {/* Two sparkles. */}
      <path className="no-invoices__spark" d="M17 30l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#93b4f5" />
      <path className="no-invoices__spark no-invoices__spark--2" d="M98 62l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="#34a853" />
    </svg>
  );
}

/** An empty list: a picture (the receipt by default), a title and a line under it, centred. */
export function EmptyState({ art, title, children }: { art?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      {art ?? <NoInvoicesArt />}
      <p className="mt-3 text-[15px] font-semibold text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">{children}</p>}
    </div>
  );
}

/** "Loading", drawn (Aryan, 27 Nov): a card whose rows fill in blue one after another, a blue
 *  circle with a white arc turning, the card floating and two sparkles twinkling. Shown above
 *  every "Loading …" (ui.tsx PageState); the moves are in styles.css (loading-*), and it stands
 *  still for people who turn motion off. */
export function LoadingArt({ size = 112 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 100" width={size} height={(size * 100) / 120} aria-hidden="true" className="no-results">
      <ellipse className="no-results__shadow" cx="54" cy="92" rx="32" ry="4.5" fill="#dbe6fb" />
      <g className="no-results__card">
        <rect x="22" y="18" width="62" height="62" rx="8" fill="#ffffff" stroke="#1f2937" strokeWidth="1.6" />
        <rect x="31" y="27" width="20" height="5" rx="2.5" fill="#1d9fda" />
        {[40, 50, 60].map((y, i) => (
          <g key={y}>
            <rect x="31" y={y} width={i === 1 ? 34 : 42} height="4.5" rx="2.25" fill="#e8f6fc" />
            <rect className={`loading-row loading-row--${i + 1}`} x="31" y={y} width={i === 1 ? 34 : 42} height="4.5" rx="2.25" fill="#1d9fda" />
          </g>
        ))}
        <rect x="31" y="69" width="16" height="4" rx="2" fill="#dbe6fb" />
      </g>
      {/* The turning arc, in a blue circle. */}
      <circle cx="90" cy="28" r="12" fill="#1d9fda" stroke="#ffffff" strokeWidth="2" />
      <path className="loading-spin" d="M90 21.5a6.5 6.5 0 1 1-6.5 6.5" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
      <path className="no-invoices__spark" d="M15 46l1.4 3.4 3.4 1.4-3.4 1.4-1.4 3.4-1.4-3.4-3.4-1.4 3.4-1.4z" fill="#93b4f5" />
      <path className="no-invoices__spark no-invoices__spark--2" d="M98 60l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1z" fill="#34a853" />
    </svg>
  );
}

/** The loading picture with its words under it, centred. */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center" role="status" aria-live="polite">
      {/* Bigger than the empty-state pictures (Aryan, 27 Nov). */}
      <LoadingArt size={190} />
      <p className="mt-4 text-[15px] text-slate-500">{children}</p>
    </div>
  );
}
