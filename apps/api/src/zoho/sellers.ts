// Zoho's salespeople and the seats they are in this CRM. Zoho names a salesperson on each order
// ("HOS | PASAY", "B2B | Fritzie Rosann Mier"), not on the customer; each customer's Zoho
// contacts keep the salesperson of their latest order (zoho_contact.seller). The Admin ties each
// salesperson to a seat: the customers they last sold to come under that seat's area, so its
// holder, their coach and their channel see them. Tied again to another seat, the customers
// move with it; untied, they go back to no area. A customer someone here put in an area by hand
// is not moved.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { ORG_CHANGE_ROLES } from "../org/service";
import type { Me, ZohoSellerPlace, ZohoSellers } from "../types";
import { HUB_SHEET_2026_09 } from "./hub-sheet";

/** A Zoho salesperson name, made comparable (the hub's own rule: case, spacing, "I" for "|"). */
const norm = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+i\s+/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s+/g, " ");
const after = (text: string) => (text.includes("|") ? (text.split("|").slice(1).join("|") ?? "").trim() : text.trim());

/** Each customer's salesperson in Zoho: the one on the latest order across their contacts. */
const latestSeller = sql`(select distinct on (z.customer_id) z.customer_id, z.seller, z.seller_on
  from zoho_contact z where z.seller is not null order by z.customer_id, z.seller_on desc nulls last)`;

/** The words of a name that say where or who ("HOS | LAS PINAS" → las, pinas). */
const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^[^|]*\|/, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !["vacant", "the", "and"].includes(word));

export async function zohoSellers(db: Database, me: Me): Promise<ZohoSellers> {
  allow(me, ORG_CHANGE_ROLES, "tie Zoho's salespeople to seats");
  const [sellers, seats, sales, holders] = await Promise.all([
    rows<Omit<ZohoSellers["sellers"][number], "suggested">>(
      db,
      sql`select s.seller as name, count(*)::int as customers,
          count(*) filter (where s.seller_on >= (now() - interval '18 months')::date)::int as recent,
          to_char(max(s.seller_on), 'YYYY-MM-DD') as "lastOn",
          z.seat_id::int as "seatId"
        from ${latestSeller} s left join zoho_seller z on z.name = s.seller
        group by s.seller, z.seat_id
        order by count(*) filter (where s.seller_on >= (now() - interval '18 months')::date) desc, count(*) desc`,
    ),
    rows<ZohoSellers["seats"][number]>(
      db,
      sql`select s.id::int as id, s.title, u.name as unit, c.code as channel, a.name as area,
          (select p.name from seat_holder h join person p on p.id = h.person_id
            where h.seat_id = s.id and h.ends_on is null order by h.starts_on desc limit 1) as holder
        from seat s join org_unit u on u.id = s.unit_id join area a on a.id = s.area_id
        left join channel c on c.id = a.channel_id
        where s.active
        order by c.code, u.name, s.sort`,
    ),
    // Zoho's invoices under each salesperson name this year.
    rows<{ name: string; amount: number }>(
      db,
      sql`select coalesce(d.fields->>'Sales Person', d.fields->>'salesperson_name') as name, sum(round(d.total * d.fx_rate))::bigint::float8 as amount
        from book_doc d where d.kind = 'invoice' and d.zoho_id is not null and d.status not in ('void', 'draft')
          and d.doc_date >= date_trunc('year', now())::date
        group by 1`,
    ),
    // Everyone holding a seat today: where they sit and whom they report to.
    rows<ZohoSellerPlace & { seatId: number }>(
      db,
      sql`select s.id::int as "seatId", p.name as person, s.title as seat, u.name as team,
          coalesce(ca.code, cu.code, cp.code) as channel, b.name as "reportsTo"
        from seat s join seat_holder h on h.seat_id = s.id and h.ends_on is null and h.kind = 'holder'
          join person p on p.id = h.person_id join org_unit u on u.id = s.unit_id
          left join org_unit up on up.id = u.parent_id
          left join area a on a.id = s.area_id left join channel ca on ca.id = a.channel_id
          left join channel cu on cu.id = u.channel_id left join channel cp on cp.id = up.channel_id
          left join person b on b.id = s.boss_id
        where s.active and p.active`,
    ),
  ]);
  const saleOf = new Map(sales.map((one) => [norm(one.name ?? ""), one.amount]));
  const hubOf = new Map<string, (typeof HUB_SHEET_2026_09)[number]>();
  for (const row of HUB_SHEET_2026_09) {
    hubOf.set(norm(row.zoho), row);
    if (row.alias) hubOf.set(norm(row.alias), row);
  }
  const placeOfSeat = new Map(holders.map((one) => [one.seatId, one]));
  /** The person a hub name ("STC | GIENEL", "B&B | MERRY JOYCE") is, when exactly one holder's
   *  name starts with it; a vacant name is nobody. Only shown, never applied. */
  const looksLike = (hubPerson: string): ZohoSellerPlace | null => {
    const said = norm(after(hubPerson));
    if (!said || /vacant/.test(said)) return null;
    const found = holders.filter((one) => {
      const name = norm(one.person);
      return name === said || name.startsWith(`${said} `);
    });
    const unique = [...new Map(found.map((one) => [one.person, one])).values()];
    if (unique.length !== 1) return null;
    const { seatId: _, ...place } = unique[0] as ZohoSellerPlace & { seatId: number };
    return place;
  };
  // A suggestion: the seat whose area or title shares the most words with the salesperson's name,
  // in the channel the name starts with when one is known.
  const CHANNEL: Record<string, string> = { HOS: "HOSP", RX: "RX", URO: "RX", STC: "RX", "B&B": "RX", B2B: "B2B", CLIDP: "B2B", BID: "BID", TELESALES: "TS", B2C: "ONLINE", MT: "MT" };
  return {
    seats,
    sellers: sellers.map((seller) => {
      const prefix = seller.name.includes("|") ? (seller.name.split("|")[0] ?? "").trim().toUpperCase() : "";
      const mine = words(seller.name);
      let best: { id: number; score: number } | null = null;
      for (const seat of seats) {
        if (prefix && CHANNEL[prefix] && seat.channel !== CHANNEL[prefix]) continue;
        const theirs = new Set([...words(seat.area ?? ""), ...words(seat.title)]);
        const score = mine.filter((word) => theirs.has(word)).length;
        if (score > 0 && (!best || score > best.score)) best = { id: seat.id, score };
      }
      const hub = hubOf.get(norm(seller.name)) ?? null;
      const tiedTo = seller.seatId ? placeOfSeat.get(seller.seatId) : undefined;
      return {
        ...seller,
        suggested: best?.id ?? null,
        year: saleOf.get(norm(seller.name)) ?? 0,
        hub: hub ? { channel: hub.channel, head: hub.head, manager: hub.manager, person: hub.person, hq: hub.hq, vacant: hub.vacant } : null,
        ours: tiedTo ? { person: tiedTo.person, seat: tiedTo.seat, team: tiedTo.team, channel: tiedTo.channel, reportsTo: tiedTo.reportsTo } : null,
        looksLike: hub ? looksLike(hub.person) : looksLike(seller.name),
      };
    }),
  };
}

