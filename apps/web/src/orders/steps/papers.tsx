// An order's papers on its page (orders/order.tsx): the chips of what is on file, the documents
// Management reads by hand, and the papers box to see and add them.

import type { OrderDetail, PaperKind } from "@2mg/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../api";
import { PAPER_ACCEPT, uploadPaper } from "../../photo";
import { Problem, timeLabel, useAction } from "../../ui";

/** Papers of some kinds: each with what it is for, its files, and adding one. */
/** The order's papers on one line (Management's step): one on file opens with a click, one not
 *  yet there is a small "+" to add a photo. */
export function PaperChips({ data, kinds }: { data: OrderDetail; kinds: PaperKind[] }) {
  const queries = useQueryClient();
  const [uploading, setUploading] = useState<PaperKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { order, can } = data;
  const mayAdd = (kind: string) =>
    kind === "payment_proof" ? can.addProof : kind === "dr" ? can.addDr : can.addPaper;
  const rows = data.paperList.filter((row) => kinds.includes(row.kind));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="font-semibold text-slate-600">Papers</span>
        {rows.map((row) => {
          const onFile = data.papers.filter((paper) => paper.kind === row.kind);
          if (onFile.length)
            return onFile.map((paper) => (
              <a
                key={paper.id}
                href={`/api/papers/${paper.id}`}
                target="_blank"
                rel="noreferrer"
                title={paper.name}
                className="inline-flex items-center gap-1.5 font-semibold text-slate-800 hover:underline"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {row.label}
              </a>
            ));
          return mayAdd(row.kind) ? (
            <label
              key={row.kind}
              title={row.why ?? undefined}
              className={`inline-flex cursor-pointer items-center gap-1 font-semibold ${
                row.needed ? "text-amber-700" : "text-slate-500"
              } hover:text-emerald-700 ${uploading ? "pointer-events-none opacity-50" : ""}`}
            >
              <Camera size={13} aria-hidden="true" />
              {uploading === row.kind ? "Uploading…" : `+ ${row.label}`}
              <input
                type="file"
                accept={PAPER_ACCEPT}
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setUploading(row.kind);
                  try {
                    await uploadPaper(order.id, row.kind, file);
                    setProblem(null);
                  } catch (error) {
                    setProblem(
                      error instanceof Error
                        ? error.message
                        : "That paper didn't upload. Try again.",
                    );
                  } finally {
                    setUploading(null);
                    await queries.invalidateQueries({ queryKey: ["orders"] });
                  }
                }}
              />
            </label>
          ) : (
            <span key={row.kind} className="text-slate-400">
              No {row.label.toLowerCase()}
            </span>
          );
        })}
      </div>
      {problem && <Problem message={problem} />}
    </div>
  );
}

/** Every paper this order carries, by who it is for (a hospital's PO and its own papers; a
 *  patient's prescription and ID), with what to add next, as the old CRM suggested it. */
export function Documents({ data }: { data: OrderDetail }) {
  const onFile = new Set(data.papers.map((paper) => paper.kind));
  const patient = data.order.customerKind === "patient" || data.order.patientOrder;
  const missing = data.paperList.filter(
    (row) => row.needed && !row.onFile && row.kind !== "payment_proof" && row.kind !== "dr",
  );
  const suggestion = missing.length
    ? `Next: add ${missing.map((row) => row.label).join(" and ")}.`
    : patient && onFile.has("prescription") && !onFile.has("gl")
      ? "Prescription on file. Is a guarantee letter paying for it (PCSO, DSWD…)? Add it under Guarantee letter."
      : patient && onFile.has("gl") && !onFile.has("med_cert")
        ? "Guarantee letter on file: add the medical certificate if the agency asks for it."
        : null;
  return (
    <div className="flex flex-col gap-3">
      {data.order.patientOrder && (
        <div className="text-sm text-slate-700">
          <b>For a patient:</b> {data.order.patientName ?? "name not given"}
        </div>
      )}
      {suggestion && (
        <div className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          <span>{suggestion}</span>
        </div>
      )}
      {/* Management's papers: the delivery receipt is Dispatch's, the proof of payment Finance's. */}
      <Papers
        data={data}
        kinds={data.paperList
          .map((row) => row.kind)
          .filter((kind) => kind !== "dr" && kind !== "payment_proof")}
      />
      <PapersCheck data={data} />
    </div>
  );
}

/** Management's own word on the papers, after reading each (Aryan, 19 Nov: a prescription is read
 *  by a person, right or wrong; the system never ticks it). Kept with who and when. */
