import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { zMoney } from "../kinds";
import { BirCard, BirGuard, BirHeader, useBirCompany } from "./shared";

type ReadinessResponse = {
  company: "2mg" | "gpi";
  from: string;
  to: string;
  taxListsSummary: {
    outputVatCentavos: number;
    inputVatCentavos: number;
    ewtWithheldCentavos: number;
    cwtWithheldCentavos: number;
  };
  consolidatedLedgerReference: {
    note: string;
    taxPayableNetCentavos: number;
    advanceTaxNetCentavos: number;
    ewtPayableNetCentavos: number;
  };
  alerts: { key: string; severity: "warn" | "info"; title: string; count: number; detail: string }[];
  untaggedDocs: { id: number; kind: string; number: string; date: string; total: number }[];
  missingWithholdingDocs: { id: number; kind: string; number: string; date: string; supplier: string; netCentavos: number }[];
  tampAudit: {
    status: "ok" | "review";
    unwithheldCount: number;
    unwithheldTotalCentavos: number;
    suppliers: { supplierId: string; name: string; tin: string | null; origin: string; netCentavos: number; ewtCentavos: number; purchases: number }[];
    note: string;
  };
};

const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

export function BirReadinessPage() {
  const [company, setCompany] = useBirCompany();
  const [params, setParams] = useSearchParams();
  const today = todayManila();
  const qStart = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const from = params.get("from") ?? qStart;
  const to = params.get("to") ?? today;

  const setRange = (next: { from?: string; to?: string }) => {
    setParams((now) => {
      const out = new URLSearchParams(now);
      if (next.from) out.set("from", next.from);
      if (next.to) out.set("to", next.to);
      return out;
    });
  };

  const query = useQuery({
    queryKey: ["books", "bir", "readiness", company, from, to],
    queryFn: () => api<ReadinessResponse>(`/api/books/bir/readiness?company=${company}&from=${from}&to=${to}`),
  });

  return (
    <BirGuard>
      <BirHeader
        title="BIR Readiness & TAMP Audit"
        subtitle="Checks tax lists, missing TINs/ATCs, untagged company records, and Top Withholding Agent (TAMP) EWT coverage."
        company={company}
        onCompanyChange={setCompany}
        right={
          <div className="flex items-center gap-2 text-[12px]">
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setRange({ from: e.target.value })} className="h-8 rounded border border-[#d7d5e2] px-2" aria-label="From date" />
            <span className="text-[#6c718a]">to</span>
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setRange({ to: e.target.value })} className="h-8 rounded border border-[#d7d5e2] px-2" aria-label="To date" />
          </div>
        }
      />

      {query.isPending && <p className="text-[13px] text-[#6c718a]">Checking BIR readiness…</p>}
      {query.isError && <p className="text-[13px] text-[#d9534f]">{(query.error as Error).message}</p>}

      {query.data && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Output VAT (Sales + Returns)" value={zMoney(query.data.taxListsSummary.outputVatCentavos)} />
            <StatCard label="Input VAT (SLP Purchases)" value={zMoney(query.data.taxListsSummary.inputVatCentavos)} />
            <StatCard label="Supplier EWT Withheld (QAP)" value={zMoney(query.data.taxListsSummary.ewtWithheldCentavos)} />
            <StatCard label="Customer CWT / 2307 (SAWT)" value={zMoney(query.data.taxListsSummary.cwtWithheldCentavos)} />
          </div>

          <BirCard title="Readiness Alerts & Upstream Blockers">
            {query.data.alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-emerald-700">
                <CheckCircle2 size={16} /> No missing TINs, untagged company docs, or legacy purchase alerts in this period.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {query.data.alerts.map((a) => (
                  <li key={a.key} className={`flex items-start gap-2.5 rounded-md border p-3 text-[13px] ${a.severity === "warn" ? "border-amber-200 bg-amber-50/70" : "border-sky-200 bg-sky-50/70"}`}>
                    {a.severity === "warn" ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" /> : <Info size={16} className="mt-0.5 shrink-0 text-sky-600" />}
                    <div>
                      <div className="font-medium text-[#212529]">
                        {a.title} {a.count > 0 && <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold">{a.count}</span>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-[#555b70]">{a.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </BirCard>

          <BirCard
            title="TAMP Purchase-vs-Withholding Check (Read-Only)"
            right={
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${query.data.tampAudit.status === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                <ShieldAlert size={12} /> {query.data.tampAudit.unwithheldCount} local suppliers with ₱0 EWT
              </span>
            }
          >
            <p className="mb-3 text-[12px] text-[#6c718a]">{query.data.tampAudit.note}</p>
            {query.data.tampAudit.suppliers.length === 0 ? (
              <p className="text-[13px] text-emerald-700">All local suppliers with recorded purchases in this period have EWT recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                      <th className="py-2 pr-3">Supplier</th>
                      <th className="py-2 pr-3">TIN</th>
                      <th className="py-2 pr-3">Origin</th>
                      <th className="py-2 pr-3 text-right">Purchases</th>
                      <th className="py-2 pr-3 text-right">Net Amount</th>
                      <th className="py-2 text-right">EWT Withheld</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.tampAudit.suppliers.map((s) => (
                      <tr key={s.supplierId} className="border-t border-[#f2f1f7]">
                        <td className="py-2 pr-3 font-medium text-[#212529]">{s.name}</td>
                        <td className="py-2 pr-3 text-[#6c718a]">{s.tin || "Missing"}</td>
                        <td className="py-2 pr-3 capitalize text-[#6c718a]">{s.origin}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{s.purchases}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{zMoney(s.netCentavos)}</td>
                        <td className="py-2 text-right tabular-nums text-amber-700">{zMoney(s.ewtCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BirCard>

          {query.data.untaggedDocs.length > 0 && (
            <BirCard title={`Untagged Books Documents (${query.data.untaggedDocs.length})`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[#ebeaf2] text-left text-[11px] font-semibold text-[#6c718a] uppercase">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Kind</th>
                      <th className="py-2 pr-3">Number</th>
                      <th className="py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.untaggedDocs.slice(0, 15).map((d) => (
                      <tr key={d.id} className="border-t border-[#f2f1f7]">
                        <td className="py-1.5 pr-3 text-[#6c718a]">{d.date}</td>
                        <td className="py-1.5 pr-3 capitalize">{d.kind.replaceAll("_", " ")}</td>
                        <td className="py-1.5 pr-3">
                          <Link to={`/books/${d.kind.replaceAll("_", "")}s/${d.id}`} className="text-[#1c5bd9] hover:underline">
                            {d.number}
                          </Link>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{zMoney(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </BirCard>
          )}
        </div>
      )}
    </BirGuard>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#ebeaf2] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="text-[12px] text-[#6c718a]">{label}</div>
      <div className="mt-1 text-[19px] font-medium text-[#212529] tabular-nums">{value}</div>
    </div>
  );
}
