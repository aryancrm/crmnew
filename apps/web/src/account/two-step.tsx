// Two-step sign-in's dialogs, as Bishnoi One's: set up (password, QR code, first code, recovery
// codes shown once), turn off, new recovery codes, and the Admin's reset of someone's.

import { Check, Copy, Download } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { useMe } from "../auth";
import { Button, Dialog, Field, Problem, useAction } from "../ui";
import { QrCode } from "./qr";

function Buttons({ busy, label, onClose, danger }: { busy: boolean; label: string; onClose: () => void; danger?: boolean }) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
      <Button disabled={busy} onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy}>
        {busy ? "Checking…" : label}
      </Button>
    </div>
  );
}

function Password({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <Field label="Your password" error={error}>
      {(props) => (
        <input
          {...props}
          type="password"
          autoComplete="current-password"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="field"
        />
      )}
    </Field>
  );
}

function Code({
  value,
  onChange,
  error,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label} error={error}>
      {(props) => (
        <input
          {...props}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          // biome-ignore lint/a11y/noAutofocus: the step just asked for it
          autoFocus={autoFocus}
          maxLength={24}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="field font-mono"
        />
      )}
    </Field>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Bishnoi One CRM recovery codes\nEach works once, in place of the code from your app.\n\n${codes.join("\n")}\n`;

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bishnoi-one-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg bg-warn-tint px-3 py-2.5 text-warn">
        These are shown only now. If you lose your phone, one of them signs you in. Each works once.
      </p>
      <ul className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-sm select-all sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            navigator.clipboard
              ?.writeText(text)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button onClick={download}>
          <Download size={16} /> Download
        </Button>
      </div>
      <label className="flex min-h-11 items-center gap-2.5">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="size-4 accent-brand" />
        I saved these codes somewhere safe
      </label>
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function SetUpTwoStep({ onClose }: { onClose: () => void }) {
  const action = useAction();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ key: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  function start(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      setSetup(await api("/api/auth/two-step/start", { body: { password } }));
      setPassword("");
    });
  }
  function confirm(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      setCodes((await api<{ codes: string[] }>("/api/auth/two-step/confirm", { body: { code } })).codes);
    });
  }

  const step = codes ? 3 : setup ? 2 : 1;
  const title = ["Set up two-step sign-in", "Scan the QR code", "Save your recovery codes"][step - 1] as string;
  return (
    // The codes can't be closed away unread: Done closes them.
    <Dialog title={title} sub={`Step ${step} of 3`} onClose={onClose} busy={action.busy || step === 3}>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={onClose} />
      ) : setup ? (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <QrCode text={setup.uri} label="QR code to add Bishnoi One CRM to your authenticator app" />
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-slate-700">
              <li>Open Google Authenticator, Microsoft Authenticator or 1Password on your phone.</li>
              <li>Add an account and scan this code.</li>
              <li>Type the six digits it shows below.</li>
            </ol>
          </div>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer py-1 font-semibold">Can't scan it?</summary>
            <p className="mt-1">
              Type this key into the app:{" "}
              <span className="font-mono break-all text-ink select-all">{setup.key.replace(/(.{4})(?=.)/g, "$1 ")}</span>
            </p>
          </details>
          <Code label="Six-digit code" value={code} onChange={setCode} error={action.at("code")} autoFocus />
          <Problem message={action.general(["code"])} />
          <Buttons busy={action.busy} label="Turn on" onClose={onClose} />
        </form>
      ) : (
        <form onSubmit={start} className="flex flex-col gap-4">
          <p className="text-slate-700">
            After your password, signing in will ask for a code from an app on your phone, so a stolen password alone
            can't open your account. Your other devices will be signed out.
          </p>
          <Password value={password} onChange={setPassword} error={action.at("password")} />
          <Problem message={action.general(["password"])} />
          <Buttons busy={action.busy} label="Continue" onClose={onClose} />
        </form>
      )}
    </Dialog>
  );
}

export function TurnOffTwoStep({ onClose }: { onClose: () => void }) {
  const action = useAction();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api("/api/auth/two-step/off", { body: { password, code } });
    });
    if (done) onClose();
  }
  return (
    <Dialog title="Turn off two-step sign-in" sub="Your password alone will sign you in." onClose={onClose} busy={action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Password value={password} onChange={setPassword} error={action.at("password")} />
        <Code label="Code from your app, or a recovery code" value={code} onChange={setCode} error={action.at("code")} />
        <Problem message={action.general(["password", "code"])} />
        <Buttons busy={action.busy} label="Turn off" onClose={onClose} danger />
      </form>
    </Dialog>
  );
}

export function NewRecoveryCodes({ onClose }: { onClose: () => void }) {
  const action = useAction();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      setCodes((await api<{ codes: string[] }>("/api/auth/two-step/recovery", { body: { password, code } })).codes);
    });
  }
  return (
    <Dialog
      title={codes ? "Save your recovery codes" : "Make new recovery codes"}
      sub={codes ? undefined : "The old ones stop working."}
      onClose={onClose}
      busy={action.busy || codes !== null}
    >
      {codes ? (
        <RecoveryCodes codes={codes} onDone={onClose} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Password value={password} onChange={setPassword} error={action.at("password")} />
          <Code label="Code from your app, or a recovery code" value={code} onChange={setCode} error={action.at("code")} />
          <Problem message={action.general(["password", "code"])} />
          <Buttons busy={action.busy} label="Make new codes" onClose={onClose} />
        </form>
      )}
    </Dialog>
  );
}

/** The Admin's, for someone who lost their phone and has no recovery code left. */
export function ResetTwoStep({ person, onClose }: { person: { id: number; name: string }; onClose: () => void }) {
  const me = useMe().data;
  const action = useAction();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(`/api/auth/two-step/reset/${person.id}`, { body: { password, code: code || null } });
    });
    if (done) onClose();
  }
  return (
    <Dialog
      title={`Reset ${person.name}'s two-step sign-in`}
      sub="Only when they lost their phone and their recovery codes."
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="rounded-lg bg-warn-tint px-3 py-2.5 text-warn">
          Make sure it is really them, in person or on a call. They are signed out everywhere and told it was reset.
        </p>
        <Password value={password} onChange={setPassword} error={action.at("password")} />
        {me?.twoStep && (
          <Code label="Code from your own app" value={code} onChange={setCode} error={action.at("code")} />
        )}
        <Problem message={action.general(me?.twoStep ? ["password", "code"] : ["password"])} />
        <Buttons busy={action.busy} label="Reset" onClose={onClose} danger />
      </form>
    </Dialog>
  );
}
