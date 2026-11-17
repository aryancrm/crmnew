import { describe, expect, it } from "vitest";
import { freshenPlanner, openDatabase } from "./index";
import { migrate } from "./migrate";

describe("the embedded database's planner", () => {
  it("analyses the tables never analysed, then nothing until one grows", async () => {
    const db = openDatabase({ dir: "memory" });
    await migrate(db);
    const first = await freshenPlanner(db);
    expect(first).toContain("book_doc");
    expect(first).toContain("invoice");
    expect(await freshenPlanner(db)).toEqual([]);
  });
});
