// Recurring expenses and bills (docs/BOOKS-PLAN.md B8), as Zoho Books runs them: a profile (rent,
// a utility) every n days, weeks, months or years from its start day to its end day makes the
// expense or bill on each day it falls due.
//
// No document twice: Zoho keeps making a profile's documents until Finance takes the profile over
// here from a day ("CRM From", the day Zoho's profile is stopped); before that day the documents
// come over with Zoho's history. Each document made here is linked to its profile with the day it
// stands for, and a day already linked is never made again, however often this runs.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import type { Me } from "../types";
import { LEDGER_ROLES } from "./accounts";
import { day, link } from "./actions";
import { assertOpen } from "./write";

type Profile = {
  id: number;
  kind: "recurring_expense" | "recurring_bill";
  name: string;
  start: string;
  end: string | null;
  status: string;
  supplierId: number | null;
  party: string | null;
  total: number;
  fields: Record<string, string>;
};

const STEP: Record<string, string> = { days: "day", weeks: "week", months: "month", years: "year" };

/** The days a profile falls due from its start, up to (and including) a day. */
export function dueDays(start: string, every: number, frequency: string, until: string): string[] {
  const unit = STEP[frequency.toLowerCase()] ?? "month";
  const out: string[] = [];
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  for (let n = 0; n < 2000; n++) {
    const at = new Date(Date.UTC(y, m - 1, d));
    if (unit === "day") at.setUTCDate(d + n * every);
    else if (unit === "week") at.setUTCDate(d + 7 * n * every);
    else if (unit === "month") {
      // The 31st of a shorter month falls on its last day, as Zoho does.
      const month = new Date(Date.UTC(y, m - 1 + n * every, 1));
      const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
      at.setTime(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(d, last)));
    } else at.setUTCFullYear(y + n * every);
    const iso = at.toISOString().slice(0, 10);
    if (iso > until) break;
    out.push(iso);
  }
  return out;
}

async function profiles(db: Database, id?: number): Promise<Profile[]> {
  return rows<Profile>(
    db,
    sql`select id::int as id, kind, number as name, to_char(doc_date, 'YYYY-MM-DD') as start, to_char(due_date, 'YYYY-MM-DD') as "end",
        lower(status) as status, supplier_id::int as "supplierId", party_name as party, total::bigint::float8 as total, fields
      from book_doc where kind in ('recurring_expense', 'recurring_bill') and voided_at is null ${id ? sql`and id = ${id}` : sql``}
      order by id`,
  );
}

/** Makes one document for a profile's day: an expense paid through the profile's account, or a bill
 *  owed to its vendor, with the profile's lines and Zoho's fields. */
async function makeFor(db: Database, profile: Profile, on: string, by: number | null): Promise<number> {
  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(tx, sql`select from_doc::int as id from book_link where to_doc = ${profile.id} and on_date = ${on}::date limit 1`);
    if (made) return made.id;
    await assertOpen(tx, profile.kind === "recurring_expense" ? "expense" : "bill", on);
    const f = profile.fields;
    const keep = Object.fromEntries(Object.entries(f).filter(([key]) => key.startsWith("CF.")));
    const expense = profile.kind === "recurring_expense";
    const kind = expense ? "expense" : "bill";
    let number: string;
    if (expense) {
      const [last] = await rows<{ n: number | null }>(tx, sql`select max(substring(number from '^EXP-(\\d+)$')::bigint)::float8 as n from book_doc where kind = 'expense' and number ~ '^EXP-\\d+$'`);
      number = `EXP-${(last?.n ?? 0) + 1}`;
    } else number = `${profile.name} ${on.slice(0, 7)}`;
    const fields: Record<string, unknown> = expense
      ? { ...keep, "Paid Through": f["Paid Through"], "Is Inclusive Tax": f["Is Inclusive Tax"] ?? "false", "Expense Account": f["Expense Account"], "Entry Number": number.slice(4), "Recurring Profile": profile.name }
      : { ...keep, "Accounts Payable": f["Accounts Payable"] || "Accounts Payable", "Recurring Profile": profile.name };
    const [doc] = await rows<{ id: number }>(
      tx,
      sql`insert into book_doc (kind, number, reference, doc_date, due_date, status, supplier_id, party_name, total, balance, notes, fields, created_by)
        values (${kind}, ${number}, ${profile.name}, ${on}::date, ${on}::date, ${expense ? "nonbillable" : "open"}, ${profile.supplierId}, ${profile.party},
          ${profile.total}, ${expense ? 0 : profile.total}, ${`From recurring ${expense ? "expense" : "bill"} ${profile.name}`}, ${JSON.stringify(fields)}::jsonb, ${by})
        returning id::int as id`,
    );
    const id = doc?.id as number;
    await tx.execute(
      sql`insert into book_line (doc_id, n, item_name, description, account, qty, rate, tax_name, tax_pct, tax_amount, amount, fields)
        select ${id}, n, coalesce(item_name, account), description, account, qty, rate, tax_name, tax_pct, tax_amount, amount, '{}'::jsonb
        from book_line where doc_id = ${profile.id}`,
    );
    await link(tx, id, profile.id, null, on);
    return id;
  });
}

