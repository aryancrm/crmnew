// The pages anyone can open besides the sign-in (Sign up, the acceptance's welcome): the portal's
// look, one form in the middle.

import "@fontsource-variable/inter";
import { CircleAlert } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { Link } from "react-router-dom";

export const CONTROL =
  "h-12 w-full min-w-0 rounded-xl border border-[#d5d9e1] bg-white px-3.5 text-[15px] text-[#1f2733] outline-none transition-[border-color,box-shadow] placeholder:text-[#6b7380] hover:border-[#b9bfcb] focus:border-[#f36b21] focus:ring-4 focus:ring-[#f36b21]/15 aria-[invalid=true]:border-rose-500";
export const MAIN_BUTTON =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f36b21] px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#e05a12] disabled:cursor-wait disabled:opacity-70";
const LABEL = "text-[13px] font-semibold text-[#1f2733]";

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

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
      {children && <p className="mt-2 text-[15px] text-[#5b6472]">{children}</p>}
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
    <div className="grid min-w-0 gap-1.5">
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
