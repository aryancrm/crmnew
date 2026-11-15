// What a purchase costs to land, worked out the same way by the API and by the form (which
// shows it while typing). No imports: this file is shared with the web app.

export const COST_KINDS = [
  { key: "freight", label: "Air or sea freight" },
  { key: "packaging", label: "Packaging" },
  { key: "customs", label: "Customs and duties" },
  { key: "insurance", label: "Insurance" },
  { key: "transport", label: "Local transport" },
  { key: "other", label: "Other" },
] as const;

export type CostKind = (typeof COST_KINDS)[number]["key"];

export type LandedLine = {
  /** What the goods cost, in centavos: pieces x price in the supplier's currency x the rate. */
  goods: number;
  /** This line's share of the other costs, in centavos. */
  extras: number;
  /** What one piece cost to land, in centavos. */
  landedUnit: number;
};

/**
 * Shares the other costs (freight, packaging, customs…) between the lines by the value of
 * their goods, to the centavo: the shares always add up to exactly `extras`. A line that
 * costs more carries more of the flight. With no goods value at all, they are shared by pieces.
 */
export function landedCosts(
  lines: { qty: number; unitCost: number }[],
  fxRate: number,
  extras: number,
): LandedLine[] {
  const goods = lines.map((line) => Math.round(line.qty * line.unitCost * fxRate * 100));
  const weights = goods.some((value) => value > 0) ? goods : lines.map((line) => line.qty);
  const total = weights.reduce((sum, value) => sum + value, 0);

  const shares = weights.map((weight) => (total > 0 ? Math.floor((extras * weight) / total) : 0));
  let left = total > 0 ? extras - shares.reduce((sum, value) => sum + value, 0) : 0;
  // The centavos lost to rounding go to the lines with the largest remainders, biggest first.
  const order = weights
    .map((weight, index) => ({ index, remainder: total > 0 ? (extras * weight) % total : 0 }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    left -= 1;
  }

  return lines.map((line, index) => {
    const lineGoods = goods[index] ?? 0;
    const lineExtras = shares[index] ?? 0;
    return {
      goods: lineGoods,
      extras: lineExtras,
      landedUnit: line.qty > 0 ? Math.round((lineGoods + lineExtras) / line.qty) : 0,
    };
  });
}
