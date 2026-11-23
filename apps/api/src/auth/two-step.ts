// Two-step sign-in, as Bishnoi One has it: after the password, the code from an authenticator app,
// or one of ten recovery codes (each once). Optional, and each person turns on their own.
//
// The key is sealed in the database and tied to its person; a code never works twice; a try is
// counted before it is checked, apart from wrong passwords, so knowing the password buys no more
// tries. A new password never turns it off: whoever can give someone a password (HR, the Admin)
// still can't sign in as them without saying so (the Admin's reset, which the person is told of).

import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { accountEvent } from "../account/events";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import type { Runner } from "../inventory/service";
import { notify } from "../notify/service";
import { seal, unseal } from "../online/secrets";
import { newKey, setupUri, stepOfCode } from "./totp";

const TICKET_MINUTES = 5;
const SETUP_MINUTES = 15;
const TRIES = 5;
const CODES = 10;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const recoveryHash = (personId: number, code: string) => sha(`${personId}:${code}`);

const sealFor = (personId: number, key: string) => seal(`${personId}:${key}`);

/** The key, if it opens with this server's SECRETS_KEY and is this person's. */
function openFor(personId: number, sealed: string): string {
  let text = "";
  try {
    text = unseal(sealed);
  } catch {
    // Said below: the channels' own words don't fit here.
  }
  if (!text.startsWith(`${personId}:`))
    throw new Refusal(
      409,
      "two_step_unreadable",
      "Your two-step sign-in can't be read on this server. Ask your administrator to reset it.",
    );
  return text.slice(`${personId}:`.length);
}

/** A key sealed with the code's built-in local key would protect nothing on a real server. */
function canSeal(): void {
  if (!process.env.SECRETS_KEY && (process.env.NODE_ENV === "production" || process.env.DATABASE_URL))
    throw new Refusal(
      409,
      "not_ready",
      "Two-step sign-in isn't ready on this server yet: your administrator needs to set SECRETS_KEY.",
    );
}

export async function twoStepOn(db: Runner, personId: number): Promise<boolean> {
  const [found] = await rows<{ on: boolean }>(
    db,
    sql`select on_at is not null as on from person_two_step where person_id = ${personId}`,
  );
  return found?.on === true;
}

function newRecovery(personId: number) {
  const plain = Array.from({ length: CODES }, () => randomBytes(8).toString("hex").toUpperCase());
  return {
    shown: plain.map((code) => code.replace(/(.{4})(?=.)/g, "$1-")),
    hashes: plain.map((code) => recoveryHash(personId, code)),
  };
}

const hashList = (hashes: string[]) =>
  sql`array[${sql.join(
    hashes.map((one) => sql`${one}`),
    sql`, `,
  )}]::text[]`;

const lockedError = (until: string | number | Date) => {
  const minutes = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000));
  const when = minutes < 120 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : `${Math.ceil(minutes / 60)} hours`;
  return new Refusal(429, "code_locked", `Too many wrong codes. Try again in ${when}.`, "code");
};

/** Counts the try first (so tries sent together are each counted); refuses while locked. Five
 *  wrong wait 15 minutes, five more 30, and on, up to a day, until a right one. */
async function countTry(db: Database, personId: number) {
  const [counted] = await rows<{ failed: number }>(
    db,
    sql`update person_two_step set
        failed = failed + 1,
        locked_until = case when (failed + 1) % ${TRIES}::int = 0
          then now() + make_interval(mins => least(1440, (15 * power(2, least(7, (failed + 1) / ${TRIES}::int - 1)))::int)) end
      where person_id = ${personId} and (locked_until is null or locked_until <= now())
      returning failed::int as failed`,
  );
  if (counted) return counted.failed;
  const [row] = await rows<{ until: string | null }>(
    db,
    sql`select locked_until as until from person_two_step where person_id = ${personId}`,
  );
  if (row?.until) throw lockedError(row.until);
  throw new Refusal(409, "not_now", "Two-step sign-in isn't on.");
}

const clearTries = (db: Database, personId: number) =>
  db.execute(sql`update person_two_step set failed = 0, locked_until = null where person_id = ${personId}`);

/** Takes a code from the app or a recovery code and uses it up; refuses a wrong one. */
export async function useCode(db: Database, personId: number, typed: string): Promise<"app" | "recovery"> {
  const failed = await countTry(db, personId);
  const [row] = await rows<{ secret: string | null }>(
    db,
    sql`select secret from person_two_step where person_id = ${personId} and on_at is not null`,
  );
  if (!row?.secret) throw new Refusal(409, "not_now", "Two-step sign-in isn't on.");
  const code = typed.replace(/[\s-]/g, "").toUpperCase();

  if (/^\d{6}$/.test(code)) {
    const step = stepOfCode(openFor(personId, row.secret), code);
    if (step !== null) {
      const taken = await rows(
        db,
        sql`update person_two_step set last_step = ${step}::bigint
          where person_id = ${personId} and (last_step is null or last_step < ${step}::bigint) returning person_id`,
      );
      if (taken.length) {
        await clearTries(db, personId);
        return "app";
      }
    }
  } else if (/^[0-9A-F]{16}$/.test(code)) {
    const hash = recoveryHash(personId, code);
    const [used] = await rows<{ left: number }>(
      db,
      sql`update person_two_step set recovery = array_remove(recovery, ${hash}::text)
        where person_id = ${personId} and ${hash}::text = any(recovery)
        returning cardinality(recovery)::int as left`,
    );
    if (used) {
      await clearTries(db, personId);
      const event = await accountEvent(db, personId, personId, "recovery_used", `${used.left} left`);
      await notify(db, {
        to: [personId],
        kind: "account",
        title: "A recovery code was used on your account",
        body: `${used.left} left. If it wasn't you, change your password and make new codes.`,
        link: "/profile/security",
        key: `account-${event}`,
      });
      return "recovery";
    }
  }

  if (failed % TRIES === 0) {
    const event = await accountEvent(db, personId, null, "two_step_locked");
    await notify(db, {
      to: [personId],
      kind: "account",
      title: "Someone entered wrong sign-in codes on your account",
      body: "They had your password. If it wasn't you, change it now.",
      link: "/profile/security",
      key: `account-${event}`,
    });
  }
  throw new Refusal(
    400,
    "wrong_code",
    "That code isn't right, or was used already. Enter the newest one in your app.",
    "code",
  );
}

