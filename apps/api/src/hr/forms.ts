// HR's forms, asked for by people and decided like leave (whom they report to, else HR; HR may
// decide any; the CEO reads): official business (away for work: those hours count as worked and
// the day isn't late or absent), work from home (the day counts as worked) and overtime (hours
// after work, counted as approved overtime). One form of a kind a day.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean } from "../inventory/service";
import { notify, peopleIn } from "../notify/service";
import type { Role } from "../people/roles";
import type { FormInput, FormKind, FormLine, FormList, Me } from "../types";
import { ATTENDANCE_ALL_ROLES, ATTENDANCE_WRITE_ROLES, formSpan } from "./attendance";
import { approverOf } from "./leave";

const KINDS: FormKind[] = ["ob", "wfh", "ot"];
export const FORM_WORDS: Record<FormKind, string> = {
  ob: "official business",
  wfh: "work from home",
  ot: "overtime",
};
const LEAD_ROLES: Role[] = ["team_lead", "manager"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}$/;
const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

type Row = Omit<FormLine, "minutes" | "canDecide" | "canCancel" | "person"> & {
  personId: number;
  personName: string;
  team: string | null;
  approverId: number | null;
};

const columns = (
  today: string,
) => sql`f.id::int as id, f.person_id::int as "personId", p.name as "personName",
  (select u.name from seat_holder h join seat s on s.id = h.seat_id and s.active join org_unit u on u.id = s.unit_id
    where h.person_id = p.id and h.kind = 'holder' and h.starts_on <= ${today}::date
      and (h.ends_on is null or h.ends_on >= ${today}::date) order by h.starts_on limit 1) as team,
  f.kind, to_char(f.day, 'YYYY-MM-DD') as day, to_char(f.from_time, 'HH24:MI') as "from",
  to_char(f.to_time, 'HH24:MI') as "to", f.place, f.reason, f.status, f.approver_id::int as "approverId",
  a.name as approver, d.name as "decidedBy", f.decision_note as "decisionNote"`;
const fromForms = sql`from hr_form f join person p on p.id = f.person_id left join person a on a.id = f.approver_id
  left join person d on d.id = f.decided_by`;

const mayDecide = (me: Me, row: { personId: number; approverId: number | null; status: string }) =>
  row.status === "asked" &&
  !me.viewedBy &&
  me.id !== row.personId &&
  (row.approverId === me.id || ATTENDANCE_WRITE_ROLES.includes(me.role));
const mayCancel = (me: Me, row: { personId: number; status: string; day: string }, today: string) =>
  !me.viewedBy &&
  (ATTENDANCE_WRITE_ROLES.includes(me.role)
    ? row.status === "asked" || row.status === "approved"
    : me.id === row.personId &&
      (row.status === "asked" || (row.status === "approved" && row.day > today)));

function toLines(me: Me, found: Row[]): FormLine[] {
  const today = todayManila();
  return found.map(({ personId, personName, team, approverId, ...one }) => ({
    ...one,
    person: { id: personId, name: personName, team },
    minutes: formSpan(one),
    canDecide: mayDecide(me, { personId, approverId, status: one.status }),
    canCancel: mayCancel(me, { personId, status: one.status, day: one.day }, today),
  }));
}

