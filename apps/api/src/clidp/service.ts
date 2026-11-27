// CLIDP (docs/PLAN.md 16.5): the CLIDP Sales Coach sells in bulk to distributors that list our
// medicines under their own brand (a Certificate of Listing of Identical Drug Product). Their day:
// volume against target on the month's pace, money owed (big balances), accounts due to reorder or
// late against their own gap, and listings coming to the end of their validity. The Sales and
// Marketing Mentor sees each CLIDP coach the same way.

import { sql } from "drizzle-orm";
import { accountsOf, b2bRole, seatAreas } from "../b2b/service";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { DEFAULT_SCHEDULE, isWorkDay } from "../hr/work-time";
import { daysBetween, holidaysIn } from "../scores/service";
import { collections } from "../sellers/service";
import { teamSeats } from "../team/service";
import type { ClidpDay, ClidpTeam, Me } from "../types";

const SOON_DAYS = 60;

/** A coach's volume this month against their target on the working-day pace: what their seats
 *  invoiced (this CRM's invoices and Zoho's, as the team board counts them), the target set for
 *  them (or their seat's), and where that sold amount lands by the month's end at today's pace. */
export async function volumeOf(
  db: Database,
  personId: number,
  today: string,
): Promise<{ sold: number; target: number | null; pace: number | null; note: string }> {
  const first = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number) as [number, number];
  const last = `${today.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const [row] = await rows<{ sold: number; target: number | null }>(
    db,
    sql`with mine as (select h.seat_id from seat_holder h where h.person_id = ${personId} and h.kind = 'holder' and ${inForce("h", today)})
      select coalesce((select sum(i.total) from sale_invoice i where i.seat_id in (select seat_id from mine)
          and i.status <> 'cancelled' and i.issued_on between ${first}::date and ${today}::date), 0)::float8 as sold,
        coalesce((select t.amount from sales_target t where t.person_id = ${personId} and t.month = ${first}::date),
          (select sum(t.amount) from seat_target t where t.month = ${first}::date and t.seat_id in (select seat_id from mine)))::float8 as target`,
  );
  const holidays = await holidaysIn(db, first, last);
  const workDay = (day: string) => isWorkDay(day, DEFAULT_SCHEDULE, holidays);
  const worked = daysBetween(first, today).filter(workDay).length;
  const inMonth = daysBetween(first, last).filter(workDay).length;
  const sold = row?.sold ?? 0;
  const target = row?.target ?? null;
  const onPace = worked > 0 ? (sold * inMonth) / worked : sold;
  const peso = (centavos: number) => `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;
  return {
    sold,
    target,
    pace: target && target > 0 ? Math.round((onPace / target) * 100) : null,
    note: target
      ? `${peso(sold)} of ${peso(target)}, ${peso(onPace)} on the pace of ${worked} of ${inMonth} working days`
      : "No target for this month",
  };
}

async function listingsOf(db: Database, customerIds: number[], today: string): Promise<ClidpDay["listings"]> {
  if (!customerIds.length) return [];
  const found = await rows<Omit<ClidpDay["listings"][number], "state">>(
    db,
    sql`select l.id::int as id, l.customer_id::int as "customerId", c.name as customer, m.name || coalesce(' ' || m.strength, '') as medicine,
        l.brand, l.certificate_no as "certificateNo", to_char(l.valid_until, 'YYYY-MM-DD') as "validUntil",
        (l.valid_until - ${today}::date)::int as "daysLeft"
      from clidp_listing l join customer c on c.id = l.customer_id join medicine m on m.id = l.medicine_id
      where l.customer_id in (${sql.join(customerIds.map((id) => sql`${id}`), sql`, `)})
        -- The latest line for each account's brand of each medicine (a renewal replaces the old).
        and not exists (select 1 from clidp_listing n where n.customer_id = l.customer_id and n.medicine_id = l.medicine_id and n.id > l.id)
      order by l.valid_until nulls last, c.name`,
  );
  return found.map((one) => ({
    ...one,
    state: one.daysLeft === null ? "no date" : one.daysLeft < 0 ? "expired" : one.daysLeft <= SOON_DAYS ? "expiring" : "valid",
  }));
}

