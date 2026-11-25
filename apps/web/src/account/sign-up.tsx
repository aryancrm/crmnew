// Sign up (/signup, /signup/<department>), in the sign-in page's split layout: asks for an account. No password here: the acceptance
// email's link sets it (the API's account/sign-up.ts says why).

import { CircleCheck, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAction } from "../ui";
import { type Workspace, WORKSPACES } from "../workspaces";
import { Alert, Heading, Labelled, MAIN_BUTTON, Select, SplitPage, TextField } from "./public-page";

const DEPARTMENTS = WORKSPACES.filter((one) => !["ceo", "admin", "books"].includes(one.key));
const SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV", "V"];
/** A Philippine mobile number as it is typed: digits only, 11 at most, shown as 0917 555 0101.
 *  A +63 or 63 in front becomes the 0 (so a pasted +63 917 555 0101 still fits). */
function phMobile(typed: string) {
  let digits = typed.replace(/\D/g, "");
  if (digits.startsWith("63")) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith("9")) digits = `0${digits}`;
  digits = digits.slice(0, 11);
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)].filter(Boolean).join(" ");
}

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

  // The collage shows the department picked in the form (MedReps until one is).
  const shownDept = (DEPARTMENTS.find((one) => one.key === form.department) ?? asked ?? DEPARTMENTS[0]) as Workspace;

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
      <SplitPage aside={signIn} workspace={shownDept} join>
        <div role="status">
          <CircleCheck className="mb-4 size-10 text-[#1f9d55]" aria-hidden="true" />
          <Heading title="Request sent">Your account can't be used yet.</Heading>
          <ol className="mt-5 grid list-decimal gap-2 pl-5 text-[14px]">
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
      </SplitPage>
    );

  return (
    <SplitPage aside={signIn} workspace={shownDept} join>
      <Heading title="Create your account">
        For 2MG and GetMeds staff. An administrator confirms it, then emails you a link to set your password.
      </Heading>
      <form onSubmit={submit} noValidate className="mt-5 grid gap-3">
        <div className="grid grid-cols-2 items-start gap-3">
          <TextField label="First name" autoComplete="given-name" maxLength={60} required placeholder="Juan" {...field("firstName")} />
          <TextField label="Middle name (optional)" autoComplete="additional-name" maxLength={60} placeholder="Santos" {...field("middleName")} />
          <TextField label="Last name" autoComplete="family-name" maxLength={60} required placeholder="Dela Cruz" {...field("lastName")} />
          <Labelled label="Suffix (optional)" error={field("suffix").error}>
            {(props) => (
              <Select {...props} autoComplete="honorific-suffix" value={form.suffix} onChange={(event) => field("suffix").onValue(event.target.value)}>
                <option value="">None</option>
                {SUFFIXES.map((one) => (
                  <option key={one}>{one}</option>
                ))}
              </Select>
            )}
          </Labelled>
        </div>
        <TextField label="Email" type="email" autoComplete="email" maxLength={120} required placeholder="you@example.com" {...field("email")} />
        <div className="grid grid-cols-2 items-start gap-3">
          <TextField
            label="Mobile number"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={13}
            required
            placeholder="0917 555 0101"
            {...field("phone")}
            onValue={(value) => field("phone").onValue(phMobile(value))}
          />
          <Labelled label="Department" error={field("department").error}>
            {(props) => (
              <Select {...props} required value={form.department} onChange={(event) => field("department").onValue(event.target.value)}>
                <option value="">Pick one</option>
                {DEPARTMENTS.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.label}
                  </option>
                ))}
              </Select>
            )}
          </Labelled>
        </div>
        <Alert message={action.general(FIELDS)} />
        <button type="submit" disabled={action.busy} className={`${MAIN_BUTTON} mt-2`}>
          {action.busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {action.busy ? "Sending…" : "Sign up"}
        </button>
      </form>
    </SplitPage>
  );
}
