// Management's, Finance's and Dispatch's common screen opens with the company's password alone
// (Aryan, 19 Nov): no login ID; it signs in as the desk's first seat. A wrong password is refused,
// and a desk with nobody in it says so the same way.

import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { openDatabase } from "../db/index";
import { migrate } from "../db/migrate";
import { seedDemo } from "../seed";

const PASSWORD = "test-password-1";

describe("the desk's sign-in", () => {
  it("opens Management, Finance and Dispatch with the password alone, as that desk", async () => {
    const db = openDatabase({ dir: "memory" });
    await migrate(db);
    await seedDemo(db, PASSWORD);
    const app = createApp(db, { webUrl: "http://localhost:5180" });
    const desk = (name: string, password = PASSWORD) =>
      app.request("/api/auth/desk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ desk: name, password }) });
    for (const name of ["management", "finance", "dispatch"]) {
      const response = await desk(name);
      expect(response.status, name).toBe(200);
      const { me } = (await response.json()) as { me: { role: string } };
      expect(me.role).toBe(name);
      expect(response.headers.get("set-cookie")).toContain("sid=");
    }
    expect((await desk("finance", "not-the-password")).status).toBe(401);
    expect((await desk("ceo")).status).toBe(400);
  });
});
