// An Rx CHC's day (Rx CHC Play Book): their 80 doctors in tiers with the month's visits done
// against due (Tier 1 four, Tier 2 two, Tier 3 one), each doctor's light for today's route (red:
// a refill due within 48 hours or late against their usual gap; yellow: bought last month, not
// yet this month; green: the rest), the doctors in their area not on the list yet, and their PAP
// applications (pending, approved this month). The list is the seat's.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import type { Me, RxDay } from "../types";

export const TIER_SIZE: Record<1 | 2 | 3, number> = { 1: 20, 2: 40, 3: 20 };
export const TIER_VISITS: Record<1 | 2 | 3, number> = { 1: 4, 2: 2, 3: 1 };

async function mySeat(db: Database, me: Me, today: string): Promise<{ id: number; areaId: number | null } | null> {
  const [seat] = await rows<{ id: number; areaId: number | null }>(
    db,
    sql`select s.id::int as id, s.area_id::int as "areaId" from seat_holder h join seat s on s.id = h.seat_id
      where h.person_id = ${me.id} and ${inForce("h", today)} and not s.lead order by (h.kind = 'holder') desc, h.starts_on desc limit 1`,
  );
  return seat ?? null;
}

export async function rxDay(db: Database, me: Me): Promise<RxDay> {
  if (me.role !== "medrep" || me.channel?.code !== "RX") throw new Refusal(403, "not_allowed", "My doctors is the Rx CHC's list.");
  const today = todayManila();
  const first = `${today.slice(0, 7)}-01`;
  const prevFirst = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const seat = await mySeat(db, me, today);
  const areaId = seat?.areaId ?? me.area?.id ?? null;
  const doctors = await rows<RxDay["doctors"][number]>(
    db,
    sql`with pool as (
        select c.id from customer c where c.active and c.kind = 'doctor'
          and (c.added_by = ${me.id} ${areaId ? sql`or c.area_id = ${areaId}` : sql``}
            or c.id in (select customer_id from doctor_list where seat_id = ${seat?.id ?? 0} and ended_at is null))
      ),
      days as (
        select i.customer_id as cid, i.issued_on as d from invoice i where i.customer_id in (select id from pool) and i.status <> 'cancelled'
        union all
        select p.customer_id, p.ordered_on from past_order p where p.customer_id in (select id from pool) and p.status <> 'void'
      ),
      g as (select cid, d, d - lag(d) over (partition by cid order by d) as gap, row_number() over (partition by cid order by d desc) as rn
        from (select distinct cid, d from days) x),
      s as (select cid, max(d) as last,
          greatest(7, coalesce(percentile_cont(0.5) within group (order by gap) filter (where gap is not null and rn <= 7), 28))::float8 as usual,
          bool_or(d between ${prevFirst}::date and (${first}::date - 1)) as "lastMonth", bool_or(d >= ${first}::date) as "thisMonth"
        from g group by cid)
      select c.id::int as "customerId", c.name, c.city, c.phone, c.specialty,
        l.tier::int as tier,
        (select count(*) from visit v where v.customer_id = c.id and v.person_id = ${me.id} and v.status = 'done' and v.day >= ${first}::date)::int as visits,
        (select to_char(max(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.status = 'done') as "lastVisit",
        (select to_char(min(v.day), 'YYYY-MM-DD') from visit v where v.customer_id = c.id and v.person_id = ${me.id} and v.status = 'planned' and v.day >= ${today}::date) as "nextVisit",
        to_char(s.last, 'YYYY-MM-DD') as "lastOrder",
        case when s.last is null then null else to_char(s.last + round(s.usual)::int, 'YYYY-MM-DD') end as "refillOn",
        coalesce(s."lastMonth", false) as "lastMonth", coalesce(s."thisMonth", false) as "thisMonth"
      from pool join customer c on c.id = pool.id
        left join doctor_list l on l.customer_id = c.id and l.seat_id = ${seat?.id ?? 0} and l.ended_at is null
        left join s on s.cid = c.id
      order by l.tier nulls last, lower(c.name)`,
  );
  const soon = addDays(today, 2);
  const withLight = doctors.map((doctor) => ({
    ...doctor,
    due: doctor.tier ? TIER_VISITS[doctor.tier as 1 | 2 | 3] : 0,
    light: (doctor.refillOn && doctor.refillOn <= soon ? "red" : doctor.lastMonth && !doctor.thisMonth ? "yellow" : "green") as "red" | "yellow" | "green",
  }));
  const pap = await rows<RxDay["pap"]["rows"][number]>(
    db,
    sql`select l.id::int as "leadId", coalesce(l.patient_name, l.name) as patient, l.agency,
        to_char(l.gl_applied_on, 'YYYY-MM-DD') as "appliedOn", to_char(l.gl_letter_on, 'YYYY-MM-DD') as "letterOn"
      from lead l where l.assigned_to = ${me.id} and l.road = 'gl' and l.state = 'open'
        and (l.gl_letter_on is null or l.gl_letter_on >= ${first}::date)
      order by l.gl_letter_on nulls first, l.gl_applied_on nulls last limit 50`,
  );
  const listed = withLight.filter((doctor) => doctor.tier);
  return {
    today,
    seatId: seat?.id ?? null,
    tiers: ([1, 2, 3] as const).map((tier) => {
      const inTier = listed.filter((doctor) => doctor.tier === tier);
      return {
        tier,
        size: TIER_SIZE[tier],
        doctors: inTier.length,
        visitsDue: inTier.length * TIER_VISITS[tier],
        visitsDone: inTier.reduce((sum, doctor) => sum + Math.min(doctor.visits, TIER_VISITS[tier]), 0),
      };
    }),
    doctors: withLight,
    pap: {
      pending: pap.filter((row) => !row.letterOn).length,
      approved: pap.filter((row) => row.letterOn).length,
      rows: pap,
    },
  };
}

/** Puts a doctor on the seat's list in a tier, moves them, or takes them off (tier null). */
export async function setTier(db: Database, me: Me, input: { customerId: number; tier: 1 | 2 | 3 | null }): Promise<void> {
  if (me.role !== "medrep" || me.channel?.code !== "RX") throw new Refusal(403, "not_allowed", "Only the Rx CHC keeps their doctor list.");
  const today = todayManila();
  const seat = await mySeat(db, me, today);
  if (!seat) throw new Refusal(400, "no_seat", "You are not in a seat yet: ask HR to put you in one.");
  const [doctor] = await rows<{ kind: string }>(db, sql`select kind from customer where id = ${input.customerId} and active`);
  if (doctor?.kind !== "doctor") throw new Refusal(400, "invalid", "Only doctors go on the doctor list.", "customerId");
  if (input.tier) {
    const [inTier] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from doctor_list where seat_id = ${seat.id} and tier = ${input.tier} and ended_at is null and customer_id <> ${input.customerId}`,
    );
    if ((inTier?.n ?? 0) >= TIER_SIZE[input.tier])
      throw new Refusal(400, "full", `Tier ${input.tier} has its ${TIER_SIZE[input.tier]} doctors: move one down first.`, "tier");
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`update doctor_list set ended_at = now(), ended_by = ${me.id} where seat_id = ${seat.id} and customer_id = ${input.customerId} and ended_at is null`,
    );
    if (input.tier)
      await tx.execute(
        sql`insert into doctor_list (seat_id, customer_id, tier, set_by) values (${seat.id}, ${input.customerId}, ${input.tier}, ${me.id})`,
      );
  });
}
