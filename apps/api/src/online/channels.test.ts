import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import type { ChannelsData, ChatThread, InboxList, LeadCase, LeadDesk } from "../types";
import { type Cursor, type Mailbox, type OutgoingMail, useMailTransport } from "./email";
import { type Graph, type GraphAnswer, useGraph } from "./graph";
import { drainInbox, pullPage } from "./messenger";

const PASSWORD = "test-password-1";
const SECRET = "test-app-secret";
const PAGE = "555000111";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};

// ---- Meta, as the tests want it
const sent: { path: string; json: unknown }[] = [];
const conversations: {
  id: string;
  updated_time: string;
  participants: { data: { id: string; name?: string }[] };
  messages: unknown[];
}[] = [];
const fakeGraph: Graph = {
  async call<T>(
    method: "GET" | "POST",
    path: string,
    token: string,
    params: Record<string, string> = {},
    json?: unknown,
  ): Promise<GraphAnswer<T>> {
    const ok = (data: unknown) => ({ data: data as T, error: null, code: null });
    if (token !== "page-token")
      return { data: null, error: "Invalid OAuth access token. [190]", code: 190 };
    if (method === "GET" && path === "/me") return ok({ id: PAGE, name: "2MG Inc." });
    if (path.endsWith("/subscribed_apps")) return ok({ success: true });
    if (method === "POST" && path === "/me/messages") {
      sent.push({ path, json });
      return ok({ message_id: `m_ours_${sent.length}` });
    }
    if (method === "GET" && path === "/psid-maria")
      return ok({ first_name: "Maria", last_name: "Santos" });
    if (method === "GET" && path === `/${PAGE}/conversations`) {
      if (params.user_id) return ok({ data: [] });
      return ok({ data: conversations.map(({ messages: _messages, ...rest }) => rest) });
    }
    const conversation = conversations.find((item) => path === `/${item.id}/messages`);
    if (conversation) return ok({ data: conversation.messages });
    return { data: null, error: "Unsupported get request.", code: 100 };
  },
  async fetchFile(url) {
    if (url.includes("broken")) return null;
    return { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]), mime: "image/png" };
  },
};

// ---- the mail server, as the tests want it
const inbox: Buffer[] = [];
const outbox: OutgoingMail[] = [];
useMailTransport({
  async check(mailbox: Mailbox) {
    return mailbox.password === "app-password"
      ? { error: null, cursor: { uidValidity: "1", lastUid: 0 } }
      : { error: "Google didn't accept the sign-in.", cursor: null };
  },
  async read(_mailbox: Mailbox, cursor: Cursor | null) {
    const sources = inbox.splice(0, inbox.length);
    return {
      cursor: { uidValidity: "1", lastUid: (cursor?.lastUid ?? 0) + sources.length },
      sources,
    };
  },
  async send(_mailbox: Mailbox, mail: OutgoingMail) {
    outbox.push(mail);
  },
});

const email = (from: string, subject: string, text: string, extra: string[] = []) =>
  Buffer.from(
    [
      `From: ${from}`,
      "To: <info@2mg.test>",
      `Subject: ${subject}`,
      `Message-ID: <${Math.random().toString(36).slice(2)}@mail.test>`,
      `Date: ${new Date().toUTCString()}`,
      ...extra,
      "",
      text,
    ].join("\r\n"),
  );

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

