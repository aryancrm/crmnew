// The company's teams: the tree, adding people with their login, seats, cover, leaving.

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/index";
import { type Env, idParam, readBody } from "../http";
import { ROLES } from "../people/roles";
import { approvers, setApproves } from "./approvers";
import {
  addArea,
  addChannel,
  addPerson,
  addSeat,
  addUnit,
  askForSeat,
  closeSeat,
  closeUnit,
  coverSeat,
  decideSeatRequest,
  endHolding,
  fillSeat,
  menuUnits,
  orgTree,
  personHistory,
  personLeaves,
  resetPassword,
  seatRequestForm,
  updateArea,
  updateChannel,
  updateSeat,
  updateUnit,
} from "./service";

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
const id = (message: string) => z.number({ error: message }).int(message).positive(message);
const dayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day.");
const seatModule = z.enum(ROLES, { error: "Pick the work this seat does." });
const newArea = z
  .object({ name: text(80), cities: z.array(text(60)).max(40) })
  .nullable()
  .optional();

const seatFields = {
  unitId: id("Pick the team."),
  title: text(80).min(1, "Name the job (its title)."),
  module: seatModule,
  lead: z.boolean().optional(),
  reportsToSeatId: id("Pick the seat it reports to.").nullable().optional(),
  areaId: id("Pick the area.").nullable().optional(),
  newArea,
};

const personBody = z.object({
  name: text(80).min(1, "Type their name."),
  email: text(120).nullable().optional(),
  phone: text(40).nullable().optional(),
  password: text(200).nullable().optional(),
  seatId: id("Pick the seat.").nullable().optional(),
  unitId: id("Pick the team.").nullable().optional(),
  title: text(80).nullable().optional(),
  module: seatModule.nullable().optional(),
  lead: z.boolean().optional(),
  reportsToSeatId: id("Pick the seat they report to.").nullable().optional(),
  areaId: id("Pick the area.").nullable().optional(),
  newArea,
  startsOn: dayText.nullable().optional(),
  employeeCode: text(40).nullable().optional(),
});

