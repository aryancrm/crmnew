// A website order on its case: one folded line (the order, the website, when, its status there),
// opened to what the customer saw (each item, whether the catalogue has it, the money as the
// website counted it), their documents, and what the CRM last told the website.

import type { WebOrderView } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, ExternalLink, Globe, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button, Problem, peso, timeLabel, useAction } from "../ui";

const PUSH_WORDS: Record<string, string> = {
  confirmed: "Confirmed",
  shipped: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** "senior · pending" as "Senior citizen discount (pending)", "pcso · pending" as "Guarantee letter from PCSO (pending)". */
function asked(value: string): string {
  const [type = "", status = ""] = value.split("·").map((part) => part.trim());
  const what =
    type === "senior"
      ? "Senior citizen discount"
      : type === "pwd"
        ? "PWD discount"
        : ["pcso", "dswd", "ovp", "op"].includes(type)
          ? `Guarantee letter from ${type.toUpperCase()}`
          : type
            ? `${type} assistance`
            : "Assistance";
  return status ? `${what} (${status})` : what;
}

export function WebsiteOrderCard({ web, canWork }: { web: WebOrderView; canWork: boolean }) {
  const [open, setOpen] = useState(false);
  const action = useAction();
  const queries = useQueryClient();
  const waiting = web.push.status && !web.push.error;
  const failed = web.push.status && web.push.error;
  async function retry() {
    if (await action.run(async () => api(`/api/web-orders/${web.id}/push`, { body: {} })))
      await queries.invalidateQueries({ queryKey: ["leads"] });
  }
  return (
    <section
      className={`mt-4 rounded-2xl border bg-white shadow-sm ${failed ? "border-rose-200" : "border-slate-200"}`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <Globe className="size-4 shrink-0 text-emerald-700" />
        <span className="text-[13px] font-semibold text-ink">Website order {web.ref}</span>
        <span className="text-[12px] text-slate-500">
          {web.site}
          {web.placedAt ? ` · placed ${timeLabel(web.placedAt)}` : ""}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
          On the website: {web.statusLabel}
        </span>
        {failed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
            <TriangleAlert className="size-3" /> Website didn't take "
            {PUSH_WORDS[web.push.status as string]}"
          </span>
        )}
        {waiting && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Telling the website: {PUSH_WORDS[web.push.status as string]}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
          {open ? "Hide" : "Show"}{" "}
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-slate-100 px-4 py-3 text-[13px] md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-500">
              As the customer saw it
            </div>
            <ul className="flex flex-col gap-1">
              {web.items.map((item, index) => (
                <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="truncate">
                      {item.quantity} × {item.name}
                    </span>
                    {!item.matched && (
                      <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-800">
                        Not in the catalogue
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {peso(item.lineTotal || item.unitPrice * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 flex flex-col gap-0.5 border-t border-slate-100 pt-2 text-[12px]">
              <Row label="Subtotal" value={web.money.subtotal} />
              {web.money.vatExempted > 0 && (
                <Row label="VAT exempted" value={-web.money.vatExempted} />
              )}
              {web.money.discount > 0 && <Row label="Discount" value={-web.money.discount} />}
              {web.money.deliveryFee > 0 && (
                <Row label="Delivery fee" value={web.money.deliveryFee} />
              )}
              <div className="flex justify-between font-semibold text-ink">
                <dt>Total on the website</dt>
                <dd className="tabular-nums">{peso(web.money.total)}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-col gap-2 text-[12px]">
            <div>
              <span className="text-slate-500">Pays by: </span>
              {web.paymentMethod === "cod" ? "Cash on delivery" : (web.paymentMethod ?? "Not said")}
            </div>
            {(web.benefit || web.assistance) && (
              <div>
                <span className="text-slate-500">Asked for: </span>
                {[web.benefit, web.assistance]
                  .filter((value): value is string => Boolean(value))
                  .map(asked)
                  .join(", ")}
              </div>
            )}
            {web.files.length > 0 && (
              <div>
                <div className="text-slate-500">Documents</div>
                <ul>
                  {web.files.map((file, index) => (
                    <li key={`${file.kind}-${index}`} className="flex items-center gap-1.5">
                      {file.fetched ? (
                        <Check className="size-3 text-emerald-600" />
                      ) : (
                        <TriangleAlert className="size-3 text-amber-600" />
                      )}
                      {file.kind === "prescription"
                        ? "Prescription"
                        : file.kind === "id"
                          ? "ID"
                          : "Guarantee letter"}
                      <span className="text-slate-500">
                        {file.fetched
                          ? "on the case, to file"
                          : file.gaveUp
                            ? "couldn't be copied: open it on the website"
                            : "still coming"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <span className="text-slate-500">The CRM last told the website: </span>
              {web.push.pushedAt ? timeLabel(web.push.pushedAt) : "nothing yet"}
            </div>
            {failed && (
              <div className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-800">
                {web.push.error}
                {canWork && (
                  <div className="mt-1.5">
                    <Button small disabled={action.busy} onClick={retry}>
                      {action.busy ? "Sending…" : "Try again"}
                    </Button>
                  </div>
                )}
              </div>
            )}
            <Problem message={action.problem?.message} />
            {web.adminUrl && (
              <a
                href={web.adminUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
              >
                Open it in the website's admin <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value < 0 ? `−${peso(-value)}` : peso(value)}</dd>
    </div>
  );
}
