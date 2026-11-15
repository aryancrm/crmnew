// The Inbox: every conversation as one chat (by its newest message, the ones waiting for us
// first), the conversation itself (theirs, ours and the desk's notes), the reply, and the
// channels' settings: which pages and mailboxes are connected and how their reading goes.

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, may, Refusal } from "../http";
import { iso } from "../inventory/service";
import type {
  ChannelStatus,
  ChannelsData,
  ChatLine,
  ChatSummary,
  ChatThread,
  InboxFilter,
  InboxList,
  LeadPaperKind,
  Me,
} from "../types";
import { chatOf } from "./conversation";
import { mailSink, pullMailbox, replyByEmail } from "./email";
import {
  appSecrets,
  CHANNEL_ROLES,
  drainInbox,
  pullPage,
  replyOnMessenger,
  verifyTokens,
} from "./messenger";
import { LEAD_READ_ROLES, LEAD_WORK_ROLES, PAPER_KINDS, PAPER_LABEL } from "./rules";
import { pushWebsites, websiteStatus } from "./websites";

const FILTERS: InboxFilter[] = ["all", "needs", "mine"];
const UNREAD = sql`(l.awaiting_reply and (l.seen_at is null or l.last_inbound_at > l.seen_at))`;

export async function inboxList(
  db: Database,
  me: Me,
  query: { filter?: string; q?: string; account?: string; shown?: number },
): Promise<InboxList> {
  allow(me, LEAD_READ_ROLES, "see the Inbox");
  const filter: InboxFilter = FILTERS.includes(query.filter as InboxFilter)
    ? (query.filter as InboxFilter)
    : "all";
  const where: SQL[] = [sql`l.chat_key is not null`, sql`a.active`];
  const account = Number(query.account);
  if (Number.isInteger(account) && account > 0) where.push(sql`l.chat_account_id = ${account}`);
  for (const word of (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${word.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      sql`(lower(l.name) like ${like} or lower(coalesce(l.patient_name, '')) like ${like} or lower(coalesce(l.last_message, '')) like ${like} or lower(l.code) like ${like} or lower(l.chat_key) like ${like})`,
    );
  }
  const base = sql.join(where, sql` and `);
  const needs = sql`l.awaiting_reply and l.state = 'open'`;
  const mine = sql`l.assigned_to = ${me.id}`;
  const picked =
    filter === "needs" ? sql` and ${needs}` : filter === "mine" ? sql` and ${mine}` : sql``;
  const [chats, [counted], accounts, [held]] = await Promise.all([
    rows<ChatSummary & { code: string }>(
      db,
      sql`select l.id::int as "leadId", l.code, l.name, nullif(l.patient_name, l.name) as patient, l.chat_channel as channel, a.name as account,
          l.last_message as "lastMessage", ${iso("l.last_message_at")} as "lastMessageAt", (l.awaiting_reply and l.state = 'open') as "awaitingReply",
          ${UNREAD} as unread, who.name as owner, l.state = 'lost' as lost, '' as step
        from lead l join channel_account a on a.id = l.chat_account_id left join person who on who.id = l.assigned_to
        where ${base}${picked}
        order by (l.awaiting_reply and l.state = 'open') desc, l.last_message_at desc nulls last, l.id desc
        limit ${Math.min(Math.max(60, query.shown ?? 0), 600)}`,
    ),
    rows<Record<InboxFilter, number>>(
      db,
      sql`select count(*)::int as all, count(*) filter (where ${needs})::int as needs, count(*) filter (where ${mine})::int as mine
        from lead l join channel_account a on a.id = l.chat_account_id where ${base}`,
    ),
    rows<InboxList["accounts"][number]>(
      db,
      sql`select id::int as id, kind, name from channel_account where active and kind in ('messenger', 'email') order by kind, name`,
    ),
    may(me, LEAD_WORK_ROLES)
      ? rows<{ n: number }>(
          db,
          sql`select count(distinct (h.account_id, h.address))::int as n from email_held h join channel_account a on a.id = h.account_id and a.active where h.state = 'held'`,
        )
      : Promise.resolve([{ n: 0 }]),
  ]);
  return {
    filter,
    chats,
    counts: counted ?? { all: 0, needs: 0, mine: 0 },
    accounts,
    held: held?.n ?? 0,
    can: { reply: may(me, LEAD_WORK_ROLES), manageChannels: may(me, CHANNEL_ROLES) },
  };
}

/** The sidebar's count: conversations waiting for a reply, and new email senders. */
export async function inboxCount(db: Database, me: Me): Promise<{ needs: number; held: number }> {
  if (!may(me, LEAD_READ_ROLES)) return { needs: 0, held: 0 };
  const [counted] = await rows<{ needs: number; held: number }>(
    db,
    sql`select (select count(*) from lead l join channel_account a on a.id = l.chat_account_id and a.active where l.awaiting_reply and l.state = 'open')::int as needs,
        (select count(distinct (h.account_id, h.address)) from email_held h join channel_account a on a.id = h.account_id and a.active where h.state = 'held')::int as held`,
  );
  return counted ?? { needs: 0, held: 0 };
}

/** The whole conversation: every case on it (theirs and ours), with the desk's notes. */
export async function chatThread(db: Database, me: Me, leadId: number): Promise<ChatThread> {
  allow(me, LEAD_READ_ROLES, "read a conversation");
  const chat = await chatOf(db, leadId);
  if (!chat) throw new Refusal(404, "not_found", "This case has no conversation.");
  const [messages, notes, [lead]] = await Promise.all([
    rows<ChatLine>(
      db,
      sql`select 'm' || m.id as id, 'message' as kind, m.direction, m.text, m.subject, m.files, m.reaction, p.name as by, ${iso("m.at")} as at
        from lead_message m join lead l on l.id = m.lead_id left join person p on p.id = m.by_person
        where m.account_id = ${chat.account.id} and l.chat_key = ${chat.key} order by m.at, m.id`,
    ),
    rows<ChatLine>(
      db,
      sql`select 'n' || e.id as id, 'note' as kind, null as direction, e.message as text, null as subject, '[]'::jsonb as files, null as reaction,
          p.name as by, ${iso("e.at")} as at
        from lead_event e join lead l on l.id = e.lead_id left join person p on p.id = e.by_person
        where e.kind = 'note' and l.chat_account_id = ${chat.account.id} and l.chat_key = ${chat.key}`,
    ),
    rows<{ readAt: string | null }>(
      db,
      sql`select ${iso("read_at")} as "readAt" from lead where id = ${leadId}`,
    ),
  ]);
  const lines = [...messages, ...notes].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
  const why = !may(me, LEAD_WORK_ROLES)
    ? "Only the Online desk answers."
    : chat.state === "lost"
      ? "Closed as lost: reopen the case to answer. A note for the team still goes."
      : !chat.account.active
        ? `${chat.account.name} isn't connected any more.`
        : chat.account.kind === "messenger" &&
            (!chat.lastInboundAt ||
              Date.now() - Date.parse(chat.lastInboundAt) > 24 * 60 * 60 * 1000)
          ? "More than 24 hours since their last message: Messenger won't deliver a reply. Call or text them."
          : null;
  return {
    leadId,
    channel: chat.account.kind,
    account: chat.account.name,
    address: chat.account.kind === "email" ? chat.key : null,
    lines,
    readAt: lead?.readAt ?? null,
    lastInboundAt: chat.lastInboundAt,
    can: { reply: why === null, why },
  };
}

/** Someone on the desk opened the conversation: it isn't unread any more. */
export async function markSeen(db: Database, me: Me, leadId: number): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "open a conversation");
  await db.execute(sql`update lead set seen_at = now() where id = ${leadId}`);
}

