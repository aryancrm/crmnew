// Leave credits HR adjusts (docs/HR-PLAN.md, step 3). A person's VL and SL for a year read as a
// ledger: the opening days by the rule (leave.ts LEAVE_DAYS), HR's adjustments (+ or -, half days
// allowed, each with a reason), the days used by approved leave. An adjustment is never changed or
// deleted: a wrong one is reversed by another line naming it. Every line goes into HR's trail. HR
// also names a person's second approver here (they decide that person's leave too). At year-end
// HR reads each person's unused VL and the half of it that converts to pay, at their day rate:
// a report only, the CRM doesn't pay it (PLAN 12.16 parks payroll extras).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean } from "../inventory/service";
import type { LeaveCredits, Me, VlConversion } from "../types";
import { hrEvent } from "./events";
import { balancesOf, classificationOf, creditLines, KIND_WORDS } from "./leave";
import { halfDaysOf, vlConversion } from "./leave-rules";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";

const yearOf = (asked: number | null | undefined) => {
  const now = Number(todayManila().slice(0, 4));
  return asked && asked > 2000 && asked < 2100 ? asked : now;
};
const daysWords = (days: number) => `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`;

async function personOf(db: Database, personId: number) {
  const [found] = await rows<{ id: number; name: string }>(
    db,
    sql`select p.id::int as id, p.name from person p join employee e on e.person_id = p.id
      where p.id = ${personId} and p.role <> 'admin'`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such person.");
  return found;
}

/** A person's credits for a year: the ledger and HR's lines (HR, the CEO, the Admin). */
export async function leaveCredits(
  db: Database,
  me: Me,
  personId: number,
  askedYear?: number | null,
): Promise<LeaveCredits> {
  allow(me, HR_ROLES, "read people's leave credits");
  const person = await personOf(db, personId);
  const year = yearOf(askedYear);
  const classification = await classificationOf(db, personId);
  const adjust = HR_WRITE_ROLES.includes(me.role) && !me.viewedBy;
  const [balances, lines, second, approvers] = await Promise.all([
    balancesOf(db, personId, year, classification),
    creditLines(db, personId, year),
    rows<{ id: number; name: string }>(
      db,
      sql`select s.id::int as id, s.name from employee e join person s on s.id = e.second_approver_id
        where e.person_id = ${personId}`,
    ),
    adjust
      ? rows<{ id: number; name: string }>(
          db,
          sql`select id::int as id, name from person where active and id <> ${personId}
            and role not in ('admin', 'ceo') order by name`,
        )
      : Promise.resolve([]),
  ]);
  return {
    personId,
    name: person.name,
    year,
    classification,
    vl: balances.vl,
    sl: balances.sl,
    lines,
    secondApprover: second[0] ?? null,
    can: { adjust },
    approvers,
  };
}

/** HR adds days to (or takes them off) a person's VL or SL for a year, with a reason. */
export async function addCredit(
  db: Database,
  me: Me,
  personId: number,
  input: { year?: number | null; kind: "vl" | "sl"; days: number; reason?: string | null },
): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "adjust leave credits");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (input.kind !== "vl" && input.kind !== "sl")
    throw new Refusal(400, "invalid", "Pick vacation or sick leave.", "kind");
  const halves = halfDaysOf(input.days);
  if (halves === null || Math.abs(halves) > 200)
    throw new Refusal(400, "invalid", "Type the days in half-day steps (0.5, 1, -2…), not 0.", "days");
  const reason = clean(input.reason);
  if (!reason) throw new Refusal(400, "invalid", "Say why the credits change.", "reason");
  const person = await personOf(db, personId);
  const year = yearOf(input.year);
  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into leave_credit (person_id, year, kind, half_days, reason, made_by)
        values (${person.id}, ${year}, ${input.kind}, ${halves}, ${reason}, ${me.id}) returning id::int as id`,
    );
    await hrEvent(
      tx,
      person.id,
      me.id,
      "leave",
      `${year} ${KIND_WORDS[input.kind]}: ${halves > 0 ? "+" : "-"}${daysWords(halves / 2)} (${reason})`,
    );
    return { id: made?.id as number };
  });
}

/** HR reverses an adjustment with a line of the opposite days naming it (once). */
export async function reverseCredit(
  db: Database,
  me: Me,
  creditId: number,
  input: { reason?: string | null },
): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "adjust leave credits");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const reason = clean(input.reason);
  if (!reason) throw new Refusal(400, "invalid", "Say why it is reversed.", "reason");
  return db.transaction(async (tx) => {
    const [line] = await rows<{
      personId: number;
      year: number;
      kind: "vl" | "sl";
      halves: number;
      reverses: number | null;
      reversed: boolean;
    }>(
      tx,
      sql`select person_id::int as "personId", year, kind, half_days::int as halves, reverses::int as reverses,
          exists (select 1 from leave_credit r where r.reverses = c.id) as reversed
        from leave_credit c where id = ${creditId} for update`,
    );
    if (!line) throw new Refusal(404, "not_found", "No such adjustment.");
    if (line.reverses !== null)
      throw new Refusal(409, "invalid", "That line is itself a reversal: add a new adjustment instead.");
    if (line.reversed) throw new Refusal(409, "invalid", "That adjustment is already reversed.");
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into leave_credit (person_id, year, kind, half_days, reason, reverses, made_by)
        values (${line.personId}, ${line.year}, ${line.kind}, ${-line.halves}, ${reason}, ${creditId}, ${me.id})
        returning id::int as id`,
    );
    await hrEvent(
      tx,
      line.personId,
      me.id,
      "leave",
      `${line.year} ${KIND_WORDS[line.kind]}: adjustment of ${line.halves > 0 ? "+" : "-"}${daysWords(line.halves / 2)} reversed (${reason})`,
    );
    return { id: made?.id as number };
  });
}

