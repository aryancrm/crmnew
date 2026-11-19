// The CEO's "Zoho CRM reports": every report Zoho CRM had, by name, in its group (Aryan, 18 Nov:
// "just make all their names for now"; no "not built" label). The company's own come first.

import { Link, useParams } from "react-router-dom";
import { CARD, PageHead, Pill } from "../ui";
import { ZOHO_REPORT_GROUPS } from "../zoho-reports";

export function ZohoReportsPage() {
  const key = useParams().group ?? ZOHO_REPORT_GROUPS[0]?.key;
  const group = ZOHO_REPORT_GROUPS.find((one) => one.key === key) ?? ZOHO_REPORT_GROUPS[0];
  if (!group) return null;
  const reports = [...group.reports.filter((one) => one.used), ...group.reports.filter((one) => !one.used)];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHead
        title={group.label}
        sub="The old CRM's reports, before this one"
      />
      <div className="flex flex-wrap gap-1.5">
        {ZOHO_REPORT_GROUPS.map((one) => (
          <Link
            key={one.key}
            to={`/zoho-reports/${one.key}`}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${one.key === group.key ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {one.label} <span className="opacity-70">{one.reports.length}</span>
          </Link>
        ))}
      </div>
      <ul className={`${CARD} divide-y divide-slate-100`}>
        {reports.map((report) => (
          <li key={report.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900">{report.name}</div>
              {report.about && <div className="text-[12.5px] text-slate-500">{report.about}</div>}
            </div>
            {report.used && <Pill tone="info">Made by the company</Pill>}
          </li>
        ))}
      </ul>
    </div>
  );
}
