// Demo data for each channel's own screens on the live CRM (Aryan, 20 Nov: "put dummy data on live
// too, in all of them; the real data when we properly go live"). scripts/demo-live.ts makes the
// orders (every desk's steps, the money); this adds what each channel's work reads besides:
// TeleSales', B2B's and B2C's calls with callbacks due; BID's tenders with every bid read at the
// opening (one lost, one won with its award, one opened, one coming up); CLIDP's road (approached,
// interested, agreed at a rate, declined, ordering); HOSP's accreditation and formulary at each
// hospital; MT's listings at the chains and a deduction from a payment; prescriptions written by a
// doctor in RX and MD Telesales.
//
// Everything sits on demo-live's customers (their note says "Demo · 20 Nov walkthrough") or is named
// "Demo", so all of it can be found and closed (cancelled, dropped, archived; nothing deleted) before
// the real go-live. Made through the app as the real people where the app makes it; tenders are
// written as the bidding team would have recorded them. Safe to run again: each part looks first.
// Run demo-live.ts first. Dry run by default; --apply writes.
//
//   TEST_PGLITE_DIR=<a local database to try it on> npx tsx scripts/demo-channels.ts [--apply]
//   (the live database: --live, on Aryan's word: 20 Nov "dummy data on live too, in all")

import { sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { startSession } from "../src/auth/sessions";
import { type Database, openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { addDays, todayManila } from "../src/inventory/rules";
import { ENVELOPE } from "../src/tenders/service";

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
if (!process.env.TEST_PGLITE_DIR && !live) throw new Error("Give TEST_PGLITE_DIR (a local database), or --live on Aryan's word.");
const db: Database = openDatabase(live ? { url: process.env.DATABASE_URL } : { dir: process.env.TEST_PGLITE_DIR as string });
await migrate(db);
const MARK = "Demo · 20 Nov walkthrough";
const today = todayManila();
const app = createApp(db, { webUrl: "http://localhost:5180" });
const sessions: number[] = [];

async function personId(name: string): Promise<number | null> {
  const [found] = await rows<{ id: number }>(db, sql`select id::int as id from person where active and name = ${name} order by id limit 1`);
  return found?.id ?? null;
}
async function cookieOf(name: string): Promise<string> {
  const id = await personId(name);
  if (!id) throw new Error(`${name} is not in this database.`);
  const token = await startSession(db, id);
  const [session] = await rows<{ id: number }>(db, sql`select id::int as id from session where person_id = ${id} order by id desc limit 1`);
  if (session) sessions.push(session.id);
  return `sid=${token}`;
}
async function call(cookie: string, path: string, body?: unknown) {
  const response = await app.request(path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
async function tryIt(what: string, work: () => Promise<unknown>) {
  try {
    await work();
    console.log(`  ${what}: made`);
  } catch (error) {
    console.log(`  ${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
/** demo-live's customers in an area, oldest first. */
async function demoCustomers(area: string) {
  return rows<{ id: number; name: string; kind: string; areaId: number }>(
    db,
    sql`select c.id::int as id, c.name, c.kind, c.area_id::int as "areaId" from customer c join area a on a.id = c.area_id
      where a.name = ${area} and c.note = ${MARK} and c.active order by c.id`,
  );
}
async function holderOf(area: string): Promise<string | null> {
  const [found] = await rows<{ name: string }>(
    db,
    sql`select p.name from area a join seat s on s.area_id = a.id and s.active join seat_holder h on h.seat_id = s.id and h.kind = 'holder' and h.ends_on is null
      join person p on p.id = h.person_id and p.active where a.name = ${area} limit 1`,
  );
  return found?.name ?? null;
}
async function areaId(area: string): Promise<number | null> {
  const [found] = await rows<{ id: number }>(db, sql`select id::int as id from area where name = ${area}`);
  return found?.id ?? null;
}
/** Medicines with a price for the buyer, in stock on the main shelf. */
async function medicines(kind: string, n: number) {
  return rows<{ id: number; price: number }>(
    db,
    sql`select m.id::int as id, p.amount::float8 as price from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = ${kind} and p.amount > 0
      where m.active and exists (select 1 from stock st join batch b on b.id = st.batch_id where b.medicine_id = m.id and st.qty >= 25)
      order by m.id limit ${n}`,
  );
}
const management = await cookieOf("Kate Cagoyong");
const finance = await cookieOf("Sarla Devi");

// ---- Calls: each seller's calls today, what came of them, a callback due. ----
console.log("Calls (TeleSales, B2B, MD Telesales)");
const CALLERS: [area: string, outcomes: string[]][] = [
  ["TeleSales | Micah Jimena", ["ordered", "reached", "no_answer", "call_back", "not_interested"]],
  ["TeleSales | Aila Jane Zaragosa", ["ordered", "call_back", "reached", "no_answer"]],
  ["TeleSales | Sheena Mae Correa", ["reached", "ordered", "no_answer"]],
  ["B2B | Fritzie Rosann Mier", ["won_back", "reached", "call_back"]],
  ["B2B | LONIE", ["ordered", "no_answer", "call_back"]],
  ["B2B | FLOREMEL TAN MEDINA", ["reached", "not_interested", "ordered"]],
  ["MD Telesales | Ailyn Mancilla", ["ordered", "reached", "call_back"]],
];
for (const [area, outcomes] of CALLERS) {
  const who = await holderOf(area);
  const customers = await demoCustomers(area);
  if (!who || !customers.length) {
    console.log(`  ${area}: skipped (${!who ? "nobody in its seat" : "no demo customers: run demo-live.ts first"})`);
    continue;
  }
  const id = await personId(who);
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from account_call where by_person = ${id} and note like 'Demo%'`);
  if (done?.n) {
    console.log(`  ${area}: has its demo calls`);
    continue;
  }
  console.log(`  ${area} · ${who}: ${outcomes.join(", ")}`);
  if (!apply) continue;
  const cookie = await cookieOf(who);
  for (const [at, outcome] of outcomes.entries()) {
    const customer = customers[at % customers.length] as (typeof customers)[number];
    await tryIt(`${outcome} (${customer.name})`, () =>
      call(cookie, "/api/calls", {
        customerId: customer.id,
        outcome,
        note: `Demo call: ${outcome === "call_back" ? "asked to call back" : outcome === "ordered" ? "placed an order" : outcome.replace("_", " ")}`,
        nextOn: outcome === "call_back" ? today : null,
      }),
    );
  }
}

// ---- BID: tenders with every bid read at the opening. ----
console.log("\nBID tenders (Hazel, Angel)");
const [tendersDone] = await rows<{ n: number }>(db, sql`select count(*)::int as n from tender where title like 'Demo · %'`);
if (tendersDone?.n) console.log("  there already");
else {
  const owner = async (name: string) => {
    const [seat] = await rows<{ person: number; seat: number }>(
      db,
      sql`select h.person_id::int as person, h.seat_id::int as seat from seat_holder h join person p on p.id = h.person_id
        where p.name = ${name} and p.active and h.kind = 'holder' and h.ends_on is null order by h.starts_on, h.id limit 1`,
    );
    return seat ?? null;
  };
  const hazel = await owner("Hazel Marie Balano");
  const angel = await owner("Angelica Gollena");
  // The price is approved by Government Bidding's lead on the tree (Subir).
  const [approver] = await rows<{ id: number }>(
    db,
    sql`select h.person_id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active and s.lead
      where h.ends_on is null and unit_division(s.unit_id) = 'BID' order by h.starts_on, h.id limit 1`,
  );
  // Agencies: the demo customers in the bidding areas that are a hospital or a government office.
  const agencies = [
    ...(await demoCustomers("BID | HAZEL")),
    ...(await demoCustomers("BID | ANGEL")),
  ].filter((one) => one.kind === "hospital" || one.kind === "government");
  if (!hazel || !angel || agencies.length < 2) console.log(`  skipped (${!hazel || !angel ? "Hazel or Angel not here" : "fewer than two agencies among the demo customers"})`);
  else {
    const allDone = JSON.stringify(ENVELOPE.map((paper) => ({ paper, done: true })));
    const someDone = JSON.stringify(ENVELOPE.map((paper, n) => ({ paper, done: n < 4 })));
    type Plan = {
      code: string;
      who: { person: number; seat: number };
      agency: number;
      title: string;
      step: string;
      abc: number;
      ourBid: number | null;
      opening: number | null;
      deadline: number | null;
      result?: { reason: string; winning?: number; on: number };
      noa?: number;
      deliverBy?: number;
      bidders: [name: string, price: number, disqualified?: boolean][];
    };
    const PLANS: Plan[] = [
      {
        code: "TND-DEMO-L1",
        who: hazel,
        agency: (agencies[0] as (typeof agencies)[number]).id,
        title: "Demo · Ondansetron 8 mg injection, 3,000 ampoules",
        step: "lost",
        abc: 90_000_000,
        ourBid: 86_000_000,
        opening: -7,
        deadline: -8,
        result: { reason: "lower_price", winning: 79_500_000, on: -6 },
        bidders: [["Bidder A (demo)", 79_500_000], ["Bidder B (demo)", 84_200_000], ["Bidder C (demo)", 93_000_000, true]],
      },
      {
        code: "TND-DEMO-W1",
        who: hazel,
        agency: (agencies[1] as (typeof agencies)[number]).id,
        title: "Demo · Paclitaxel 300 mg vials, 500",
        step: "won",
        abc: 120_000_000,
        ourBid: 110_000_000,
        opening: -12,
        deadline: -13,
        result: { reason: "lowest", on: -5 },
        noa: -3,
        deliverBy: 20,
        bidders: [["Bidder A (demo)", 114_500_000], ["Bidder D (demo)", 118_900_000]],
      },
      {
        code: "TND-DEMO-S1",
        who: angel,
        agency: (agencies[0] as (typeof agencies)[number]).id,
        title: "Demo · Filgrastim pre-filled syringes, 1,200",
        step: "submitted",
        abc: 210_000_000,
        ourBid: 198_000_000,
        opening: -1,
        deadline: -2,
        bidders: [["Bidder B (demo)", 189_000_000], ["Bidder E (demo)", 205_500_000]],
      },
      {
        code: "TND-DEMO-P1",
        who: angel,
        agency: (agencies[1] as (typeof agencies)[number]).id,
        title: "Demo · Cisplatin 50 mg vials, 800",
        step: "preparing",
        abc: 64_000_000,
        ourBid: 61_000_000,
        opening: null,
        deadline: 5,
        bidders: [],
      },
    ];
    for (const plan of PLANS) {
      console.log(`  ${plan.title}: ${plan.step}${plan.bidders.length ? `, ${plan.bidders.length} other bids read` : ""}`);
      if (!apply) continue;
      const day = (n: number | null | undefined) => (n === null || n === undefined ? null : addDays(today, n));
      const [made] = await rows<{ id: number }>(
        db,
        sql`insert into tender (code, agency_id, title, philgeps_ref, mode, abc, owner_id, seat_id, step, posted_on, deadline_at, opening_on,
            our_bid, winning_bid, result_reason, result_on, noa_on, deliver_by, papers, created_by, price_approved_by)
          values (${plan.code}, ${plan.agency}, ${plan.title}, ${`PG-DEMO-${plan.code.slice(-2)}`}, 'competitive_bidding', ${plan.abc},
            ${plan.who.person}, ${plan.who.seat}, ${plan.step}, ${addDays(today, -20)}::date,
            ${plan.deadline === null ? null : `${day(plan.deadline)}T10:00:00+08:00`}::timestamptz, ${day(plan.opening)}::date,
            ${plan.ourBid}, ${plan.result?.winning ?? null}, ${plan.result?.reason ?? null}, ${day(plan.result?.on)}::date,
            ${day(plan.noa)}::date, ${day(plan.deliverBy)}::date, ${plan.step === "preparing" ? someDone : allDone}::jsonb, ${plan.who.person},
            ${plan.step === "preparing" ? null : (approver?.id ?? null)})
          returning id::int as id`,
      );
      for (const [step, note] of [
        ["found", "Recorded from PhilGEPS (demo)"],
        ...(plan.step !== "found" ? [["preparing", "Envelope started (demo)"]] : []),
        ...(["submitted", "won", "lost"].includes(plan.step) ? [["price_approved", "Bid price approved (demo)"], ["submitted", "Envelope submitted (demo)"]] : []),
        ...(["won", "lost"].includes(plan.step) ? [[plan.step, plan.step === "won" ? "Lowest calculated bid (demo)" : "Another bidder was lower (demo)"]] : []),
      ] as [string, string][])
        await db.execute(sql`insert into tender_event (tender_id, step, note, by_person) values (${made?.id}, ${step}, ${note}, ${plan.who.person})`);
      for (const [name, price, disqualified] of plan.bidders)
        await db.execute(
          sql`insert into tender_bidder (tender_id, name, price, disqualified, note, by_person)
            values (${made?.id}, ${name}, ${price}, ${Boolean(disqualified)}, ${disqualified ? "Over the ABC (demo)" : null}, ${plan.who.person})`,
        );
    }
  }
}

// ---- CLIDP: the road with each pharmacy and distributor. ----
console.log("\nCLIDP road (Annie, Nicka)");
for (const area of ["CLIDP | Annie Maglatang", "CLIDP | NICKA"]) {
  const coach = await holderOf(area);
  const customers = (await demoCustomers(area)).filter((one) => ["distributor", "drugstore", "hospital"].includes(one.kind));
  const at = await areaId(area);
  if (!coach || !at) {
    console.log(`  ${area}: skipped (no such seat here)`);
    continue;
  }
  const [done] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from clidp_account a join customer c on c.id = a.customer_id where c.note = ${MARK} and c.area_id = ${at}`,
  );
  if (done?.n) {
    console.log(`  ${area}: there already`);
    continue;
  }
  const prospects: [name: string, stage: string, extra: Record<string, unknown>][] =
    area === "CLIDP | NICKA"
      ? [["Demo Pharmacy · Santa Rosa", "interested", { nextStep: "Send the price list", nextOn: addDays(today, 2) }]]
      : [
          ["Demo Pharmacy · Imus", "approached", { nextStep: "Meet the owner", nextOn: addDays(today, 1) }],
          ["Demo Drugstore · Bacoor", "agreed", { agreementUntil: addDays(today, 365) }],
          ["Demo Pharmacy · Dasmariñas", "declined", { declinedReason: "Buys from another distributor at a lower price" }],
        ];
  console.log(`  ${area} · ${coach}: ${customers.length} buying accounts ordering with their rates; ${prospects.map(([name, stage]) => `${name} ${stage}`).join(", ")}`);
  if (!apply) continue;
  const cookie = await cookieOf(coach);
  const priced = await medicines("drugstore", 3);
  for (const customer of customers)
    await tryIt(`${customer.name} ordering, with rates`, async () => {
      await call(cookie, `/api/clidp/road/${customer.id}`, { stage: "ordering", note: "Demo: buying under the agreement" });
      for (const medicine of priced.slice(0, 2))
        await call(cookie, "/api/clidp/rates", { customerId: customer.id, medicineId: medicine.id, unitPrice: Math.round((medicine.price * 0.9) / 100) * 100, moq: 20 });
    });
  for (const [name, stage, extra] of prospects)
    await tryIt(`${name} ${stage}`, async () => {
      const made = await call(management, "/api/customers", { kind: "drugstore", name, city: name.split("· ")[1], areaId: at, note: MARK });
      const id = made.id as number;
      await call(cookie, "/api/clidp/road", { customerId: id, note: "Demo: first visit" });
      if (stage !== "approached") {
        if (stage === "agreed") await call(cookie, "/api/clidp/road/" + id, { stage: "interested", note: "Demo: asked for our rates" });
        await call(cookie, `/api/clidp/road/${id}`, { stage, note: `Demo: ${stage}`, ...extra });
        if (stage === "agreed" && priced[0])
          await call(cookie, "/api/clidp/rates", { customerId: id, medicineId: priced[0].id, unitPrice: Math.round((priced[0].price * 0.88) / 100) * 100, moq: 30 });
      }
    });
}

// ---- HOSP: 2MG's accreditation at each hospital and our medicines on its formulary. ----
console.log("\nHOSP accreditation and formulary");
const HOSP_AREAS = ["HOS | PASAY", "HOS | COMMONWEALTH", "HOS | LAGUNA", "HOS | BAGUIO", "HOS | DAVAO NORTH", "HOS | NORTH CEBU"];
let hospitalTurn = 0;
for (const area of HOSP_AREAS) {
  const chc = await holderOf(area);
  // The hospitals board lists hospitals and government hospitals alike.
  const hospitals = (await demoCustomers(area)).filter((one) => one.kind === "hospital" || one.kind === "government");
  if (!chc || !hospitals.length) {
    console.log(`  ${area}: skipped (${!chc ? "nobody in its seat" : "no demo hospital"})`);
    continue;
  }
  const [done] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from hospital_accreditation where customer_id in (${sql.join(hospitals.map((one) => sql`${one.id}`), sql`, `)})`,
  );
  if (done?.n) {
    console.log(`  ${area}: there already`);
    continue;
  }
  console.log(`  ${area} · ${chc}: ${hospitals.map((one) => one.name).join(", ")}`);
  if (!apply) continue;
  const cookie = await cookieOf(chc);
  const formulary = await medicines("hospital", 4);
  for (const hospital of hospitals) {
    const turn = hospitalTurn++;
    const status = turn % 5 === 3 ? "applied" : turn % 7 === 5 ? "refused" : "accredited";
    await tryIt(`${hospital.name} ${status}`, async () => {
      await call(cookie, "/api/hospitals/accreditation", {
        customerId: hospital.id,
        status,
        on: addDays(today, -40 - turn * 9),
        validUntil: status === "accredited" ? addDays(today, turn % 3 === 0 ? 25 : 300) : null,
        note: status === "refused" ? "Demo: not on this year's supplier list" : "Demo",
      });
      for (const [n, medicine] of formulary.entries())
        await call(cookie, "/api/hospitals/formulary", {
          customerId: hospital.id,
          medicineId: medicine.id,
          status: n < 2 ? "approved" : n === 2 ? "requested" : "not_approved",
          on: addDays(today, -30 + n * 5),
          doctor: n === 2 ? "Dr. Demo Santos" : null,
          note: "Demo",
        });
    });
  }
}

// ---- MT: the chains' listings, and a deduction from a payment. ----
console.log("\nMT listings and a deduction (Malou)");
{
  const chains = (await demoCustomers("Modern Trade")).filter((one) => ["drugstore", "distributor"].includes(one.kind));
  const [done] = chains.length
    ? await rows<{ n: number }>(db, sql`select count(*)::int as n from mt_listing where customer_id in (${sql.join(chains.map((one) => sql`${one.id}`), sql`, `)})`)
    : [{ n: 0 }];
  if (!chains.length) console.log("  skipped (no demo chains: run demo-live.ts first)");
  else if (done?.n) console.log("  there already");
  else {
    console.log(`  ${chains.map((one) => one.name).join(", ")}: 3 medicines listed each; a listing fee deducted from a payment`);
    if (apply) {
      const malou = await cookieOf("Malou Jagonoy");
      const listed = await medicines("drugstore", 3);
      for (const [n, chain] of chains.entries())
        for (const [k, medicine] of listed.entries())
          await tryIt(`${chain.name}: listing ${k + 1}`, () =>
            call(malou, "/api/mt/listings", { customerId: chain.id, medicineId: medicine.id, branches: [120, 45, 12][k] ?? 10, listed: !(n === 1 && k === 2), note: "Demo" }),
          );
      const [owing] = await rows<{ id: number; balance: number }>(
        db,
        sql`select i.id::int as id, (i.total - i.paid)::float8 as balance from invoice i join sales_order o on o.id = i.order_id
          where o.customer_id in (${sql.join(chains.map((one) => sql`${one.id}`), sql`, `)}) and i.status = 'open' and i.total > i.paid
          order by i.id limit 1`,
      );
      if (owing)
        await tryIt("a listing fee deducted from a payment", () =>
          call(finance, `/api/invoices/${owing.id}/payments`, {
            amount: Math.floor(owing.balance * 0.4),
            method: "bank",
            reference: "DEMO-MT-1",
            paidOn: today,
            deducted: Math.floor(owing.balance * 0.05),
            deductionKind: "listing_fee",
            deductionRef: "DM-DEMO-1",
          }),
        );
      else console.log("  no MT invoice owing yet for the deduction");
    }
  }
}

// ---- Prescriptions: an order a doctor wrote, in RX Business and MD Telesales. ----
console.log("\nPrescriptions (RX, MD Telesales)");
const RX_AREAS = ["RX | NCR 1", "RX | Blood & Bone Care | Marwin Dy", "RX | Cebu (Onco, Uro) | Antonette Lawas", "RX | South Luzon (Onco, Uro) | Kevin Sean Apid", "MD Telesales | Ailyn Mancilla"];
for (const area of RX_AREAS) {
  const seller = await holderOf(area);
  const customers = await demoCustomers(area);
  if (!seller || !customers.length) {
    console.log(`  ${area}: skipped (${!seller ? "nobody in its seat" : "no demo customers: run demo-live.ts first"})`);
    continue;
  }
  const [done] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from sales_order where doctor_id is not null and customer_id in (${sql.join(customers.map((one) => sql`${one.id}`), sql`, `)})`,
  );
  if (done?.n) {
    console.log(`  ${area}: there already`);
    continue;
  }
  // The Rx seats' customers are doctors: each writes for their own clinic's order.
  const writers = customers.filter((one) => one.kind === "doctor").slice(0, 2);
  console.log(`  ${area} · ${seller}: ${writers.map((one) => one.name).join(", ") || "no doctor among the demo customers"}`);
  if (!apply) continue;
  const cookie = await cookieOf(seller);
  const [line] = await medicines("doctor", 1);
  for (const doctor of writers)
    await tryIt(`${doctor.name}'s prescription`, async () => {
      if (!line) throw new Error("no medicine priced for doctors");
      const order = (await call(cookie, "/api/orders", { customerId: doctor.id, doctorId: doctor.id, items: [{ medicineId: line.id, qty: 4, priceKind: "doctor" }] }))
        .id as number;
      await call(management, `/api/orders/${order}/approve`, {});
      await call(finance, `/api/finance/orders/${order}/invoice`, {});
    });
}

if (sessions.length) await db.execute(sql`delete from session where id in (${sql.join(sessions.map((id) => sql`${id}`), sql`, `)})`);
console.log(`\n${apply ? "Applied." : "Dry run: nothing written (--apply writes)."}`);
process.exit(0);