/** Ties a Zoho salesperson to a seat (or unties it) and moves their customers with it. */
export async function tieZohoSeller(
  db: Database,
  me: Me,
  name: string,
  seatId: number | null,
): Promise<{ moved: number }> {
  allow(me, ORG_CHANGE_ROLES, "tie Zoho's salespeople to seats");
  return db.transaction(async (tx) => {
    const [known] = await rows<{ name: string }>(tx, sql`select seller as name from zoho_contact where seller = ${name} limit 1`);
    if (!known) throw new Refusal(404, "not_found", "No such salesperson in Zoho's orders.");
    const [area] = seatId
      ? await rows<{ id: number | null }>(tx, sql`select area_id::int as id from seat where id = ${seatId} and active`)
      : [{ id: null }];
    if (seatId && !area) throw new Refusal(400, "invalid", "Pick a seat.", "seatId");
    if (seatId && !area?.id) throw new Refusal(400, "invalid", "That seat has no area to put customers in.", "seatId");
    const [before] = await rows<{ area: number | null }>(
      tx,
      sql`select s.area_id::int as area from zoho_seller z join seat s on s.id = z.seat_id where z.name = ${name}`,
    );
    await tx.execute(
      sql`insert into zoho_seller (name, seat_id, set_by, set_at) values (${name}, ${seatId}, ${me.id}, now())
        on conflict (name) do update set seat_id = excluded.seat_id, set_by = excluded.set_by, set_at = excluded.set_at`,
    );
    // The customers this salesperson last sold to: in no area yet, or in the area this
    // salesperson's seat had before (so a re-tie moves them, and nothing put by hand moves).
    const moved = await rows<{ id: number }>(
      tx,
      sql`update customer c set area_id = ${area?.id ?? null}
        from ${latestSeller} s
        where s.customer_id = c.id and s.seller = ${name}
          and (c.area_id is null ${before?.area ? sql`or c.area_id = ${before.area}` : sql``})
          and c.area_id is distinct from ${area?.id ?? null}
        returning c.id::int as id`,
    );
    return { moved: moved.length };
  });
}
