import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { openDatabase, rows } from "./db/index";
import { migrate } from "./db/migrate";
import { makeFirstAdmin } from "./first-admin";
import { sql } from "drizzle-orm";

describe("the first System admin on an empty database", () => {
  it("is made once, with the channels, and can sign in", async () => {
    const db = openDatabase({ dir: "memory" });
    await migrate(db);
    expect(await makeFirstAdmin(db, undefined, undefined)).toBe(false);
    expect(await makeFirstAdmin(db, "Admin@Example.com", "first-pass-123")).toBe(true);
    expect(await makeFirstAdmin(db, "other@example.com", "another-pass-1")).toBe(false);
    const people = await rows<{ email: string; role: string }>(db, sql`select email, role from person`);
    expect(people).toEqual([{ email: "admin@example.com", role: "admin" }]);
    const [channels] = await rows<{ n: number }>(db, sql`select count(*)::int as n from channel`);
    expect(channels?.n).toBe(8);
    const app = createApp(db, { webUrl: "http://localhost:5180" });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: "first-pass-123" }),
    });
    expect(login.status).toBe(200);
  });
});
