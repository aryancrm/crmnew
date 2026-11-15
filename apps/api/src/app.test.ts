import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { type Database, openDatabase } from "./db/index";
import { migrate } from "./db/migrate";
import { seedDemo } from "./seed";
import type { Me } from "./types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
});

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

async function signIn(email: string, password = PASSWORD) {
  const response = await post("/api/auth/login", { email, password });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  return { response, cookie };
}

describe("the database", () => {
  it("is brought up to date once", async () => {
    expect(await migrate(db)).toEqual([]);
    expect(await seedDemo(db, PASSWORD)).toBe(false);
  });
});

describe("signing in", () => {
  it("refuses a wrong password without saying which part is wrong", async () => {
    const { response } = await signIn("ryan@2mg.test", "nope");
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("Wrong login ID or password.");
    const unknown = await signIn("nobody@2mg.test");
    expect(unknown.response.status).toBe(401);
  });

  it("names the missing field", async () => {
    const response = await post("/api/auth/login", { email: "", password: "x" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.field).toBe("email");
  });

  it("signs a MedRep in with their area and who they report to", async () => {
    const { response, cookie } = await signIn("Ryan@2MG.test");
    expect(response.status).toBe(200);
    expect(cookie).toMatch(/^sid=/);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const me = (
      await (await app.request("/api/me", { headers: { cookie: cookie as string } })).json()
    ).me as Me;
    expect(me).toMatchObject({
      name: "Ryan",
      role: "medrep",
      roleLabel: "MedRep",
      channel: { code: "HOSP" },
      area: { name: "HOS | Pasay", cities: ["Pasay", "Parañaque", "Las Piñas"] },
      reportsTo: { name: "Daniel" },
    });
  });

  it("answers who is asking in one query", async () => {
    const { cookie } = await signIn("sarla@2mg.test");
    const response = await app.request("/api/me", { headers: { cookie: cookie as string } });
    expect(response.headers.get("server-timing")).toContain('"1 queries"');
  });

  it("knows nobody without a session, and after signing out", async () => {
    expect((await app.request("/api/me")).status).toBe(401);
    const { cookie } = await signIn("fiona@2mg.test");
    expect((await app.request("/api/me", { headers: { cookie: cookie as string } })).status).toBe(
      200,
    );
    await post("/api/auth/logout", {}, cookie);
    expect((await app.request("/api/me", { headers: { cookie: cookie as string } })).status).toBe(
      401,
    );
  });

  it("locks a login after five wrong passwords", async () => {
    for (let i = 0; i < 5; i++) await signIn("marco@2mg.test", "wrong");
    const { response } = await signIn("marco@2mg.test");
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toMatch(/Try again in 15 minutes/);
  });
});

describe("changing a password", () => {
  it("needs the current one, a long enough new one, and ends other sessions", async () => {
    const first = await signIn("jane@2mg.test");
    const second = await signIn("jane@2mg.test");
    const cookie = first.cookie as string;

    const wrong = await post(
      "/api/auth/password",
      { current: "nope", next: "another-pass-1" },
      cookie,
    );
    expect((await wrong.json()).error.field).toBe("current");
    const short = await post("/api/auth/password", { current: PASSWORD, next: "short" }, cookie);
    expect((await short.json()).error.field).toBe("next");

    const done = await post(
      "/api/auth/password",
      { current: PASSWORD, next: "another-pass-1" },
      cookie,
    );
    expect(done.status).toBe(200);
    expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(200);
    expect(
      (await app.request("/api/me", { headers: { cookie: second.cookie as string } })).status,
    ).toBe(401);
    expect((await signIn("jane@2mg.test")).response.status).toBe(401);
    expect((await signIn("jane@2mg.test", "another-pass-1")).response.status).toBe(200);
  });
});
