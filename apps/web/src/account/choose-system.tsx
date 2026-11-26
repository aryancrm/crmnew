// The navbar's Sign in (/signin). Aryan, 26 Nov: "first the company's ID and password, then that
// company's apps": the sign-in comes first (the company's own ID, info@2mginc.com, or a person's
// own), then the company's name with the systems this login may open (the company's ID, its
// Admin, every app; a person with one system goes straight in). The same split screen as a
// department's sign-in: the orange panel on the left. A department's own page (/login/<key>)
// still signs in there directly.

import "@fontsource-variable/inter";
import type { Me } from "@2mg/api/types";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useMe } from "../auth";
import { useCompany } from "../companies";
import { allItems, appsFor } from "../menus";
import { heroLogo } from "../portal/hero-logos";
import { workspaceOf } from "../workspaces";
import { SignIn } from "./login";

type Choice = { key: string; label: string; about: string; to: string; logo?: string; app?: ReturnType<typeof appsFor>[number] };

/** What this login may open in its company: its own desk, Books for those who keep the books, and
 *  for the company's ID (its Admin) and the CEO, every app of the company. */
export function choicesOf(me: Me): Choice[] {
  const own = workspaceOf(me);
  const out: Choice[] = [{ key: own.key, label: own.label, about: own.about, to: "/", logo: heroLogo(own.key) }];
  if (["finance", "ceo", "admin"].includes(me.role))
    out.push({ key: "books", label: "Books", about: "Accounts, banking, reports", to: "/books/home", logo: heroLogo("books") });
  for (const app of appsFor(me)) {
    const first = allItems(app.groups.flatMap((group) => group.items)).find((item) => item.to && item.to !== "/");
    if (first) out.push({ key: app.key, label: app.label, about: "", to: first.to, app });
  }
  return out;
}

export function ChooseSystem() {
  const me = useMe();
  const location = useLocation();
  const company = useCompany();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const choices = me.data ? choicesOf(me.data) : [];
  // One system, or a one-time password to change first (the home asks for it): straight in.
  if (me.data && (choices.length <= 1 || me.data.mustChangePassword)) return <Navigate to="/" replace />;

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
            Sign in with your company's ID or your own. Your login decides which of your company's systems open.
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
              <ul className="mt-7 grid gap-2 sm:grid-cols-2">
                {choices.map((one) => (
                  <li key={one.key}>
                    <Link
                      to={one.to}
                      className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#fff7f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f36b21]"
                    >
                      {one.logo ? (
                        <img src={one.logo} alt="" width={36} height={36} className="size-9 shrink-0 object-contain" />
                      ) : one.app ? (
                        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${one.app.tone}`}>
                          <one.app.icon size={18} aria-hidden="true" />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-semibold group-hover:text-[#c2410c]">{one.label}</span>
                        {one.about && <span className="block truncate text-[12.5px] text-[#5b6472]">{one.about}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
