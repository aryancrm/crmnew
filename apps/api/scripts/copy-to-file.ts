// The live database's data written to one SQL file, for the company's own server (Coolify:
// the database's Import Backup, run with psql). No pg_dump needed. It only reads the source, in
// one read-only snapshot. The schema is not in the file: the target must already be built by the
// same migrations (start the API there on the same code first); the file empties the target's
// tables and fills them, every row as it is, then moves each id counter past the biggest id.
//
//   set -a; . ./.env.live; set +a
//   npx tsx scripts/copy-to-file.ts <out.sql> [--test-copy]
//
// --test-copy: the copy can't act for the company: every page token, mailbox password and website
// key is replaced by an unreadable word and its channel switched off, and nobody stays signed in.
// Without it (switch day) everything goes over as it is, so SECRETS_KEY must be the live one.

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";

const out = process.argv[2];
const testCopy = process.argv.includes("--test-copy");
if (!out || out.startsWith("--")) throw new Error("Give the file to write: copy-to-file.ts <out.sql> [--test-copy]");
if (!process.env.DATABASE_URL) throw new Error("Give DATABASE_URL: the database to copy from.");

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const file = createWriteStream(out);
file.setMaxListeners(0); // one pipe per table into the same file
const write = (text: string) =>
  new Promise<void>((resolve, reject) => file.write(text, (error) => (error ? reject(error) : resolve())));
const name = (word: string) => `"${word.replaceAll('"', '""')}"`;

// What a test copy keeps instead of the real thing.
const REPLACED: Record<string, Record<string, string>> = testCopy
  ? { channel_account: { secret: "'test-copy: connect again'::text", active: "false" } }
  : {};
const EMPTIED = new Set(testCopy ? ["session", "points_session"] : []);

const counts: { table: string; rows: number }[] = [];
await sql.begin("isolation level repeatable read read only", async (tx) => {
  const tables = await tx<{ table: string }[]>`
    select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`;
  const columns = await tx<{ table: string; column: string; identity: boolean }[]>`
    select c.relname as table, a.attname as column, a.attidentity <> '' as identity
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' order by c.relname, a.attnum`;

  await write(
    `-- Data of ${tables.length} tables, ${new Date().toISOString()}${testCopy ? ", test copy (channels cut off, no sign-ins)" : ""}.\n` +
      "\\set ON_ERROR_STOP on\nbegin;\nset session_replication_role = replica;\n" +
      `truncate ${tables.map((one) => `public.${name(one.table)}`).join(", ")};\n`,
  );
  for (const { table } of tables) {
    const cols = columns.filter((one) => one.table === table);
    if (EMPTIED.has(table) || cols.length === 0) continue;
    const list = cols.map((one) => name(one.column)).join(", ");
    const pick = cols.map((one) => REPLACED[table]?.[one.column] ?? name(one.column)).join(", ");
    const [{ n }] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.${name(table)}`);
    counts.push({ table, rows: n });
    if (!n) continue;
    await write(`copy public.${name(table)} (${list}) from stdin;\n`);
    const stream = await tx.unsafe(`copy (select ${pick} from public.${name(table)}) to stdout`).readable();
    await pipeline(stream, file, { end: false });
    await write("\\.\n");
  }
  // Each id counter past the biggest id copied.
  for (const one of columns.filter((col) => col.identity)) {
    const t = `public.${name(one.table)}`;
    await write(
      `select setval(pg_get_serial_sequence('${t}', '${one.column}'), coalesce(max(${name(one.column)}), 1), max(${name(one.column)}) is not null) from ${t};\n`,
    );
  }
  await write("commit;\n");
});
await new Promise<void>((resolve) => file.end(resolve));
await sql.end();
const total = counts.reduce((sum, one) => sum + one.rows, 0);
console.log(`${out}: ${counts.length} tables, ${total} rows${testCopy ? " (test copy)" : ""}`);
for (const one of counts.filter((row) => row.rows > 0).sort((a, b) => b.rows - a.rows).slice(0, 12))
  console.log(`  ${one.table}: ${one.rows}`);
