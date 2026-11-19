// A team lead or a head opens what one of their people sees (Aryan, 19 Nov: "press a person and
// what they do opens"): read only, only for the people under them, and back to themselves after.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { Me } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["daniel", "ryan", "vanessa", "sarla"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
    ids[name] = ((await response.json()) as { me: Me }).me.id;
  }
});

describe("a lead looks as one of their people", () => {
  it("opens a MedRep under them, read only, and goes back", async () => {
    const opened = await call("daniel", `/api/auth/view/${ids.ryan}`, "POST");
    expect(opened.status, await opened.clone().text()).toBe(200);
    const set = opened.headers.getSetCookie();
    const looking = set.find((one) => one.startsWith("sid="))?.split(";")[0] as string;
    const back = set.find((one) => !one.startsWith("sid="))?.split(";")[0] as string;
    const me = ((await opened.json()) as { me: Me }).me;
    expect(me.name.startsWith("Ryan")).toBe(true);
    expect(me.viewedBy?.name.startsWith("Daniel")).toBe(true);
    // Nothing can be changed while looking.
    const write = await app.request("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: looking },
      body: JSON.stringify({}),
    });
    expect(write.status).toBe(403);
    // Back to Daniel.
    const home = await app.request("/api/auth/view/back", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${looking}; ${back}` },
    });
    expect(home.status, await home.clone().text()).toBe(200);
    expect(((await home.json()) as { me: Me }).me.name.startsWith("Daniel")).toBe(true);
  });

  it("never opens someone above them or outside their team, and a MedRep looks as nobody", async () => {
    expect((await call("daniel", `/api/auth/view/${ids.vanessa}`, "POST")).status).toBe(403);
    expect((await call("daniel", `/api/auth/view/${ids.sarla}`, "POST")).status).toBe(403);
    expect((await call("ryan", `/api/auth/view/${ids.daniel}`, "POST")).status).toBe(403);
    // A head looks as anyone under them, a team lead's people too.
    expect((await call("vanessa", `/api/auth/view/${ids.ryan}`, "POST")).status).toBe(200);
  });
});