export async function requestForm(db: Database, me: Me, input: FormInput): Promise<{ id: number }> {
  if (me.viewedBy) throw new Refusal(403, "not_allowed", "Look-only: nothing changes.");
  if (me.role === "ceo" || me.role === "admin")
    throw new Refusal(403, "not_allowed", "The CEO's and the Admin's forms are kept by HR.");
  if (!KINDS.includes(input.kind)) throw new Refusal(400, "invalid", "Pick the form.", "kind");
  const today = todayManila();
  if (!DAY.test(input.day) || input.day < addDays(today, -30) || input.day > addDays(today, 60))
    throw new Refusal(400, "invalid", "Pick a day from a month back to two months ahead.", "day");
  const reason = clean(input.reason);
  if (!reason) throw new Refusal(400, "invalid", "Say what it was for.", "reason");
  let fromTime: string | null = null;
  let toTime: string | null = null;
  if (input.kind !== "wfh") {
    if (
      !input.from ||
      !CLOCK.test(input.from) ||
      !input.to ||
      !CLOCK.test(input.to) ||
      input.to <= input.from
    )
      throw new Refusal(400, "invalid", "Pick when it started and when it ended.", "to");
    fromTime = input.from;
    toTime = input.to;
  }
  const place = clean(input.place) ?? null;
  if (input.kind === "ob" && !place)
    throw new Refusal(400, "invalid", "Say where you were.", "place");
  const approver = await approverOf(db, me.id);
  return db.transaction(async (tx) => {
    const [taken] = await rows<{ id: number }>(
      tx,
      sql`select id::int as id from hr_form where person_id = ${me.id} and kind = ${input.kind}
        and day = ${input.day}::date and status in ('asked', 'approved')`,
    );
    if (taken)
      throw new Refusal(
        409,
        "taken",
        `You already have a ${FORM_WORDS[input.kind]} form on ${dayWords(input.day)}.`,
        "day",
      );
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into hr_form (person_id, kind, day, from_time, to_time, place, reason, approver_id, made_by)
        values (${me.id}, ${input.kind}, ${input.day}::date, ${fromTime}::time, ${toTime}::time, ${place}, ${reason},
          ${approver?.id ?? null}, ${me.id})
        returning id::int as id`,
    );
    const id = made?.id as number;
    await notify(tx, {
      to: approver ? [approver.id] : await peopleIn(tx, ["hr"]),
      kind: "form_request",
      title: `${me.name} files ${FORM_WORDS[input.kind]}: ${dayWords(input.day)}${fromTime ? ` ${fromTime}–${toTime}` : ""}`,
      body: reason,
      link: "/hr/leave?of=forms&view=waiting",
      key: `form:${id}:asked`,
    });
    return { id };
  });
}

export async function decideForm(
  db: Database,
  me: Me,
  formId: number,
  input: { approve: boolean; note?: string | null },
): Promise<void> {
  const note = clean(input.note) ?? null;
  if (!input.approve && !note)
    throw new Refusal(400, "invalid", "Say why it can't be given.", "note");
  await db.transaction(async (tx) => {
    const [row] = await rows<{
      personId: number;
      approverId: number | null;
      status: string;
      kind: FormKind;
      day: string;
    }>(
      tx,
      sql`select person_id::int as "personId", approver_id::int as "approverId", status, kind,
          to_char(day, 'YYYY-MM-DD') as day from hr_form where id = ${formId} for update`,
    );
    if (!row) throw new Refusal(404, "not_found", "No such form.");
    if (row.status !== "asked")
      throw new Refusal(409, "invalid", "That form isn't waiting for a decision.");
    if (!mayDecide(me, row))
      throw new Refusal(
        403,
        "not_allowed",
        "Forms are decided by whom the person reports to, or HR.",
      );
    await tx.execute(
      sql`update hr_form set status = ${input.approve ? "approved" : "refused"}, decided_by = ${me.id},
          decided_at = now(), decision_note = ${note} where id = ${formId}`,
    );
    await notify(tx, {
      to: [row.personId],
      kind: input.approve ? "form_approved" : "form_refused",
      title: `Your ${FORM_WORDS[row.kind]} (${dayWords(row.day)}) was ${input.approve ? "approved" : "not approved"} by ${me.name}`,
      body: note,
      link: "/me/leave",
      key: `form:${formId}:decided`,
    });
  });
}

export async function cancelForm(db: Database, me: Me, formId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await rows<{ personId: number; status: string; day: string }>(
      tx,
      sql`select person_id::int as "personId", status, to_char(day, 'YYYY-MM-DD') as day
        from hr_form where id = ${formId} for update`,
    );
    if (!row) throw new Refusal(404, "not_found", "No such form.");
    if (!mayCancel(me, row, todayManila()))
      throw new Refusal(
        403,
        "not_allowed",
        "Only the person (before the day) or HR cancels a form.",
      );
    await tx.execute(
      sql`update hr_form set status = 'cancelled', cancelled_by = ${me.id}, cancelled_at = now() where id = ${formId}`,
    );
  });
}

/** A person's own forms: this year's, and any ahead. */
export async function myForms(db: Database, me: Me): Promise<FormLine[]> {
  const today = todayManila();
  return toLines(
    me,
    await rows<Row>(
      db,
      sql`select ${columns(today)} ${fromForms}
        where f.person_id = ${me.id}
          and (extract(year from f.day) = ${Number(today.slice(0, 4))} or f.day >= ${today}::date)
        order by f.day desc, f.id desc`,
    ),
  );
}

/** Forms for HR (everyone), the CEO and Management (to read) and a team lead (their team). */
export async function formList(
  db: Database,
  me: Me,
  asked: { view?: string | null; month?: string | null },
): Promise<FormList> {
  const everyone = ATTENDANCE_ALL_ROLES.includes(me.role) || me.role === "management";
  if (!everyone && !LEAD_ROLES.includes(me.role))
    throw new Refusal(403, "not_allowed", "Forms are for HR, team leads and the CEO.");
  const today = todayManila();
  const scope = everyone
    ? sql`true`
    : sql`f.person_id in (with recursive team as (select id from person where id = ${me.id}
        union all select q.id from person q join team t on q.reports_to = t.id) select id from team where id <> ${me.id})`;
  const month = asked.month && /^\d{4}-\d{2}$/.test(asked.month) ? asked.month : null;
  const inMonth = month ? sql`and to_char(f.day, 'YYYY-MM') = ${month}` : sql``;
  const lines = toLines(
    me,
    await rows<Row>(
      db,
      sql`select ${columns(today)} ${fromForms} where ${scope} ${inMonth} order by f.day desc, f.id desc limit 500`,
    ),
  );
  const view = asked.view ?? "waiting";
  return {
    lines:
      view === "waiting"
        ? lines.filter((one) => one.canDecide)
        : ["asked", "approved", "refused", "cancelled"].includes(view)
          ? lines.filter((one) => one.status === view)
          : lines,
    counts: {
      waiting: lines.filter((one) => one.canDecide).length,
      asked: lines.filter((one) => one.status === "asked").length,
      approved: lines.filter((one) => one.status === "approved").length,
      refused: lines.filter((one) => one.status === "refused").length,
      cancelled: lines.filter((one) => one.status === "cancelled").length,
    },
  };
}
