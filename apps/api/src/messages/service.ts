// Messages between the people of the company, instead of email between departments: one person
// to another (one thread per two people), to a team (everyone in a box of the tree and under it,
// as the tree is when it is sent), to a few people picked, and announcements, one way, to a team
// or to everyone. Anyone may write to anyone and to the team they sit in; a team lead to the teams
// they lead and those under; the CEO and the Admin to any team and to everyone, and only they
// announce to everyone. A thread keeps who was on it and when each last read it.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { iso, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import { inForce } from "../org/service";
import type { Role } from "../people/roles";
import type {
  Me,
  MessageAddressBook,
  MessageInput,
  MessageThread,
  MessageThreadRow,
  MessageThreads,
} from "../types";

const WHOLE: Role[] = ["ceo", "admin"];
const LEADS: Role[] = ["team_lead", "manager"];
const MAX_BODY = 4000;

const ids = (values: number[]): SQL =>
  values.length
    ? sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )
    : sql`0`;

/** The boxes a person may write to: any for the CEO and the Admin; a lead those they lead and
 *  those under them; everyone the box they sit in. */
async function unitsFor(db: Runner, me: Me): Promise<number[]> {
  const today = todayManila();
  const found = await rows<{ id: number }>(
    db,
    WHOLE.includes(me.role)
      ? sql`select id::int as id from org_unit where active`
      : sql`with recursive mine as (
            select s.unit_id as id, s.lead from seat_holder h join seat s on s.id = h.seat_id and s.active
            where h.person_id = ${me.id} and ${inForce("h", today)}),
          down as (select id from mine where lead
            union all select u.id from org_unit u join down on u.parent_id = down.id where u.active)
          select id::int as id from down union select id::int as id from mine`,
  );
  return found.map((row) => row.id);
}

/** Everyone sitting (or covering) in a box and the boxes under it, today. */
async function peopleOfUnit(db: Runner, unitId: number): Promise<number[]> {
  const found = await rows<{ id: number }>(
    db,
    sql`with recursive down as (select id from org_unit where id = ${unitId} and active
        union all select u.id from org_unit u join down on u.parent_id = down.id where u.active)
      select distinct p.id::int as id from seat_holder h join seat s on s.id = h.seat_id and s.active
        join person p on p.id = h.person_id and p.active
      where s.unit_id in (select id from down) and ${inForce("h", todayManila())}`,
  );
  return found.map((row) => row.id);
}

/** Whether a person leads a box (or one above it), so may announce to it. */
async function leads(db: Runner, me: Me, unitId: number): Promise<boolean> {
  if (WHOLE.includes(me.role)) return true;
  if (!LEADS.includes(me.role)) return false;
  const [found] = await rows<{ id: number }>(
    db,
    sql`with recursive up as (select id, parent_id from org_unit where id = ${unitId}
        union all select u.id, u.parent_id from org_unit u join up on u.id = up.parent_id)
      select s.id::int as id from seat s join seat_holder h on h.seat_id = s.id
      where s.active and s.lead and s.unit_id in (select id from up) and h.person_id = ${me.id}
        and ${inForce("h", todayManila())} limit 1`,
  );
  return Boolean(found);
}

