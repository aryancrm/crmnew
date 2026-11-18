// The company's monthly target sheet in one click (Aryan, 18 Nov 2026): every row of the month's
// sheet — head, channel, manager, salesperson, Zoho name, HQ, target — with what it achieved this
// month to the day picked, the balance to do, that day's invoicing and the percentage. Achieved
// is read from the invoices the way Sales performance reads them (VAT out, Zoho's "Item Total";
// this ERP's own invoices too): a Zoho invoice belongs to the row whose Zoho name it carries, one
// of this ERP's to the row of the seat that sold it. What sold under no row of the sheet is shown
// apart, so the total adds up to every sale.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Me, Role, TargetSheet } from "../types";
import { linesSql } from "./performance";

export const SHEET_ROLES: Role[] = ["ceo", "admin", "management", "finance"];

/** A Zoho salesperson name made comparable: case, spaces, "I" written for "|", "/" spacing. */
export const sheetName = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+i\s+/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");

export async function targetSheet(db: Database, me: Me, asked: { month?: string | null; day?: string | null }): Promise<TargetSheet> {
  allow(me, SHEET_ROLES, "see the target sheet");
  const today = todayManila();
  const months = (await rows<{ month: string }>(db, sql`select distinct to_char(month, 'YYYY-MM') as month from target_sheet_row order by 1 desc`)).map(
    (row) => row.month,
  );
  const month = asked.month && /^\d{4}-\d{2}$/.test(asked.month) ? asked.month : (months.find((one) => one <= today.slice(0, 7)) ?? today.slice(0, 7));
  const first = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const day = asked.day && /^\d{4}-\d{2}-\d{2}$/.test(asked.day) ? asked.day : today < last ? today : last;
  if (day < first || day > last) throw new Refusal(400, "invalid", "Pick a day of that month.", "day");

  const sheet = await rows<{
    id: number;
    head: string;
    channel: string;
    manager: string;
    salesperson: string;
    zoho: string[];
    hq: string | null;
    target: number;
    seatId: number | null;
    holder: string | null;
  }>(
    db,
    sql`select r.id::int as id, r.head, r.channel, r.manager, r.salesperson, r.zoho_names as zoho, r.hq, r.target::bigint::float8 as target,
        r.seat_id::int as "seatId",
        (select p.name from seat_holder h join person p on p.id = h.person_id where h.seat_id = r.seat_id and h.kind = 'holder' and h.ends_on is null limit 1) as holder
      from target_sheet_row r where r.month = ${first}::date order by r.sort`,
  );
  const lines = await rows<{ day: string; amount: number; zohoName: string | null; seatId: number | null }>(
    db,
    sql`select to_char(x.day, 'YYYY-MM-DD') as day, x.amount::float8 as amount, x.zoho_name as "zohoName", x.seat_id::int as "seatId"
      from (${linesSql(first, day)}) x`,
  );
  const byName = new Map<string, number>();
  const bySeat = new Map<number, number>();
  for (const [at, row] of sheet.entries()) {
    for (const name of row.zoho) if (!byName.has(sheetName(name))) byName.set(sheetName(name), at);
    if (row.seatId && !bySeat.has(row.seatId)) bySeat.set(row.seatId, at);
  }
  const ach = sheet.map(() => 0);
  const onDay = sheet.map(() => 0);
  const apart = new Map<string, { ach: number; today: number }>();
  for (const line of lines) {
    const at = (line.zohoName ? byName.get(sheetName(line.zohoName)) : undefined) ?? (line.seatId ? bySeat.get(line.seatId) : undefined);
    if (at !== undefined) {
      ach[at] = (ach[at] ?? 0) + line.amount;
      if (line.day === day) onDay[at] = (onDay[at] ?? 0) + line.amount;
    } else {
      const key = line.zohoName ?? "This ERP's orders not on the sheet";
      const now = apart.get(key) ?? { ach: 0, today: 0 };
      now.ach += line.amount;
      if (line.day === day) now.today += line.amount;
      apart.set(key, now);
    }
  }
  return {
    month,
    months: months.length ? months : [month],
    day,
    rows: sheet.map((row, at) => ({
      id: row.id,
      head: row.head,
      channel: row.channel,
      manager: row.manager,
      salesperson: row.salesperson,
      zoho: row.zoho[0] ?? "",
      hq: row.hq,
      holder: row.holder,
      target: row.target,
      ach: ach[at] ?? 0,
      today: onDay[at] ?? 0,
    })),
    apart: [...apart]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.ach - a.ach),
  };
}
