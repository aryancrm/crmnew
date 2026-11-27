// The desks' common password (Aryan, 19 Nov, back on 27 Nov: "Management, Finance and Dispatch had
// a common password only; bring it back"). The company's Admin (or the CEO) types it in the Admin
// panel; it is kept only as a hash, in the company's own database, so each company has its own and
// it is never in the code. It opens the desk's shared screen (app.ts, /api/auth/desk); each
// person's own login stays theirs.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import type { DeskPasswordState, Me } from "../types";
import { hashPassword, passwordMatches } from "./password";

export const DESK_SCREENS = ["management", "finance", "dispatch"] as const;
export type DeskScreen = (typeof DESK_SCREENS)[number];
export const DESK_WORDS: Record<DeskScreen, string> = { management: "Management", finance: "Finance", dispatch: "Dispatch" };

const KEY = "desk_password";

/** Whether the desks' password is set, and who set it when: never the password. */
export async function deskPasswordState(db: Runner): Promise<DeskPasswordState> {
  const [row] = await rows<{ on: boolean; savedAt: string | null; savedBy: string | null }>(
    db,
    sql`select (s.value->>'hash') is not null as "on", s.updated_at::text as "savedAt", p.name as "savedBy"
      from setting s left join person p on p.id = s.updated_by where s.key = ${KEY}`,
  );
  return row?.on ? { on: true, savedAt: row.savedAt, savedBy: row.savedBy } : { on: false, savedAt: null, savedBy: null };
}

/** The Admin or the CEO sets the desks' password (null: none, the desk screens closed). Every desk
 *  screen open now signs out: the next one opens with the new password. */
export async function saveDeskPassword(db: Database, me: Me, password: string | null): Promise<void> {
  allow(me, ["admin", "ceo"], "set the desks' password");
  if (password !== null) {
    if (password.length < 8) throw new Refusal(400, "invalid", "Use at least 8 characters.", "password");
    if (password.length > 200) throw new Refusal(400, "invalid", "Use at most 200 characters.", "password");
  }
  const value = password === null ? {} : { hash: await hashPassword(password) };
  await db.execute(
    sql`insert into setting (key, value, updated_by) values (${KEY}, ${JSON.stringify(value)}::jsonb, ${me.id})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
  );
  await db.execute(sql`delete from session where desk is not null`);
}

/** Whether the password typed is the desks' one; null when the company has none set. */
export async function deskPasswordRight(db: Runner, password: string): Promise<boolean | null> {
  const [row] = await rows<{ hash: string | null }>(db, sql`select value->>'hash' as hash from setting where key = ${KEY}`);
  if (!row?.hash) return null;
  return passwordMatches(password, row.hash);
}