export async function clidpDay(db: Database, me: Me): Promise<ClidpDay> {
  if (b2bRole(me) !== "clidp") throw new Refusal(403, "not_allowed", "This is the CLIDP Sales Coach's desk.");
  const today = todayManila();
  const [accounts, volume, owed] = await Promise.all([
    seatAreas(db, me.id, today).then((areas) => accountsOf(db, [me.id], areas, today)),
    volumeOf(db, me.id, today),
    // Every owing account, so the biggest are found among them all (PLAN 267).
    collections(db, me, { all: true }),
  ]);
  const listings = await listingsOf(db, accounts.map((one) => one.customerId), today);
  return {
    today,
    volume: { pace: volume.pace, note: volume.note },
    accounts,
    owed: { total: owed.total, rows: [...owed.rows].sort((a, b) => b.owed - a.owed).slice(0, 8) },
    listings,
  };
}

export async function addListing(
  db: Database,
  me: Me,
  input: { customerId: number; medicineId: number; brand: string; certificateNo?: string | null; validUntil?: string | null },
): Promise<void> {
  if (b2bRole(me) !== "clidp") throw new Refusal(403, "not_allowed", "The CLIDP Sales Coach keeps the listings.");
  const [customer] = await rows<{ kind: string }>(db, sql`select kind from customer where id = ${input.customerId} and active`);
  if (!customer || !["distributor", "drugstore"].includes(customer.kind))
    throw new Refusal(400, "invalid", "A listing belongs to a distributor (or a drugstore chain).", "customerId");
  await db.execute(
    sql`insert into clidp_listing (customer_id, medicine_id, brand, certificate_no, valid_until, added_by)
      values (${input.customerId}, ${input.medicineId}, ${input.brand.trim()}, ${input.certificateNo?.trim() || null}, ${input.validUntil || null}::date, ${me.id})`,
  );
}

/** The Mentor's (or any lead's) CLIDP coaches: volume on pace, owed, late accounts, listings. */
export async function clidpTeam(db: Database, me: Me): Promise<ClidpTeam> {
  if (!["team_lead", "manager", "ceo", "admin"].includes(me.role)) throw new Refusal(403, "not_allowed", "The CLIDP view is the heads'.");
  const today = todayManila();
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  const people = seatIds.length
    ? await rows<{ personId: number; name: string; title: string | null; areaId: number | null }>(
        db,
        sql`select distinct on (h.person_id) h.person_id::int as "personId", p.name, s.title, s.area_id::int as "areaId"
          from seat s join seat_holder h on h.seat_id = s.id and ${inForce("h", today)} join person p on p.id = h.person_id
          where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)}) and s.module = 'medrep' and s.title ilike '%clidp%'
          order by h.person_id, (h.kind = 'holder') desc`,
      )
    : [];
  const rowsOut = await Promise.all(
    people.map(async (one) => {
      const accounts = await accountsOf(db, [one.personId], one.areaId ? [one.areaId] : [], today);
      const customerIds = accounts.map((a) => a.customerId);
      const [volume, [owed]] = await Promise.all([
        volumeOf(db, one.personId, today),
        // What their accounts owe: this CRM's open invoices and Zoho's still open.
        rows<{ total: number }>(
          db,
          sql`select coalesce(sum(amount), 0)::float8 as total from (
              select (i.total - i.paid) as amount from invoice i
                where i.status = 'open' and i.total > i.paid and i.customer_id in (${customerIds.length ? sql.join(customerIds.map((id) => sql`${id}`), sql`, `) : sql`0`})
              union all
              select round(d.balance * d.fx_rate) from book_doc d
                where d.kind = 'invoice' and d.zoho_id is not null and d.balance > 0 and d.status not in ('void', 'draft')
                  and d.customer_id in (${customerIds.length ? sql.join(customerIds.map((id) => sql`${id}`), sql`, `) : sql`0`})) x`,
        ),
      ]);
      const listings = await listingsOf(db, accounts.map((a) => a.customerId), today);
      return {
        personId: one.personId,
        name: one.name,
        pace: volume.pace,
        owed: owed?.total ?? 0,
        accounts: accounts.filter((a) => a.state !== "lost").length,
        late: accounts.filter((a) => a.state === "late" || a.state === "stopped").length,
        listingsExpiring: listings.filter((l) => l.state === "expiring" || l.state === "expired").length,
      };
    }),
  );
  return { today, rows: rowsOut, soon: addDays(today, SOON_DAYS) };
}
