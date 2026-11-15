// The desks' clock on the screen: working minutes since an order reached its step, on the
// company's working hours and holidays (the API's /api/hr/calendar), by the same rule the API
// counts with (@2mg/api/work-time). The road (a courier) runs on the plain clock.

import { lateAfterFor, onWorkClock } from "@2mg/api/late";
import { DEFAULT_SCHEDULE, type WorkSchedule, workMinutes } from "@2mg/api/work-time";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { api } from "./api";

export function useWorkClock() {
  const calendar = useQuery({
    queryKey: ["work-calendar"],
    queryFn: () => api<{ schedule: WorkSchedule; holidays: string[] }>("/api/hr/calendar"),
    staleTime: 60 * 60_000,
  });
  const schedule = calendar.data?.schedule ?? DEFAULT_SCHEDULE;
  const holidays = useMemo(() => new Set(calendar.data?.holidays ?? []), [calendar.data]);
  /** Minutes an order at this status has waited since `since`. */
  const waitedAt = useCallback(
    (status: string, since: string) =>
      onWorkClock(status)
        ? workMinutes(since, Date.now(), schedule, holidays)
        : (Date.now() - Date.parse(since)) / 60_000,
    [schedule, holidays],
  );
  /** Whether it is past its step's limit. */
  const lateAt = useCallback(
    (status: string, since: string) =>
      waitedAt(status, since) >= (lateAfterFor(status) ?? Number.POSITIVE_INFINITY),
    [waitedAt],
  );
  return { waitedAt, lateAt };
}
