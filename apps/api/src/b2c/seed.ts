// The B2C channel's demo, so the B2C CHC's and the coach's screens can be checked: the B2C Sales
// Coaching team under MD Telesales (as the 2026 chart draws it), Mae in its B2C CHC seat, an
// inactive demo Messenger page, three enquiries (one answered in time, one waiting within the 15
// minutes, one past them) and two patients whose refills come due. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { addDays, todayManila } from "../inventory/rules";
import { addPerson, projectOrg } from "../org/service";
import type { Me } from "../types";

export async function seedB2cTeam(db: Database, password: string): Promise<boolean> {
  const [done] = await rows<{ n: number }>(db, sql`select count(*)::int as n from person where email = 'mae@2mg.test'`);
  if (done?.n) return false;
  const [naresh] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from person where email = 'naresh@2mg.test'`);
  const [telesales] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where name = 'MD Telesales' and active`);
  if (!naresh || !telesales) return false;
  const ceo = { id: naresh.id, name: naresh.name, role: "ceo" } as Me;
  const [unit] = await rows<{ id: number }>(
    db,
    sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
      values ('B2C Sales Coaching', 'team', ${telesales.id}, (select id from channel where code = 'ONLINE'), 1) returning id::int as id`,
  );
  const added = await addPerson(db, ceo, {
    name: "Mae",
    email: "mae@2mg.test",
    password,
    unitId: unit?.id,
    title: "B2C CHC",
    module: "online",
    startsOn: "2025-06-01",
  });
  const mae = added.personId;
  await db.execute(sql`update person set must_change_password = false where id = ${mae}`);
  await projectOrg(db);

  // A demo Messenger page, switched off so nothing tries to read it.
  const [page] = await rows<{ id: number }>(
    db,
    sql`insert into channel_account (kind, key, name, secret, active) values ('messenger', 'demo-b2c', 'GetMeds (demo page)', 'demo', false)
      returning id::int as id`,
  );
  const enquiry = async (name: string, inboundAgo: number, repliedAfter: number | null, text: string) => {
    const [lead] = await rows<{ id: number }>(
      db,
      sql`insert into lead (source, name, desk, assigned_to, created_by, chat_account_id, chat_key, awaiting_reply,
          last_message, last_message_at, last_inbound_at, first_contact_at)
        values ('messenger', ${name}, 'online', ${mae}, ${mae}, ${page?.id}, ${`demo-${name}`}, ${repliedAfter === null},
          ${text}, now() - ${`${inboundAgo} minutes`}::interval, now() - ${`${inboundAgo} minutes`}::interval, now() - ${`${inboundAgo} minutes`}::interval)
        returning id::int as id`,
    );
    await db.execute(
      sql`insert into lead_message (lead_id, channel, account_id, direction, text, at)
        values (${lead?.id}, 'messenger', ${page?.id}, 'in', ${text}, now() - ${`${inboundAgo} minutes`}::interval)`,
    );
    if (repliedAfter !== null)
      await db.execute(
        sql`insert into lead_message (lead_id, channel, account_id, direction, text, by_person, at)
          values (${lead?.id}, 'messenger', ${page?.id}, 'out', 'Hello po! Sending the price now.', ${mae},
            now() - ${`${inboundAgo - repliedAfter} minutes`}::interval)`,
      );
  };
  await enquiry("Liza Ramos", 120, 5, "Magkano po ang Anastrozole 1 mg?");
  await enquiry("Benjie Santos", 6, null, "Available po ba ang Capecitabine?");
  await enquiry("Rosario Lim", 40, null, "Pwede po ba ang senior discount sa Letrozole?");

  // Two patients of Mae's with the old system's orders: one due tomorrow, one due today.
  const today = todayManila();
  for (const [name, ago] of [
    ["Teresa Villanueva", [29, 59]],
    ["Manuel Ocampo", [30, 60, 90]],
  ] as [string, number[]][]) {
    const [patient] = await rows<{ id: number }>(
      db,
      sql`insert into customer (name, kind, city, phone, added_by) values (${name}, 'patient', 'Makati', '0918 555 0199', ${mae}) returning id::int as id`,
    );
    for (const [n, days] of ago.entries()) {
      const [order] = await rows<{ id: number }>(
        db,
        sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total)
          values (${`demo-b2c-${patient?.id}-${n}`}, ${`SO-B2C-${patient?.id}-${n}`}, ${patient?.id}, ${addDays(today, -days)}::date, 'closed', 650000)
          returning id::int as id`,
      );
      await db.execute(sql`insert into past_order_item (past_order_id, name, qty, unit_price) values (${order?.id}, 'Anastrozole 1 mg', 30, 21667)`);
    }
  }
  return true;
}
