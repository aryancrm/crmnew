// A new company's database is empty: nobody can sign in. On the first start online, with
// ADMIN_EMAIL and ADMIN_PASSWORD set (Render → Environment), this makes the company's sales
// channels and its one System admin, who then adds everyone else from People. It does nothing
// once anyone exists, so the password in the environment can (and should) be removed after.

import { sql } from "drizzle-orm";
import { hashPassword } from "./auth/password";
import { type Database, rows } from "./db/index";
import { channel, person } from "./db/schema";
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
    });
  });
  return true;
}