/** Every taken-over, active profile's documents due up to today. Run each day (automations). */
export async function makeDueRecurring(db: Database, today = todayManila()): Promise<number> {
  let made = 0;
  for (const profile of await profiles(db)) {
    const from = profile.fields["CRM From"];
    if (!from || profile.status !== "active") continue;
    const until = profile.end && profile.end < today ? profile.end : today;
    const every = Number(profile.fields["Repeat Every"]) || 1;
    for (const on of dueDays(profile.start, every, profile.fields["Recurrence Frequency"] ?? "Months", until)) {
      if (on < from) continue;
      const [already] = await rows<{ n: number }>(db, sql`select count(*)::int as n from book_link where to_doc = ${profile.id} and on_date = ${on}::date`);
      if (already?.n) continue;
      try {
        await makeFor(db, profile, on, null);
        made += 1;
      } catch (error) {
        // A locked period: leave it for Finance to see on the profile.
        if (!(error instanceof Refusal)) throw error;
      }
    }
  }
  return made;
}

/** Finance takes a profile over from Zoho: from this day its documents are made here (stop the
 *  profile in Zoho on the same day). */
export async function takeOverRecurring(db: Database, me: Me, id: number, input: { from: string }): Promise<{ made: number }> {
  allow(me, LEDGER_ROLES, "run a recurring profile");
  const from = day(input.from, "from") as string;
  const [profile] = await profiles(db, id);
  if (!profile) throw new Refusal(404, "not_found", "That recurring profile is not in the books.");
  if (profile.status !== "active") throw new Refusal(409, "not_active", `${profile.name} is ${profile.status}.`);
  await db.execute(sql`update book_doc set fields = fields || jsonb_build_object('CRM From', ${from}::text) where id = ${id}`);
  return { made: await makeDueRecurring(db) };
}

/** Stops (or starts again) a profile; what it made stays. */
export async function setRecurringStatus(db: Database, me: Me, id: number, input: { active: boolean }): Promise<void> {
  allow(me, LEDGER_ROLES, "stop a recurring profile");
  const [profile] = await profiles(db, id);
  if (!profile) throw new Refusal(404, "not_found", "That recurring profile is not in the books.");
  await db.execute(sql`update book_doc set status = ${input.active ? "Active" : "Stopped"} where id = ${id}`);
}

/** The documents a profile made here, newest first. */
export async function recurringMade(db: Database, me: Me, id: number): Promise<{ id: number; number: string; date: string; total: number; status: string }[]> {
  allow(me, LEDGER_ROLES, "see a recurring profile");
  return rows(
    db,
    sql`select d.id::int as id, d.number, to_char(k.on_date, 'YYYY-MM-DD') as date, d.total::bigint::float8 as total, d.status
      from book_link k join book_doc d on d.id = k.from_doc where k.to_doc = ${id} order by k.on_date desc`,
  );
}