// ---- setting up and turning off (the caller has checked the password)

export async function startSetup(db: Database, personId: number, account: string) {
  canSeal();
  const key = newKey();
  const [saved] = await rows(
    db,
    sql`insert into person_two_step (person_id, pending, pending_at) values (${personId}, ${sealFor(personId, key)}, now())
      on conflict (person_id) do update set pending = excluded.pending, pending_at = excluded.pending_at
        where person_two_step.on_at is null
      returning person_id`,
  );
  if (!saved)
    throw new Refusal(409, "not_now", "Two-step sign-in is already on. Turn it off first to move it to another phone.");
  return { key, uri: setupUri(account, key) };
}

export async function confirmSetup(db: Database, personId: number, typed: string): Promise<string[]> {
  const [row] = await rows<{ pending: string }>(
    db,
    sql`select pending from person_two_step
      where person_id = ${personId} and on_at is null and pending is not null
        and pending_at > now() - make_interval(mins => ${SETUP_MINUTES}::int)`,
  );
  if (!row) throw new Refusal(409, "not_now", "That took too long. Start again and scan the new QR code.");
  await countTry(db, personId);
  const step = stepOfCode(openFor(personId, row.pending), typed.replace(/\s/g, ""));
  if (step === null)
    throw new Refusal(400, "wrong_code", "That code isn't right. Enter the newest one the app shows.", "code");
  const { shown, hashes } = newRecovery(personId);
  await db.transaction(async (tx) => {
    const turned = await rows(
      tx,
      sql`update person_two_step set secret = pending, pending = null, pending_at = null, on_at = now(),
          recovery = ${hashList(hashes)}, last_step = ${step}::bigint, failed = 0, locked_until = null
        where person_id = ${personId} and on_at is null and pending = ${row.pending} returning person_id`,
    );
    if (!turned.length) throw new Refusal(409, "not_now", "Start again and scan the new QR code.");
    await accountEvent(tx, personId, personId, "two_step_on");
  });
  return shown;
}

export async function renewRecovery(db: Database, personId: number): Promise<string[]> {
  const { shown, hashes } = newRecovery(personId);
  await db.transaction(async (tx) => {
    await tx.execute(sql`update person_two_step set recovery = ${hashList(hashes)} where person_id = ${personId}`);
    await accountEvent(tx, personId, personId, "recovery_renewed");
  });
  return shown;
}

/** Off: by the person, or reset for them by the Admin (`by`) or from the server (`by` null). */
export async function turnOff(db: Database, personId: number, by: number | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    const off = await rows(
      tx,
      sql`update person_two_step set secret = null, pending = null, pending_at = null, on_at = null,
          recovery = '{}', last_step = null, failed = 0, locked_until = null
        where person_id = ${personId} and on_at is not null returning person_id`,
    );
    if (!off.length) return false;
    await tx.execute(sql`delete from sign_in_ticket where person_id = ${personId}`);
    const own = by === personId;
    const event = await accountEvent(tx, personId, by, own ? "two_step_off" : "two_step_reset");
    if (!own) {
      await tx.execute(sql`delete from session where person_id = ${personId} or viewed_by = ${personId}`);
      await notify(tx, {
        to: [personId],
        kind: "account",
        title: "Your two-step sign-in was reset",
        body: "Set it up again on your phone. If you didn't ask for this, tell your administrator.",
        link: "/profile/security",
        key: `account-${event}`,
      });
    }
    return true;
  });
}

// ---- the sign-in waiting for its code

export async function makeTicket(
  db: Database,
  who: { id: number; passwordHash: string },
  workspace: string | null,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.execute(sql`delete from sign_in_ticket where expires_at <= now()`);
  await db.execute(
    sql`insert into sign_in_ticket (token_hash, person_id, password_hash, workspace, expires_at)
      values (${sha(token)}, ${who.id}, ${who.passwordHash}, ${workspace},
        now() + make_interval(mins => ${TICKET_MINUTES}::int))`,
  );
  return token;
}

export const signInAgain = () =>
  new Refusal(401, "sign_in_again", "This sign-in took too long. Enter your password again.");

export async function readTicket(db: Database, token: string) {
  const [found] = await rows<{ personId: number; passwordHash: string; workspace: string | null }>(
    db,
    sql`select t.person_id::int as "personId", t.password_hash as "passwordHash", t.workspace
      from sign_in_ticket t join person p on p.id = t.person_id
      where t.token_hash = ${sha(token)} and t.expires_at > now()
        and p.active and not p.password_pending and p.password_hash = t.password_hash`,
  );
  if (!found) throw signInAgain();
  return found;
}

/** The ticket is used up; of two sent together only one signs in. */
export async function spendTicket(db: Database, token: string): Promise<void> {
  const gone = await rows(db, sql`delete from sign_in_ticket where token_hash = ${sha(token)} returning person_id`);
  if (!gone.length) throw signInAgain();
}
