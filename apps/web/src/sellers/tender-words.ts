// The bid report's words, shared by the tender page and the report.

import type { TenderReason } from "@2mg/api/types";

/** Why a tender was won or lost. */
export const REASON: Record<TenderReason, string> = {
  lowest: "Ours was the lowest",
  lower_price: "Another bid was lower",
  above_abc: "Our price was above the ABC",
  documents: "Papers incomplete or wrong",
  post_disqualified: "Disqualified at post-qualification",
  failed_bidding: "Failed bidding (no award)",
  other: "Other (see the note)",
};
