import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { addDays, todayManila } from "../inventory/rules";
import { seedDemo } from "../seed";
import type { Me } from "../types";
import { reorders } from "./reorders";

let db: Database;
const admin = { id: 0, role: "admin" } as unknown as Me;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, "test-password-1");
  const [who] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'admin@2mg.test'`);
  admin.id = who?.id as number;
});

/** A customer with old-system orders on the given days ago. */
async function withOrders(name: string, daysAgo: number[]) {
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into customer (name, kind, city, added_by) values (${name}, 'drugstore', 'Pasig', ${admin.id}) returning id::int as id`,
  );
  for (const [n, ago] of daysAgo.entries())
    await db.execute(
      sql`insert into past_order (zoho_id, code, customer_id, ordered_on, status, total)
        values (${`${name}-${n}`}, ${`SO-${name}-${n}`}, ${made?.id}, ${addDays(todayManila(), -ago)}::date, 'closed', 100000)`,
    );
  return made?.id as number;
}

describe("customers to call", () => {
  it("each customer against their own usual gap: due, late, at risk, lost", async () => {
    const onTime = await withOrders("Every Month On Time", [10, 40, 70, 100]);
    const due = await withOrders("Every Month Due", [32, 62, 92, 122]);
    const late = await withOrders("Every Month Late", [50, 80, 110, 140]);
    const risk = await withOrders("Every Month At Risk", [80, 110, 140]);
    const lost = await withOrders("Every Month Lost", [200, 230, 260]);
    const state = async (id: number) => {
      for (const key of ["due", "late", "at_risk", "lost"] as const) {
        const list = await reorders(db, admin, { state: key });
        if (list.rows.some((row) => row.customerId === id)) return key;
      }
      return "ok";
    };
    expect(await state(onTime)).toBe("ok");
    expect(await state(due)).toBe("due");
    expect(await state(late)).toBe("late");
    expect(await state(risk)).toBe("at_risk");
    expect(await state(lost)).toBe("lost");
    const list = await reorders(db, admin, { state: "due" });
    expect(list.rows.find((row) => row.customerId === due)).toMatchObject({ usual: 30, since: 32, orders: 4 });
    // The head's view has a line per area, and says whose list it is.
    expect(list.areas.length).toBeGreaterThan(0);
    expect(list.scope.label).toBe("Whole company");
    await expect(reorders(db, { ...admin, role: "finance" } as Me, {})).rejects.toThrow(/sellers/);
  });
});
