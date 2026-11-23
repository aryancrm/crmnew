// A sign-in is made on a department's page and only opens there for a login that belongs to it
// (Aryan, 21 Nov: "the token is the source of truth for access"). The session keeps the department.

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";
import type { Me } from "../types";
import { ownWorkspace, WORKSPACE_ACCESS } from "./workspaces";
import { ROLES } from "../people/roles";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;

const login = (email: string, password: string, workspace?: string) =>
  app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, workspace }),
  });

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
});

describe("signing in at a department", () => {
  it("every role has a department to sign in at", () => {
    for (const role of ROLES) expect(ownWorkspace(role), role).toBeDefined();
    expect(new Set(WORKSPACE_ACCESS.map((one) => one.key)).size).toBe(WORKSPACE_ACCESS.length);
  });

  it("opens on the login's own department and the session keeps it", async () => {
    const response = await login("ryan@2mg.test", PASSWORD, "sales");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(((await response.json()) as { me: Me }).me.workspace).toBe("sales");
    const cookie = response.headers.get("set-cookie")?.split(";")[0] as string;
    const me = await app.request("/api/me", { headers: { cookie } });
    expect(((await me.json()) as { me: Me }).me.workspace).toBe("sales");
  });

  it("refuses a right password on another department, and opens no session", async () => {
    const response = await login("ryan@2mg.test", PASSWORD, "finance");
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string; field?: string } } & Record<string, unknown>;
    const text = JSON.stringify(body);
    expect(text).toContain("wrong_department");
    expect(text).toContain("no access to Finance");
    expect(text).toContain("MedReps page");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("says only 'wrong' to a wrong password, whatever the department", async () => {
    const response = await login("ryan@2mg.test", "not-the-password", "finance");
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("MedReps");
  });

  it("Books opens for Finance, the CEO and the Admin, not for a MedRep", async () => {
    expect((await login("fiona@2mg.test", PASSWORD, "books")).status).toBe(200);
    expect((await login("admin@2mg.test", PASSWORD, "books")).status).toBe(200);
    expect((await login("ryan@2mg.test", PASSWORD, "books")).status).toBe(403);
  });

  it("without a department, the session is opened for the login's own", async () => {
    const response = await login("fiona@2mg.test", PASSWORD);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: Me }).me.workspace).toBe("finance");
  });

  it("refuses a department that doesn't exist", async () => {
    expect((await login("ryan@2mg.test", PASSWORD, "nowhere")).status).toBe(400);
  });
});
