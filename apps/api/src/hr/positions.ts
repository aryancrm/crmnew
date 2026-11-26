// HR's list of positions (docs/HR-PLAN.md, step 1): what a record may say as someone's position,
// so a typo never becomes a new job title. HR and the Admin keep it; one no longer used is
// archived, never deleted (the records that say it keep it).

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { clean } from "../inventory/service";
import type { HrPositions, Me } from "../types";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";

/** Seats' titles not on the list yet join it, so the list is the whole truth. */
async function fillFromSeats(db: Database): Promise<void> {
  await db.execute(
    sql`insert into hr_position (name)
      select distinct on (lower(trim(s.title))) trim(s.title) from seat s
      where trim(coalesce(s.title, '')) <> ''
        and not exists (select 1 from hr_position p where lower(p.name) = lower(trim(s.title)))
      order by lower(trim(s.title)), trim(s.title)
      on conflict do nothing`,
  );
}

export async function hrPositions(db: Database, me: Me): Promise<HrPositions> {
  allow(me, HR_ROLES, "see HR's positions");
  await fillFromSeats(db);
  const positions = await rows<HrPositions["positions"][number]>(
    db,
    sql`select p.id::int as id, p.name, p.archived_at is not null as archived,
        (select count(*)::int from employee e join person x on x.id = e.person_id
          where x.active and lower(coalesce(e.position, x.title)) = lower(p.name)) as people
      from hr_position p order by p.archived_at is not null, lower(p.name)`,
  );
  return { positions, can: { change: HR_WRITE_ROLES.includes(me.role) } };
}

export async function addPosition(db: Database, me: Me, input: { name?: string | null }): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "change HR's positions");
  const name = clean(input.name)?.replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new Refusal(400, "invalid", "Type the position, like Hospital CHC.", "name");
  const [same] = await rows<{ id: number; name: string; archived: boolean }>(
    db,
    sql`select id::int as id, name, archived_at is not null as archived from hr_position where lower(name) = ${name.toLowerCase()}`,
  );
  if (same)
    throw new Refusal(
      409,
      "taken",
      same.archived ? `"${same.name}" is on the list, archived: bring it back instead.` : `"${same.name}" is on the list already.`,
      "name",
    );
  const [made] = await rows<{ id: number }>(
    db,
    sql`insert into hr_position (name, created_by) values (${name}, ${me.id}) returning id::int as id`,
  );
  return { id: made?.id as number };
}

/** Archive (no longer offered) or bring back. */
export async function setPositionArchived(db: Database, me: Me, id: number, archived: boolean): Promise<void> {
  allow(me, HR_WRITE_ROLES, "change HR's positions");
  const changed = await rows<{ id: number }>(
    db,
    archived
      ? sql`update hr_position set archived_at = now(), archived_by = ${me.id} where id = ${id} and archived_at is null returning id::int as id`
      : sql`update hr_position set archived_at = null, archived_by = null where id = ${id} and archived_at is not null returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(404, "not_found", archived ? "That position is archived already." : "That position isn't archived.");
}