/** HR names (or takes off) a person's second approver: they decide the person's leave too. */
export async function setSecondApprover(
  db: Database,
  me: Me,
  personId: number,
  secondId: number | null,
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "name a second approver");
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  const person = await personOf(db, personId);
  let second: { id: number; name: string } | null = null;
  if (secondId !== null) {
    if (secondId === personId)
      throw new Refusal(400, "invalid", "A person doesn't approve their own leave.", "personId");
    second =
      (
        await rows<{ id: number; name: string }>(
          db,
          sql`select id::int as id, name from person where id = ${secondId} and active and role not in ('admin', 'ceo')`,
        )
      )[0] ?? null;
    if (!second) throw new Refusal(404, "not_found", "Pick someone at work.", "personId");
  }
  await db.transaction(async (tx) => {
    const [before] = await rows<{ name: string | null }>(
      tx,
      sql`select s.name from employee e left join person s on s.id = e.second_approver_id where e.person_id = ${person.id}`,
    );
    await tx.execute(
      sql`update employee set second_approver_id = ${second?.id ?? null} where person_id = ${person.id}`,
    );
    if ((before?.name ?? null) !== (second?.name ?? null))
      await hrEvent(tx, person.id, me.id, "record", "Second approver of leave changed", [
        {
          field: "secondApprover",
          label: "Second approver",
          from: before?.name ?? null,
          to: second?.name ?? null,
          hidden: false,
        },
      ]);
  });
}

/** Year-end: each person with vacation leave, the days unused and the half that converts to pay
 *  at their day rate (HR, the CEO, the Admin; a report, nothing is paid). */
export async function vlConversionReport(
  db: Database,
  me: Me,
  askedYear?: number | null,
): Promise<VlConversion> {
  allow(me, HR_ROLES, "read the year-end leave report");
  if (me.viewedBy && me.viewedBy.role !== "ceo" && me.viewedBy.role !== "admin")
    throw new Refusal(403, "private", "Pay is private: looking as someone doesn't open it.");
  const year = yearOf(askedYear);
  const people = await rows<{
    personId: number;
    name: string;
    classification: LeaveCredits["classification"];
    salary: number | null;
  }>(
    db,
    sql`select p.id::int as "personId", p.name, e.classification, e.salary::int as salary
      from employee e join person p on p.id = e.person_id
      where p.role <> 'admin' and (p.active or extract(year from e.left_on) = ${year})
        and (e.classification = 'regular'
          or exists (select 1 from leave_credit c where c.person_id = p.id and c.year = ${year} and c.kind = 'vl'))
      order by p.name`,
  );
  const out: VlConversion["people"] = [];
  for (const one of people) {
    const { vl } = await balancesOf(db, one.personId, year, one.classification);
    if (!vl.allotted) continue;
    const unused = Math.max(0, vl.allotted - vl.used);
    const converted = vlConversion(unused, one.salary);
    out.push({
      personId: one.personId,
      name: one.name,
      total: vl.allotted,
      used: vl.used,
      unused,
      convertDays: converted.days,
      perDay: converted.perDay,
      amount: converted.amount,
    });
  }
  return {
    year,
    people: out,
    totals: {
      convertDays: out.reduce((sum, one) => sum + one.convertDays, 0),
      amount: out.reduce((sum, one) => sum + (one.amount ?? 0), 0),
    },
  };
}
