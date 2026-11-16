// Modern Trade (docs/PLAN.md 16.7): the Chief Operating Officer looks after the pharmacy chains
// herself (nobody under her on the chart). Her day: sales against target on pace, each chain's last
// order and whether it is due or late against its own gap, money owed and its age, and which of our
// medicines each chain lists and in how many branches.

import { sql } from "drizzle-orm";
import { accountsOf } from "../b2b/service";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { HOSPITAL } from "../scores/recipes";
import { measure } from "../scores/service";
import { collections } from "../sellers/service";
import type { Me, MtDay } from "../types";

const mtPerson = (me: Me) => me.channel?.code === "MT" || me.business === "MT";
const mayLook = (me: Me) => mtPerson(me) || ["ceo", "admin"].includes(me.role);

export async function mtDay(db: Database, me: Me): Promise<MtDay> {
  if (!mayLook(me)) throw new Refusal(403, "not_allowed", "This is Modern Trade's desk.");
  const today = todayManila();
  // The chains are the customers of Modern Trade's areas.
  const areas = await rows<{ id: number }>(
    db,
    sql`select a.id::int as id from area a join channel c on c.id = a.channel_id where c.code = 'MT'`,
  );
  const [accounts, { values, notes }, owed] = await Promise.all([
    accountsOf(db, [me.id], areas.map((a) => a.id), today),
    measure(db, me.id, HOSPITAL, today.slice(0, 7), today, true),
    collections(db, me),
  ]);
  const ids = accounts.map((a) => a.customerId);
  const listings = ids.length
    ? await rows<MtDay["listings"][number]>(
        db,
        sql`select l.id::int as id, l.customer_id::int as "customerId", c.name as chain, m.name || coalesce(' ' || m.strength, '') as medicine,
            l.branches, l.listed, to_char(l.added_at at time zone 'Asia/Manila', 'YYYY-MM-DD') as since
          from mt_listing l join customer c on c.id = l.customer_id join medicine m on m.id = l.medicine_id
          where l.customer_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
            and not exists (select 1 from mt_listing n where n.customer_id = l.customer_id and n.medicine_id = l.medicine_id and n.id > l.id)
          order by c.name, m.name`,
      )
    : [];
  return {
    today,
    pace: values.ist === null || values.ist === undefined ? null : Math.round(values.ist),
    paceNote: notes.ist ?? "",
    chains: accounts,
    owed: { total: owed.total, rows: owed.rows },
    listings,
  };
}

export async function saveListing(
  db: Database,
  me: Me,
  input: { customerId: number; medicineId: number; branches: number; listed: boolean; note?: string | null },
): Promise<void> {
  if (!mtPerson(me) && me.role !== "admin") throw new Refusal(403, "not_allowed", "Modern Trade keeps the chains' listings.");
  await db.execute(
    sql`insert into mt_listing (customer_id, medicine_id, branches, listed, note, added_by)
      values (${input.customerId}, ${input.medicineId}, ${input.branches}, ${input.listed}, ${input.note?.trim() || null}, ${me.id})`,
  );
}
