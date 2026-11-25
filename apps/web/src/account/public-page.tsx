// The pages anyone can open besides the sign-in (Sign up, the acceptance's welcome): the portal's
// look, one form in the middle.

import "@fontsource-variable/inter";
import { ChevronDown, CircleAlert } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from "react";
import { DepartmentCollage } from "../portal/department-collage";
import { JoinCollage } from "../portal/join-collage";
import type { Workspace } from "../workspaces";
import { Link } from "react-router-dom";

// The sign-in page's look (Aryan, 24 Nov): compact fields with rounded corners and an orange ring
// when picked, no shadows, and a flat orange pill button.
export const CONTROL =
  "h-10 w-full min-w-0 rounded-md border border-[#d5d9e1] bg-white px-4 text-[13.5px] text-[#1f2733] shadow-none outline-none transition-[border-color,outline-color] placeholder:text-[#6b7380] hover:border-[#b9bfcb] focus:border-[#f36b21] focus:outline-solid! focus:outline-2! focus:outline-offset-2! focus:outline-[#f36b21]! aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus:outline-rose-500!";
export const MAIN_BUTTON =
  "flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#f36b21] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#e05a12] disabled:cursor-wait disabled:opacity-70";
const LABEL = "text-[12px] font-semibold text-[#1f2733]";

export function PublicPage({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-[#f6f7fb] font-[Inter_Variable,Inter,sans-serif] text-[#1f2733]">
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-6">
        <Link to="/login" className="flex min-h-11 items-center gap-2.5 rounded-lg hover:text-[#c2410c]">
          <img src="/brand/bishnoi-one-mark.png" alt="" className="size-8" />
          <span className="text-[18px] font-semibold tracking-[-0.03em] whitespace-nowrap">Bishnoi One</span>
        </Link>
        {aside}
      </header>
      <div className="flex flex-1 justify-center px-4 pt-4 pb-12 sm:items-center">
        <div className="h-fit w-full max-w-xl rounded-2xl border border-[#e4e7ee] bg-white p-5 sm:p-8">{children}</div>
      </div>
    </main>
  );
}

/** The sign-in page's split (Aryan, 24 Nov): the department's collage on the left, the form alone on
 *  white on the right, fitting the window. Phones: the form, then the collage. */
export function SplitPage({
  children,
  aside,
  workspace,
  join = false,
}: { children: ReactNode; aside?: ReactNode; workspace: Workspace; join?: boolean }) {
  const mark = (
    <Link to="/login" aria-label="Bishnoi One, home" className="hidden min-h-11 items-center rounded-lg lg:flex">
      <img src="/brand/bishnoi-one-mark.png" alt="" className="size-10 brightness-0 invert" />
    </Link>
  );
  return (
    <main className="flex min-h-dvh flex-col bg-white font-[Inter_Variable,Inter,sans-serif] text-[#1f2733] lg:h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="relative order-2 h-[620px] lg:order-1 lg:h-auto lg:w-[50%]">
        {/* Sign up shows the joining cards; other pages the department's own. */}
        {join ? <JoinCollage brand={mark} /> : <DepartmentCollage workspace={workspace} brand={mark} />}
      </aside>
      <section className="order-1 flex flex-1 flex-col px-6 py-5 lg:order-2 lg:px-12 lg:py-8 lg:[@media(max-height:680px)]:py-4">
        <div className="flex items-center justify-between gap-3">
          <Link to="/login" className="flex min-h-11 items-center gap-2.5 rounded-lg hover:text-[#c2410c] lg:invisible">
            <img src="/brand/bishnoi-one-mark.png" alt="" className="size-7" />
            <span className="text-[17px] font-semibold tracking-[-0.03em]">Bishnoi One</span>
          </Link>
          {aside}
        </div>
        <div className="flex flex-1 justify-center pt-8 pb-10 lg:items-center lg:py-4">
          {/* Short windows: the line under the heading goes and the gaps tighten, so every field stays
              in view without scrolling. */}
          <div className="w-full max-w-[22rem] lg:[@media(max-height:680px)]:[&_form]:gap-2.5 lg:[@media(max-height:680px)]:[&_h1+p]:hidden">
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="text-[clamp(24px,2.4vw,28px)] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
      {children && <p className="mt-1.5 text-[14px] text-[#5b6472]">{children}</p>}
    </>
  );
}

export function Alert({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-[13px] text-rose-700">
      <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" /> {message}
    </p>
  );
}

export function Labelled({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children({ id, ...(error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {}) })}
      <Alert id={`${id}-error`} message={error} />
    </div>
  );
}

export function TextField({
  label,
  error,
  value,
  onValue,
  ...more
}: {
  label: string;
  error?: string;
  value: string;
  onValue: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <Labelled label={label} error={error}>
      {(props) => <input {...more} {...props} value={value} onChange={(event) => onValue(event.target.value)} className={CONTROL} />}
    </Labelled>
  );
}

/** A dropdown in the same pill, its own arrow set in from the right edge (the browser's sits on it). */
export function Select({ children, className = "", ...more }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block min-w-0">
      <select {...more} className={`${CONTROL} cursor-pointer appearance-none pr-11 ${className}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-[#6b7380]" aria-hidden="true" />
    </span>
  );
}
