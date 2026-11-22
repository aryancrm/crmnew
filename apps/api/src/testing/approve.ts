// Tests approve orders without the screen: every Management check is marked approved first
// (the API refuses Approve until each is), by the first Management person.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { tickChecks } from "../orders/service";

/** Marks the order's checks approved and gives the address back, to post to. */
export async function ticked(db: Database, path: string): Promise<string> {
  const id = Number(path.match(/\/orders\/(\d+)\/approve$/)?.[1]);
  const [who] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'management' and active order by id limit 1`);
  if (id && who) await tickChecks(db, id, who.id);
  return path;
}
