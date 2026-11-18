// The daily sales performance as the team's Excel file: one sheet per table, laid out as theirs
// (VALUES, TLB, BILLING EFFICIENCY, the sales calls by day, the channels ranked with their share,
// and the daily sales by salesperson and by channel), Grand Total in red.

import type { SalesPerformance } from "../types";
import { type Cell, type Sheet, workbook } from "../reports/xlsx";

const peso = (centavos: number | null) => (centavos === null ? null : Math.round(centavos / 100));
const ratio = (pct: number | null) => (pct === null ? null : pct / 100);
const shortDay = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
};

export function performanceWorkbook(report: SalesPerformance): Buffer {
  const weekHeads = report.weeks.map((w) => ({ v: w.label, s: "head" as const }));
  const title = (text: string, width: number): { row: Cell[]; merge: string } => ({
    row: [{ v: text, s: "title" }, ...Array.from({ length: width - 1 }, () => ({ v: "", s: "title" as const }))],
    merge: `A1:${String.fromCharCode(64 + width)}1`,
  });
  const period = `${report.from === report.to ? report.from : `${report.from} to ${report.to}`}`;

  // VALUES
  const valueWidth = 6 + report.weeks.length;
  const values = title(`VALUES · ${period}`, valueWidth);
  const valuesSheet: Sheet = {
    name: "Values",
    merges: [values.merge],
    widths: [30, 14, 14, ...report.weeks.map(() => 13), 14, 10, 14],
    rows: [
      values.row,
      ["SALES PERSON", "TARGET", "110%", ...report.weeks.map((w) => w.label), "TOTAL ACH", "%AGE", "BTD"].map((v) => ({ v, s: "head" as const })),
      ...report.revenue.rows.map((r): Cell[] => [
        { v: `${r.channel} | ${r.name}`, s: "name" },
        { v: peso(r.target), s: "money" },
        { v: peso(r.target110), s: "money" },
        ...r.weeks.map((w) => ({ v: peso(w), s: "money" as const })),
        { v: peso(r.total), s: "money" },
        { v: ratio(r.pct), s: "pct" },
        { v: peso(r.btd), s: "money" },
      ]),
      [
        { v: "Grand Total", s: "totalName" },
        { v: peso(report.revenue.total.target), s: "totalMoney" },
        { v: peso(report.revenue.total.target110), s: "totalMoney" },
        ...report.revenue.total.weeks.map((w) => ({ v: peso(w), s: "totalMoney" as const })),
        { v: peso(report.revenue.total.total), s: "totalMoney" },
        { v: ratio(report.revenue.total.pct), s: "totalPct" },
        { v: peso(report.revenue.total.btd), s: "totalMoney" },
      ],
    ],
  };

  const countSheet = (name: string, heading: string, part: SalesPerformance["tlb"]): Sheet => {
    const head = title(`${heading} · ${period}`, 4 + report.weeks.length);
    return {
      name,
      merges: [head.merge],
      widths: [30, 10, ...report.weeks.map(() => 8), 12, 10],
      rows: [
        head.row,
        [{ v: "SALES PERSON", s: "head" }, { v: "TARGET", s: "head" }, ...weekHeads, { v: "TOTAL ACH", s: "head" }, { v: "%AGE", s: "head" }],
        ...part.rows.map((r): Cell[] => [
          { v: `${r.channel} | ${r.name}`, s: "name" },
          { v: r.target, s: "int" },
          ...r.weeks.map((w) => ({ v: w, s: "int" as const })),
          { v: r.total, s: "int" },
          { v: ratio(r.pct), s: "pct" },
        ]),
        [
          { v: "Grand Total", s: "totalName" },
          { v: part.total.target, s: "totalInt" },
          ...part.total.weeks.map((w) => ({ v: w, s: "totalInt" as const })),
          { v: part.total.total, s: "totalInt" },
          { v: ratio(part.total.pct), s: "totalPct" },
        ],
      ],
    };
  };

  // Calls by day (by week when the days are many).
  const byDay = report.days.length > 0;
  const callCols = byDay ? report.days.map((d) => shortDay(d)) : report.weeks.map((w) => w.label);
  const callsSheet: Sheet = {
    name: "Sales Calls",
    widths: [30, ...callCols.map(() => 11), 12],
    rows: [
      [{ v: "Row Labels", s: "head" }, ...callCols.map((v) => ({ v, s: "head" as const })), { v: "Grand Total", s: "head" }],
      ...report.calls.rows.map((r): Cell[] => [{ v: r.name, s: "name" }, ...(byDay ? r.days : r.weeks).map((n) => ({ v: n || null, s: "int" as const })), { v: r.total, s: "int" }]),
      [
        { v: "Grand Total", s: "totalName" },
        ...(byDay ? report.calls.total.days : report.calls.total.weeks).map((n) => ({ v: n, s: "totalInt" as const })),
        { v: report.calls.total.total, s: "totalInt" },
      ],
    ],
  };

  const channelsSheet: Sheet = {
    name: "Channels",
    widths: [16, 8, ...report.weeks.map(() => 14), 15, 10],
    rows: [
      ["Channel", "Rank", ...report.weeks.map((w) => w.label), "Grand Total", "CONT"].map((v) => ({ v, s: "head" as const })),
      ...report.channels.rows.map((r): Cell[] => [
        { v: r.channel, s: "name" },
        { v: r.rank, s: "int" },
        ...r.weeks.map((w) => ({ v: peso(w) || null, s: "money" as const })),
        { v: peso(r.total), s: "money" },
        { v: r.share / 100, s: "pct" },
      ]),
      [
        { v: "Grand Total", s: "totalName" },
        { v: "", s: "totalName" },
        ...report.channels.total.weeks.map((w) => ({ v: peso(w), s: "totalMoney" as const })),
        { v: peso(report.channels.total.total), s: "totalMoney" },
        { v: 1, s: "totalPct" },
      ],
    ],
  };

  const dailyCols = byDay ? report.days.map(shortDay) : [];
  const dailyPeople: Sheet = {
    name: "Daily by CHC",
    widths: [34, ...dailyCols.map(() => 12), 14],
    rows: [
      [{ v: "Sum of Item Total", s: "head" }],
      [{ v: "Row Labels", s: "head" }, ...dailyCols.map((v) => ({ v, s: "head" as const })), { v: "Grand Total", s: "head" }],
      ...report.daily.people.map((r): Cell[] => [{ v: `${r.channel} | ${r.name}`, s: "name" }, ...r.days.map((n) => ({ v: peso(n) || null, s: "money" as const })), { v: peso(r.total), s: "money" }]),
      [
        { v: "Grand Total", s: "totalName" },
        ...dailyCols.map((_, at) => ({ v: peso(report.daily.people.reduce((s, r) => s + (r.days[at] ?? 0), 0)), s: "totalMoney" as const })),
        { v: peso(report.daily.people.reduce((s, r) => s + r.total, 0)), s: "totalMoney" },
      ],
    ],
  };
  const dailyChannels: Sheet = {
    name: "Daily by Channel",
    widths: [16, ...dailyCols.map(() => 12), 14],
    rows: [
      [{ v: "Sum of Item Total", s: "head" }],
      [{ v: "Row Labels", s: "head" }, ...dailyCols.map((v) => ({ v, s: "head" as const })), { v: "Grand Total", s: "head" }],
      ...report.channels.rows.map((r): Cell[] => [{ v: r.channel, s: "name" }, ...r.days.map((n) => ({ v: peso(n) || null, s: "money" as const })), { v: peso(r.total), s: "money" }]),
      [
        { v: "Grand Total", s: "totalName" },
        ...report.channels.total.days.map((n) => ({ v: peso(n), s: "totalMoney" as const })),
        { v: peso(report.channels.total.total), s: "totalMoney" },
      ],
    ],
  };

  return workbook([
    valuesSheet,
    countSheet("TLB", "TLB", report.tlb),
    countSheet("Billing Efficiency", "BILLING EFFICIENCY", report.billing),
    callsSheet,
    channelsSheet,
    dailyPeople,
    dailyChannels,
  ]);
}
