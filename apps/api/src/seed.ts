// Demo people for a developer's computer and the tests: one per role, so every role's screens
// can be opened. Never runs online (SEED_DEMO is not set there) and never twice.

import { sql } from "drizzle-orm";
import { hashPassword } from "./auth/password";
import { type Database, rows } from "./db/index";
import { area, channel, person } from "./db/schema";
import { ensureRecords } from "./hr/people";
import { buildDemoOrg } from "./org/seed";
import { projectOrg } from "./org/service";
import type { Role } from "./people/roles";

/** Each channel with the Division its orders carry (none for RX: its doctors' orders say). */
const CHANNELS: [code: string, name: string, division: string | null][] = [
  ["HOSP", "Hospitals", "HOS"],
  ["RX", "Doctors", null],
  ["B2B", "Distributors and drugstores", "B2B"],
  ["BID", "Government tenders", "BID"],
  ["PAP", "Patient assistance", "MD Telesales"],
  ["TS", "Telesales", "TeleSales"],
  ["MT", "Modern trade", "MT"],
  ["ONLINE", "Online", "B2C"],
];

export async function seedDemo(db: Database, password: string): Promise<boolean> {
  const [counted] = await rows<{ count: number }>(
    db,
    sql`select count(*)::int as count from person`,
  );
  if ((counted?.count ?? 0) > 0) return false;

  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const channels = await tx
      .insert(channel)
      .values(CHANNELS.map(([code, name, division], sort) => ({ code, name, sort, division })))
      .returning();
    const idOf = (code: string) => channels.find((row) => row.code === code)?.id ?? null;

    const [pasay] = await tx
      .insert(area)
      .values({
        channelId: idOf("HOSP") as number,
        name: "HOS | Pasay",
        cities: ["Pasay", "Parañaque", "Las Piñas"],
      })
      .returning();

    const add = async (
      name: string,
      role: Role,
      title: string,
      more: { channel?: string; areaId?: number; reportsTo?: number } = {},
    ) => {
      const [row] = await tx
        .insert(person)
        .values({
          name,
          email: `${name.toLowerCase()}@2mg.test`,
          role,
          title,
          channelId: more.channel ? idOf(more.channel) : null,
          areaId: more.areaId ?? null,
          reportsTo: more.reportsTo ?? null,
          passwordHash: hash,
        })
        .returning();
      return row?.id as number;
    };

    const ceo = await add("Naresh", "ceo", "CEO");
    await add("Admin", "admin", "System admin");
    await add("Sarla", "management", "Operations management", { reportsTo: ceo });
    await add("Fiona", "finance", "Finance officer", { reportsTo: ceo });
    await add("Marco", "dispatch", "Dispatch lead", { reportsTo: ceo });
    await add("Irene", "inventory", "Inventory officer", { reportsTo: ceo });
    const head = await add("Vanessa", "manager", "HOSP head", { channel: "HOSP", reportsTo: ceo });
    const lead = await add("Daniel", "team_lead", "Area manager", {
      channel: "HOSP",
      reportsTo: head,
    });
    await add("Ryan", "medrep", "MedRep", { channel: "HOSP", areaId: pasay?.id, reportsTo: lead });
    const jane = await add("Jane", "online", "Online desk lead", {
      channel: "ONLINE",
      reportsTo: ceo,
    });
    await add("Helen", "hr", "HR officer", { reportsTo: ceo });
    // Each channel's head is named on the channel. The other six have none yet.
    await tx.execute(sql`update channel set head_id = ${head} where code = 'HOSP'`);
    await tx.execute(sql`update channel set head_id = ${jane} where code = 'ONLINE'`);
    // The same people as seats in the company's tree, which from now on writes the fields above.
    await buildDemoOrg(tx);
    await projectOrg(tx);
    // Everyone has an employee record (HR fills in the rest).
    await ensureRecords(tx);
  });
  return true;
}