export function orgRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/org", signedIn);
  app.use("/api/org/*", signedIn);
  app.get("/api/org", async (c) => c.json(await orgTree(db, c.get("me"))));
  // Who approves what: each Management person's divisions (none picked: every division).
  app.get("/api/org/approvers", async (c) => c.json(await approvers(db, c.get("me"))));
  app.post("/api/org/approvers/:id", async (c) => {
    const input = await readBody(
      c,
      z.object({ approves: z.array(z.string().max(40)).max(30).nullable() }),
    );
    await setApproves(db, c.get("me"), idParam(c), input.approves);
    return c.json({ ok: true });
  });
  app.get("/api/org/menu", async (c) => c.json(await menuUnits(db, c.get("me"))));
  app.post("/api/org/channels", async (c) => {
    const input = await readBody(
      c,
      z.object({ code: text(12), name: text(60), division: text(40).nullable().optional() }),
    );
    return c.json(await addChannel(db, c.get("me"), input), 201);
  });
  app.patch("/api/org/channels/:id", async (c) => {
    const input = await readBody(
      c,
      z.object({
        name: text(60).optional(),
        division: text(40).nullable().optional(),
        active: z.boolean().optional(),
      }),
    );
    await updateChannel(db, c.get("me"), idParam(c), input);
    return c.json({ ok: true });
  });

  app.post("/api/org/people", async (c) =>
    c.json(await addPerson(db, c.get("me"), await readBody(c, personBody)), 201),
  );
  app.get("/api/org/people/:id", async (c) =>
    c.json(await personHistory(db, c.get("me"), idParam(c))),
  );
  app.post("/api/org/people/:id/leave", async (c) => {
    const body = await readBody(
      c,
      z.object({ reason: text(200).nullable().optional(), lastDay: dayText.nullable().optional() }),
    );
    return c.json(await personLeaves(db, c.get("me"), idParam(c), body));
  });
  app.post("/api/org/people/:id/password", async (c) =>
    c.json(await resetPassword(db, c.get("me"), idParam(c))),
  );

  app.post("/api/org/seats", async (c) =>
    c.json(await addSeat(db, c.get("me"), await readBody(c, z.object(seatFields))), 201),
  );
  app.patch("/api/org/seats/:id", async (c) => {
    await updateSeat(
      db,
      c.get("me"),
      idParam(c),
      await readBody(c, z.object(seatFields).partial()),
    );
    return c.json({ ok: true });
  });
  app.post("/api/org/seats/:id/close", async (c) => {
    await closeSeat(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });
  app.post("/api/org/seats/:id/fill", async (c) => {
    const body = await readBody(
      c,
      z.object({
        personId: id("Pick the person."),
        keepOther: z.boolean().optional(),
        reason: text(200).nullable().optional(),
        startsOn: dayText.nullable().optional(),
      }),
    );
    await fillSeat(db, c.get("me"), idParam(c), body);
    return c.json({ ok: true });
  });
  app.post("/api/org/seats/:id/cover", async (c) => {
    const body = await readBody(
      c,
      z.object({
        personId: id("Pick who covers."),
        until: dayText,
        reason: text(200).nullable().optional(),
      }),
    );
    await coverSeat(db, c.get("me"), idParam(c), body);
    return c.json({ ok: true });
  });
  app.post("/api/org/holdings/:id/end", async (c) => {
    const body = await readBody(c, z.object({ reason: text(200).nullable().optional() }));
    await endHolding(db, c.get("me"), idParam(c), body.reason);
    return c.json({ ok: true });
  });

  app.post("/api/org/units", async (c) => {
    const body = await readBody(
      c,
      z.object({
        name: text(80).min(1, "Name the team."),
        kind: z.enum(["business", "line", "team", "department"], {
          error: "Pick what kind of box it is.",
        }),
        parentId: id("Pick where it sits."),
        channelId: id("Pick the channel.").nullable().optional(),
      }),
    );
    return c.json(await addUnit(db, c.get("me"), body), 201);
  });
  app.patch("/api/org/units/:id", async (c) => {
    const body = await readBody(
      c,
      z.object({
        name: text(80).optional(),
        channelId: id("Pick the channel.").nullable().optional(),
        parentId: id("Pick where it sits.").optional(),
      }),
    );
    await updateUnit(db, c.get("me"), idParam(c), body);
    return c.json({ ok: true });
  });
  app.post("/api/org/units/:id/close", async (c) => {
    await closeUnit(db, c.get("me"), idParam(c));
    return c.json({ ok: true });
  });

  const cities = z.array(text(60)).max(60);
  app.post("/api/org/areas", async (c) => {
    const body = await readBody(
      c,
      z.object({
        channelId: id("Pick the channel."),
        name: text(80).min(1, "Name the area."),
        cities,
      }),
    );
    return c.json(await addArea(db, c.get("me"), body), 201);
  });
  app.patch("/api/org/areas/:id", async (c) => {
    const body = await readBody(
      c,
      z.object({ name: text(80).optional(), cities: cities.optional() }),
    );
    await updateArea(db, c.get("me"), idParam(c), body);
    return c.json({ ok: true });
  });

  app.get("/api/org/requests/form", async (c) => c.json(await seatRequestForm(db, c.get("me"))));
  app.post("/api/org/requests", async (c) => {
    const body = await readBody(
      c,
      z.object({
        kind: z.enum(["seat", "region", "area"]).optional(),
        unitId: id("Pick the team."),
        module: z.enum(["medrep", "team_lead"], { error: "Pick the work." }).optional(),
        name: text(80).nullable().optional(),
        leadPersonId: id("Pick who leads it.").nullable().optional(),
        forSeatId: id("Pick the seat.").nullable().optional(),
        title: text(80).nullable().optional(),
        areaId: id("Pick the area.").nullable().optional(),
        newArea: z
          .object({ name: text(80), cities })
          .nullable()
          .optional(),
        personName: text(80).nullable().optional(),
        personPhone: text(40).nullable().optional(),
        reason: text(400).nullable().optional(),
      }),
    );
    return c.json(await askForSeat(db, c.get("me"), body), 201);
  });
  app.post("/api/org/requests/:id/decide", async (c) => {
    const body = await readBody(
      c,
      z.object({
        approve: z.boolean(),
        answer: text(400).nullable().optional(),
        password: text(200).nullable().optional(),
      }),
    );
    return c.json(await decideSeatRequest(db, c.get("me"), idParam(c), body));
  });
}
