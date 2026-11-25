// Government Bidding's demo, as the 2026 chart draws it: Jimmy (Government Bidding Admin), Hazel
// (Government Bidding Coachee) and Arron (Customer Happiness Coachee) in the Government Bidding line,
// two government buyers, tenders at different steps, and the company's papers (one expiring, one
// expired). Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";
import { noteRun, takeFound } from "./finder";
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

/** The tender finder's demo (docs/PLAN.md 24): notices as the robot hands them in, on both
 *  portals: three open ones asking for our medicines (one whose agency is no customer yet and
 *  whose strength we do not keep), one read from its papers and already screened, one closed, one
 *  that is not ours; and the robot's last run. Through the same door's code as the robot. Runs once. */
export async function seedFound(db: Database): Promise<boolean> {
  const [state] = await rows<{ found: number; hazel: number | null; medicines: number }>(
    db,
    sql`select (select count(*) from tender_found)::int as found, (select id from person where email = 'hazel@2mg.test')::int as hazel,
      (select count(*) from medicine where generic = 'Bortezomib')::int as medicines`,
  );
  if (!state || state.found || !state.hazel || !state.medicines) return false;
  const today = todayManila();
  const closing = (days: number) => `${addDays(today, days)} 10:00:00`;
  const item = (line: string, description: string, quantity: number, unit: string, unit_price: number, item_no?: string) => ({
    line,
    description,
    item_no: item_no ?? null,
    quantity,
    unit,
    unit_price,
    total: quantity * unit_price,
  });
  const contact = { contact_name: "Maria L. Santos", contact_info: ["BAC Secretariat", "East Avenue, Diliman, Quezon City", "(02) 8928-0611", "bac@eamc.demo"] };
  await takeFound(db, [
    {
      ref_no: "12451001",
      title: "Supply and Delivery of Various Anti-Cancer Medicines",
      procuring_entity: "EAST AVENUE MEDICAL CENTER",
      publish_date: addDays(today, -2),
      closing_date: closing(9),
      abc_amount: 2437000,
      items_text: "Description\n1 200 vial Bortezomib 3.5 mg powder for injection 9,500.00 1,900,000.00\n2 3000 tablet Imatinib 400 mg tablet 95.00 285,000.00\n3 6000 tablet Capecitabine 500 mg tablet 42.00 252,000.00",
      details: {
        notice_type: "Invitation to Bid (ITB)",
        solicitation_no: "IB-2026-118",
        procurement_mode: "Public Bidding",
        classification: "Goods",
        area_of_delivery: "Metro Manila",
        delivery_period: "30 Day/s",
        status: "Active",
        pre_bid: `${addDays(today, 3).split("-").reverse().join("/")} 10:00 AM`,
        bid_opening: `${addDays(today, 9).split("-").reverse().join("/")} 10:00 AM`,
        ...contact,
        matched_items: [
          item("1 200 vial Bortezomib 3.5 mg powder for injection 9,500.00 1,900,000.00", "Bortezomib 3.5 mg powder for injection", 200, "vial", 9500, "1"),
          item("2 3000 tablet Imatinib 400 mg tablet 95.00 285,000.00", "Imatinib 400 mg tablet", 3000, "tablet", 95, "2"),
          item("3 6000 tablet Capecitabine 500 mg tablet 42.00 252,000.00", "Capecitabine 500 mg tablet", 6000, "tablet", 42, "3"),
        ],
        supplements: [{ no: "1", title: "Bid Bulletin No. 1: change of delivery schedule", type: "Bid Bulletin", published: addDays(today, -1) }],
      },
    },
    {
      ref_no: "12451017",
      title: "Procurement of Letrozole and Anastrozole Tablets",
      procuring_entity: "Department of Health - Central Office",
      publish_date: addDays(today, -1),
      closing_date: closing(5),
      abc_amount: 486000,
      items_text: "Description\n1 12000 tab Letrozole 2.5mg tablet 22.50 270,000.00\n2 9000 tab Anastrozole 1mg tablet 24.00 216,000.00",
      details: {
        notice_type: "Request for Quotation (RFQ)",
        solicitation_no: "RFQ-2026-0931",
        procurement_mode: "Negotiated Procurement - Small Value Procurement (Sec. 53.9)",
        area_of_delivery: "Metro Manila",
        delivery_period: "15 Day/s",
        status: "Active",
        matched_items: [
          item("1 12000 tab Letrozole 2.5mg tablet 22.50 270,000.00", "Letrozole 2.5mg tablet", 12000, "tab", 22.5, "1"),
          item("2 9000 tab Anastrozole 1mg tablet 24.00 216,000.00", "Anastrozole 1mg tablet", 9000, "tab", 24, "2"),
        ],
      },
    },
    {
      ref_no: "12451033",
      title: "Supply of Abiraterone Acetate 500 mg Tablet",
      procuring_entity: "Vicente Sotto Memorial Medical Center - Region VII",
      publish_date: addDays(today, -1),
      closing_date: closing(14),
      abc_amount: 1260000,
      items_text: "Description\n1 3000 tablet Abiraterone Acetate 500 mg tablet 420.00 1,260,000.00",
      details: {
        notice_type: "Invitation to Bid (ITB)",
        procurement_mode: "Public Bidding",
        area_of_delivery: "Cebu",
        delivery_period: "45 Day/s",
        status: "Active",
        matched_items: [item("1 3000 tablet Abiraterone Acetate 500 mg tablet 420.00 1,260,000.00", "Abiraterone Acetate 500 mg tablet", 3000, "tablet", 420, "1")],
      },
    },
    {
      source: "ps",
      ref_no: "109877",
      title: "Imatinib 400 mg Tablets for the Cancer Assistance Fund",
      procuring_entity: "East Avenue Medical Center",
      publish_date: addDays(today, -4),
      closing_date: closing(12),
      abc_amount: 950000,
      details: {
        procurement_mode: "Competitive Bidding (Public Bidding)",
        delivery_period: "Within 30 calendar days from receipt of the Notice to Proceed",
        // Read in the tender's papers (the bid documents' schedule of requirements).
        documents_items: [item("1 Imatinib (as mesilate) 400 mg film-coated tablet 10,000 tablets 95.00 950,000.00", "Imatinib (as mesilate) 400 mg film-coated tablet", 10000, "tablets", 95, "1")],
        documents: [{ name: "PBD-Imatinib-2026.pdf" }, { name: "Technical-Specifications.docx" }],
      },
    },
    {
      ref_no: "12450900",
      title: "Capecitabine 500 mg Tablet, 4,000 pcs",
      procuring_entity: "Department of Health - Central Office",
      publish_date: addDays(today, -12),
      closing_date: closing(-3),
      abc_amount: 168000,
      items_text: "Description\n1 4000 tablet Capecitabine 500 mg tablet 42.00 168,000.00",
      details: { notice_type: "Request for Quotation (RFQ)", procurement_mode: "Small Value Procurement", status: "Closed" },
    },
    {
      ref_no: "12451050",
      title: "Supply of Paracetamol 500 mg Tablets and IV Fluids",
      procuring_entity: "Quirino Memorial Medical Center",
      publish_date: addDays(today, -1),
      closing_date: closing(7),
      abc_amount: 310000,
      items_text: "Description\n1 50000 tablet Paracetamol 500 mg tablet 1.20 60,000.00\n2 5000 bottle Plain NSS 1 L 50.00 250,000.00",
      details: { notice_type: "Invitation to Bid (ITB)", procurement_mode: "Public Bidding", status: "Active" },
    },
  ]);
  await db.execute(sql`update tender_found set screened_at = now(), screened_by = ${state.hazel} where source = 'ps' and ref_no = '109877'`);
  await db.execute(
    sql`insert into tender_found_event (found_id, what, by_person) select id, 'screened', ${state.hazel} from tender_found where source = 'ps' and ref_no = '109877'`,
  );
  await noteRun(db, { source: "philgeps", trigger: "schedule", status: "success", summary: "543 tenders read, 5 mention our medicines, 3 new", found: 543, matched: 5, fresh: 3 });
  return true;
}
