// Applies the SQL files in ../../migrations in name order, each once, each in one transaction.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { type Database, rows } from "./index";

const DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
const BREAK = "--> statement-breakpoint";

export async function migrate(db: Database): Promise<string[]> {
  await db.execute(
    sql`create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())`,
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
