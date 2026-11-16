// In-licensing & Regulatory: the pipeline and the FDA registrations.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, readBody } from "../http";
import { regHistory, regulatoryDesk, savePipeline, saveRegistration, STAGES, STATUSES } from "./service";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day.");
const TEXT = (max: number) => z.string().max(max).nullish();
const person = z.number().int().positive().nullish();
const pipeline = z.object({
  name: z.string().trim().min(2, "Type the product's name."),
  generic: TEXT(120), strength: TEXT(60), partner: TEXT(160), country: TEXT(60),
  stage: z.enum(STAGES as [string, ...string[]]).optional(),
  handledBy: person, nextStep: TEXT(300), nextOn: DAY.nullish(), note: TEXT(1000),
});
const registration = z.object({
  product: z.string().trim().min(2, "Type the product."),
  medicineId: z.number().int().positive().nullish(),
  number: TEXT(60),
  status: z.enum(STATUSES as [string, ...string[]]).optional(),
  filedOn: DAY.nullish(), validUntil: DAY.nullish(), handledBy: person, note: TEXT(1000),
});

export function regulatoryRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/regulatory/*", signedIn);
  app.get("/api/regulatory/desk", async (c) => c.json(await regulatoryDesk(db, c.get("me"))));
  app.get("/api/regulatory/pipeline/:id/history", async (c) => c.json(await regHistory(db, c.get("me"), { pipelineId: Number(c.req.param("id")) })));
  app.get("/api/regulatory/registrations/:id/history", async (c) =>
    c.json(await regHistory(db, c.get("me"), { registrationId: Number(c.req.param("id")) })),
  );
  app.post("/api/regulatory/pipeline", async (c) => c.json(await savePipeline(db, c.get("me"), null, (await readBody(c, pipeline)) as never)));
  app.post("/api/regulatory/pipeline/:id", async (c) =>
    c.json(await savePipeline(db, c.get("me"), Number(c.req.param("id")), (await readBody(c, pipeline)) as never)),
  );
  app.post("/api/regulatory/registrations", async (c) =>
    c.json(await saveRegistration(db, c.get("me"), null, (await readBody(c, registration)) as never)),
  );
  app.post("/api/regulatory/registrations/:id", async (c) =>
    c.json(await saveRegistration(db, c.get("me"), Number(c.req.param("id")), (await readBody(c, registration)) as never)),
  );
}
