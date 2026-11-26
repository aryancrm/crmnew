// The companies' details (the Admin and the CEO): what their papers print at the top and the foot.
// 2MG's are what the quotations print; each company's are the letterhead of HR's papers for the
// people it employs (26 Nov), its registered name always from the company list.

import { COMPANIES, COMPANY_CODES, type CompanyCode } from "@2mg/api/companies";
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
    queryFn: () =>
      api<{ company: CompanyInfo; companies: Record<CompanyCode, CompanyInfo>; points: PointsProgram }>("/api/settings"),
  });
  const [code, setCode] = useState<CompanyCode>("2mg");
  if (!query.data) return <PageState query={query} what="the settings" />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead
        title="Company details"
        sub="Each company's address, TIN and foot line: on its quotations and on HR's papers for the people it employs."
      >
        <div className="flex gap-2" role="tablist">
          {COMPANY_CODES.map((one) => (
            <Button key={one} small variant={one === code ? "primary" : "plain"} role="tab" aria-selected={one === code} onClick={() => setCode(one)}>
              {COMPANIES[one].name}
            </Button>
          ))}
        </div>
      </PageHead>
      <CompanyForm key={code} code={code} start={query.data.companies[code]} />
    </div>
  );
}

function CompanyForm({ code, start }: { code: CompanyCode; start: CompanyInfo }) {
  const [value, setValue] = useState(start);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (await action.run(async () => api(`/api/settings/company?company=${code}`, { body: value }))) {
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
