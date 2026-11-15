// The phone's place for "Where the team is": while a field person's working day runs and the app
// is open, their place goes to the CRM every five minutes (sooner when they have moved 150 m).
// Nothing is sent before Start my day or after End my day; a refused location permission is left
// alone. Browsers don't share a place with a closed page, so this works while the app is open.

import type { MyDay } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../api";
import { useMe } from "../auth";

const FIELD_ROLES = ["medrep", "team_lead", "manager"];
const EVERY_MS = 5 * 60_000;
const MOVED_M = 150;

function metres(a: [number, number], b: [number, number]) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function LiveLocationSender() {
  const me = useMe().data;
  const field = Boolean(me && FIELD_ROLES.includes(me.role) && !me.viewedBy);
  const day = useQuery({
    queryKey: ["my-day"],
    queryFn: () => api<MyDay>("/api/hr/my-day"),
    enabled: field,
    staleTime: 60_000,
  });
  const running = field && Boolean(day.data?.today.working);
  const last = useRef<{ at: number; where: [number, number] } | null>(null);
  useEffect(() => {
    if (!running || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const where: [number, number] = [position.coords.latitude, position.coords.longitude];
        const before = last.current;
        if (before && Date.now() - before.at < EVERY_MS && metres(before.where, where) < MOVED_M)
          return;
        last.current = { at: Date.now(), where };
        void api("/api/field/where", {
          body: {
            place: `${where[0].toFixed(5)},${where[1].toFixed(5)}`,
            accuracy: Math.round(position.coords.accuracy),
          },
        }).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [running]);
  return null;
}
