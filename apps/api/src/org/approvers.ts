// Who approves what (the hub's Management (Approval) → Edit access): each Management person
// approves every division (as before) or only the ones ticked. Their piles and queue show only
// those orders, and approving one outside them is refused. The CEO and the Admin set it.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { DIVISIONS } from "../orders/divisions";
import type { Approvers, Me } from "../types";

const SETTERS = ["ceo", "admin"] as const;

export async function approvers(db: Database, me: Me): Promise<Approvers> {
  allow(me, [...SETTERS], "see who approves what");
  const people = await rows<Approvers["people"][number]>(
    db,
    sql`select p.id::int as id, p.name, p.title, p.approves,
        (select u.name from seat_holder h join seat s on s.id = h.seat_id join org_unit u on u.id = s.unit_id
          where h.person_id = p.id and h.kind = 'holder' order by h.starts_on desc limit 1) as unit
      from person p where p.active and p.role = 'management' order by p.name`,
  );
  return { people, divisions: [...DIVISIONS] };
}

export async function setApproves(
  db: Database,
  me: Me,
  personId: number,
  approves: string[] | null,
): Promise<void> {
  allow(me, [...SETTERS], "set who approves what");
  if (approves && approves.some((one) => !(DIVISIONS as readonly string[]).includes(one)))
    throw new Refusal(400, "invalid", "Pick the divisions from the list.", "approves");
  const changed = await rows(
    db,
    sql`update person set approves = ${
      approves === null
        ? null
        : approves.length === 0
          ? sql`'{}'::text[]`
          : sql`array[${sql.join(
              approves.map((one) => sql`${one}`),
              sql`, `,
            )}]::text[]`
    }
      where id = ${personId} and role = 'management' returning id`,
  );
  if (!changed.length) throw new Refusal(404, "not_found", "That isn't a Management person.");
}
