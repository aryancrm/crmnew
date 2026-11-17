// Offers on a medicine, set in Inventory by those who set prices (Management, the CEO, Admin):
// the hub's Buy 1 Take 1 and the Christmas offers file — for a kind of buyer or every buyer, Buy X
// Take Y and / or a price per piece bought, between two days. Orders take them by themselves
// (orders/offers.ts). Every offer added or ended is written in the medicine's price history.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { offerWords } from "../orders/offers";
import type { CatalogueOffer, Me, MedicineOffer, OfferInput } from "../types";
import { addDays, todayManila } from "./rules";
import { activeMedicine, day, type Runner } from "./service";

const KIND_LABEL: Record<string, string> = {
  hospital: "Hospitals",
  doctor: "Doctors",
  patient: "Patients",
  drugstore: "Drugstores",
  distributor: "Distributors",
  government: "Government buyers",
};
export const offerBuyerLabel = (kind: string | null) => (kind ? (KIND_LABEL[kind] ?? kind) : "Every buyer");

const peso = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The offers running today, by medicine (for the catalogue the order form reads). */
export async function runningOffers(db: Runner, today: string): Promise<Map<number, CatalogueOffer[]>> {
  const found = await rows<CatalogueOffer & { medicineId: number }>(
    db,
    sql`select id::int as id, medicine_id::int as "medicineId", buyer_kind as "buyerKind", buy::int as buy, take::int as take,
        price::int as price, name, ${day("ends_on")} as "endsOn"
      from offer where ended_at is null and starts_on <= ${today}::date and ends_on >= ${today}::date
      order by medicine_id, buyer_kind nulls last, id`,
  );
  const out = new Map<number, CatalogueOffer[]>();
  for (const { medicineId, ...offer } of found) out.set(medicineId, [...(out.get(medicineId) ?? []), offer]);
  return out;
}

/** A medicine's offers: running and coming, and those ended in the last 90 days. */
export async function offersOf(db: Runner, medicineId: number): Promise<MedicineOffer[]> {
  const today = todayManila();
  const found = await rows<Omit<MedicineOffer, "buyerLabel" | "state"> & { ended: boolean }>(
    db,
    sql`select o.id::int as id, o.buyer_kind as "buyerKind", o.buy::int as buy, o.take::int as take, o.price::int as price,
        o.name, o.note, ${day("o.starts_on")} as "startsOn", ${day("o.ends_on")} as "endsOn", p.name as by,
        (o.ended_at is not null or o.ends_on < ${today}::date) as ended
      from offer o join person p on p.id = o.created_by
      where o.medicine_id = ${medicineId} and coalesce(o.ended_at::date, o.ends_on) >= ${addDays(today, -90)}::date
      order by o.starts_on desc, o.id desc`,
  );
  return found.map(({ ended, ...offer }) => ({
    ...offer,
    buyerLabel: offerBuyerLabel(offer.buyerKind),
    state: ended ? "ended" : offer.startsOn > today ? "later" : "now",
  }));
}

/** Adds an offer. One running offer per medicine and kind of buyer at a time: the new one is
 *  refused while another overlaps it (end that one first). */
export async function addOffer(db: Database, me: Me, medicineId: number, input: OfferInput): Promise<number> {
  if (input.endsOn < input.startsOn)
    throw new Refusal(400, "invalid", "The offer can't end before it starts.", "endsOn");
  if (input.endsOn < todayManila())
    throw new Refusal(400, "invalid", "That end date has already passed.", "endsOn");
  if (input.take === 0 && input.price === null)
    throw new Refusal(400, "invalid", "Give pieces free (Take), or a special price.", "take");
  const name = input.name?.trim() || offerWords(input);
  return db.transaction(async (tx) => {
    await activeMedicine(tx, medicineId);
    const [overlap] = await rows<{ name: string }>(
      tx,
      sql`select name from offer where medicine_id = ${medicineId} and ended_at is null
        and buyer_kind is not distinct from ${input.buyerKind}
        and starts_on <= ${input.endsOn}::date and ends_on >= ${input.startsOn}::date limit 1`,
    );
    if (overlap)
      throw new Refusal(
        409,
        "overlap",
        `"${overlap.name}" already runs for ${offerBuyerLabel(input.buyerKind).toLowerCase()} then: end it first.`,
        "startsOn",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into offer (medicine_id, buyer_kind, buy, take, price, name, note, starts_on, ends_on, created_by)
        values (${medicineId}, ${input.buyerKind}, ${input.buy}, ${input.take}, ${input.price}, ${name},
          ${input.note?.trim() || null}, ${input.startsOn}::date, ${input.endsOn}::date, ${me.id})
        returning id::int as id`,
    );
    await tx.execute(
      sql`insert into price_change (medicine_id, what, old_amount, new_amount, by_person)
          values (${medicineId}, ${`Offer "${name}" for ${offerBuyerLabel(input.buyerKind).toLowerCase()}, ${input.startsOn} to ${input.endsOn}${input.price !== null ? `, ${peso(input.price)} a piece` : ""}`},
            null, ${input.price}, ${me.id})`,
    );
    return made?.id as number;
  });
}

/** Ends an offer now: orders placed from now on don't take it; orders already placed keep it. */
export async function endOffer(db: Database, me: Me, offerId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [offer] = await rows<{ medicine: number; name: string; ended: boolean }>(
      tx,
      sql`select medicine_id::int as medicine, name, ended_at is not null as ended from offer where id = ${offerId} for update`,
    );
    if (!offer) throw new Refusal(404, "not_found", "No such offer.");
    if (offer.ended) return;
    await tx.execute(sql`update offer set ended_at = now(), ended_by = ${me.id} where id = ${offerId}`);
    await tx.execute(
      sql`insert into price_change (medicine_id, what, old_amount, new_amount, by_person)
          values (${offer.medicine}, ${`Offer "${offer.name}" ended`}, null, null, ${me.id})`,
    );
  });
}