export async function addressBook(db: Database, me: Me): Promise<MessageAddressBook> {
  const today = todayManila();
  const unitIds = await unitsFor(db, me);
  const [people, units] = await Promise.all([
    rows<MessageAddressBook["people"][number]>(
      db,
      sql`select p.id::int as id, p.name, p.title, seat.login, seat.team from person p
        left join lateral (select s.login, u.name as team from seat_holder h join seat s on s.id = h.seat_id and s.active
          join org_unit u on u.id = s.unit_id where h.person_id = p.id and h.kind = 'holder' and ${inForce("h", today)}
          order by h.starts_on limit 1) seat on true
        where p.active and p.id <> ${me.id} order by p.name`,
    ),
    rows<{ id: number; name: string; parentId: number | null; sort: number }>(
      db,
      sql`select id::int as id, name, parent_id::int as "parentId", sort::int as sort from org_unit
        where active and id in (${ids(unitIds)}) order by sort, id`,
    ),
  ]);
  // Count each box's people in one read.
  const counts = await rows<{ unitId: number; people: number }>(
    db,
    sql`with recursive tree as (select id as top, id from org_unit where id in (${ids(unitIds)})
        union all select tree.top, u.id from org_unit u join tree on u.parent_id = tree.id where u.active)
      select tree.top::int as "unitId", count(distinct h.person_id)::int as people
      from tree join seat s on s.unit_id = tree.id and s.active
        join seat_holder h on h.seat_id = s.id and ${inForce("h", today)}
        join person p on p.id = h.person_id and p.active
      group by tree.top`,
  );
  // In the tree's reading order: each box, then the boxes under it.
  const ordered: MessageAddressBook["units"] = [];
  const inList = new Set(units.map((unit) => unit.id));
  const walk = (unit: (typeof units)[number]) => {
    ordered.push({
      id: unit.id,
      name: unit.name,
      people: counts.find((row) => row.unitId === unit.id)?.people ?? 0,
    });
    for (const child of units.filter((one) => one.parentId === unit.id)) walk(child);
  };
  for (const root of units.filter((unit) => unit.parentId === null || !inList.has(unit.parentId)))
    walk(root);
  return {
    people,
    units: ordered.filter((unit) => unit.people > 0),
    can: {
      everyone: WHOLE.includes(me.role),
      announce: WHOLE.includes(me.role) || LEADS.includes(me.role),
    },
  };
}

const threadColumns = (
  me: Me,
) => sql`t.id::int as id, t.kind, t.title, t.everyone, t.unit_id::int as "unitId",
  c.name as "createdBy",
  (select count(*) from message_member x where x.thread_id = t.id)::int as members,
  (select count(*) from message m where m.thread_id = t.id and m.by_person <> ${me.id}
    and (mm.read_at is null or m.at > mm.read_at))::int as unread,
  (select json_build_object('by', b.name, 'body', left(m.body, 160), 'at', ${iso("m.at")})
    from message m join person b on b.id = m.by_person where m.thread_id = t.id order by m.at desc, m.id desc limit 1) as last,
  (select o.name from message_member y join person o on o.id = y.person_id
    where y.thread_id = t.id and y.person_id <> ${me.id} order by o.name limit 1) as other,
  (select u.name from org_unit u where u.id = t.unit_id) as unit`;

type ThreadRow = Omit<MessageThreadRow, "title" | "to"> & {
  title: string | null;
  everyone: boolean;
  unitId: number | null;
  other: string | null;
  unit: string | null;
};

function named(row: ThreadRow): MessageThreadRow {
  const { everyone, unitId: _unit, other, unit, title, ...rest } = row;
  const to = everyone
    ? "Everyone"
    : unit
      ? `${unit} (${row.members} people)`
      : row.kind === "direct"
        ? (other ?? "")
        : `${row.members} people`;
  return {
    ...rest,
    title:
      row.kind === "direct"
        ? (other ?? "Someone who left")
        : (title ?? unit ?? (everyone ? "Everyone" : to)),
    to,
  };
}

export async function myThreads(db: Database, me: Me): Promise<MessageThreads> {
  const found = await rows<ThreadRow>(
    db,
    sql`select ${threadColumns(me)} from message_thread t join message_member mm on mm.thread_id = t.id and mm.person_id = ${me.id}
      join person c on c.id = t.created_by order by t.last_at desc, t.id desc limit 200`,
  );
  const threads = found.map(named);
  return { threads, unread: threads.filter((thread) => thread.unread > 0).length };
}

