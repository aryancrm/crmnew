// Applies the SQL files in ../../migrations in name order, each once, each in one transaction.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { type Database, rows } from "./index";

const DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
const BREAK = "--> statement-breakpoint";

/** Renumbered on 23 Nov 2026: main and backend had both used 0131-0135. A database that already ran
 *  one under its old name keeps it as run, under the new one; nothing runs twice. */
export const RENAMED: Record<string, string> = {
  "0131_session_workspace.sql": "0140_session_workspace.sql",
  "0132_person_pin.sql": "0141_person_pin.sql",
  "0133_own_passwords.sql": "0142_own_passwords.sql",
  "0134_profile_and_two_step.sql": "0143_profile_and_two_step.sql",
  "0135_sign_ups.sql": "0144_sign_ups.sql",
};

export async function migrate(db: Database): Promise<string[]> {
  await db.execute(
    sql`create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())`,
  );
  for (const [before, now] of Object.entries(RENAMED))
    await db.execute(
      sql`update schema_migration set name = ${now}
        where name = ${before} and not exists (select 1 from schema_migration where name = ${now})`,
    );
  const done = new Set(
    (await rows<{ name: string }>(db, sql`select name from schema_migration`)).map(
      (row) => row.name,
    ),
  );
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const statements = readFileSync(`${DIR}/${name}`, "utf8")
      .split(BREAK)
      .map((part) => part.trim())
      .filter((part) => part.replace(/^--.*$/gm, "").trim() !== "");
    await db.transaction(async (tx) => {
      for (const statement of statements) await tx.execute(sql.raw(statement));
      await tx.execute(sql`insert into schema_migration (name) values (${name})`);
    });
    applied.push(name);
  }
  return applied;
}
