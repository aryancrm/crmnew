// The demo company's tree, shaped like HR's org chart (docs/data/org-chart-2026-10-10.json): the
// company with the CEO and the Admin, the businesses with their channels and lines, the teams
// under them, and the departments. Each demo person sits in the seat their title names; the RX
// head's and the Mindanao team lead's seats are vacant, as jobs often are.

import { sql } from "drizzle-orm";
import { rows } from "../db/index";
import type { Runner } from "../inventory/service";
import type { Role } from "../people/roles";
import type { OrgUnitKind } from "../types";

const SINCE = "2025-01-01";

export async function buildDemoOrg(tx: Runner): Promise<void> {
  const people = await rows<{ id: number; email: string; areaId: number | null }>(
    tx,
    sql`select id::int as id, email, area_id::int as "areaId" from person`,
  );
  const who = (name: string) => people.find((person) => person.email === `${name}@2mg.test`);

  const unit = async (
    name: string,
    kind: OrgUnitKind,
    parentId: number | null,
    channel: string | null,
    sort: number,
  ) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into org_unit (name, kind, parent_id, channel_id, sort)
        values (${name}, ${kind}, ${parentId}, (select id from channel where code = ${channel}), ${sort})
        returning id::int as id`,
    );
    return made?.id as number;
  };
  const seat = async (
    unitId: number,
    title: string,
    module: Role,
    person: string | null,
    more: { lead?: boolean; areaId?: number | null } = {},
  ) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into seat (unit_id, title, module, lead, area_id, sort)
        values (${unitId}, ${title}, ${module}, ${Boolean(more.lead)}, ${more.areaId ?? null},
          (select coalesce(max(sort), 0) + 1 from seat where unit_id = ${unitId}))
        returning id::int as id`,
    );
    const holder = person ? who(person) : undefined;
    if (made && holder)
      await tx.execute(
        sql`insert into seat_holder (seat_id, person_id, kind, starts_on, reason)
          values (${made.id}, ${holder.id}, 'holder', ${SINCE}::date, 'Joined')`,
      );
    return made?.id as number;
  };

  const company = await unit("2MG Inc.", "company", null, null, 0);
  await seat(company, "CEO", "ceo", "naresh", { lead: true });
  await seat(company, "System admin", "admin", "admin");

  const hospital = await unit("Hospital Division", "business", company, "HOSP", 1);
  await seat(hospital, "HOSP head", "manager", "vanessa", { lead: true });
  const ncr1 = await unit("NCR 1", "team", hospital, null, 1);
  await seat(ncr1, "Area manager", "team_lead", "daniel", { lead: true });
  await seat(ncr1, "MedRep", "medrep", "ryan", { areaId: who("ryan")?.areaId ?? null });
  const mindanao = await unit("Mindanao", "team", hospital, null, 2);
  await seat(mindanao, "Area manager", "team_lead", null, { lead: true });

  const rx = await unit("Prescription Business", "business", company, "RX", 2);
  await seat(rx, "RX head", "manager", null, { lead: true });
  await unit("Doctor dispensing", "line", rx, null, 1);
  await unit("Doctor referral", "line", rx, null, 2);
  await unit("MD Telesales", "line", rx, "TS", 3);

  const marketing = await unit("Sales & Marketing", "business", company, null, 3);
  await unit("B2B Telesales", "line", marketing, "B2B", 1);
  await unit("Government Bidding", "line", marketing, "BID", 2);
  await unit("Modern Trade", "business", company, "MT", 4);
  // The Patient Assistance Program is a channel of its own, never inside the hospitals'.
  await unit("Patient Assistance", "business", company, "PAP", 5);

  const online = await unit("Online", "business", company, "ONLINE", 6);
  await seat(online, "Online desk lead", "online", "jane", { lead: true });

  const management = await unit("Management", "department", company, null, 7);
  await seat(management, "Operations management", "management", "sarla");
  const ops = await unit("Supply Chain, Ops & Finance", "department", company, null, 8);
  await seat(ops, "Finance officer", "finance", "fiona");
  await seat(ops, "Dispatch lead", "dispatch", "marco");
  await seat(ops, "Inventory officer", "inventory", "irene");
  const hr = await unit("HR", "department", company, null, 9);
  await seat(hr, "HR officer", "hr", "helen", { lead: true });
}