export async function openThread(db: Database, me: Me, threadId: number): Promise<MessageThread> {
  const [row] = await rows<ThreadRow & { creatorId: number }>(
    db,
    sql`select ${threadColumns(me)}, t.created_by::int as "creatorId" from message_thread t
      join message_member mm on mm.thread_id = t.id and mm.person_id = ${me.id}
      join person c on c.id = t.created_by where t.id = ${threadId}`,
  );
  if (!row) throw new Refusal(404, "not_found", "That conversation isn't yours to read.");
  // Opening it is reading it (not when the CEO is only looking as them).
  if (!me.viewedBy)
    await db.execute(
      sql`update message_member set read_at = now() where thread_id = ${threadId} and person_id = ${me.id}`,
    );
  const [messages, people] = await Promise.all([
    rows<MessageThread["messages"][number]>(
      db,
      sql`select * from (select m.id::int as id, m.by_person::int as "byId", b.name as by, m.body, ${iso("m.at")} as at,
          (m.by_person = ${me.id}) as mine
        from message m join person b on b.id = m.by_person where m.thread_id = ${threadId}
        order by m.at desc, m.id desc limit 300) recent order by at, id`,
    ),
    rows<MessageThread["people"][number]>(
      db,
      sql`select p.id::int as id, p.name, p.title,
          (x.read_at is not null and x.read_at >= (select max(m.at) from message m where m.thread_id = x.thread_id)) as read
        from message_member x join person p on p.id = x.person_id where x.thread_id = ${threadId} order by read desc, p.name`,
    ),
  ]);

  const { creatorId, ...thread } = row;
  return {
    ...named({ ...thread, unread: 0 }),
    messages,
    people,
    can: { reply: row.kind !== "announcement" || creatorId === me.id },
  };
}

function bodyOf(text: string): string {
  const body = text.trim();
  if (!body) throw new Refusal(400, "invalid", "Write the message.", "body");
  if (body.length > MAX_BODY)
    throw new Refusal(400, "invalid", `Keep it under ${MAX_BODY} characters.`, "body");
  return body;
}

