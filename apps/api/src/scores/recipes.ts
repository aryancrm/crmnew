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
  unit: "%" | "days";
  better: "high" | "low";
  /** Best band first. */
  bands: Band[];
};
export type Recipe = {
  key: "hospital" | "b2c";
  label: string;
  /** From the playbook named. */
  source: string;
  kpis: KpiRecipe[];
  /** A month whose first KPI scores 0 cannot total more than this. */
  capOnZero: { kpi: string; total: number };
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

export const RECIPES = { hospital: HOSPITAL, b2c: B2C };

export type KpiScore = {
  key: string;
  label: string;
  how: string;
  weight: number;
  unit: "%" | "days";
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
  const first = kpis.find((kpi) => kpi.key === recipe.capOnZero.kpi);
  const capped = first?.points === 0 && total > recipe.capOnZero.total;
  if (capped) total = recipe.capOnZero.total;
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
