// The monthly scorecards, as the playbooks write them: each role's KPIs, weights and point
// bands. Pure (no database). A KPI with nothing to measure yet is left out of the month's
// maximum, never scored 0. The 12-month average of the locked months sets the increment band.

export type Band = {
  /** The value from which this band applies: for "more is better" the lowest value in it, for
   *  "less is better" the highest. */
  from: number;
  points: number;
  label: string;
};
export type KpiRecipe = {
  key: string;
  label: string;
  /** What it measures, in one line. */
  how: string;
  weight: number;
  unit: "%" | "days" | "count";
  better: "high" | "low";
  /** Best band first. */
  bands: Band[];
  /** A gate adds no points: below `pass` the month's total is capped at `cap`. */
  gate?: { pass: number; cap: number };
  /** The value is the points (0 to the weight), not looked up in bands. */
  direct?: boolean;
};
export type Recipe = {
  key: "hospital" | "b2c" | "rx" | "telesales" | "team" | "lead" | "field" | "nbd" | "crr" | "clidp" | "mt" | "bidding" | "pap";
  label: string;
  /** From the playbook named. */
  source: string;
  kpis: KpiRecipe[];
  /** A month whose first KPI scores 0 cannot total more than this. */
  capOnZero?: { kpi: string; total: number };
};

