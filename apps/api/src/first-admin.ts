// A new company's database is empty: nobody can sign in. On the first start online, with
// ADMIN_EMAIL and ADMIN_PASSWORD set (Render → Environment), this makes the company's sales
// channels and its one System admin, who then adds everyone else from People. It does nothing
// once anyone exists, so the password in the environment can (and should) be removed after.

import { sql } from "drizzle-orm";
import { hashPassword } from "./auth/password";
import { type Database, rows } from "./db/index";
import { channel, person } from "./db/schema";
import { companyNow } from "./companies/context";
import { CHANNELS } from "./seed";

export async function makeFirstAdmin(
  db: Database,
  email = process.env.ADMIN_EMAIL,
  password = process.env.ADMIN_PASSWORD,
): Promise<boolean> {
  if (!email || !password) return false;
  const [counted] = await rows<{ count: number }>(db, sql`select count(*)::int as count from person`);
  if ((counted?.count ?? 0) > 0) return false;
  if (password.length < 8) throw new Error("ADMIN_PASSWORD needs at least 8 characters.");
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [channels] = await rows<{ count: number }>(tx, sql`select count(*)::int as count from channel`);
    if ((channels?.count ?? 0) === 0)
      await tx
        .insert(channel)
        .values(CHANNELS.map(([code, name, division], sort) => ({ code, name, sort, division })));
    await tx.insert(person).values({
      name: "Admin",
      email: email.trim().toLowerCase(),
      role: "admin",
      title: "System admin",
      passwordHash: hash,
      // The environment's password opens it once; the Admin then chooses their own.
      mustChangePassword: true,
    });
  });
  return true;
}

/**
 * A company that started empty has no tree: no company box to hang teams on, so nobody can be
 * added from Teams & people. On start, with no company box yet, this makes it (named after the
 * company's settings, else "2MG Inc."), one business box per sales channel, and a System admin
 * seat for every admin who has none. It does nothing once the tree exists.
 */
export async function ensureCompanyTree(db: Database, name = companyNow()?.name ?? "2MG Inc."): Promise<boolean> {
  const [company] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from org_unit where kind = 'company'`,
  );
  if (company) return false;
  const [admins] = await rows<{ count: number }>(
    db,
    sql`select count(*)::int as count from person where role = 'admin' and active`,
  );
  if ((admins?.count ?? 0) === 0) return false;
  await db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into org_unit (name, kind, parent_id, sort) values (${name}, 'company', null, 0)
        returning id::int as id`,
    );
    const root = made?.id as number;
    await tx.execute(
      sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
        select c.name, 'business', ${root}, c.id, c.sort + 1 from channel c where c.active`,
    );
    const free = await rows<{ id: number }>(
      tx,
      sql`select p.id::int as id from person p where p.role = 'admin' and p.active
        and not exists (select 1 from seat_holder h where h.person_id = p.id)`,
    );
    for (const admin of free) {
      const [seat] = await rows<{ id: number }>(
        tx,
        sql`insert into seat (unit_id, title, module, lead, sort)
          values (${root}, 'System admin', 'admin', false,
            (select coalesce(max(sort), 0) + 1 from seat where unit_id = ${root}))
          returning id::int as id`,
      );
      await tx.execute(
        sql`insert into seat_holder (seat_id, person_id, kind, starts_on, reason)
          values (${seat?.id}, ${admin.id}, 'holder', (now() at time zone 'Asia/Manila')::date, 'Joined')`,
      );
    }
  });
  return true;
}
