// A coach's district now (the Hospital CHC Playbook's District Sales Coach): each Hospital
// Division seller to hospitals under them (CHCs, anesthesia telesales) with the month so far (sales against the target on the working-day pace, days to collect,
// customers lapsed against their usual gap, working days without an invoice) and tonight's
// huddle, worst first. From it: who needs the coach today (three evenings without an invoice:
// go with them tomorrow; days to collect over 90; not declared after 7 PM) and, from the 15th,
// the rescue list (IST below 40%, DSO over 75, over 20% lapsed, NZSD under 80%).

import { sql } from "drizzle-orm";
import { reorders } from "../customers/reorders";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { inForce } from "../org/service";
import { HOSPITAL } from "../scores/recipes";
import { measure } from "../scores/service";
import { teamSeats } from "../team/service";
import type { District, Me } from "../types";
import { teamHuddle } from "./service";

export async function district(db: Database, me: Me): Promise<District> {
  if (!["team_lead", "manager", "ceo", "admin"].includes(me.role))
    throw new Refusal(403, "not_allowed", "District now is the coaches' and heads' view.");
  const today = todayManila();
  const month = today.slice(0, 7);
  const { seatIds } = await teamSeats(db, me, me.unit ?? null);
  const people = seatIds.length
    ? await rows<{ personId: number; name: string; seatId: number; seat: string; areaId: number | null; area: string | null; unit: string; coach: string | null }>(
        db,
        sql`select distinct on (h.person_id) h.person_id::int as "personId", p.name, s.id::int as "seatId", s.title as seat,
            s.area_id::int as "areaId", a.name as area, u.name as unit,
            (select lp.name || case when lh.kind = 'acting' then ' (covering)' else '' end
               from seat ls join seat_holder lh on lh.seat_id = ls.id and ${inForce("lh", today)}
               join person lp on lp.id = lh.person_id where ls.unit_id = s.unit_id and ls.lead and ls.active
             order by (lh.kind = 'holder') desc, lh.starts_on desc limit 1) as coach
          from seat s join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and ${inForce("h", today)}
            join person p on p.id = h.person_id join org_unit u on u.id = s.unit_id left join area a on a.id = s.area_id
          where s.id in (${sql.join(seatIds.map((id) => sql`${id}`), sql`, `)}) and not s.lead and s.module = 'medrep'
            and h.person_id <> ${me.id}
            -- The Hospital Division's sellers to hospitals only: its CHCs and its anesthesia telesales.
            -- Not its PAP officer (patients' cases) nor its government bidding coachee (tenders).
            and seat_business_channel(s.id) = 'HOSP'
            and (select ch.code from channel ch where ch.id = a.channel_id) in ('HOSP', 'TS')
            and s.title not ilike '%bidding%'
          order by h.person_id, h.starts_on desc`,
      )
    : [];
  const [byArea, huddle] = await Promise.all([reorders(db, me, { state: "late" }), teamHuddle(db, me, {})]);
  const measured = await Promise.all(people.map((one) => measure(db, one.personId, HOSPITAL, month, today, true)));
  const afterSeven = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hour12: false })) >= 19;
  const day = Number(today.slice(8));

  const out: District["rows"] = people.map((one, n) => {
    const { values, facts } = measured[n] as Awaited<ReturnType<typeof measure>>;
    const area = byArea.areas.find((row) => row.areaId === one.areaId);
    const known = area ? area.ok + area.due + area.late + area.atRisk : 0;
    const lapsed = area ? area.late + area.atRisk : 0;
    const said = huddle.rows.find((row) => row.personId === one.personId);
    const ist = values.ist ?? null;
    const dso = values.dso ?? null;
    const nzsd = values.nzsd ?? null;
    const lapsedShare = known ? (lapsed / known) * 100 : null;
    const rescue: string[] = [];
    if (day >= 15) {
      if (ist !== null && ist < 40) rescue.push(`IST ${Math.round(ist)}%`);
      if (dso !== null && dso > 75) rescue.push(`DSO ${Math.round(dso)} days`);
      if (lapsedShare !== null && lapsedShare > 20) rescue.push(`${Math.round(lapsedShare)}% lapsed`);
      if (nzsd !== null && nzsd < 80) rescue.push(`NZSD ${Math.round(nzsd)}%`);
    }
    const needs: string[] = [];
    if (said?.threeDry) needs.push("Three working days without an invoice: go with them tomorrow");
    if (dso !== null && dso > 90) needs.push(`Days to collect ${Math.round(dso)}: plan the collection with them`);
    if (afterSeven && !said?.declared) needs.push("Has not declared tonight's huddle");
    const zeroDays = facts ? facts.workedSoFar - facts.daysWithInvoice : 0;
    // Worst first: the rescue flags, then how far below the pace.
    const weight = rescue.length * 100 + needs.length * 50 + (ist === null ? 0 : Math.max(0, 100 - ist));
    return {
      personId: one.personId,
      name: one.name,
      seatId: one.seatId,
      seat: one.seat,
      area: one.area,
      unit: one.unit,
      coach: one.coach,
      sales: facts?.sales ?? 0,
      target: facts?.target ?? null,
      ist: ist === null ? null : Math.round(ist),
      dso: dso === null ? null : Math.round(dso),
      owed: facts?.owed ?? 0,
      lapsed,
      lapsedShare: lapsedShare === null ? null : Math.round(lapsedShare),
      zeroDays,
      workedSoFar: facts?.workedSoFar ?? 0,
      huddle: said ? { declared: Boolean(said.declared), invoiced: said.actual.invoiced, threeDry: said.threeDry, blocker: said.declared?.blocker ?? null } : null,
      rescue,
      needs,
      weight,
    };
  });
  out.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  return { today, month, rescueOpen: day >= 15, rows: out };
}
