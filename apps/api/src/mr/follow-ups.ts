// Follow-ups in the MR App: what to do next for a client (visit again, an order, a payment, a
// product, a chance), made when a call closes or added by hand; overdue, upcoming, done.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, iso } from "../inventory/service";
import type { Me } from "../types";
import { accessOf, mustSee, mustWork } from "./access";
import { FOLLOW_UP_KINDS, type FollowUpKind, type FollowUpRow } from "./words";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function followUpList(
  db: Database,
  me: Me,
  asked: { status?: string | null; person?: string | null },
): Promise<FollowUpRow[]> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The MR App is for its MRs and their team lead.");
  const everyone = access !== "mr" && (asked.person === "all" || (!asked.person && access === "viewer"));
  const personId = everyone ? null : Number(asked.person) || me.id;
  if (personId !== null) await mustSee(db, me, personId);
  const done = asked.status === "done";
  return rows<FollowUpRow>(
    db,
    sql`select f.id::int as id, to_char(f.due_on, 'YYYY-MM-DD') as "dueOn", f.kind, f.what, f.status,
        json_build_object('id', c.id::int, 'name', c.name, 'kind', c.kind) as client,
        json_build_object('id', p.id::int, 'name', p.name) as person, f.visit_id::int as "visitId",
        ${iso("f.done_at")} as "doneAt", f.done_note as "doneNote"
      from mr_follow_up f join mr_client c on c.id = f.client_id join person p on p.id = f.person_id
      where ${personId === null ? sql`true` : sql`f.person_id = ${personId}`}
        and ${done ? sql`f.status in ('done', 'dropped')` : sql`f.status = 'open'`}
      order by ${done ? sql`f.done_at desc` : sql`f.due_on`}, f.id limit 400`,
  );
}

export async function addFollowUp(
  db: Database,
  me: Me,
  input: { clientId: number; dueOn: string; kind: FollowUpKind; what: string },
): Promise<{ id: number }> {
  await mustWork(db, me);
  if (!DAY.test(input.dueOn) || input.dueOn < todayManila()) throw new Refusal(400, "invalid", "Pick the day: today or later.", "dueOn");
  if (!FOLLOW_UP_KINDS.includes(input.kind)) throw new Refusal(400, "invalid", "Pick what it is.", "kind");
  const what = clean(input.what);
  if (!what) throw new Refusal(400, "invalid", "Say what to follow up.", "what");
  const [client] = await rows<{ id: number }>(db, sql`select id::int as id from mr_client where id = ${input.clientId} and active`);
  if (!client) throw new Refusal(400, "invalid", "Pick the client from the list.", "clientId");
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into mr_follow_up (person_id, client_id, due_on, kind, what)
      values (${me.id}, ${client.id}, ${input.dueOn}::date, ${input.kind}, ${what.slice(0, 300)}) returning id::int as id`,
  );
  return { id: made?.id as number };
}

export async function closeFollowUp(db: Database, me: Me, id: number, input: { drop?: boolean; note?: string | null }): Promise<void> {
  await mustWork(db, me);
  const note = clean(input.note) ?? null;
  if (input.drop && !note) throw new Refusal(400, "invalid", "Say why it is dropped.", "note");
  const changed = await rows<{ id: number }>(
    db,
    sql`update mr_follow_up set status = ${input.drop ? "dropped" : "done"}, done_at = now(), done_note = ${note}
      where id = ${id} and person_id = ${me.id} and status = 'open' returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(409, "invalid", "That follow-up isn't open, or isn't yours.");
}
