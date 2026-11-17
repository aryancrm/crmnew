// Offers on a medicine (the hub's Buy 1 Take 1, Aryan's Christmas offers): for a kind of buyer or
// every buyer, Buy X Take Y and / or a price per piece bought, between two days. The free pieces
// are worked out here from what is bought, never typed: an order always gets exactly what the
// offer gives (the hub replaced a free line typed by hand the same way).

import { sql } from "drizzle-orm";
import { rows } from "../db/index";
import type { Runner } from "../inventory/service";
import type { CustomerKind } from "../types";

export type ActiveOffer = {
  id: number;
  medicineId: number;
  buyerKind: CustomerKind | null;
  buy: number;
  take: number;
  price: number | null;
  name: string;
  endsOn: string;
};

/** What an offer is, in the words of the offers file. */
export const offerWords = (offer: { buy: number; take: number; price: number | null }) =>
  offer.take > 0 ? `Buy ${offer.buy} Take ${offer.take}` : "Special price";

/** The offer running today on each medicine for this buyer: one for their kind first, else one
 *  for every buyer. */
export async function activeOffers(
  db: Runner,
  medicineIds: number[],
  buyer: CustomerKind | null,
  today: string,
): Promise<Map<number, ActiveOffer>> {
  if (medicineIds.length === 0) return new Map();
  const found = await rows<ActiveOffer>(
    db,
    sql`select distinct on (o.medicine_id) o.id::int as id, o.medicine_id::int as "medicineId",
        o.buyer_kind as "buyerKind", o.buy::int as buy, o.take::int as take, o.price::int as price, o.name,
        to_char(o.ends_on, 'YYYY-MM-DD') as "endsOn"
      from offer o
      where o.medicine_id in (${sql.join(
        medicineIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        and o.ended_at is null and o.starts_on <= ${today}::date and o.ends_on >= ${today}::date
        and (o.buyer_kind is null or o.buyer_kind = ${buyer})
      order by o.medicine_id, (o.buyer_kind is null), o.created_at desc`,
  );
  return new Map(found.map((offer) => [offer.medicineId, offer]));
}

type Line = {
  medicineId: number;
  qty: number;
  priceKind: string;
  listPrice: number;
  unitPrice: number;
  reason: string | null;
  free: boolean;
  relief: boolean;
  offerId?: number | null;
};

/**
 * The free pieces of each Buy X Take Y running for this buyer, added after the paid line: as many
 * times Y as X goes into what is bought. A free line typed for such a medicine is replaced by it;
 * a sample of a medicine with no such offer stays as typed (Management agrees to it).
 */
export function withOfferLines<T extends Line>(lines: T[], offers: Map<number, ActiveOffer>): T[] {
  const out: T[] = [];
  for (const line of lines) {
    const offer = offers.get(line.medicineId);
    if (line.free && offer && offer.take > 0) continue;
    out.push(line);
    if (line.free || !offer || offer.take === 0) continue;
    if (out.some((one) => one.medicineId === line.medicineId && one.free)) continue;
    const bought = lines
      .filter((one) => one.medicineId === line.medicineId && !one.free)
      .reduce((sum, one) => sum + one.qty, 0);
    const given = Math.floor(bought / offer.buy) * offer.take;
    if (given > 0)
      out.push({
        ...line,
        qty: given,
        unitPrice: 0,
        reason: offer.name,
        free: true,
        relief: false,
        offerId: offer.id,
      });
  }
  return out;
}
