// Where the tender finder's robots keep their own records (docs/PLAN.md 25, step 6). The bidding
// team's own modules (workers/tender-finder/papers/lib, copied unchanged) read and write rows of
// tables of their own: the last PS-PhilGEPS Sync's lists and notices, what was read in each
// tender's papers, the Sync's status, the saved log-in session. Here each row is kept as the robot
// hands it in, under its table's name and its key; the robot's stand-in for its old database
// (papers/supabase-shim) does the rest. Only these tables, and a session's cookies are sealed.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { seal, unseal } from "../online/secrets";
import type { FoundList } from "../types";

/** The robots' own tables. Anything else is refused: the store is not a way to write anywhere. */
const TABLES = new Set([
  "ps_philgeps_snapshot",
  "ps_philgeps_session",
  "ps_sync_status",
  "ps_tender_analysis",
  "philgeps_sync_relay",
  "philgeps_session",
  "ocr_status",
  "award_notifications",
  "usage_meter",
]);
/** A live log-in to a portal: sealed with the server's key (SECRETS_KEY), never kept readable. */
const SEALED = new Set(["ps_philgeps_session", "philgeps_session"]);

function known(table: string): string {
  if (!TABLES.has(table)) throw new Refusal(400, "invalid", "Not one of the robot's tables.", "table");
  return table;
}

/** Every row of one of the robot's tables, as it was handed in. */
export async function robotRows(db: Database, table: string): Promise<Record<string, unknown>[]> {
  const kept = await rows<{ value: Record<string, unknown> | null; sealed: string | null }>(
    db,
    sql`select value, sealed from tender_robot_row where tbl = ${known(table)} order by key`,
  );
  return kept.flatMap((row) => {
    if (row.value) return [row.value];
    try {
      return [JSON.parse(unseal(row.sealed as string)) as Record<string, unknown>];
    } catch {
      // Sealed with a key this server no longer has: as good as gone (the robot connects again).
      return [];
    }
  });
}

/** Rows handed in (each replaces the row of its key) and rows taken away. */
export async function writeRobotRows(db: Database, table: string, input: { upsert?: { key: string; value: Record<string, unknown> }[]; remove?: string[] }): Promise<{ kept: number; removed: number }> {
  const tbl = known(table);
  for (const row of input.upsert ?? []) {
    const text = JSON.stringify(row.value);
    const hidden = SEALED.has(tbl) ? seal(text) : null;
    await db.execute(
      sql`insert into tender_robot_row (tbl, key, value, sealed) values (${tbl}, ${row.key}, ${hidden ? null : text}::jsonb, ${hidden})
        on conflict (tbl, key) do update set value = excluded.value, sealed = excluded.sealed, updated_at = now()`,
    );
  }
  let removed = 0;
  for (const key of input.remove ?? []) {
    const gone = await rows(db, sql`delete from tender_robot_row where tbl = ${tbl} and key = ${key} returning key`);
    removed += gone.length;
  }
  return { kept: input.upsert?.length ?? 0, removed };
}

/** Where the PS-PhilGEPS robot stands, for the finder's page: connected or not (a person's
 *  captcha tick makes the session), and how its last Sync went. */
export async function psState(db: Database): Promise<FoundList["robot"]["ps"]> {
  const [row] = await rows<{ value: Record<string, unknown> }>(db, sql`select value from tender_robot_row where tbl = 'ps_sync_status' and key = 'latest'`);
  const text = (name: string, max = 400) => (typeof row?.value?.[name] === "string" && row.value[name] ? (row.value[name] as string).slice(0, max) : null);
  // The last step of a laptop log-in (tenders/laptop-login.ts), so the page that opened it can follow it
  const [login] = await rows<{ outcome: string; detail: string | null; source: string | null; at: string }>(
    db,
    sql`select outcome, detail, source, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from tender_find_login
      where site = 'ps-philgeps' order by at desc, id desc limit 1`,
  );
  return {
    connected: Boolean(text("connected_at")),
    connectedAt: text("connected_at", 40),
    status: text("status", 40),
    stage: text("stage"),
    error: text("error"),
    finishedAt: text("finished_at", 40),
    login: login ?? null,
  };
}
