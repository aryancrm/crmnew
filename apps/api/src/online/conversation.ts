// One message onto its case, whichever channel it came through. Who a person is, is their
// conversation (their Messenger id on that page, or their email address), never their name.
// Their first message opens a case; later ones land on their newest case (a lost one opens
// again when they write); the same message kept twice (the webhook and the pull) is one line.

import { type KeptFile, keepFile } from "../files/store";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { may, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import type { LeadSource, Me } from "../types";
import { isPapRep, LEAD_WORK_ROLES } from "./rules";

export type ChannelKind = "messenger" | "email";
export type Account = { id: number; kind: ChannelKind; key: string; name: string };

export type IncomingFile = { name: string; mime: string; bytes: Uint8Array };

export type Message = {
  account: Account;
  /** Who the conversation is with: a Messenger id, or an email address in lower case. */
  key: string;
  externalId: string;
  direction: "in" | "out";
  text: string;
  subject?: string | null;
  at: Date;
  files?: IncomingFile[];
  /** Files Meta or the mail didn't hand over. */
  missingFiles?: number;
  /** Ours, sent by this person (null: from Facebook's own inbox). */
  byPerson?: number | null;
  /** Opens a case when the person has none (their own message; never our echo). */
  opens?: { name: string; email?: string | null; source: LeadSource };
};

/** A conversation is worked one message at a time, across servers too. */
export async function lockConversation(tx: Runner, account: Account, key: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`chat:${account.id}:${key}`}, 0))`,
  );
}

/** The case a conversation lands on: the person's newest. */
export async function caseOf(
  tx: Runner,
  account: Account,
  key: string,
): Promise<{ id: number; state: string } | null> {
  const [found] = await rows<{ id: number; state: string }>(
    tx,
    sql`select id::int as id, state from lead where chat_account_id = ${account.id} and chat_key = ${key} order by id desc limit 1`,
  );
  return found ?? null;
}

/** One line for the chat list: what was said last, by whom. */
export function preview(
  direction: "in" | "out",
  text: string,
  files: number,
  subject?: string | null,
): string {
  const said =
    text.replace(/\s+/g, " ").trim() ||
    (subject ? subject.trim() : "") ||
    (files ? (files > 1 ? `${files} files` : "A photo or file") : "");
  const line = said.length > 140 ? `${said.slice(0, 139)}…` : said;
  return direction === "out" ? `You: ${line}` : line;
}

/** A message they sent this long ago no longer leaves the case waiting for a reply. */
const WAITING_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function keepMessage(
  db: Database,
  m: Message,
): Promise<{ leadId: number | null; kept: boolean; opened: boolean }> {
  // Photos are made smaller and stored before the transaction, so an upload never holds a lock.
  const keptFiles: KeptFile[] = [];
  for (const file of m.files ?? [])
    keptFiles.push(await keepFile("chats", { ...file, name: file.name.slice(0, 120) || "file" }));
  return db.transaction(async (tx) => {
    await lockConversation(tx, m.account, m.key);
    const [twin] = await rows<{ leadId: number }>(
      tx,
      sql`select lead_id::int as "leadId" from lead_message where account_id = ${m.account.id} and external_id = ${m.externalId}`,
    );
    if (twin) {
      // Our own reply came back as Meta's echo after we kept it: nothing new. The other way
      // round, the reply we are keeping now names who sent it.
      if (m.direction === "out" && m.byPerson)
        await tx.execute(
          sql`update lead_message set by_person = ${m.byPerson} where account_id = ${m.account.id} and external_id = ${m.externalId} and by_person is null`,
        );
      return { leadId: twin.leadId, kept: false, opened: false };
    }
    let lead = await caseOf(tx, m.account, m.key);
    let opened = false;
    if (!lead) {
      if (!m.opens) return { leadId: null, kept: false, opened: false };
      const [made] = await rows<{ id: number }>(
        tx,
        sql`insert into lead (source, name, patient_name, email, road, chat_channel, chat_account_id, chat_key, first_contact_at, created_by)
          values (${m.opens.source}, ${m.opens.name}, ${m.opens.name}, ${m.opens.email ?? null}, 'regular', ${m.account.kind}, ${m.account.id}, ${m.key}, ${m.at.toISOString()}, null)
          returning id::int as id`,
      );
      const id = made?.id as number;
      await tx.execute(
        sql`with next as (update counter set value = value + 1 where name = 'lead' returning value)
          update lead set code = 'ENQ-' || lpad(next.value::text, 5, '0') from next where lead.id = ${id}`,
      );
      await tx.execute(
        sql`insert into lead_event (lead_id, kind, message, by_person) values (${id}, 'status', ${`Enquiry from ${m.account.kind === "messenger" ? `Messenger (${m.account.name})` : `email to ${m.account.key}`}.`}, null)`,
      );
      lead = { id, state: "open" };
      opened = true;
    }

    const files: { fileId?: number; name?: string; mime?: string; missing?: boolean }[] = [];
    for (const file of keptFiles) {
      const [kept] = await rows<{ id: number }>(
        tx,
        sql`insert into lead_file (lead_id, kind, name, mime, size, data, store_key, by_person)
          values (${lead.id}, 'unsorted', ${file.name}, ${file.mime}, ${file.size}, ${file.data}, ${file.key}, ${m.direction === "out" ? (m.byPerson ?? null) : null})
          returning id::int as id`,
      );
      files.push({ fileId: kept?.id, name: file.name, mime: file.mime });
    }
    for (let missing = 0; missing < (m.missingFiles ?? 0); missing += 1)
      files.push({ missing: true });

    await tx.execute(
      sql`insert into lead_message (lead_id, channel, account_id, direction, external_id, subject, text, files, by_person, at)
        values (${lead.id}, ${m.account.kind}, ${m.account.id}, ${m.direction}, ${m.externalId}, ${m.subject ?? null}, ${m.text.slice(0, 20_000)},
          ${JSON.stringify(files)}::jsonb, ${m.byPerson ?? null}, ${m.at.toISOString()})`,
    );

    // The case's summary moves only for the newest message: an older one (history coming in)
    // never takes back what it shows, sets it waiting, or opens a lost case again.
    const line = preview(m.direction, m.text, files.length, m.subject);
    const recent = Date.now() - m.at.getTime() < WAITING_WINDOW_MS;
    const [now] = await rows<{ newest: boolean; state: string }>(
      tx,
      sql`select (last_message_at is null or last_message_at <= ${m.at.toISOString()}) as newest, state from lead where id = ${lead.id}`,
    );
    if (m.direction === "in") {
      await tx.execute(
        sql`update lead set last_inbound_at = greatest(coalesce(last_inbound_at, ${m.at.toISOString()}), ${m.at.toISOString()}), last_activity_at = now() where id = ${lead.id}`,
      );
      if (now?.newest)
        await tx.execute(
          sql`update lead set last_message = ${line}, last_message_at = ${m.at.toISOString()}, awaiting_reply = ${recent} where id = ${lead.id}`,
        );
      if (now?.newest && recent && now.state === "lost") {
        await tx.execute(
          sql`update lead set state = 'open', lost_reason = null where id = ${lead.id}`,
        );
        await tx.execute(
          sql`insert into lead_event (lead_id, kind, message, by_person) values (${lead.id}, 'status', 'They wrote again: the case is open again.', null)`,
        );
      }
    } else if (now?.newest) {
      await tx.execute(
        sql`update lead set last_message = ${line}, last_message_at = ${m.at.toISOString()}, awaiting_reply = false, last_activity_at = now() where id = ${lead.id}`,
      );
    }
    return { leadId: lead.id, kept: true, opened };
  });
}

/** The case's conversation as an account, for answering on it. */
export async function chatOf(
  db: Runner,
  leadId: number,
): Promise<{
  account: Account & { secret: string; active: boolean };
  key: string;
  state: string;
  lastInboundAt: string | null;
} | null> {
  const [found] = await rows<{
    id: number;
    kind: ChannelKind;
    key: string;
    name: string;
    secret: string;
    active: boolean;
    chatKey: string;
    state: string;
    lastInboundAt: string | null;
  }>(
    db,
    sql`select a.id::int as id, a.kind, a.key, a.name, a.secret, a.active, l.chat_key as "chatKey", l.state,
        to_char(l.last_inbound_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastInboundAt"
      from lead l join channel_account a on a.id = l.chat_account_id where l.id = ${leadId} and l.chat_key is not null`,
  );
  if (!found) return null;
  return {
    account: {
      id: found.id,
      kind: found.kind,
      key: found.key,
      name: found.name,
      secret: found.secret,
      active: found.active,
    },
    key: found.chatKey,
    state: found.state,
    lastInboundAt: found.lastInboundAt,
  };
}

/**
 * Who answers a case's customer, on Messenger or by email: the Online desk and the Admin, as
 * before, and the PAP person on the PAP cases that are theirs (Aryan, 26 Nov: "Fhaye should be
 * able to reply too").
 */
export async function mayAnswer(db: Runner, me: Me, leadId: number): Promise<boolean> {
  if (may(me, LEAD_WORK_ROLES)) return true;
  if (!isPapRep(me)) return false;
  const [lead] = await rows<{ desk: string; assignedTo: number | null }>(
    db,
    sql`select desk, assigned_to::int as "assignedTo" from lead where id = ${leadId}`,
  );
  return lead?.desk === "pap" && lead.assignedTo === me.id;
}

export async function answerGate(db: Runner, me: Me, leadId: number, what: string): Promise<void> {
  if (!(await mayAnswer(db, me, leadId)))
    throw new Refusal(403, "forbidden", `Only the Online desk, the Admin, and the PAP person on their own cases can ${what}.`);
}