/** The reply goes out the way they wrote: Messenger through the page, email from the mailbox. */
export async function replyOnCase(
  db: Database,
  me: Me,
  leadId: number,
  text: string,
): Promise<void> {
  const chat = await chatOf(db, leadId);
  if (!chat) throw new Refusal(409, "not_now", "This case has no conversation to answer.", "text");
  if (chat.state === "lost")
    throw new Refusal(
      409,
      "not_now",
      "This case is closed as lost. Reopen it to answer; if they write again it opens by itself.",
      "text",
    );
  if (chat.account.kind === "messenger") await replyOnMessenger(db, me, leadId, text);
  else await replyByEmail(db, me, leadId, text);
  await db.execute(sql`update lead set seen_at = now() where id = ${leadId}`);
}

/** A photo from the chat filed as a paper (filing means the agent read it). */
export async function fileChatPhoto(
  db: Database,
  me: Me,
  fileId: number,
  kind: string,
): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "file a paper");
  if (!PAPER_KINDS.includes(kind as LeadPaperKind) || kind === "unsorted")
    throw new Refusal(400, "invalid", "Say what the paper is.", "kind");
  await db.transaction(async (tx) => {
    const [file] = await rows<{ leadId: number; name: string; ordered: boolean }>(
      tx,
      sql`select f.lead_id::int as "leadId", f.name, (o.id is not null and o.status <> 'cancelled') as ordered
        from lead_file f join lead l on l.id = f.lead_id left join sales_order o on o.id = l.order_id where f.id = ${fileId} and f.active for update of f`,
    );
    if (!file) throw new Refusal(404, "not_found", "That file isn't there any more.");
    if (file.ordered)
      throw new Refusal(
        409,
        "not_now",
        "The order is placed with these papers: they stay as they are.",
      );
    await tx.execute(sql`update lead_file set kind = ${kind} where id = ${fileId}`);
    await tx.execute(
      sql`insert into lead_event (lead_id, kind, message, by_person) values (${file.leadId}, 'paper', ${`${PAPER_LABEL[kind as LeadPaperKind]} filed from the chat (${file.name}).`}, ${me.id})`,
    );
    await tx.execute(sql`update lead set last_activity_at = now() where id = ${file.leadId}`);
  });
}

// ---------------------------------------------------------------- channels

