// A customer and a visit as the field's lists and pages show them (one query part each, so a card
// reads the same everywhere): the CRM's own customer with its field profile, the CRM's own visit
// with the call's record.

import { sql } from "drizzle-orm";
import { iso } from "../inventory/service";
import type { VisitCard } from "./words";

/** A customer's card (alias c, its field profile f) as JSON. */
export const clientJson = sql`json_build_object('id', c.id::int,
  'kind', case c.kind when 'doctor' then 'doctor' when 'hospital' then 'hospital' else 'firm' end,
  'customerKind', c.kind, 'code', c.code, 'name', c.name, 'specialty', c.specialty, 'category', c.visit_class,
  'city', c.city, 'zone', f.zone,
  'detail', case c.kind
    when 'hospital' then case f.hospital_type when 'government' then 'Government' when 'private' then 'Private' end
    when 'doctor' then (select h.name from customer h where h.id = c.works_at)
    else coalesce(case f.firm_type when 'super_stockist' then 'Super stockist' when 'distributor' then 'Distributor'
      when 'sub_distributor' then 'Sub-distributor' when 'stockist' then 'Stockist' when 'retailer' then 'Retailer' end,
      case c.kind when 'drugstore' then 'Drugstore' else 'Distributor' end) end,
  'pinned', c.pin is not null, 'prefDays', coalesce(to_json(f.pref_days), '[]'::json), 'prefTime', f.pref_time,
  'assignedTo', (select json_build_object('id', a.id::int, 'name', a.name) from person a
    where a.area_id = c.area_id and a.role = 'medrep' and a.active order by a.id limit 1))`;
export const clientFrom = sql`from customer c left join customer_field f on f.customer_id = c.id`;
/** The customer kinds the field visits. */
export const FIELD_KINDS = sql`('doctor', 'hospital', 'drugstore', 'distributor')`;

/** A visit's card columns over `visit v join customer c (field profile f) join person p`. */
export const cardColumns = sql`v.id::int as id, to_char(v.day, 'YYYY-MM-DD') as day, v.status,
  ${iso("v.checked_in_at")} as "checkedInAt", ${iso("v.done_at")} as "doneAt",
  json_build_object('id', p.id::int, 'name', p.name) as person, ${clientJson} as client,
  to_json(v.objectives) as objectives, v.priority::int as priority, v.unplanned, v.meeting, v.outcome, v.productive,
  v.nature, v.skip_reason as "skipReason", v.distance_m as "distanceM",
  (select coalesce(sum(o.total), 0) from visit_order vo join sales_order o on o.id = vo.order_id
    where vo.visit_id = v.id and o.status <> 'cancelled')::float8 as booked`;
export const cardFrom = sql`from visit v join customer c on c.id = v.customer_id
  left join customer_field f on f.customer_id = c.id join person p on p.id = v.person_id`;

export type CardSql = VisitCard;
export const toCard = (card: CardSql): VisitCard => card;
