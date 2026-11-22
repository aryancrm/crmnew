// Sign up (/signup, /signup/<department>): asks for an account. No password here: the acceptance
// email's link sets it (the API's account/sign-up.ts says why).

import { CircleCheck, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAction } from "../ui";
import { WORKSPACES } from "../workspaces";
import { Alert, CONTROL, Heading, Labelled, MAIN_BUTTON, PublicPage, TextField } from "./public-page";

const DEPARTMENTS = WORKSPACES.filter((one) => !["ceo", "admin", "books"].includes(one.key));
const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV", "V"];
const FIELDS = ["firstName", "middleName", "lastName", "suffix", "email", "phone", "department"];

export function SignUp() {
  const { dept } = useParams();
  const asked = DEPARTMENTS.find((one) => one.key === dept?.toLowerCase());
  const action = useAction();
  const [sent, setSent] = useState(false);
  // A field being put right stops saying what was wrong with it.
  const [edited, setEdited] = useState<string[]>([]);
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    email: "",
    phone: "",
    department: asked?.key ?? "",
  });
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onValue: (value: string) => {
      setForm((now) => ({ ...now, [key]: value }));
      setEdited((now) => (now.includes(key) ? now : [...now, key]));
    },
    error: edited.includes(key) ? undefined : action.at(key),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setEdited([]);
    const done = await action.run(async () => {
      await api("/api/auth/sign-up", {
        body: { ...form, middleName: form.middleName || null, suffix: form.suffix || null },
      });
    });
    if (done) {
      setSent(true);
      window.scrollTo({ top: 0 });
    }
  }

  const signIn = (
    <p className="text-[13px] text-[#5b6472]">
      Have an account?{" "}
      <Link
        to={asked ? `/login/${asked.key}` : "/login"}
        className="inline-flex min-h-11 items-center font-semibold text-[#c2410c] hover:underline"
      >
        Sign in
      </Link>
    </p>
  );

  if (sent)
    return (
      <PublicPage aside={signIn}>
        <div role="status">
          <CircleCheck className="mb-4 size-10 text-[#1f9d55]" aria-hidden="true" />
          <Heading title="Request sent">Your account can't be used yet.</Heading>
          <ol className="mt-5 grid list-decimal gap-2 pl-5 text-[15px]">
            <li>An administrator confirms who you are.</li>
            <li>
              When you're accepted, an email goes to <b className="font-semibold break-all">{form.email}</b>.
            </li>
            <li>Its link lets you set your password and sign in.</li>
          </ol>
          <p className="mt-5 border-t border-[#eceef3] pt-4 text-[13px] text-[#5b6472]">
            Nothing after a day or two? Check your spam folder, then ask HR or your administrator.
          </p>
        </div>
      </PublicPage>
    );

  return (
    <PublicPage aside={signIn}>
      <Heading title="Create your account">
        For 2MG and GetMeds staff. An administrator confirms it, then emails you.
      </Heading>
      <form onSubmit={submit} noValidate className="mt-6 grid gap-4">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <TextField label="First name" autoComplete="given-name" maxLength={60} required {...field("firstName")} />
          <TextField label="Middle name (optional)" autoComplete="additional-name" maxLength={60} {...field("middleName")} />
          <TextField label="Last name" autoComplete="family-name" maxLength={60} required {...field("lastName")} />
          <Labelled label="Suffix (optional)" error={field("suffix").error}>
            {(props) => (
              <select
                {...props}
                autoComplete="honorific-suffix"
                value={form.suffix}
                onChange={(event) => field("suffix").onValue(event.target.value)}
                className={CONTROL}
              >
                <option value="">None</option>
                {SUFFIXES.map((one) => (
                  <option key={one}>{one}</option>
                ))}
              </select>
            )}
          </Labelled>
        </div>
        <TextField label="Email" type="email" autoComplete="email" maxLength={120} required placeholder="you@example.com" {...field("email")} />
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <TextField label="Mobile number" type="tel" autoComplete="tel" maxLength={30} required placeholder="0917 555 0101" {...field("phone")} />
          <Labelled label="Department" error={field("department").error}>
            {(props) => (
              <select
                {...props}
                required
                value={form.department}
                onChange={(event) => field("department").onValue(event.target.value)}
                className={CONTROL}
              >
                <option value="">Pick your department</option>
                {DEPARTMENTS.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.label}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
        </div>
        <Alert message={action.general(FIELDS)} />
        <button type="submit" disabled={action.busy} className={`${MAIN_BUTTON} mt-2`}>
          {action.busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {action.busy ? "Sending…" : "Sign up"}
        </button>
        <p className="text-[13px] text-[#5b6472]">You set your password from the email, once you're accepted.</p>
      </form>
    </PublicPage>
  );
}