export const HOSPITAL: Recipe = {
  key: "hospital",
  label: "Hospital CHC",
  source: "Hospital CHC Playbook v1.0",
  capOnZero: { kpi: "ist", total: 40 },
  kpis: [
    {
      key: "ist", label: "IST · sales vs target", how: "Invoiced this month ÷ the month's target", weight: 50, unit: "%", better: "high",
      bands: [
        { from: 91, points: 50, label: "On target" },
        { from: 81, points: 40, label: "Near" },
        { from: 71, points: 30, label: "Developing" },
        { from: 60, points: 20, label: "Below" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "dso", label: "DSO · days to collect", how: "Owed now ÷ (this month's sales ÷ days in the month)", weight: 20, unit: "days", better: "low",
      bands: [
        { from: 70, points: 20, label: "Healthy" },
        { from: 89, points: 10, label: "Watch" },
        { from: Number.POSITIVE_INFINITY, points: 0, label: "Escalate to the coach" },
      ],
    },
    {
      key: "hrr", label: "HRR · hospitals reordering", how: "Hospitals invoiced last month and this ÷ invoiced last month", weight: 15, unit: "%", better: "high",
      bands: [
        { from: 95, points: 15, label: "Excellent" },
        { from: 85, points: 12, label: "On target" },
        { from: 75, points: 8, label: "Below" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "nzsd", label: "NZSD · days with an invoice", how: "Working days with at least one invoice ÷ working days", weight: 15, unit: "%", better: "high",
      bands: [
        { from: 95, points: 15, label: "Excellent" },
        { from: 90, points: 12, label: "On target" },
        { from: 80, points: 9, label: "Developing" },
        { from: 70, points: 6, label: "Below" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
  ],
};

export const B2C: Recipe = {
  key: "b2c",
  label: "B2C CHC",
  source: "B2C CHC Playbook v1.3",
  capOnZero: { kpi: "ist", total: 40 },
  kpis: [
    {
      key: "ist", label: "IST · sales vs target", how: "Invoiced online sales this month ÷ the month's target", weight: 45, unit: "%", better: "high",
      bands: [
        { from: 91, points: 45, label: "Target met" },
        { from: 81, points: 36, label: "On track" },
        { from: 71, points: 27, label: "Developing" },
        { from: 60, points: 18, label: "Below" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "crr", label: "CRR · customers reordering", how: "Customers invoiced last month and this ÷ invoiced last month", weight: 15, unit: "%", better: "high",
      bands: [
        { from: 95, points: 15, label: "Full" },
        { from: 85, points: 13, label: "High" },
        { from: 75, points: 11, label: "Developing" },
        { from: 65, points: 8, label: "Alert" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "nbd", label: "NBD · enquiries turned into first orders", how: "New customers with a first paid order ÷ new enquiries this month", weight: 15, unit: "%", better: "high",
      bands: [
        { from: 81, points: 15, label: "Full" },
        { from: 66, points: 13, label: "Excellent" },
        { from: 51, points: 10, label: "Strong" },
        { from: 36, points: 7, label: "Proficient" },
        { from: 20, points: 4, label: "Developing" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "nzsd", label: "NZSD · days with an invoice", how: "Working days with at least one invoice ÷ working days", weight: 15, unit: "%", better: "high",
      bands: [
        { from: 95, points: 15, label: "Full" },
        { from: 90, points: 13, label: "High" },
        { from: 80, points: 11, label: "Developing" },
        { from: 70, points: 8, label: "Below" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "ocr", label: "OCR · orders cancelled", how: "Cancelled orders ÷ orders this month (lower is better)", weight: 10, unit: "%", better: "low",
      bands: [
        { from: 0.99, points: 10, label: "Full" },
        { from: 4.99, points: 8, label: "High" },
        { from: 9.99, points: 5, label: "Developing" },
        { from: 14.99, points: 2, label: "Alert" },
        { from: Number.POSITIVE_INFINITY, points: 0, label: "Critical" },
      ],
    },
  ],
};

// Rx CHC Play Book's card (p. 32-33). The Rx Team & Training Playbook moves NBD and CRR to MD
// Telesales but gives no new weights (a question for Aryan); until the reconciled card is
// published this one stands. HIT needs the formulary tracker (Phase 5): left out until then.
export const RX: Recipe = {
  key: "rx",
  label: "Rx CHC",
  source: "Rx CHC Play Book",
  kpis: [
    {
      key: "nbd", label: "NBD · new prescribing doctors", how: "Doctors whose first order with us came this month: one who bought (dispense) or sent a patient (referral)", weight: 30, unit: "count", better: "high",
      bands: [
        { from: 9, points: 30, label: "GetMeds Best" },
        { from: 7, points: 27, label: "Elite" },
        { from: 5, points: 24, label: "High Performer" },
        { from: 3, points: 18, label: "Developing" },
        { from: 1, points: 12, label: "Below Standard" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "crr", label: "CRR · doctors prescribing again", how: "Doctors with an order last month (bought or sent a patient) who had one again this month ÷ last month's", weight: 30, unit: "%", better: "high",
      bands: [
        { from: 90, points: 30, label: "GetMeds Best" },
        { from: 80, points: 27, label: "Elite" },
        { from: 70, points: 24, label: "High Performer" },
        { from: 60, points: 18, label: "Developing" },
        { from: 50, points: 12, label: "Below Standard" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "pap", label: "PAP · assistance approved", how: "Guarantee letters received this month: on the person's PAP cases, and their orders paid by an agency's letter", weight: 25, unit: "count", better: "high",
      bands: [
        { from: 11, points: 25, label: "GetMeds Best" },
        { from: 8, points: 23, label: "Elite" },
        { from: 5, points: 20, label: "High Performer" },
        { from: 3, points: 15, label: "Developing" },
        { from: 1, points: 10, label: "Below Standard" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "hit", label: "HIT · hospital formulary listings", how: "New products approved by a hospital's PTC this quarter (not in the CRM yet)", weight: 15, unit: "count", better: "high",
      bands: [
        { from: 3, points: 15, label: "GetMeds Best" },
        { from: 2, points: 10, label: "High Performer" },
        { from: 1, points: 5, label: "Developing" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "ccf", label: "CCF · doctor coverage (gate)", how: "Doctors on my list visited at least once this month ÷ the doctors on my list; below 80% caps the total at 70", weight: 0, unit: "%", better: "high",
      bands: [], gate: { pass: 80, cap: 70 },
    },
  ],
};

// No playbook publishes the MD Telesales card ("the Telesales KPI framework" is still to come):
// until it is, telesales are scored on the B2C card, the nearest selling-by-phone card.
export const TELESALES: Recipe = { ...B2C, key: "telesales", label: "MD Telesales", source: "B2C CHC card, until the telesales card is published" };

// No playbook publishes the DSC's or the Mentor's card: until one is, a lead's score is the
// average of the cards of the people under them (their team's month, in one number).
export const TEAM: Recipe = {
  key: "team",
  label: "Team lead",
  source: "The team's average, until the DSC and Mentor cards are published",
  kpis: [
    {
      key: "team", label: "Team · average of the team's cards", how: "Each scored person under them, their month's score out of 100, averaged",
      weight: 100, unit: "%", better: "high", bands: [], direct: true,
    },
  ],
};

// ---- Interim cards (Aryan, 20 Nov: "a KPI card for every seller and every lead; the field's on
// interim weights, marked"; docs/PLAN.md 23, question 32). No playbook publishes these yet: the
// weights and bands below stand until HR or Aryan gives the real ones. Every card says "interim".

const INTERIM = "Interim, until HR publishes this card (PLAN 23)";

/** A percentage KPI's bands for its weight: 90% and up full, then 75, 60, 40. */
const pctBands = (weight: number): Band[] => [
  { from: 90, points: weight, label: "On target" },
  { from: 75, points: Math.round(weight * 0.8), label: "Near" },
  { from: 60, points: Math.round(weight * 0.6), label: "Developing" },
  { from: 40, points: Math.round(weight * 0.3), label: "Below" },
  { from: 0, points: 0, label: "Critical" },
];
/** Sales against target (IST): the playbooks' steps (91, 81, 71, 60) for any weight. */
const istBands = (weight: number): Band[] => [
  { from: 91, points: weight, label: "On target" },
  { from: 81, points: Math.round(weight * 0.8), label: "Near" },
  { from: 71, points: Math.round(weight * 0.6), label: "Developing" },
  { from: 60, points: Math.round(weight * 0.4), label: "Below" },
  { from: 0, points: 0, label: "Critical" },
];
/** A count KPI: `steps` are the counts for full, 80%, 60%, 30% of the weight. */
const countBands = (weight: number, steps: [number, number, number, number]): Band[] => [
  { from: steps[0], points: weight, label: "On target" },
  { from: steps[1], points: Math.round(weight * 0.8), label: "Near" },
  { from: steps[2], points: Math.round(weight * 0.6), label: "Developing" },
  { from: steps[3], points: Math.round(weight * 0.3), label: "Below" },
  { from: 0, points: 0, label: "Critical" },
];
const ist = (weight: number, how = "Invoiced this month ÷ the month's target"): KpiRecipe => ({
  key: "ist", label: "IST · sales vs target", how, weight, unit: "%", better: "high", bands: istBands(weight),
});
const dso = (weight: number): KpiRecipe => ({
  key: "dso", label: "DSO · days to collect", how: "Owed now on credit ÷ the last 90 days' credit sales × 90", weight, unit: "days", better: "low",
  bands: [
    { from: 70, points: weight, label: "Healthy" },
    { from: 89, points: Math.round(weight / 2), label: "Watch" },
    { from: Number.POSITIVE_INFINITY, points: 0, label: "Escalate to the coach" },
  ],
});
const nzsd = (weight: number): KpiRecipe => ({
  key: "nzsd", label: "NZSD · days with an invoice", how: "Working days with at least one invoice ÷ working days", weight, unit: "%", better: "high", bands: pctBands(weight),
});
const reorder = (weight: number, label: string, who: string): KpiRecipe => ({
  key: "crr", label, how: `${who} invoiced last month and this ÷ invoiced last month`, weight, unit: "%", better: "high", bands: pctBands(weight),
});
const ocr = (weight: number): KpiRecipe => ({
  key: "ocr", label: "OCR · orders cancelled", how: "Cancelled orders ÷ orders this month (lower is better)", weight, unit: "%", better: "low",
  bands: [
    { from: 0.99, points: weight, label: "Full" },
    { from: 4.99, points: Math.round(weight * 0.8), label: "High" },
    { from: 9.99, points: Math.round(weight * 0.5), label: "Developing" },
    { from: 14.99, points: Math.round(weight * 0.2), label: "Alert" },
    { from: Number.POSITIVE_INFINITY, points: 0, label: "Critical" },
  ],
});

/** The field's own card (SEFMED's day: calls, coverage, frequency, the tour plan, day reports),
 *  for every MedRep who works field days; their channel's card stays beside it. */
export const FIELD: Recipe = {
  key: "field",
  label: "Field work",
  source: INTERIM,
  kpis: [
    {
      key: "calls", label: "Calls a field day", how: "Calls closed ÷ field days (days with Start working)", weight: 30, unit: "count", better: "high",
      bands: countBands(30, [8, 6, 4, 2]),
    },
    {
      key: "coverage", label: "Coverage · classed customers seen", how: "Customers with a visit class (A–D) seen at least once this month ÷ all of them", weight: 25, unit: "%", better: "high",
      bands: pctBands(25),
    },
    {
      key: "frequency", label: "Frequency · seen as often as the class asks", how: "Classed customers seen A 4, B 2, C and D once this month ÷ all of them", weight: 20, unit: "%", better: "high",
      bands: pctBands(20),
    },
    {
      key: "tour", label: "Tour plan kept", how: "Planned visits up to today that were done ÷ planned visits up to today", weight: 15, unit: "%", better: "high",
      bands: pctBands(15),
    },
    {
      key: "reports", label: "Day reports sent", how: "Field days with the day report sent ÷ field days done", weight: 10, unit: "%", better: "high",
      bands: pctBands(10),
    },
  ],
};

export const NBD: Recipe = {
  key: "nbd",
  label: "B2B NBD",
  source: INTERIM,
  kpis: [
    ist(40),
    {
      key: "accounts", label: "New accounts with a first order", how: "Accounts I brought in whose first invoice is this month", weight: 30, unit: "count", better: "high",
      bands: countBands(30, [5, 3, 2, 1]),
    },
    nzsd(15),
    ocr(15),
  ],
};

export const CRR: Recipe = {
  key: "crr",
  label: "B2B CRR",
  source: INTERIM,
  kpis: [ist(40), reorder(30, "Accounts reordering", "Accounts"), dso(15), nzsd(15)],
};

export const CLIDP: Recipe = {
  key: "clidp",
  label: "CLIDP",
  source: INTERIM,
  kpis: [ist(50), dso(20), reorder(15, "Distributors reordering", "Distributors"), nzsd(15)],
};

export const MT: Recipe = {
  key: "mt",
  label: "Modern Trade",
  source: INTERIM,
  kpis: [ist(50), dso(20), reorder(15, "Chains reordering", "Chains"), nzsd(15)],
};

export const BIDDING: Recipe = {
  key: "bidding",
  label: "Government Bidding",
  source: INTERIM,
  kpis: [
    ist(40, "Awards invoiced this month ÷ the month's target"),
    {
      key: "win", label: "Win rate", how: "Tenders won ÷ tenders decided (won or lost) this month", weight: 30, unit: "%", better: "high",
      bands: [
        { from: 50, points: 30, label: "On target" },
        { from: 35, points: 24, label: "Near" },
        { from: 25, points: 18, label: "Developing" },
        { from: 10, points: 9, label: "Below" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    dso(15),
    nzsd(15),
  ],
};

export const PAP: Recipe = {
  key: "pap",
  label: "PAP",
  source: INTERIM,
  kpis: [
    {
      key: "pap", label: "Guarantee letters received", how: "Guarantee letters received this month on my PAP cases", weight: 40, unit: "count", better: "high",
      bands: countBands(40, [10, 6, 3, 1]),
    },
    ist(30),
    ocr(15),
    nzsd(15),
  ],
};

/** A lead's own card (a coach, mentor, manager or head): their team's cards and sales, and how
 *  they lead the field (day reports seen, days worked beside their people). */
export const LEAD: Recipe = {
  key: "lead",
  label: "Team lead",
  source: INTERIM,
  kpis: [
    {
      key: "team", label: "Team's cards", how: "The month's score of each scored person under them, averaged", weight: 40, unit: "%", better: "high",
      bands: [
        { from: 85, points: 40, label: "On target" },
        { from: 75, points: 32, label: "Near" },
        { from: 60, points: 24, label: "Developing" },
        { from: 40, points: 12, label: "Below" },
        { from: 0, points: 0, label: "Critical" },
      ],
    },
    {
      key: "teamist", label: "Team sales vs target", how: "The team's sales this month, as My KPIs counts them ÷ the team's targets (on the working-day pace)", weight: 30, unit: "%", better: "high",
      bands: istBands(30),
    },
    {
      key: "seen", label: "Day reports seen", how: "The team's day reports sent this month that the lead marked seen ÷ sent", weight: 15, unit: "%", better: "high",
      bands: pctBands(15),
    },
    {
      key: "joint", label: "Joint field work", how: "Days this month the lead worked beside one of their people (working with)", weight: 15, unit: "count", better: "high",
      bands: countBands(15, [4, 3, 2, 1]),
    },
  ],
};

export const RECIPES = {
  hospital: HOSPITAL,
  b2c: B2C,
  rx: RX,
  telesales: TELESALES,
  team: TEAM,
  lead: LEAD,
  field: FIELD,
  nbd: NBD,
  crr: CRR,
  clidp: CLIDP,
  mt: MT,
  bidding: BIDDING,
  pap: PAP,
};

export type KpiScore = {
  key: string;
  label: string;
  how: string;
  weight: number;
  unit: "%" | "days" | "count";
  /** The measured value, rounded to one decimal; null when there is nothing to measure yet. */
  value: number | null;
  points: number | null;
  band: string | null;
  /** The value that reaches the next band up, when there is one. */
  next: { value: number; points: number } | null;
};

/** The band a value falls in. */
export function bandOf(kpi: KpiRecipe, value: number): Band {
  const found = kpi.better === "high"
    ? kpi.bands.find((band) => value >= band.from)
    : kpi.bands.find((band) => value <= band.from);
  return found ?? (kpi.bands[kpi.bands.length - 1] as Band);
}

/** A month's scorecard from its measured values. */
export function scoreOf(
  recipe: Recipe,
  values: Record<string, number | null>,
): { kpis: KpiScore[]; total: number; max: number; capped: boolean } {
  const kpis = recipe.kpis.map((kpi): KpiScore => {
    const raw = values[kpi.key];
    if (raw === null || raw === undefined || !Number.isFinite(raw))
      return { key: kpi.key, label: kpi.label, how: kpi.how, weight: kpi.weight, unit: kpi.unit, value: null, points: null, band: null, next: null };
    const value = Math.round(raw * 10) / 10;
    if (kpi.gate) {
      const pass = value >= kpi.gate.pass;
      return {
        key: kpi.key, label: kpi.label, how: kpi.how, weight: 0, unit: kpi.unit, value, points: null,
        band: pass ? "Pass" : `Fail: capped at ${kpi.gate.cap}`, next: pass ? null : { value: kpi.gate.pass, points: 0 },
      };
    }
    if (kpi.direct) {
      const points = Math.max(0, Math.min(kpi.weight, Math.round(value)));
      return { key: kpi.key, label: kpi.label, how: kpi.how, weight: kpi.weight, unit: kpi.unit, value, points, band: incrementOf(points).label, next: null };
    }
    const band = bandOf(kpi, value);
    const at = kpi.bands.indexOf(band);
    const up = at > 0 ? kpi.bands[at - 1] : undefined;
    return {
      key: kpi.key, label: kpi.label, how: kpi.how, weight: kpi.weight, unit: kpi.unit, value,
      points: band.points, band: band.label,
      next: up && Number.isFinite(up.from) ? { value: up.from, points: up.points } : null,
    };
  });
  const measured = kpis.filter((kpi) => kpi.points !== null);
  let total = measured.reduce((sum, kpi) => sum + (kpi.points ?? 0), 0);
  const max = measured.reduce((sum, kpi) => sum + kpi.weight, 0);
  // The lowest cap that applies governs.
  const caps: number[] = [];
  const first = recipe.capOnZero && kpis.find((kpi) => kpi.key === recipe.capOnZero?.kpi);
  if (recipe.capOnZero && first?.points === 0) caps.push(recipe.capOnZero.total);
  for (const kpi of recipe.kpis)
    if (kpi.gate) {
      const value = kpis.find((one) => one.key === kpi.key)?.value;
      if (value !== null && value !== undefined && value < kpi.gate.pass) caps.push(kpi.gate.cap);
    }
  const cap = caps.length ? Math.min(...caps) : null;
  const capped = cap !== null && total > cap;
  if (capped) total = cap as number;
  return { kpis, total, max, capped };
}

/** The yearly increment band for a 12-month average score (the same in every playbook). */
export const INCREMENT_BANDS = [
  { from: 100, increment: 35, label: "GetMeds Best" },
  { from: 95, increment: 20, label: "Elite" },
  { from: 85, increment: 10, label: "High Performer" },
  { from: 75, increment: 6, label: "Developing" },
  { from: 60, increment: 3, label: "Below Standard" },
  { from: 0, increment: 0, label: "Critical" },
] as const;

export function incrementOf(average: number): (typeof INCREMENT_BANDS)[number] {
  return INCREMENT_BANDS.find((band) => Math.round(average) >= band.from) ?? INCREMENT_BANDS[5];
}
