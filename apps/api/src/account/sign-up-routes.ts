// Sign-ups' addresses. The three under /api/auth/ answer anyone (asking, and the email's link): each
// says what keeps it safe in account/sign-up.ts, and /api/auth/* takes 16 KB at most.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { ROLES } from "../people/roles";
import {
  acceptSignUp,
  askToJoin,
  declineSignUp,
  resendAccepted,
  setFirstPassword,
  signUpList,
  waitingCount,
  welcomeInfo,
} from "./sign-up";

const id = (message: string) => z.number({ error: message }).int(message).positive(message);
const token = z.string().min(20).max(100);

const jobBody = z.object({
  confirmed: z.literal(true, { error: "Confirm who they are first." }),
  seatId: id("Pick the seat.").nullish(),
  unitId: id("Pick the team.").nullish(),
  title: z.string().trim().max(80).nullish(),
  module: z.enum(ROLES, { error: "Pick the work they do." }).nullish(),
  lead: z.boolean().optional(),
  reportsToSeatId: id("Pick the seat they report to.").nullish(),
  areaId: id("Pick the area.").nullish(),
  newArea: z
    .object({ name: z.string().trim().max(80), cities: z.array(z.string().trim().max(60)).max(40) })
    .nullish(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day.").nullish(),
  employeeCode: z.string().trim().max(40).nullish(),
});

export function signUpRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>, webUrl: string) {
  app.post("/api/auth/sign-up", async (c) => {
    const input = await readBody(
      c,
      z.object({
        firstName: z.string().max(200),
        middleName: z.string().max(200).nullish(),
        lastName: z.string().max(200),
        suffix: z.string().max(10).nullish(),
        email: z.string().max(200),
        phone: z.string().max(30),
        department: z.string().max(20),
      }),
    );
    await askToJoin(db, input);
    return c.json({ ok: true });
  });

  app.post("/api/auth/welcome", async (c) => {
    const input = await readBody(c, z.object({ token }));
    const info = await welcomeInfo(db, input.token);
    c.header("cache-control", "no-store");
    return c.json(info);
  });

  app.post("/api/auth/welcome/password", async (c) => {
    const input = await readBody(c, z.object({ token, password: z.string().max(200) }));
    await setFirstPassword(db, input.token, input.password);
    return c.json({ ok: true });
  });

  app.get("/api/sign-ups", signedIn, async (c) => {
    const list = await signUpList(db, c.get("me"));
    c.header("cache-control", "no-store");
    return c.json(list);
  });
  app.get("/api/sign-ups/count", signedIn, async (c) => c.json({ waiting: await waitingCount(db, c.get("me")) }));

  app.post("/api/sign-ups/:id/accept", signedIn, async (c) => {
    const { confirmed: _, ...job } = await readBody(c, jobBody);
    const sent = await acceptSignUp(db, c.get("me"), idParam(c), job, webUrl);
    c.header("cache-control", "no-store");
    return c.json(sent);
  });

  app.post("/api/sign-ups/:id/resend", signedIn, async (c) => {
    const sent = await resendAccepted(db, c.get("me"), idParam(c), webUrl);
    c.header("cache-control", "no-store");
    return c.json(sent);
  });

  app.post("/api/sign-ups/:id/decline", signedIn, async (c) => {
    const input = await readBody(c, z.object({ reason: z.string().max(300).nullish() }));
    await declineSignUp(db, c.get("me"), idParam(c), input.reason ?? null);
    return c.json({ ok: true });
  });
}
