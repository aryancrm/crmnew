// Government Bidding's demo, as the 2026 chart draws it: Jimmy (Government Bidding Admin), Hazel
// (Government Bidding Coachee) and Arron (Customer Happiness Coachee) in the Government Bidding line,
// two government buyers, tenders at different steps, and the company's papers (one expiring, one
// expired). Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";
import { ENVELOPE } from "./service";

export async function seedBidding(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'jimmy@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [unit] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'Government Bidding' and active`);
  if (!naresh || !unit) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const demo = async (input: Parameters<typeof addPerson>[2]) => {
    const added = await addPerson(db, ceo, { ...input, password, startsOn: "2025-06-01" });
    await db.execute(sql`update person set must_change_password = false where id = ${added.personId}`);
    return added.personId;
  };
  const jimmy = await demo({ name: "Jimmy", email: "jimmy@2mg.test", unitId: unit.id, title: "Government Bidding Admin", module: "team_lead", lead: true });
  const hazel = await demo({ name: "Hazel", email: "hazel@2mg.test", unitId: unit.id, title: "Government Bidding Coachee", module: "medrep", newArea: { name: "Bidding", cities: [] } });
  await demo({ name: "Arron", email: "arron@2mg.test", unitId: unit.id, title: "Customer Happiness Coachee – Government Bidding", module: "medrep", newArea: { name: "Bidding CHC", cities: [] } });
  await projectOrg(db);

  const today = todayManila();
  const agency = async (name: string, kind: string) => {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, added_by) values (${name}, ${kind}, 'Quezon City', ${hazel}) returning id::int as id`,
    );
    return made?.id as number;
  };
  const doh = await agency("Department of Health – Central Office", "government");
  const eamc = await agency("East Avenue Medical Center", "hospital");
  const papers = (done: number) => JSON.stringify(ENVELOPE.map((paper, n) => ({ paper, done: n < done })));
  const tender = async (n: number, agencyId: number, title: string, step: string, extra: { deadline?: number; ourBid?: number; abc: number; papersDone: number; noa?: number; delivered?: number; accepted?: number; billed?: number }) => {
    const [made] = await rows<{ id: number }>(
      db,
      sql`insert into tender (code, agency_id, title, philgeps_ref, mode, abc, owner_id, step, posted_on, deadline_at, our_bid, noa_on, delivered_on, accepted_on, billed_on, papers, created_by, price_approved_by)
        values (${`TND-DEMO-${n}`}, ${agencyId}, ${title}, ${`PG-${12000 + n}`}, 'competitive_bidding', ${extra.abc}, ${hazel}, ${step},
          ${addDays(today, -10)}::date, ${extra.deadline === undefined ? null : `${addDays(today, extra.deadline)}T10:00:00+08:00`}::timestamptz,
          ${extra.ourBid ?? null}, ${extra.noa === undefined ? null : addDays(today, -extra.noa)}::date,
          ${extra.delivered === undefined ? null : addDays(today, -extra.delivered)}::date, ${extra.accepted === undefined ? null : addDays(today, -extra.accepted)}::date,
          ${extra.billed === undefined ? null : addDays(today, -extra.billed)}::date, ${papers(extra.papersDone)}::jsonb, ${hazel},
          ${["price_approved", "submitted", "won", "contract", "delivered", "accepted", "billed"].includes(step) ? jimmy : null})
        returning id::int as id`,
    );
    await db.execute(sql`insert into tender_event (tender_id, step, note, by_person) values (${made?.id}, ${step}, 'Demo', ${hazel})`);
  };
  await tender(1, doh, "Supply of anti-cancer medicines, 1 lot", "preparing", { deadline: 3, abc: 450000000, ourBid: 412000000, papersDone: 5 });
  await tender(2, eamc, "Sugammadex 200 mg vials, 2,000", "found", { deadline: 6, abc: 360000000, papersDone: 2 });
  await tender(3, doh, "Letrozole and anastrozole tablets", "submitted", { abc: 120000000, ourBid: 108000000, papersDone: 8 });
  await tender(4, eamc, "Ondansetron injection, 5,000 ampoules", "delivered", { abc: 90000000, ourBid: 82000000, papersDone: 8, noa: 40, delivered: 6 });
  await tender(5, doh, "Filgrastim pre-filled syringes", "billed", { abc: 210000000, ourBid: 198000000, papersDone: 8, noa: 90, delivered: 70, accepted: 45, billed: 40 });

  for (const [name, number, days] of [
    ["PhilGEPS Platinum certificate", "PG-PLAT-2026-0419", 40],
    ["Mayor's permit (Las Piñas)", "BP-2026-1188", 200],
    ["BIR tax clearance", "TC-2025-7781", -5],
    ["FDA LTO (distributor)", "CDRR-NCR-DI/E/W-31324", 300],
  ] as [string, string, number][])
    await db.execute(
      sql`insert into company_paper (name, number, expires_on, added_by) values (${name}, ${number}, ${addDays(today, days)}::date, ${jimmy})`,
    );
  return true;
}
