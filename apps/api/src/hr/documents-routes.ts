// HR's documents, imports and reports: their addresses (docs/HR-PLAN.md, "Documents, imports and
// reports", 26 Nov). Signed in by hrRoutes; each service checks who may.

import type { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import {
  acknowledgeDocument,
  DESKS,
  DOC_KINDS,
  documentList,
  documentPage,
  issueDocument,
  myDocuments,
  signClearance,
  voidDocument,
} from "./documents";

const words = (max: number) => z.string().max(max).nullish();

export function documentRoutes(app: Hono<Env>, db: Database): void {
  app.get("/api/hr/documents", async (c) =>
    c.json(
      await documentList(db, c.get("me"), {
        person: Number(c.req.query("person")) || null,
        kind: c.req.query("kind"),
        q: c.req.query("q"),
      }),
    ),
  );
  app.get("/api/hr/documents/mine", async (c) => c.json(await myDocuments(db, c.get("me"))));
  app.get("/api/hr/documents/:id", async (c) => c.json(await documentPage(db, c.get("me"), idParam(c))));
  app.post("/api/hr/documents", async (c) => {
    const input = await readBody(
      c,
      z.object({
        kind: z.enum(DOC_KINDS as [string, ...string[]], { message: "Pick the kind of document." }),
        personId: z.number({ error: "Pick the person." }).int().positive("Pick the person."),
        subject: words(200),
        body: words(8000),
        replyBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.").nullish(),
      }),
    );
    return c.json(await issueDocument(db, c.get("me"), input as Parameters<typeof issueDocument>[2]));
  });
  app.post("/api/hr/documents/:id/void", async (c) => {
    const input = await readBody(c, z.object({ reason: words(300) }));
    await voidDocument(db, c.get("me"), idParam(c), input.reason);
    return c.json({ ok: true });
  });
  app.post("/api/hr/documents/:id/acknowledge", async (c) => {
    const input = await readBody(c, z.object({ reply: words(8000) }));
    await acknowledgeDocument(db, c.get("me"), idParam(c), input.reply);
    return c.json({ ok: true });
  });
  app.post("/api/hr/documents/:id/sign", async (c) => {
    const input = await readBody(
      c,
      z.object({ desk: z.enum(DESKS as [string, ...string[]], { message: "Pick the desk." }), note: words(500) }),
    );
    await signClearance(db, c.get("me"), idParam(c), input as Parameters<typeof signClearance>[3]);
    return c.json({ ok: true });
  });
}