/** Writes a new message: a thread for it (one per two people for a direct one), its people, it. */
export async function sendMessage(
  db: Database,
  me: Me,
  input: MessageInput,
): Promise<{ threadId: number }> {
  const body = bodyOf(input.body);
  const announce = Boolean(input.announcement);
  const title = input.title?.trim() || null;
  let members: number[];
  let kind: MessageThreadRow["kind"] = announce ? "announcement" : "group";
  let unitId: number | null = null;
  let everyone = false;
  let directKey: string | null = null;

  if (input.to.kind === "everyone") {
    if (!WHOLE.includes(me.role))
      throw new Refusal(403, "not_allowed", "Only the CEO and the Admin write to everyone.");
    everyone = true;
    members = (
      await rows<{ id: number }>(db, sql`select id::int as id from person where active`)
    ).map((row) => row.id);
  } else if (input.to.kind === "unit") {
    const { unitId: asked } = input.to;
    if (!(await unitsFor(db, me)).includes(asked))
      throw new Refusal(403, "not_allowed", "You can write to the teams you sit in or lead.", "to");
    if (announce && !(await leads(db, me, asked)))
      throw new Refusal(
        403,
        "not_allowed",
        "Only the team's lead (or the CEO) announces to a team.",
        "announcement",
      );
    unitId = asked;
    members = await peopleOfUnit(db, asked);
  } else if (input.to.kind === "person") {
    if (announce)
      throw new Refusal(
        400,
        "invalid",
        "An announcement goes to a team or to everyone.",
        "announcement",
      );
    const other = input.to.personId;
    if (other === me.id) throw new Refusal(400, "invalid", "Pick someone else.", "to");
    kind = "direct";
    members = [other];
    directKey = [Math.min(me.id, other), Math.max(me.id, other)].join("-");
  } else {
    if (announce)
      throw new Refusal(
        400,
        "invalid",
        "An announcement goes to a team or to everyone.",
        "announcement",
      );
    members = [...new Set(input.to.personIds)].filter((id) => id !== me.id);
    if (!members.length) throw new Refusal(400, "invalid", "Pick who it goes to.", "to");
  }
  const people = [...new Set([...members, me.id])];
  const active = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where active and id in (${ids(people)})`,
  );
  if (active.length < 2 && !everyone)
    throw new Refusal(400, "invalid", "Nobody is there to read it.", "to");

  const threadId = await db.transaction(async (tx) => {
    let id: number | null = null;
    if (directKey) {
      const [found] = await rows<{ id: number }>(
        tx,
        sql`select id::int as id from message_thread where direct_key = ${directKey}`,
      );
      id = found?.id ?? null;
    }
    if (!id) {
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into message_thread (kind, title, unit_id, everyone, direct_key, created_by)
          values (${kind}, ${title}, ${unitId}, ${everyone}, ${directKey}, ${me.id})
          on conflict (direct_key) do update set last_at = now() returning id::int as id`,
      );
      id = made?.id as number;
      for (const person of active)
        await tx.execute(
          sql`insert into message_member (thread_id, person_id) values (${id}, ${person.id}) on conflict do nothing`,
        );
    }
    await tx.execute(
      sql`insert into message (thread_id, by_person, body) values (${id}, ${me.id}, ${body})`,
    );
    await tx.execute(sql`update message_thread set last_at = now() where id = ${id}`);
    await tx.execute(
      sql`update message_member set read_at = now() where thread_id = ${id} and person_id = ${me.id}`,
    );
    return id;
  });
  // An announcement and a team message ring the bell; a chat shows on Messages.
  if (kind !== "direct")
    await notify(db, {
      to: active.map((row) => row.id).filter((id) => id !== me.id),
      kind: kind === "announcement" ? "announcement" : "message",
      title:
        kind === "announcement"
          ? `Announcement from ${me.name}`
          : `${me.name} wrote to ${title ?? "your team"}`,
      body: body.slice(0, 140),
      link: `/messages/${threadId}`,
      key: `thread-${threadId}`,
    });
  return { threadId };
}

export async function reply(db: Database, me: Me, threadId: number, text: string): Promise<void> {
  const body = bodyOf(text);
  const [thread] = await rows<{
    kind: MessageThreadRow["kind"];
    createdBy: number;
    unitId: number | null;
    everyone: boolean;
  }>(
    db,
    sql`select t.kind, t.created_by::int as "createdBy", t.unit_id::int as "unitId", t.everyone from message_thread t
      join message_member mm on mm.thread_id = t.id and mm.person_id = ${me.id} where t.id = ${threadId}`,
  );
  if (!thread) throw new Refusal(404, "not_found", "That conversation isn't yours.");
  if (thread.kind === "announcement" && thread.createdBy !== me.id)
    throw new Refusal(
      403,
      "not_allowed",
      "An announcement is read, not answered: write to its sender instead.",
    );
  // A team's (or everyone's) thread takes in whoever joined since: a new MedRep in the team reads
  // what is written from now on. Those who left keep their place in it (history).
  const joined = thread.everyone
    ? (await rows<{ id: number }>(db, sql`select id::int as id from person where active`)).map(
        (row) => row.id,
      )
    : thread.unitId
      ? await peopleOfUnit(db, thread.unitId)
      : [];
  await db.transaction(async (tx) => {
    for (const person of joined)
      await tx.execute(
        sql`insert into message_member (thread_id, person_id) values (${threadId}, ${person}) on conflict do nothing`,
      );
    await tx.execute(
      sql`insert into message (thread_id, by_person, body) values (${threadId}, ${me.id}, ${body})`,
    );
    await tx.execute(sql`update message_thread set last_at = now() where id = ${threadId}`);
    await tx.execute(
      sql`update message_member set read_at = now() where thread_id = ${threadId} and person_id = ${me.id}`,
    );
  });
}
