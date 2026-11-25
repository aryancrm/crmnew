// The migrations renumbered on 23 Nov: a database that ran them under their old names isn't asked to
// run them again (their "add column" would fail and the API wouldn't start).

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase, rows } from "./index";
import { migrate, RENAMED } from "./migrate";

const names = async (db: ReturnType<typeof openDatabase>) =>
  (await rows<{ name: string }>(db, sql`select name from schema_migration order by name`)).map((row) => row.name);

describe("renumbered migrations", () => {
  it("are kept as run on a database that ran their old names", async () => {
    const db = openDatabase({ dir: "memory" });
    await migrate(db);
    const all = await names(db);
    for (const [before, now] of Object.entries(RENAMED))
      await db.execute(sql`update schema_migration set name = ${before} where name = ${now}`);

    expect(await migrate(db)).toEqual([]);
    expect(await names(db)).toEqual(all);
    for (const before of Object.keys(RENAMED)) expect(all).not.toContain(before);
  });

  it("change nothing on a database that never had them", async () => {
    const db = openDatabase({ dir: "memory" });
    const applied = await migrate(db);
    for (const now of Object.values(RENAMED)) expect(applied).toContain(now);
    expect(await migrate(db)).toEqual([]);
  });
});
