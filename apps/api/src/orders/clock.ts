// The order clocks in SQL, by the rules in ./late: minutes an order (alias `o`) has stood at its
// step, in working minutes for the desks (the database's work_minutes()), on the plain clock on
// the road; and the step's limit.

import { type SQL, sql } from "drizzle-orm";
import { LATE_AFTER, STUCK_WORK_MINUTES } from "./late";

/** Minutes from `since` to now at a step with this status. */
export const waitedAt = (status: SQL, since: SQL): SQL =>
  sql`(case when ${status} = 'shipped' then extract(epoch from now() - ${since}) / 60
    else work_minutes(${since}, now()) end)`;

/** The limit at a step with this status (null where no desk is timed). */
export const limitAt = (status: SQL): SQL =>
  sql`(case ${status} when 'pending_approval' then ${LATE_AFTER.management}::int
    when 'finance_check' then ${LATE_AFTER.finance}::int when 'ready_for_invoice' then ${LATE_AFTER.finance}::int
    when 'ready_for_dispatch' then ${LATE_AFTER.dispatch}::int when 'packing' then ${LATE_AFTER.dispatch}::int
    when 'shipped' then ${LATE_AFTER.road}::int when 'draft' then ${LATE_AFTER.fix}::int end)`;

/** An order (alias `o`) late at the step it stands at. */
export const lateNow = (): SQL =>
  sql`(${waitedAt(sql`o.status`, sql`o.status_since`)} > ${limitAt(sql`o.status`)})`;

/** An order (alias `o`) that hasn't moved from its step for two working days. */
export const stuckNow = (): SQL =>
  sql`(work_minutes(coalesce(o.status_since, o.updated_at), now()) > ${STUCK_WORK_MINUTES}::int)`;