function signed(body: unknown, secret = SECRET) {
  const text = JSON.stringify(body);
  return app.request("/webhooks/messenger", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`,
    },
    body: text,
  });
}
const message = (psid: string, mid: string, text: string, extra: object = {}, at = Date.now()) => ({
  object: "page",
  entry: [
    {
      id: PAGE,
      messaging: [
        {
          sender: { id: psid },
          recipient: { id: PAGE },
          timestamp: at,
          message: { mid, text, ...extra },
        },
      ],
    },
  ],
});
const caseOfPsid = async (psid: string) =>
  (
    await rows<{ id: number }>(
      db,
      sql`select id::int as id from lead where chat_key = ${psid} order by id desc limit 1`,
    )
  )[0]?.id as number;

beforeAll(async () => {
  process.env.MESSENGER_APP_SECRET = SECRET;
  process.env.MESSENGER_VERIFY_TOKEN = "verify-me";
  useGraph(fakeGraph);
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jane", "sarla", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
});

afterAll(() => {
  useGraph(null);
  useMailTransport(null);
});

describe("Messenger", () => {
  it("answers Meta's check and refuses a body it didn't sign", async () => {
    expect(
      await (
        await app.request(
          "/webhooks/messenger?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42",
        )
      ).text(),
    ).toBe("42");
    expect(
      (
        await app.request(
          "/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42",
        )
      ).status,
    ).toBe(403);
    expect((await signed(message("psid-x", "m_x", "hi"), "not-the-secret")).status).toBe(401);
  });

  it("keeps a message for a page nobody connected, and works it once the page is connected", async () => {
    expect(
      (await signed(message("psid-maria", "m_1", "Hello, do you have Anastrozole?"))).status,
    ).toBe(200);
    const [waiting] = await rows<{ state: string }>(
      db,
      sql`select state from inbox_event where event_key = 'm:m_1'`,
    );
    expect(waiting?.state).toBe("unrouted");

    expect((await post("jane", "/api/channels/messenger", { token: "page-token" })).status).toBe(
      403,
    );
    expect((await post("naresh", "/api/channels/messenger", { token: "wrong" })).status).toBe(400);
    const connected = await post("naresh", "/api/channels/messenger", { token: "page-token" });
    expect(connected.status).toBe(200);
    expect(await connected.json()).toMatchObject({ name: "2MG Inc.", subscribeError: null });
    await drainInbox(db);

    const id = await caseOfPsid("psid-maria");
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.lead).toMatchObject({
      name: "Maria Santos",
      source: "messenger",
      chatChannel: "messenger",
      chatAccount: "2MG Inc.",
      awaitingReply: true,
    });
    // The page's token is kept sealed and never comes back to a screen.
    const channels = await read<ChannelsData>("naresh", "/api/channels");
    expect(JSON.stringify(channels)).not.toContain("page-token");
    const [stored] = await rows<{ secret: string }>(
      db,
      sql`select secret from channel_account where key = ${PAGE}`,
    );
    expect(stored?.secret).not.toContain("page-token");
  });

  it("puts later messages, photos and the same message twice on the one case", async () => {
    const id = await caseOfPsid("psid-maria");
    await signed(
      message("psid-maria", "m_2", "Here is the prescription", {
        attachments: [
          { type: "image", payload: { url: "https://cdn.test/rx.png" } },
          { type: "image", payload: { url: "https://cdn.test/broken.png" } },
        ],
      }),
    );
    await signed(message("psid-maria", "m_2", "Here is the prescription"));
    await drainInbox(db);
    expect(await caseOfPsid("psid-maria")).toBe(id);
    const thread = await read<ChatThread>("jane", `/api/leads/${id}/thread`);
    expect(thread.lines.filter((line) => line.kind === "message")).toHaveLength(2);
    const withPhoto = thread.lines.find((line) => line.text === "Here is the prescription");
    expect(withPhoto?.files).toHaveLength(2);
    expect(withPhoto?.files[1]).toEqual({ missing: true });
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.unsorted).toHaveLength(1);

    // Filing the chat photo as the prescription is the paper on file.
    const photo = lead.unsorted[0]?.id as number;
    expect((await post("jane", `/api/lead-files/${photo}/kind`, { kind: "rx" })).status).toBe(200);
    const filed = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(filed.unsorted).toHaveLength(0);
    expect(filed.papers.find((paper) => paper.kind === "rx")?.files).toHaveLength(1);
  });

  it("answers within 24 hours, keeps our reply once even when Meta echoes it, and hears reads and reactions", async () => {
    const id = await caseOfPsid("psid-maria");
    expect((await post("sarla", `/api/leads/${id}/reply`, { text: "Hi" })).status).toBe(403);
    expect(
      (await post("jane", `/api/leads/${id}/reply`, { text: "Yes, ₱50 a tablet." })).status,
    ).toBe(200);
    expect(sent.at(-1)?.json).toEqual({
      recipient: { id: "psid-maria" },
      messaging_type: "RESPONSE",
      message: { text: "Yes, ₱50 a tablet." },
    });
    const mid = `m_ours_${sent.length}`;
    await signed({
      object: "page",
      entry: [
        {
          id: PAGE,
          messaging: [
            {
              sender: { id: PAGE },
              recipient: { id: "psid-maria" },
              timestamp: Date.now(),
              message: { mid, text: "Yes, ₱50 a tablet.", is_echo: true },
            },
          ],
        },
      ],
    });
    await signed({
      object: "page",
      entry: [
        {
          id: PAGE,
          messaging: [
            {
              sender: { id: "psid-maria" },
              recipient: { id: PAGE },
              timestamp: Date.now(),
              reaction: { action: "react", emoji: "❤️", mid },
            },
          ],
        },
      ],
    });
    await signed({
      object: "page",
      entry: [
        {
          id: PAGE,
          messaging: [
            {
              sender: { id: "psid-maria" },
              recipient: { id: PAGE },
              timestamp: Date.now(),
              read: { watermark: Date.now() },
            },
          ],
        },
      ],
    });
    await drainInbox(db);
    const thread = await read<ChatThread>("jane", `/api/leads/${id}/thread`);
    const ours = thread.lines.filter((line) => line.direction === "out");
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ by: "Jane", reaction: "❤️" });
    expect(thread.readAt).not.toBeNull();
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.lead.awaitingReply).toBe(false);
    expect(lead.lead.assignedName).toBe("Jane");

    // A reply after Meta's 24 hours is refused before it reaches Meta.
    await db.execute(
      sql`update lead set last_inbound_at = now() - interval '25 hours' where id = ${id}`,
    );
    const late = await post("jane", `/api/leads/${id}/reply`, { text: "Still there?" });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: { message: string } }).error.message).toContain(
      "24 hours",
    );
  });

  it("opens a lost case again when they write, and lists the conversation in the Inbox", async () => {
    const id = await caseOfPsid("psid-maria");
    expect(
      (await post("jane", `/api/leads/${id}/lost`, { reason: "Bought elsewhere" })).status,
    ).toBe(200);
    await signed(message("psid-maria", "m_3", "Sorry, I want to order after all"));
    await drainInbox(db);
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.lead.state).toBe("open");
    const list = await read<InboxList>("jane", "/api/inbox?filter=needs");
    expect(list.chats.map((chat) => chat.leadId)).toContain(id);
    expect(list.chats.find((chat) => chat.leadId === id)).toMatchObject({
      unread: true,
      lastMessage: "Sorry, I want to order after all",
    });
    await post("jane", `/api/leads/${id}/seen`);
    expect(
      (await read<InboxList>("jane", "/api/inbox")).chats.find((chat) => chat.leadId === id)
        ?.unread,
    ).toBe(false);
    const desk = await read<LeadDesk>("jane", "/api/leads");
    expect(desk.cards.find((card) => card.id === id)).toMatchObject({
      chat: "messenger",
      awaitingReply: true,
    });
  });

  it("reads the page's history, and an old message never leaves the case waiting", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    conversations.push({
      id: "t_1",
      updated_time: old,
      participants: {
        data: [
          { id: "psid-jose", name: "Jose Cruz" },
          { id: PAGE, name: "2MG Inc." },
        ],
      },
      messages: [
        {
          id: "m_h2",
          created_time: old,
          from: { id: PAGE, name: "2MG Inc." },
          message: "We have it.",
        },
        {
          id: "m_h1",
          created_time: new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString(),
          from: { id: "psid-jose", name: "Jose Cruz" },
          message: "Price of Imatinib?",
        },
      ],
    });
    const [account] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from channel_account where key = ${PAGE}`,
    );
    expect(await pullPage(db, account?.id as number)).toBe(2);
    expect(await pullPage(db, account?.id as number)).toBe(0);
    const id = await caseOfPsid("psid-jose");
    const lead = await read<LeadCase>("jane", `/api/leads/${id}`);
    expect(lead.lead).toMatchObject({ name: "Jose Cruz", awaitingReply: false });
    expect(
      (await read<ChatThread>("jane", `/api/leads/${id}/thread`)).lines.map((line) => line.text),
    ).toEqual(["Price of Imatinib?", "We have it."]);
  });
});

