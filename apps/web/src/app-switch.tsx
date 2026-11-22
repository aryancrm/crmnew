// Going to another app (22–23 Nov). One rule says which app an address is in, so the two things
// that follow from it agree for every link, the ones added later too:
//   - a link that leaves this app carries ↗ (a ⌄ only ever opens a list in place);
//   - arriving in another app, by a link, Back or Forward, says so at once (Doherty) until its
//     first figures are in.

import type { Me } from "@2mg/api/types";
import { useIsFetching } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, BookOpen, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMe } from "./auth";
import { LEDGER_ROLES } from "./books/kinds";
import { spaceFor } from "./menus";

type App = { key: string; label: string; icon: LucideIcon };

/** The app an address opens for this person: Books' frame, else the menu that shows there. */
function appOf(me: Me, to: string): App {
  const path = to.split(/[?#]/)[0] ?? "/";
  if (path === "/books" || path.startsWith("/books/"))
    return { key: "books", label: LEDGER_ROLES.includes(me.role) ? "Books" : "Inventory books", icon: BookOpen };
  const space = spaceFor(me, path);
  // The CEO's desk and the Admin panel share a key: the name tells them apart.
  return { key: `${space.key}:${space.label}`, label: space.label, icon: space.icon };
}

/** For a link's address: the app it goes to, when that isn't the one open now. */
export function useLeavesTo(): (to: string) => string | undefined {
  const me = useMe().data;
  const { pathname } = useLocation();
  return useMemo(() => {
    const known = new Map<string, string | undefined>();
    const here = me ? appOf(me, pathname) : null;
    return (to: string) => {
      if (!me || !here) return undefined;
      if (!known.has(to)) {
        const there = appOf(me, to);
        known.set(to, there.key === here.key ? undefined : there.label);
      }
      return known.get(to);
    };
  }, [me, pathname]);
}

/** The ↗ on a link that leaves this app. */
export function LeavesArrow({ app, size = 14, className = "" }: { app: string; size?: number; className?: string }) {
  return (
    <>
      <ArrowUpRight size={size} aria-hidden="true" data-leaves={app} className={`shrink-0 ${className}`} />
      <span className="sr-only">(opens {app})</span>
    </>
  );
}

/** Long enough to be read, short enough not to be waited for. */
const SHOWN_MS = 450;
/** A slow or failing read doesn't hold the screen: the page then shows its own loading or error. */
const LONGEST_MS = 8000;
const FADE_MS = 160;

/** The "Opening Books…" screen between two apps. Mounted once, beside the routes. */
export function AppSwitch() {
  const me = useMe().data;
  const { pathname } = useLocation();
  const here = useMemo(
    () => (me && !me.mustChangePassword && !/^\/(login|signup|welcome)(\/|$)/.test(pathname) ? appOf(me, pathname) : null),
    [me, pathname],
  );
  const [last, setLast] = useState(here);
  const [move, setMove] = useState<{ from: App; to: App; at: number } | null>(null);
  const [fading, setFading] = useState(false);
  // Set while rendering, so the new app is never painted for a moment before its loading screen.
  if (last?.key !== here?.key) {
    setLast(here);
    setFading(false);
    // Signing in or out, or the first page opened, isn't a switch.
    setMove(last && here ? { from: last, to: here, at: Date.now() } : null);
  }
  // Only first reads hold it: a poll of figures already shown doesn't.
  const waiting = useIsFetching({
    predicate: (query) => query.state.status === "pending" && query.getObserversCount() > 0,
  });

  useEffect(() => {
    if (!move || fading) return;
    const gone = Date.now() - move.at;
    const wait = Math.max(0, (waiting ? LONGEST_MS : SHOWN_MS) - gone);
    const timer = setTimeout(() => setFading(true), wait);
    return () => clearTimeout(timer);
  }, [move, waiting, fading]);

  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => {
      setMove(null);
      setFading(false);
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [fading]);

  return (
    <>
      {/* Always there, so a screen reader hears it change. */}
      <p role="status" className="sr-only">
        {move ? `Opening ${move.to.label}…` : ""}
      </p>
      {move && (
        <div
          aria-hidden="true"
          data-app-switch={move.to.label}
          className={`fixed inset-0 z-[70] grid place-items-center bg-ground px-6 transition-opacity duration-150 print:hidden ${fading ? "pointer-events-none opacity-0" : ""}`}
        >
          <div className="flex w-full max-w-xs flex-col items-center text-center font-sans">
            <div className="flex items-center gap-4">
              <span className="grid size-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-400">
                <move.from.icon size={22} />
              </span>
              <ArrowRight size={20} className="app-switch-arrow text-brand" />
              <span className="grid size-16 place-items-center rounded-2xl bg-brand text-white shadow-sm">
                <move.to.icon size={28} />
              </span>
            </div>
            <p className="mt-5 text-lg leading-7 font-semibold text-ink">Opening {move.to.label}…</p>
            <p className="mt-0.5 text-xs text-ink-2">from {move.from.label}</p>
            <span className="mt-4 h-1 w-40 overflow-hidden rounded-full bg-slate-200">
              <span className="app-switch-bar block h-full w-2/5 rounded-full bg-brand" />
            </span>
          </div>
        </div>
      )}
    </>
  );
}