export async function channelsData(db: Database, me: Me): Promise<ChannelsData> {
  allow(me, CHANNEL_ROLES, "see the channels");
  const [channels, unrouted] = await Promise.all([
    rows<ChannelStatus>(
      db,
      sql`select a.id::int as id, a.kind, a.key, a.name, a.intake, a.active, ${iso("a.connected_at")} as "connectedAt", ${iso("a.synced_at")} as "syncedAt",
          a.sync_error as "syncError",
          (select count(*) from inbox_event e where e.account_id = a.id and e.state = 'pending')::int as waiting,
          (select count(*) from inbox_event e where e.account_id = a.id and e.state = 'failed')::int as failed,
          (select count(distinct h.address) from email_held h where h.account_id = a.id and h.state = 'held')::int as held
        from channel_account a order by a.active desc, a.kind, a.name`,
    ),
    rows<{ page: string; count: number }>(
      db,
      sql`select page_key as page, count(*)::int as count from inbox_event where state = 'unrouted' group by page_key`,
    ),
  ]);
  for (const channel of channels)
    channel.website = channel.kind === "website" ? await websiteStatus(db, channel.id) : null;
  return {
    channels,
    unrouted,
    webhook: {
      path: "/webhooks/messenger",
      websitePath: "/webhooks/store/2mg",
      secretSet: appSecrets().length > 0,
      verifyTokenSet: verifyTokens().length > 0,
    },
    sink: {
      messenger: process.env.MESSENGER_SINK === "1" && process.env.NODE_ENV !== "production",
      mail: mailSink(),
    },
    can: { manage: true },
  };
}

async function channelOrRefuse(
  db: Database,
  id: number,
): Promise<{ kind: "messenger" | "email" | "website"; active: boolean }> {
  const [found] = await rows<{ kind: "messenger" | "email" | "website"; active: boolean }>(
    db,
    sql`select kind, active from channel_account where id = ${id}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such channel.");
  return found;
}

/** Reads the page's or mailbox's newest now. */
export async function pullChannel(db: Database, me: Me, id: number): Promise<{ landed: number }> {
  allow(me, CHANNEL_ROLES, "read a channel now");
  const channel = await channelOrRefuse(db, id);
  if (!channel.active) throw new Refusal(409, "not_now", "Connect it again first.");
  if (channel.kind === "website") return { landed: await pushWebsites(db) };
  return {
    landed: channel.kind === "messenger" ? await pullPage(db, id) : await pullMailbox(db, id),
  };
}

/** The webhook events that kept failing, tried once more. */
export async function retryChannel(db: Database, me: Me, id: number): Promise<void> {
  allow(me, CHANNEL_ROLES, "retry a channel's messages");
  await channelOrRefuse(db, id);
  await db.execute(
    sql`update inbox_event set state = 'pending', attempts = 0, next_at = now() where account_id = ${id} and state = 'failed'`,
  );
  await drainInbox(db);
}

export async function disconnectChannel(db: Database, me: Me, id: number): Promise<void> {
  allow(me, CHANNEL_ROLES, "disconnect a channel");
  await channelOrRefuse(db, id);
  await db.execute(sql`update channel_account set active = false where id = ${id}`);
}

export async function setIntake(
  db: Database,
  me: Me,
  id: number,
  intake: "screen" | "all",
): Promise<void> {
  allow(me, CHANNEL_ROLES, "change who a mailbox lets in");
  const channel = await channelOrRefuse(db, id);
  if (channel.kind !== "email")
    throw new Refusal(400, "invalid", "Only a mailbox screens new senders.", "intake");
  await db.execute(sql`update channel_account set intake = ${intake} where id = ${id}`);
}

/** Every page and mailbox read on a timer (the server starts it; tests don't). */
export function startChannelJobs(db: Database): void {
  let busy = false;
  const tick = async (full: boolean) => {
    if (busy) return;
    busy = true;
    try {
      await drainInbox(db);
      await pushWebsites(db);
      if (full) {
        const accounts = await rows<{ id: number; kind: "messenger" | "email" }>(
          db,
          sql`select id::int as id, kind from channel_account where active and kind in ('messenger', 'email')`,
        );
        for (const account of accounts) {
          try {
            if (account.kind === "messenger") await pullPage(db, account.id);
            else await pullMailbox(db, account.id);
          } catch (error) {
            console.warn(
              `channels: ${account.kind} ${account.id} didn't read:`,
              error instanceof Error ? error.message : error,
            );
          }
        }
        await db.execute(
          sql`delete from inbox_event where (state in ('done', 'skipped') and done_at < now() - interval '14 days') or (state = 'unrouted' and created_at < now() - interval '7 days')`,
        );
      }
    } catch (error) {
      console.warn("channels: a run stopped:", error instanceof Error ? error.message : error);
    } finally {
      busy = false;
    }
  };
  let round = 0;
  setInterval(() => {
    round += 1;
    void tick(round % 4 === 0);
  }, 30_000).unref();
  setTimeout(() => void tick(true), 15_000).unref();
}
