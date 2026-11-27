// A team lead's (or head's) team, from the seats under them; the CEO and the Admin any box.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { teamAccounts } from "./accounts";
import { teamBoard, territories } from "./service";
import { orderWays } from "./ways";
import { doctorHistory, headquarters, hqDoctors } from "./headquarters";
import { addHq, closeHq, hqPeople, renameHq, setHqPerson } from "./hq-change";

const hqName = z.string({ error: "Name the HQ." }).trim().min(1, "Name the HQ.").max(40, "Keep the HQ's name under 40 characters.");
const personId = z.number({ error: "Pick the person." }).int("Pick the person.").positive("Pick the person.");

export function teamRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/team/board", signedIn);
  app.use("/api/team/accounts", signedIn);
  // The team's customers (a box picked: its own), with their buying, gaps, money owed and calls.
  app.get("/api/team/accounts", async (c) => c.json(await teamAccounts(db, c.get("me"))));
  app.use("/api/team/territories", signedIn);
  // The map: each area of the seats in view, the shapes its cities cover (read, never typed).
  app.get("/api/team/territories", async (c) =>
    c.json(await territories(db, c.get("me"), { unitId: Number(c.req.query("unit")) || null })),
  );
  app.use("/api/headquarters", signedIn);
  // Each HQ of the team: who works it, who did before, what it sold this month and today (27 Nov).
  app.get("/api/headquarters", async (c) => c.json(await headquarters(db, c.get("me"), { month: c.req.query("month") })));
  app.use("/api/headquarters/*", signedIn);
  // One doctor's whole history in the team, by their name's key (28 Nov).
  app.get("/api/headquarters/doctor", async (c) => c.json(await doctorHistory(db, c.get("me"), c.req.query("key") ?? "")));
  // One HQ's doctors: who sent patients (referral), who bought (dispense) (28 Nov).
  app.get("/api/headquarters/:seatId/doctors", async (c) =>
    c.json(await hqDoctors(db, c.get("me"), Number(c.req.param("seatId")) || 0, { month: c.req.query("month") })),
  );
  // The head makes, renames and closes HQs and decides who works each (28 Nov, PLAN 264).
  app.get("/api/headquarters/people", async (c) => c.json(await hqPeople(db, c.get("me"))));
  app.post("/api/headquarters", async (c) => {
    const body = await readBody(
      c,
      z.object({ unitId: z.number({ error: "Pick the channel." }).int().positive(), name: hqName, personId: personId.nullable().optional() }),
    );
    return c.json(await addHq(db, c.get("me"), body), 201);
  });
  app.patch("/api/headquarters/:id", async (c) => {
    await renameHq(db, c.get("me"), idParam(c), await readBody(c, z.object({ name: hqName })));
    return c.json({ ok: true });
  });
  app.post("/api/headquarters/:id/person", async (c) => {
    await setHqPerson(db, c.get("me"), idParam(c), await readBody(c, z.object({ personId: personId.nullable() })));
    return c.json({ ok: true });
  });
  app.post("/api/headquarters/:id/close", async (c) => {
    await closeHq(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.use("/api/team/ways", signedIn);
  // How the month's orders came: the doctor dispensing, the doctor's referral, and the rest (27 Nov).
  app.get("/api/team/ways", async (c) => c.json(await orderWays(db, c.get("me"), { month: c.req.query("month") })));
  app.get("/api/team/board", async (c) =>
    c.json(
      await teamBoard(db, c.get("me"), {
        unitId: Number(c.req.query("unit")) || null,
        from: c.req.query("from"),
        to: c.req.query("to"),
      }),
    ),
  );
}
