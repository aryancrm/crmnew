// An address that is none of this person's screens.

import type { Me } from "@2mg/api/types";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../auth";

export function NotBuilt() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-3 rounded-2xl bg-white p-6 shadow-card">
      <h1 className="text-[28px] font-semibold tracking-tight">No such page</h1>
      <p className="text-ink-2">This address isn't one of your screens.</p>
      <Link to="/" className="font-semibold text-brand">
        Back to Home
      </Link>
    </div>
  );
}

/** A page only some people work: the others get "not one of your screens", whatever address they
 *  open (a link left from someone else's screen included). The API refuses them as well. */
export function OnlyFor({ allow, children }: { allow: (me: Me) => boolean; children: ReactNode }) {
  const me = useMe();
  if (me.data && !allow(me.data)) return <NotBuilt />;
  return <>{children}</>;
}
