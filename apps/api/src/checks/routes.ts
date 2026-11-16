// The data checks' address: the Admin and the CEO run them.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import type { Env } from "../http";
import { z } from "zod";
import { allow, readBody } from "../http";
import { importOldFiles, importOldLeads, type OldFile, type OldLead, type OldMessage } from "../online/legacy-import";
import { dataChecks } from "./integrity";

export function checkRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.get("/api/admin/data-checks", signedIn, async (c) =>
    c.json(await dataChecks(db, c.get("me"))),
  );
  // The old CRM's enquiries, sent in batches by the Admin (dry run unless apply).
  app.post("/api/admin/import/old-leads", signedIn, async (c) => {
    allow(c.get("me"), ["admin"], "bring over the old CRM's enquiries");
    const body = await readBody(
      c,
      z.object({
        leads: z.array(z.record(z.string(), z.unknown())).max(500),
        messages: z.array(z.record(z.string(), z.unknown())).max(20_000),
        apply: z.boolean().optional(),
      }),
    );
    return c.json(
      await importOldLeads(
        db,
        body.leads as unknown as OldLead[],
        body.messages as unknown as OldMessage[],
        Boolean(body.apply),
      ),
    );
  });
  // The old CRM's photos: links to the old storage, fetched and kept here (dry run unless apply).
  app.post("/api/admin/import/old-files", signedIn, async (c) => {
    allow(c.get("me"), ["admin"], "bring over the old CRM's photos");
    const body = await readBody(
      c,
      z.object({
        files: z.array(z.record(z.string(), z.unknown())).max(100),
        apply: z.boolean().optional(),
      }),
    );
    return c.json(await importOldFiles(db, body.files as unknown as OldFile[], Boolean(body.apply)));
  });
}
