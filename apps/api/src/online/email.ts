// Email on the Online desk. A mailbox (Gmail / Google Workspace, Zoho, or any IMAP + SMTP host)
// is connected with an app password, checked first. Every two minutes its INBOX is read from
// where the last read stopped. Someone's first email waits as a held sender until the agent says
// "Make enquiry" (or "Not a customer"), unless the mailbox lets everyone in, or they already have
// a case, are a customer on that address, or answer a thread we wrote in. Lists and automatic
// mail never open a case. The agent answers from the case or the Inbox, threaded.

import { isRelayUrl, pairRelay, pingRelay, relaySend } from "./mail-relay";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { type Database, rows } from "../db/index";
import { allow, may, onlineDesk, Refusal } from "../http";
import type { HeldSender, Me } from "../types";
import { type Account, answerGate, caseOf, chatOf, type IncomingFile, keepMessage } from "./conversation";
import { CHANNEL_ROLES } from "./messenger";
import { LEAD_WORK_ROLES } from "./rules";
import { seal, unseal } from "./secrets";

export type Mailbox = {
  address: string;
  name: string | null;
  user: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** Sends through the company's Google Apps Script instead of SMTP (Render's free plan blocks it). */
  relayUrl?: string | null;
  relaySecret?: string | null;
};
export type Cursor = { uidValidity: string; lastUid: number };
export type MailFile = { filename: string; content: Uint8Array; contentType: string };
export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: MailFile[];
};

/** How the server reads and sends; the tests and a developer's computer put in their own. */
export type MailTransport = {
  check(mailbox: Mailbox): Promise<{ error: string | null; cursor: Cursor | null }>;
  read(
    mailbox: Mailbox,
    cursor: Cursor | null,
    limit: number,
  ): Promise<{ cursor: Cursor; sources: Buffer[] }>;
  send(mailbox: Mailbox, mail: OutgoingMail): Promise<void>;
};

const IMAP_PORTS = [993, 143];
const SMTP_PORTS = [465, 587];
const CONNECT_MS = 15_000;

/** An address that isn't on the public internet: a mail server may not point at the server's own network. */
function privateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a = 0, b = 0] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80")
  );
}

async function publicServer(host: string, port: number, ports: number[]): Promise<void> {
  if (!ports.includes(port)) throw new Error(`Use port ${ports.join(" or ")}.`);
  const addresses = await lookup(host, { all: true }).catch(() => {
    throw new Error(`The server ${host} wasn't found. Check its name.`);
  });
  if (!addresses.length || addresses.some((address) => privateAddress(address.address)))
    throw new Error(`${host} isn't a public mail server.`);
}

const imapOf = (m: Mailbox) => {
  const imap = new ImapFlow({
    host: m.imapHost,
    port: m.imapPort,
    secure: m.imapPort === 993,
    doSTARTTLS: m.imapPort !== 993,
    auth: { user: m.user, pass: m.password },
    logger: false,
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: 60_000,
  });
  // An 'error' event nobody hears ends the process; the call waiting on the connection answers its own.
  imap.on("error", () => {});
  return imap;
};

const smtpOf = (m: Mailbox) =>
  nodemailer.createTransport({
    host: m.smtpHost,
    port: m.smtpPort,
    secure: m.smtpPort === 465,
    requireTLS: m.smtpPort !== 465,
    auth: { user: m.user, pass: m.password },
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: 30_000,
  });

