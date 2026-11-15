// Demo enquiries for a developer's computer, worked by Jane the way she would: one just in,
// one waiting for its prescription, a senior waiting for the OSCA ID, one ready to order, a GL
// case waiting for the PCSO letter, one ordered, one lost. Spread over the last few days so the
// desk has more than one day. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { LeadInput, Me } from "../types";
import { addLead, addLeadFile, closeLead, orderFromLead, saveGl, saveQuote } from "./service";

/** A 1×1 grey PNG: a stand-in for a photo of a paper. */
const PHOTO = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export async function seedDemoOnline(db: Database): Promise<boolean> {
  const [counted] = await rows<{ count: number }>(db, sql`select count(*)::int as count from lead`);
  if ((counted?.count ?? 0) > 0) return false;
  const [jane] = await rows<{ id: number; name: string }>(
    db,
    sql`select id::int as id, name from person where role = 'online' and active order by id limit 1`,
  );
  if (!jane) return false;
  const me = { id: jane.id, name: jane.name, role: "online", area: null } as unknown as Me;
  const medicines = await rows<{ id: number; name: string }>(
    db,
    sql`select m.id::int as id, m.name from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'patient' where m.active`,
  );
  const medicine = (name: string) => medicines.find((row) => row.name.startsWith(name))?.id;

  const add = (input: Partial<LeadInput> & { name: string }) =>
    addLead(db, me, { source: "messenger", road: "regular", assignedTo: jane.id, ...input });
  const paper = (id: number, kind: string) =>
    addLeadFile(db, me, id, { kind, name: `${kind}.png`, mime: "image/png", bytes: PHOTO });
  const quote = (id: number, lines: [string, number][]) => {
    const picked = lines.flatMap(([name, qty]) => {
      const medicineId = medicine(name);
      return medicineId ? [{ medicineId, qty }] : [];
    });
    return picked.length ? saveQuote(db, me, id, { lines: picked }) : Promise.resolve();
  };
  const daysAgo = (id: number, days: number, hour: number) =>
    db.execute(
      sql`update lead set first_contact_at = (((now() at time zone 'Asia/Manila')::date - ${days}::int) + make_interval(hours => ${hour})) at time zone 'Asia/Manila' where id = ${id}`,
    );

  try {
    const maria = await add({
      name: "Maria Santos",
      phone: "0917 555 1234",
      city: "Pasay",
      request: "Anastrozole 1 mg, one box",
    });
    await db.execute(sql`update lead set opened_at = null where id = ${maria}`);

    const lito = await add({
      name: "Jose Ramirez",
      relation: "son",
      patientName: "Lito Ramirez",
      phone: "0918 222 4410",
      city: "Quezon City",
      road: "senior",
      source: "phone",
      request: "Imatinib 400 mg for his father",
    });
    await quote(lito, [["Imatinib", 60]]);
    await paper(lito, "rx");
    await daysAgo(lito, 1, 10);

    const ana = await add({
      name: "Ana Cruz",
      phone: "0927 410 8812",
      city: "Makati",
      source: "website_2mg",
      request: "Capecitabine 500 mg",
    });
    await quote(ana, [["Capecitabine", 120]]);
    await paper(ana, "rx");
    await daysAgo(ana, 1, 15);

    const rodel = await add({
      name: "Rodel Bautista",
      phone: "0915 300 7789",
      city: "Caloocan",
      road: "gl",
      agency: "pcso",
      request: "Bortezomib 3.5 mg, 4 vials",
    });
    await quote(rodel, [["Bortezomib", 4]]);
    await paper(rodel, "rx");
    await paper(rodel, "valid_id");
    await saveGl(db, me, rodel, {
      appliedOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    });
    await daysAgo(rodel, 3, 9);

    const grace = await add({
      name: "Grace Lim",
      phone: "0919 845 2201",
      city: "Pasig",
      source: "facebook",
      address: "12 Ortigas Ave., Pasig",
      request: "Letrozole 2.5 mg",
    });
    await quote(grace, [["Letrozole", 30]]);
    await paper(grace, "rx");
    await orderFromLead(db, me, grace, "cod");
    await daysAgo(grace, 2, 11);

    const mark = await add({
      name: "Mark Villanueva",
      phone: "0916 120 5532",
      city: "Taguig",
      source: "instagram",
      request: "Abiraterone price",
    });
    await closeLead(db, me, mark, "Found it cheaper elsewhere");
    await daysAgo(mark, 3, 16);

    const tess = await add({
      name: "Teresita Gomez",
      phone: "0905 771 0093",
      city: "Manila",
      road: "pwd",
      source: "referral",
      request: "Anastrozole, PWD",
    });
    await daysAgo(tess, 2, 14);
  } catch (error) {
    console.error(
      "database: demo enquiries stopped:",
      error instanceof Error ? error.message : error,
    );
  }
  return true;
}
