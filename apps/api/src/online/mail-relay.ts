// Sending through the company's own Google account instead of a mail server. Render's free plan
// doesn't open mail ports (465/587), so the CRM composes the email here exactly as it would for
// SMTP (our Message-ID, threading, files) and hands the finished message to a small Google Apps
// Script web app running as the mailbox's user, which sends it through the Gmail API. The script
// pairs with the CRM once: it makes a secret and hands it over only that first time; every later
// request is signed with it (HMAC-SHA256 over the exact payload) and carries the time, so a copied
// request is refused after five minutes. The script is the old CRM's (docs/mail-relay/Code.gs).

import { createHmac, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

/** A deployed Apps Script web app: https://script.google.com/macros/s/<id>/exec */
const RELAY_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
export const isRelayUrl = (url: unknown): url is string =>
  typeof url === "string" && RELAY_URL.test(url.trim());

/** Gmail refuses messages above ~25 MB; base64 inside JSON costs a third more. */
export const RELAY_MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

type Fetch = typeof fetch;
let fetcher: Fetch = (...args) => fetch(...args);

/** Tests put their own Google in place (undefined = the real one). */
export function useRelayFetch(next: Fetch | undefined): void {
  fetcher = next ?? ((...args) => fetch(...args));
}

export type RelayMail = {
  from: { address: string; name: string | null };
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
};

async function call(url: string, body: unknown): Promise<Record<string, unknown>> {
  if (!isRelayUrl(url)) throw new Error("That isn't a Google Apps Script web app address (…/exec).");
  let res: Response;
  try {
    // Apps Script answers a POST with a redirect to the result, read with GET; fetch follows it.
    res = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Google's script didn't answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Google's script answered ${res.status}.`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      "Google answered with a page instead of the script: deploy it as a web app that runs as you and that Anyone may open.",
    );
  }
}

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

async function signed(url: string, secret: string, op: string, extra: Record<string, unknown>) {
  const payload = JSON.stringify({ op, ts: Date.now(), nonce: randomUUID(), ...extra });
  return call(url, { payload, sig: sign(payload, secret) });
}

/** Pair with the script: its secret, and the Google account it sends as. */
export async function pairRelay(url: string): Promise<{ secret: string; email: string }> {
  const json = await call(url.trim(), { op: "pair" });
  if (json.ok !== true || typeof json.secret !== "string" || json.secret.length < 32) {
    const why = String(json.error ?? "refused");
    throw new Error(
      /already paired/i.test(why)
        ? "This Google script is already paired (with the old CRM). In Apps Script open Project Settings → Script Properties, delete CRM_SECRET, then connect again."
        : `Google's script refused to pair: ${why}`,
    );
  }
  return { secret: json.secret, email: String(json.email ?? "").toLowerCase() };
}

/** Is the paired script there, and whom does it send as? */
export async function pingRelay(url: string, secret: string): Promise<{ email: string }> {
  const json = await signed(url.trim(), secret, "ping", {});
  if (json.ok !== true) throw new Error(`Google's script refused: ${String(json.error ?? "")}`);
  return { email: String(json.email ?? "").toLowerCase() };
}

/** The email as a mail server would get it: our headers, threading and files, CRLF lines. */
export async function composeRaw(mail: RelayMail): Promise<Buffer> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const info = (await composer.sendMail({
    from: mail.from.name ? { name: mail.from.name, address: mail.from.address } : mail.from.address,
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
  })) as { message: Buffer };
  return info.message;
}

/** Sends one email through the mailbox's Google script. The Message-ID keys a retry. */
export async function relaySend(url: string, secret: string, mail: RelayMail): Promise<void> {
  const raw = await composeRaw(mail);
  if (raw.length > RELAY_MAX_BYTES)
    throw new Error(
      `This email is ${(raw.length / 1024 / 1024).toFixed(1)} MB; Google's script takes up to ${RELAY_MAX_BYTES / 1024 / 1024} MB. Send fewer or smaller files.`,
    );
  const json = await signed(url, secret, "send", { key: mail.messageId, raw: raw.toString("base64url") });
  if (json.ok !== true) throw new Error(`Google refused the email: ${String(json.error ?? "refused")}`);
}