/** The server's refusal in words the person can act on. */
function explain(stage: "imap" | "smtp", error: unknown, m: Mailbox): string {
  const err = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const words = String(err.responseText ?? err.response ?? err.message ?? error).slice(0, 300);
  const host = stage === "imap" ? m.imapHost : m.smtpHost;
  const what = stage === "imap" ? "Reading mail (IMAP)" : "Sending mail (SMTP)";
  const auth =
    err.authenticationFailed === true ||
    err.code === "EAUTH" ||
    /AUTHENTICATIONFAILED|invalid credentials|not accepted|authentication failed|\b535\b/i.test(
      words,
    );
  if (/timed? ?out|timeout/i.test(words) || err.code === "ETIMEDOUT")
    return `${what}: ${host} didn't answer in time. Try again in a minute.`;
  if (err.code === "ECONNREFUSED")
    return `${what}: ${host} refused the connection. Check the port (IMAP 993, SMTP 465).`;
  if (auth && /gmail|google/i.test(host))
    return `Google didn't accept the sign-in for ${m.user}. Make an app password for this account at myaccount.google.com/apppasswords (2-Step Verification on) and paste it here; the normal password doesn't work.`;
  if (auth && /zoho/i.test(host))
    return `Zoho didn't accept the sign-in for ${m.user}. With two-factor sign-in on, Zoho needs an app password (My Account → Security → App Passwords).`;
  if (auth)
    return `${what}: the server didn't accept the sign-in or the password for ${m.user}. Many providers need an app password here.`;
  return `${what} failed: ${words}`;
}

const realTransport: MailTransport = {
  async check(m) {
    try {
      await publicServer(m.imapHost, m.imapPort, IMAP_PORTS);
      await publicServer(m.smtpHost, m.smtpPort, SMTP_PORTS);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), cursor: null };
    }
    let cursor: Cursor | null = null;
    const imap = imapOf(m);
    try {
      await imap.connect();
      const box = await imap.status("INBOX", { uidNext: true, uidValidity: true });
      if (box && box.uidNext !== undefined && box.uidValidity !== undefined)
        cursor = { uidValidity: String(box.uidValidity), lastUid: Number(box.uidNext) - 1 };
      await imap.logout().catch(() => imap.close());
    } catch (error) {
      imap.close();
      return { error: explain("imap", error, m), cursor: null };
    }
    // Sending through Google's script: the script is checked instead of the mail server.
    if (m.relayUrl && m.relaySecret) {
      try {
        await pingRelay(m.relayUrl, m.relaySecret);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error), cursor: null };
      }
      return { error: null, cursor };
    }
    const smtp = smtpOf(m);
    try {
      await smtp.verify();
    } catch (error) {
      return { error: explain("smtp", error, m), cursor: null };
    } finally {
      smtp.close();
    }
    return { error: null, cursor };
  },
  async read(m, cursor, limit) {
    await publicServer(m.imapHost, m.imapPort, IMAP_PORTS);
    const imap = imapOf(m);
    await imap.connect();
    try {
      const lock = await imap.getMailboxLock("INBOX");
      try {
        const box = imap.mailbox;
        if (!box) throw new Error("The mailbox has no INBOX.");
        const uidValidity = String(box.uidValidity);
        const top = Number(box.uidNext) - 1;
        // First read, or the server renumbered the INBOX: read from now on.
        if (!cursor || cursor.uidValidity !== uidValidity)
          return { cursor: { uidValidity, lastUid: top }, sources: [] };
        if (top <= cursor.lastUid) return { cursor, sources: [] };
        const to = Math.min(top, cursor.lastUid + limit);
        const sources: Buffer[] = [];
        for await (const message of imap.fetch(
          `${cursor.lastUid + 1}:${to}`,
          { uid: true, source: true },
          { uid: true },
        ))
          if (message.source && message.uid > cursor.lastUid) sources.push(message.source);
        return { cursor: { uidValidity, lastUid: to }, sources };
      } finally {
        lock.release();
      }
    } finally {
      await imap.logout().catch(() => imap.close());
    }
  },
  async send(m, mail) {
    if (m.relayUrl && m.relaySecret) {
      await relaySend(m.relayUrl, m.relaySecret, { ...mail, from: { address: m.address, name: m.name } });
      return;
    }
    await publicServer(m.smtpHost, m.smtpPort, SMTP_PORTS);
    const smtp = smtpOf(m);
    try {
      await smtp.sendMail({
        from: m.name ? { name: m.name, address: m.address } : m.address,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        messageId: mail.messageId,
        ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: mail.references } : {}),
        ...(mail.attachments?.length
          ? {
              attachments: mail.attachments.map((file) => ({
                filename: file.filename,
                content: Buffer.from(file.content),
                contentType: file.contentType,
              })),
            }
          : {}),
      });
    } catch (error) {
      throw new Error(explain("smtp", error, m));
    } finally {
      smtp.close();
    }
  },
};

