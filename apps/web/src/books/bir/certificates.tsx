import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { zMoney } from "../kinds";
import { BirCard, BirGuard, BirHeader, downloadBirAsset, useBirCompany } from "./shared";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function BirCertificatesPage() {
  const [company, setCompany] = useBirCompany();
  const [params, setParams] = useSearchParams();
  const [dlError, setDlError] = useState<string | null>(null);

  const year = Number(params.get("year")) || 2026;
  const q = Number(params.get("q")) || 1;
  const monthParam = params.get("month");
  const month = monthParam ? Number(monthParam) : null;
  const supplierId = params.get("supplierId") ?? "";
  const qMonths = [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3];

  const update = (next: Record<string, string | null>, resetMonth = false) => {
    setDlError(null);
    setParams((now) => {
      const out = new URLSearchParams(now);
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") out.delete(k);
        else out.set(k, v);
      }
      if (resetMonth) out.delete("month");
      return out;
    });
  };

  const suppliersQuery = useQuery({
    queryKey: ["books", "bir", "2307-suppliers", company, year, q],
    queryFn: () =>
      api<{ suppliers: { id: string; name: string; tin: string | null; taxCentavos: number }[] }>(
        `/api/books/bir/2307/suppliers?company=${company}&year=${year}&q=${q}`,
      ),
  });

  const selectedSupplier = supplierId || suppliersQuery.data?.suppliers[0]?.id || "";
  const certQuery = useQuery({
    queryKey: ["books", "bir", "2307", company, year, q, month, selectedSupplier],
    queryFn: () =>
      api<{
        period: { label: string };
        certificate: {
          payee: { name: string | null; tin: string | null; address: string | null };
          monthLabels: string[];
          rows: { atc: string; nature: string; rateBp: number; months: [number, number, number]; baseCentavos: number; taxCentavos: number }[];
          totals: { baseCentavos: number; taxCentavos: number };
        };
      }>(`/api/books/bir/2307?company=${company}&year=${year}&q=${q}${month ? `&month=${month}` : ""}&supplierId=${encodeURIComponent(selectedSupplier)}`),
    enabled: Boolean(selectedSupplier),
  });

  const downloadPdf = async () => {
    if (!selectedSupplier) return;
    setDlError(null);
    const url = `/api/books/bir/2307/pdf?company=${company}&year=${year}&q=${q}${month ? `&month=${month}` : ""}&supplierId=${encodeURIComponent(selectedSupplier)}`;
    const err = await downloadBirAsset(url, `2307-${year}-Q${q}.pdf`);
    if (err) setDlError(err);
  };

  return (
    <BirGuard>
      <BirHeader
        title="BIR Form 2307 Certificates"
        subtitle="Quarterly or monthly Certificate of Creditable Tax Withheld at Source per supplier."
        company={company}
        onCompanyChange={setCompany}
        right={
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6c718a]">
              Year
              <select value={year} onChange={(e) => update({ year: e.target.value })} className="h-8 rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                {[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6c718a]">
              Quarter
              <select value={q} onChange={(e) => update({ q: e.target.value }, true)} className="h-8 rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Q{n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6c718a]">
              Month (optional)
              <select value={month ?? ""} onChange={(e) => update({ month: e.target.value || null })} className="h-8 rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                <option value="">Full quarter</option>
                {qMonths.map((m) => (
                  <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[#6c718a]">
              Supplier
              <select value={selectedSupplier} onChange={(e) => update({ supplierId: e.target.value })} className="h-8 max-w-[240px] rounded border border-[#d7d5e2] bg-white px-2 text-[13px] text-[#212529]">
                {(suppliersQuery.data?.suppliers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({zMoney(s.taxCentavos)})</option>
                ))}
              </select>
            </label>
          </div>
        }
      />

      {dlError && <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{dlError}</div>}

      {!selectedSupplier && !suppliersQuery.isPending && (
        <BirCard title="No EWT Certificates in Period">
          <p className="text-[13px] text-[#6c718a]">No supplier bills or expenses with EWT were found for this company and quarter.</p>
        </BirCard>
      )}

      {certQuery.data && (
        <BirCard
          title={`${certQuery.data.certificate.payee.name ?? "Supplier"} — ${certQuery.data.period.label}`}
          right={
            <button type="button" onClick={() => void downloadPdf()} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#408dfb] px-3 text-[12px] font-medium text-white hover:bg-[#2f7ef0]">
              <FileText size={14} /> Download 2307 Official PDF
            </button>
          }
        >
          <div className="mb-3 text-[12px] text-[#6c718a]">
            TIN: {certQuery.data.certificate.payee.tin || "Missing"} · Address: {certQuery.data.certificate.payee.address || "Missing"}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                  <th className="py-2 pr-3">ATC</th>
                  <th className="py-2 pr-3">Nature</th>
                  {certQuery.data.certificate.monthLabels.map((lbl) => (
                    <th key={lbl} className="py-2 pr-3 text-right">{lbl.split(" ")[0]}</th>
                  ))}
                  <th className="py-2 pr-3 text-right">Total Base</th>
                  <th className="py-2 text-right">Tax Withheld</th>
                </tr>
              </thead>
              <tbody>
                {certQuery.data.certificate.rows.map((r) => (
                  <tr key={r.atc} className="border-t border-[#f2f1f7]">
                    <td className="py-1.5 pr-3 font-medium">{r.atc}</td>
                    <td className="py-1.5 pr-3 text-[#555b70]">{r.nature}</td>
                    {r.months.map((m, idx) => (
                      <td key={idx} className="py-1.5 pr-3 text-right tabular-nums">{zMoney(m)}</td>
                    ))}
                    <td className="py-1.5 pr-3 text-right tabular-nums">{zMoney(r.baseCentavos)}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{zMoney(r.taxCentavos)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#21263c] font-semibold">
                  <td colSpan={5} className="py-2 pr-3">Totals</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zMoney(certQuery.data.certificate.totals.baseCentavos)}</td>
                  <td className="py-2 text-right tabular-nums">{zMoney(certQuery.data.certificate.totals.taxCentavos)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </BirCard>
      )}
    </BirGuard>
  );
}
