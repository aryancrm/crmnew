// Puts a chart's units and seats in the company's tree, once: a unit is known by its name under
// its parent, a seat by its title in its unit (a second run adds only what is missing). Seats
// come in empty for HR to fill. A selling seat gets its own area; an area made here does not
// claim customers by city (that is done by tying Zoho's salespeople to seats), and a city
// already in another area of the channel is left out of the new one.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { Runner } from "../inventory/service";
import type { ChartSeat, ChartUnit } from "./chart-2026";
import { fillOrderSeats, projectOrg } from "./service";

export type ChartResult = {
  units: number;
  seats: number;
  areas: number;
  alreadyHere: number;
  /** Cities left out because another area of the channel has them. */
  citiesTaken: string[];
  /** Channel codes the chart names that this CRM does not have. */
  noChannel: string[];
};

export async function importChart(db: Database, chart: ChartUnit[], apply: boolean): Promise<ChartResult> {
  const said: ChartResult = { units: 0, seats: 0, areas: 0, alreadyHere: 0, citiesTaken: [], noChannel: [] };
  const [company] = await rows<{ id: number }>(db, sql`select id::int as id from org_unit where kind = 'company'`);
  if (!company) throw new Error("No company in the tree: open the Admin panel once first.");
  const channels = new Map(
    (await rows<{ id: number; code: string }>(db, sql`select id::int as id, code from channel`)).map((row) => [row.code, row.id]),
  );

  const walk = async (tx: Runner, units: ChartUnit[], parentId: number | null, sort = 0) => {
    for (const [index, node] of units.entries()) {
      const channelId = node.channel ? (channels.get(node.channel) ?? null) : null;
      if (node.channel && !channelId && !said.noChannel.includes(node.channel)) said.noChannel.push(node.channel);
      let [unit] = parentId
        ? await rows<{ id: number }>(
            tx,
            sql`select id::int as id from org_unit where parent_id = ${parentId} and lower(name) = lower(${node.name}) and active`,
          )
        : [];
      if (!unit) {
        said.units += 1;
        [unit] = apply && parentId
          ? await rows<{ id: number }>(
              tx,
              sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
                values (${node.name}, ${node.kind}, ${parentId}, ${channelId}, ${sort + index + 1}) returning id::int as id`,
            )
          : [{ id: -1 }];
      }
      for (const seat of node.seats) await seats(tx, unit?.id ?? -1, channelId, seat);
      if (node.units?.length) await walk(tx, node.units, unit?.id ?? -1);
    }
  };

  const seats = async (tx: Runner, unitId: number, channelId: number | null, seat: ChartSeat) => {
    const n = seat.n ?? 1;
    const [have] = unitId > 0
      ? await rows<{ count: number }>(
          tx,
          sql`select count(*)::int as count from seat where unit_id = ${unitId} and lower(title) = lower(${seat.title}) and active`,
        )
      : [{ count: 0 }];
    said.alreadyHere += Math.min(have?.count ?? 0, n);
    for (let at = (have?.count ?? 0) + 1; at <= n; at++) {
      said.seats += 1;
      let areaId: number | null = null;
      if (seat.area && channelId) {
        const name = n > 1 ? `${seat.area} ${at}` : seat.area;
        const [old] = await rows<{ id: number }>(
          tx,
          sql`select id::int as id from area where channel_id = ${channelId} and lower(name) = lower(${name})`,
        );
        const taken = new Set(
          (
            await rows<{ city: string }>(
              tx,
              sql`select lower(c.city) as city from area a, unnest(a.cities) as c(city) where a.channel_id = ${channelId}`,
            )
          ).map((row) => row.city),
        );
        const cities = (seat.cities ?? []).filter((city) => {
          if (!taken.has(city.toLowerCase())) return true;
          said.citiesTaken.push(`${city} (${name})`);
          return false;
        });
        if (old) areaId = old.id;
        else {
          said.areas += 1;
          if (apply)
            areaId =
              (
                await rows<{ id: number }>(
                  tx,
                  sql`insert into area (channel_id, name, cities) values (${channelId}, ${name}, string_to_array(${cities.join("|")}, '|'))
                    returning id::int as id`,
                )
              )[0]?.id ?? null;
        }
      }
      if (apply && unitId > 0)
        await tx.execute(
          sql`insert into seat (unit_id, title, module, lead, area_id, sort)
            values (${unitId}, ${seat.title}, ${seat.module}, ${Boolean(seat.lead)}, ${areaId},
              (select coalesce(max(sort), 0) + 1 from seat where unit_id = ${unitId}))`,
        );
    }
  };

  if (!apply) {
    await walk(db, chart, company.id);
    return said;
  }
  await db.transaction(async (tx) => {
    await walk(tx, chart, company.id);
    await projectOrg(tx);
    await fillOrderSeats(tx);
  });
  return said;
}
