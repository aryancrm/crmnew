// Gives people who have none yet a one-time password of their own (after migration 0142). Each
// chooses their own at the first sign-in. It only lists until --apply is given.
//
//   pnpm --filter @2mg/api passwords --role=admin                     who it would be
//   pnpm --filter @2mg/api passwords --role=admin --apply             one shown on the screen
//   pnpm --filter @2mg/api passwords --all --apply --out=<a new file outside the repository>
//
//   --only=hos1,tl2   just these login IDs (or emails)
//   --again           also whoever already has one (a forgotten password): theirs stops working
//
// The database is DATABASE_URL's, else the local one (PGLITE_DIR, or .data/pg): stop the API first,
// one process per PGlite folder.

import { closeSync, existsSync, fsyncSync, openSync, realpathSync, unlinkSync, writeSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/auth/password";
import { openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { freshPassword } from "../src/org/service";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const stop = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const KNOWN = /^--(all|apply|again|role=.+|only=.+|out=.+)$/;
const unknown = args.filter((arg) => !KNOWN.test(arg));
if (unknown.length) stop(`I don't know ${unknown.join(", ")}.`);
const role = value("role");
const only = value("only")?.toLowerCase().split(",").map((one) => one.trim()).filter(Boolean);
if (!flag("all") && !role && !only?.length) stop("Say who: --all, --role=admin or --only=<login>,<login>.");

const repository = realpathSync(fileURLToPath(new URL("../../..", import.meta.url)));
let out = value("out");
if (out) {
  out = resolve(process.env.INIT_CWD ?? process.cwd(), out);
  if (!existsSync(dirname(out))) stop("That file's folder doesn't exist.");
  out = join(realpathSync(dirname(out)), basename(out));
  const inside = relative(repository, out);
  if (!isAbsolute(inside) && inside.split(sep)[0] !== "..")
    stop("Keep the passwords out of the repository: give a path outside it.");
  if (existsSync(out)) stop("That file exists already: give a new one.");
}

const url = process.env.DATABASE_URL || undefined;
if (!url) {
  // Two processes on one PGlite folder can spoil it.
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

const everyone = await rows<{ id: number; name: string; role: string; email: string | null; login: string | null; pending: boolean }>(
  db,
  sql`select p.id::int as id, p.name, p.role, p.email, p.password_pending as pending,
      (select s.login from seat_holder h join seat s on s.id = h.seat_id and s.active and s.login is not null
        where h.person_id = p.id and h.kind = 'holder'
          and h.starts_on <= (now() at time zone 'Asia/Manila')::date
          and (h.ends_on is null or h.ends_on >= (now() at time zone 'Asia/Manila')::date)
        order by h.starts_on, h.id limit 1) as login
    from person p where p.active order by p.role, p.name`,
);
const chosen = everyone.filter(
  (one) =>
    (one.pending || flag("again")) &&
    (!role || one.role === role) &&
    (!only || [one.login, one.email].some((id) => id && only.includes(id.toLowerCase()))),
);
const able = chosen.filter((one) => one.login || one.email);
const without = chosen.filter((one) => !one.login && !one.email);

console.log(`${able.length} to be given a one-time password.`);
if (able.length <= 20) for (const one of able) console.log(`  ${one.login ?? one.email}  (${one.role})`);
if (without.length) console.log(`${without.length} have no login ID, so none is made for them.`);

if (!flag("apply")) {
  console.log("Nothing changed. Add --apply to do it.");
  process.exit(0);
}
if (!able.length) process.exit(0);
if (able.length > 1 && !out) stop("More than one: add --out=<a new file outside the repository>.");

const given: ((typeof able)[number] & { password: string; hash: string })[] = [];
for (const one of able) {
  const password = freshPassword();
  given.push({ ...one, password, hash: await hashPassword(password) });
}

// A spreadsheet reads a cell starting = + - @ as a formula.
const cell = (text: string) => `"${(/^[=+@-]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
try {
  // Written before the change is kept: passwords nobody has would lock everyone out.
  await db.transaction(async (tx) => {
    for (const one of given) {
      await tx.execute(
        sql`update person set password_hash = ${one.hash}, password_pending = false, must_change_password = true,
            failed_logins = 0, locked_until = null where id = ${one.id}`,
      );
      await tx.execute(sql`delete from session where person_id = ${one.id} or viewed_by = ${one.id}`);
    }
    if (!out) return;
    const file = openSync(out, "wx", 0o600);
    const lines = given.map((one) => [one.name, one.login ?? one.email ?? "", one.password].map(cell).join(","));
    writeSync(file, ["Name,Login ID,One-time password", ...lines].join("\n") + "\n");
    fsyncSync(file);
    closeSync(file);
  });
} catch (error) {
  if (out && existsSync(out)) unlinkSync(out);
  throw error;
}

if (out) console.log(`Done: ${given.length} written to ${out}. Hand them out one by one, then delete the file.`);
else for (const one of given) console.log(`\nLogin ID:           ${one.login ?? one.email}\nOne-time password:  ${one.password}`);
console.log("Each is asked to choose their own at the first sign-in.");
process.exit(0);
