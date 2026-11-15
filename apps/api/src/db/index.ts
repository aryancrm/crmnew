// One database. With no DATABASE_URL it is an embedded Postgres (PGlite) in new/.data/pg:
// nothing to install. Online it is a Postgres address. The code above never knows which.

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SQL } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Counts the queries one request makes, so every response can report it. */
const counter = new AsyncLocalStorage<{ queries: number }>();
const logger = {
  logQuery() {
    const store = counter.getStore();
    if (store) store.queries += 1;
  },
};

export async function countQueries<T>(
  work: () => Promise<T>,
): Promise<{ result: T; queries: number }> {
  const store = { queries: 0 };
  const result = await counter.run(store, work);
  return { result, queries: store.queries };
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
