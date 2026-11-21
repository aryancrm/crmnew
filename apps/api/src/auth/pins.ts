// Each person's own PIN (Aryan, 21 Nov): everyone shares the company's password, so the PIN is what
// proves who is at the keyboard. Set once on their first sign-in; asked after the password, at the
// doors (Heads, Team leads) and on a desk's common screen before anything is done in their name.
// Five wrong PINs lock the PIN (not their login) for 15 minutes. Only a salted hash is kept.

import { eq } from "drizzle-orm";
import type { Database } from "../db/index";
import { person } from "../db/schema";
import { Refusal } from "../http";
import { hashPassword, passwordMatches } from "./password";

const MAX_WRONG = 5;
const LOCK_MINUTES = 15;

/** What a new PIN must be, in the screen's words; null when it is fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "Use 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin)) return "Don't use the same digit throughout.";
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((one, index) => one - (digits[index] as number)));
  if (steps.size === 1 && (steps.has(1) || steps.has(-1))) return "Don't use digits in a row, like 1234.";
  return null;
}

type PinPerson = Pick<typeof person.$inferSelect, "id" | "pinHash" | "pinFailed" | "pinLockedUntil">;

/** Checks a person's PIN; refuses a wrong one (and counts it) or a locked one. */
export async function checkPin(db: Database, who: PinPerson, pin: string): Promise<void> {
  if (!who.pinHash) throw new Refusal(401, "pin_setup", "Set your PIN first: sign in with Personal login.", "pin");
  if (who.pinLockedUntil && who.pinLockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((who.pinLockedUntil.getTime() - Date.now()) / 60000);
    throw new Refusal(429, "locked", `Too many wrong PINs. Try again in ${minutes} minutes.`, "pin");
  }
  if (await passwordMatches(pin, who.pinHash)) {
    if (who.pinFailed || who.pinLockedUntil)
      await db.update(person).set({ pinFailed: 0, pinLockedUntil: null }).where(eq(person.id, who.id));
    return;
  }
  const failed = who.pinFailed + 1;
  const lock = failed >= MAX_WRONG;
  await db
    .update(person)
    .set({ pinFailed: lock ? 0 : failed, pinLockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null })
    .where(eq(person.id, who.id));
  throw lock
    ? new Refusal(429, "locked", `Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes.`, "pin")
    : new Refusal(401, "wrong_pin", "Wrong PIN.", "pin");
}

export async function setPin(db: Database, personId: number, pin: string): Promise<void> {
  const problem = pinProblem(pin);
  if (problem) throw new Refusal(400, "invalid", problem, "newPin");
  await db
    .update(person)
    .set({ pinHash: await hashPassword(pin), pinSetAt: new Date(), pinFailed: 0, pinLockedUntil: null })
    .where(eq(person.id, personId));
}

/** An administrator clears a forgotten PIN; the person sets a new one on their next sign-in. */
export async function clearPin(db: Database, personId: number): Promise<void> {
  await db.update(person).set({ pinHash: null, pinSetAt: null, pinFailed: 0, pinLockedUntil: null }).where(eq(person.id, personId));
}
