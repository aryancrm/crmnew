// The navbar's Sign in (/signin). Aryan, 26 Nov: "first the company's ID and password, then that
// company's apps"; 27 Nov: "as it was, every system asks its own sign-in", and "signing out of
// Management should leave that app, not the company". The company's ID (its Admin,
// info@2mginc.com) signs in first; from then on this browser is inside the company: the company's
// name over the old systems grid (Selling, Operations, Office), each system opening its own
// sign-in, and signing out of a system comes back here, not to the company's sign-in. Pressing a
// system while the company's ID is signed in signs it out first. "Sign out of the company" at the
// foot ends it all. Anyone else signing in here goes straight to their own desk. A department's
// own page (/login/<key>) still signs in there directly.

import "@fontsource-variable/inter";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { ME, useMe } from "../auth";
import { useCompany, useInsideCompany } from "../companies";
import { heroLogo } from "../portal/hero-logos";
import { ALL_SYSTEMS } from "../workspaces";
import { SignIn } from "./login";

const GROUPS = [
  { id: "selling", label: "Selling" },
  { id: "operations", label: "Operations" },
  { id: "office", label: "Office" },
] as const;

/** Who sees the systems grid after signing in here: the company's ID (its Admin), once its own
 *  password is chosen. Anyone else goes straight to their own desk, as before. */
export const seesGrid = (me: { role: string; mustChangePassword?: boolean }): boolean =>
  me.role === "admin" && !me.mustChangePassword;

/** Every system opens its own sign-in (Aryan, 27 Nov: Administration and Books too). */
export const tileTo = (key: string): string => `/login/${key}`;

export function ChooseSystem() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const company = useCompany();
  const inside = useInsideCompany();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (me.data && !seesGrid(me.data)) return <Navigate to="/" replace />;
  if (!me.data && inside === undefined) return null;
  // The systems once inside the company: signed in as its ID, or after signing out of a system.
  const grid = Boolean(me.data) || inside === true;

  // Out of the company altogether: the next person starts at "Sign in to your company".
  async function leaveCompany() {
    await api("/api/auth/leave-company", { method: "POST" }).catch(() => undefined);
    await queries.cancelQueries();
    queries.setQueryData(ME, null);
    await queries.invalidateQueries({ queryKey: ["company"] });
    navigate("/signin", { replace: true });
  }

  // A system pressed: the company's ID signs out first, then that system's own sign-in opens.
  async function open(key: string) {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await queries.cancelQueries();
    queries.setQueryData(ME, null);
    navigate(tileTo(key), { replace: true });
    queries.removeQueries({ predicate: (query) => query.queryKey[0] !== ME[0] });
  }

  return (
    <main className="flex min-h-dvh flex-col bg-white font-[Inter_Variable,Inter,sans-serif] text-[#1f2733] lg:h-dvh lg:flex-row lg:overflow-hidden">
      {/* The photo (public/signinimage.png, Aryan 25 Nov), pinned to the top; the logo above, the
          words small at the bottom (Aryan, 25 Nov). */}
      <aside className="relative order-2 flex min-h-[640px] flex-col justify-between gap-6 overflow-hidden bg-[#ff5a00] bg-[url('/signinimage.png')] bg-cover bg-top p-[clamp(1.5rem,3.5vw,3rem)] text-white lg:order-1 lg:min-h-0 lg:w-[45%]">
        <Link to="/login" aria-label="Bishnoi One, home" className="flex min-h-11 w-fit items-center rounded-lg">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10 brightness-0 invert" />
        </Link>
        <div className="max-w-md">
          <h2 className="text-[clamp(1.4rem,2vw,1.9rem)] leading-[1.1] font-semibold tracking-[-0.03em] [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
            One login,
            <br />
            every system.
          </h2>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-white/90 [text-shadow:0_1px_10px_rgba(0,0,0,0.35)]">
            {grid
              ? "Pick the system you work in. Your own login ID and password decide what opens inside."
              : "Sign in with your company's ID or your own. Your login decides which of your company's systems open."}
          </p>
        </div>
      </aside>

      <section aria-labelledby="choose-title" className="order-1 flex flex-1 flex-col px-6 py-5 lg:order-2 lg:overflow-y-auto lg:px-12 lg:py-8">
        <Link to="/login" className="flex min-h-11 w-fit items-center gap-2.5 rounded-lg hover:text-[#c2410c] lg:hidden">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
          <span className="text-[17px] font-semibold tracking-[-0.03em]">Bishnoi One</span>
        </Link>
        <div className="mx-auto w-full max-w-[40rem] pt-8 pb-10 lg:my-auto">
          {!grid ? (
            <div className="mx-auto max-w-[26rem]">
              <SignIn workspace={null} from={from} pickerSlot={null} />
            </div>
          ) : (
            <>
              <h1 id="choose-title" className="text-[clamp(24px,2.4vw,30px)] leading-tight font-semibold tracking-[-0.03em]">
                {company?.name ?? "Your company"}
              </h1>
              <p className="mt-1.5 text-[14px] text-[#5b6472]">Choose the system you want to open.</p>
              <div className="mt-7 grid gap-7">
                {GROUPS.map((group) => (
                  <div key={group.id}>
                    <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#16181d]">{group.label}</h2>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {ALL_SYSTEMS.filter((one) => one.group === group.id).map((one) => (
                        <li key={one.key}>
                          <Link
                            // A system on the way (WorkDrive, Digital Marketing): an empty link for now.
                            to={one.soon ? "#" : tileTo(one.key)}
                            state={location.state}
                            onClick={(event) => {
                              if (one.soon) return event.preventDefault();
                              // The company's ID signs out first; with nobody signed in, straight on.
                              if (!me.data) return;
                              event.preventDefault();
                              void open(one.key);
                            }}
                            className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#fff7f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21]"
                          >
                            <img src={heroLogo(one.key)} alt="" width={36} height={36} className="size-9 shrink-0 object-contain" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14.5px] font-semibold group-hover:text-[#c2410c]">{one.label}</span>
                              <span className="block truncate text-[12.5px] text-[#5b6472]">{one.about}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-8 border-t border-[#eceef3] pt-2 text-[13px] text-[#5b6472]">
                <button
                  type="button"
                  onClick={() => void leaveCompany()}
                  className="inline-flex min-h-11 items-center font-semibold text-[#c2410c] hover:underline"
                >
                  Sign out of the company
                </button>
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
