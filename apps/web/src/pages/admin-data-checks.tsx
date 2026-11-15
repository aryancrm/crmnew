// The Admin panel's Data checks: the data checked against itself, each check green when all is
// right, else how many things are wrong and which (by order, bill, medicine or person).

import type { DataChecks } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { api } from "../api";
import { Button, count, PageHead, PageState, timeLabel } from "../ui";

export function AdminDataChecks() {
  const query = useQuery({
    queryKey: ["admin", "data-checks"],
    queryFn: () => api<DataChecks>("/api/admin/data-checks"),
    staleTime: 0,
  });
  const data = query.data;
  if (!data) return <PageState query={query} what="the data checks" />;
  const fine = data.checks.filter((check) => check.ok).length;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHead
        title="Data checks"
        sub={`${fine} of ${data.checks.length} fine · checked ${timeLabel(data.at)}`}
        actions={
          <Button small onClick={() => void query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}{" "}
            Check again
          </Button>
        }
      />
      <div
        className={`mb-4 flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-[13px] font-semibold shadow-2xs ring-1 ${data.ok ? "text-emerald-800 ring-emerald-200" : "text-rose-800 ring-rose-200"}`}
      >
        <span
          className={`size-2 rounded-full ${data.ok ? "bg-emerald-500" : "bg-rose-500"}`}
          aria-hidden="true"
        />
        {data.ok
          ? "Everything adds up."
          : `${data.checks.length - fine} ${data.checks.length - fine === 1 ? "check needs" : "checks need"} a look.`}
      </div>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm">
        {data.checks.map((check) => (
          <li key={check.key} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2.5">
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${check.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}
                  aria-hidden="true"
                >
                  {check.ok ? <Check className="size-3" /> : "!"}
                </span>
                <span className="font-medium text-slate-800">{check.label}</span>
              </span>
              <span
                className={`shrink-0 text-[12px] font-semibold ${check.ok ? "text-emerald-700" : "text-rose-700"}`}
              >
                {check.ok ? "Fine" : `${count(check.count)} wrong`}
              </span>
            </div>
            {!check.ok && (
              <ul className="mt-2 ml-7 flex flex-col gap-0.5 text-[12px] text-slate-600">
                {check.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
                {check.count > check.problems.length && (
                  <li className="text-slate-400">
                    and {count(check.count - check.problems.length)} more
                  </li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
