// The way back when nobody can reset it on screen (the only Admin lost their phone and their
// recovery codes, or SECRETS_KEY was lost). Needs the server itself. It only lists until --apply.
//
//   pnpm --filter @2mg/api two-step-off --only=admin                  who it would be
//   pnpm --filter @2mg/api two-step-off --only=admin --apply          off; they are signed out and told
//
// The database is DATABASE_URL's, else the local one (PGLITE_DIR, or .data/pg): stop the API first.

import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { turnOff } from "../src/auth/two-step";
import { openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const stop = (message: string): never => {
  console.error(message);
  process.exit(1);
};
const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).trim().toLowerCase();
const apply = args.includes("--apply");
const unknown = args.filter((arg) => arg !== "--apply" && !arg.startsWith("--only="));
if (unknown.length) stop(`I don't know ${unknown.join(", ")}.`);
if (!only) stop("Say who: --only=<login ID or email>.");

const url = process.env.DATABASE_URL || undefined;
if (!url) {
  const port = Number(process.env.PORT ?? 4100);
  const running = await new Promise<boolean>((done) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(1500, () => {
      socket.destroy();
      done(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
  if (running) stop(`The API is running on :${port}. Stop it first (one process per local database), then run this again.`);
}

const db = openDatabase({
  url,
  dir: process.env.PGLITE_DIR ?? fileURLToPath(new URL("../../../.data/pg", import.meta.url)),
});
await migrate(db);

const found = await rows<{ id: number; name: string; role: string }>(
  db,
  sql`select p.id::int as id, p.name, p.role from person p join person_two_step t on t.person_id = p.id and t.on_at is not null
    where lower(p.email) = ${only as string} or exists (
      select 1 from seat_holder h join seat s on s.id = h.seat_id and s.active
      where h.person_id = p.id and h.kind = 'holder' and lower(s.login) = ${only as string}
        and h.starts_on <= (now() at time zone 'Asia/Manila')::date
        and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date))`,
);
if (found.length !== 1) stop(`${found.length} people with that login have two-step sign-in on.`);
const who = found[0] as (typeof found)[number];
console.log(`${who.name} (${who.role})`);
if (apply) {
  await turnOff(db, who.id, null);
  console.log("Off. They are signed out everywhere, told, and sign in with their password alone.");
} else console.log("Nothing changed. Add --apply to do it.");
process.exit(0);
