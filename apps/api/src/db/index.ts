// One database. With no DATABASE_URL it is an embedded Postgres (PGlite) in .data/pg:
// nothing to install. Online it is a Postgres address. The code above never knows which.

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type SQL, sql as sqlTag } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Counts the queries one request makes, so every response can report it; and, for a request that
 *  only reads, remembers answers worked out once in it (requestMemo). */
const counter = new AsyncLocalStorage<{ queries: number; memo: Map<string, Promise<unknown>> | null }>();
const logger = {
  logQuery() {
    const store = counter.getStore();
    if (store) store.queries += 1;
  },
};

export async function countQueries<T>(
  work: () => Promise<T>,
  /** A request that only reads (GET): the same thing asked twice in it is worked out once. */
  remembers = false,
): Promise<{ result: T; queries: number }> {
  const store = { queries: 0, memo: remembers ? new Map<string, Promise<unknown>>() : null };
  const result = await counter.run(store, work);
  return { result, queries: store.queries };
}

/**
 * Within one reading request, works a thing out once however many times it is asked (a lead's
 * scorecard needs each of their people's cards, and so does their head's, and the page lists them
 * too: one person's card was worked out several times over, 1,562 questions for the company's
 * page). The answer is the same as asking again: nothing is written in a reading request, and it is
 * forgotten when the request ends. Outside a request, or in one that writes, it just does the work.
 */
export function requestMemo<T>(key: string, work: () => Promise<T>): Promise<T> {
  const memo = counter.getStore()?.memo;
  if (!memo) return work();
  const kept = memo.get(key);
  if (kept) return kept as Promise<T>;
  const made = work();
  memo.set(key, made);
  return made;
}

/** Runs bookkeeping a request sets off (attendance's "last seen") outside its query count. */
export const uncounted = <T>(work: () => Promise<T>): Promise<T> => counter.exit(work);

export type Database = ReturnType<typeof drizzlePostgres<typeof schema>>;

/** Runs hand-written SQL and returns its rows, whichever driver is underneath. */
export async function rows<T = Record<string, unknown>>(
  db: Pick<Database, "execute">,
  query: SQL,
): Promise<T[]> {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * PGlite has no autovacuum, so nothing tells its planner how big the tables are or what is in
 * them: on the company's real data it picked plans that took minutes (Customers owe: 209 s, and
 * under 1 s once analysed). This analyses the tables never analysed or grown to more than twice
 * their size since. Cheap when nothing changed. Postgres online does this by itself.
 */
export async function freshenPlanner(db: Database): Promise<string[]> {
  const stale = await rows<{ name: string }>(
    db,
    sqlTag`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (c.reltuples < 0 or pg_relation_size(c.oid) / 8192 > 2 * greatest(c.relpages, 8))
      order by c.relname`,
  );
  if (!stale.length) return [];
  const names = stale.map((one) => `"${one.name.replaceAll('"', '""')}"`).join(", ");
  await db.execute(sqlTag.raw(`analyze ${names}`));
  return stale.map((one) => one.name);
}

/** `memory` = a database that lives as long as the process (tests). */
export function openDatabase(where: { url?: string; dir?: string | "memory" }): Database {
  if (where.url) {
    // A pooler (Supabase's, pgBouncer) can't keep prepared statements between queries.
    const pooled = /pooler\.|pgbouncer=true|:6543\//.test(where.url);
    const client = postgres(where.url, {
      prepare: !pooled,
      max: Number(process.env.DATABASE_POOL ?? 10),
      idle_timeout: 120,
      connect_timeout: 15,
      max_lifetime: 30 * 60,
    });
    return drizzlePostgres(client, { schema, logger });
  }
  if (process.env.NODE_ENV === "production" && where.dir !== "memory")
    throw new Error("DATABASE_URL is not set. Online, point it at a Postgres.");
  const dataDir = where.dir === "memory" ? undefined : where.dir;
  // PGlite makes its own folder but not the folders above it.
  if (dataDir) mkdirSync(dirname(dataDir), { recursive: true });
  // PGlite's driver has the same query API; the cast keeps one type above.
  return drizzlePglite({ connection: { dataDir }, schema, logger }) as unknown as Database;
}
