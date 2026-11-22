// Guessing a password. A try is counted in the database before it is checked, so tries sent at the
// same moment can't slip past the lock: five, then 15 minutes.
//
// Login IDs are easy to know, so others' wrong tries mustn't shut a person out: a browser they have
// signed in on before carries a "known device" cookie and has five tries of its own. The cookie is
// signed with their password's hash, so a new password ends every one of them.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { person } from "../db/schema";
import { Refusal } from "../http";
import { passwordMatches } from "./password";

const MAX_TRIES = 5;
const LOCK_MINUTES = 15;
const LOCK_MS = LOCK_MINUTES * 60 * 1000;

type Account = { id: number; passwordHash: string };

export const deviceCookie = (personId: number) => `dev_${personId}`;

const signed = (who: Account, nonce: string) =>
  createHmac("sha256", who.passwordHash).update(`${who.id}.${nonce}`).digest("base64url");

/** The cookie's value for a browser this person has just signed in on. */
export function deviceMark(who: Account): string {
  const nonce = randomBytes(18).toString("base64url");
  return `${nonce}.${signed(who, nonce)}`;
}

function deviceOf(who: Account, mark: string | undefined): string | null {
  const [nonce, given] = mark?.split(".") ?? [];
  if (!nonce || !given) return null;
  const right = Buffer.from(signed(who, nonce));
  const typed = Buffer.from(given);
  return right.length === typed.length && timingSafeEqual(right, typed) ? `${who.id}.${nonce}` : null;
}

const locked = (until: number) => {
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return new Refusal(429, "locked", `Too many wrong passwords. Try again in ${minutes} minutes.`);
};

/** One per app: whether a password is right, each try counted and locked as above. */
export function passwordGuard(db: Database) {
  const devices = new Map<string, { tries: number; until: number }>();

  return async (who: Account, password: string, mark: string | undefined): Promise<boolean> => {
    const device = deviceOf(who, mark);
    if (device) {
      // No await between reading and writing: tries sent together are each counted.
      const now = Date.now();
      let state = devices.get(device);
      if (!state || (state.until && state.until <= now)) state = { tries: 0, until: 0 };
      if (state.until) throw locked(state.until);
      state.tries += 1;
      if (state.tries >= MAX_TRIES) state.until = now + LOCK_MS;
      devices.set(device, state);
    } else {
      const [counted] = await rows<{ id: number }>(
        db,
        sql`update person set
            failed_logins = case when failed_logins + 1 >= ${MAX_TRIES}::int then 0 else failed_logins + 1 end,
            locked_until = case when failed_logins + 1 >= ${MAX_TRIES}::int
              then now() + make_interval(mins => ${LOCK_MINUTES}::int) end
          where id = ${who.id} and (locked_until is null or locked_until <= now())
          returning id::int as id`,
      );
      if (!counted) {
        const [row] = await db.select({ until: person.lockedUntil }).from(person).where(eq(person.id, who.id));
        throw locked(row?.until?.getTime() ?? Date.now() + LOCK_MS);
      }
    }
    if (!(await passwordMatches(password, who.passwordHash))) return false;
    if (device) devices.delete(device);
    await db.update(person).set({ failedLogins: 0, lockedUntil: null }).where(eq(person.id, who.id));
    return true;
  };
}
