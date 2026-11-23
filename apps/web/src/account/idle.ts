// Management, Finance and Dispatch work on shared computers: left alone for 15 minutes, the person
// is signed out, so the next one signs in as themselves. The last touch is kept for the browser,
// so several tabs count as one and a computer that slept is signed out when it wakes.

import { useEffect, useRef } from "react";

const KEY = "bo:active";
export const IDLE_MS = 15 * 60 * 1000;
const SHARED_COMPUTER_ROLES = ["management", "finance", "dispatch"];

export function markActive(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage blocked: this tab's own clock still signs them out.
  }
}

function lastActive(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Calls `leave` once a signed-in desk person has been idle that long. */
export function useIdleSignOut(role: string | undefined, leave: () => void): void {
  const latest = useRef(leave);
  latest.current = leave;
  useEffect(() => {
    if (!role || !SHARED_COMPUTER_ROLES.includes(role)) return;
    let touched = lastActive() || Date.now();
    let written = 0;
    let gone = false;
    const check = () => {
      if (gone || Date.now() - Math.max(touched, lastActive()) < IDLE_MS) return;
      gone = true;
      latest.current();
    };
    const touch = () => {
      // A press after the time is up doesn't bring the session back.
      check();
      if (gone) return;
      touched = Date.now();
      if (touched - written < 5000) return;
      written = touched;
      markActive();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, touch, { capture: true, passive: true });
    const timer = setInterval(check, 15_000);
    check();
    return () => {
      clearInterval(timer);
      for (const event of events) window.removeEventListener(event, touch, { capture: true });
    };
  }, [role]);
}
