// More MedReps for a developer's computer, so Management's queue looks like the real one: orders
// from several people in several areas at once. Mia covers Makati, Carlo Davao (both under
// Daniel in HOSP) and Joy the doctors of Cebu (RX). Each adds a customer or two the way a rep
// would and places orders; some wait, one is late, one went through. Runs once, also on a
// computer that already has the first demo people (it looks for Mia).

import { sql } from "drizzle-orm";
import { addCustomer } from "../customers/service";
import { type Database, rows } from "../db/index";
import { addPerson, addSeat, projectOrg } from "../org/service";
import type { BuyerType, Me, OrderItemInput } from "../types";
import { alignDemoMoneyDates, spreadDemoStepTimes } from "./seed-times";
import { actOnOrder,
  tickChecks, placeOrder } from "./service";

export async function seedDemoTeam(db: Database, password: string): Promise<boolean> {
  const found = await rows<{ id: number; email: string; role: string; name: string }>(
    db,
    sql`select id::int as id, email, role, name from person where email in
        ('mia@2mg.test', 'daniel@2mg.test', 'sarla@2mg.test', 'naresh@2mg.test')`,
  );
  if (found.some((row) => row.email === "mia@2mg.test")) return false;
  const daniel = found.find((row) => row.email === "daniel@2mg.test");
  const sarlaRow = found.find((row) => row.email === "sarla@2mg.test");
  const naresh = found.find((row) => row.email === "naresh@2mg.test");
  if (!daniel || !sarlaRow || !naresh) return false;
  const sarla = { id: sarlaRow.id, name: sarlaRow.name, role: "management", area: null } as Me;

  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const unitOf = async (name: string) => {
    const [found] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from org_unit where name = ${name} and active`,
    );
    return found?.id ?? null;
  };
  // They join the way the CEO adds anyone: Team & seats → Add, a seat with its area.
  const rep = async (
    name: string,
    unit: string,
    place: { name: string; cities: string[] },
  ): Promise<Me> => {
    const unitId = await unitOf(unit);
    const added = await addPerson(db, ceo, {
      name,
      email: `${name.toLowerCase()}@2mg.test`,
      password,
      unitId,
      title: "MedRep",
      module: "medrep",
      newArea: place,
      startsOn: "2025-06-01",
    });
    // Demo people sign in with the demo password as it is.
    await db.execute(
      sql`update person set must_change_password = false where id = ${added.personId}`,
    );
    const [area] = await rows<{ id: number }>(
      db,
      sql`select area_id::int as id from seat where id = ${added.seatId}`,
    );
    return {
      id: added.personId,
      name,
      role: "medrep",
      area: { id: area?.id as number, ...place },
    } as Me;
  };

  const mia = await rep("Mia", "NCR 1", {
    name: "HOS | Makati",
    cities: ["Makati", "Taguig", "Pateros"],
  });
  // Mindanao's team lead seat is vacant: Carlo reports to the lead above it, the Hospital head
  // (26 Nov: a lead's seat isn't covered by someone else).
  const carlo = await rep("Carlo", "Mindanao", {
    name: "HOS | Davao",
    cities: ["Davao City", "Tagum", "Panabo"],
  });
  const joy = await rep("Joy", "Doctor dispensing", {
    name: "RX | Cebu",
    cities: ["Cebu City", "Mandaue", "Lapu-Lapu"],
  });
  // A MedRep's seat nobody sits in yet: its customers wait with the team lead.
  const ncr1 = await unitOf("NCR 1");
  if (ncr1)
    await addSeat(db, ceo, {
      unitId: ncr1,
      title: "MedRep",
      module: "medrep",
      newArea: { name: "HOS | Quezon City", cities: ["Quezon City", "Caloocan", "San Juan"] },
    });
  const makati = mia.area as NonNullable<Me["area"]>;
  const davao = carlo.area as NonNullable<Me["area"]>;
  const cebu = joy.area as NonNullable<Me["area"]>;
  const qc = await rows<{ id: number }>(
    db,
    sql`select id::int as id from area where name = 'HOS | Quezon City'`,
  );
  // The customers already in those cities now sit in the new areas, with whoever holds them.
  for (const place of [
    makati,
    davao,
    cebu,
    { id: qc[0]?.id as number, cities: ["Quezon City", "Caloocan", "San Juan"] },
  ])
    await db.execute(
      sql`update customer set area_id = ${place.id} where area_id is null and city = any(string_to_array(${place.cities.join("|")}, '|'))`,
    );

  const credit = { paymentTerms: "days", paymentDays: 30, creditLimit: 1_000_000_00 } as const;
  const makatiMed = await addCustomer(db, sarla, {
    kind: "hospital",
    name: "Makati Medical Center",
    city: "Makati",
    address: "2 Amorsolo St, Legaspi Village, Makati",
    phone: "(02) 8888 8999",
    licenceNo: "LTO-H-0207",
    licenceExpires: "2027-06-30",
    ...credit,
  });
  await addCustomer(db, mia, {
    kind: "hospital",
    name: "St. Luke's Medical Center BGC",
    city: "Taguig",
    address: "Rizal Drive cor. 32nd St, Bonifacio Global City",
    phone: "(02) 8789 7700",
    // From the field a hospital comes with its licence (the hub's rule): a demo one.
    tin: "000-123-456-000",
    licenceOwner: "St. Luke's Medical Center, Inc.",
    licenceNo: "LTO-DEMO-0001",
    ltoType: "Hospital",
    licenceIssued: "2025-01-15",
    licenceExpires: "2028-01-15",
  });
  const spmc = await addCustomer(db, sarla, {
    kind: "hospital",
    name: "Southern Philippines Medical Center",
    city: "Davao City",
    address: "JP Laurel Ave, Bajada, Davao City",
    phone: "(082) 227 2731",
    ...credit,
  });
  const lim = await addCustomer(db, joy, {
    kind: "doctor",
    name: "Dr. Paolo Lim",
    city: "Cebu City",
    specialty: "Medical oncology",
    phone: "0917 812 4410",
  });
  const tan = await addCustomer(db, joy, {
    kind: "doctor",
    name: "Dra. Grace Tan",
    city: "Mandaue",
    specialty: "Hematology",
    phone: "0919 330 2287",
  });
  const davaoDoctors = await rows<{ id: number }>(
    db,
    sql`select id::int as id from customer where name = 'Davao Doctors Hospital'`,
  );

  const medicines = await rows<{ id: number; name: string; kind: BuyerType }>(
    db,
    sql`select m.id::int as id, m.name, p.buyer_type as kind
      from medicine m join medicine_price p on p.medicine_id = m.id where m.active`,
  );
  const item = (name: string, kind: BuyerType, qty: number): OrderItemInput | null => {
    const price = medicines.find((row) => row.name.startsWith(name) && row.kind === kind);
    return price ? { medicineId: price.id, qty, priceKind: kind, unitPrice: null } : null;
  };
  const place = async (
    who: Me,
    customerId: number | undefined,
    items: (OrderItemInput | null)[],
    hoursAgo = 0,
    note?: string,
  ) => {
    const lines = items.filter((line): line is OrderItemInput => line !== null);
    if (!customerId || lines.length === 0) return null;
    const id = await placeOrder(db, who, { customerId, items: lines, note });
    if (hoursAgo)
      await db.execute(
        sql`update sales_order set created_at = created_at - make_interval(hours => ${hoursAgo}),
            submitted_at = submitted_at - make_interval(hours => ${hoursAgo}) where id = ${id}`,
      );
    return id;
  };

  // Waiting for Management, from three people at once (Carlo's oldest is late).
  await place(
    mia,
    makatiMed,
    [item("Imatinib", "hospital", 120), item("Letrozole", "hospital", 200)],
    1,
  );
  await place(
    mia,
    makatiMed,
    [item("Capecitabine", "hospital", 300)],
    3,
    "Pharmacy wants it by Friday.",
  );
  await place(carlo, spmc, [item("Bortezomib", "hospital", 8)], 7);
  await place(carlo, davaoDoctors[0]?.id, [item("Abiraterone", "hospital", 60)], 2);
  await place(joy, lim, [item("Letrozole", "doctor", 90)], 0, "For his clinic's dispensary.");
  await place(joy, tan, [item("Imatinib", "doctor", 60)], 5);
  // Through Management already.
  const approved = await place(mia, makatiMed, [item("Anastrozole", "hospital", 240)], 26);
  if (approved) {
    await tickChecks(db, approved, sarla.id);
    await actOnOrder(db, sarla, approved, "approve", {});
  }
  // Every demo order moved within a second; give the steps believable times.
  await spreadDemoStepTimes(db);
  await alignDemoMoneyDates(db);
  return true;
}

/** A PAP MedRep for a developer's computer (Paula, Metro Manila), so the patient-assistance
 *  cases can be walked: she opens a guarantee-letter case for a patient. Runs once. */
export async function seedPapRep(db: Database, password: string): Promise<boolean> {
  const found = await rows<{ id: number; email: string; name: string }>(
    db,
    sql`select id::int as id, email, name from person where email in ('paula@2mg.test', 'naresh@2mg.test')`,
  );
  const naresh = found.find((row) => row.email === "naresh@2mg.test");
  if (!naresh) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const [unit] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from org_unit where name = 'Patient Assistance' and active`,
  );
  if (!unit) return false;
  // The PAP head (Pia) leads the unit and approves its orders, not Management.
  const [pia] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where email = 'pia@2mg.test'`,
  );
  let made = false;
  if (!pia) {
    const head = await addPerson(db, ceo, {
      name: "Pia",
      email: "pia@2mg.test",
      password,
      unitId: unit.id,
      title: "PAP head",
      module: "manager",
      lead: true,
      startsOn: "2025-06-01",
    });
    await db.execute(
      sql`update person set must_change_password = false where id = ${head.personId}`,
    );
    made = true;
  }
  if (found.some((row) => row.email === "paula@2mg.test")) {
    if (made) await projectOrg(db);
    return made;
  }
  const added = await addPerson(db, ceo, {
    name: "Paula",
    email: "paula@2mg.test",
    password,
    unitId: unit.id,
    title: "PAP MedRep",
    module: "medrep",
    newArea: { name: "PAP | Metro Manila", cities: ["Manila", "Quezon City", "Pasig"] },
    startsOn: "2025-06-01",
  });
  await db.execute(
    sql`update person set must_change_password = false where id = ${added.personId}`,
  );
  await projectOrg(db);
  return true;
}
