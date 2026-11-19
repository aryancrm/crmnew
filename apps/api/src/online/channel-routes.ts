// The Inbox's and the channels' addresses, and Meta's webhook (public: Meta signs every call).

import { setCatalogUrl } from "./catalog";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { type Database, rows } from "../db/index";
import { allow, type Env, idParam, Refusal, readBody } from "../http";
import { answerPointsCall } from "../points/website-calls";
import {
  connectMailbox,
  heldSenders,
  ignoreSender,
  letSenderIn,
  mailSink,
  pullMailbox,
  sinkReceive,
} from "./email";
import { sinkNames } from "./graph";
import {
  channelsData,
  chatThread,
  disconnectChannel,
  fileChatPhoto,
  inboxCount,
  inboxList,
  markSeen,
  pullChannel,
  replyOnCase,
  retryChannel,
  setIntake,
} from "./inbox";
import {
  appSecrets,
  CHANNEL_ROLES,
  connectPage,
  drainInbox,
  keepWebhook,
  signatureMatches,
  verifyTokens,
} from "./messenger";
import { LEAD_WORK_ROLES } from "./rules";
import {
  answerProgress,
  answerWebsite,
  connectWebsite,
  newWebsiteSecret,
  openWebsiteCase,
  retryWebsitePush,
  websiteOrderCase,
} from "./websites";

const messengerSink = () =>
  process.env.MESSENGER_SINK === "1" && process.env.NODE_ENV !== "production";

