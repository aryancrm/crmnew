// The navbar's Sign in (/signin). Aryan, 26 Nov: "first the company's ID and password, then that
// company's apps"; 27 Nov: "as it was, every system asks its own sign-in". The company's ID (its
// Admin, info@2mginc.com) signs in first; then the company's name over the old systems grid
// (Selling, Operations, Office). Pressing any system, Administration and Books too, signs the
// company's ID out and opens that system's own sign-in, where the person working there signs in
// with their own login ID; the browser keeps the company, so "fin1" is this company's. Anyone
// else signing in here goes straight to their own desk. A department's own page (/login/<key>)
// still signs in there directly.

import "@fontsource-variable/inter";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { ME, useMe } from "../auth";
import { useCompany } from "../companies";
import { heroLogo } from "../portal/hero-logos";
import { WORKSPACES } from "../workspaces";
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
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (me.data && !seesGrid(me.data)) return <Navigate to="/" replace />;

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
            {me.data
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
          {!me.data ? (
            <div className="mx-auto max-w-[26rem]">
              <SignIn workspace={null} from={from} pickerSlot={null} />
            </div>
          ) : (
            <>
              <h1 id="choose-title" className="text-[clamp(24px,2.4vw,30px)] leading-tight font-semibold tracking-[-0.03em]">
                {company?.name ?? "Your company"}
              </h1>
              <p className="mt-1.5 text-[14px] text-[#5b6472]">
                Signed in as {me.data.name}. Choose the system you want to open.
              </p>
              <div className="mt-7 grid gap-7">
                {GROUPS.map((group) => (
                  <div key={group.id}>
                    <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#16181d]">{group.label}</h2>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {WORKSPACES.filter((one) => one.group === group.id).map((one) => (
                        <li key={one.key}>
                          <Link
                            to={tileTo(one.key)}
                            onClick={(event) => {
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
            </>
          )}
        </div>
      </section>
    </main>
  );
}
