// One queue of everything waiting on a decider under Leave & forms (docs/HR-PLAN.md, step 3):
// leave, forms and attendance days to put right, counted from each desk's own list, so the numbers
// always agree with the lists (and with To decide). For HR and the Admin it also says how many of
// them were routed to HR itself, apart from those HR may decide as everyone's backup.

import { type Database } from "../db/index";
import { Refusal } from "../http";
import type { HrQueue, Me } from "../types";
import { ATTENDANCE_WRITE_ROLES } from "./attendance";
import { fixList } from "./corrections";
import { formList } from "./forms";
import { leaveList } from "./leave";

async function ifAllowed<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refusal) return null;
    throw error;
  }
}

export async function hrQueue(db: Database, me: Me): Promise<HrQueue> {
  const [leave, forms, fixes] = await Promise.all([
    ifAllowed(() => leaveList(db, me, { view: "waiting" })),
    ifAllowed(() => formList(db, me, { view: "waiting" })),
    ifAllowed(() => fixList(db, me, { view: "waiting" })),
  ]);
  if (!leave && !forms && !fixes)
    throw new Refusal(403, "not_allowed", "Leave & forms is for HR, team leads and the CEO.");
  const counts = {
    leave: leave?.counts.waiting ?? 0,
    forms: forms?.counts.waiting ?? 0,
    fixes: fixes?.counts.waiting ?? 0,
  };
  const atHr = ATTENDANCE_WRITE_ROLES.includes(me.role)
    ? {
        leave: (leave?.lines ?? []).filter((one) => one.approver === null && one.secondApprover === null).length,
        forms: (forms?.lines ?? []).filter((one) => one.approver === null).length,
        fixes: (fixes?.lines ?? []).filter((one) => one.approver === null).length,
      }
    : null;
  return {
    ...counts,
    total: counts.leave + counts.forms + counts.fixes,
    atHr: atHr ? { ...atHr, total: atHr.leave + atHr.forms + atHr.fixes } : null,
  };
}
