import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { BirCard, BirGuard, BirHeader, useBirCompany } from "./shared";

type Profile = {
  company: "2mg" | "gpi";
  registeredName: string;
  tradeName: string;
  tin: string | null;
  branchCode: string;
  rdoCode: string | null;
  address: string | null;
  regime: "vat" | "non_vat";
  fiscalMonthEnd: number;
  isTamp: boolean;
};

type SettingsResponse = {
  profiles: Profile[];
  atcs: { code: string; description: string; rateBp: number; category: string; birForm: string }[];
  accountMap: { company: "2mg" | "gpi"; roleKey: string; accountName: string }[];
};

export function BirSettingsPage() {
  const [company, setCompany] = useBirCompany();
  const queries = useQueryClient();
  const query = useQuery({
    queryKey: ["books", "bir", "settings"],
    queryFn: () => api<SettingsResponse>("/api/books/bir/settings"),
  });

  const activeProfile = query.data?.profiles.find((p) => p.company === company);
  const [form, setForm] = useState<Profile | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeProfile) setForm(activeProfile);
  }, [activeProfile?.company, activeProfile?.registeredName, activeProfile?.tin]);

  const saveProfile = useMutation({
    mutationFn: () => api("/api/books/bir/settings/profile", { method: "POST", body: form }),
    onSuccess: () => {
      setSavedMsg("Taxpayer profile saved.");
      void queries.invalidateQueries({ queryKey: ["books", "bir"] });
    },
  });

  const seedCoa = useMutation({
    mutationFn: () => api<{ added: number; totalActive: number; totalInactive: number }>("/api/books/bir/settings/seed-coa", { method: "POST", body: {} }),
    onSuccess: (res) => {
      setSavedMsg(`Starter chart ready: ${res.added} missing accounts added (${res.totalActive} active, ${res.totalInactive} inactive).`);
      void queries.invalidateQueries({ queryKey: ["books"] });
      void queries.invalidateQueries({ queryKey: ["finance", "money-accounts"] });
    },
  });

  const companyMaps = (query.data?.accountMap ?? []).filter((m) => m.company === company);

  return (
    <BirGuard>
      <BirHeader
        title="BIR Taxpayer Profile, ATC Catalog & Account Map"
        subtitle="Manage separate BIR registration details (TIN, RDO, branch code) and GL account mappings per company."
        company={company}
        onCompanyChange={setCompany}
      />

      {savedMsg && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{savedMsg}</div>}

      <div className="space-y-5">
        {form && (
          <BirCard title="Registered Taxpayer Identity">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Registered Name" value={form.registeredName} onChange={(v) => setForm({ ...form, registeredName: v })} />
              <Field label="Trade Name" value={form.tradeName} onChange={(v) => setForm({ ...form, tradeName: v })} />
              <Field label="9-Digit TIN" value={form.tin ?? ""} placeholder="000000000" onChange={(v) => setForm({ ...form, tin: v })} />
              <Field label="5-Digit Branch Code" value={form.branchCode} placeholder="00000" onChange={(v) => setForm({ ...form, branchCode: v })} />
              <Field label="RDO Code" value={form.rdoCode ?? ""} placeholder="053" onChange={(v) => setForm({ ...form, rdoCode: v })} />
              <label className="flex flex-col gap-1 text-[12px] text-[#6c718a]">
                Tax Regime
                <select value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value as "vat" | "non_vat" })} className="h-9 rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                  <option value="vat">VAT-Registered (2550Q)</option>
                  <option value="non_vat">Non-VAT (2551Q)</option>
                </select>
              </label>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Registered Address" value={form.address ?? ""} onChange={(v) => setForm({ ...form, address: v })} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={form.isTamp} onChange={(e) => setForm({ ...form, isTamp: e.target.checked })} />
                Top Withholding Agent (TAMP — enables 1% goods / 2% services audit)
              </label>
              <button type="button" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending} className="h-9 rounded bg-[#408dfb] px-4 text-[13px] font-medium text-white hover:bg-[#2f7ef0]">
                {saveProfile.isPending ? "Saving…" : "Save Taxpayer Profile"}
              </button>
            </div>
          </BirCard>
        )}

        <BirCard
          title="Company GL & Intercompany Account Mapping"
          right={
            <button
              type="button"
              onClick={() => seedCoa.mutate()}
              disabled={seedCoa.isPending}
              className="h-8 rounded border border-[#d7d5e2] bg-white px-3 text-[12px] font-medium text-[#1c5bd9] hover:bg-[#f1f1fa]"
            >
              {seedCoa.isPending ? "Seeding…" : "Seed Starter Chart of Accounts"}
            </button>
          }
        >
          <p className="mb-3 text-[12px] text-[#6c718a]">
            Includes <strong>Advances to GPI</strong> clearing, <strong>Retention Receivable</strong>, <strong>Bank Fees and Charges</strong>, and active/inactive segregation in Chart of Accounts.
          </p>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                <th className="py-2 pr-3">Logical Role</th>
                <th className="py-2">Mapped Chart Account</th>
              </tr>
            </thead>
            <tbody>
              {companyMaps.map((m) => (
                <tr key={m.roleKey} className="border-t border-[#f2f1f7]">
                  <td className="py-1.5 pr-3 font-mono text-[12px] text-[#6c718a]">{m.roleKey}</td>
                  <td className="py-1.5 font-medium text-[#212529]">{m.accountName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </BirCard>

        <BirCard title={`Seeded BIR ATC Directory (${query.data?.atcs.length ?? 0} codes)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                  <th className="py-2 pr-3">ATC</th>
                  <th className="py-2 pr-3">Form</th>
                  <th className="py-2 pr-3 text-right">Rate</th>
                  <th className="py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {(query.data?.atcs ?? []).map((a) => (
                  <tr key={a.code} className="border-t border-[#f2f1f7]">
                    <td className="py-1.5 pr-3 font-medium">{a.code}</td>
                    <td className="py-1.5 pr-3 text-[#6c718a]">{a.birForm}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{a.rateBp / 100}%</td>
                    <td className="py-1.5 text-[#555b70]">{a.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BirCard>
      </div>
    </BirGuard>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (next: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-[#6c718a]">
      {label}
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-9 rounded border border-[#d7d5e2] px-2.5 text-[13px] text-[#212529]" />
    </label>
  );
}