export function channelRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  // ---- Meta's webhook
  app.get("/webhooks/messenger", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token") ?? "";
    if (mode === "subscribe" && verifyTokens().includes(token))
      return c.text(c.req.query("hub.challenge") ?? "");
    return c.text("Forbidden", 403);
  });
  app.post("/webhooks/messenger", async (c) => {
    const body = await c.req.text();
    if (appSecrets().length === 0)
      return c.json(
        { error: { code: "not_set_up", message: "MESSENGER_APP_SECRET isn't set." } },
        503,
      );
    if (!signatureMatches(body, c.req.header("x-hub-signature-256")))
      return c.json(
        { error: { code: "bad_signature", message: "The signature doesn't match." } },
        401,
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return c.json({ error: { code: "invalid", message: "The body isn't JSON." } }, 400);
    }
    // Kept first; a database failure answers 500 so Meta sends it again.
    await keepWebhook(db, parsed);
    void drainInbox(db).catch((error) =>
      console.warn("messenger: drain stopped:", error instanceof Error ? error.message : error),
    );
    return c.text("EVENT_RECEIVED");
  });

  // ---- the websites' calls (each signed with its own secret)
  app.post("/webhooks/store/:company", async (c) => {
    const answer = await answerWebsite(
      db,
      await c.req.text(),
      c.req.header("x-crm-signature") ?? c.req.header("x-make-signature"),
    );
    return c.json(answer.body, answer.status);
  });
  app.post("/webhooks/store/:company/points/manage", async (c) => {
    const answer = await answerPointsCall(db, await c.req.text(), c.req.header("x-crm-signature"));
    c.header("cache-control", "no-store");
    return c.json(answer.body as Record<string, unknown>, answer.status);
  });
  app.post("/webhooks/store/:company/order-progress", async (c) => {
    const answer = await answerProgress(db, await c.req.text(), c.req.header("x-crm-signature"));
    return c.json(answer.body, answer.status);
  });

  for (const path of [
    "/api/inbox",
    "/api/inbox/*",
    "/api/channels",
    "/api/channels/*",
    "/api/email-held",
    "/api/email-held/*",
    "/api/web-orders/*",
    // "Open in the CRM": only for someone signed in (each page then checks who may see it).
    "/api/website-order",
    "/api/dev/*",
  ])
    app.use(path, signedIn);

  // ---- website orders
  app.post("/api/web-orders/:id/open-case", async (c) =>
    c.json(await openWebsiteCase(db, c.get("me"), idParam(c))),
  );
  app.post("/api/web-orders/:id/push", async (c) => {
    await retryWebsitePush(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  // ---- the Inbox
  app.get("/api/inbox", async (c) => {
    const query = c.req.query();
    return c.json(
      await inboxList(db, c.get("me"), {
        filter: query.filter,
        q: query.q,
        account: query.account,
        shown: Number(query.shown) || 0,
      }),
    );
  });
  app.get("/api/inbox/count", async (c) => c.json(await inboxCount(db, c.get("me"))));
  app.get("/api/leads/:id/thread", async (c) =>
    c.json(await chatThread(db, c.get("me"), idParam(c))),
  );
  app.post("/api/leads/:id/reply", async (c) => {
    const input = await readBody(
      c,
      z.object({
        text: z
          .string({ error: "Write something to send." })
          .max(5000, "Keep it under 5,000 characters."),
      }),
    );
    await replyOnCase(db, c.get("me"), idParam(c), input.text);
    return c.json({ ok: true });
  });
  app.post("/api/leads/:id/seen", async (c) => {
    await markSeen(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/lead-files/:id/kind", async (c) => {
    const input = await readBody(c, z.object({ kind: z.string() }));
    await fileChatPhoto(db, c.get("me"), idParam(c), input.kind);
    return c.json({ ok: true });
  });

  // ---- new email senders
  app.get("/api/email-held", async (c) => c.json({ senders: await heldSenders(db, c.get("me")) }));
  app.post("/api/email-held/:id/let-in", async (c) =>
    c.json(await letSenderIn(db, c.get("me"), idParam(c))),
  );
  app.post("/api/email-held/:id/ignore", async (c) => {
    await ignoreSender(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  // ---- the channels
  app.get("/api/channels", async (c) => c.json(await channelsData(db, c.get("me"))));
  app.post("/api/channels/messenger", async (c) => {
    const input = await readBody(
      c,
      z.object({ token: z.string({ error: "Paste the page's access token." }).max(1000) }),
    );
    return c.json(await connectPage(db, c.get("me"), input.token));
  });
  const host = z
    .string()
    .trim()
    .min(3, "Type the server's name.")
    .max(120)
    .regex(/^[a-z0-9.-]+$/i, "Type only the server's name, like imap.gmail.com.");
  app.post("/api/channels/email", async (c) => {
    const input = await readBody(
      c,
      z.object({
        address: z
          .string()
          .trim()
          .max(120)
          .email("Type the mailbox's address, like info@example.com."),
        name: z.string().trim().max(80).nullish(),
        user: z.string().trim().max(120).nullish(),
        password: z
          .string({ error: "Paste the app password." })
          .min(1, "Paste the app password.")
          .max(200),
        imapHost: host,
        imapPort: z.number().int(),
        smtpHost: host,
        smtpPort: z.number().int(),
        intake: z.enum(["screen", "all"]).optional(),
        relayUrl: z.string().trim().max(300).nullish(),
      }),
    );
    return c.json(await connectMailbox(db, c.get("me"), input));
  });
  app.post("/api/channels/website", async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: z
          .string({ error: "Type the website's name." })
          .trim()
          .min(1, "Type the website's name.")
          .max(80),
        site: z
          .string({ error: "Type the website's address." })
          .trim()
          .min(1, "Type the website's address.")
          .max(200),
        // The secret the website has now (its CRM_WEBHOOK_SECRET), to keep it unchanged.
        secret: z
          .string()
          .trim()
          .max(200)
          .refine((value) => value === "" || (value.length >= 16 && !/\s/.test(value)), {
            message: "Paste the whole secret, as in the website's CRM_WEBHOOK_SECRET.",
          })
          .nullish(),
      }),
    );
    return c.json(await connectWebsite(db, c.get("me"), input));
  });
  // A website's stock link: its catalogue address (empty turns it off).
  app.post("/api/channels/:id/catalog", async (c) => {
    const input = await readBody(c, z.object({ url: z.string().trim().max(500) }));
    await setCatalogUrl(db, c.get("me"), idParam(c), input.url);
    return c.json({ ok: true });
  });
  // A website admin's "Open in the CRM" link: the case its order became (old CRM's link).
  app.get("/api/website-order", async (c) =>
    c.json(await websiteOrderCase(db, c.req.query("site") ?? "", c.req.query("ref") ?? "")),
  );
  app.post("/api/channels/:id/secret", async (c) =>
    c.json(await newWebsiteSecret(db, c.get("me"), idParam(c))),
  );
  app.post("/api/channels/:id/pull", async (c) =>
    c.json(await pullChannel(db, c.get("me"), idParam(c))),
  );
  app.post("/api/channels/:id/retry", async (c) => {
    await retryChannel(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/channels/:id/disconnect", async (c) => {
    await disconnectChannel(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/channels/:id/intake", async (c) => {
    const input = await readBody(c, z.object({ intake: z.enum(["screen", "all"]) }));
    await setIntake(db, c.get("me"), idParam(c), input.intake);
    return c.json({ ok: true });
  });

  // ---- a developer's computer: a stand-in website that takes the CRM's status updates (never online)
  app.post("/dev/website-status", async (c) => {
    if (!messengerSink() && !mailSink()) return c.json({ message: "No such address." }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      data?: { orderNumber?: string; status?: string; trackingNumber?: string };
    };
    console.log(
      `website (sink): ${body.data?.orderNumber} → ${body.data?.status}${body.data?.trackingNumber ? ` (${body.data.trackingNumber})` : ""}`,
    );
    return c.json({ ok: true, status: body.data?.status });
  });

  // ---- a developer's computer: a test message or email, as if it came in (never online)
  app.post("/api/dev/messenger", async (c) => {
    if (!messengerSink()) throw new Refusal(404, "not_found", "No such address.");
    allow(c.get("me"), [...LEAD_WORK_ROLES, ...CHANNEL_ROLES], "send a test message");
    const input = await readBody(
      c,
      z.object({
        page: z.string().min(1),
        psid: z.string().min(1),
        name: z.string().nullish(),
        text: z.string().max(2000),
        photo: z.boolean().optional(),
      }),
    );
    if (input.name) sinkNames.set(input.psid, input.name);
    const kept = await keepWebhook(db, {
      object: "page",
      entry: [
        {
          id: input.page,
          messaging: [
            {
              sender: { id: input.psid },
              recipient: { id: input.page },
              timestamp: Date.now(),
              message: {
                mid: `m_dev_${randomUUID()}`,
                text: input.text,
                ...(input.photo
                  ? {
                      attachments: [
                        { type: "image", payload: { url: "https://sink.local/photo.png" } },
                      ],
                    }
                  : {}),
              },
            },
          ],
        },
      ],
    });
    await drainInbox(db);
    return c.json({ kept });
  });
  app.post("/api/dev/email", async (c) => {
    if (!mailSink()) throw new Refusal(404, "not_found", "No such address.");
    allow(c.get("me"), [...LEAD_WORK_ROLES, ...CHANNEL_ROLES], "send a test email");
    const input = await readBody(
      c,
      z.object({
        from: z.string().email(),
        name: z.string().nullish(),
        subject: z.string().max(200),
        text: z.string().max(5000),
      }),
    );
    const [mailbox] = await rows<{ id: number; key: string }>(
      db,
      sql`select id::int as id, key from channel_account where kind = 'email' and active order by id limit 1`,
    );
    if (!mailbox) throw new Refusal(409, "not_now", "Connect a mailbox first.");
    const domain = input.from.split("@")[1] ?? "example.com";
    sinkReceive(
      Buffer.from(
        [
          `From: ${input.name ? `"${input.name.replace(/"/g, "")}" ` : ""}<${input.from}>`,
          `To: <${mailbox.key}>`,
          `Subject: ${input.subject}`,
          `Message-ID: <${randomUUID()}@${domain}>`,
          `Date: ${new Date().toUTCString()}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=utf-8",
          "",
          input.text,
        ].join("\r\n"),
      ),
    );
    return c.json({ landed: await pullMailbox(db, mailbox.id) });
  });
}
