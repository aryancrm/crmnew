// Where an app's frame sends a browser that isn't signed in (Aryan, 27 Nov: "signing out of
// Management should leave that app, not the company"): a browser inside its company goes back to
// the company's systems (/signin); any other to the home page, as before.

import { Navigate, useLocation } from "react-router-dom";
import { useInsideCompany } from "../companies";

export function SignedOut() {
  const location = useLocation();
  const inside = useInsideCompany();
  if (inside === undefined) return null;
  return <Navigate to={inside ? "/signin" : "/login"} replace state={{ from: location.pathname + location.search }} />;
}
