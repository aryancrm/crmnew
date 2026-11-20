// A client and a visit as the MR App's lists and pages show them: one query part each, used by
// every page so a card reads the same everywhere.

import { sql } from "drizzle-orm";
import { iso } from "../inventory/service";
import type { VisitCard } from "./words";

/** A client's card (alias c) as JSON. */
export const clientJson = sql`json_build_object('id', c.id::int, 'kind', c.kind, 'code', c.code, 'name', c.name,
  'specialty', c.specialty, 'category', c.category, 'city', c.city, 'zone', c.zone,
  'detail', case c.kind
    when 'hospital' then case c.hospital_type when 'government' then 'Government' when 'private' then 'Private' end
    when 'firm' then case c.firm_type when 'super_stockist' then 'Super stockist' when 'distributor' then 'Distributor'
      when 'sub_distributor' then 'Sub-distributor' when 'stockist' then 'Stockist' when 'retailer' then 'Retailer' end
    else (select h.name from mr_client h where h.id = c.works_at) end,
  'pinned', c.pin is not null, 'prefDays', to_json(c.pref_days), 'prefTime', c.pref_time,
  'assignedTo', (select json_build_object('id', a.id::int, 'name', a.name) from person a where a.id = c.assigned_to))`;

/** A visit's card columns over `mr_visit v join mr_client c join person p` (see cardFrom). */
export const cardColumns = sql`v.id::int as id, to_char(v.day, 'YYYY-MM-DD') as day, v.status,
  ${iso("v.checked_in_at")} as "checkedInAt", ${iso("v.done_at")} as "doneAt",
  json_build_object('id', p.id::int, 'name', p.name) as person, ${clientJson} as client,
  to_json(v.objectives) as objectives, v.priority::int as priority, v.unplanned, v.meeting, v.outcome, v.productive,
  v.nature, v.skip_reason as "skipReason", v.distance_m as "distanceM",
  (select coalesce(sum(o.amount), 0) from mr_order o where o.visit_id = v.id and o.status = 'booked')::float8 as booked`;
export const cardFrom = sql`from mr_visit v join mr_client c on c.id = v.client_id join person p on p.id = v.person_id`;

export type CardSql = VisitCard;
export const toCard = (card: CardSql): VisitCard => card;