/** A developer's computer: nothing reaches a mail server. What is "sent" is written to
 *  .data/mail-sink; "received" mail is what `sinkReceive` put in. */
const sinkQueue: Buffer[] = [];
export function sinkReceive(source: Buffer): void {
  sinkQueue.push(source);
}
const sinkTransport: MailTransport = {
  async check() {
    return { error: null, cursor: { uidValidity: "sink", lastUid: 0 } };
  },
  async read(_m, cursor) {
    const sources = sinkQueue.splice(0, sinkQueue.length);
    return {
      cursor: { uidValidity: "sink", lastUid: (cursor?.lastUid ?? 0) + sources.length },
      sources,
    };
  },
  async send(m, mail) {
    const folder = fileURLToPath(new URL("../../../../.data/mail-sink/", import.meta.url));
    await mkdir(folder, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${mail.to.replace(/[^a-z0-9@.]/gi, "_")}.txt`;
    await writeFile(
      `${folder}${name}`,
      [
        `From: ${m.address}`,
        `To: ${mail.to}`,
        `Subject: ${mail.subject}`,
        `Message-ID: ${mail.messageId}`,
        `In-Reply-To: ${mail.inReplyTo ?? ""}`,
        `Attachments: ${(mail.attachments ?? []).map((file) => file.filename).join(", ")}`,
        "",
        mail.text,
      ].join("\n"),
    );
    for (const [index, file] of (mail.attachments ?? []).entries())
      await writeFile(
        `${folder}${name.replace(/\.txt$/, "")}-${index + 1}-${file.filename.replace(/[^\w .-]/g, "_")}`,
        file.content,
      );
    console.log(`email (sink): ${m.address} → ${mail.to}: ${mail.subject}`);
  },
};

export const mailSink = () =>
  process.env.MAIL_SINK === "1" && process.env.NODE_ENV !== "production";

let current: MailTransport | null = null;
export function mailTransport(): MailTransport {
  if (!current) current = mailSink() ? sinkTransport : realTransport;
  return current;
}
/** The tests' own transport. */
export function useMailTransport(next: MailTransport | null): void {
  current = next;
}

// ---------------------------------------------------------------- one email

export type Email = {
  messageId: string;
  from: { address: string; name: string | null };
  subject: string;
  text: string;
  at: Date;
  references: string[];
  files: IncomingFile[];
  missingFiles: number;
  automatic: boolean;
};

const KEPT_TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 10;

/** Drops what they quoted from earlier mail: the answer is what is new. */
export function newPart(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (line, index) =>
      /^On .+wrote:\s*$/.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      (line.startsWith(">") &&
        lines.slice(index).every((rest) => !rest.trim() || rest.startsWith(">"))),
  );
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}

export async function parseEmail(source: Buffer): Promise<Email> {
  const parsed = await simpleParser(source);
  const from = parsed.from?.value?.[0];
  const references = Array.isArray(parsed.references)
    ? [...parsed.references]
    : parsed.references
      ? [parsed.references]
      : [];
  if (parsed.inReplyTo && !references.includes(parsed.inReplyTo)) references.push(parsed.inReplyTo);
  const header = (name: string) => {
    const value = parsed.headers.get(name);
    return value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  };
  const address = String(from?.address ?? "").toLowerCase();
  const automatic =
    /auto-(generated|replied|notified)/i.test(header("auto-submitted")) ||
    /^(bulk|list|junk)$/i.test(header("precedence").trim()) ||
    parsed.headers.has("list-id") ||
    parsed.headers.has("list-unsubscribe") ||
    parsed.headers.has("list") ||
    parsed.headers.has("x-autoreply") ||
    parsed.headers.has("x-autorespond") ||
    /^(no-?reply|donotreply|mailer-daemon|postmaster)@/i.test(address);
  const files: IncomingFile[] = [];
  let missing = 0;
  for (const attachment of parsed.attachments ?? []) {
    if (
      attachment.related ||
      (attachment.contentDisposition === "inline" && !attachment.contentType.startsWith("image/"))
    )
      continue;
    if (
      !KEPT_TYPES.test(attachment.contentType) ||
      attachment.size > MAX_FILE ||
      files.length >= MAX_FILES
    ) {
      missing += 1;
      continue;
    }
    files.push({
      name: attachment.filename ?? `attachment-${files.length + 1}`,
      mime: attachment.contentType,
      bytes: new Uint8Array(attachment.content),
    });
  }
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const text =
    parsed.text ??
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  return {
    messageId: parsed.messageId ?? `<${randomUUID()}@no-message-id>`,
    from: { address, name: from?.name?.trim() || null },
    subject: String(parsed.subject ?? ""),
    text: newPart(text),
    at: parsed.date ?? new Date(),
    references,
    files,
    missingFiles: missing,
    automatic,
  };
}

// ---------------------------------------------------------------- connecting a mailbox

export type MailboxInput = {
  address: string;
  name?: string | null;
  user?: string | null;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  intake?: "screen" | "all";
  /** The Google Apps Script web app (…/exec) that sends for this mailbox, when SMTP is blocked. */
  relayUrl?: string | null;
};

/** Google and Zoho show app passwords in groups of four; the spaces are only for reading. */
const appPassword = (password: string, host: string) =>
  /gmail|google|zoho/i.test(host) ? password.replace(/\s+/g, "") : password.trim();

export async function connectMailbox(
  db: Database,
  me: Me,
  input: MailboxInput,
): Promise<{ id: number }> {
  allow(me, CHANNEL_ROLES, "connect a mailbox");
  const address = input.address.trim().toLowerCase();
  const mailbox: Mailbox = {
    address,
    name: input.name?.trim() || null,
    user: input.user?.trim() || address,
    password: appPassword(input.password, input.imapHost),
    imapHost: input.imapHost.trim().toLowerCase(),
    imapPort: input.imapPort,
    smtpHost: input.smtpHost.trim().toLowerCase(),
    smtpPort: input.smtpPort,
  };
  const relayUrl = input.relayUrl?.trim() || null;
  if (relayUrl) {
    if (!isRelayUrl(relayUrl))
      throw new Refusal(
        400,
        "invalid",
        "Paste the Google script's web app address, ending in /exec.",
        "relayUrl",
      );
    // Connected before with this script: its secret is kept (the script hands it over only once).
    const [before] = await rows<{ secret: string }>(
      db,
      sql`select secret from channel_account where kind = 'email' and key = ${address}`,
    );
    const kept = before ? (JSON.parse(unseal(before.secret)) as Mailbox) : null;
    if (kept?.relayUrl === relayUrl && kept.relaySecret) mailbox.relaySecret = kept.relaySecret;
    else {
      try {
        const paired = await pairRelay(relayUrl);
        if (paired.email && paired.email !== address)
          throw new Error(`The script sends as ${paired.email}, not ${address}.`);
        mailbox.relaySecret = paired.secret;
      } catch (error) {
        throw new Refusal(
          400,
          "invalid",
          error instanceof Error ? error.message : String(error),
          "relayUrl",
        );
      }
    }
    mailbox.relayUrl = relayUrl;
  }
  const checked = await mailTransport().check(mailbox);
  if (checked.error) throw new Refusal(400, "invalid", checked.error, "password");
  const [account] = await rows<{ id: number }>(
    db,
    sql`insert into channel_account (kind, key, name, secret, intake, cursor, connected_by, synced_at, sync_error)
      values ('email', ${address}, ${mailbox.name ?? address}, ${seal(JSON.stringify(mailbox))}, ${input.intake ?? "screen"},
        ${checked.cursor ? JSON.stringify(checked.cursor) : null}::jsonb, ${me.id}, now(), null)
      on conflict (kind, key) do update set name = excluded.name, secret = excluded.secret, intake = excluded.intake, active = true,
        cursor = coalesce(channel_account.cursor, excluded.cursor), connected_by = excluded.connected_by, connected_at = now(), sync_error = null
      returning id::int as id`,
  );
  return { id: account?.id as number };
}

type MailAccount = Account & { mailbox: Mailbox; intake: "screen" | "all"; cursor: Cursor | null };

async function mailAccount(db: Database, id: number): Promise<MailAccount | null> {
  const [found] = await rows<{
    id: number;
    key: string;
    name: string;
    secret: string;
    intake: "screen" | "all";
    cursor: Cursor | null;
  }>(
    db,
    sql`select id::int as id, key, name, secret, intake, cursor from channel_account where id = ${id} and kind = 'email' and active`,
  );
  return found
    ? {
        id: found.id,
        kind: "email",
        key: found.key,
        name: found.name,
        mailbox: JSON.parse(unseal(found.secret)) as Mailbox,
        intake: found.intake,
        cursor: found.cursor,
      }
    : null;
}

// ---------------------------------------------------------------- reading the INBOX

/** Reads what came since the last read; answers how many emails landed on cases. */
export async function pullMailbox(db: Database, accountId: number): Promise<number> {
  const account = await mailAccount(db, accountId);
  if (!account) return 0;
  let landed = 0;
  try {
    const read = await mailTransport().read(account.mailbox, account.cursor, 50);
    for (const source of read.sources) if (await takeEmail(db, account, source)) landed += 1;
    await db.execute(
      sql`update channel_account set cursor = ${JSON.stringify(read.cursor)}::jsonb, synced_at = now(), sync_error = null where id = ${accountId}`,
    );
  } catch (error) {
    await db.execute(
      sql`update channel_account set sync_error = ${error instanceof Error ? error.message.slice(0, 500) : String(error)} where id = ${accountId}`,
    );
  }
  return landed;
}

/** One email: onto its case, held for the agent, or left (automatic mail, our own). */
async function takeEmail(db: Database, account: MailAccount, source: Buffer): Promise<boolean> {
  const mail = await parseEmail(source);
  if (!mail.from.address || mail.automatic || mail.from.address === account.key) return false;
  const verdict = await senderVerdict(db, account, mail);
  if (verdict === "in") return land(db, account, mail);
  await db.execute(
    sql`insert into email_held (account_id, address, name, subject, snippet, files, message_id, source, at, state)
      values (${account.id}, ${mail.from.address}, ${mail.from.name}, ${mail.subject.slice(0, 300)}, ${mail.text.replace(/\s+/g, " ").slice(0, 300)},
        ${mail.files.length + mail.missingFiles}, ${mail.messageId}, ${source}, ${mail.at.toISOString()}, ${verdict === "ignored" ? "ignored" : "held"})
      on conflict (account_id, message_id) do nothing`,
  );
  return false;
}

async function senderVerdict(
  db: Database,
  account: MailAccount,
  mail: Email,
): Promise<"in" | "held" | "ignored"> {
  const [said] = await rows<{ verdict: string }>(
    db,
    sql`select verdict from email_sender where account_id = ${account.id} and address = ${mail.from.address}`,
  );
  if (said?.verdict === "ignored") return "ignored";
  if (said?.verdict === "allowed" || account.intake === "all") return "in";
  if (await caseOf(db, account, mail.from.address)) return "in";
  const [known] = await rows<{ n: number }>(
    db,
    sql`select ((select count(*) from customer where active and lower(email) = ${mail.from.address})
        + (select count(*) from lead_message where account_id = ${account.id} and direction = 'out' and external_id in (${sql.join(
          (mail.references.length ? mail.references : [""]).map((ref) => sql`${ref}`),
          sql`, `,
        )})))::int as n`,
  );
  return (known?.n ?? 0) > 0 ? "in" : "held";
}

async function land(db: Database, account: MailAccount, mail: Email): Promise<boolean> {
  const name = mail.from.name ?? mail.from.address.split("@")[0] ?? mail.from.address;
  const kept = await keepMessage(db, {
    account,
    key: mail.from.address,
    externalId: mail.messageId,
    direction: "in",
    subject: mail.subject,
    text: mail.text,
    at: mail.at,
    files: mail.files,
    missingFiles: mail.missingFiles,
    opens: { name, email: mail.from.address, source: "email" },
  });
  // A new enquiry by email is thanked by itself, when the company switched it on; never one
  // read from the mailbox's past (a mailbox just connected).
  if (kept.opened && kept.leadId && Date.now() - mail.at.getTime() < 24 * 60 * 60 * 1000) {
    const { tellCase } = await import("./case-mail");
    void tellCase(db, null, kept.leadId, "enquiry");
  }
  return kept.kept;
}

// ---------------------------------------------------------------- held senders

export async function heldSenders(db: Database, me: Me): Promise<HeldSender[]> {
  allow(me, LEAD_WORK_ROLES, "see new email senders");
  return rows<HeldSender>(
    db,
    sql`select max(h.id)::int as id, h.account_id::int as "accountId", a.key as mailbox, h.address, max(h.name) as name,
        (array_agg(h.subject order by h.at desc))[1] as subject, (array_agg(h.snippet order by h.at desc))[1] as snippet,
        count(*)::int as count, to_char(max(h.at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from email_held h join channel_account a on a.id = h.account_id and a.active
      where h.state = 'held' group by h.account_id, a.key, h.address order by max(h.at) desc limit 100`,
  );
}

/** "Make enquiry": the sender is let in and everything they sent lands on their case. */
export async function letSenderIn(
  db: Database,
  me: Me,
  heldId: number,
): Promise<{ leadId: number | null }> {
  allow(me, LEAD_WORK_ROLES, "make an enquiry from an email");
  const [held] = await rows<{ accountId: number; address: string }>(
    db,
    sql`select account_id::int as "accountId", address from email_held where id = ${heldId}`,
  );
  if (!held) throw new Refusal(404, "not_found", "That email isn't there any more.");
  const account = await mailAccount(db, held.accountId);
  if (!account) throw new Refusal(409, "not_now", "That mailbox isn't connected any more.");
  await db.execute(
    sql`insert into email_sender (account_id, address, verdict, by_person) values (${held.accountId}, ${held.address}, 'allowed', ${me.id})
      on conflict (account_id, address) do update set verdict = 'allowed', by_person = excluded.by_person, at = now()`,
  );
  // Each held email is claimed once, so two clicks never make two lines.
  const claimed = await rows<{ source: Uint8Array }>(
    db,
    sql`update email_held set state = 'let_in', decided_by = ${me.id}, decided_at = now()
      where account_id = ${held.accountId} and address = ${held.address} and state = 'held' returning source`,
  );
  const mails = await Promise.all(claimed.map((row) => parseEmail(Buffer.from(row.source))));
  for (const mail of mails.sort((a, b) => a.at.getTime() - b.at.getTime()))
    await land(db, account, mail);
  const lead = await caseOf(db, account, held.address);
  if (lead && onlineDesk(me))
    await db.execute(
      sql`update lead set assigned_to = ${me.id} where id = ${lead.id} and assigned_to is null`,
    );
  return { leadId: lead?.id ?? null };
}

/** "Not a customer": their mail stays out (kept, never a case). */
export async function ignoreSender(db: Database, me: Me, heldId: number): Promise<void> {
  allow(me, LEAD_WORK_ROLES, "set a sender aside");
  const [held] = await rows<{ accountId: number; address: string }>(
    db,
    sql`select account_id::int as "accountId", address from email_held where id = ${heldId}`,
  );
  if (!held) throw new Refusal(404, "not_found", "That email isn't there any more.");
  await db.execute(
    sql`insert into email_sender (account_id, address, verdict, by_person) values (${held.accountId}, ${held.address}, 'ignored', ${me.id})
      on conflict (account_id, address) do update set verdict = 'ignored', by_person = excluded.by_person, at = now()`,
  );
  await db.execute(
    sql`update email_held set state = 'ignored', decided_by = ${me.id}, decided_at = now() where account_id = ${held.accountId} and address = ${held.address} and state = 'held'`,
  );
}

// ---------------------------------------------------------------- answering

export async function replyByEmail(
  db: Database,
  me: Me,
  leadId: number,
  text: string,
  extra: { subject?: string; attachments?: MailFile[] } = {},
): Promise<void> {
  await answerGate(db, me, leadId, "answer an email");
  await sendOnCase(db, leadId, text, extra, me.id);
  if (onlineDesk(me))
    await db.execute(
      sql`update lead set assigned_to = ${me.id} where id = ${leadId} and assigned_to is null`,
    );
}

/**
 * Puts a case on email when it has no conversation yet: their address, from the first mailbox
 * connected. Answers whether the case now talks by email.
 */
export async function startEmailThread(db: Database, leadId: number): Promise<boolean> {
  const [lead] = await rows<{ email: string | null; chat: string | null }>(
    db,
    sql`select email, chat_channel as chat from lead where id = ${leadId}`,
  );
  if (!lead) return false;
  if (lead.chat === "email") return true;
  if (lead.chat || !lead.email) return false;
  const [mailbox] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from channel_account where kind = 'email' and active order by id limit 1`,
  );
  if (!mailbox) return false;
  await db.execute(
    sql`update lead set chat_channel = 'email', chat_account_id = ${mailbox.id}, chat_key = ${lead.email.toLowerCase()} where id = ${leadId} and chat_key is null`,
  );
  return true;
}

/** Sends an email on the case's email conversation, threaded, and keeps it in the chat. */
export async function sendOnCase(
  db: Database,
  leadId: number,
  text: string,
  extra: { subject?: string; attachments?: MailFile[] },
  byPerson: number | null,
): Promise<void> {
  const body = text.trim();
  if (!body) throw new Refusal(400, "invalid", "Write something to send.", "text");
  const chat = await chatOf(db, leadId);
  if (!chat || chat.account.kind !== "email")
    throw new Refusal(409, "not_now", "This case didn't come by email.", "text");
  const account = await mailAccount(db, chat.account.id);
  if (!account)
    throw new Refusal(
      409,
      "not_now",
      `The mailbox ${chat.account.key} isn't connected any more. Connect it again under Channels.`,
      "text",
    );
  const thread = await rows<{ externalId: string; subject: string | null; direction: string }>(
    db,
    sql`select m.external_id as "externalId", m.subject, m.direction from lead_message m join lead l on l.id = m.lead_id
      where m.account_id = ${account.id} and l.chat_key = ${chat.key} and m.external_id is not null order by m.at desc limit 10`,
  );
  const last = thread.find((row) => row.direction === "in") ?? thread[0];
  const subject = last?.subject
    ? /^re:/i.test(last.subject)
      ? last.subject
      : `Re: ${last.subject}`
    : (extra.subject ?? "Your enquiry");
  const domain = account.key.slice(account.key.lastIndexOf("@") + 1);
  const messageId = `<${randomUUID()}@${domain}>`;
  const at = new Date();
  try {
    await mailTransport().send(account.mailbox, {
      to: chat.key,
      subject,
      text: body,
      messageId,
      inReplyTo: last?.externalId ?? null,
      references: thread.map((row) => row.externalId).reverse(),
      ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
    });
  } catch (error) {
    throw new Refusal(
      409,
      "not_sent",
      error instanceof Error ? error.message : "The email wasn't sent.",
      "text",
    );
  }
  const attached = (extra.attachments ?? []).map((file) => file.filename);
  await keepMessage(db, {
    account,
    key: chat.key,
    externalId: messageId,
    direction: "out",
    subject,
    text: attached.length ? `${body}\n\n(Attached: ${attached.join(", ")})` : body,
    at,
    byPerson,
  });
}

/**
 * Sends an email that belongs to no conversation (a hospital's or a distributor's order update)
 * from the first mailbox connected. Answers false when no mailbox is connected.
 */
export async function sendFromMailbox(
  db: Database,
  mail: { to: string; subject: string; text: string },
): Promise<boolean> {
  const [first] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from channel_account where kind = 'email' and active order by id limit 1`,
  );
  const account = first ? await mailAccount(db, first.id) : null;
  if (!account) return false;
  const domain = account.key.slice(account.key.lastIndexOf("@") + 1);
  await mailTransport().send(account.mailbox, {
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId: `<${randomUUID()}@${domain}>`,
  });
  return true;
}
