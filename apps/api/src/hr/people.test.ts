// HR's people: HR adds a joiner into a vacant seat with the login email and password HR made for
// them (nothing is sent), keeps records, changes logins, and marks people as left with the record
// kept. Pay is HR's, the CEO's, the Admin's and the person's own.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { HrPeople, HrPerson, JoinerForm, Me } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const signIn = (email: string, password: string) =>
  app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const send = (who: string, path: string, body: unknown = {}, method = "POST") =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["helen", "naresh", "admin", "daniel", "ryan"]) {
    const response = await signIn(`${name}@2mg.test`, PASSWORD);
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
});

const joiner = (seatId: number, more: Record<string, unknown> = {}) => ({
  name: "Mia  Santos",
  mobile: "0917 555 0101",
  company: "2mg",
  employeeCode: "e-1001",
  seatId,
  startsOn: todayManila(),
  classification: "probationary",
  salary: 2_500_000,
  allowance: 300_000,
  loginEmail: "Mia.Santos@2mginc.com",
  password: "given-by-hr-1",
  ...more,
});

describe("HR's people", () => {
  it("lists everyone with a record; only HR, the CEO and the Admin see the list", async () => {
    const list = await read<HrPeople>("helen", "/api/hr/people");
    expect(list.rows.map((one) => one.name)).toContain("Ryan");
    expect(list.rows.find((one) => one.name === "Ryan")).toMatchObject({
      stage: "active",
      roleLabel: "MedRep",
      team: "NCR 1",
    });
    expect(list.rows.some((one) => one.name === "Admin")).toBe(false);
    expect((await get("naresh", "/api/hr/people")).status).toBe(200);
    expect((await get("daniel", "/api/hr/people")).status).toBe(403);
    expect((await get("ryan", "/api/hr/people")).status).toBe(403);
  });

  it("shows pay to HR and the person, never to others", async () => {
    expect(
      (
        await send(
          "helen",
          `/api/hr/people/${ids.ryan}`,
          { salary: 3_000_000, sss: "34-1234567-8" },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    const own = await read<HrPerson>("ryan", `/api/hr/people/${ids.ryan}`);
    expect(own.record).toMatchObject({ salary: 3_000_000, sss: "34-1234567-8" });
    expect(own.can).toEqual({ edit: false, login: false, leave: false, back: false });
    expect((await get("ryan", `/api/hr/people/${ids.daniel}`)).status).toBe(403);
    expect((await send("ryan", `/api/hr/people/${ids.ryan}`, { salary: 9 }, "PATCH")).status).toBe(
      403,
    );
    expect(
      (await send("helen", `/api/hr/people/${ids.ryan}`, { mobile: "call me" }, "PATCH")).status,
    ).toBe(400);
  });

  it("adds a joiner with the login HR typed: they sign in with it, no invite is sent", async () => {
    const form = await read<JoinerForm>("helen", "/api/hr/joiners/form");
    const seat = form.seats.find((one) => one.team === "Mindanao");
    expect(seat).toBeTruthy();
    expect(form.seats.some((one) => one.title === "CEO" || one.title === "System admin")).toBe(
      false,
    );
    const seatId = seat?.id as number;

    const noPassword = await send("helen", "/api/hr/joiners", joiner(seatId, { password: "" }));
    expect(noPassword.status).toBe(400);
    expect(((await noPassword.json()) as { error: { field: string } }).error.field).toBe(
      "password",
    );
    const taken = await send(
      "helen",
      "/api/hr/joiners",
      joiner(seatId, { loginEmail: "ryan@2mg.test" }),
    );
    expect(taken.status).toBe(409);
    const [ryanSeat] = await rows<{ login: string }>(
      db,
      sql`select s.login from seat s join seat_holder h on h.seat_id = s.id where h.person_id = ${ids.ryan}`,
    );
    const seatLogin = await send(
      "helen",
      "/api/hr/joiners",
      joiner(seatId, { loginEmail: `${ryanSeat?.login}@2mginc.com` }),
    );
    expect(seatLogin.status).toBe(409);
    expect((await send("daniel", "/api/hr/joiners", joiner(seatId))).status).toBe(403);

    const made = await send("helen", "/api/hr/joiners", joiner(seatId));
    expect(made.status).toBe(200);
    const added = (await made.json()) as { personId: number; loginEmail: string };
    expect(added.loginEmail).toBe("mia.santos@2mginc.com");
    const [none] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from information_schema.tables where table_name = 'person_invite'`,
    );
    expect(none?.n).toBe(0);

    const before = await read<HrPerson>("helen", `/api/hr/people/${added.personId}`);
    expect(before).toMatchObject({
      name: "Mia Santos",
      stage: "active",
      login: "new",
      loginId: "mia.santos@2mginc.com",
      // The target sheet's channel of the seat (22 Nov).
      seat: { team: "Mindanao", channel: "HOSP" },
    });
    expect(before.record).toMatchObject({ employeeCode: "E-1001", salary: 2_500_000 });
    expect(before.missing).toContain("address");

    const first = await signIn("mia.santos@2mginc.com", "given-by-hr-1");
    expect(first.status).toBe(200);
    expect(((await first.json()) as { me: Me & { mustChangePassword?: boolean } }).me.role).toBe(
      "team_lead",
    );
    expect((await read<HrPerson>("helen", `/api/hr/people/${added.personId}`)).login).toBe("ready");

    // The seat is no longer offered, and the same employee ID can't be given twice.
    const after = await read<JoinerForm>("helen", "/api/hr/joiners/form");
    expect(after.seats.some((one) => one.id === seatId)).toBe(false);
    const again = await send(
      "helen",
      `/api/hr/people/${ids.ryan}`,
      { employeeCode: "e-1001" },
      "PATCH",
    );
    expect(again.status).toBe(409);
  });

  it("keeps a seat for a joiner who starts later: nobody else is put in it", async () => {
    const [seat] = await rows<{ id: number }>(
      db,
      sql`insert into seat (unit_id, title, module, sort)
        values ((select id from org_unit where name = 'NCR 1'), 'MedRep', 'medrep', 9) returning id::int as id`,
    );
    const later = await send(
      "helen",
      "/api/hr/joiners",
      joiner(seat?.id as number, {
        name: "Carlo Reyes",
        employeeCode: null,
        loginEmail: "carlo.reyes@2mginc.com",
        startsOn: addDays(todayManila(), 10),
      }),
    );
    expect(later.status).toBe(200);
    const { personId } = (await later.json()) as { personId: number };
    expect((await read<HrPerson>("helen", `/api/hr/people/${personId}`)).stage).toBe("joining");
    const list = await read<HrPeople>("helen", "/api/hr/people?stage=joining");
    expect(list.rows.map((one) => one.name)).toEqual(["Carlo Reyes"]);
    const form = await read<JoinerForm>("helen", "/api/hr/joiners/form");
    expect(form.seats.some((one) => one.id === seat?.id)).toBe(false);
    const twice = await send(
      "helen",
      "/api/hr/joiners",
      joiner(seat?.id as number, { loginEmail: "x@2mginc.com" }),
    );
    expect(twice.status).toBe(409);
  });

  it("changes a password HR typed: the old one and their sessions stop", async () => {
    const response = await signIn("ryan@2mg.test", PASSWORD);
    const cookie = response.headers.get("set-cookie")?.split(";")[0] as string;
    expect(
      (await send("helen", `/api/hr/people/${ids.ryan}/login`, { password: "short" })).status,
    ).toBe(400);
    expect(
      (await send("helen", `/api/hr/people/${ids.ryan}/login`, { password: "new-from-hr-22" }))
        .status,
    ).toBe(200);
    expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(401);
    expect((await signIn("ryan@2mg.test", PASSWORD)).status).toBe(401);
    expect((await signIn("ryan@2mg.test", "new-from-hr-22")).status).toBe(200);
    expect(
      (await send("helen", `/api/hr/people/${ids.ryan}/login`, { email: "ryan.cruz@2mginc.com" }))
        .status,
    ).toBe(200);
    expect((await signIn("ryan.cruz@2mginc.com", "new-from-hr-22")).status).toBe(200);
    expect(
      (await send("helen", `/api/hr/people/${ids.naresh}/login`, { password: "new-from-hr-22" }))
        .status,
    ).toBe(403);
  });

  it("marks someone as left: the login stops, the seat falls vacant, the record stays", async () => {
    const list = await read<HrPeople>("helen", "/api/hr/people");
    const mia = list.rows.find((one) => one.name === "Mia Santos");
    expect(
      (await send("helen", `/api/hr/people/${mia?.personId}/left`, { reason: "" })).status,
    ).toBe(400);
    const left = await send("helen", `/api/hr/people/${mia?.personId}/left`, {
      reason: "Resigned",
    });
    expect(left.status).toBe(200);
    expect((await signIn("mia.santos@2mginc.com", "given-by-hr-1")).status).toBe(401);
    const record = await read<HrPerson>("helen", `/api/hr/people/${mia?.personId}`);
    expect(record).toMatchObject({ stage: "left", login: "off" });
    expect(record.record).toMatchObject({
      leftReason: "Resigned",
      leftOn: todayManila(),
      salary: 2_500_000,
    });
    expect(
      (await read<HrPeople>("helen", "/api/hr/people")).rows.some(
        (one) => one.name === "Mia Santos",
      ),
    ).toBe(false);
    expect(
      (await read<HrPeople>("helen", "/api/hr/people?stage=left")).rows.map((one) => one.name),
    ).toContain("Mia Santos");
    const form = await read<JoinerForm>("helen", "/api/hr/joiners/form");
    expect(form.seats.some((one) => one.team === "Mindanao")).toBe(true);
    // Marked as left by mistake: back at work, the login works again (a seat comes from Teams & people).
    expect(record.can.back).toBe(true);
    expect((await send("helen", `/api/hr/people/${mia?.personId}/back`, {})).status).toBe(200);
    expect((await send("helen", `/api/hr/people/${mia?.personId}/back`, {})).status).toBe(409);
    expect((await signIn("mia.santos@2mginc.com", "given-by-hr-1")).status).toBe(200);
    const again = await read<HrPerson>("helen", `/api/hr/people/${mia?.personId}`);
    expect(again.record).toMatchObject({ leftReason: null, leftOn: null });
  });
});
