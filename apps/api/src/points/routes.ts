// Points' and the company settings' addresses. The services check who may do what.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { saveCompany, savePointsProgram, settingsOf } from "../settings/service";
import type { CompanyInfo } from "../types";
import { addPointsByPhone, adjustPoints, openAccountFor, pointsAccount, pointsList } from "./service";

const line = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);

export function pointsRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  for (const path of ["/api/points", "/api/points/*", "/api/settings", "/api/settings/*"])
    app.use(path, signedIn);

  app.get("/api/points", async (c) =>
    c.json(await pointsList(db, c.get("me"), { q: c.req.query("q") })),
  );
  // Add points to a customer by their mobile number, their account opened if new (19 Nov).
  app.post("/api/points/add", async (c) => {
    const input = await readBody(
      c,
      z.object({
        phone: line(40).min(1, "Type their mobile number."),
        name: line(120).nullish(),
        points: z.number({ error: "Type how many points." }).int("Use whole points.").positive("Type how many points to add."),
        reason: line(300).nullish(),
      }),
    );
    return c.json(await addPointsByPhone(db, c.get("me"), input));
  });
  app.get("/api/points/:id", async (c) => c.json(await pointsAccount(db, c.get("me"), idParam(c))));
  app.post("/api/points/:id/adjust", async (c) => {
    const input = await readBody(
      c,
      z.object({
        points: z.number({ error: "Type how many points." }).int("Use whole points."),
        reason: line(300),
      }),
    );
    await adjustPoints(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });
  app.post("/api/points/open/:id", async (c) =>
    c.json(await openAccountFor(db, c.get("me"), idParam(c))),
  );

  app.get("/api/settings", async (c) => c.json(await settingsOf(db, c.get("me"))));
  app.post("/api/settings/company", async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: line(120).min(1, "Type the company's name."),
        address: line(300),
        phone: line(60),
        email: line(120),
        tin: line(30),
        vat: z.boolean(),
        licence: line(80),
        footer: line(200),
        signatory: line(120),
        signatoryTitle: line(120),
      }),
    );
    await saveCompany(db, c.get("me"), input as CompanyInfo);
    return c.json({ ok: true });
  });
  app.post("/api/settings/points", async (c) => {
    const input = await readBody(c, z.object({ enabled: z.boolean(), rateBps: z.number().int() }));
    await savePointsProgram(db, c.get("me"), input);
    return c.json({ ok: true });
  });
}