function PapersCheck({ data }: { data: OrderDetail }) {
  const queries = useQueryClient();
  const action = useAction();
  const readable = data.papers.filter((paper) => paper.kind !== "payment_proof" && paper.kind !== "dr");
  if (!readable.length) return null;
  const checkedAt = data.order.papersCheckedAt;
  const may = data.can.approve || data.can.hold;
  const set = (ok: boolean) =>
    action.run(async () => {
      await api(`/api/orders/${data.order.id}/papers-check`, { body: { ok } });
      // The order's page and every card that shows it.
      await queries.invalidateQueries({ queryKey: ["orders"] });
    });
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm ${checkedAt ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"}`}>
      <span className="min-w-0 flex-1">
        {checkedAt
          ? `Papers checked by hand${data.order.papersCheckedBy ? ` by ${data.order.papersCheckedBy}` : ""}, ${new Date(checkedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}.`
          : `${readable.length} ${readable.length === 1 ? "paper" : "papers"} on file, not checked yet: open each (the prescription: right patient, doctor, medicine, date) and say so.`}
      </span>
      {may && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() => void set(!checkedAt)}
          className={checkedAt ? "text-sm font-semibold text-slate-600 underline hover:text-slate-900" : "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"}
        >
          {action.busy ? "Saving…" : checkedAt ? "Take back" : "Papers are right"}
        </button>
      )}
      {action.problem && <span className="basis-full text-xs text-rose-700">{action.problem.message}</span>}
    </div>
  );
}

export function Papers({ data, kinds }: { data: OrderDetail; kinds: PaperKind[] }) {
  const queries = useQueryClient();
  const [uploading, setUploading] = useState<PaperKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { order, can } = data;
  const mayAdd = (kind: string) =>
    kind === "payment_proof" ? can.addProof : kind === "dr" ? can.addDr : can.addPaper;
  const rows = data.paperList.filter((row) => kinds.includes(row.kind));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold text-slate-600">Papers</div>
      {rows.map((row) => {
        const onFile = data.papers.filter((paper) => paper.kind === row.kind);
        return (
          <div key={row.kind} className="rounded-xl border border-slate-200 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{row.label}</div>
                {row.why && (
                  <div
                    className={`text-xs ${row.needed && !row.onFile ? "text-amber-700" : "text-ink-2"}`}
                  >
                    {row.why}
                  </div>
                )}
              </div>
              {mayAdd(row.kind) && (
                <label
                  className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 ${uploading ? "pointer-events-none opacity-50" : ""}`}
                >
                  <Camera size={15} aria-hidden="true" />{" "}
                  {uploading === row.kind
                    ? "Uploading…"
                    : onFile.length
                      ? "Add another"
                      : "Add photo"}
                  <input
                    type="file"
                    accept={PAPER_ACCEPT}
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setUploading(row.kind);
                      try {
                        await uploadPaper(order.id, row.kind, file);
                        setProblem(null);
                      } catch (error) {
                        setProblem(
                          error instanceof Error
                            ? error.message
                            : "That paper didn't upload. Try again.",
                        );
                      } finally {
                        setUploading(null);
                        await queries.invalidateQueries({ queryKey: ["orders"] });
                      }
                    }}
                  />
                </label>
              )}
            </div>
            {onFile.map((paper) => (
              <div
                key={paper.id}
                className="mt-2 flex items-center gap-3 rounded-lg bg-slate-50 px-2 py-1.5"
              >
                {paper.mime.startsWith("image/") ? (
                  <a
                    href={`/api/papers/${paper.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                  >
                    <img
                      src={`/api/papers/${paper.id}`}
                      alt={paper.name}
                      className="size-10 rounded-md object-cover"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-slate-500">
                    <FileText size={18} aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/papers/${paper.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {paper.name}
                  </a>
                  <div className="text-xs text-ink-2">
                    {paper.by} · {timeLabel(paper.at)}
                  </div>
                </div>
                {mayAdd(paper.kind) && (
                  <button
                    type="button"
                    aria-label={`Remove ${paper.name}`}
                    onClick={async () => {
                      try {
                        await api(`/api/papers/${paper.id}/remove`, { method: "POST" });
                      } catch (error) {
                        setProblem(
                          error instanceof Error
                            ? error.message
                            : "That paper couldn't be removed.",
                        );
                      }
                      await queries.invalidateQueries({ queryKey: ["orders"] });
                    }}
                    className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
      <Problem message={problem} />
    </div>
  );
}
