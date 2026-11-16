// Messenger on the Online desk. A Facebook page is connected with its page token; Meta's webhook
// then sends every event (their messages and photos, our replies sent from Facebook's own inbox,
// their reactions, when they read ours). Each event is kept first in `inbox_event`, then worked:
// one that fails is tried again later, never lost. Every few minutes the page's conversations
// are also read from Meta, so a missed webhook still lands. The agent answers from the case or
// the Inbox; Meta takes a reply only within 24 hours of the person's last message.

import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, may, onlineDesk, Refusal } from "../http";
import type { Me } from "../types";
import { type Account, caseOf, chatOf, type IncomingFile, keepMessage } from "./conversation";
import { graph } from "./graph";
import { LEAD_WORK_ROLES } from "./rules";
import { seal, unseal } from "./secrets";

export const CHANNEL_ROLES = ["admin", "ceo"] as const;

export type MessengerEvent = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type: string; payload?: { url?: string; sticker_id?: number } }[];
  };
  postback?: { mid?: string; title?: string; payload?: string };
  reaction?: { reaction?: string; emoji?: string; action: "react" | "unreact"; mid: string };
  read?: { watermark: number };
  /** Ours, not Meta's: the name the page's history gave for the sender. */
  name?: string;
};

/** The webhook fields a page is subscribed to. */
export const MESSENGER_FIELDS =
  "messages,messaging_postbacks,message_reactions,message_echoes,message_reads";
const UNNAMED = "Facebook user";
const MAX_TEXT = 2000;
/** Meta's own limit: a reply more than 24 hours after their last message isn't delivered. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;

// ---------------------------------------------------------------- the webhook

/** Meta's signature on the exact body: sha256=<hex HMAC with the app secret>. */
export function signatureMatches(
  body: string,
  header: string | undefined,
  secrets = appSecrets(),
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  return secrets.some((secret) => {
    const ours = createHmac("sha256", secret).update(body).digest();
    return ours.length === given.length && timingSafeEqual(ours, given);
  });
}

export const appSecrets = () =>
  [process.env.MESSENGER_APP_SECRET, process.env.MESSENGER_APP_SECRETS]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