describe("email", () => {
  let mailbox = 0;

  it("connects a mailbox only when its sign-in works", async () => {
    const input = {
      address: "info@2mg.test",
      password: "wrong",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
    };
    expect((await post("jane", "/api/channels/email", input)).status).toBe(403);
    const refused = await post("naresh", "/api/channels/email", input);
    expect(refused.status).toBe(400);
    const made = await post("naresh", "/api/channels/email", {
      ...input,
      password: "app-password",
    });
    expect(made.status).toBe(200);
    mailbox = ((await made.json()) as { id: number }).id;
  });

  it("holds a new sender until the desk lets them in; lists and automatic mail never open a case", async () => {
    inbox.push(
      email(
        '"Carmen Diaz" <carmen@mail.test>',
        "Price of Letrozole",
        "Hi, how much is Letrozole?\n\nOn Mon someone wrote:\n> old",
      ),
    );
    inbox.push(
      email("<news@shop.test>", "Our sale", "Big sale", ["List-Unsubscribe: <mailto:x@shop.test>"]),
    );
    inbox.push(email("<noreply@bank.test>", "Statement", "Your statement"));
    await post("naresh", `/api/channels/${mailbox}/pull`);
    expect(
      await rows(db, sql`select id from lead where chat_key = 'carmen@mail.test'`),
    ).toHaveLength(0);
    const held = await read<{ senders: { id: number; address: string; subject: string }[] }>(
      "jane",
      "/api/email-held",
    );
    expect(held.senders).toEqual([
      expect.objectContaining({ address: "carmen@mail.test", subject: "Price of Letrozole" }),
    ]);

    const letIn = await post("jane", `/api/email-held/${held.senders[0]?.id}/let-in`);
    const { leadId } = (await letIn.json()) as { leadId: number };
    const lead = await read<LeadCase>("jane", `/api/leads/${leadId}`);
    expect(lead.lead).toMatchObject({
      name: "Carmen Diaz",
      email: "carmen@mail.test",
      source: "email",
      chatChannel: "email",
      assignedName: "Jane",
    });
    const thread = await read<ChatThread>("jane", `/api/leads/${leadId}/thread`);
    expect(thread.lines[0]).toMatchObject({
      subject: "Price of Letrozole",
      text: "Hi, how much is Letrozole?",
    });
    expect((await read<{ senders: unknown[] }>("jane", "/api/email-held")).senders).toHaveLength(0);

    // Their next email lands straight on the case.
    inbox.push(
      email(
        '"Carmen Diaz" <carmen@mail.test>',
        "Re: Price of Letrozole",
        "And do you deliver to Makati?",
      ),
    );
    await post("naresh", `/api/channels/${mailbox}/pull`);
    expect((await read<ChatThread>("jane", `/api/leads/${leadId}/thread`)).lines).toHaveLength(2);
  });

  it("answers by email in the same thread", async () => {
    const [lead] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from lead where chat_key = 'carmen@mail.test'`,
    );
    expect(
      (await post("jane", `/api/leads/${lead?.id}/reply`, { text: "Yes, we deliver to Makati." }))
        .status,
    ).toBe(200);
    const mail = outbox.at(-1);
    expect(mail).toMatchObject({
      to: "carmen@mail.test",
      subject: "Re: Price of Letrozole",
      text: "Yes, we deliver to Makati.",
    });
    expect(mail?.inReplyTo).toMatch(/@mail\.test>$/);
    expect(mail?.messageId).toMatch(/@2mg\.test>$/);
    // Someone new answering that email of ours is part of the conversation: no holding.
    inbox.push(
      email(
        "<carmen.work@office.test>",
        "Re: Price of Letrozole",
        "This is her daughter, please send 30.",
        [`In-Reply-To: ${mail?.messageId}`],
      ),
    );
    await post("naresh", `/api/channels/${mailbox}/pull`);
    expect(
      await rows(db, sql`select id from lead where chat_key = 'carmen.work@office.test'`),
    ).toHaveLength(1);
  });

  it("keeps a sender set aside out", async () => {
    inbox.push(email("<seller@spam.test>", "SEO services", "We can rank your site"));
    await post("naresh", `/api/channels/${mailbox}/pull`);
    const held = await read<{ senders: { id: number; address: string }[] }>(
      "jane",
      "/api/email-held",
    );
    const spam = held.senders.find((sender) => sender.address === "seller@spam.test");
    expect((await post("jane", `/api/email-held/${spam?.id}/ignore`)).status).toBe(200);
    inbox.push(email("<seller@spam.test>", "Follow up", "Did you see our offer?"));
    await post("naresh", `/api/channels/${mailbox}/pull`);
    expect((await read<{ senders: unknown[] }>("jane", "/api/email-held")).senders).toHaveLength(0);
    expect(
      await rows(db, sql`select id from lead where chat_key = 'seller@spam.test'`),
    ).toHaveLength(0);
  });
});
