// The company's details (the Admin and the CEO): what its quotations print at the top and the foot.

import type { CompanyInfo, PointsProgram } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { Button, Field, INPUT, PageHead, PageState, Problem, useAction } from "../ui";

const FIELDS: { key: Exclude<keyof CompanyInfo, "vat">; label: string; wide?: boolean }[] = [
  { key: "name", label: "Company name" },
  { key: "tin", label: "TIN" },
  { key: "address", label: "Address", wide: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "licence", label: "FDA licence (LTO)" },
  { key: "footer", label: "Line at the foot of every page", wide: true },
  { key: "signatory", label: "Signs the quotations" },
  { key: "signatoryTitle", label: "Their title" },
];

export function SettingsPage() {
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ company: CompanyInfo; points: PointsProgram }>("/api/settings"),
  });
  if (!query.data) return <PageState query={query} what="the settings" />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Company details" />
      <CompanyForm start={query.data.company} />
    </div>
  );
}

function CompanyForm({ start }: { start: CompanyInfo }) {
  const [value, setValue] = useState(start);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (await action.run(async () => api("/api/settings/company", { body: value }))) {
      setSaved(true);
      await queries.invalidateQueries({ queryKey: ["settings"] });
    }
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.wide ? "sm:col-span-2" : ""}>
            <Field label={field.label} error={action.at(field.key)}>
              {(props) => (
                <input
                  {...props}
                  className={INPUT}
                  value={value[field.key]}
                  onChange={(event) => setValue({ ...value, [field.key]: event.target.value })}
                />
              )}
            </Field>
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.vat}
            onChange={(event) => setValue({ ...value, vat: event.target.checked })}
          />{" "}
          VAT-registered
        </label>
      </div>
      <div className="mt-3">
        <Problem message={action.general(FIELDS.map((field) => field.key))} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="primary" small disabled={action.busy}>
          {action.busy ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-[13px] font-medium text-emerald-700">Saved.</span>}
      </div>
    </form>
  );
}