export const verifyTokens = () =>
  (process.env.MESSENGER_VERIFY_TOKEN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

/** Each event once: the same message from the webhook and from the pull has the same key. */
export function eventKey(ev: MessengerEvent): string | null {
  if (ev.message?.mid) return `m:${ev.message.mid}`;
  if (ev.postback) return `pb:${ev.sender.id}:${ev.postback.mid ?? ev.timestamp}`;
  if (ev.reaction?.mid) return `r:${ev.reaction.mid}:${ev.reaction.action}:${ev.timestamp}`;
  if (ev.read) return `read:${ev.sender.id}:${ev.read.watermark}`;
  return null;
}

/** Keeps the body's events; answers how many were new. A page nobody connected waits. */
export async function keepWebhook(db: Database, body: unknown): Promise<number> {
  const entries =
    (
      body as {
        object?: string;
        entry?: { id?: string; messaging?: MessengerEvent[]; standby?: MessengerEvent[] }[];
      }
    )?.entry ?? [];
  let kept = 0;
  for (const entry of entries) {
    const pageKey = String(entry.id ?? "");
    if (!pageKey) continue;
    const [account] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from channel_account where kind = 'messenger' and key = ${pageKey} and active`,
    );
    for (const ev of [...(entry.messaging ?? []), ...(entry.standby ?? [])]) {
      const key = eventKey(ev);
      if (!key) continue;
      kept += await keepEvent(db, pageKey, account?.id ?? null, key, ev);
    }
  }
  return kept;
}

async function keepEvent(
  db: Database,
  pageKey: string,
  accountId: number | null,
  key: string,
  ev: MessengerEvent,
): Promise<number> {
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into inbox_event (page_key, account_id, event_key, payload, state)
      values (${pageKey}, ${accountId}, ${key}, ${JSON.stringify(ev)}::jsonb, ${accountId ? "pending" : "unrouted"})
      on conflict (page_key, event_key) do nothing returning id::int as id`,
  );
  return made ? 1 : 0;
}

// ---------------------------------------------------------------- working the events

let draining: Promise<number> | null = null;

/** Works what is due, oldest first. A conversation whose earlier event failed waits for it. */
export function drainInbox(db: Database): Promise<number> {
  if (!draining) draining = drain(db).finally(() => (draining = null));
  return draining;
}

async function drain(db: Database): Promise<number> {
  const due = await rows<{
    id: number;
    accountId: number;
    payload: MessengerEvent;
    attempts: number;
  }>(
    db,
    sql`select e.id::int as id, e.account_id::int as "accountId", e.payload, e.attempts::int as attempts
      from inbox_event e join channel_account a on a.id = e.account_id and a.active
      where e.state = 'pending' and e.next_at <= now() order by e.id limit 200`,
  );
  const blocked = new Set<string>();
  let worked = 0;
  for (const row of due) {
    const ev = row.payload;
    const conversation = `${row.accountId}:${ev.message?.is_echo ? ev.recipient.id : ev.sender.id}`;
    if (blocked.has(conversation)) continue;
    const account = await accountById(db, row.accountId);
    try {
      const outcome = account ? await workEvent(db, account, ev) : "skipped";
      await db.execute(
        sql`update inbox_event set state = ${outcome}, done_at = now(), error = null, attempts = attempts + 1 where id = ${row.id}`,
      );
      worked += 1;
    } catch (error) {
      blocked.add(conversation);
      const attempts = row.attempts + 1;
      const wait = [15, 60, 300, 1800, 7200, 21600, 21600][Math.min(attempts - 1, 6)] ?? 21600;
      const message = error instanceof Error ? error.message : String(error);
      await db.execute(
        sql`update inbox_event set attempts = ${attempts}, error = ${message.slice(0, 500)},
            state = ${attempts >= MAX_ATTEMPTS ? "failed" : "pending"}, next_at = now() + make_interval(secs => ${wait}) where id = ${row.id}`,
      );
    }
  }
  return worked;
}

type PageAccount = Account & { token: string };

async function accountById(db: Database, id: number): Promise<PageAccount | null> {
  const [found] = await rows<{ id: number; key: string; name: string; secret: string }>(
    db,
    sql`select id::int as id, key, name, secret from channel_account where id = ${id} and kind = 'messenger' and active`,
  );
  return found
    ? {
        id: found.id,
        kind: "messenger",
        key: found.key,
        name: found.name,
        token: unseal(found.secret),
      }
    : null;
}

/** One event onto its case; "skipped" when there is nothing to do with it. */
export async function workEvent(
  db: Database,
  page: PageAccount,
  ev: MessengerEvent,
): Promise<"done" | "skipped"> {
  const at = new Date(ev.timestamp || Date.now());
  if (ev.message?.mid) {
    const echo = Boolean(ev.message.is_echo);
    const psid = echo ? ev.recipient.id : ev.sender.id;
    if (!psid || psid === page.key) return "skipped";
    const { files, missing } = await filesOf(ev.message.mid, ev.message.attachments ?? []);
    const opens =
      echo || (await caseOf(db, page, psid))
        ? undefined
        : { name: ev.name?.trim() || (await nameOf(page, psid)), source: "messenger" as const };
    const kept = await keepMessage(db, {
      account: page,
      key: psid,
      externalId: ev.message.mid,
      direction: echo ? "out" : "in",
      text: ev.message.text ?? "",
      at,
      files,
      missingFiles: missing,
      opens,
    });
    return kept.leadId ? "done" : "skipped";
  }
  if (ev.postback) {
    const psid = ev.sender.id;
    const opens = (await caseOf(db, page, psid))
      ? undefined
      : { name: await nameOf(page, psid), source: "messenger" as const };
    const kept = await keepMessage(db, {
      account: page,
      key: psid,
      externalId: `pb:${psid}:${ev.postback.mid ?? ev.timestamp}`,
      direction: "in",
      text: ev.postback.title ?? ev.postback.payload ?? "",
      at,
      opens,
    });
    return kept.leadId ? "done" : "skipped";
  }
  if (ev.reaction?.mid) {
    const reaction =
      ev.reaction.action === "react" ? (ev.reaction.emoji ?? ev.reaction.reaction ?? "👍") : null;
    const changed = await rows<{ id: number }>(
      db,
      sql`update lead_message set reaction = ${reaction} where account_id = ${page.id} and external_id = ${ev.reaction.mid} returning id::int as id`,
    );
    return changed.length ? "done" : "skipped";
  }
  if (ev.read) {
    const lead = await caseOf(db, page, ev.sender.id);
    if (!lead) return "skipped";
    const seen = new Date(ev.read.watermark).toISOString();
    await db.execute(
      sql`update lead set read_at = greatest(coalesce(read_at, ${seen}), ${seen}) where id = ${lead.id}`,
    );
    return "done";
  }
  return "skipped";
}

/** Their name from Messenger: the profile, else the conversation's participant list. */
async function nameOf(page: PageAccount, psid: string): Promise<string> {
  const profile = await graph().call<{ first_name?: string; last_name?: string; name?: string }>(
    "GET",
    `/${psid}`,
    page.token,
    { fields: "first_name,last_name" },
  );
  const name = [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  const conversations = await graph().call<{
    data?: { participants?: { data?: { id: string; name?: string }[] } }[];
  }>("GET", `/${page.key}/conversations`, page.token, {
    platform: "messenger",
    user_id: psid,
    fields: "participants",
  });
  for (const conversation of conversations.data?.data ?? [])
    for (const person of conversation.participants?.data ?? [])
      if (person.id === psid && person.name?.trim()) return person.name.trim();
  return UNNAMED;
}

const KEPT_TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;

/** Photos and PDFs they sent, fetched from Meta's short-lived links; the rest counted as missing. */
async function filesOf(
  mid: string,
  attachments: NonNullable<NonNullable<MessengerEvent["message"]>["attachments"]>,
): Promise<{ files: IncomingFile[]; missing: number }> {
  const files: IncomingFile[] = [];
  let missing = 0;
  for (const [index, attachment] of attachments.entries()) {
    const url = attachment.payload?.url;
    if (!url || attachment.payload?.sticker_id) continue;
    const got = await graph().fetchFile(url);
    if (!got || !KEPT_TYPES.test(got.mime)) {
      missing += 1;
      continue;
    }
    const extension = got.mime === "application/pdf" ? "pdf" : (got.mime.split("/")[1] ?? "jpg");
    files.push({
      name: `messenger-${mid.slice(-8)}-${index + 1}.${extension}`,
      mime: got.mime,
      bytes: got.bytes,
    });
  }
  return { files, missing };
}

// ---------------------------------------------------------------- connecting a page

/**
 * Which page a token belongs to, and its name. Reading the page object (/me) needs
 * pages_read_engagement, which the app may not have: then debug_token (needs no page permission)
 * names the page id, and the name comes from the page itself if it can be read, else from one of
 * its conversations (the page is a participant), else "Page <id>".
 */
async function pageOfToken(token: string): Promise<{ id: string; name: string }> {
  const me = await graph().call<{ id?: string; name?: string }>("GET", "/me", token, {
    fields: "id,name",
  });
  if (!me.error && me.data?.id)
    return { id: String(me.data.id), name: me.data.name?.trim() || `Page ${me.data.id}` };
  const info = await graph().call<{ data?: { profile_id?: string | number; is_valid?: boolean } }>(
    "GET",
    "/debug_token",
    token,
    { input_token: token },
  );
  const id = info.data?.data?.profile_id ? String(info.data.data.profile_id) : null;
  if (info.error || !info.data?.data?.is_valid || !id)
    throw new Refusal(
      400,
      "invalid",
      `Meta didn't accept the token: ${info.error ?? me.error ?? "it names no page"}. Generate the page's token again in Messenger API Settings.`,
      "token",
    );
  const named = await graph().call<{ name?: string }>("GET", `/${id}`, token, { fields: "name" });
  if (!named.error && named.data?.name?.trim()) return { id, name: named.data.name.trim() };
  const talks = await graph().call<{ data?: Conversation[] }>("GET", `/${id}/conversations`, token, {
    fields: "participants",
    limit: "1",
  });
  const self = talks.data?.data?.[0]?.participants?.data?.find((one) => String(one.id) === id);
  return { id, name: self?.name?.trim() || `Page ${id}` };
}

/** Connects (or connects again) the page a token belongs to; its waiting events are taken in. */
export async function connectPage(
  db: Database,
  me: Me,
  token: string,
): Promise<{ id: number; name: string; subscribeError: string | null }> {
  allow(me, CHANNEL_ROLES, "connect a Facebook page");
  const clean = token.trim();
  if (!clean) throw new Refusal(400, "invalid", "Paste the page's access token.", "token");
  const found = await pageOfToken(clean);
  const page = { data: found };
  const subscribed = await graph().call("POST", `/${page.data.id}/subscribed_apps`, clean, {
    subscribed_fields: MESSENGER_FIELDS,
  });
  const name = page.data.name;
  const [account] = await rows<{ id: number }>(
    db,
    sql`insert into channel_account (kind, key, name, secret, connected_by, cursor, sync_error)
      values ('messenger', ${page.data.id}, ${name}, ${seal(clean)}, ${me.id}, null, ${subscribed.error})
      on conflict (kind, key) do update set name = excluded.name, secret = excluded.secret, active = true, connected_by = excluded.connected_by,
        connected_at = now(), sync_error = excluded.sync_error
      returning id::int as id`,
  );
  const id = account?.id as number;
  await db.execute(
    sql`update inbox_event set account_id = ${id}, state = 'pending', next_at = now() where page_key = ${page.data.id} and state = 'unrouted'`,
  );
  return { id, name, subscribeError: subscribed.error };
}

// ---------------------------------------------------------------- reading the page's history

type Conversation = {
  id: string;
  updated_time?: string;
  participants?: { data?: { id: string; name?: string }[] };
};
type GraphMessage = {
  id: string;
  created_time?: string;
  from?: { id: string; name?: string };
  message?: string;
  attachments?: {
    data?: { mime_type?: string; file_url?: string; image_data?: { url?: string } }[];
  };
};

/**
 * What moved on the page since the last read, fed through the same inbox as the webhook. The
 * first read goes back `days` days. Answers how many messages were new.
 */
export async function pullPage(db: Database, accountId: number, days = 7): Promise<number> {
  const page = await accountById(db, accountId);
  if (!page) return 0;
  const [state] = await rows<{ cursor: { since?: string } | null }>(
    db,
    sql`select cursor from channel_account where id = ${accountId}`,
  );
  const since = Date.parse(state?.cursor?.since ?? "") || Date.now() - days * 86_400_000;
  let newest = since;
  let kept = 0;
  let after: string | undefined;
  let error: string | null = null;
  read: for (let pageNo = 0; pageNo < 5; pageNo += 1) {
    const list = await graph().call<{
      data?: Conversation[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>("GET", `/${page.key}/conversations`, page.token, {
      platform: "messenger",
      fields: "id,updated_time,participants",
      limit: "25",
      ...(after ? { after } : {}),
    });
    if (list.error) {
      error = list.error;
      break;
    }
    for (const conversation of list.data?.data ?? []) {
      const updated = Date.parse(conversation.updated_time ?? "");
      if (updated && updated <= since) break read;
      if (updated > newest) newest = updated;
      const other = conversation.participants?.data?.find((person) => person.id !== page.key)?.id;
      const messages = await graph().call<{ data?: GraphMessage[] }>(
        "GET",
        `/${conversation.id}/messages`,
        page.token,
        {
          fields: "id,created_time,from,message,attachments{mime_type,file_url,image_data}",
          limit: "50",
        },
      );
      if (messages.error) {
        error = messages.error;
        continue;
      }
      for (const message of [...(messages.data?.data ?? [])].reverse()) {
        const at = Date.parse(message.created_time ?? "") || Date.now();
        if (at <= since) continue;
        const fromPage = message.from?.id === page.key;
        const psid = fromPage ? other : message.from?.id;
        if (!psid) continue;
        const name =
          conversation.participants?.data?.find((person) => person.id === psid)?.name ??
          (fromPage ? undefined : message.from?.name);
        const ev: MessengerEvent = {
          ...(name ? { name } : {}),
          sender: { id: fromPage ? page.key : psid },
          recipient: { id: fromPage ? psid : page.key },
          timestamp: at,
          message: {
            mid: message.id,
            ...(message.message ? { text: message.message } : {}),
            ...(fromPage ? { is_echo: true } : {}),
            attachments: (message.attachments?.data ?? []).map((file) => ({
              type: file.image_data ? "image" : "file",
              payload: { url: file.image_data?.url ?? file.file_url },
            })),
          },
        };
        kept += await keepEvent(db, page.key, page.id, `m:${message.id}`, ev);
      }
    }
    after = list.data?.paging?.next ? list.data.paging.cursors?.after : undefined;
    if (!after) break;
  }
  await db.execute(
    sql`update channel_account set cursor = ${JSON.stringify({ since: new Date(newest).toISOString() })}::jsonb, synced_at = now(), sync_error = ${error} where id = ${accountId}`,
  );
  await drainInbox(db);
  return kept;
}

// ---------------------------------------------------------------- answering

/** Sends the agent's reply through the page they wrote to, and keeps it on the case. */
export async function replyOnMessenger(
  db: Database,
  me: Me,
  leadId: number,
  text: string,
): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "answer a chat");
  const body = text.trim();
  if (!body) throw new Refusal(400, "invalid", "Write something to send.", "text");
  if (body.length > MAX_TEXT)
    throw new Refusal(
      400,
      "invalid",
      `Messenger takes up to ${MAX_TEXT} characters in one message.`,
      "text",
    );
  const chat = await chatOf(db, leadId);
  if (!chat || chat.account.kind !== "messenger")
    throw new Refusal(409, "not_now", "This case didn't come through Messenger.", "text");
  if (!chat.account.active)
    throw new Refusal(
      409,
      "not_now",
      `The page ${chat.account.name} isn't connected any more. Connect it again under Channels.`,
      "text",
    );
  if (!chat.lastInboundAt || Date.now() - Date.parse(chat.lastInboundAt) > REPLY_WINDOW_MS)
    throw new Refusal(
      409,
      "not_now",
      "Their last message is more than 24 hours old: Messenger won't deliver a reply now. Call or text them instead.",
      "text",
    );
  const at = new Date();
  const sent = await graph().call<{ message_id?: string }>(
    "POST",
    "/me/messages",
    unseal(chat.account.secret),
    {},
    {
      recipient: { id: chat.key },
      messaging_type: "RESPONSE",
      message: { text: body },
    },
  );
  if (sent.error || !sent.data?.message_id)
    throw new Refusal(
      409,
      "not_sent",
      `Messenger didn't take the reply: ${sent.error ?? "no message id"}.`,
      "text",
    );
  await keepMessage(db, {
    account: chat.account,
    key: chat.key,
    externalId: sent.data.message_id,
    direction: "out",
    text: body,
    at,
    byPerson: me.id,
  });
  // Whoever answers an unassigned case on the Online desk takes it.
  if (onlineDesk(me))
    await db.execute(
      sql`update lead set assigned_to = ${me.id} where id = ${leadId} and assigned_to is null`,
    );
}
