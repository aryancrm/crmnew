// Messages between the people of the company.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { addressBook, myThreads, openThread, reply, sendMessage } from "./service";

const body = z
  .string()
  .trim()
  .min(1, "Write the message.")
  .max(4000, "Keep it under 4000 characters.");
const id = (message: string) => z.number({ error: message }).int(message).positive(message);

export function messageRoutes(
  app: Hono<Env>,
  db: Database,
  signedIn: MiddlewareHandler<Env>,
): void {
  app.use("/api/messages", signedIn);
  app.use("/api/messages/*", signedIn);
  app.get("/api/messages", async (c) => c.json(await myThreads(db, c.get("me"))));
  app.get("/api/messages/people", async (c) => c.json(await addressBook(db, c.get("me"))));
  app.get("/api/messages/:id", async (c) => c.json(await openThread(db, c.get("me"), idParam(c))));
  app.post("/api/messages", async (c) => {
    const input = await readBody(
      c,
      z.object({
        to: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("person"), personId: id("Pick who it goes to.") }),
          z.object({
            kind: z.literal("people"),
            personIds: z.array(id("Pick who it goes to.")).min(1, "Pick who it goes to.").max(200),
          }),
          z.object({ kind: z.literal("unit"), unitId: id("Pick the team.") }),
          z.object({ kind: z.literal("everyone") }),
        ]),
        announcement: z.boolean().optional(),
        title: z.string().trim().max(120, "Keep the title short.").nullable().optional(),
        body,
      }),
    );
    return c.json(await sendMessage(db, c.get("me"), input), 201);
  });
  app.post("/api/messages/:id", async (c) => {
    const input = await readBody(c, z.object({ body }));
    await reply(db, c.get("me"), idParam(c), input.body);
    return c.json({ ok: true });
  });
}
