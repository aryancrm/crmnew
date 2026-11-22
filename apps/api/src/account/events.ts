// What was done to an account and by whom, shown to its person on Profile > Security. Never a
// secret, a code or a private value.

import { sql } from "drizzle-orm";
import { rows } from "../db/index";
import type { Runner } from "../inventory/service";

export const ACCOUNT_EVENT = {
  accepted: "Sign-up accepted",
  password_set: "Password set from the acceptance email",
  name: "Name changed",
  details: "Personal details changed",
  contact: "Contact details changed",
  photo: "Profile picture changed",
  photo_removed: "Profile picture removed",
  password: "Password changed",
  password_given: "One-time password given",
  two_step_on: "Two-step sign-in turned on",
  two_step_off: "Two-step sign-in turned off",
  two_step_reset: "Two-step sign-in reset",
  two_step_locked: "Too many wrong sign-in codes",
  recovery_used: "Recovery code used",
  recovery_renewed: "New recovery codes made",
  devices: "Other devices signed out",
} as const;

export type AccountEventKind = keyof typeof ACCOUNT_EVENT;

/** Writes it down; answers its id. `by` is null when it was done from the server. */
export async function accountEvent(
  db: Runner,
  personId: number,
  by: number | null,
  kind: AccountEventKind,
  detail: string | null = null,
): Promise<number> {
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into account_event (person_id, by_person, kind, detail)
      values (${personId}, ${by}, ${kind}, ${detail}) returning id::int as id`,
  );
  return made?.id as number;
}
