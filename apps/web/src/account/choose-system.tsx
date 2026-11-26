// The navbar's Sign in (/signin, Aryan 25 Nov): first the choice of system, then that system's
// sign-in (/login/<key>). The same split screen as a department's sign-in: the orange panel on the
// left, the systems to pick from on the right, by group. Phones: the systems first.

import "@fontsource-variable/inter";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useMe } from "../auth";
import { heroLogo } from "../portal/hero-logos";
import { ALL_SYSTEMS } from "../workspaces";

const GROUPS = [
  { id: "selling", label: "Selling" },
  { id: "operations", label: "Operations" },
  { id: "office", label: "Office" },
] as const;

export function ChooseSystem() {
  const me = useMe();
  const location = useLocation();
  if (me.data) return <Navigate to="/" replace />;

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
            Pick the system you work in. Your own login ID and password decide what opens inside.
          </p>
        </div>
      </aside>

      <section aria-labelledby="choose-title" className="order-1 flex flex-1 flex-col px-6 py-5 lg:order-2 lg:overflow-y-auto lg:px-12 lg:py-8">
        <Link to="/login" className="flex min-h-11 w-fit items-center gap-2.5 rounded-lg hover:text-[#c2410c] lg:hidden">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
          <span className="text-[17px] font-semibold tracking-[-0.03em]">Bishnoi One</span>
        </Link>
        <div className="mx-auto w-full max-w-[40rem] pt-8 pb-10 lg:my-auto">
          <h1 id="choose-title" className="text-[clamp(24px,2.4vw,30px)] leading-tight font-semibold tracking-[-0.03em]">
            Sign in
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
                        // A system on the way: an empty link for now.
                        to={one.soon ? "#" : `/login/${one.key}`}
                        onClick={one.soon ? (event) => event.preventDefault() : undefined}
                        state={location.state}
                        className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#fff7f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21]"
                      >
                        <img src={heroLogo(one.key)} alt="" width={36} height={36} className="size-9 shrink-0 object-contain" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-semibold group-hover:text-[#c2410c]">{one.label}</span>
                          <span className="block truncate text-[12.5px] text-[#5b6472]">{one.about}</span>
                        </span>                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-8 border-t border-[#eceef3] pt-4 text-[13px] text-[#5b6472]">
            No account yet?{" "}
            <Link to="/signup" className="inline-flex min-h-11 items-center font-semibold text-[#c2410c] hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
