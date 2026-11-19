// An address that is none of this person's screens.

import { Link } from "react-router-dom";

export function NotBuilt() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-3 rounded-2xl bg-white p-6 shadow-card">
      <h1 className="text-xl font-bold">No such page</h1>
      <p className="text-ink-2">This address isn't one of your screens.</p>
      <Link to="/" className="font-semibold text-brand">
        Back to Home
      </Link>
    </div>
  );
}
