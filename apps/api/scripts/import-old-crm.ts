// Brings the old CRM's enquiries (crm.lead) into this CRM, with their Messenger chat and the
// notes staff typed. The old database is only read (a read-only transaction). Dry run by
// default; --apply writes. Safe to run again: a case keeps the old record's id (legacy_id), so a
// second run adds only what is missing (a page connected since links its chats and messages).
//
//   OLD_ENV=~/Projects/crm/.env  (its DATABASE_URL is the old database)
//   DATABASE_URL=<this CRM's database>  (or in crmnew/.env)
//   npx tsx scripts/import-old-crm.ts [--apply]

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { openDatabase } from "../src/db/index";
import { importOldLeads, type OldLead, type OldMessage } from "../src/online/legacy-import";
import { migrate } from "../src/db/migrate";

const apply = process.argv.includes("--apply");

function envFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
}

const oldUrl = envFile(process.env.OLD_ENV ?? join(homedir(), "Projects/crm/.env")).DATABASE_URL;
const newUrl =
  process.env.DATABASE_URL ?? envFile(join(import.meta.dirname, "../../../.env")).DATABASE_URL;
if (!oldUrl) throw new Error("No old DATABASE_URL (OLD_ENV).");
// TEST_PGLITE_DIR: try it on a copy of a local database first.
const testDir = process.env.TEST_PGLITE_DIR;
if (!newUrl && !testDir) throw new Error("No DATABASE_URL for this CRM (crmnew/.env).");

const old = postgres(oldUrl, { prepare: false, max: 1 });
const db = testDir ? openDatabase({ dir: testDir }) : openDatabase({ url: newUrl });
if (testDir) await migrate(db);

const { leads, messages } = await old.begin("read only", async (tx) => {
  const leads = (await tx`
    select l.id::text, l.created_at, l.updated_at, l.name, l.email, l.phone, l.message, l.interest, l.source,
      u.email as assigned_email, l.state, l.note, l.quote, l.city, l.address, l.assistance, l.agency, l.first_contact,
      l.relation, l.patient_name, l.patient, l.messenger_psid, l.messenger_page_id, l.lost_reason,
      l.last_message, l.last_message_at
    from crm.lead l left join identity."user" u on u.id = l.assigned_to::text
    where l.active order by coalesce(l.first_contact::timestamptz, l.created_at), l.no`) as unknown as OldLead[];
  const messages = (await tx`
    select m.id::text, m.record_id::text, m.body, m.data, m.created_at from core.messages m
    where m.model = 'crm.lead' and m.kind = 'note' and m.record_id in (select id from crm.lead where active)
    order by m.created_at, m.id`) as unknown as OldMessage[];
  return { leads, messages };
});
await old.end();

if (process.env.EXPORT_JSON) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.EXPORT_JSON, JSON.stringify({ leads, messages }));
  console.log(`Wrote ${leads.length} leads and ${messages.length} messages to ${process.env.EXPORT_JSON}`);
}
if (process.env.EXPORT_ONLY) process.exit(0);
const said = await importOldLeads(db, leads, messages, apply);
console.log(apply ? "Applied:" : "Dry run (nothing written; add --apply):", said);
process.exit(0);
